// #2 (live probe 2026-07-08) — "all plumbing fixtures done" must apply to EVERY matching task, not ask
// "which one?". An EXPLICIT collective quantifier (model-flagged collective:true) sweeps the residual
// same-name siblings (scoped by any named floor/unit) and reads back ONE combined line. This is NOT the
// forbidden silent sweep — the "all" is the supervisor's own word.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: {},
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
  site_tasks: {
    'tk-g': { task_id: 'tk-g', name: 'Sanitaryware / fittings', project_id: 'P1', status: 'not_started', node_key: 'sanitary@Ground', floor_label: 'Ground', unit_label: null },
    'tk-1': { task_id: 'tk-1', name: 'Sanitaryware / fittings', project_id: 'P1', status: 'not_started', node_key: 'sanitary@First', floor_label: 'First', unit_label: null },
    'tk-2': { task_id: 'tk-2', name: 'Sanitaryware / fittings', project_id: 'P1', status: 'not_started', node_key: 'sanitary@Second', floor_label: 'Second', unit_label: null },
  },
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })

// The "all" quantifier now lives in decompose's STRUCTURE slot; the model just targets the task TYPE.
const DEC = JSON.stringify({ project_hint: 'ASM Elite', items: [{ type: 'progress', text: 'all sanitaryware done', task_hint: null, structure: { floor: null, unit: null, all: true, except: null }, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'ASM Elite' }] })
const R_COLLECTIVE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: 'type:P1:sanitaryware fittings', target_kind: 'task', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'all done' }] } })
const model = (_s: string, user: string): Promise<string> => Promise.resolve(user.startsWith('CANDIDATES:') ? R_COLLECTIVE : DEC)

suite('siteops #2 — explicit "all" sweeps every matching task, one combined readback', () => {
  test('"all sanitaryware done" → all 3 tasks updated, ONE "marked all 3" readback, no which_item ask', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo sanitaryware anni ayipoyayi', { callModel: model })

    // every same-name task got a write (the sweep reached all three)
    const touched = new Set(fake.writesTo('site_tasks').filter((w) => w.op === 'update').flatMap((w) => w.filters.filter(([k]) => k === 'task_id').map(([, v]) => v)))
    expect(touched.has('tk-g')).toBe(true)
    expect(touched.has('tk-1')).toBe(true)
    expect(touched.has('tk-2')).toBe(true)

    // ONE combined readback, not three lines; and NO disambiguation ask
    const out = fake.outbox()
    expect(out.some((b) => /marked all 3/i.test(b))).toBe(true)
    expect(out.some((b) => /which of these is it about/i.test(b))).toBe(false)
  })
})
