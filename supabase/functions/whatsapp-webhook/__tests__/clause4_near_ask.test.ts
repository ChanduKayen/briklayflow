// CONSTITUTIONAL RECONNECTION · B code-floor (clause 4 / FLOOR — candidate-unsure → QUESTION, never silent
// miss). The deployed model collapses a terse update ("transformer resolved") to update_found:false despite
// an open "transformer humming" candidate. The prompt already says "return low, not false" — the MODEL
// disobeys, and model-disobedience isn't offline-testable. The DURABLE fix is a CODE floor independent of the
// model: when resolveInbound returns both-false BUT lexically-near candidates exist, open a which_item ask
// ("did you mean X?") instead of acked_didnt_catch. Reuses nearCandidateIds (was image-only).
//
// RED-FIRST: inject both-false + a near candidate → today a silent didn't-catch; after the floor, a pick.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const tfmrBI = { kind: 'issue' as const, id: 'iss-tfmr', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'transformer humming near the gate', taskName: null, cause: 'other' }
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: { 'iss-tfmr': { id: 'iss-tfmr', title: 'transformer humming near the gate', project_id: 'P1', status: 'OPEN' } },
  chase_batches: [{ id: 'b1', items: [tfmrBI] }],   // single-site batch → the unnamed message adopts P1
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const model = (dec: string, resolve: string) => (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? resolve : dec)
// decompose yields a progress item (so the message reaches runSingularUnit, not the A2 ask); resolveInbound
// returns BOTH-FALSE (the deployed model's miss). "transformer" overlaps the "transformer humming" candidate.
const DEC = JSON.stringify({ project_hint: null, items: [{ type: 'progress', text: 'transformer resolved', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }] })
const R_BOTH_FALSE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })

suite('siteops — clause 4 near-candidate floor (both-false + near → ASK which item, never silent miss)', () => {
  test('(near) both-false with a lexically-near candidate → which_item ask opens (not acked_didnt_catch)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'transformer resolved', { callModel: model(DEC, R_BOTH_FALSE) })

    const askedItem = fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
    const didntCatch = fake.outbox().some((b) => /Didn't catch/i.test(b))
    expect(askedItem).toBe(true)          // uncertainty → a QUESTION about the near candidate
    expect(didntCatch).toBe(false)        // NOT a silent miss
  })

  // guard — both-false with NO near candidate (genuinely unrelated) is still an honest didn't-catch.
  test('(guard) both-false with no near candidate → honest didn-t-catch', async () => {
    const fake = fakeSupabase(seed())
    const decUnrelated = JSON.stringify({ project_hint: null, items: [{ type: 'progress', text: 'weather is nice', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }] })
    await runSiteops(ctxFor(fake), 'weather is nice today', { callModel: model(decUnrelated, R_BOTH_FALSE) })

    const askedItem = fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
    const didntCatch = fake.outbox().some((b) => /Didn't catch/i.test(b))
    expect(askedItem).toBe(false)
    expect(didntCatch).toBe(true)
  })
})
