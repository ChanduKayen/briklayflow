// SPRINT 2 · T7 concern A — DIDN'T-CATCH AUDITABILITY (clause 6: a miss is LOGGED + queryable, not
// in-memory). The narration is already captured (siteops.ts:1062) — D1 holds. The gap is the BOTH-FALSE
// miss: decompose extracted items AND a project resolved, yet resolveInbound found nothing, so the
// acked_didnt_catch terminal (carrying the contract) is discarded at siteops.ts:678. A reviewer sees a
// normal-looking narration (items + project) with no object and can't answer "should this have matched."
// FIX: persist miss_verdict = {reason, contract} onto that narration.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})

interface Call { system: string; user: string }
const model = (calls: Call[], stubs: { decompose?: string; resolve?: string }) =>
  (system: string, user: string): Promise<string> => {
    calls.push({ system, user })
    if (user.startsWith('CANDIDATES:')) return Promise.resolve(stubs.resolve ?? '')
    return Promise.resolve(stubs.decompose ?? '')
  }
const DEC = (projectHint: string, items: { type: string; text: string }[]) =>
  JSON.stringify({ project_hint: projectHint, items: items.map((i) => ({ type: i.type, text: i.text, task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: projectHint })) })
const R_BOTH_FALSE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })

suite('siteops T7 concern A — miss durability (clause 6: auditable both-false miss)', () => {
  // j1 (GREEN GUARD) — the miss is captured: a contentless input still writes a site_narrations row.
  // D1 already holds (capture-first, :1062); this documents the floor, never regress it.
  test('(j1) contentless miss → site_narrations row EXISTS (the miss is not eaten)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'asdfgh zxcvbn qwerty')   // no model → decompose throws → honest didn't-catch
    expect(fake.writesTo('site_narrations').some((w) => w.op === 'insert')).toBe(true)
    expect(fake.outbox().some((b) => /Didn't catch/i.test(b))).toBe(true)
  })

  // j2 (RED flip) — a BOTH-FALSE miss: decompose extracted a progress item and a project resolved, yet the
  // ladder found nothing (R_BOTH_FALSE) → acked_didnt_catch. The narration must carry the verdict so the
  // miss is auditable: miss_verdict = {reason, contract}, not discarded in-memory.
  test('(j2) both-false miss → narration carries miss_verdict {reason, contract}', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'some rambling about ASM Elite that matches nothing', {
      callModel: model([], { decompose: DEC('ASM Elite', [{ type: 'progress', text: 'rambling' }]), resolve: R_BOTH_FALSE }),
    })

    const upd = fake.writesTo('site_narrations').filter((w) => w.op === 'update' && w.payload?.miss_verdict)
    expect(upd.length >= 1).toBe(true)
    const v = upd[0].payload.miss_verdict
    expect(typeof v.reason).toBe('string')                          // WHY we missed
    expect(!!v.contract).toBe(true)                                 // the both-false contract (what the model returned)
    expect(v.contract?.update_found?.found).toBe(false)            // …recorded as genuinely both-false
    expect(v.contract?.issue_snag_found?.found).toBe(false)
  })

  // j4 (GREEN GUARD) — a miss-narration is INERT: no object created, nothing chased. No consumer treats it
  // as actionable, so persisting the verdict never accidentally spawns work.
  test('(j4) both-false miss → no problem/todo created, nothing chased (miss-narration is inert)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'some rambling about ASM Elite that matches nothing', {
      callModel: model([], { decompose: DEC('ASM Elite', [{ type: 'progress', text: 'rambling' }]), resolve: R_BOTH_FALSE }),
    })
    expect(fake.writesTo('problems').filter((w) => w.op === 'insert').length).toBe(0)
    expect(fake.writesTo('todos').filter((w) => w.op === 'insert').length).toBe(0)
    expect(fake.writesTo('chase_batches').length).toBe(0)
  })
})
