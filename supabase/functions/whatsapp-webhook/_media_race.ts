// The media-race guard.
//
// A supervisor sends a bill PHOTO, then immediately types the context as a SEPARATE text ("Asm site bill").
// Two independent jobs run. The photo pays for vision (describeImage + the financial-doc read) BEFORE it
// acquires the per-sender lock, so the fast text OVERTAKES it: the text routes and finishes while the photo
// is still being read. When the text routes, the bill does not exist yet — so a site-ish caption is classified
// fresh, lands in SiteOps, and parks as "couldn't tell which work you meant" (the reported bug). The caption
// is lost and the bill never gets it.
//
// The fix is to make a trailing TEXT yield to a still-in-flight PHOTO from the same sender, so the staged
// bill/txn exists before the text is routed and the caption can attach to it. This is done PRE-LOCK (in
// processJob, before acquireSenderLock) so the photo can take the lock and stage the bill while the text
// waits. The decision of WHICH job to wait on is a pure function (below); the bounded poll is the IO wrapper.

import { parseSpokenAmount } from './_amount.ts'

const TERMINAL = new Set(['WRITTEN', 'FAILED', 'CONFIRMED'])

export type JobRow = { wamid: string; message_type: string | null; status: string; received_at: string }

// A document/media word — the strong signal that a short, amount-less text is CAPTIONING a bill photo
// ("Asm site bill", "here's the invoice", "receipt"), not a standalone instruction. Deliberately narrow.
const DOC_WORDS = /\b(bill|bills|invoice|invoices|receipt|receipts|challan|challans|voucher|vouchers|statement|photo|pic|picture|image|screenshot|proof|slip|memo|quotation|quote)\b/i

/**
 * PURE: does this text read as a bare CAPTION for a bill photo — a short phrase that names a document but
 * carries nothing to record on its own? Used to HOLD it (for a photo arriving next) instead of minting a junk
 * empty transaction or parking it in SiteOps. Conservative on purpose — a false positive only holds the text
 * with a "send the photo" ack (safe, reversible), never commits anything:
 *   • short (≤ 6 words) — a caption, not a sentence;
 *   • NO real amount (no multi-digit number, no spoken amount) — an amount means it can stand alone;
 *   • mentions a document/media word — the actual signal that a photo is what it's about.
 */
export function looksLikeBillCaption(text: string): boolean {
  const t = (text ?? '').trim()
  if (!t) return false
  if (t.split(/\s+/).length > 6) return false
  if (/\d{2,}/.test(t)) return false
  if (parseSpokenAmount(t).amount != null) return false
  return DOC_WORDS.test(t)
}

/**
 * PURE: given this sender's recent processing_job rows, return the wamid of an in-flight PHOTO job this text
 * should wait for, or null. A candidate is: an IMAGE job, not this message, not yet terminal, received within
 * `windowMs` of now (a photo sent moments before this text — not an unrelated older one). Most recent wins.
 */
export function pickPhotoToAwait(
  rows: JobRow[], selfWamid: string, nowMs: number, windowMs = 20_000,
): string | null {
  const cand = (rows ?? [])
    .filter((r) => r.wamid !== selfWamid && r.message_type === 'image' && !TERMINAL.has(r.status))
    .filter((r) => {
      const t = Date.parse(r.received_at ?? '')
      return Number.isFinite(t) && (nowMs - t) <= windowMs && (nowMs - t) >= -windowMs
    })
    .sort((a, b) => Date.parse(b.received_at) - Date.parse(a.received_at))
  return cand[0]?.wamid ?? null
}

/**
 * IO: if a trailing text has an in-flight photo job from the same sender, wait (bounded) for that job to reach
 * a terminal state, so the bill it stages exists before this text is routed. Best-effort — a crashed/slow
 * photo just times out and we proceed (never wedge the sender). Called PRE-LOCK so the photo can make progress.
 */
export async function waitForInflightPhoto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, sender: string, selfWamid: string,
  opts: { windowMs?: number; timeoutMs?: number; pollMs?: number } = {},
): Promise<void> {
  const windowMs = opts.windowMs ?? 20_000
  const timeoutMs = opts.timeoutMs ?? 10_000
  const pollMs = opts.pollMs ?? 500
  const { data: rows } = await supabase
    .from('processing_job')
    .select('wamid, message_type, status, received_at')
    .eq('sender_number', sender)
    .order('received_at', { ascending: false })
    .limit(10)
  const awaitWamid = pickPhotoToAwait((rows ?? []) as JobRow[], selfWamid, Date.now(), windowMs)
  if (!awaitWamid) return
  console.log('[media-race] text yielding to in-flight photo job', awaitWamid)
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollMs))
    const { data } = await supabase.from('processing_job').select('status').eq('wamid', awaitWamid).maybeSingle()
    const status = (data?.status ?? null) as string | null
    if (!status || TERMINAL.has(status)) {
      console.log('[media-race] photo job settled', awaitWamid, status ?? 'gone')
      return
    }
  }
  console.warn('[media-race] photo-yield timed out; proceeding', awaitWamid)
}

/** IO: is a photo job from this sender already in flight (so a just-held caption's photo is on its way)?
 *  Used to stay silent on the caption-hold ack when the photo is already coming. */
export async function hasInflightPhoto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, sender: string, selfWamid: string, windowMs = 20_000,
): Promise<boolean> {
  const { data } = await supabase
    .from('processing_job')
    .select('wamid, message_type, status, received_at')
    .eq('sender_number', sender)
    .order('received_at', { ascending: false })
    .limit(10)
  return pickPhotoToAwait((data ?? []) as JobRow[], selfWamid, Date.now(), windowMs) != null
}
