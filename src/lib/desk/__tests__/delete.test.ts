// DELETING A TASK — and telling the truth about what it costs.
//
// A delete on this desk is not a row disappearing. The task is a node in a dependency graph, it is a
// target the WhatsApp resolver writes progress onto, and it owns quality checks that can only ever be
// answered before the work is covered up. So the confirmation has to NAME the consequences, and to
// name them it has to compute them. That is what deleteImpact() is: not a warning string, a fact.
//
// It reports what will actually happen, and the ugliest one is the one nobody expects: removing a
// task removes its EDGES, so everything that was waiting on it becomes startable. Delete the slab and
// the wiring says "Ready — can start now". True to the engine, and appalling if nobody said so first.

import { suite, test, expect } from './harness'
import { deleteImpact } from '../edit'
import type { DeskProblem, DeskTask } from '../types'

const gate = (ref: string) => ({ ref, nature: 'IMPOSSIBLE', reason: 'structural' })
const T = (o: Partial<DeskTask>): DeskTask => ({
  ref: 'DSR-30', title: 'Slab', group: 'Structure', trade: 'Civil', state: 'todo',
  afters: [], assignee: 'Ravi', dur: '4d', manual: false, taskTypeId: 'slab', ...o,
})
const P = (o: Partial<DeskProblem>): DeskProblem => ({
  id: 'i1', ref: 'DSR-19', kind: 'issue', state: 'you', title: 'Steel short', site: 'D', siteCode: 'DSR',
  days: 2, last: 1, person: { name: 'R', phone: '' }, status: '', story: [], ...o,
})

suite('deleteImpact — what a delete actually costs', () => {
  test('THE UNBLOCKING NOBODY EXPECTS: removing a task frees everything that was waiting on it', () => {
    const slab = T({ ref: 'DSR-30' })
    const wiring = T({ ref: 'DSR-31', title: 'Wiring', afters: [gate('DSR-30')] })
    const plaster = T({ ref: 'DSR-32', title: 'Plaster', afters: [gate('DSR-30'), gate('DSR-31')] })
    const i = deleteImpact(slab, [slab, wiring, plaster], [])
    expect(i.unblocks.map((t) => t.ref)).toEqual(['DSR-31', 'DSR-32'])
  })

  test('a task nothing waits on frees nothing', () => {
    const lone = T({ ref: 'DSR-30' })
    expect(deleteImpact(lone, [lone, T({ ref: 'DSR-31', afters: [gate('DSR-99')] })], []).unblocks).toEqual([])
  })

  test('its quality checks die with it — and the critical one is the whole reason a photo gets taken', () => {
    const t = T({
      qc: [
        { id: 'q1', question: 'Cover blocks in?', critical: true, status: 'pending', answer: null },
        { id: 'q2', question: 'Level checked?', critical: false, status: 'confirmed', answer: 'yes' },
      ],
    })
    const i = deleteImpact(t, [t], [])
    expect(i.qcCount).toBe(2)
    expect(i.qcCritical).toBe(1)
  })

  test('an OPEN problem raised over WhatsApp about this task survives — but loses what it was about', () => {
    const t = T({ ref: 'DSR-30', blockedBy: 'DSR-19' })
    const i = deleteImpact(t, [t], [P({ ref: 'DSR-19' })])
    expect(i.orphans.map((p) => p.ref)).toEqual(['DSR-19'])
  })

  test('a RESOLVED problem is not orphaned by a delete — it is already closed and filed', () => {
    const t = T({ ref: 'DSR-30', blockedBy: 'DSR-19' })
    expect(deleteImpact(t, [t], [P({ ref: 'DSR-19', state: 'resolved' })]).orphans).toEqual([])
  })

  /**
   * WHY A DELETE NEEDS A SUPPRESSION AT ALL.
   *
   * Deleting the ROW is not enough for an engine task. reconcile() runs at read, and it re-inserts
   * any node_key that is in the graph but not in the table (persist.ts) — so the task would simply
   * come back on the next page load, and the app would look broken rather than opinionated. The
   * node_key has to go on the project's suppressed_nodes list, and THAT is what makes it stay gone.
   *
   * A hand-typed task has no node_key and no place in the graph, so nothing regenerates it: the row
   * is the whole of it, and deleting the row is the whole of the delete.
   */
  test('an engine task must be SUPPRESSED, or reconcile puts it straight back', () => {
    const t = T({ nodeKey: 'slab@First' })
    expect(deleteImpact(t, [t], []).suppressNode).toBe('slab@First')
  })

  test('a hand-typed task needs no suppression — nothing would ever regenerate it', () => {
    const t = T({ manual: true, nodeKey: null, taskTypeId: null })
    expect(deleteImpact(t, [t], []).suppressNode).toBe(null)
  })

  test('the suppression is per NODE, so a sibling on another floor is untouched', () => {
    const first = T({ ref: 'DSR-30', nodeKey: 'slab@First' })
    const second = T({ ref: 'DSR-40', nodeKey: 'slab@Second' })
    const i = deleteImpact(first, [first, second], [])
    expect(i.suppressNode).toBe('slab@First')
    expect(i.siblingsKept).toBe(1)
  })
})
