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
    })
  }
  return rows.sort((a, b) => a.seq_no - b.seq_no)
}

// ── the reconciliation planner (PURE — the invariant that protects human work) ─
export interface ReconcilePlan {
  toInsert: PersistRow[]                       // fresh nodes not already present
  toUpdateSeq: { task_id: string; seq_no: number }[]  // auto rows whose seq the topo changed
  toDeleteIds: string[]                        // obsolete authored-auto rows (manual NEVER included)
  keptManual: number                           // source='manual' rows preserved untouched
  keptManualOrder: number                      // order_source='manual' rows whose seq we did NOT touch
}

export function reconcile(existing: ExistingRow[], fresh: PersistRow[]): ReconcilePlan {
  const existingByKey = new Map<string, ExistingRow>()
  for (const r of existing) if (r.node_key) existingByKey.set(r.node_key, r)
  const freshByKey = new Map<string, PersistRow>()
  for (const r of fresh) freshByKey.set(r.node_key, r)

  const toInsert: PersistRow[] = []
  const toUpdateSeq: { task_id: string; seq_no: number }[] = []
  let keptManualOrder = 0

  for (const row of fresh) {
    const prior = existingByKey.get(row.node_key)
    if (!prior) { toInsert.push(row); continue }
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

  return { toInsert, toUpdateSeq, toDeleteIds, keptManual, keptManualOrder }
}

// ── integration write (injected client; RLS-scoped) ──────────────────────────
export interface WriteResult { inserted: number; updated: number; deleted: number; keptManual: number; keptManualOrder: number; qcInserted: number }

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
    .select('task_id, node_key, source, order_source, seq_no')
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

  const qcInserted = await fanOutQc(supabase, project)

  return {
    inserted: plan.toInsert.length,
    updated: plan.toUpdateSeq.length,
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
