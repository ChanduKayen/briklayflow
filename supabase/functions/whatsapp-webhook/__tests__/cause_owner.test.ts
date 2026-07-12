// NO-INFO-LOSS on create — the v2 resolution create path used to hard-code cause:'other' and owner:null in
// toSiteItem, so a created issue lost its CAUSE (which drives the follow-up cadence + impact) and its named
// OWNER. Now the model extracts both and they ride through to the problems row.

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

const DEC = JSON.stringify({ project_hint: 'ASM Elite', items: [{ type: 'issue', text: 'cement short at 4th', task_hint: '4th floor', qc_statements: [], cause: 'material', cause_reason: null, owner_hint: 'Ramesh', date_hint: null, project_hint: 'ASM Elite' }] })
const R_ISSUE = JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'cement short at 4th', location: '4th floor', project_hint: 'ASM Elite', confidence: 'high', cause: 'material', owner: 'Ramesh' }] }, update_found: { found: false, updates: [] } })
const model = (_s: string, user: string): Promise<string> => Promise.resolve(user.startsWith('CANDIDATES:') ? R_ISSUE : DEC)

suite('siteops — create carries CAUSE + OWNER (no info lost)', () => {
  test('"cement short at 4th, tell Ramesh" → issue with cause=material (not the old hard-coded other)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo 4th floor cement short, Ramesh ki cheppu', { callModel: model })

    const inserts = fake.writesTo('problems').filter((w) => w.op === 'insert')
    expect(inserts.length).toBe(1)
    expect(inserts[0].payload?.cause).toBe('material')      // cause SURVIVED (drives cadence + impact)
    expect(inserts[0].payload?.kind).toBe('issue')
    expect(inserts[0].payload?.project_id).toBe('P1')
  })

  test('an off-taxonomy cause is CLAMPED to other, never rejected (finding not lost)', async () => {
    const fake = fakeSupabase(seed())
    const junkCause = (_s: string, user: string): Promise<string> => Promise.resolve(
      user.startsWith('CANDIDATES:')
        ? JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'weird thing', location: null, project_hint: 'ASM Elite', confidence: 'high', cause: 'banana', owner: null }] }, update_found: { found: false, updates: [] } })
        : JSON.stringify({ project_hint: 'ASM Elite', items: [{ type: 'issue', text: 'weird thing', task_hint: null, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'ASM Elite' }] }),
    )
    await runSiteops(ctxFor(fake), 'ASM lo weird thing', { callModel: junkCause })
    const inserts = fake.writesTo('problems').filter((w) => w.op === 'insert')
    expect(inserts.length).toBe(1)
    expect(inserts[0].payload?.cause).toBe('other')         // clamped, not a rejected finding
  })
})
