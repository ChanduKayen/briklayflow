// SINGULAR-FIRST RESTRUCTURE — STAGE-1 ACCEPTANCE JOURNEYS (a–g). Landed RED-FIRST in their own commit
// (two-commit discipline): these journeys are the spec the singular unit is built to, written against the
// TARGET behavior through the REAL entry points (runSiteops / answerSiteops / commitInterruptedSiteops).
//
// THE DESIGN (owner's, verbatim intent): an input arrives → normalize to text → resolve THE project (ask
// first if missing) → candidate set = THAT PROJECT ONLY (open issues+tasks+snags; a batch on that project
// ranks its items top — a PRIOR, never a gate) → ONE resolveInbound → update matches → apply per the
// existing ladder; no match → CREATE; nothing → didn't-catch. The enforcement floor stands untouched.
//
// Test-injection contract these journeys pin: opts.callModel drives EVERY model call in the unit —
// decompose (user prompt starts '<narration>') AND resolveInbound (user prompt starts 'CANDIDATES:').
// A dispatching stub answers each by prompt shape; capturing the calls lets a journey assert the
// CANDIDATE SET CONTENTS at the model boundary — cross-project invisibility by construction, not by guard.
//
// Rulings honored: E2 — the ask-first slots carry the raw message `text` (additive jsonb field).
// E4 — an interrupted project question parks as reason='project' (NO 'no_project'; pinned in c2).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops, commitInterruptedSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const waterBI = { kind: 'issue' as const, id: 'iss-water', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'other' }
const tilesBI = { kind: 'issue' as const, id: 'iss-tiles', orgId: ORG, projectId: 'P2', projectName: 'Soundharya', title: 'tiles not arrived at site', taskName: null, cause: 'material' }

// Two projects; Soundharya (P2) holds the open tiles issue; ASM Elite (P1) holds the chased waterlogging
// issue AND the cross-project BAIT (its own transformer issue — the live-probe wrong-match, re-armed).
const seed = (over: Partial<Seed> = {}): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  problems: {
    'iss-water': { id: 'iss-water', title: 'waterlogging in basement', project_id: 'P1', status: 'OPEN' },
    'iss-tiles': { id: 'iss-tiles', title: 'tiles not arrived at site', project_id: 'P2', status: 'OPEN' },
    'iss-tfmr-asm': { id: 'iss-tfmr-asm', title: 'transformer humming near the gate', project_id: 'P1', status: 'OPEN' },
  },
  chase_batches: [{ id: 'batch-1', items: [waterBI] }],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
  ...over,
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })

// ── the dispatching model stub (single injection point) ─────────────────────
interface Call { system: string; user: string }
const unitModel = (calls: Call[], stubs: { decompose?: string; resolve?: string }) =>
  (system: string, user: string): Promise<string> => {
    calls.push({ system, user })
    return Promise.resolve(user.startsWith('<narration>') ? (stubs.decompose ?? '') : (stubs.resolve ?? ''))
  }
const resolutionCalls = (calls: Call[]) => calls.filter((c) => c.user.startsWith('CANDIDATES:'))
const decomposeCalls = (calls: Call[]) => calls.filter((c) => c.user.startsWith('<narration>'))

// decompose-shaped raw response (the splitter/normalizer; interim per E5, dies in Phase 4)
const DEC = (projectHint: string | null, items: { type: string; text: string; project_hint?: string | null }[]) =>
  JSON.stringify({
    project_hint: projectHint,
    items: items.map((i) => ({
      type: i.type, text: i.text, task_hint: null, qc_statements: [],
      cause: i.type === 'issue' ? 'other' : null, cause_reason: null,
      owner_hint: null, date_hint: null, project_hint: i.project_hint ?? null,
    })),
  })

// resolution contracts
const R_NEW_TRANSFORMER = JSON.stringify({
  issue_snag_found: { found: true, items: [{ kind: 'issue', detail: 'transformer not working', location: null, project_hint: 'Soundharya', confidence: 'high' }] },
  update_found: { found: false, updates: [] },
})
const R_RESOLVE_TILES = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: 'iss-tiles', target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'tiles arrived' }] },
})

suite('siteops singular-first — Stage-1 acceptance journeys (a–g)', () => {
  // (a) THE MASTERY CASE (D5 CASE ONE, create half): a fresh issue for Soundharya arrives while an
  // UNRELATED chase batch is open on ASM Elite. The batch must be invisible — not consumed, not a router.
  test('(a) fresh issue at Soundharya + batch open on ASM Elite → CREATED at Soundharya, batch invisible', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(ctxFor(fake), 'transformer not working at Soundharya', {
      callModel: unitModel(calls, { decompose: DEC('Soundharya', [{ type: 'issue', text: 'transformer not working' }]), resolve: R_NEW_TRANSFORMER }),
    })
    // the create branch FIRES, on the right project
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P2')).toBe(true)
    // the ASM chase is untouched — no item update, no batch mutation
    expect(fake.writesTo('problems').some((w) => w.op === 'update')).toBe(false)
    expect(fake.writesTo('chase_batches').some((w) => w.op === 'update')).toBe(false)
    // and the ONE call was scoped to THE project — the batch's items were never offered
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(1)
    expect(rc[0].user.includes('iss-tiles')).toBe(true)
    expect(rc[0].user.includes('iss-water')).toBe(false)
  })

  // (b) an update that matches its OWN project's open issue → the existing ladder applies it
  // (HIGH + explicit closure → RESOLVE), undo armed; candidates were that project only, chase ranked ⭐.
  test('(b) "tiles arrived at Soundharya" matches its open issue → ladder RESOLVE + undo, single-project candidates', async () => {
    const fake = fakeSupabase(seed({ chase_batches: [{ id: 'batch-2', items: [tilesBI] }] }))
    const calls: Call[] = []
    await runSiteops(ctxFor(fake), 'tiles arrived at Soundharya', {
      callModel: unitModel(calls, { decompose: '', resolve: R_RESOLVE_TILES }),   // a resolution statement decomposes to nothing — the unit still runs
    })
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED' && w.filters.some(([k, v]) => k === 'id' && v === 'iss-tiles'))).toBe(true)
    expect(fake.writesTo('problems').some((w) => typeof w.payload?.active_resolve_event === 'string')).toBe(true)
    expect(fake.writesTo('outbox').some((w) => w.payload?.payload?.kind === 'buttons' && (w.payload?.payload?.buttons ?? []).some((b: { id: string }) => b.id === 'siteops_undo'))).toBe(true)
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(1)
    expect(rc[0].user.includes('⭐ [iss-tiles')).toBe(true)   // its own chase ranks top — a prior
    expect(rc[0].user.includes('iss-water')).toBe(false)      // other project invisible
    expect(rc[0].user.includes('iss-tfmr-asm')).toBe(false)
  })

  // (c) ask-first: a projectless item opens the question CARRYING the observation + raw text (E2);
  // the answer runs the REMAINDER of the unit from slots — picked project's candidates, no re-extraction.
  test('(c) projectless → question carries item + text; answer runs the remainder from slots, no re-extract', async () => {
    const fake = fakeSupabase(seed({ chase_batches: [] }))
    const calls: Call[] = []
    const cm = unitModel(calls, { decompose: DEC(null, [{ type: 'issue', text: 'transformer not working' }]), resolve: R_NEW_TRANSFORMER })
    await runSiteops(ctxFor(fake), 'transformer not working', { callModel: cm })

    const convoW = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    expect(!!convoW).toBe(true)
    const slots = convoW?.payload?.slots_so_far
    expect(Array.isArray(slots?.items) && slots.items.length > 0).toBe(true)   // the question CARRIES the observation
    expect(slots?.text).toBe('transformer not working')                        // E2: raw text rides the slots
    expect(resolutionCalls(calls).length).toBe(0)                              // ask FIRST — the one call waits

    const preDecomposes = decomposeCalls(calls).length
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which project?', staged_entry_id: null, last_message_id: null, slots_so_far: slots } as any
    await answerSiteops(ctxFor(fake), 'Soundharya', convo, { callModel: cm })
    expect(decomposeCalls(calls).length).toBe(preDecomposes)                   // never re-extracted
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(1)                                                  // the remainder ran: ONE call
    expect(rc[0].user.includes('iss-tiles')).toBe(true)                        // …with the PICKED project's candidates
    expect(rc[0].user.includes('iss-water')).toBe(false)
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P2')).toBe(true)
  })

  // (c2) E4 RULING PINNED: the held question, interrupted → parks with the EXISTING reason='project'
  // ('no_project' was not minted — the fake's CHECK enforcement would reject it), payload carried.
  test('(c2) interrupted project question → parks reason=project with the observation (E4)', async () => {
    const fake = fakeSupabase(seed({ chase_batches: [] }))
    const calls: Call[] = []
    await runSiteops(ctxFor(fake), 'transformer not working', {
      callModel: unitModel(calls, { decompose: DEC(null, [{ type: 'issue', text: 'transformer not working' }]), resolve: R_NEW_TRANSFORMER }),
    })
    const slots = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')?.payload?.slots_so_far
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which project?', staged_entry_id: null, last_message_id: null, slots_so_far: slots } as any
    await commitInterruptedSiteops(ctxFor(fake), convo)
    const park = fake.writesTo('siteops_unplaced').find((w) => w.payload?.reason === 'project')
    expect(!!park).toBe(true)
    expect(JSON.stringify(park?.payload?.observation ?? '').includes('transformer')).toBe(true)
  })

  // (d) the cardinality fast path survives the restructure — and now provably guards ALL model calls:
  // the injected callModel sees NOTHING (decompose included).
  test('(d) bare "sari" + lone chase → fast path, the model is NEVER called (not even decompose)', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(ctxFor(fake), 'sari', { callModel: unitModel(calls, {}) })
    expect(calls.length).toBe(0)
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'ADDRESSING')).toBe(true)
    expect(fake.trail().some((r) => r.type === 'bare_ack')).toBe(true)
  })

  // (e) THE STRUCTURAL GUARANTEE: cross-project bait is IMPOSSIBLE because it is never offered.
  // Assert the CANDIDATE SET CONTENTS at the model boundary, not just the outcome.
  test('(e) cross-project bait structurally impossible — candidate set is THE project only, by construction', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(ctxFor(fake), 'Soundharya lo transformer not working', {
      callModel: unitModel(calls, { decompose: DEC('Soundharya', [{ type: 'issue', text: 'transformer not working' }]), resolve: R_NEW_TRANSFORMER }),
    })
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(1)
    expect(rc[0].user.includes('iss-tfmr-asm')).toBe(false)   // the bait — ASM's own transformer — NOT offered
    expect(rc[0].user.includes('iss-water')).toBe(false)      // the chased item of the other project — NOT offered
    expect(rc[0].user.includes('iss-tiles')).toBe(true)       // THE project's open work — offered
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P2')).toBe(true)   // the live-probe failure, inverted
  })

  // (f) the enforcement floor stands: model down → five-part park + honest reply, batch untouched.
  test('(f1) model down + open chase → llm_unreadable park, honest reply, batch untouched', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'Soundharya emiti idi', { callModel: () => Promise.resolve('') })
    expect(fake.writesTo('siteops_unplaced').some((w) => w.payload?.reason === 'llm_unreadable')).toBe(true)
    expect(fake.outbox().some((b) => /logged it for review/i.test(b))).toBe(true)
    expect(fake.writesTo('problems').some((w) => w.op === 'update')).toBe(false)
    expect(fake.writesTo('chase_batches').some((w) => w.op === 'update')).toBe(false)
  })
  test('(f2) model down, NO batch → still a PARK, never a bare "didn\'t catch" drop', async () => {
    const fake = fakeSupabase(seed({ chase_batches: [] }))
    await runSiteops(ctxFor(fake), 'Soundharya transformer emiti', { callModel: () => Promise.resolve('') })
    expect(fake.writesTo('siteops_unplaced').some((w) => w.payload?.reason === 'llm_unreadable')).toBe(true)
    expect(fake.outbox().some((b) => /logged it for review/i.test(b))).toBe(true)
  })

  // (g) INTERIM COMPOUND RULE: first item through the unit; the rest parked HONESTLY as pending_stage2
  // (full fragment payload, replayable by Stage 2's loop), ONE combined readback telling both truths.
  // Never wrong-match a second item to handle it.
  test('(g) compound → first item resolves via the unit, second parks pending_stage2 with payload, one honest readback', async () => {
    const fake = fakeSupabase(seed())   // unrelated ASM chase open — must stay untouched throughout
    const calls: Call[] = []
    await runSiteops(ctxFor(fake), 'Soundharya lo tiles vacchayi, transformer not working', {
      callModel: unitModel(calls, {
        decompose: DEC(null, [
          { type: 'progress', text: 'tiles arrived at site', project_hint: 'Soundharya' },
          { type: 'issue', text: 'transformer not working', project_hint: 'Soundharya' },
        ]),
        resolve: R_RESOLVE_TILES,
      }),
    })
    // first fragment ran the unit: tiles matched its own open issue → ladder RESOLVE
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED' && w.filters.some(([k, v]) => k === 'id' && v === 'iss-tiles'))).toBe(true)
    // second fragment parked distinguished + replayable — never wrong-matched, never dropped
    const park = fake.writesTo('siteops_unplaced').find((w) => w.payload?.reason === 'pending_stage2')
    expect(!!park).toBe(true)
    expect(JSON.stringify(park?.payload?.observation ?? '').includes('transformer')).toBe(true)
    // ONE reply, both truths
    expect(fake.outbox().some((b) => /resolved|tiles/i.test(b) && /saved for review/i.test(b))).toBe(true)
    // the unrelated ASM chase untouched
    expect(fake.writesTo('problems').some((w) => w.filters.some(([k, v]) => k === 'id' && v === 'iss-water'))).toBe(false)
  })
})
