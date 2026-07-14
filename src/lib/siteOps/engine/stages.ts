// MODULE 0c — WHERE A TASK BELONGS. One classifier, every reader.
//
// Most work happens on a floor and says so (floor_label). The rest happens to the BUILDING and has no floor
// at all: the substructure, the façade, the terrace, the site works, handover, the lift. "So where does it
// go?" got answered twice, independently, and differently:
//
//   viewModel.ts    three synthetic stages — Foundation / Building-wide / Common areas
//   desk/derive.ts  one bin — SITE_FLOOR = tasks.filter((t) => !t.floor)
//
// The desk's is the one a supervisor reads. On a brand-new project he opened "Site & foundation" and found
// the façade, external paint, the terrace, site development, snagging & handover, the compound wall and the
// LIFT sitting in it — on a plot where the footings had not been dug. Not a display quirk: the desk had been
// told this is groundwork, and it is not.
//
// A floorless task is not "leftover". It belongs somewhere specific, and PHYSICS says where:
//
//   the ground it stands on   substructure + earthworks       happens before anything else
//   the building itself       façade, terrace, site works,    happens once there is a frame
//                             handover
//   the amenities             lift, compound wall, OHT, STP…  their own system, opted into per project
//
// Three stages, one function, both readers — so the VM and the desk cannot disagree about where a task is.
// The same fix as the geometry door and the node-key identity before it: the duplication WAS the bug.

import type { Library, TaskTypeId } from './types'
import { LIBRARY } from './library'

export type StageKey = 'foundation' | 'exterior' | 'amenities'

/** The stage names a human reads. These ARE the keys the UI groups by — one spelling, everywhere. */
export const STAGE_LABEL: Record<StageKey, string> = {
  foundation: 'Site & foundation',
  // 'Building-wide' was a shrug, not a place. What is genuinely left once the terrace is a real floor is the
  // building's SKIN, the ground around it, and the final walk: the facade, site development, snagging.
  exterior: 'Exterior & handover',
  // …and the amenities that have no place of their own: lift commissioning, the fire system, the compound
  // wall, landscaping. Everything that DOES have a place — the tank, the solar, the machine room, the
  // generator, the transformer, the sump — is now sited on the floor it stands on, and is not in here.
  amenities: 'Amenities',
}

/**
 * THE GROUND IT STANDS ON — the substructure, plus the earthworks that belong with it.
 *
 * NEITHER `site_grade` NOR `site_development` is in here, and both were once assumed to be. Grading is cut
 * and fill for the level the STILT stands on — done once the substructure is out of the trench — so it is
 * `sited` on that level and never reaches this classifier. Site development is the paving and planting at the
 * very END, once there is a building nobody is driving lorries around.
 */
export const FOUNDATION_TYPES: ReadonlySet<TaskTypeId> = new Set<TaskTypeId>([
  'ground_clearance', 'site_marking', 'excavation',
  'pcc_bed', 'footing', 'footing_column', 'backfill',
  'plinth_beam', 'plinth_fill', 'plinth_slab', 'foundation',
])

/**
 * Which stage a FLOORLESS task belongs to. (A task WITH a floor belongs to its floor — see placeOf.)
 *
 * An amenity is asked first: it is a SYSTEM (opted into, commissioned, licensed), and it is not groundwork
 * under any reading — the lift was being listed under the foundation. Then the ground. Everything else
 * belongs to the building, as a REMAINDER rather than a list: a task type added to the library tomorrow
 * cannot land nowhere, which is the property that stops this drifting back.
 */
export function stageOfFloorless(taskTypeId: string | null | undefined, lib: Library = LIBRARY): StageKey {
  if (taskTypeId && lib.taskTypes.get(taskTypeId)?.system) return 'amenities'
  if (taskTypeId && FOUNDATION_TYPES.has(taskTypeId)) return 'foundation'
  return 'exterior'
}

/**
 * WHERE THIS TASK LIVES — a floor label, or one of the three stages. The single key the UI groups by, so a
 * row can appear in exactly one place and never in "every floor" or "no floor".
 */
export function placeOf(
  t: { taskTypeId?: string | null; floorLabel?: string | null },
  lib: Library = LIBRARY,
): string {
  return t.floorLabel ? t.floorLabel : STAGE_LABEL[stageOfFloorless(t.taskTypeId, lib)]
}
