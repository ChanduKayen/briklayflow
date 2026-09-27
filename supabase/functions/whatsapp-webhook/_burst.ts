// WhatsApp message COALESCING (debounce). People split one thought across several quick bubbles —
// a forwarded materials list then "need iron for shyam site"; "Ramu 5000" then "cash". Each bubble is
// its own webhook POST, so without this they route independently (two PRs for one order, a duplicate
// "Got it" ack, a fragment grabbed as a pending answer — 2026-09-25).
//
// The rule: every inbound text lands in wa_burst_messages, then the webhook waits a short QUIET window.
// Only the LAST bubble of the burst drains the whole set and routes the COMBINED text once; every earlier
// bubble sees a newer sibling and drops silently. The array-returning extractors (extractTransactions,
// extractProcurements, siteops decompose) still split a genuine multi-order back into N — coalescing only
// reunites one thought, it never merges two real transactions.

/** How long to wait for the next bubble before deciding the burst is complete. Tunable; a couple of
 *  seconds too short misses a slow typist, too long feels laggy (the typing indicator covers the wait). */
export const BURST_QUIET_MS = Number(Deno.env.get('WA_BURST_QUIET_MS') ?? '5000')

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Record this bubble; returns its burst sequence id (bigserial). */
export async function recordBurst(
  supabase: any,
  p: { orgId: string; sender: string; wamid: string; body: string },
): Promise<number | null> {
  const { data, error } = await supabase.from('wa_burst_messages')
    .insert({ org_id: p.orgId, sender: p.sender, wamid: p.wamid, body: p.body })
    .select('id').single()
  if (error) { console.error('[burst] record failed:', error.message); return null }
  return (data?.id as number) ?? null
}

/** True when a NEWER unconsumed bubble from this sender exists — i.e. THIS bubble is not the last of the
 *  burst, so its job should drop and let the newer one drain the whole set. */
export async function hasNewerBurst(supabase: any, sender: string, seq: number): Promise<boolean> {
  const { data, error } = await supabase.from('wa_burst_messages')
    .select('id')
    .eq('sender', sender).is('consumed_at', null).gt('id', seq)
    .limit(1)
  if (error) { console.error('[burst] hasNewer failed (treating as last):', error.message); return false }
  return Array.isArray(data) && data.length > 0
}

/** Join claimed bubbles into one input, oldest first (wa_drain_burst's RETURNING is unordered). Pure. */
export function combineBurstBodies(rows: { id: number; body: string }[]): string {
  return [...rows].sort((a, b) => a.id - b.id).map((r) => (r.body ?? '').trim()).filter(Boolean).join('\n')
}

/** Atomically claim every unconsumed bubble for this sender and return their bodies joined in arrival
 *  order (one per line). Empty string when another job already drained them. */
export async function drainBurst(supabase: any, sender: string): Promise<string> {
  const { data, error } = await supabase.rpc('wa_drain_burst', { p_sender: sender })
  if (error) { console.error('[burst] drain failed:', error.message); return '' }
  return combineBurstBodies((Array.isArray(data) ? data : []) as { id: number; body: string }[])
}

/**
 * Debounce one inbound text against the sender's burst.
 *  - records the bubble, waits BURST_QUIET_MS,
 *  - if a newer bubble arrived → returns { proceed:false } (this job drops; the newer one handles it),
 *  - else drains the whole burst → returns { proceed:true, text: <combined> } to route ONCE.
 * A drain that comes back empty (a sibling already took it) also returns proceed:false.
 */
export async function coalesceBurst(
  supabase: any,
  p: { orgId: string; sender: string; wamid: string; body: string },
  opts: { quietMs?: number } = {},
): Promise<{ proceed: boolean; text?: string }> {
  const seq = await recordBurst(supabase, p)
  if (seq == null) return { proceed: true, text: p.body }   // buffer unavailable → never drop the message

  await sleep(opts.quietMs ?? BURST_QUIET_MS)

  if (await hasNewerBurst(supabase, p.sender, seq)) return { proceed: false }

  const combined = await drainBurst(supabase, p.sender)
  if (!combined) return { proceed: false }                  // a racing sibling drained it first
  return { proceed: true, text: combined }
}

// ── PHOTO batch (debounce a burst of images the same way text bubbles are debounced) ──────────────────────
// WhatsApp sends several photos taken together as separate POSTs. Unlike text, we CANNOT combine their
// content (each image needs its own vision read), so we don't drain — every photo stages its own items. What
// we coalesce is the NOISE: the "Got your photo…" ack (once, not per photo) and the confirmation card (one per
// request, sent by the LAST photo of the burst). A photo's row is tagged with the request it landed in (pr_id)
// so a two-vendor batch still gets a card each.

/** How long the last photo waits for a straggler before it decides the burst is done and speaks. */
export const PHOTO_QUIET_MS  = Number(Deno.env.get('WA_PHOTO_QUIET_MS')  ?? '4000')
/** Only photos within this window count as the same burst (matches the proc fold window). */
export const PHOTO_WINDOW_MS = Number(Deno.env.get('WA_PHOTO_WINDOW_MS') ?? '90000')

const photoSince = () => new Date(Date.now() - PHOTO_WINDOW_MS).toISOString()

/** Record this photo; returns its burst sequence id (bigint identity), or null if the buffer is unavailable. */
export async function recordPhoto(
  supabase: any, p: { orgId: string; sender: string; wamid: string },
): Promise<number | null> {
  const { data, error } = await supabase.from('wa_photo_batch')
    .insert({ org_id: p.orgId, sender: p.sender, wamid: p.wamid })
    .select('id').single()
  if (error) { console.error('[photo] record failed:', error.message); return null }
  return (data?.id as number) ?? null
}

/** Tag a photo's row with the request its items landed in, so the finalizer confirms once per request. */
export async function setPhotoPr(supabase: any, wamid: string, prId: string): Promise<void> {
  const { error } = await supabase.from('wa_photo_batch').update({ pr_id: prId }).eq('wamid', wamid)
  if (error) console.error('[photo] setPr failed (non-fatal):', error.message)
}

/** True when an EARLIER unconsumed photo from this sender exists in the window — i.e. THIS is not the first
 *  photo of the burst, so it must NOT ack (the first one already did). */
export async function hasEarlierPhoto(supabase: any, sender: string, seq: number): Promise<boolean> {
  const { data, error } = await supabase.from('wa_photo_batch')
    .select('id').eq('sender', sender).is('consumed_at', null).lt('id', seq).gte('created_at', photoSince()).limit(1)
  if (error) { console.error('[photo] hasEarlier failed (treating as first):', error.message); return false }
  return Array.isArray(data) && data.length > 0
}

/** True when a NEWER unconsumed photo from this sender exists — i.e. THIS photo is not the last of the burst,
 *  so a later one will finalize and speak. */
export async function hasNewerPhoto(supabase: any, sender: string, seq: number): Promise<boolean> {
  const { data, error } = await supabase.from('wa_photo_batch')
    .select('id').eq('sender', sender).is('consumed_at', null).gt('id', seq).gte('created_at', photoSince()).limit(1)
  if (error) { console.error('[photo] hasNewer failed (treating as last):', error.message); return false }
  return Array.isArray(data) && data.length > 0
}

/** Atomically CLAIM every unconsumed photo for this sender (set consumed_at) and return the DISTINCT request
 *  ids they staged, in arrival order. Row locks settle two racing finalizers — each row is claimed once, so a
 *  request is confirmed exactly once. Empty when a sibling already claimed them. */
export async function finalizePhotoBatch(supabase: any, sender: string): Promise<string[]> {
  const { data, error } = await supabase.from('wa_photo_batch')
    .update({ consumed_at: new Date().toISOString() })
    .eq('sender', sender).is('consumed_at', null).gte('created_at', photoSince())
    .select('id, pr_id')
  if (error) { console.error('[photo] finalize failed:', error.message); return [] }
  const rows = (Array.isArray(data) ? data : []) as { id: number; pr_id: string | null }[]
  const seen = new Set<string>()
  const out: string[] = []
  for (const r of [...rows].sort((a, b) => a.id - b.id)) {
    if (r.pr_id && !seen.has(r.pr_id)) { seen.add(r.pr_id); out.push(r.pr_id) }
  }
  return out
}
