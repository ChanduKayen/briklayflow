// CONSTITUTIONAL RECONNECTION · step 3 — the PAYOFF, pinned END-TO-END. It is not enough that the ask
// OPENS (steps 1-2); the chain must RECONNECT: ask → answer → the update actually APPLIES. These guards pin
// both floors through the resume so neither can silently break again (untested = unenforced).
//
//   chain1 (clause 2): unresolvable closure → ask "which site?" → pick → the closure RESOLVES the issue.
//   chain2 (clause 4): terse update the model missed → ask "which item?" → pick → it ADDRESSES the issue.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const base = () => ({
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const progress = (text: string) => ({ type: 'progress', text, task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null })
const emptyDec = JSON.stringify({ project_hint: null, items: [] })
const decProgress = JSON.stringify({ project_hint: null, items: [progress('transformer resolved')] })
const R_RESOLVE = (id: string) => JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: id, target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'cleared' }] } })
const R_BOTH_FALSE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })
const model = (dec: string, resolve: string) => (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? resolve : dec)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convoOf = (kind: string, slots: any): any => ({ id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: kind, staged_entry_id: null, last_message_id: null, slots_so_far: slots })

suite('siteops — reconnection chain (ask → answer → apply, end-to-end)', () => {
  // chain1 — clause 2: an unresolvable closure ("water problem solved at asm") asks which site; picking it
  // runs resolveInbound with THAT project's candidates and RESOLVES the issue. The closure is never lost.
  test('(chain1) unresolved closure → ask which site → pick → the update RESOLVES', async () => {
    const seed: Seed = { ...base(), projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }], problems: { 'iss-water': { id: 'iss-water', title: 'waterlogging in basement', project_id: 'P1', status: 'OPEN' } }, chase_batches: [] }
    const fake = fakeSupabase(seed)
    const m = model(emptyDec, R_RESOLVE('iss-water'))
    await runSiteops(ctxFor(fake), 'water problem solved at asm', { callModel: m })

    const conv = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    expect(!!conv).toBe(true)                                        // asked (step-1 floor)
    await answerSiteops(ctxFor(fake), 'ASM Elite', convoOf('which project?', conv!.payload.slots_so_far), { callModel: m })

    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED' && w.filters.some(([k, v]) => k === 'id' && v === 'iss-water'))).toBe(true)   // the PAYOFF
  })

  // chain2 — clause 4: a terse update the model missed ("transformer resolved") asks which item; picking it
  // ADDRESSES the issue (verdict-less confirm → addressing). The terse update lands, never a silent miss.
  test('(chain2) both-false + near → ask which item → pick → the update ADDRESSES', async () => {
    const tfmrBI = { kind: 'issue' as const, id: 'iss-tfmr', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'transformer humming near the gate', taskName: null, cause: 'other' }
    const seed: Seed = { ...base(), projects: [{ project_id: 'P1', name: 'ASM Elite' }], problems: { 'iss-tfmr': { id: 'iss-tfmr', title: 'transformer humming near the gate', project_id: 'P1', status: 'OPEN' } }, chase_batches: [{ id: 'b1', items: [tfmrBI] }] }
    const fake = fakeSupabase(seed)
    await runSiteops(ctxFor(fake), 'transformer resolved', { callModel: model(decProgress, R_BOTH_FALSE) })

    const conv = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
    expect(!!conv).toBe(true)                                        // asked (step-2 floor)
    await answerSiteops(ctxFor(fake), '1', convoOf('which item?', conv!.payload.slots_so_far))

    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'ADDRESSING' && w.filters.some(([k, v]) => k === 'id' && v === 'iss-tfmr'))).toBe(true)   // the PAYOFF
  })
})
