// MODULE 0 — TASK IDENTITY. What a task IS, as a string. One function, every reader.
//
// A task's identity is written down in three places and read in a fourth:
//
//   · instantiate  builds the graph node's `id`
//   · persist      writes that id verbatim as `site_tasks.node_key`
//   · viewModel    folds the concrete nodes back to a display task's `nodeKey`
//   · the WhatsApp guardrail then asks: is this row's node_key in the VM's key set?
//
// If any two of those disagree by so much as a separator, the guardrail refuses every write to the rows
// that fell through the crack — and it refuses them SILENTLY, because a refusal is indistinguishable from
// "that task isn't tracked here". That is not hypothetical: the graph once keyed a per-zone node
// `tid@Floor#zoneId` while the VM folded it to `tid@Floor/unit`, the two key schemes never intersected,
// and tiling, conduiting, plaster, paint, doors and windows could not be marked done from WhatsApp AT ALL.
//
// It was fixed by making the three sites produce the same string — and then guarded by a COMMENT, in four
// places, saying "these must match exactly". They did match. They matched by hand, which means they were
// one edit away from not matching, forever. So the string is built HERE, once, and the other modules ask
// this file what a task is called rather than each remembering.
//
// The three shapes, and why:
//   building singleton  `snagging`                 — no floor: it happens to the whole project once
//   per floor           `floor_pour@Ground`        — one per floor: the slab is the floor
//   per zone            `floor_tile@Ground/UnitA`  — one per UNIT. A zone is a unit, NOT a room: the wet
//                                                    and dry halves of a flat are one tiling job to the
//                                                    man doing it, and one line in the list to the man
//                                                    reading it. (See the zone-collapse, 2026-07-12.)

/** The unit half of a key. Spaces out ("Unit A" → "UnitA"); an unnamed unit is just `unit`. */
export function unitKeyOf(unitLabel: string | null): string {
  return unitLabel ? unitLabel.replace(/\s+/g, '') : 'unit'
}

/** A zone's id — the geometry's handle for one unit on one floor. */
export function zoneIdOf(floorLabel: string, unitLabel: string | null): string {
  return `${floorLabel}/${unitKeyOf(unitLabel)}`
}

/**
 * THE identity. `floorLabel` null → a building singleton; `unitKey` null → the whole floor.
 * Everything that needs a node_key — the graph, the persisted row, the VM's fold — comes through here.
 */
export function nodeKey(taskTypeId: string, floorLabel: string | null, unitKey: string | null): string {
  if (!floorLabel) return taskTypeId
  if (!unitKey) return `${taskTypeId}@${floorLabel}`
  return `${taskTypeId}@${floorLabel}/${unitKey}`
}

/** The identity of a CONCRETE node (the graph's own shape). A node with no zone belongs to its floor. */
export function nodeKeyOf(n: {
  taskTypeId: string
  floorLabel: string | null
  unitLabel: string | null
  zoneId: string | null
}): string {
  return nodeKey(n.taskTypeId, n.floorLabel, n.zoneId === null ? null : unitKeyOf(n.unitLabel))
}
