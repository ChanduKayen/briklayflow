// THE RECALL FLOOR (clause 4) — candidate-unsure → QUESTION, never a silent miss.
//
// It used to be a CODE floor: both-false + a LEXICALLY-near candidate (raw token overlap) → ask. That fired on
// shared spelling, and the live probe (2026-07-09) showed the cost — "transformer arranged" was offered
// "Arrange for aggregate (kankara) and sand" (shared "arrange"), and "…except fifth floor" was offered four
// floors that were not the fifth (shared "wiring"). A wrong "did you mean X?" costs the supervisor several
// messages AND traps the thread, so it is worse than a clean miss.
//
// The floor is now the MODEL's `nearest`, judged by MEANING, and only `plausibility: "med"` asks. `low` and `[]`
// fall through to NOTHING_TO_UPDATE, which tells the supervisor exactly how to name the work. The lexical belt
// survives on the IMAGE path only.
//
// THE TRADE, stated plainly: this trusts the model to return a med nearest for a real match. If it returns
// both-false with nothing, we no longer manufacture a question out of word overlap — we say we didn't place it.

import { mentionsNothingToUpdate } from '../_siteops_resolution.ts'
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
// The model names its meaning-ranked nearest: same subject (the transformer), so it would BET on it → med.
const R_NEAREST_MED = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [], nearest: [{ target_id: 'iss-tfmr', target_kind: 'issue', plausibility: 'med', action: 'resolve', closure_explicit: true, reason: 'same subject: the transformer' }] } })
// A guess it would not bet on → low → no ask (the supervisor is shown how to name it instead).
const R_NEAREST_LOW = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [], nearest: [{ target_id: 'iss-tfmr', target_kind: 'issue', plausibility: 'low', action: 'progress', closure_explicit: false, reason: 'may relate to the transformer' }] } })

suite('siteops — clause 4 near-candidate floor (both-false + near → ASK which item, never silent miss)', () => {
  test('(near) both-false + a MED nearest → which_item ask opens (not acked_didnt_catch)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'transformer resolved', { callModel: model(DEC, R_NEAREST_MED) })

    const askedItem = fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
    const didntCatch = fake.outbox().some((b) => mentionsNothingToUpdate(b))
    expect(askedItem).toBe(true)          // uncertainty → a QUESTION about the near candidate
    expect(didntCatch).toBe(false)        // NOT a silent miss
  })

  // guard — both-false with an EMPTY nearest is an honest miss, and the reply teaches how to name the work.
  test('(guard) both-false with no nearest → honest guidance, no ask', async () => {
    const fake = fakeSupabase({ ...seed(), site_tasks: { 'tk-1': { task_id: 'tk-1', name: 'Slab', project_id: 'P1', status: 'PENDING' } } })
    const decUnrelated = JSON.stringify({ project_hint: null, items: [{ type: 'progress', text: 'weather is nice', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }] })
    await runSiteops(ctxFor(fake), 'weather is nice today', { callModel: model(decUnrelated, R_BOTH_FALSE) })

    const askedItem = fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
    const didntCatch = fake.outbox().some((b) => mentionsNothingToUpdate(b))
    expect(askedItem).toBe(false)
    expect(didntCatch).toBe(true)
  })

  // A LOW nearest is a guess. It must NOT ask — that is how "may relate to arranging materials" became a
  // question about kankara and sand.
  test('(low) both-false + a LOW nearest → NO ask; the guidance instead', async () => {
    const fake = fakeSupabase({ ...seed(), site_tasks: { 'tk-1': { task_id: 'tk-1', name: 'Slab', project_id: 'P1', status: 'PENDING' } } })
    await runSiteops(ctxFor(fake), 'transformer resolved', { callModel: model(DEC, R_NEAREST_LOW) })

    expect(fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')).toBe(false)
    expect(fake.outbox().some((b) => mentionsNothingToUpdate(b))).toBe(true)
  })
})
