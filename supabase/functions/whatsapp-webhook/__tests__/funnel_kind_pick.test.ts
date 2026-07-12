// STEP 4 — the KIND FORK made real in the pick. When a which_item pick spans MORE THAN ONE kind (a wiring
// TASK next to a wiring-broke ISSUE — the "is it the work or the defect?" fork), each row must carry its
// [kind] so the supervisor can tell them apart, and the cross-kind fork is capped to 2 (+ new) so it stays
// a glance-and-tap, not a quiz. A SINGLE-kind pick (e.g. five same-name floors — the location axis) is
// UNCHANGED: no kind tags, full list. (Discovery: ask-generation never sibling-explodes a task-group NEXT
// to an issue — the explosion is the single-kind location ask — so no collapse/chain is needed; the fork is
// purely a rendering + cap concern here.)

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })

const DEC = JSON.stringify({ project_hint: null, items: [{ type: 'progress', text: 'wiring done', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }] })
const near = (arr: { target_id: string; target_kind: 'issue' | 'task'; plausibility?: string }[]) => JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: false, updates: [], nearest: arr.map((n) => ({ target_id: n.target_id, target_kind: n.target_kind, plausibility: n.plausibility ?? 'med', action: n.target_kind === 'issue' ? 'resolve' : 'progress', closure_explicit: false, reason: 'wiring — could be the task or the defect' })) },
})
const model = (resolve: string) => (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? resolve : DEC)

// a wiring TASK and a wiring-broke ISSUE both open on the sole project.
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: { 'iss-w': { id: 'iss-w', title: 'wiring broke after 2h', project_id: 'P1', status: 'OPEN', cause: 'rework' } },
  site_tasks: { 'tk-w': { task_id: 'tk-w', name: 'Wiring', project_id: 'P1', status: 'not_started', node_key: 'ground/wiring', floor_label: 'Ground' } },
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})

const pickMsg = (fake: ReturnType<typeof fakeSupabase>) => fake.outbox().find((b) => /which of these/i.test(b)) ?? ''

suite('siteops — Step 4: the cross-kind fork is unreachable after the task-pin redesign', () => {
  // DELETED (2026-07-11): the two cross-kind fork journeys. They drove a which_item pick spanning an ISSUE and
  // a TASK via the recall floor's `nearest`, tagging each row [issue]/[task] and capping the mix to 2.
  //
  // The task-matching redesign deletes task-side `nearest` (a task nearest would name a TYPE id, and "did you
  // mean this work on which floor?" has no answer without the structure slot — that's the pin's job). So a
  // single item's which_item is now always SAME-KIND: either a task LOCATION pick over one type's rows, or an
  // issue/todo meaning pick. A mixed issue+task fork can no longer arise, and "wiring done" against a wiring
  // task + a wiring-broke issue is resolved by the model's SAME-TRADE DISCRIMINATOR (completion → the task),
  // not by offering both. The askItemPick multiKind rendering + cap survive as code but are no longer reached.
  test('"wiring done" resolves to the TASK by the discriminator (no issue+task fork)', async () => {
    const fake = fakeSupabase(seed())
    const R_TASK = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: 'type:P1:wiring', target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'wiring done → the task' }] } })
    await runSiteops(ctxFor(fake), 'wiring done', { callModel: model(R_TASK) })
    // ONE Wiring row (Ground) → the pin applies it; no which_item ask, and the wiring-broke ISSUE is untouched.
    expect(pickMsg(fake)).toBe('')
    expect(fake.writesTo('site_tasks').some((w) => w.op === 'update')).toBe(true)
    expect(fake.writesTo('problems').some((w) => w.op === 'update')).toBe(false)
  })
})
