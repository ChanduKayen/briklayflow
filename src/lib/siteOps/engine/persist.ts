// MODULE 5 — PERSISTENCE & RECONCILIATION.
//
// Writes the concrete graph to site_tasks and — the high-stakes part — reconciles a
// re-instantiation against what's already there WITHOUT clobbering human work. Mirrors Block 0's
// manual-task preservation (generateTasks.planReplaceAll) and the owner auto/manual model, now
// applied to BOTH task existence and task ORDER:
//
//   · source='manual' rows (incl. classified user tasks)      → never deleted.
//   · order_source='manual' rows (a human dragged the order)  → seq_no never re-defaulted.
//   · order_source='auto' rows                                → seq_no re-derived from the topo.
//   · authored-auto rows whose node_key vanished from the graph (geometry shrank) → deleted.
//
// Human intent wins and STICKS. The reconcile planner is PURE (no I/O) so it's unit-testable; the
// write fn injects the Supabase client (browser RLS-scoped or service-role), like generateTasks.
//
// Requires the additive columns in migration 20260628000000 (node_key, task_type_id, zone_id,
// placement_source, order_source, needs_review, binding).

import type { ConcreteGraph, NodeId, TaskNode, Library } from './types'
import { buildAdjacency } from './instantiate'
import { isHardNature, LIBRARY } from './library'

// ── row shapes ───────────────────────────────────────────────────────────────
/** The subset of an existing site_tasks row reconciliation cares about. */
export interface ExistingRow {
  task_id: string
  node_key: string | null
  source: 'generated' | 'manual'
  order_source: 'auto' | 'manual'
  seq_no: number
  // THE ENGINE-AUTHORED FIELDS, as the row currently holds them. Reconcile compares these against what the
  // library says NOW and refreshes the ones that drifted (see toRefresh). Optional: a caller that has not
  // selected them simply gets no refresh, rather than a spurious one.
  binding?: BindingMeta[] | null
  name?: string | null
  trade?: string | null
  phase?: string | null
  trade_phase?: string | null
  system?: string | null
}

/** A row ready to INSERT (task_no/status are DB defaults). */
export interface PersistRow {
  project_id: string
  org_id: string
  node_key: string
  task_type_id: string
  phase: string
  trade: string
  floor_label: string | null
  unit_label: string | null
  zone_id: string | null
  name: string
  seq_no: number
  source: 'generated' | 'manual'
  placement_source: 'authored' | 'classified'
  order_source: 'auto'
  needs_review: boolean
  binding: BindingMeta[]
  /** The amenity system this row belongs to (null for core building work). Lets the task list and the
   *  amenities view group the SAME rows by system without a second task tree. */
  system: string | null
  /** The trade pass ('2nd fix'). Split OUT of `name` so the list reads clean; the resolver re-attaches
   *  it, because "second fix is done" must still land on the right row. NOT `phase` — that column holds
   *  the layer (structure/services/finishes). */
  trade_phase: string | null
}

/** Immediate hard predecessor metadata, persisted so `why` renders without recomputing the graph. */
export interface BindingMeta { node_key: string; task_type_id: string; nature: string; reason: string }

// ── graph → insert rows ──────────────────────────────────────────────────────
export function toPersistRows(
  graph: ConcreteGraph,
  project: { project_id: string; org_id: string },
): PersistRow[] {
  const { preds } = buildAdjacency(graph)
  const rows: PersistRow[] = []
  for (const n of graph.nodes.values()) {
    const binding: BindingMeta[] = (preds.get(n.id) ?? [])
      .filter((e) => isHardNature(e.nature, e.reason))
      .map((e) => ({
        node_key: e.from,
        task_type_id: graph.nodes.get(e.from)!.taskTypeId,
        nature: e.nature, reason: e.reason,
      }))
    rows.push({
      project_id: project.project_id,
      org_id: project.org_id,
      node_key: n.id,
      task_type_id: n.taskTypeId,
      phase: n.layer,                  // layer doubles as the coarse phase grouping
      trade: n.trade,
      floor_label: n.floorLabel,
      unit_label: n.unitLabel,
      zone_id: n.zoneId,
      name: n.label,
      seq_no: n.seqNo,
      source: n.source,                // 'generated' for authored, 'manual' for classified user tasks
      placement_source: n.placementSource,
      order_source: 'auto',
      needs_review: !!n.needsReview,
      binding,
      system: n.system ?? null,
      trade_phase: n.phase ?? null,
    })
  }
  return rows.sort((a, b) => a.seq_no - b.seq_no)
}

// ── the reconciliation planner (PURE — the invariant that protects human work) ─
export interface ReconcilePlan {
  toInsert: PersistRow[]                       // fresh nodes not already present
  toUpdateSeq: { task_id: string; seq_no: number }[]  // auto rows whose seq the topo changed
  toDeleteIds: string[]                        // obsolete authored-auto rows (manual NEVER included)
  /**
   * THE ROWS TRACK THE LIBRARY (2026-07-13). Engine-authored fields on an EXISTING row that no longer say
   * what the library says. `binding` is the one that bites: it holds a row's hard predecessors, and it is
   * the only thing the desk reads to decide whether a task can start (fromDb takes binding[0]; derive.ts
   * calls a task with no predecessor "Ready - can start now").
   *
   * It was written at INSERT and never again. So when fifteen task types that could start on bare ground
   * were corrected, every project that already existed would have gone on offering the facade of a building
   * with no columns: the fix, invisible in the one place a human looks. A row is not a snapshot of what the
   * library said the day it was born. It is a projection of what the library says NOW.
   *
   * The HUMAN's fields are not in here and never will be: status, owner, task_no, a hand-dragged seq_no, a
   * manual row. A refresh that quietly reset someone's progress would be far worse than the bug it fixes.
   */
  toRefresh: { task_id: string; patch: RefreshPatch }[]
  keptManual: number                           // source='manual' rows preserved untouched
  keptManualOrder: number                      // order_source='manual' rows whose seq we did NOT touch
}

/** Exactly the columns the ENGINE owns on a generated row. Nothing else may ever appear here. */
export interface RefreshPatch {
  binding?: BindingMeta[]
  name?: string
  trade?: string
  phase?: string
  trade_phase?: string | null
  system?: string | null
}

export function reconcile(existing: ExistingRow[], fresh: PersistRow[]): ReconcilePlan {
  const existingByKey = new Map<string, ExistingRow>()
  for (const r of existing) if (r.node_key) existingByKey.set(r.node_key, r)
  const freshByKey = new Map<string, PersistRow>()
  for (const r of fresh) freshByKey.set(r.node_key, r)

  const toInsert: PersistRow[] = []
  const toUpdateSeq: { task_id: string; seq_no: number }[] = []
  const toRefresh: { task_id: string; patch: RefreshPatch }[] = []
  let keptManualOrder = 0

  // Has an engine-authored field drifted from what the library now says? `binding` compares by VALUE: its
  // order is the graph's, and a re-ordered dependency list is the same dependency list.
  const bindingKey = (b: BindingMeta[] | null | undefined): string =>
    JSON.stringify([...(b ?? [])].map((x) => [x.node_key, x.nature, x.reason]).sort())

  for (const row of fresh) {
    const prior = existingByKey.get(row.node_key)
    if (!prior) { toInsert.push(row); continue }

    // THE ENGINE'S OWN FIELDS, refreshed when (and only when) they differ. A MANUAL row is never touched:
    // the engine does not own a human's task, whatever key it happens to carry.
    if (prior.source !== 'manual') {
      const patch: RefreshPatch = {}
      if (prior.binding !== undefined && bindingKey(prior.binding) !== bindingKey(row.binding)) patch.binding = row.binding
      if (prior.name !== undefined && prior.name !== row.name) patch.name = row.name
      if (prior.trade !== undefined && prior.trade !== row.trade) patch.trade = row.trade
      if (prior.phase !== undefined && prior.phase !== row.phase) patch.phase = row.phase
      if (prior.trade_phase !== undefined && (prior.trade_phase ?? null) !== (row.trade_phase ?? null)) patch.trade_phase = row.trade_phase
      if (prior.system !== undefined && (prior.system ?? null) !== (row.system ?? null)) patch.system = row.system
      if (Object.keys(patch).length) toRefresh.push({ task_id: prior.task_id, patch })
    }
    if (prior.order_source === 'manual') {
      // a human dragged this — its seq is sticky; the engine must not re-default it.
      keptManualOrder++
      continue
    }
    if (prior.seq_no !== row.seq_no) toUpdateSeq.push({ task_id: prior.task_id, seq_no: row.seq_no })
  }

  // obsolete rows: present before, gone from the graph now. Delete ONLY authored-auto generated
  // rows. Manual rows (incl. classified user tasks) and human-reordered rows survive.
  const toDeleteIds: string[] = []
  let keptManual = 0
  for (const row of existing) {
    if (row.source === 'manual') { keptManual++; continue }       // user task — never delete
    if (!row.node_key) { keptManual++; continue }                 // hand-typed legacy row, no engine identity — leave it
    if (freshByKey.has(row.node_key)) continue                     // still in the graph
    if (row.order_source === 'manual') { keptManualOrder++; continue } // human touched it — keep
    toDeleteIds.push(row.task_id)                                  // authored-auto + obsolete → delete
  }

  return { toInsert, toUpdateSeq, toDeleteIds, toRefresh, keptManual, keptManualOrder }
}

// ── integration write (injected client; RLS-scoped) ──────────────────────────
export interface WriteResult { inserted: number; updated: number; refreshed: number; deleted: number; keptManual: number; keptManualOrder: number; qcInserted: number }

/** One authored QC check, fanned out onto a task instance (which owns the answer slot). */
export interface QcInsertRow { task_id: string; org_id: string; question: string; is_critical: boolean; seq: number }

/**
 * Persist (or re-reconcile) a project's site_tasks from an already-instantiated graph.
 * The Supabase client is injected, so this runs from the app (browser, RLS) or a service-role
 * script unchanged. All reads/writes are project-scoped; org RLS does the rest.
 */
export async function persistGraph(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts browser or service-role client
  supabase: any,
  project: { project_id: string; org_id: string },
  graph: ConcreteGraph,
): Promise<WriteResult> {
  const fresh = toPersistRows(graph, project)

  const { data: existing, error: eErr } = await supabase
    .from('site_tasks')
    .select('task_id, node_key, source, order_source, seq_no, binding, name, trade, phase, trade_phase, system')
    .eq('project_id', project.project_id)
  if (eErr) throw new Error(`load existing tasks: ${eErr.message}`)

  const plan = reconcile((existing ?? []) as ExistingRow[], fresh)

  if (plan.toDeleteIds.length) {
    const { error } = await supabase.from('site_tasks').delete().in('task_id', plan.toDeleteIds)
    if (error) throw new Error(`delete obsolete authored rows: ${error.message}`)
  }
  if (plan.toInsert.length) {
    const { error } = await supabase.from('site_tasks').insert(plan.toInsert)
    if (error) throw new Error(`insert tasks: ${error.message}`)
  }
  // seq updates one-by-one (small N; keeps each update RLS-checked and auditable)
  for (const u of plan.toUpdateSeq) {
    const { error } = await supabase.from('site_tasks').update({ seq_no: u.seq_no }).eq('task_id', u.task_id)
    if (error) throw new Error(`update seq_no for ${u.task_id}: ${error.message}`)
  }
  // ...and the engine-authored fields the library has since changed (ReconcilePlan.toRefresh). Without this
  // a library change reaches NEW rows only, and every project that already exists keeps the old plan forever.
  for (const u of plan.toRefresh) {
    const { error } = await supabase.from('site_tasks').update(u.patch).eq('task_id', u.task_id)
    if (error) throw new Error(`refresh authored fields for ${u.task_id}: ${error.message}`)
  }

  const qcInserted = await fanOutQc(supabase, project)

  return {
    inserted: plan.toInsert.length,
    updated: plan.toUpdateSeq.length,
    refreshed: plan.toRefresh.length,
    deleted: plan.toDeleteIds.length,
    keptManual: plan.keptManual,
    keptManualOrder: plan.keptManualOrder,
    qcInserted,
  }
}

/**
 * QC FAN-OUT — every task in the project ends up holding its TYPE's authored checks.
 *
 * This is the door QC coverage hangs off, and it is deliberately the SAME door that creates tasks: the
 * setup wizard, the Sequence view and the WhatsApp materializer all reach persistGraph, so there is no
 * path that can produce a task without its checks. (The old design generated QC from a browser page-visit,
 * so a task's checks existed only if a human happened to open the right page at the right moment — and
 * anything created afterwards had none, forever.)
 *
 * TOP-UP, NEVER REPLACE. It inserts checks only for tasks that hold NONE. It never deletes and never
 * rewrites, so a check a supervisor has already ANSWERED — its `answer`, `qc_status`, `answered_at` and
 * the `source_narration_id` linking it to the WhatsApp message that confirmed it — can't be destroyed by
 * a re-run. That also makes this its own backfill: run it over an old project and the missing checks
 * appear, the answered ones stay exactly as they were.
 *
 * A user-classified task (task_type_id `user_*`) has no authored type, so it gets no checks. That is an
 * honest gap, not a silent one: it claims no QC rather than inventing some.
 */
export async function fanOutQc(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- browser or service-role client
  supabase: any,
  project: { project_id: string; org_id: string },
  lib: Library = LIBRARY,
): Promise<number> {
  // ONE read, with the QC EMBEDDED. Reading the two tables separately meant filtering the QC by
  // `.in('task_id', [...])` over every task in the project — several hundred uuids in a GET query string,
  // a URL long enough to be rejected in front of the database. The embed asks the same question in one
  // round trip and one short URL, and this runs on every WhatsApp turn.
  const { data: tasks, error: tErr } = await supabase
    .from('site_tasks')
    .select('task_id, task_type_id, site_task_qc(task_id)')
    .eq('project_id', project.project_id)
  if (tErr) throw new Error(`load tasks for QC fan-out: ${tErr.message}`)

  const rows = (tasks ?? []) as { task_id: string; task_type_id: string | null; site_task_qc?: unknown[] }[]
  if (!rows.length) return 0

  const hasQc = new Set(rows.filter((r) => (r.site_task_qc?.length ?? 0) > 0).map((r) => r.task_id))

  const toInsert: QcInsertRow[] = []
  for (const t of rows) {
    if (hasQc.has(t.task_id)) continue                       // already holds checks — never touched
    const type = t.task_type_id ? lib.taskTypes.get(t.task_type_id) : undefined
    for (const [i, q] of (type?.qc ?? []).entries()) {
      toInsert.push({
        task_id: t.task_id, org_id: project.org_id,
        question: q.question, is_critical: q.is_critical, seq: i + 1,
      })
    }
  }
  if (!toInsert.length) return 0

  const { error } = await supabase.from('site_task_qc').insert(toInsert)
  if (error) throw new Error(`insert QC: ${error.message}`)
  return toInsert.length
}

/** Build a CompletionState-free helper for callers that only have row statuses (UI bridge). */
export function nodeKeyOf(node: TaskNode): NodeId { return node.id }
