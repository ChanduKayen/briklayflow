// WhatsApp Sprint 2 -- NormalizedMessage envelope.
//
// Every inbound type (text, interactive, image, voice, ...) is normalized to ONE
// shape with `text` populated, so nothing downstream branches on message type.
//   image -> download media (private bucket) + vision -> text   (lands now)
//   voice -> transcribe -> text  (no flag: on whenever a provider key exists --
//            Sarvam preferred for TE/HI code-mix, OpenAI Whisper as the fallback)

const WA_ACCESS_TOKEN  = Deno.env.get('WA_ACCESS_TOKEN')!
const ANTHROPIC_KEY    = Deno.env.get('ANTHROPIC_API_KEY')
const OPENAI_KEY       = Deno.env.get('OPENAI_API_KEY')
const SARVAM_KEY       = Deno.env.get('SARVAM_API_KEY')

const MEDIA_BUCKET = 'rough-entry-media'

export type NormalizedMessage = {
  org_id: string
  sender: string                 // wa id, country-code format
  wamid: string
  text: string                   // routable text -- populated for ALL types
  source_type: 'text' | 'interactive' | 'image' | 'voice' | 'reaction' | 'unsupported'
  attachments: { media_id: string; mime: string; storage_path?: string }[]
  // STEP 5 — an inbound reaction (👍/👎 on one of OUR messages). message_id is the OUTBOUND wamid it
  // reacted to (resolved via wa_message_map), emoji is '' when the reaction was REMOVED.
  reaction?: { message_id: string; emoji: string }
  // Payment-image vision payload: the router classifies on `text` (the cheap description);
  // if it lands on the Transaction agent, the agent extracts straight from this image.
  image?: { base64: string; mime: string; caption: string }
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
      const b64 = toBase64(bytes)
      // Cheap one-line description -> the ROUTER's signal (payment vs site photo). The
      // real, professional extraction happens agent-side from the image (see image below).
      const description = await describeImage(b64, mime, caption)
      const text = [caption, description].filter(Boolean).join(' -- ').trim()
      return {
        ...base,
        text: text || 'Image received',
        source_type: 'image',
        attachments: [{ media_id: mediaId, mime, storage_path }],
        image: { base64: b64, mime, caption },
      }
    } catch (e) {
      console.error('[normalize] image handling failed:', e)
      return { ...base, text: caption || '', source_type: 'image',
               attachments: [{ media_id: mediaId, mime: 'image/jpeg' }] }
    }
  }

  // ── voice / audio -> transcribe (Sarvam if set, else OpenAI Whisper) ─────────
  if (type === 'audio' || type === 'voice') {
    const mediaId = (message.audio?.id ?? message.voice?.id) as string
    const mime = (message.audio?.mime_type ?? message.voice?.mime_type ?? 'audio/ogg') as string
    // No transcription provider configured at all -> empty text, graceful reply upstream.
    if (!SARVAM_KEY && !OPENAI_KEY) {
      return { ...base, text: '', source_type: 'voice',
               attachments: [{ media_id: mediaId, mime }] }
    }
    try {
      const { bytes, mime: realMime } = await downloadMedia(mediaId)
      // Transcribe from the bytes we already hold. Persisting the audio is provenance
      // only -- a storage/MIME rejection must NEVER lose the transcript, so it's
      // best-effort and runs after (and independent of) transcription.
      const language = await resolveSpokenLanguage(supabase, ctx.from)
      // Keep the NATIVE transcript verbatim -- no romanization pass. The extractor
      // (gpt-4.1) reads native script directly and emits payee/amount/note already in
      // English (TXN_SYSTEM "OUTPUT LANGUAGE"), so the lossy transliteration hop that
      // mangled names ("రాజీవ్" -> "Rajeef") is gone: ONE understanding call decides.
      const text = await transcribeAudio(bytes, realMime, language)
      // TRACE 1/4 -- the native transcript handed downstream.
      console.log('[trace] voice', JSON.stringify({ lang: language ?? 'auto', transcript: text.slice(0, 300) }))
      let storage_path: string | undefined
      try {
        storage_path = await storeMedia(supabase, bytes, realMime, ctx.from)
      } catch (e) {
        console.warn('[normalize] voice store skipped (transcript kept):', (e as Error)?.message ?? e)
      }
      return { ...base, text: text ?? '', source_type: 'voice',
               attachments: [{ media_id: mediaId, mime: realMime, ...(storage_path ? { storage_path } : {}) }] }
    } catch (e) {
      console.error('[normalize] voice handling failed:', e)
      return { ...base, text: '', source_type: 'voice',
               attachments: [{ media_id: mediaId, mime }] }
    }
  }

  // ── reaction -> surface the target wamid + emoji (STEP 5: reactions-as-confirm / retract) ────
  // Previously fell through to 'unsupported' (the user got a "can't handle that" reply for a 👍). Now
  // carried through so the reaction handler can resolve it against wa_message_map.
  if (type === 'reaction') {
    return {
      ...base, text: '', source_type: 'reaction',
      reaction: { message_id: message.reaction?.message_id ?? '', emoji: message.reaction?.emoji ?? '' },
    }
  }

  // ── anything else ───────────────────────────────────────────────────────────
  return { ...base, text: '', source_type: 'unsupported' }
}

// ── Media: WhatsApp media API -> bytes -> private bucket ─────────────────────────

async function downloadMedia(mediaId: string): Promise<{ bytes: Uint8Array; mime: string }> {
  const metaRes = await fetch(`https://graph.facebook.com/v19.0/${mediaId}`, {
    headers: { Authorization: `Bearer ${WA_ACCESS_TOKEN}` },
  })
  if (!metaRes.ok) throw new Error(`media lookup ${metaRes.status}`)
  const meta = await metaRes.json()
  const mime: string = meta.mime_type || 'application/octet-stream'

  // The lookaside CDN url needs the SAME bearer auth as the lookup (per Meta) -- a
  // missing header here is a silent 401/empty download.
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

// ── Voice transcription ─────────────────────────────────────────────────────────
// PRIMARY: Sarvam saarika -- purpose-built for Indian languages; it understands Telugu/
// Hindi quirks + code-switching and AUTO-DETECTS the language ('unknown'). It needs a
// language_code (omitting it is a 400 -- the cause of the earlier "sarvam failed"). If
// Sarvam is absent/fails, we fall back to OpenAI (gpt-4o-transcribe -> whisper-1).
// Disable Sarvam with WA_SARVAM_OFF=true.
const SARVAM_OFF = Deno.env.get('WA_SARVAM_OFF') === 'true'
const SARVAM_MODEL = Deno.env.get('WA_SARVAM_MODEL') ?? 'saarika:v2.5'
const OPENAI_STT_MODELS = ['gpt-4o-transcribe', 'whisper-1']

/** Map an ISO-639-1 hint to Sarvam's BCP-47 code; 'unknown' lets saarika auto-detect. */
function sarvamLang(iso?: string): string {
  const m: Record<string, string> = {
    te: 'te-IN', hi: 'hi-IN', en: 'en-IN', ta: 'ta-IN', kn: 'kn-IN', ml: 'ml-IN',
    bn: 'bn-IN', gu: 'gu-IN', mr: 'mr-IN', pa: 'pa-IN', or: 'od-IN',
  }
  return (iso && m[iso]) || 'unknown'
}

// The DEPLOYMENT's locale prior (ISO-639-1) -- a tiebreaker used only when we have no
// per-person preference. Empty by default: the code assumes NO language. Set
// WA_STT_LANGUAGE to your region's language (e.g. 'te' for coastal Andhra, 'hi' for a
// Hindi site); leave it empty to auto-detect from the audio. Auto-detect alone tends to
// confuse acoustically-close Indian languages (Telugu <-> Tamil), so set the prior.
const STT_LOCALE_PRIOR = (Deno.env.get('WA_STT_LANGUAGE') ?? '').trim()

// Domain priming -- a SAMPLE of expected vocabulary (names + payment words), NOT an
// instruction. Whisper/Sarvam use the prompt as context to bias spelling; instruction-y
// prompts hurt recognition. The transcript stays in the speaker's native script -- the
// extractor handles understanding + English output -- so this stays a clean natural phrase.
const STT_PROMPT =
  'Construction site payments in Kakinada, Andhra Pradesh. Worker and vendor names like ' +
  'Ramu, Suresh, Lakshmi, Ravi, Subramanyam. Amounts in rupees: cash, UPI, advance, cement, plastering, mestri.'

/**
 * Resolve the spoken language for transcription, best signal first:
 *   1) the person's admin-set preference (how they SPEAK) -- strongest;
 *   2) the deployment/region locale prior (WA_STT_LANGUAGE) -- the ambiguity tiebreaker;
 *   3) undefined -> let the model auto-detect.
 * Never assumes a language in code.
 */
async function resolveSpokenLanguage(supabase: any, sender: string): Promise<string | undefined> {
  try {
    const { data } = await supabase
      .from('wa_registered_numbers')
      .select('preferred_language')
      .eq('phone_number', sender).eq('is_active', true)
      .maybeSingle()
    const pref = (data?.preferred_language ?? '').trim()
    if (pref) return pref
  } catch (_) { /* column may not exist yet -> fall through */ }
  return STT_LOCALE_PRIOR || undefined
}

async function transcribeAudio(bytes: Uint8Array, mime: string, language?: string): Promise<string> {
  const ext = (mime.split('/')[1] || 'ogg').split(';')[0]
  const file = () => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type: mime }), `audio.${ext}`); return fd }

  // 1) Sarvam saarika -- PRIMARY Indian-language model, with auto-detect.
  if (!SARVAM_OFF && SARVAM_KEY) {
    try {
      const fd = file()
      fd.append('model', SARVAM_MODEL)
      fd.append('language_code', sarvamLang(language))   // resolved hint, else 'unknown' (auto-detect)
      const res = await fetch('https://api.sarvam.ai/speech-to-text', {
        method: 'POST', headers: { 'api-subscription-key': SARVAM_KEY }, body: fd,
      })
      if (res.ok) {
        const t = ((await res.json()).transcript ?? '').trim()
        if (t) return t
        console.warn('[normalize] sarvam: empty transcript, falling back')
      } else {
        const body = await res.text().catch(() => '')
        console.warn('[normalize] sarvam failed', res.status, body.slice(0, 200))
      }
    } catch (e) {
      console.warn('[normalize] sarvam error, falling back:', (e as Error)?.message ?? e)
    }
  }

  // 2) OpenAI -- best transcription model first, whisper-1 as the safety fallback.
  if (OPENAI_KEY) {
    for (const model of OPENAI_STT_MODELS) {
      try {
        const fd = file()
        fd.append('model', model)
        if (language) fd.append('language', language)   // resolved hint (pref -> locale); else auto-detect
        fd.append('prompt', STT_PROMPT)                  // local-name + payment-word priming (neutral)
        fd.append('temperature', '0')                   // deterministic transcription
        const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST', headers: { Authorization: `Bearer ${OPENAI_KEY}` }, body: fd,
        })
        if (res.ok) {
          const d = await res.json()
          const t = (d.text ?? '').trim()
          if (t) return t
        } else {
          const body = await res.text().catch(() => '')
          console.warn(`[normalize] openai ${model} failed`, res.status, body.slice(0, 200))
        }
      } catch (e) {
        console.warn(`[normalize] openai ${model} error:`, (e as Error)?.message ?? e)
      }
    }
  }
  return ''
}
