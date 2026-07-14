// MODULE 0b — THE PROJECT DOOR. A project row → the geometry it describes. One function, every caller.
//
// The graph is a pure function of the `projects` row: the stack, the amenities and where their plant
// stands, and the tasks a human has marked not-applicable. Five call sites derived it, and each one
// hand-assembled the same bag out of the same columns — the UI's Sequence view, the generate function, the
// webhook's VM, the webhook's persist, and the wizard. Four of them agreed.
//
// The fifth was the WIZARD — the one that actually WRITES the rows — and it left `suppressedTasks` out. So
// a task suppressed in the Sequence view came BACK the moment someone edited the construction config, and
// went away again on the next WhatsApp message that reconciled the project. A row flickering in and out of
// existence depending on which screen you last touched, and no single place to look for why.
//
// This is the second time this exact shape has been paid for. `hasExternalWorks` used to be wired to
// `has_common_areas` at every one of those five sites, so a project that ticked no amenities silently had no
// façade, no façade paint and no site development. The fix was to paste a corrective COMMENT into all five.
// A comment is not a mechanism, and here is the mechanism: there is now nothing to remember, because there
// is nothing for a caller to assemble.
//
// hasExternalWorks is ABSENT from the bag on purpose — it defaults true. Every building has an outside.

import type { BuildingGeometry } from './types'
import { stackToGeometry } from './instantiate'

/** The `projects` columns the graph is derived from. Select these and nothing else is needed. */
export const GEOMETRY_COLUMNS = 'construction_stack, has_common_areas, common_systems, suppressed_tasks, suppressed_nodes, amenity_levels'

/** A `projects` row, as the engine reads it. Every field optional: an un-applied migration, a partial
 *  select or a legacy row must degrade to a sane default, never throw and never silently drop a floor. */
export interface ProjectRow {
  construction_stack?: unknown
  has_common_areas?: boolean | null
  common_systems?: string[] | null
  /** system id → the floor its plant stands on (projects.amenity_levels). */
  amenity_levels?: Record<string, string> | null
  suppressed_tasks?: string[] | null
  /** node_keys a human DELETED from this project's plan. One task, not a whole type. */
  suppressed_nodes?: string[] | null
}

/** The engine's option bag for this project. The ONLY place these columns become engine options. */
export function geometryOptionsOf(p: ProjectRow | null | undefined): {
  hasCommonAreas: boolean
  commonSystems: string[]
  sitedLevels: Record<string, string>
  suppressedTasks: string[]
  suppressedNodes: string[]
} {
  return {
    hasCommonAreas: !!p?.has_common_areas,
    commonSystems: p?.common_systems ?? [],
    sitedLevels: p?.amenity_levels ?? {},
    suppressedTasks: p?.suppressed_tasks ?? [],
    suppressedNodes: p?.suppressed_nodes ?? [],
  }
}

/** The project's geometry. `null` when the project has no stack — it cannot be planned yet, and that is a
 *  fact the caller must handle (generate nothing / say so), never a reason to invent an empty building. */
export function geometryOf(p: ProjectRow | null | undefined): BuildingGeometry | null {
  // The stack's type is taken FROM the function that consumes it — it is declared privately (and, today,
  // differently) inside instantiate.ts and viewModel.ts, and this must not become a third copy.
  const stack = p?.construction_stack as Parameters<typeof stackToGeometry>[0] | undefined | null
  if (!stack) return null
  return stackToGeometry(stack, geometryOptionsOf(p))
}

/** What a caller gets back: the geometry columns, plus the two identity fields every caller also wants. */
export type LoadedProject = ProjectRow & { org_id?: string | null; name?: string | null }

/**
 * READ the project, the one way. The client is injected (browser-RLS or service-role), exactly as
 * persistGraph takes one — the engine stays framework-free and both runtimes share this door.
 *
 * The DEGRADED SELECT is why this is a function and not a constant. `common_systems`, `suppressed_tasks`
 * and `amenity_levels` arrived in later migrations, and this codebase applies migrations by hand — so on a
 * database where one has not landed yet, naming it makes PostgREST reject the WHOLE select (42703) and the
 * project reads back as NULL. Every caller that touched these columns had therefore grown its own private
 * fallback, or had forgotten to (the webhook had one; the wizard did not). One door, one fallback.
 */
export async function loadProjectRow(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- browser or service-role client, injected
  supabase: any,
  projectId: string,
): Promise<LoadedProject | null> {
  let res = await supabase.from('projects')
    .select(`org_id, name, ${GEOMETRY_COLUMNS}`).eq('project_id', projectId).maybeSingle()
  if (res.error) {
    res = await supabase.from('projects')
      .select('org_id, name, construction_stack, has_common_areas').eq('project_id', projectId).maybeSingle()
  }
  return (res.data ?? null) as LoadedProject | null
}
