// PROBE Bug 1 — the near-candidate which_item resurrected the number/index heuristic the sprint sequence
// deleted: it demanded a bare integer, positionally indexed a RE-RANKED candidate list ("1" → the wrong
// slab), and did not resolve a natural answer by meaning. The fix REUSES the existing typed-pick resolver
// (resolveTypedPick) against the STORED offered list (clause 2 — validate against the offered list, never
// re-derive from the reply), in ONE composed, numbered message (clause 5 — one readback), accepting the
// item name OR "new" — no integer-only demand.
//
// RED-FIRST both directions: j2 (format) is RED today (an interactive list with no visible numbers, not the
// composed numbered text). j1/j3 pin the corrected resolution (display number == stored item == resolved
// item; a natural label resolves). j4 guards the near-absent path (unchanged didn't-catch).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
// three OPEN "Slab — <floor>" problems on the sole project → all lexically near "slab", offered in seed order.
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: {
    'iss-first': { id: 'iss-first', title: 'Slab — First floor', project_id: 'P1', status: 'OPEN' },
    'iss-ground': { id: 'iss-ground', title: 'Slab — Ground floor', project_id: 'P1', status: 'OPEN' },
    'iss-second': { id: 'iss-second', title: 'Slab — Second floor', project_id: 'P1', status: 'OPEN' },
  },
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const DEC = JSON.stringify({ project_hint: null, items: [{ type: 'progress', text: 'slab done', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }] })
const R_BOTH_FALSE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })
const model = (dec: string, resolve: string) => (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? resolve : dec)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convoOf = (slots: any): any => ({ id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which item?', staged_entry_id: null, last_message_id: null, slots_so_far: slots })
// run the ask, return the frozen offered-list slots the resume will validate against.
async function ask(fake: ReturnType<typeof fakeSupabase>): Promise<Record<string, unknown>> {
  await runSiteops(ctxFor(fake), 'slab done', { callModel: model(DEC, R_BOTH_FALSE) })
  const conv = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
  if (!conv) throw new Error('no which_item convo opened')
  return conv.payload.slots_so_far
}
const addressed = (fake: ReturnType<typeof fakeSupabase>, id: string) =>
  fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'ADDRESSING' && w.filters.some(([k, v]) => k === 'id' && v === id))

suite('siteops — Bug 1: near-candidate which_item reuses typed-pick (offered-list, one message, no integer-only)', () => {
  // j1 (the corruption) — "1" resolves to the FIRST OFFERED item (slots.candidates[0]), by the stored list,
  // never a re-derived one. The offered order is what the numbered message shows, so display == resolution.
  test('(j1) "1" resolves to the first OFFERED item (stored list), not a re-derived one', async () => {
    const fake = fakeSupabase(seed())
    const slots = await ask(fake)
    const offered = (slots.candidates as { id: string }[])
    await answerSiteops(ctxFor(fake), '1', convoOf(slots), { callModel: model(DEC, R_BOTH_FALSE) })
    expect(addressed(fake, offered[0].id)).toBe(true)     // offered[0] is 'iss-first' — the FIRST offered row
    expect(offered[0].id).toBe('iss-first')
  })

  // j2 (one message, the format RED) — the question is ONE composed TEXT message that NUMBERS the offered
  // list (visible index == stored index), not an interactive list with no numbers and not N messages.
  test('(j2) the which_item question is ONE composed, numbered message', async () => {
    const fake = fakeSupabase(seed())
    await ask(fake)
    const qs = fake.outbox().filter((b) => /which of these/i.test(b))
    expect(qs.length).toBe(1)                                 // ONE message, not one-per-candidate
    expect(/1\.\s*Slab — First/.test(qs[0])).toBe(true)       // visible number bound to the first offered item
    expect(/2\.\s*Slab — Ground/.test(qs[0])).toBe(true)
    expect(/3\.\s*Slab — Second/.test(qs[0])).toBe(true)
    expect(/\bnew\b/i.test(qs[0])).toBe(true)                 // natural-answer exit, not integer-only
  })

  // j3 (natural answer) — a typed item name (not a number) resolves by MEANING via resolveTypedPick.
  test('(j3) "Slab — Ground" (natural, not a number) resolves to that offered item', async () => {
    const fake = fakeSupabase(seed())
    const slots = await ask(fake)
    await answerSiteops(ctxFor(fake), 'Slab — Ground', convoOf(slots), { callModel: model(DEC, R_BOTH_FALSE) })
    expect(addressed(fake, 'iss-ground')).toBe(true)
    expect(addressed(fake, 'iss-first')).toBe(false)      // resolved by name, not by a positional guess
  })

  // j4 (guard) — near ABSENT (an unrelated observation) → honest didn't-catch, no which_item ask (unchanged).
  test('(j4) both-false with no near candidate → didn-t-catch, no ask', async () => {
    const fake = fakeSupabase(seed())
    const decUnrelated = JSON.stringify({ project_hint: null, items: [{ type: 'progress', text: 'weather is nice', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }] })
    await runSiteops(ctxFor(fake), 'weather is nice today', { callModel: model(decUnrelated, R_BOTH_FALSE) })
    expect(fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')).toBe(false)
    expect(fake.outbox().some((b) => /Didn't catch/i.test(b))).toBe(true)
  })
})
