// SITE DESK — ADDING A TASK BY HAND. Pure; no I/O.
//
// The engine plans a building. It cannot plan YOUR building: the client wants a second coat in the
// master bedroom, the neighbour's compound wall has to be underpinned, a temporary hoarding goes up
// before the machines arrive. None of that is in any library, and all of it is real work that a crew
// has to be sent to do and that somebody has to be asked about.
//
// WHAT A HAND-ADDED TASK IS, AND IS NOT
//
// It is a row with no node_key. The engine did not place it, so the engine does not own it: reconcile
// never renames it, never re-sequences it, and never deletes it when the geometry changes
// (persist.ts — "a MANUAL row is never touched"). It has no hard predecessors, so nothing waits for
// it and it waits for nothing, and gates.ts says so honestly rather than inventing a dependency
// nobody authored.
//
// So the only real question is WHERE IT GOES, and that is what this file answers.

import type { DeskTask } from './types'

export interface NewTask {
  /** What the job is. The only thing we truly require. */
  name: string
  /** Which band of work it belongs to — Structure / Services / Finishes, the site's own three. */
  group: string
  floor: string | null
  unit: string | null
  trade?: string
  durationDays?: number
  ownerId?: string | null
  /** "Put it after this one." His word, and it beats the rule below. */
  afterRef?: string
}

/**
 * WHERE THIS JOB HAPPENS — the index in the plan's running order at which the new task belongs.
 *
 * A job belongs WITH the work it is part of. So: at the end of its own section, on its own floor, in
 * its own flat. Not appended to the bottom of the site, four storeys above the work it describes,
 * which is what "add a task" means in every tool that thinks a plan is a list.
 *
 * The fallbacks walk outward, and each one is the next-best true statement:
 *   · no work of this kind on this floor yet   → the end of the FLOOR (it happens here, at least)
 *   · nothing on this floor at all             → the end of the plan (we genuinely do not know)
 */
export function insertionIndex(tasks: readonly DeskTask[], t: NewTask): number {
  // He picked the row it goes after. He can see the plan; we are only guessing at it.
  if (t.afterRef) {
    const i = tasks.findIndex((x) => x.ref === t.afterRef)
    if (i >= 0) return i + 1
  }

  const lastOf = (match: (x: DeskTask) => boolean): number => {
    for (let i = tasks.length - 1; i >= 0; i--) if (match(tasks[i])) return i + 1
    return -1
  }

  // 1. the end of its own section, on its floor, in its flat
  const inSection = lastOf((x) =>
    x.group === t.group && (x.floor ?? null) === t.floor && (x.unit ?? null) === t.unit)
  if (inSection >= 0) return inSection

  // 2. no work of this kind here yet — the end of the floor
  const onFloor = lastOf((x) => (x.floor ?? null) === t.floor)
  if (onFloor >= 0) return onFloor

  // 3. nothing on this floor at all
  return tasks.length
}

/** The plan's running order with the new task spliced in — what the caller persists. */
export function withNewTask<T>(tasks: readonly DeskTask[], t: NewTask, row: T): Array<DeskTask | T> {
  const out: Array<DeskTask | T> = [...tasks]
  out.splice(insertionIndex(tasks, t), 0, row)
  return out
}
