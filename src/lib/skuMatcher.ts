import { supabase } from './supabase'

export interface SKUMatchResult {
  item_raw:      string
  item_name:     string
  specification: string | null
  dimension:     string | null
  variant:       string | null
  grade:         string | null
  quantity:      number | null
  unit:          string | null
  category_hint: string
  sku_id:        string | null
  sku_name:      string | null
  confidence:    number
  match_source:  'trgm' | 'openai' | 'none'
  reason:        string
  alternatives:  { sku_id: string; sku_name: string; confidence: number }[]
  needs_review:  boolean
}

export interface SKUMatcherResponse {
  items:         SKUMatchResult[]
  total:         number
  auto_matched:  number
  needs_review:  number
  trgm_resolved: number
  /** What the transcriber heard, when the request was a recording. */
  transcript?:   string
  error?:        string
}

export async function matchSKUs(params: {
  text?:            string
  audio_base64?:    string
  audio_mime?:      string
  language?:        string
  image_base64?:    string
  image_url?:       string
  image_mime?:      string
  filename?:        string
  caller?:          string
  vendor_category?: string
}): Promise<SKUMatcherResponse> {
  const { data, error } = await supabase.functions.invoke('sku-matcher', {
    body: params,
  })

  if (error) {
    // supabase-js reports a non-2xx as a generic FunctionsHttpError; the REAL reason is the
    // edge fn's { error } body, carried in error.context (the Response). Surface it.
    let msg = error.message || 'Could not read the document.'
    try {
      const ctx = (error as { context?: Response }).context
      if (ctx && typeof ctx.clone === 'function') {
        const body = await ctx.clone().json()
        if (body?.error) msg = String(body.error)
      }
    } catch { /* fall back to the generic message */ }
    throw new Error(msg)
  }
  // The function can also return 200 with an { error } field.
  if (data && (data as SKUMatcherResponse).error) throw new Error(String((data as SKUMatcherResponse).error))
  return data as SKUMatcherResponse
}

export async function matchSKUsFromText(
  text:             string,
  caller:           string = 'manual',
  vendor_category?: string
): Promise<SKUMatcherResponse> {
  return matchSKUs({ text, caller, vendor_category })
}

/**
 * A spoken order. The recording goes up whole and is transcribed on the server — the browser's
 * own speech API cannot hold Telugu/Hindi code-mix, and transcribing live in the browser showed
 * the user a half-heard sentence rewriting itself, which is worse than showing nothing.
 */
export async function matchSKUsFromAudio(
  audio:            Blob,
  caller:           string = 'manual',
  vendor_category?: string,
  language?:        string,
): Promise<SKUMatcherResponse> {
  const buffer = await audio.arrayBuffer()
  const bytes  = new Uint8Array(buffer)
  let b64 = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    b64 += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  try {
    return await matchSKUs({ audio_base64: btoa(b64), audio_mime: audio.type || 'audio/webm', language, caller, vendor_category })
  } catch (e) {
    // A sku-matcher deployed before voice existed ignores audio_base64 and then complains that
    // nothing was sent at all. That contract string is meaningless to whoever is holding the
    // phone, so translate it — and keep the real reason where a developer will find it.
    const msg = (e as Error)?.message ?? ''
    if (/image_base64|image_url/i.test(msg)) {
      console.error('[voice] the deployed sku-matcher does not accept audio yet — deploy the function', e)
      throw new Error('Voice is not live on the server yet. Type the items or scan a quote for now.', { cause: e })
    }
    throw e
  }
}

export async function matchSKUsFromFile(
  file:             File,
  caller:           string = 'manual',
  vendor_category?: string
): Promise<SKUMatcherResponse> {
  const buffer = await file.arrayBuffer()
  const bytes  = new Uint8Array(buffer)
  let b64 = ''
  const chunk = 8192
  for (let i = 0; i < bytes.length; i += chunk) {
    b64 += String.fromCharCode(...bytes.subarray(i, i + chunk))
  }
  return matchSKUs({ image_base64: btoa(b64), image_mime: file.type, filename: file.name, caller, vendor_category })
}
