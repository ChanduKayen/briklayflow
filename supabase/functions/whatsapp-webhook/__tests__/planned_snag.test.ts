// #1 (live probe 2026-07-08) — PLANNED / TO-DO WORK is a snag, never a miss. "ASM lo tap issues vachayi,
// Monday kalla resolve avvali" ("tap issues in ASM, resolve by Monday") came back as "Didn't catch a site
// update" because the v2 two-axis contract had no home for assigned work. Fix: the model captures it as
// issue_snag_found{kind:snag, planned:true, due_date}, the create path writes problems.is_planned + the
// deadline (via date_hint → computeTiming), and a high-confidence planned snag is chased near its date.

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
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })

// decompose: one issue item on ASM. resolveInbound (CANDIDATES:): a PLANNED snag with a Monday deadline.
const DEC = JSON.stringify({ project_hint: 'ASM Elite', items: [{ type: 'issue', text: 'tap issues to fix by Monday', task_hint: null, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: 'monday', project_hint: 'ASM Elite' }] })
const R_PLANNED = JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'snag', detail: 'tap issues', location: null, project_hint: 'ASM Elite', confidence: 'high', planned: true, due_date: 'monday' }] }, update_found: { found: false, updates: [] } })
const model = (_s: string, user: string): Promise<string> => Promise.resolve(user.startsWith('CANDIDATES:') ? R_PLANNED : DEC)

suite('siteops #1 — planned/to-do work is a snag, not a miss', () => {
  test('"tap issues to fix by Monday" → a PLANNED snag row (is_planned + kind=snag), never a didn\'t-catch', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo tap issues vachayi, Monday kalla resolve avvali', { callModel: model })

    const inserts = fake.writesTo('problems').filter((w) => w.op === 'insert')
    expect(inserts.length).toBe(1)
    expect(inserts[0].payload?.is_planned).toBe(true)     // captured as PLANNED work
    expect(inserts[0].payload?.kind).toBe('snag')          // …as a snag, per the owner's ruling
    expect(inserts[0].payload?.project_id).toBe('P1')      // on ASM
    expect((inserts[0].payload?.deadline ?? null) !== null).toBe(true)   // the "Monday" deadline SURVIVED (was dropped before)
  })

  test('a defect (planned:false) still creates a normal snag — is_planned false, no regression', async () => {
    const fake = fakeSupabase(seed())
    const defectModel = (_s: string, user: string): Promise<string> => Promise.resolve(
      user.startsWith('CANDIDATES:')
        ? JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'snag', detail: 'cracked tile', location: null, project_hint: 'ASM Elite', confidence: 'high', planned: false, due_date: null }] }, update_found: { found: false, updates: [] } })
        : JSON.stringify({ project_hint: 'ASM Elite', items: [{ type: 'issue', text: 'cracked tile', task_hint: null, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'ASM Elite' }] }),
    )
    await runSiteops(ctxFor(fake), 'ASM lo tile cracked', { callModel: defectModel })
    const inserts = fake.writesTo('problems').filter((w) => w.op === 'insert')
    expect(inserts.length).toBe(1)
    expect(inserts[0].payload?.is_planned).toBe(false)
  })
})
