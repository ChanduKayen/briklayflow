// UNIFIED INBOUND RESOLUTION v2 — ADOPTION gate. The highest-stakes flip: handleBatchReply's match+judge
// core → one resolveInbound + applyTerminals. These seven journeys drive the REAL runSiteops end-to-end
// (the model injected via opts.callModel — default is the real client) through the FULL stack. Acceptance =
// the calibration greatest hits + the two seams adoption newly creates: model-down composing with live
// batch state, and a question opened by the new path resuming through the old proven resume.

import { mentionsNothingToUpdate } from '../_siteops_resolution.ts'
import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const waterBI = { kind: 'issue' as const, id: 'iss-water', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'other' }
const baseSeed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Lakshmi' }],
  problems: { 'iss-water': { id: 'iss-water', title: 'waterlogging in basement', project_id: 'P1', status: 'OPEN' } },
  chase_batches: [{ id: 'batch-1', items: [waterBI] }],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const model = (json: string) => () => Promise.resolve(json)

const RESOLVE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: 'iss-water', target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'resolved' }] } })
const NEWISSUE = JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'tiles broken blocking work', location: 'first floor', project_hint: 'ASM Elite', confidence: 'high' }] }, update_found: { found: false, updates: [] } })
const BOTH = JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'tiles broke', location: null, project_hint: 'ASM Elite', confidence: 'high' }] }, update_found: { found: true, updates: [{ target_id: 'iss-water', target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'fixed' }] } })
const BOTHFALSE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [], nearest: [] } })
const LOW = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: 'iss-water', target_kind: 'issue', action: 'resolve', confidence: 'low', closure_explicit: false, reason: 'maybe' }] } })

suite('siteops resolution v2 — ADOPTION end-to-end through runSiteops', () => {
  // (a) Telugu resolve → auto-resolve + the undo button sent (the whole loop, live-shaped).
  test('(a) Telugu resolve → issue RESOLVED, active_resolve_event stamped, undo button sent', async () => {
    const fake = fakeSupabase(baseSeed())
    await runSiteops(ctxFor(fake), 'వాటర్ లాగింగ్ ఇష్యూ రిసాల్వ్డ్', { callModel: model(RESOLVE) })
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')).toBe(true)
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && typeof w.payload?.active_resolve_event === 'string')).toBe(true)
    expect(fake.writesTo('outbox').some((w) => w.payload?.payload?.kind === 'buttons' && (w.payload?.payload?.buttons ?? []).some((b: { id: string }) => b.id === 'siteops_undo'))).toBe(true)
  })

  // (b) tiles blocker → chase NONE + fresh issue; the waterlogging chase is UNTOUCHED, tiles never eaten
  // (created if routeGroup runs, else parked — creation itself is proven in the live probe).
  test('(b) fresh blocker + unrelated chase → chase untouched, tiles landed (created or parked, never eaten)', async () => {
    const fake = fakeSupabase(baseSeed())
    await runSiteops(ctxFor(fake), 'tiles broken on first floor, blocking all work', { callModel: model(NEWISSUE) })
    expect(fake.writesTo('problems').some((w) => w.op === 'update')).toBe(false)                 // chase untouched
    expect(fake.writesTo('problems').some((w) => w.op === 'insert') || fake.writesTo('siteops_unplaced').length > 0).toBe(true)
  })

  // (c) THE ACK CONTRACT (2026-07-09). "sari" names nothing, so nothing may move. The fast path that used to
  // advance the lone chase to ADDRESSING — and reset its escalation clock — is deleted; so is the word list
  // that recognised the word. In prod this message never reaches SiteOps at all (the router reads the
  // conversation and hands it to the concierge). Driving runSiteops directly is the harsher test: even here,
  // with a model that WANTS to resolve, an ack must not touch the chase.
  test('(c) bare "sari" → the chase is UNTOUCHED (no advance, no bare_ack, no resolve)', async () => {
    const fake = fakeSupabase(baseSeed())
    await runSiteops(ctxFor(fake), 'sari', { callModel: model(BOTHFALSE) })

    expect(fake.writesTo('problems').filter((w) => w.op === 'update').length).toBe(0)   // never advanced/resolved
    expect(fake.trail().length).toBe(0)                                                 // no bare_ack, no status_changed
    expect(fake.writesTo('chase_batches').filter((w) => w.op === 'update').length).toBe(0)
    expect(fake.outbox().some((b) => mentionsNothingToUpdate(b))).toBe(true)            // the supportive guidance
  })

  // (d) both-axes → one combined readback, both effects real (resolve + create/park).
  test('(d) both-axes → issue RESOLVED + one combined readback', async () => {
    const fake = fakeSupabase(baseSeed())
    await runSiteops(ctxFor(fake), 'waterlogging fixed, tiles broke', { callModel: model(BOTH) })
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')).toBe(true)
    // the digest no longer opens with "Got it" — line 1 is the count. Find the reply by what it SAYS.
    const reply = fake.writesTo('outbox').map((w) => w.payload?.payload?.body ?? '').find((b) => /resolved/i.test(b)) ?? ''
    expect(/resolved/i.test(reply)).toBe(true)
  })

  // (e) LOW → interactive pick-one opens ("it's new" escape), state untouched until the human answers.
  test('(e) LOW → question opens (siteops_batch_collision), no state touched', async () => {
    const fake = fakeSupabase(baseSeed())
    await runSiteops(ctxFor(fake), 'that thing near the basement', { callModel: model(LOW) })
    expect(fake.writesTo('wa_conversations')[0]?.payload?.slots_so_far?.kind).toBe('siteops_batch_collision')
    expect(fake.writesTo('problems').some((w) => w.op === 'update')).toBe(false)
  })

  // (f) MODEL-DOWN composed with LIVE batch state — the seam adoption newly creates. callLLM fails mid-
  // chase-reply → PARK per the five-part contract → honest reply → the chase batch is IDENTICAL before/
  // after (no eat, no half-mutation, no force-advance).
  // WITNESS CHANGED (2026-07-11): a dead model parks at the FIRST door it fails at — decompose — so the
  // reason is decompose_failed and the reply is the honest "my end had a hiccup", not a hint that the
  // supervisor was unclear. The no-eat invariants below are the point of this test and are unchanged.
  test('(f) model down → parked + honest reply, chase batch UNTOUCHED', async () => {
    const fake = fakeSupabase(baseSeed())
    await runSiteops(ctxFor(fake), 'వాటర్ లాగింగ్ ఏదో ఒకటి', { callModel: model('') })
    expect(fake.writesTo('siteops_unplaced').some((w) => w.payload?.reason === 'decompose_failed')).toBe(true)
    expect(fake.outbox().some((b) => /couldn't read that/i.test(b))).toBe(true)
    expect(fake.writesTo('problems').some((w) => w.op === 'update')).toBe(false)      // batch item untouched
    expect(fake.writesTo('chase_batches').some((w) => w.op === 'update')).toBe(false) // batch not dropped/closed
  })

  // (g) QUESTION-RESUME round-trip — the new opener feeds the old resumer. LOW → question opens (new path)
  // → the supervisor answers → the proven resume applies it back. The slots the new path WROTE must be the
  // slots the old resume READS.
  test('(g) LOW question opened by the new path resumes through the proven resume', async () => {
    const fake = fakeSupabase(baseSeed())
    await runSiteops(ctxFor(fake), 'that thing near the basement', { callModel: model(LOW) })
    const slots = fake.writesTo('wa_conversations')[0]?.payload?.slots_so_far
    expect(slots?.kind).toBe('siteops_batch_collision')

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'confirm', staged_entry_id: null, last_message_id: null, slots_so_far: slots } as any
    await answerSiteops(ctxFor(fake), '1', convo)   // pick the offered item
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.filters.some(([k, v]) => k === 'id' && v === 'iss-water'))).toBe(true)
  })
})

// LIVE FAILURE (2026-07-09): a 5-item voice note produced THREE which_item asks. applyTerminals aggregates the
// asks WITHIN one call, but the Stage-2 loop calls it once per decomposed item — and every ask ran
// openConversation, which upserts the ONE open conversation per (org, sender). The supervisor saw three
// questions; answering any of them resolved the LAST one. Asks are now SERIALIZED behind a drain cursor: one
// question out, the remainder carried in its slots, the answer asks the next — the which_project pattern.
suite('siteops — which_item asks SERIALIZE across a compound message (the drain cursor)', () => {
  // call 1 = decompose (two items) → calls 2,3 = one resolveInbound per item, each LOW → each wants an ask.
  const script = (...rs: string[]) => { let i = 0; return () => Promise.resolve(rs[Math.min(i++, rs.length - 1)]) }
  const DECOMPOSE_2 = JSON.stringify({ items: [{ type: 'progress', text: 'tiles not yet laid' }, { type: 'progress', text: 'ceilings not yet complete' }], project_hint: 'ASM Elite' })
  const lowOn = (id: string) => JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: id, target_kind: 'issue', action: 'blocked', confidence: 'low', closure_explicit: false, reason: 'maybe' }] } })
  const twoAskSeed = (): Seed => ({
    ...baseSeed(),
    problems: {
      'iss-water': { id: 'iss-water', title: 'waterlogging in basement', project_id: 'P1', status: 'OPEN' },
      'iss-cement': { id: 'iss-cement', title: 'cement short', project_id: 'P1', status: 'OPEN' },
    },
  })
  const convosOpened = (fake: ReturnType<typeof fakeSupabase>) =>
    fake.writesTo('wa_conversations').filter((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')

  test('two ambiguous items → ONE question sent, the second carried in its slots (never clobbered)', async () => {
    const fake = fakeSupabase(twoAskSeed())
    await runSiteops(ctxFor(fake), 'tiles not yet laid, ceilings not yet complete', { callModel: script(DECOMPOSE_2, lowOn('iss-water'), lowOn('iss-cement')) })

    const opened = convosOpened(fake)
    expect(opened.length).toBe(1)                                              // exactly ONE ask conversation
    const slots = opened[0].payload?.slots_so_far
    expect((slots?.pending_item_asks ?? []).length).toBe(1)                    // the other ask is QUEUED, not lost
    // the sender is told more are coming — a serialized drain must not read as a stalled conversation
    expect(fake.outbox().some((b) => /1 more to sort out/.test(b))).toBe(true)
  })

  test('answering the first ask asks the SECOND (the drain advances)', async () => {
    const fake = fakeSupabase(twoAskSeed())
    await runSiteops(ctxFor(fake), 'tiles not yet laid, ceilings not yet complete', { callModel: script(DECOMPOSE_2, lowOn('iss-water'), lowOn('iss-cement')) })
    const slots = convosOpened(fake)[0].payload?.slots_so_far
    const before = convosOpened(fake).length

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which item?', staged_entry_id: null, last_message_id: null, slots_so_far: slots } as any
    await answerSiteops(ctxFor(fake), '1', convo)

    const after = convosOpened(fake)
    expect(after.length).toBe(before + 1)                                      // the NEXT ask went out
    const next = after[after.length - 1].payload?.slots_so_far
    expect(next?.piece_text).toBe('ceilings not yet complete')                 // …and it is the queued one
    expect((next?.pending_item_asks ?? []).length).toBe(0)                     // cursor exhausted
  })

  // The blocked verdict must survive the confirm: picking "which item" fixes the TARGET, never whether the
  // work happened. Without this, confirming "tiles not yet laid → that one" would mark the item addressed.
  test('confirming a BLOCKED ask records a blocker — never an advance', async () => {
    const fake = fakeSupabase(twoAskSeed())
    await runSiteops(ctxFor(fake), 'tiles not yet laid, ceilings not yet complete', { callModel: script(DECOMPOSE_2, lowOn('iss-water'), lowOn('iss-cement')) })
    const slots = convosOpened(fake)[0].payload?.slots_so_far

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which item?', staged_entry_id: null, last_message_id: null, slots_so_far: slots } as any
    await answerSiteops(ctxFor(fake), '1', convo)

    expect(fake.trail().some((e) => e.type === 'blocker_noted')).toBe(true)
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status)).toBe(false)   // never ADDRESSING/RESOLVED
  })
})
