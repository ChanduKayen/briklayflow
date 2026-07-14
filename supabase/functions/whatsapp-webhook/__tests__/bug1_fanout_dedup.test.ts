// PROBE Bug 1 (REAL fix) — ONE emitter, delete the duplicates. The near-floor was fixed in isolation, but
// TWO more candidate-question emitters survived: the ladder's LOW-confidence ask (askResolutionQuestion,
// t.update branch) and the legacy batch-collision copy. The ladder ask is emitted ONCE PER TERMINAL in
// applyTerminals — so a message the model resolves to N low-confidence candidates FANS OUT into N separate
// number-less "Is this about X?" messages ("Wiring done at asm" → five messages, no numbers), and a natural
// answer to a number-less list can't resolve.
//
// THE FIX (this suite pins it): every which_item ask routes through ONE shared composer (askItemPick) — the
// near-floor's correct impl canonicalized: ONE composed NUMBERED message, the offered list frozen into the
// siteops_batch_collision slots at ask-time (display index == stored index), the reply resolved BY MEANING
// via resolveTypedPick against that STORED list. The per-terminal ladder ask + the legacy collision copy are
// deleted. One composer, one resolve path — the fan-out AND the corruption class die together, not whacked.
//
// RED-FIRST: j2 is RED today (the ladder shape fans out into N messages, none numbered). j1 pins the same
// invariants on the near-floor emitter; j4 is the structural guard that a SECOND composer / resolve path
// cannot reappear (the property that made this a three-copy bug in the first place).

import { readFileSync } from 'node:fs'
import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convoOf = (slots: any): any => ({ id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which item?', staged_entry_id: null, last_message_id: null, slots_so_far: slots })
const model = (dec: string, resolve: string) => (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? resolve : dec)
const addressed = (fake: ReturnType<typeof fakeSupabase>, id: string) =>
  fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'ADDRESSING' && w.filters.some(([k, v]) => k === 'id' && v === id))
const askConvo = (fake: ReturnType<typeof fakeSupabase>): Record<string, unknown> => {
  const conv = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
  if (!conv) throw new Error('no which_item convo opened')
  return conv.payload.slots_so_far
}

// ── near-floor emitter (both-false + lexically-near candidates) ──────────────────────────────────────────
const nearSeed = (): Seed => ({
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
const DEC_SLAB = JSON.stringify({ project_hint: 'ASM Elite', items: [{ type: 'progress', text: 'slab done', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'ASM Elite' }] })
// The near-floor ask is raised by the model's MEANING-ranked nearest (med) now; the lexical belt that used to
// raise it on token overlap is image-only since 2026-07-09. Offered order == stored order == resolved order.
const nr = (id: string) => ({ target_id: id, target_kind: 'issue', plausibility: 'med', action: 'progress', closure_explicit: false, reason: 'same slab work' })
const BOTH_FALSE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [], nearest: [nr('iss-first'), nr('iss-ground'), nr('iss-second')] } })

// ── ladder LOW-confidence emitter ("Wiring done at asm" shape: N low-conf candidate updates on one piece) ─
const wireSeed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: {
    'w-first': { id: 'w-first', title: 'Wiring — First floor', project_id: 'P1', status: 'OPEN' },
    'w-second': { id: 'w-second', title: 'Wiring — Second floor', project_id: 'P1', status: 'OPEN' },
    'w-third': { id: 'w-third', title: 'Wiring — Third floor', project_id: 'P1', status: 'OPEN' },
  },
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const DEC_WIRE = JSON.stringify({ project_hint: 'ASM Elite', items: [{ type: 'progress', text: 'wiring done', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'ASM Elite' }] })
const u = (id: string) => ({ target_id: id, target_kind: 'issue', action: 'progress', confidence: 'low', closure_explicit: false, reason: 'wiring done — which floor?' })
const LADDER_LOW = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [u('w-first'), u('w-second'), u('w-third')] } })

/** The pick's ROWS — where the candidates live now that the body no longer reprints them. */
const pickList = (fake: ReturnType<typeof fakeSupabase>): { rows: { id: string; title: string; description?: string }[] } | undefined =>
  fake.writesTo('outbox').map((w) => w.payload?.payload).find((p) => p?.kind === 'list')

suite('siteops — Bug 1 REAL fix: ONE which_item emitter (near-floor AND ladder), no fan-out, offered-list resolution', () => {
  // j1 (near-floor) — the already-fixed emitter still holds the shared invariants: ONE numbered message,
  // "2" → the SECOND offered item (display == resolution), a natural label resolves by meaning.
  test('(j1) near-floor: ONE numbered message; "2" → stored[1]; a natural label resolves', async () => {
    const fake = fakeSupabase(nearSeed())
    await runSiteops(ctxFor(fake), 'slab done', { callModel: model(DEC_SLAB, BOTH_FALSE) })
    const asks = fake.outbox().filter((b) => b.includes('❓'))
    expect(asks.length).toBe(1)
    // the OFFERED ORDER is the rows' order — the body no longer reprints them (the duplicate-print P1)
    const rows = pickList(fake)!.rows
    expect(rows.slice(0, 2).map((r) => r.description)).toEqual(['Slab — First floor', 'Slab — Ground floor'])

    const slots = askConvo(fake)
    const offered = slots.candidates as { id: string }[]
    expect(offered[1].id).toBe('iss-ground')
    await answerSiteops(ctxFor(fake), '2', convoOf(slots), { callModel: model(DEC_SLAB, BOTH_FALSE) })
    expect(addressed(fake, 'iss-ground')).toBe(true)      // "2" → the SECOND stored item, not a re-derived one
    expect(addressed(fake, 'iss-first')).toBe(false)
  })

  // j2 (ladder low-conf — THE FAN-OUT, RED today) — a message the model resolves to THREE low-confidence
  // candidates must ask ONE numbered question, not three number-less "Is this about X?" messages.
  test('(j2) ladder low-conf: N candidates → ONE composed numbered message (not N)', async () => {
    const fake = fakeSupabase(wireSeed())
    await runSiteops(ctxFor(fake), 'wiring done at asm', { callModel: model(DEC_WIRE, LADDER_LOW) })
    const asks = fake.outbox().filter((b) => b.includes('❓'))
    expect(asks.length).toBe(1)                                  // RED today: THREE messages, one per low-conf update
    expect(/Which one is it\?|Which work is this\?|Where should this go\?/.test(asks[0])).toBe(true)
    const rows = pickList(fake)!.rows                            // ONE list, three candidates, in offered order
    expect(rows.slice(0, 3).map((r) => r.description))
      .toEqual(['Wiring — First floor', 'Wiring — Second floor', 'Wiring — Third floor'])
    expect(/\bnew\b/i.test(rows[3].title)).toBe(true)            // the "it's new" escape
  })

  // j2b (ladder resolution by NUMBER) — "2" resolves to the SECOND stored candidate: display == resolution.
  test('(j2b) ladder pick "2" → the SECOND stored item', async () => {
    const fake = fakeSupabase(wireSeed())
    await runSiteops(ctxFor(fake), 'wiring done at asm', { callModel: model(DEC_WIRE, LADDER_LOW) })
    const slots = askConvo(fake)
    const offered = slots.candidates as { id: string }[]
    expect(offered[1].id).toBe('w-second')
    await answerSiteops(ctxFor(fake), '2', convoOf(slots), { callModel: model(DEC_WIRE, LADDER_LOW) })
    expect(addressed(fake, 'w-second')).toBe(true)
    expect(addressed(fake, 'w-first')).toBe(false)
  })

  // j2c (ladder resolution by MEANING) — a typed label (not a number) resolves against the stored list.
  test('(j2c) ladder natural answer "Second" → that stored item, by meaning', async () => {
    const fake = fakeSupabase(wireSeed())
    await runSiteops(ctxFor(fake), 'wiring done at asm', { callModel: model(DEC_WIRE, LADDER_LOW) })
    const slots = askConvo(fake)
    await answerSiteops(ctxFor(fake), 'Second', convoOf(slots), { callModel: model(DEC_WIRE, LADDER_LOW) })
    expect(addressed(fake, 'w-second')).toBe(true)
    expect(addressed(fake, 'w-first')).toBe(false)
  })

  // j4 (structural guard) — the property that made this a three-copy bug: there must be exactly ONE which_item
  // composer and ONE resolve path. Pin it so a future fourth copy / positional re-derive can't reappear.
  test('(j4) exactly ONE which_item composer and ONE resolve path (no second sender, no re-derive)', () => {
    const src = readFileSync('supabase/functions/whatsapp-webhook/_agents/siteops.ts', 'utf8')

    // ONE composer — the question sentences exist in exactly one place (the axis map inside
    // composeItemPickBody), and exactly one call site builds an item pick's body.
    expect((src.match(/Which work is this\?/g) ?? []).length).toBe(1)
    expect((src.match(/composeItemPickBody\(/g) ?? []).length).toBe(2)   // the definition + its ONE caller
    expect(/async function askItemPick\b/.test(src)).toBe(true)

    // askResolutionQuestion no longer emits a which_item ask — every which_item ask routes through the
    // aggregated composer (place_photo / which_project stay; they are not item-candidate picks).
    const arq = src.slice(src.indexOf('async function askResolutionQuestion'), src.indexOf('export async function applyTerminals'))
    expect(arq.length > 0).toBe(true)
    expect(/about === 'which_item'/.test(arq)).toBe(false)

    // ONE resolve path — the siteops_batch_collision resume resolves via resolveTypedPick, with NO positional
    // re-derive (findIndex / num-1) that could diverge display from resolution.
    const resume = src.slice(src.indexOf("if (slots.kind === 'siteops_batch_collision')"), src.indexOf("if (slots.kind === 'siteops_photo_pick')"))
    expect(resume.length > 0).toBe(true)
    expect(/resolveTypedPick\(/.test(resume)).toBe(true)
    expect(/findIndex\(/.test(resume)).toBe(false)
    expect(/num - 1/.test(resume)).toBe(false)
  })
})

// ── typed-answer resolution: a NATURAL answer resolves by MEANING against the stored list ────────────────
// The composer + offered-list + NUMBER resolution all work; the residual is that a typed label
// ("Fourth floor") didn't resolve — resolveTypedPick matched only whole-phrase substring against the
// shortLabel-TRUNCATED label ("Wiring — Fourth", "floor" dropped). Fix: match the FULL title by whole-phrase
// containment OR shared-token overlap, UNIQUE-winner only; an ambiguous / no-match answer still re-prompts
// (never mis-resolves, never eats), and a BARE number still resolves positionally (display == resolution).
const cand = (id: string, title: string) => ({ id, kind: 'issue' as const, orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title, cause: null })
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const collSlots = (cands: any[]) => ({ kind: 'siteops_batch_collision', status: 'still_open', piece_text: 'wiring done', project_id: 'P1', narration_id: 'narr-1', image: null, candidates: cands })
const fourFloors = () => [cand('w-first', 'Wiring — First floor'), cand('w-second', 'Wiring — Second floor'), cand('w-third', 'Wiring — Third floor'), cand('w-fourth', 'Wiring — Fourth floor')]
const floorSeed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  problems: Object.fromEntries(fourFloors().map((c) => [c.id, { id: c.id, title: c.title, project_id: 'P1', status: 'OPEN' }])),
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})

suite('siteops — Bug 1 typed-answer resolution (natural answer resolves by meaning; guards hold)', () => {
  // j5 (THE RESIDUAL, RED today) — "Fourth floor" shares the distinctive token "Fourth" with "Wiring —
  // Fourth floor" but is not a whole-phrase substring of the truncated label → currently misses.
  test('(j5) natural answer "Fourth floor" → "Wiring — Fourth floor" by meaning', async () => {
    const fake = fakeSupabase(floorSeed())
    await answerSiteops(ctxFor(fake), 'Fourth floor', convoOf(collSlots(fourFloors())))
    expect(addressed(fake, 'w-fourth')).toBe(true)
    expect(addressed(fake, 'w-first')).toBe(false)     // resolved by meaning, not an arbitrary/positional guess
  })

  // j5b (number path survives) — a BARE number still resolves positionally: display == resolution.
  test('(j5b) bare number "4" → the FOURTH stored item (regression guard)', async () => {
    const fake = fakeSupabase(floorSeed())
    await answerSiteops(ctxFor(fake), '4', convoOf(collSlots(fourFloors())))
    expect(addressed(fake, 'w-fourth')).toBe(true)
    expect(addressed(fake, 'w-first')).toBe(false)
  })

  // j6 — an ambiguous reply ("floor", shared by all four) resolves to NONE of the frozen offered list. That is
  // not something to guess about: it is not an answer. Under the AGENT-AGNOSTIC pending-credibility design
  // (2026-07-11) the answer handler does NOTHING here except return the verdict — it neither parks nor closes
  // nor touches domain state. The DISPATCHER owns the pending question's fate: it stashes P, handles the fresh
  // turn, then RE-SURFACES P (with a Dismiss button) or DROPS it with a notice if the new turn raised its own
  // question. So the offered pick is left completely untouched here.
  //
  // This replaces the old nag ("Reply with the item, or say *new*"). The nag's sibling branch — judgePending
  // → "No problem — I'll check back on it next time." — is what answered a ₹25,000 payment on 2026-07-09.
  test('(j6) ambiguous "floor" (shared by all) → not an answer: nothing touched, dispatcher owns re-surface', async () => {
    const fake = fakeSupabase(floorSeed())
    const verdict = await answerSiteops(ctxFor(fake), 'floor', convoOf(collSlots(fourFloors())))
    expect(verdict).toBe('not_an_answer')
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'ADDRESSING')).toBe(false)
    expect(fake.writesTo('siteops_unplaced').length).toBe(0)   // agent parks NOTHING — the dispatcher re-surfaces/drops
    expect(fake.writesTo('wa_conversations').some((w) => w.payload?.status === 'CLOSED')).toBe(false)   // P left OPEN for the dispatcher to stash
  })

  // j7 (numeric guard) — a digit-BEARING natural answer resolves by LABEL, not by the first-digit-anywhere
  // positional hijack. "Phase 2 panel" must land on "Wiring — Phase 2 panel", not the 2nd stored item.
  test('(j7) digit-bearing answer "Phase 2 panel" → resolves by label, not positional index', async () => {
    const cands = [cand('w-a', 'Wiring — Main board'), cand('w-b', 'Wiring — Riser conduit'), cand('w-phase2', 'Wiring — Phase 2 panel')]
    const fake = fakeSupabase({
      projects: [{ project_id: 'P1', name: 'ASM Elite' }],
      problems: Object.fromEntries(cands.map((c) => [c.id, { id: c.id, title: c.title, project_id: 'P1', status: 'OPEN' }])),
      wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
      user_profiles: [{ id: 'u1', name: 'Ramesh' }],
      site_narration_id: 'narr-1',
    })
    await answerSiteops(ctxFor(fake), 'Phase 2 panel', convoOf(collSlots(cands)))
    expect(addressed(fake, 'w-phase2')).toBe(true)
    expect(addressed(fake, 'w-b')).toBe(false)         // NOT stored[1] — the old /(\d+)/ first-digit hijack is gone
  })

  // j8 (LIVE probe residual, RED) — supervisors type the floor as a NUMERAL ordinal ("4th floor"), which the
  // word-token matcher couldn't bridge to "Wiring — Fourth floor" ("4th" != "fourth"), and "floor" alone is
  // ambiguous. Ordinal/numeral normalization (4th <-> fourth) makes the distinctive floor token match.
  test('(j8) numeral ordinal "4th floor" → "Wiring — Fourth floor"', async () => {
    const fake = fakeSupabase(floorSeed())
    await answerSiteops(ctxFor(fake), '4th floor', convoOf(collSlots(fourFloors())))
    expect(addressed(fake, 'w-fourth')).toBe(true)
    expect(addressed(fake, 'w-first')).toBe(false)
  })

  // j8b — a bare numeral ordinal with no "floor" word still resolves by the distinctive ordinal token.
  test('(j8b) "2nd" → the Second-floor item (ordinal token, not positional)', async () => {
    const fake = fakeSupabase(floorSeed())
    await answerSiteops(ctxFor(fake), '2nd', convoOf(collSlots(fourFloors())))
    expect(addressed(fake, 'w-second')).toBe(true)
    expect(addressed(fake, 'w-first')).toBe(false)
  })
})
