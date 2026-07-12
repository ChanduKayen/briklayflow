// T1 — SITEOPS OPEN-CONVO SWEEPER + the ONE park core (constitution clause 2: "Unanswered →
// park reason='project', FULL payload").
//
// Before this module, the park fired ONLY when a NEXT message interrupted an open pick
// (commitInterruptedSiteops); a question nobody ever answered was a PERMANENT OPEN conversation
// intercepting that sender's next message — the stale-OPEN bug, still live for SITEOPS because
// wa_commit_abandoned_conversations is TRANSACTION-gated (20260613000015:81). That SQL function
// stays UNTOUCHED (ruling 1): this TS sweep is invisible to TRANSACTION rows by selection.
//
// ONE INSERT SITE (Hazard 5): parkConvoObservation is the park core EXTRACTED from
// commitInterruptedSiteops — the interrupt path (thin wrapper in _agents/siteops.ts) and the
// sweeper both call it. The extraction also fixes two LIVE payload eats (rulings, pinned j4/j5):
//   · siteops_batch_collision parked NOTHING without a photo — the supervisor's piece_text was
//     discarded on interrupt (a floor violation live since collision shipped).
//   · unit-style siteops_project parked {items} only, dropping the raw `text` the unit-resume
//     replays from.
//
// ORDER: park FIRST, then abandon. If the abandon fails the convo stays OPEN and the next sweep
// re-parks (a duplicate row — visible, recoverable); the reverse order could close the convo with
// the observation lost (an eat). No-drop wins over idempotence.
//
// DRIVER: the siteops-reanalyze hourly tick, wrapped there so a sweep failure can never abort the
// harvest. TTL: SITEOPS_CONVO_TTL_HOURS (default 24) on opened_at — hours, not minutes, so a slow
// human reply survives (the 22-minute lesson cut both ways).

import { abandonConversation, type ConvoRow } from './_conversation.ts'
import { combineReadbacks, type HeldReadback } from './_siteops_readback.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

/** PURE: convo slots → the siteops_unplaced row to insert, or null = nothing recoverable (a pure
 *  enrichment window, or an answer-evidence pick with no photo and no observation) → close clean,
 *  never a phantom "to place" card. */
export function convoParkRow(convo: ConvoRow): Record<string, unknown> | null {
  const slots = (convo.slots_so_far ?? {}) as Record<string, unknown>
  const kind = typeof slots.kind === 'string' ? slots.kind : null

  // STEP 2 — a siteops_photo ENRICHMENT WINDOW carries NO unresolved work: its objects already exist
  // and were read back. Parking it would pollute the queue with a non-actionable card.
  if (kind === 'siteops_photo') return null

  const image = (slots.image ?? null) as { storagePath?: string; caption?: string | null } | null
  // Fresh-observation picks carry the item(s); answer-evidence picks carry only the photo. The typed
  // pick carries BOTH. Unit-style project slots keep the raw text (T1 fix — the unit-resume replays
  // it); a collision keeps the supervisor's piece_text + the offered candidates (T1 fix — this was
  // parked as NOTHING without a photo).
  const observation =
    kind === 'siteops_disambig' ? (slots.item ?? null)
    : kind === 'siteops_typed_pick' ? (slots.item ?? null)
    : kind === 'siteops_project' ? (Array.isArray(slots.messages) && slots.messages.length
        // Stage-2: the ask carries the group's grading MESSAGES (+ any un-drained pending groups) so the
        // replay can resume the whole set. Back-compat: an in-flight legacy convo carried {items,text}.
        ? { messages: slots.messages, ...(Array.isArray(slots.pending_groups) && slots.pending_groups.length ? { pending_groups: slots.pending_groups } : {}) }
        : (Array.isArray(slots.items) && slots.items.length
            ? { items: slots.items, ...(typeof slots.text === 'string' ? { text: slots.text } : {}) }
            : null))
    : kind === 'siteops_batch_collision' ? (typeof slots.piece_text === 'string' && slots.piece_text.trim()
        ? { piece_text: slots.piece_text, candidates: slots.candidates ?? null }
        : null)
    : null
  const objectPath = image?.storagePath ?? null
  if (observation == null && !objectPath) return null

  const reason = kind === 'siteops_disambig' ? 'disambig'
    : kind === 'siteops_typed_pick' ? 'typed_pick'
    : kind === 'siteops_project' ? 'project'
    : kind === 'siteops_photo_pick' ? 'photo_pick'
    : kind === 'siteops_batch_collision' ? 'batch_collision'
    : 'floor'
  return {
    org_id: convo.org_id,
    // project_id NOT null when known (the audit's two-site drop must not become three) — EXCEPT
    // siteops_project, whose slots carry no project_id because the project IS the open question.
    project_id: (slots.project_id as string | null) ?? null,
    reason,
    observation,
    candidates: slots.candidates ?? slots.shortlist ?? null,   // typed pick stores the shortlist — keep it to rank the later placement
    bucket: objectPath ? 'rough-entry-media' : null,
    object_path: objectPath,
    caption: image?.caption ?? (typeof slots.piece_text === 'string' ? slots.piece_text : null),
    narration_id: (slots.narration_id as string | null) ?? null,
    sender_number: convo.sender_number,
    created_by: null,
  }
}

export interface ParkOutcome { parked: boolean; objectPath: string | null }

/** THE park core — the ONE siteops_unplaced insert (Hazard 5), shared by the interrupt wrapper
 *  (commitInterruptedSiteops) and the sweeper. Row-only: everything it needs rides the convo row. */
export async function parkConvoObservation(supabase: SB, convo: ConvoRow): Promise<ParkOutcome> {
  const row = convoParkRow(convo)
  if (!row) return { parked: false, objectPath: null }
  const { data: ins, error } = await supabase.from('siteops_unplaced').insert(row).select('id').single()
  if (error) {
    console.error('[siteops:park] siteops_unplaced insert failed:', error.message)
    return { parked: false, objectPath: (row.object_path as string | null) ?? null }
  }
  // STEP 5b — stamp the parked row with the pick question's OUTBOUND wamid (the 4a map, keyed on this
  // convo) so a later quoted-reply to the question recovers the park. Best-effort: the map row may not
  // exist yet (fast interrupt before the drainer ran; at sweep time — 24h — it virtually always does)
  // and question_wamid may be unmigrated — neither may fail the park.
  if (ins?.id) {
    try {
      const { data: m } = await supabase.from('wa_message_map').select('outbound_wamid').eq('convo_id', convo.id).maybeSingle()
      if (m?.outbound_wamid) await supabase.from('siteops_unplaced').update({ question_wamid: m.outbound_wamid }).eq('id', ins.id)
    } catch (e) { console.warn('[siteops:park] question_wamid stamp skipped:', (e as Error).message) }
  }
  return { parked: true, objectPath: (row.object_path as string | null) ?? null }
}

export interface SweepResult { checked: number; parked: number; abandoned: number; failures: number }

/** Sweep stale OPEN SITEOPS conversations: older than TTL → park (same core) → ABANDONED (the
 *  interception dies; the sender's next message routes FRESH). Per-row failures log and continue —
 *  one bad convo must not strand its siblings, and the caller wraps the whole sweep so it can never
 *  abort the reanalyze harvest. TRANSACTION rows are invisible by selection (j3). */
export async function sweepStaleSiteopsConvos(
  supabase: SB, opts: { now?: Date; ttlHours?: number } = {},
): Promise<SweepResult> {
  const now = opts.now ?? new Date()
  const envTtl = Number(Deno.env.get('SITEOPS_CONVO_TTL_HOURS') ?? '24')
  const ttlHours = opts.ttlHours ?? (Number.isFinite(envTtl) && envTtl > 0 ? envTtl : 24)
  const cutoff = now.getTime() - ttlHours * 3_600_000
  const res: SweepResult = { checked: 0, parked: 0, abandoned: 0, failures: 0 }

  let stale: ConvoRow[] = []
  try {
    const { data } = await supabase.from('wa_conversations')
      .select('*').eq('owning_agent', 'SITEOPS').eq('status', 'OPEN')
    // age filter in JS: the OPEN SITEOPS set is tiny, and opened_at comparison stays engine-agnostic.
    stale = ((data ?? []) as ConvoRow[]).filter((c) => c.opened_at && new Date(c.opened_at).getTime() < cutoff)
  } catch (e) {
    console.error('[siteops:sweep] select failed:', (e as Error).message)
    return res
  }

  for (const c of stale) {
    res.checked++
    try {
      const out = await parkConvoObservation(supabase, c)
      if (out.parked) res.parked++
      await abandonConversation(supabase, c.org_id, c.sender_number)
      res.abandoned++
    } catch (e) {
      res.failures++
      console.error(`[siteops:sweep] convo ${c.id} failed (continuing):`, (e as Error).message)
    }
  }
  if (res.checked) console.log(`[siteops:sweep] ttl=${ttlHours}h checked=${res.checked} parked=${res.parked} abandoned=${res.abandoned} failures=${res.failures}`)
  return res
}

export interface HeldFlushResult { checked: number; flushed: number; parked: number; failures: number }

/** STEP C2a — the 2-MINUTE HELD-FLUSH. A batch that HELD its resolved summary behind a which_item ask (C1)
 *  and got no reply must not wait the 24h abandon sweep to hear "your other items landed". This flushes any
 *  OPEN siteops convo carrying a `held_readback` idle > idleMinutes: SEND what's SURE + NAME the pending as
 *  saved-for-review, PARK the pending item (replayable), and ABANDON the convo. A LONE ask (no held summary)
 *  is untouched — a bare question deserves the full 24h TTL, and the sweep owns it. NO SILENT DROP.
 *  `send` is injected (supabase-agnostic) so the flush is provable without the outbox/WA layer. */
export async function flushAbandonedHeldReadbacks(
  supabase: SB,
  send: (to: string, body: string, orgId: string) => Promise<void>,
  opts: { now?: Date; idleMinutes?: number } = {},
): Promise<HeldFlushResult> {
  const now = opts.now ?? new Date()
  const idleMin = opts.idleMinutes && opts.idleMinutes > 0 ? opts.idleMinutes : 2
  const cutoff = now.getTime() - idleMin * 60_000
  const res: HeldFlushResult = { checked: 0, flushed: 0, parked: 0, failures: 0 }

  let held: ConvoRow[] = []
  try {
    const { data } = await supabase.from('wa_conversations').select('*').eq('owning_agent', 'SITEOPS').eq('status', 'OPEN')
    held = ((data ?? []) as ConvoRow[]).filter((c) => {
      const h = (c.slots_so_far as { held_readback?: HeldReadback })?.held_readback
      return !!h?.entries?.length && !!c.opened_at && new Date(c.opened_at).getTime() < cutoff
    })
  } catch (e) {
    console.error('[siteops:held-flush] select failed:', (e as Error).message)
    return res
  }

  for (const c of held) {
    res.checked++
    try {
      const slots = (c.slots_so_far ?? {}) as { held_readback?: HeldReadback; piece_text?: string }
      const h = slots.held_readback as HeldReadback
      // the SURE items + a line NAMING the pending piece as saved-for-review (never a silent drop).
      const piece = typeof slots.piece_text === 'string' && slots.piece_text.trim() ? slots.piece_text.trim() : null
      const entries = [...h.entries, ...(piece ? [{ project: null, body: `⏳ still had a question on “${piece}” — saved it for review so it's not lost` }] : [])]
      await send(c.sender_number, combineReadbacks(entries), c.org_id)
      res.flushed++
      // park the pending item (the SAME core the interrupt + 24h sweep use), then abandon so it stops intercepting.
      const out = await parkConvoObservation(supabase, c)
      if (out.parked) res.parked++
      await abandonConversation(supabase, c.org_id, c.sender_number)
    } catch (e) {
      res.failures++
      console.error(`[siteops:held-flush] convo ${c.id} failed (continuing):`, (e as Error).message)
    }
  }
  if (res.checked) console.log(`[siteops:held-flush] idle=${idleMin}m checked=${res.checked} flushed=${res.flushed} parked=${res.parked} failures=${res.failures}`)
  return res
}
