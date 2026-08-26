// Site-ops write path — persist the Pass-1 skeleton into site_tasks.
//
// Reads a project's RESOLVED construction_stack (jsonb) + the sequence, expands, and writes.
// Two safety rails (the high-stakes part):
//   · empty-list-only — refuses to write if the project already has tasks, UNLESS the caller
//     passes replace:true (an explicit, opt-in regenerate).
//   · manual-preserving replace — a regenerate deletes ONLY source='generated' rows; every
//     source='manual' row a user hand-added survives untouched.
//
// The Supabase client is injected, so the same code runs from the app (browser client,
// RLS-scoped) or a service-role script. The sequence is injected too (Vite import in-app,
// fs in scripts) — this module never reaches for a file.

import { expand, type Sequence, type Stack, type GeneratedTask } from './expander'
import { withTaskNoRetry } from './taskInsert'

export interface ProjectRow {
  project_id: string
  org_id: string
  construction_stack: Stack | null
  has_common_areas: boolean
}

/** The columns we read from site_tasks to plan a regenerate. */
export interface ExistingTask { task_id: string; source: 'generated' | 'manual' }

/** A row ready to INSERT into site_tasks (task_no/status/status_history are DB defaults). */
export interface InsertRow {
  project_id: string
  org_id: string
  phase: string
  trade: string
  floor_label: string | null
  unit_label: string | null
  name: string
  seq_no: number
  source: 'generated'
}

export interface ReplacePlan {
  toDeleteIds: string[]   // generated task_ids to remove (manual NEVER included)
  toInsert: InsertRow[]   // fresh generated rows
  keptManual: number      // manual rows preserved
}

/**
 * PURE + the highest-stakes line in the write path: decide what a regenerate deletes and
 * inserts. Manual rows are NEVER in toDeleteIds — that invariant is what protects hand-typed
 * work. Kept separate from I/O so it's unit-testable in isolation.
 */
export function planReplaceAll(existing: ExistingTask[], fresh: InsertRow[]): ReplacePlan {
  const toDeleteIds = existing.filter((t) => t.source === 'generated').map((t) => t.task_id)
  const keptManual = existing.filter((t) => t.source === 'manual').length
  return { toDeleteIds, toInsert: fresh, keptManual }
}

/** Map the expander output to insert rows, stamping project_id + org_id. */
export function toInsertRows(project: ProjectRow, tasks: GeneratedTask[]): InsertRow[] {
  return tasks.map((t) => ({
    project_id: project.project_id,
    org_id: project.org_id,
    phase: t.phase,
    trade: t.trade,
    floor_label: t.floor_label,
    unit_label: t.unit_label,
    name: t.name,
    seq_no: t.seq_no,
    source: 'generated',
  }))
}

export interface GenerateResult { inserted: number; deleted: number; keptManual: number }

/**
 * Generate (or regenerate) a project's site_tasks from its stored construction_stack.
 * @param replace  must be true to overwrite an already-populated project (manual rows survive).
 */
export async function generateSiteTasks(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- accepts browser or service-role client
  supabase: any,
  projectId: string,
  sequence: Sequence,
  opts: { replace?: boolean } = {},
): Promise<GenerateResult> {
  // 1. load the seed
  const { data: project, error: pErr } = await supabase
    .from('projects')
    .select('project_id, org_id, construction_stack, has_common_areas')
    .eq('project_id', projectId)
    .single()
  if (pErr || !project) throw new Error(`project not found: ${projectId}${pErr ? ` (${pErr.message})` : ''}`)
  if (!project.construction_stack)
    throw new Error(`project ${projectId} has no construction_stack — configure the build type first`)

  // 2. expand the stored stack
  const tasks = expand(project.construction_stack as Stack, sequence, { has_common_areas: !!project.has_common_areas })
  const fresh = toInsertRows(project as ProjectRow, tasks)

  // 3. read existing tasks (to enforce empty-list-only + plan the manual-preserving replace)
  const { data: existing, error: eErr } = await supabase
    .from('site_tasks')
    .select('task_id, source')
    .eq('project_id', projectId)
  if (eErr) throw new Error(`load existing tasks: ${eErr.message}`)

  if ((existing?.length ?? 0) > 0 && !opts.replace)
    throw new Error(
      `project ${projectId} already has ${existing.length} task(s); pass { replace: true } to ` +
      `regenerate (source='manual' rows are preserved)`,
    )

  const plan = planReplaceAll((existing ?? []) as ExistingTask[], fresh)

  // 4. delete generated rows FIRST (manual preserved), then insert the fresh skeleton
  if (plan.toDeleteIds.length) {
    const { error } = await supabase.from('site_tasks').delete().in('task_id', plan.toDeleteIds)
    if (error) throw new Error(`delete generated rows: ${error.message}`)
  }
  if (plan.toInsert.length) {
    const { error } = await withTaskNoRetry(() => supabase.from('site_tasks').insert(plan.toInsert))
    if (error) throw new Error(`insert tasks: ${(error as { message?: string })?.message ?? error}`)
  }

  return { inserted: plan.toInsert.length, deleted: plan.toDeleteIds.length, keptManual: plan.keptManual }
}
