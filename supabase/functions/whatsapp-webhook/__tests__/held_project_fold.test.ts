// STEP C2c — HELD fold across the which_PROJECT ask (not just which_item). A compound that auto-resolves
// some items AND has an unresolved-site item HOLDS the resolved summary behind the "which project?" ask; the
// project answer runs that item and FOLDS held + its outcome into ONE final readback. (C1 covered which_item;
// this closes the which_project path — piecewise-but-correct before, one clean readback now.)

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  problems: {}, chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const it = (text: string, hint: string) => ({ type: 'issue', text, task_hint: null, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: hint })
const DEC = JSON.stringify({ project_hint: null, items: [it('slab crack', 'ASM Elite'), it('cement short', 'ghost site')] })
const R_CREATE = (detail: string, hint: string) => JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail, location: null, project_hint: hint, confidence: 'high' }] }, update_found: { found: false, updates: [] } })
const model = (_s: string, user: string): Promise<string> => {
  if (!user.startsWith('CANDIDATES:')) return Promise.resolve(DEC)
  const msg = user.split('MESSAGE:\n').pop() ?? ''
  return Promise.resolve(/slab/i.test(msg) ? R_CREATE('slab crack', 'ASM Elite') : R_CREATE('cement short', 'Soundharya'))
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convoOf = (slots: any): any => ({ id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which project?', staged_entry_id: null, last_message_id: null, slots_so_far: slots })
const projectSlots = (fake: ReturnType<typeof fakeSupabase>) =>
  fake.writesTo('wa_conversations').map((w) => w.payload?.slots_so_far).filter((s) => s?.kind === 'siteops_project').pop()

suite('siteops — Step C2c: held fold across the which_project ask', () => {
  test('resolved item + unresolved-site item → turn-1 HOLDS (no mid-turn flush), which_project ask sent', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack, ghost site lo cement short', { callModel: model })
    expect(fake.outbox().some((b) => /which project/i.test(b))).toBe(true)          // the site ask
    expect(fake.outbox().some((b) => /logged new/i.test(b))).toBe(false)            // resolved summary HELD
    expect(!!projectSlots(fake)?.held_readback).toBe(true)                          // stashed on the which_project convo
  })

  test('answering the project FOLDS held + the sited item into ONE combined readback', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack, ghost site lo cement short', { callModel: model })
    const slots = projectSlots(fake)
    await answerSiteops(ctxFor(fake), '2', convoOf(slots), { callModel: model })   // pick Soundharya (P2)
    const combined = fake.outbox().find((b) => /updates? filed*/i.test(b)) ?? ''
    expect(/slab crack/i.test(combined)).toBe(true)      // the HELD auto-resolved item
    expect(/cement short/i.test(combined)).toBe(true)    // the now-sited item
  })
})
