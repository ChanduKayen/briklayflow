// ADDING A TASK BY HAND — where it lands.
//
// A plan is a sequence, so "add a task" is not "append a row": the question the code has to answer is
// WHERE in the run this job happens. Get it wrong and the task appears at the bottom of the site, four
// floors below the work it belongs to, and the man who added it has to drag it back.
//
// The rule is the one a site engineer would use without thinking: a job belongs with the work it is
// part of. The second coat of plaster goes with the plaster, on this floor, in this flat — at the end
// of it, because it is the newest thing anyone has thought of. Only if there is nothing like it here
// does it go at the end of the floor, and only if the floor is empty does it go at the end of the site.

import { suite, test, expect } from './harness'
import { insertionIndex } from '../add'
import type { DeskTask } from '../types'

const T = (o: Partial<DeskTask>): DeskTask => ({
  ref: 'X', title: 't', group: 'Structure', trade: 'Civil', state: 'todo',
  afters: [], assignee: 'Ravi', dur: '1d', ...o,
})

// a small site, in build order: Ground then First; each floor structure → finishes
const PLAN = [
  T({ ref: 'G-1', group: 'Structure', floor: 'Ground' }),
  T({ ref: 'G-2', group: 'Finishes', floor: 'Ground', unit: 'Unit A' }),
  T({ ref: 'F-1', group: 'Structure', floor: 'First' }),
  T({ ref: 'F-2', group: 'Services', floor: 'First', unit: 'Unit A' }),
  T({ ref: 'F-3', group: 'Finishes', floor: 'First', unit: 'Unit A' }),
  T({ ref: 'F-4', group: 'Finishes', floor: 'First', unit: 'Unit B' }),
]

suite('insertionIndex — a new job belongs WITH the work it is part of', () => {
  test('it lands at the end of its own section, on its own floor, in its own flat', () => {
    // a second coat of plaster in First / Unit A → after F-3, before Unit B's finishes
    const i = insertionIndex(PLAN, { group: 'Finishes', floor: 'First', unit: 'Unit A' })
    expect(i).toBe(5)
    expect(PLAN[i - 1].ref).toBe('F-3')
  })

  test('a floor-wide job (no flat) lands at the end of that section on the floor', () => {
    const i = insertionIndex(PLAN, { group: 'Structure', floor: 'First', unit: null })
    expect(PLAN[i - 1].ref).toBe('F-1')
  })

  test('the LAST task of the section wins, not the first — the newest thought goes at the end of it', () => {
    const i = insertionIndex(PLAN, { group: 'Finishes', floor: 'First', unit: 'Unit B' })
    expect(i).toBe(6)                                   // after F-4, the end of the plan
  })

  /**
   * A SECTION THAT DOES NOT EXIST HERE YET. Nobody has added any services to the Ground floor, and
   * now somebody does. It cannot go with "the other services on this floor" — there are none — so it
   * goes at the end of the FLOOR, where the rest of that floor's work is, and not at the end of the
   * site four storeys up.
   */
  test('a section with nothing on this floor lands at the end of the FLOOR', () => {
    const i = insertionIndex(PLAN, { group: 'Services', floor: 'Ground', unit: null })
    expect(i).toBe(2)                                   // after G-2 — the last Ground task
    expect(PLAN[i - 1].floor).toBe('Ground')
  })

  test('a floor with nothing on it at all lands at the end of the plan', () => {
    expect(insertionIndex(PLAN, { group: 'Structure', floor: 'Second', unit: null })).toBe(PLAN.length)
  })

  test('an empty plan takes it at the start, and does not fall over', () => {
    expect(insertionIndex([], { group: 'Structure', floor: 'Ground', unit: null })).toBe(0)
  })

  /**
   * PUT IT HERE. He picked the row it goes after — his word beats every rule above it, because he can
   * see the plan and we are only guessing at it.
   */
  test('an explicit "after this one" beats the rule — he can see the plan', () => {
    const i = insertionIndex(PLAN, { group: 'Finishes', floor: 'First', unit: 'Unit A', afterRef: 'G-1' })
    expect(i).toBe(1)
  })

  test('...but an "after" naming a task that is not here falls back to the rule', () => {
    const i = insertionIndex(PLAN, { group: 'Finishes', floor: 'First', unit: 'Unit A', afterRef: 'NOPE' })
    expect(i).toBe(5)
  })
})
