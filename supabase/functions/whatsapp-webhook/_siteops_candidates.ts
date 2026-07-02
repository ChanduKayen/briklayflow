// Block A / STEP 1 — the GROUNDED candidate set for image analysis.
//
// One place that assembles what an inbound site photo could plausibly be ABOUT, so the vision pass
// reads the image IN CONTEXT (grounded) instead of blind. The set spans every OPEN thing on the
// resolved project — tasks, issues (problems), snags (todos) — PLUS the sender's pending chase items
// THAT BELONG TO THIS PROJECT (we must never drop the thing we just asked about; but a chase on a
// DIFFERENT site is not this photo's context — the batch is sender-scoped, so we scope it here).
//
//   • CHASE PRECEDENCE — chased items rank TOP of the set (a strong prior, not a lock). They are
//     never dropped by the lexical narrowing or the cap. Consuming the chase is decided LATER
//     (handleBatchReply, post-vision): if the photo attaches elsewhere, the chase STAYS OPEN.
//   • WIDEN-ON-EMPTY — the lexical narrowing (floor/trade off the caption hint) only ever narrows on
//     a real signal, and any empty narrowing falls back to the full set. The filter must NEVER
//     silently exclude the right answer — same rule the resolver's prefilterTasks follows.
//
// Consumed in STEP 1 as GROUNDING HINTS for decomposeImage; Steps 3-4 reuse the same set for the
// ATTACH axis (a re-photo of a known issue) and the readback list. prefilter/labels are PURE
// (unit-tested); loadCandidates does read-only DB fetches and degrades to what it has on any error
// — grounding is a bonus, never a blocker (capture-first).

import { floorFromHint, unitFromHint, tradeGroups } from './_siteops_route.ts'
import type { BatchItem } from './_siteops_batch.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

export type CandidateKind = 'task' | 'issue' | 'todo'
export interface Candidate {
  kind: CandidateKind
  id: string                 // task_id / problem id / todo id
  node_key: string | null    // engine identity (tasks only; null for issues/todos)
  label: string              // short human label — grounding hint + readback row
  floor: string | null       // tasks carry floor/unit; issues/todos don't (null ⇒ never floor-excluded)
  unit: string | null
  tradeText: string          // free text fed to tradeGroups() for lexical trade matching
  chased: boolean            // in an open chase batch → precedence (top, never dropped)
}

/**
 * Load the full candidate set for a resolved project: OPEN tasks + OPEN issues + OPEN todos, with the
 * sender's pending chase items on TOP (precedence) and de-duplicated against them. Read-only; on any
 * query error the partial set is returned (grounding never blocks capture).
 */
export async function loadCandidates(
  supabase: SB, orgId: string, projectId: string, chaseItems: BatchItem[] = [],
): Promise<Candidate[]> {
  const out: Candidate[] = []
  // FIX Y — the chase batch is SENDER-scoped, not project-scoped (getOpenBatch keys on org+sender only),
  // so it spans every site the sender has an open chase on. Only chases ON THIS project belong in THIS
  // project's grounding — a cross-project (or unknown-project) chase is noise that would pull the vision
  // read toward the wrong work. Scope the precedence set to the grounded project.
  const scopedChase = chaseItems.filter((c) => c.projectId === projectId)
  const chasedIds = new Set(scopedChase.map((c) => c.id))

  // CHASE first — the thing we asked about ranks top of the set (a strong prior, not a lock).
  for (const c of scopedChase) {
    out.push({
      kind: c.kind === 'issue' ? 'issue' : 'todo', id: c.id, node_key: null,
      label: c.title, floor: null, unit: null, tradeText: `${c.title} ${c.taskName ?? ''}`, chased: true,
    })
  }

  try {
    const [tasksRes, problemsRes, todosRes] = await Promise.all([
      // OPEN tasks — closed ('done') excluded. project_id-scoped, mirroring finishRoute's load.
      supabase.from('site_tasks')
        .select('task_id, name, trade, floor_label, unit_label, status, node_key')
        .eq('project_id', projectId).neq('status', 'done'),
      // OPEN issues — anything not RESOLVED (OPEN + ADDRESSING).
      supabase.from('problems')
        .select('id, title, cause, status')
        .eq('org_id', orgId).eq('project_id', projectId).neq('status', 'RESOLVED'),
      // OPEN snags (DB-honest: todos).
      supabase.from('todos')
        .select('id, text, status')
        .eq('org_id', orgId).eq('project_id', projectId).eq('status', 'OPEN'),
    ])
    for (const t of (tasksRes?.data ?? []) as Record<string, string | null>[]) {
      if (t.task_id && !chasedIds.has(t.task_id)) out.push({
        kind: 'task', id: t.task_id, node_key: t.node_key ?? null,
        label: [t.floor_label ?? 'site-wide', t.name].filter(Boolean).join(' · '),
        floor: t.floor_label ?? null, unit: t.unit_label ?? null,
        tradeText: `${t.name ?? ''} ${t.trade ?? ''}`, chased: false,
      })
    }
    for (const p of (problemsRes?.data ?? []) as Record<string, string | null>[]) {
      if (p.id && !chasedIds.has(p.id)) out.push({
        kind: 'issue', id: p.id, node_key: null, label: p.title ?? '',
        floor: null, unit: null, tradeText: `${p.title ?? ''} ${p.cause ?? ''}`, chased: false,
      })
    }
    for (const d of (todosRes?.data ?? []) as Record<string, string | null>[]) {
      if (d.id && !chasedIds.has(d.id)) out.push({
        kind: 'todo', id: d.id, node_key: null, label: d.text ?? '',
        floor: null, unit: null, tradeText: d.text ?? '', chased: false,
      })
    }
  } catch (e) {
    console.error('[siteops:candidates] load failed (grounding degraded):', (e as Error).message)
  }
  return out
}

/**
 * Narrow the set to a short, relevant shortlist using the SAME lexical floor/trade signal the resolver
 * uses (floorFromHint/unitFromHint/tradeGroups off the caption hint). PURE. Rules:
 *   • chased items ALWAYS survive (precedence) and are never counted against the cap.
 *   • only narrows on a real floor/trade signal; issues/todos (floor null) are never floor-excluded.
 *   • WIDEN-ON-EMPTY: a signal that matches nothing anywhere falls back to the full set.
 */
export function prefilterCandidates(cands: Candidate[], hint: string | null, cap = 12): Candidate[] {
  const chased = cands.filter((c) => c.chased)
  const rest = cands.filter((c) => !c.chased)

  const floor = floorFromHint(hint)
  const unit = unitFromHint(hint)
  const trades = tradeGroups(hint)

  let narrowed = rest
  if (floor || trades.length) {
    const floorOk = (c: Candidate) => !floor || c.floor === null || c.floor === floor
    const unitOk = (c: Candidate) => !unit || c.unit === null || c.unit === unit
    const tradeOk = (c: Candidate) => trades.length === 0 || tradeGroups(c.tradeText).some((g) => trades.includes(g))
    const tiers = [
      rest.filter((c) => floorOk(c) && unitOk(c) && tradeOk(c)),   // tightest
      rest.filter((c) => floorOk(c) && tradeOk(c)),                // relax unit
      floor ? rest.filter((c) => floorOk(c)) : [],                 // floor alone
      trades.length ? rest.filter((c) => tradeOk(c)) : [],         // trade alone
    ]
    narrowed = tiers.find((t) => t.length > 0) ?? rest             // WIDEN-ON-EMPTY: never exclude the answer
  }

  // chase on top, then the narrowed rest; the cap never drops a chased item.
  return [...chased, ...narrowed.slice(0, Math.max(0, cap - chased.length))]
}

/** Render the shortlist as grounding lines for the vision prompt (chased flagged, kind tagged). */
export function groundingLabels(cands: Candidate[]): string[] {
  return cands
    .filter((c) => c.label.trim())
    .map((c) => `${c.chased ? '(awaiting your reply) ' : ''}${c.label} [${c.kind}]`)
}
