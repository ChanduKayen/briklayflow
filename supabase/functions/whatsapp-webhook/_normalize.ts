// WhatsApp Sprint 2 -- NormalizedMessage envelope.
//
// Every inbound type (text, interactive, image, voice, ...) is normalized to ONE
// shape with `text` populated, so nothing downstream branches on message type.
//   image -> download media (private bucket) + vision -> text   (lands now)
//   voice -> transcribe -> text  (behind WA_VOICE_ENABLED; Sarvam -> Whisper)

const WA_ACCESS_TOKEN  = Deno.env.get('WA_ACCESS_TOKEN')!
const ANTHROPIC_KEY    = Deno.env.get('ANTHROPIC_API_KEY')
const OPENAI_KEY       = Deno.env.get('OPENAI_API_KEY')
const SARVAM_KEY       = Deno.env.get('SARVAM_API_KEY')
const VOICE_ENABLED    = Deno.env.get('WA_VOICE_ENABLED') === 'true'

const MEDIA_BUCKET = 'rough-entry-media'

export type NormalizedMessage = {
  org_id: string
  sender: string                 // wa id, country-code format
  wamid: string
  text: string                   // routable text -- populated for ALL types
  source_type: 'text' | 'interactive' | 'image' | 'voice' | 'unsupported'
  attachments: { media_id: string; mime: string; storage_path?: string }[]
  timestamp: string
}

/** Normalize one inbound WhatsApp message into the common envelope. */
export async function normalize(
  supabase: any,
  message: any,
  ctx: { orgId: string; from: string; wamid: string },
): Promise<NormalizedMessage> {
  const base = {
    org_id: ctx.orgId,
    sender: ctx.from,
    wamid: ctx.wamid,
    timestamp: message?.timestamp
      ? new Date(Number(message.timestamp) * 1000).toISOString()
      : new Date().toISOString(),
    attachments: [] as NormalizedMessage['attachments'],
  }

  const type = message?.type as string

  // ── text ──────────────────────────────────────────────────────────────────
  if (type === 'text') {
    return { ...base, text: message.text?.body ?? '', source_type: 'text' }
  }

  // ── interactive (button / list reply) -> map the selection to its text ──────
  if (type === 'interactive') {
    const i = message.interactive ?? {}
    const reply = i.button_reply ?? i.list_reply ?? {}
    // keep both id and title; route on the title text.
    return { ...base, text: (reply.title ?? reply.id ?? '') as string, source_type: 'interactive' }
  }

  // ── image -> download + vision -> text ──────────────────────────────────────
  if (type === 'image') {
    const mediaId = message.image?.id as string
    const caption = (message.image?.caption ?? '') as string
    try {
      const { bytes, mime } = await downloadMedia(mediaId)
      const storage_path = await storeMedia(supabase, bytes, mime, ctx.from)
      const description = await describeImage(toBase64(bytes), mime, caption)
      const text = [caption, description].filter(Boolean).join(' -- ').trim()
      return {
        ...base,
        text: text || 'Image received',
        source_type: 'image',
        attachments: [{ media_id: mediaId, mime, storage_path }],
      }
    } catch (e) {
      console.error('[normalize] image handling failed:', e)
      return { ...base, text: caption || '', source_type: 'image',
               attachments: [{ media_id: mediaId, mime: 'image/jpeg' }] }
    }
  }

  // ── voice / audio -> transcribe (flagged) ───────────────────────────────────
  if (type === 'audio' || type === 'voice') {
    const mediaId = (message.audio?.id ?? message.voice?.id) as string
    const mime = (message.audio?.mime_type ?? message.voice?.mime_type ?? 'audio/ogg') as string
    // Flag off OR no Sarvam key -> effectively off: empty text, graceful reply upstream.
    if (!VOICE_ENABLED || !SARVAM_KEY) {
      return { ...base, text: '', source_type: 'voice',
               attachments: [{ media_id: mediaId, mime }] }
    }
    try {
      const { bytes, mime: realMime } = await downloadMedia(mediaId)
      const storage_path = await storeMedia(supabase, bytes, realMime, ctx.from)
      const text = await transcribeAudio(bytes, realMime)
      return { ...base, text: text ?? '', source_type: 'voice',
               attachments: [{ media_id: mediaId, mime: realMime, storage_path }] }
    } catch (e) {
      console.error('[normalize] voice handling failed:', e)
      return { ...base, text: '', source_type: 'voice',
               attachments: [{ media_id: mediaId, mime }] }
    }
  }

  // ── anything else ───────────────────────────────────────────────────────────
  return { ...base, text: '', source_type: 'unsupported' }
}

// ── Media: WhatsApp media API -> bytes -> private bucket ─────────────────────────

async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const metaRes = await fetch(`https://graph.facebook.com/v18.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
  })
  if (!metaRes.ok) throw new Error(`media lookup ${metaRes.status}`)
  const meta = await metaRes.json()
  const mime: string = meta.mime_type || 'application/octet-stream'

  const binRes = await fetch(meta.url, { headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` } })
  if (!binRes.ok) throw new Error(`media download ${binRes.status}`)
  return { bytes: new Uint8Array(await binRes.arrayBuffer()), mime }
}

/** Store bytes in the (now private) rough-entry-media bucket; return the path. */
async function storeMedia(supabase: any, bytes: Uint8Array, mime: string, from: string): Promise<string> {
  const ext = (mime.split('/')[1] || 'bin').split(';')[0]
  const path = `wa_${from}_${Date.now()}.${ext}`
  const { error } = await supabase.storage.from(MEDIA_BUCKET).upload(path, bytes, {
    contentType: mime, upsert: false,
  })
  if (error) throw new Error(`storage upload failed: ${error.message}`)
  return path
}

/** Short-lived signed URL for stored media (bucket is private). */
export async function signedMediaUrl(supabase: any, path: string, ttlSeconds = 3600): Promise<string | null> {
  const { data, error } = await supabase.storage.from(MEDIA_BUCKET).createSignedUrl(path, ttlSeconds)
  if (error || !data?.signedUrl) return null
  return data.signedUrl
}

function toBase64(bytes: Uint8Array): string {
  const CHUNK = 8192
  let binary = ''
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.slice(i, i + CHUNK))
  }
  return btoa(binary)
}

// ── Image vision: concise text extraction (NOT a transaction decision) ──────────

async function describeImage(base64: string, mime: string, caption: string): Promise<string> {
  const prompt =
    'You are a construction-site assistant. In ONE concise line, capture what a ' +
    'site user put in this image: if a bill/receipt/UPI screenshot, the amount and ' +
    'payee/vendor; if a materials or labour list, the key items; otherwise a brief ' +
    'description. Do NOT decide or post a transaction. Plain text only, no JSON.' +
    (caption ? ` User caption: "${caption}".` : '')

  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 15000)
  try {
    if (ANTHROPIC_KEY) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        signal: ctrl.signal, method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 200,
          messages: [{ role: 'user', content: [
            { type: 'image', source: { type: 'base64', media_type: mime, data: base64 } },
            { type: 'text', text: prompt },
          ] }],
        }),
      })
      const d = await res.json()
      return (d.content?.[0]?.text ?? '').trim()
    }
    if (OPENAI_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        signal: ctrl.signal, method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o-mini', max_tokens: 200,
          messages: [{ role: 'user', content: [
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' } },
            { type: 'text', text: prompt },
          ] }],
        }),
      })
      const d = await res.json()
      return (d.choices?.[0]?.message?.content ?? '').trim()
    }
  } catch (e) {
    console.error('[normalize] describeImage error:', e)
  } finally {
    clearTimeout(t)
  }
  return ''
}

// ── Voice transcription: Sarvam primary, Whisper fallback (no pre-detection) ─────

async function transcribeAudio(bytes: Uint8Array, mime: string): Promise<string> {
  const ext = (mime.split('/')[1] || 'ogg').split(';')[0]
  // 1) Sarvam (handles TE/HI/English code-mix, the dominant case here).
  if (SARVAM_KEY) {
    try {
      const fd = new FormData()
      fd.append('file', new Blob([bytes], { type: mime }), `audio.${ext}`)
      fd.append('model', 'saarika:v2')
      const res = await fetch('https://api.sarvam.ai/speech-to-text', {
        method: 'POST', headers: { 'api-subscription-key': SARVAM_KEY }, body: fd,
      })
      if (res.ok) {
        const d = await res.json()
        const t = (d.transcript ?? d.text ?? '').trim()
        if (t) return t
      } else {
        console.warn('[normalize] sarvam failed', res.status)
      }
    } catch (e) {
      console.warn('[normalize] sarvam error, falling back to whisper:', (e as Error)?.message ?? e)
    }
  }
  // 2) Whisper fallback.
  if (OPENAI_KEY) {
    try {
      const fd = new FormData()
      fd.append('file', new Blob([bytes], { type: mime }), `audio.${ext}`)
      fd.append('model', 'whisper-1')
      const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
        method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: fd,
      })
      if (res.ok) {
        const d = await res.json()
        return (d.text ?? '').trim()
      }
      console.warn('[normalize] whisper failed', res.status)
    } catch (e) {
      console.error('[normalize] whisper error:', e)
    }
  }
  return ''
}
