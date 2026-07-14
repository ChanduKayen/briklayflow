// ONE DOOR TO THE GENERATOR.
//
// The plan can be set up from three places — the new-project wizard, the project's task page, and
// the Site Desk's empty plan — and every one of them must produce the SAME rows: same stack, same
// node_key, same binding, same task vocabulary. So the write lives here, once, and the screens are
// only the questions. (Two generators is the exact mistake this codebase already paid for: see
// ConstructionConfig's note about the retired expander.)
//
// The engine is the only generator: constraint library → geometry → graph → persistGraph.

import { supabase } from '../supabase'
import { buildStack } from './expander'
import { instantiate, persistGraph, geometryOf, loadProjectRow } from './engine'

export const SUPPORTED_TYPES = ['Residential', 'Villa', 'Apartment']

export type Parking = 'none' | 'stilt' | 'cellar'

export interface PlanSeed {
  projectId: string
  projectType: string
  parking: Parking
  floors: number
  units: number
  /** engine amenity SYSTEM ids (see CA_SYSTEMS) */
  systems: string[]
  /** system id → the floor label its plant stands on. Omit a system → the engine's default
   *  (lowest level for the DG/transformer/sump, roof for the tank/solar). */
  sitedLevels?: Record<string, string>
}

export interface PlanResult {
  generated: boolean
  taskCount?: number
  reason?: 'unsupported_type'
}

/**
 * The engine's amenity SYSTEMS, with the label each wears in the UI.
 * The ids MUST match library.ts — a typo here is a system that silently never gets built.
 *
 * `sited` marks a system whose plant physically stands on a level, so the wizard can ask WHICH one.
 * (Everything else is either spread over every floor — the lift, the staircase, the corridors, the
 * fire standpipes — or genuinely site-wide, like the compound wall.)
 */
export const CA_SYSTEMS: { id: string; label: string; sited?: 'lowest' | 'top' }[] = [
  { id: 'ca_oht', label: 'Overhead tank', sited: 'top' },
  { id: 'ca_ugt', label: 'Sump / UG tank', sited: 'lowest' },
  { id: 'ca_borewell', label: 'Borewell', sited: 'lowest' },
  { id: 'ca_stp', label: 'STP', sited: 'lowest' },
  { id: 'ca_transformer', label: 'Transformer', sited: 'lowest' },
  { id: 'ca_generator', label: 'DG / generator', sited: 'lowest' },
  { id: 'ca_solar', label: 'Rooftop solar', sited: 'top' },
  { id: 'ca_lift', label: 'Lift' },
  { id: 'ca_stair', label: 'Common staircase' },
  { id: 'ca_corridor', label: 'Corridor finishes' },
  { id: 'ca_parking', label: 'Parking', sited: 'lowest' },
  { id: 'ca_compound', label: 'Compound wall & gate' },
  { id: 'ca_landscaping', label: 'Landscaping' },
  { id: 'ca_fire', label: 'Fire fighting' },
]

export const idOf = (label: string) => CA_SYSTEMS.find((s) => s.label === label)?.id ?? null

/** The systems in `selected` whose plant stands on a level — the ones worth asking "where?" about. */
export const sitedSystems = (selected: string[]) =>
  CA_SYSTEMS.filter((s) => s.sited && selected.includes(s.id))

/** The level labels a plant can stand on, bottom → top, from a built stack. */
export function levelLabels(stack: { levels?: { label: string }[] } | null | undefined): string[] {
  return (stack?.levels ?? []).map((l) => l.label)
}

/**
 * Describe the building once → the whole task set, in the order it can actually be built.
 *
 * An unsupported project type degrades gracefully: the type is saved, nothing is generated, and the
 * caller is TOLD so — rather than being handed an empty plan that looks like a generator failure.
 */
export async function setupPlan(seed: PlanSeed): Promise<PlanResult> {
  const { projectId, projectType, parking, floors, units, systems, sitedLevels = {} } = seed

  if (!SUPPORTED_TYPES.includes(projectType)) {
    const { error } = await supabase.from('projects').update({ project_type: projectType }).eq('project_id', projectId)
    if (error) throw error
    return { generated: false, reason: 'unsupported_type' }
  }

  const hasCommon = systems.length > 0
  const stack = buildStack({
    dedicated_parking: parking,
    habitable_floors: floors,
    units_per_floor: units,
    has_common_areas: hasCommon,
  })

  const baseUpdate = {
    construction_stack: stack,
    dedicated_parking: parking,
    habitable_floors: floors,
    units_per_floor: units,
    has_common_areas: hasCommon,
    project_type: projectType,
    sequence_model: 'rcc_residential',
  }
  // common_systems / amenity_levels are later migrations; persist them when present, else fall back
  // gracefully (an un-applied column must never cost us the plan).
  let e = (await supabase.from('projects')
    .update({ ...baseUpdate, common_systems: systems, amenity_levels: sitedLevels })
    .eq('project_id', projectId)).error
  if (e) e = (await supabase.from('projects').update({ ...baseUpdate, common_systems: systems }).eq('project_id', projectId)).error
  if (e) e = (await supabase.from('projects').update(baseUpdate).eq('project_id', projectId)).error
  if (e) throw e

  // THE GENERATOR READS WHAT THE READERS READ (2026-07-13). This used to build the geometry from the
  // wizard's OWN arguments — and so left out `suppressed_tasks`, which the wizard has no argument for.
  // A task suppressed in the Sequence view was therefore RESURRECTED by the next config edit, and retired
  // again by the next WhatsApp message. The writer must describe the project exactly as every reader does,
  // so it re-reads the row it has just written and goes through the one door. See engine/project.ts.
  const proj = await loadProjectRow(supabase, projectId)
  if (!proj?.org_id) throw new Error('project has no org')
  const geometry = geometryOf(proj)
  if (!geometry) throw new Error('project has no construction stack')
  const res = await persistGraph(supabase, { project_id: projectId, org_id: proj.org_id }, instantiate(geometry))
  return { generated: true, taskCount: res.inserted }
}
