// EDITING A TASK BY HAND — the rules that decide what a rename actually touches.
//
// A rename is not a cosmetic act on this product. The name IS the candidate line the WhatsApp
// resolver matches an inbound report against (_siteops_resolution_llm.ts builds the line from
// site_tasks.name), and the task-TYPE identity the model echoes back is derived from that name.
// So renaming has to answer two questions, and they are the two this file pins:
//
//   WHICH ROWS change?      — one, or every row of this type on the project.
//   WHAT WORD IS LOST?      — if no row keeps the old name, the site's spoken word for that work
//                             has vanished from the candidate list, and a supervisor still saying
//                             it would stop resolving. That word is kept as a synonym.

import { suite, test, expect } from './harness'
import { planRename } from '../edit'
import type { DeskTask } from '../types'

const T = (o: Partial<DeskTask>): DeskTask => ({
  ref: 'DSR-30', title: 'Conduiting', group: 'Services', trade: 'Electrical', state: 'todo',
  afters: [], assignee: 'Suresh', dur: '2d', manual: false, taskTypeId: 'conduit', ...o,
})

suite('planRename — which rows, and which word must survive', () => {
  const first = T({ ref: 'DSR-30', floor: 'First' })
  const second = T({ ref: 'DSR-40', floor: 'Second' })
  const other = T({ ref: 'DSR-50', title: 'Plaster', taskTypeId: 'plaster' })
  const all = [first, second, other]

  test('rename ACROSS the project touches every row of that type — and only that type', () => {
    const p = planRename(first, 'Pipe pulling', 'type', all)!
    expect(p.refs).toEqual(['DSR-30', 'DSR-40'])
  })

  /**
   * THE WORD THE SITE SAYS DOES NOT DISAPPEAR BECAUSE THE LABEL CHANGED.
   *
   * After a project-wide rename NO row is called "Conduiting" any more, so the resolver's candidate
   * list no longer contains that word — and the supervisor who has said "conduiting done" for twenty
   * years would stop being understood. The old name is kept as a synonym on the task TYPE, and the
   * resolver appends it to that candidate's `saidAs`. Both words work, and the older one is the one
   * we are least entitled to take away.
   */
  test('a project-wide rename keeps the old word as a synonym — the site does not have to relearn it', () => {
    const p = planRename(first, 'Pipe pulling', 'type', all)!
    expect(p.synonym).toEqual({ taskTypeId: 'conduit', oldName: 'Conduiting' })
  })

  test('renaming ONE row leaves its siblings alone', () => {
    const p = planRename(first, 'Pipe pulling', 'row', all)!
    expect(p.refs).toEqual(['DSR-30'])
  })

  test('...and needs NO synonym — a sibling still carries the old word, so the resolver still sees it', () => {
    expect(planRename(first, 'Pipe pulling', 'row', all)!.synonym).toBe(null)
  })

  test('renaming the ONLY row of its type does lose the word — so that one is kept', () => {
    const lone = T({ ref: 'DSR-60', title: 'Snagging', taskTypeId: 'snag_list' })
    const p = planRename(lone, 'Punch list', 'row', [lone, other])!
    expect(p.synonym).toEqual({ taskTypeId: 'snag_list', oldName: 'Snagging' })
  })

  test('a hand-typed row has no engine type, so it can only ever rename itself — and owns no synonym', () => {
    const manual = T({ ref: 'DSR-70', title: 'Temporary hoarding', manual: true, taskTypeId: null })
    const p = planRename(manual, 'Site hoarding', 'type', [manual, ...all])!
    expect(p.refs).toEqual(['DSR-70'])
    expect(p.synonym).toBe(null)
  })

  test('an unchanged name is not a rename', () => {
    expect(planRename(first, 'Conduiting', 'type', all)).toBe(null)
    expect(planRename(first, '  Conduiting  ', 'type', all)).toBe(null)
  })

  test('an empty name is refused — a task with no name is unmatchable, unspeakable and unfindable', () => {
    expect(planRename(first, '   ', 'type', all)).toBe(null)
  })

  test('the new name is trimmed before it is written', () => {
    expect(planRename(first, '  Pipe pulling  ', 'row', all)!.name).toBe('Pipe pulling')
  })
})
