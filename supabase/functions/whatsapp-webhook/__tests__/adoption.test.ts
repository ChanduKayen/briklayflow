// UNIFIED INBOUND RESOLUTION v2 — ADOPTION gate. The highest-stakes flip: handleBatchReply's match+judge
// core → one resolveInbound + applyTerminals. These seven journeys drive the REAL runSiteops end-to-end
// (the model injected via opts.callModel — default is the real client) through the FULL stack. Acceptance =
// the calibration greatest hits + the two seams adoption newly creates: model-down composing with live
// batch state, and a question opened by the new path resuming through the old proven resume.

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

  // (c) sari → the fast path fires, the LLM is NEVER called.
  test('(c) bare "sari" → fast path (LLM never called), chase ADDRESSING via bare_ack', async () => {
    const fake = fakeSupabase(baseSeed())
    let called = false
    await runSiteops(ctxFor(fake), 'sari', { callModel: () => { called = true; return Promise.resolve(RESOLVE) } })
    expect(called).toBe(false)
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'ADDRESSING')).toBe(true)
    expect(fake.trail().some((r) => r.type === 'bare_ack')).toBe(true)
  })

  // (d) both-axes → one combined readback, both effects real (resolve + create/park).
  test('(d) both-axes → issue RESOLVED + one combined readback', async () => {
    const fake = fakeSupabase(baseSeed())
    await runSiteops(ctxFor(fake), 'waterlogging fixed, tiles broke', { callModel: model(BOTH) })
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')).toBe(true)
    const reply = fake.writesTo('outbox').map((w) => w.payload?.payload?.body ?? '').find((b) => /Got it/.test(b)) ?? ''
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
  test('(f) model down → parked + honest reply, chase batch UNTOUCHED', async () => {
    const fake = fakeSupabase(baseSeed())
    await runSiteops(ctxFor(fake), 'వాటర్ లాగింగ్ ఏదో ఒకటి', { callModel: model('') })
    expect(fake.writesTo('siteops_unplaced').some((w) => w.payload?.reason === 'llm_unreadable')).toBe(true)
    expect(fake.outbox().some((b) => /logged it for review/i.test(b))).toBe(true)
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
