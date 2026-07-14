// STEP C1 — HELD readback (single-ask hold-and-fold). When a batch auto-resolves some items AND asks about
// one, the resolved summary is HELD (stashed in the ask's conversation) instead of flushed mid-turn; the
// answer folds it into ONE combined readback. NO SILENT DROP: if the ask is interrupted (or swept), the held
// summary is flushed anyway, and the pending item is parked + named.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops, commitInterruptedSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: { 'iss-w': { id: 'iss-w', title: 'wiring broke', project_id: 'P1', status: 'OPEN', cause: 'rework' } },
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const item = (text: string) => ({ type: 'issue', text, task_hint: null, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'ASM Elite' })
const DEC = JSON.stringify({ project_hint: 'ASM Elite', items: [item('slab crack'), item('wiring done')] })
const R_CREATE = JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'slab crack', location: null, project_hint: 'ASM Elite', confidence: 'high' }] }, update_found: { found: false, updates: [] } })
const R_NEAREST = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [], nearest: [{ target_id: 'iss-w', target_kind: 'issue', plausibility: 'med', action: 'progress', closure_explicit: false, reason: 'wiring ≈ the wiring issue' }] } })
const model = (_s: string, user: string): Promise<string> => {
  if (!user.startsWith('CANDIDATES:')) return Promise.resolve(DEC)
  const msg = user.split('MESSAGE:\n').pop() ?? ''
  return Promise.resolve(/slab/i.test(msg) ? R_CREATE : R_NEAREST)
}
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convoOf = (slots: any): any => ({ id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which item?', staged_entry_id: null, last_message_id: null, slots_so_far: slots })
const collisionSlots = (fake: ReturnType<typeof fakeSupabase>) =>
  fake.writesTo('wa_conversations').map((w) => w.payload?.slots_so_far).filter((s) => s?.kind === 'siteops_batch_collision').pop()

suite('siteops — Step C1: held readback (hold-and-fold, no silent drop)', () => {
  test('batch (auto-create + ask) → turn-1 HOLDS the resolved summary (no mid-turn flush), ask still sent', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'slab crack, wiring done', { callModel: model })
    expect(fake.outbox().some((b) => b.includes('❓'))).toBe(true)          // the ask went out
    expect(fake.outbox().some((b) => /logged new/i.test(b))).toBe(false)             // resolved summary HELD, not flushed
    expect(fake.outbox().some((b) => /updates? filed*/i.test(b))).toBe(false)
    // the resolved summary is stashed on the open ask conversation
    expect(!!collisionSlots(fake)?.held_readback).toBe(true)
  })

  test('answering the ask FOLDS held + answer into ONE combined readback (both items present)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'slab crack, wiring done', { callModel: model })
    const slots = collisionSlots(fake)
    await answerSiteops(ctxFor(fake), '1', convoOf(slots), { callModel: model })
    const combined = fake.outbox().find((b) => /updates? filed*/i.test(b)) ?? ''
    expect(/slab crack/i.test(combined)).toBe(true)      // the HELD auto-resolved item
    expect(/wiring/i.test(combined)).toBe(true)          // the answered item
  })

  test('INTERRUPTION of a held ask flushes the held summary (no silent drop) + parks the pending item', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'slab crack, wiring done', { callModel: model })
    const slots = collisionSlots(fake)
    const before = fake.outbox().length
    await commitInterruptedSiteops(ctxFor(fake), convoOf(slots))
    const after = fake.outbox().slice(before)
    expect(after.some((b) => /slab crack/i.test(b))).toBe(true)                 // held summary NOT dropped
    expect(fake.writesTo('siteops_unplaced').length >= 1).toBe(true)           // the pending item parked, not lost
  })
})
