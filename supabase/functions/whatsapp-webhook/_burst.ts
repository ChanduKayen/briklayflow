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
