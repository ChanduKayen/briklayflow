// IS THE PLAN TRUE ABOUT THE WORLD? (2026-07-13)
//
// Every other guard in this engine checks that a task is well-FORMED: uniquely named (identity.test),
// renderable by the VM, writable past the guardrail, offered only when it exists. All green — and all of
// them blind to a task that is perfectly well-formed and simply a lie.
//
// The engine said this, on an empty plot, with nothing built:
//
//     Ready to start:  Site — ground clearance
//                      External — façade structure          ← before the frame exists
//                      Wet area — waterproofing (×N units)  ← before the rooms exist
//                      Wall — tiling / dado                 ← before the walls exist
//                      Electrical — switchplates            ← before there is wire
//                      Snagging & handover                  ← before there is a building
//
// Twenty-two of ~fifty tasks, on bare ground. `External — façade structure` was seq_no **1** — the plan's
// literal first instruction was to build the façade, ahead of clearing the site.
//
// TWO CAUSES, ONE MISTAKE. A task was authored with no predecessor at all (`external_structure`,
// `waterproof`, `site_grade`), or with only a STRONG_PREF one — and prefs, by deliberate design, DO NOT
// GATE (evaluate.ts: "available iff every hard predecessor is done (prefs don't gate)"). That design is
// right: a foreman may tile before plastering if he wants to, and the engine must not stop him.
//
// What the author wrote down was the QUALITY PREFERENCE ("tile onto plaster, not blockwork"). What nobody
// wrote down was the EXISTENCE REQUIREMENT: you cannot tile a wall that is not there. Those are different
// edges, and the second one was simply missing — sixteen times.
//
// It had been caught ONCE before, for exactly one task. `ceiling_frame` still carries the note:
// "FOUNDER RED-PEN (engine-flagged gap): the sheet authored NO predecessor, so the engine honestly reported
// 'available before walls exist'." The finding was right and it was never generalised. This file generalises
// it, so a task type cannot be born unconstrained again.

import { suite, test, expect } from './harness'
import { LIBRARY, isHardNature } from '../library'
import { buildProjectVM } from '../viewModel'

// A real little building: two habitable floors over nothing. Amenities off — this is about the core work.
const STACK = {
  levels: [
    { label: 'Ground', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
    { label: 'First', kind: 'habitable', zones: [{ use: 'habitable', units: 1 }] },
  ],
}

/** What the app would show a supervisor as "ready to start" on a project where nothing is done. */
const startableOnBareGround = (): string[] => {
  const vm = buildProjectVM('p1', STACK, new Map(), { dryRun: true })
  const out: string[] = []
  for (const f of vm.floors) for (const b of f.blocks) for (const t of b.tasks)
    if (t.status === 'available' || t.status === 'active') out.push(t.taskType)
  return [...new Set(out)]
}

suite('the plan is true about the world', () => {
  // THE ONE JOB. On bare ground there is exactly one thing a crew can physically begin, and every
  // supervisor on earth knows what it is. If this list ever grows again, the plan is lying to them.
  test('(P1) on an empty plot, the only startable work is clearing the ground', () => {
    const startable = startableOnBareGround()
    expect(startable).toEqual(['ground_clearance'])
  })

  // THE FLOOR, with no allowlist. Every task type must be gated by something that must physically EXIST
  // first — the one exception being the task that genuinely starts the project. A STRONG_PREF does not
  // count: it is advice, and advice does not hold up a wall.
  //
  // A new task type added to the library tomorrow lands here the moment it forgets its existence edge,
  // which is the only way this stays fixed. (Keep the preference edge too — it is not the enemy. Add the
  // hard one BESIDE it, as ceiling_frame does.)
  test('(P2) every task type has a hard predecessor — nothing but clearing starts from nothing', () => {
    const ungated: string[] = []
    for (const [id, t] of LIBRARY.taskTypes) {
      if (id === 'ground_clearance') continue                       // the genuine first task
      const hard = (t.seq ?? []).filter((e) => isHardNature(e.nature, e.reason))
      if (!hard.length) ungated.push(`${id}  (${t.label})`)
    }
    if (ungated.length) {
      throw new Error(
        `${ungated.length} task type(s) can start on bare ground — they have no predecessor that must EXIST:\n      ` +
        ungated.join('\n      ') +
        `\n\n      A STRONG_PREF is advice; it does not gate. Add the existence edge beside it (see ceiling_frame).`,
      )
    }
  })

  // …and the two that made this findable, pinned by name, because they are the ones a human noticed.
  test('(P3) the façade needs a building, and handover needs a finished one', () => {
    const startable = startableOnBareGround()
    expect(startable.includes('external_structure')).toBe(false)
    expect(startable.includes('snagging')).toBe(false)
  })
})
