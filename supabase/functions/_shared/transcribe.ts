// Voice transcription, shared by every surface that takes a spoken message.
//
// It began life inside whatsapp-webhook/_normalize.ts, tuned over many live failures on real site
// audio, and now serves the app's own voice input as well — the browser's built-in speech API
// cannot handle Telugu/Hindi code-mix, which is most of what actually gets said.
//
// PRIMARY: Sarvam saarika — purpose-built for Indian languages; it understands Telugu/Hindi quirks
// + code-switching and AUTO-DETECTS the language ('unknown'). It needs a language_code (omitting it
// is a 400). If Sarvam is absent or fails, we fall back to OpenAI (gpt-4o-transcribe -> whisper-1).
// Disable Sarvam with WA_SARVAM_OFF=true.
//
// The DOMAIN PROMPT is deliberately a PARAMETER, not a constant. Whisper and Sarvam read it as
// CONTEXT that biases spelling and word choice, so priming with the wrong domain actively hurts:
// a caller dictating a materials order must not be primed with payment and site-report words, the
// same way site reports were once damaged by a payments-only prompt. Each caller passes the world
// its speaker is actually talking about.

const OPENAI_KEY  = Deno.env.get('OPENAI_API_KEY')
const SARVAM_KEY  = Deno.env.get('SARVAM_API_KEY')
const SARVAM_OFF  = Deno.env.get('WA_SARVAM_OFF') === 'true'
const SARVAM_MODEL = Deno.env.get('WA_SARVAM_MODEL') ?? 'saarika:v2.5'
const OPENAI_STT_MODELS = ['gpt-4o-transcribe', 'whisper-1']

/** True when at least one provider is configured — callers use this to say "voice is off" early. */
export function canTranscribe(): boolean {
  return !!(SARVAM_KEY || OPENAI_KEY)
}

/** Map an ISO-639-1 hint to Sarvam's BCP-47 code; 'unknown' lets saarika auto-detect. */
export function sarvamLang(iso?: string): string {
  const m: Record<string, string> = {
    te: 'te-IN', hi: 'hi-IN', en: 'en-IN', ta: 'ta-IN', kn: 'kn-IN', ml: 'ml-IN',
    bn: 'bn-IN', gu: 'gu-IN', mr: 'mr-IN', pa: 'pa-IN', or: 'od-IN',
  }
  return (iso && m[iso]) || 'unknown'
}

export interface TranscribeOptions {
  /** ISO-639-1 hint. Undefined lets the model auto-detect. */
  language?: string
  /** A SAMPLE of the world the speaker is describing — never an instruction, never a classifier. */
  prompt?: string
}

export async function transcribeAudio(
  bytes: Uint8Array,
  mime: string,
  opts: TranscribeOptions = {},
): Promise<string> {
  const { language, prompt } = opts
  const ext = (mime.split('/')[1] || 'ogg').split(';')[0]
  const file = () => { const fd = new FormData(); fd.append('file', new Blob([bytes], { type: mime }), `audio.${ext}`); return fd }

  // 1) Sarvam saarika — PRIMARY Indian-language model, with auto-detect.
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
        console.warn('[transcribe] sarvam: empty transcript, falling back')
      } else {
        const body = await res.text().catch(() => '')
        console.warn('[transcribe] sarvam failed', res.status, body.slice(0, 200))
      }
    } catch (e) {
      console.warn('[transcribe] sarvam error, falling back:', (e as Error)?.message ?? e)
    }
  }

  // 2) OpenAI — best transcription model first, whisper-1 as the safety fallback.
  if (OPENAI_KEY) {
    for (const model of OPENAI_STT_MODELS) {
      try {
        const fd = file()
        fd.append('model', model)
        if (language) fd.append('language', language)   // resolved hint; else auto-detect
        if (prompt) fd.append('prompt', prompt)         // domain priming from the caller
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
          console.warn(`[transcribe] openai ${model} failed`, res.status, body.slice(0, 200))
        }
      } catch (e) {
        console.warn(`[transcribe] openai ${model} error:`, (e as Error)?.message ?? e)
      }
    }
  }
  return ''
}
