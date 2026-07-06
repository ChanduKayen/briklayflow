// THE VM GUARDRAIL, recalibrated (the parking lesson, 2026-07-05). The original rule refused every write
// to a node_key-null row whenever the VM fold-set was present — correct for a FLAT DUPLICATE of an engine
// row (the columns failure: a write the Sequence overlay can't render), WRONG for a one-off manual task
// ("Parking deck & markings") that the Task Manager list renders first-class and that has NO engine
// identity at all. New rule, twin-aware:
//   • engine row (node_key set)   → writable iff node_key ∈ vmNodeKeys            (unchanged)
//   • flat row  (node_key null)   → writable iff its name is NOT a VM name-twin   (vmTaskNames)
//   • sets absent                 → can't judge → proceed, unguarded              (unchanged)

import { suite, test, expect } from './harness'
import { fakeSupabase } from './fake_supabase'
import { applyProgress, type RouteCtx } from '../_siteops_route.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mkRc = (fake: ReturnType<typeof fakeSupabase>, over: Partial<RouteCtx> = {}): RouteCtx => ({
  supabase: fake, orgId: 'org-1', projectId: 'P1', byLabel: '919900000000',
  members: [], supervisorId: null, principalId: null, narrationId: 'narr-1', now: new Date('2026-07-06T00:00:00Z'),
  vmNodeKeys: new Set(['stilt/columns']), vmTaskNames: new Set(['columns']),
  ...over,
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const task = (over: Record<string, unknown>): any => ({
  task_id: 'tk-x', name: 'X', status: 'not_started', floor_label: null, unit_label: null,
  node_key: null, task_type_id: null, ...over,
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const progressItem: any = {
  type: 'progress', text: 'parking tiling completed', task_hint: null, qc_statements: [],
  cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null,
}

suite('siteops route — VM guardrail admits flat one-offs, still refuses twins (parking lesson)', () => {
  test('flat one-off with NO VM name-twin → write ALLOWED (visibleInVM true)', async () => {
    const fake = fakeSupabase({ site_tasks: { 'tk-park': { task_id: 'tk-park', name: 'Parking deck & markings', status: 'not_started' } } })
    const res = await applyProgress(mkRc(fake), task({ task_id: 'tk-park', name: 'Parking deck & markings' }), progressItem)

    expect(res.visibleInVM).toBe(true)
    expect(fake.writesTo('site_tasks').some((w) => w.op === 'update')).toBe(true)
  })

  test('flat NAME-TWIN of a VM row → REFUSED (the columns regression stays dead)', async () => {
    const fake = fakeSupabase({})
    const res = await applyProgress(mkRc(fake), task({ task_id: 'tk-flat', name: 'Columns' }), progressItem)

    expect(res.visibleInVM).toBe(false)
    expect(fake.writesTo('site_tasks').length).toBe(0)
  })

  test('engine row in the VM → allowed; engine row NOT in the VM → refused (both unchanged)', async () => {
    const fake = fakeSupabase({})
    const inVm = await applyProgress(mkRc(fake), task({ task_id: 'tk-eng', name: 'Columns', node_key: 'stilt/columns' }), progressItem)
    expect(inVm.visibleInVM).toBe(true)

    const ghost = await applyProgress(mkRc(fake), task({ task_id: 'tk-ghost', name: 'Columns', node_key: 'ghost/key' }), progressItem)
    expect(ghost.visibleInVM).toBe(false)
  })

  test('sets absent (stack-less project) → can\'t judge → proceed, unguarded (unchanged)', async () => {
    const fake = fakeSupabase({})
    const res = await applyProgress(mkRc(fake, { vmNodeKeys: undefined, vmTaskNames: undefined }), task({ task_id: 'tk-flat', name: 'Boundary wall' }), progressItem)
    expect(res.visibleInVM).toBe(true)
  })
})
