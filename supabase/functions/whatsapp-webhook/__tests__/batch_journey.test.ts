// JOURNEY GATE — the testing corollary to the ASM Elite postmortem: a PURE test pins a DECISION; only a
// JOURNEY test pins that the decision is REACHED. batch_reply.test proves classifyReplyFragment in
// isolation (the terse-ack force-match is green there) — yet in prod a bare "sari" and a Telugu
// "waterlogging resolved" both bounced off "Didn't catch a site update", because decompose renders them
// to zero items and runSiteops dead-ended the empty case BEFORE handleBatchReply ever saw it. The pure
// gate was green while the wiring was broken. These tests drive the REAL runSiteops over a fake supabase
// (no LLM key in-harness → decompose throws exactly as the empty-valve does in prod) and assert the chase
// reply actually reaches the batch handler and touches the chase item.
//
// RED FIRST (intentional): tests 1, 3 and the seam micro-test are RED against the behavior-preserving
// seam extraction and go GREEN when Defect A flips routeEmptyDecompose. Their red state IS the artifact —
// it documents that today's 94-green gate was lying by omission about this path.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'
import { routeEmptyDecompose, classifyReplyFragment, type BatchItem } from '../_siteops_batch.ts'

const SENDER = '919900000000'
const ORG = 'org-1'
const CHASE_ID = 'prob-water'

/** A lone OPEN waterlogging chase, on the "ASM Elite" project, in this sender's batch. Two projects are
 *  seeded so resolveProject does NOT auto-assume (mirrors the 6-active-projects reality where AUTO never
 *  fires) — the Telugu-mangled site name resolves to nothing, and the lone chase force-matches anyway. */
function loneChaseSeed(): Seed {
  const item: BatchItem = {
    kind: 'issue', id: CHASE_ID, orgId: ORG, projectId: 'proj-asm', projectName: 'ASM Elite',
    title: 'waterlogging in basement', taskName: null, cause: 'other',
  }
  return {
    chase_batches: [{ id: 'batch-1', items: [item] }],
    projects: [{ project_id: 'proj-asm', name: 'ASM Elite' }, { project_id: 'proj-lak', name: 'Lakshmi Villa' }],
    problems: { [CHASE_ID]: { status: 'OPEN' } },
    wa_registered_numbers: [{ user_id: 'user-1', phone_number: SENDER, is_active: true }],
    user_profiles: [{ id: 'user-1', name: 'Ramesh' }],
    site_narration_id: 'narr-1',
  }
}

function ctxFor(fake: ReturnType<typeof fakeSupabase>) {
  return { supabase: fake, from: SENDER, orgId: ORG, wamid: 'wamid-1', lang: 'te' as const }
}

suite('siteops empty-decompose JOURNEY (reachability — Defect A)', () => {
  // TEST 1 — the reported failure, now under v2 ADOPTION. A Telugu transcript that decomposes to nothing
  // still reaches the unified engine (Defect-A wiring intact). With NO model key in-harness it PARKS
  // honestly ("logged for review") — never the "Didn't catch" dead-end (the Defect-A invariant), and never
  // force-advanced on a guess. In PROD the model resolves it (see adoption (a)).
  test('(1) Telugu "waterlogging resolved" + open lone chase → reaches the engine, honestly parked (not "didn\'t catch")', async () => {
    const fake = fakeSupabase(loneChaseSeed())
    await runSiteops(ctxFor(fake), 'వాటర్ లాగింగ్ ఇష్యూ ఏసీ ఎమ్ఎల్ఐటీ రిసాల్వ్డ్')

    expect(fake.outbox().some((b) => /Didn't catch/i.test(b))).toBe(false)   // not dead-ended (Defect-A invariant)
    expect(fake.writesTo('siteops_unplaced').length).toBe(1)                 // reached the engine, held for review
  })

  // TEST 3 — the stranded shortcut, un-stranded. batch_reply.test (b) proves "sari" force-matches PURELY;
  // this proves it actually resolves the chase END-TO-END. Its red is the proof that the isolated green
  // was lying by omission.
  test('(3) bare "sari" ack + open lone chase → reaches the batch handler (shortcut un-stranded)', async () => {
    const fake = fakeSupabase(loneChaseSeed())
    await runSiteops(ctxFor(fake), 'sari')

    const reached = fake.trail().some((r) => r.problem_id === CHASE_ID)
    const didntCatch = fake.outbox().some((b) => /Didn't catch/i.test(b))
    expect(reached).toBe(true)       // RED until Defect A
    expect(didntCatch).toBe(false)   // RED until Defect A
  })

  // The pure seam under those journeys — the one-line decision Defect A flips. Asserting the DESIRED value
  // so it is RED now (seam returns the behavior-preserving constant) and GREEN when the fix lands.
  test('(seam) routeEmptyDecompose(open batch) → "batch" (empty reply reaches the chase, not "didn\'t catch")', () => {
    expect(routeEmptyDecompose(true)).toBe('batch')    // RED until Defect A (currently 'didnt_catch')
    expect(routeEmptyDecompose(false)).toBe('didnt_catch')
  })
})

// STATE-COMBINATION JOURNEYS — the systemic close the ASM Elite postmortem asked for: now that the
// harness exists, the reachability matrix is cheap. First tranche below covers the seam's decline branch,
// the no-eat guarantee under the new wiring, and the resolve-and-close path. (Still to fill as the harness
// grows: pending-pick recovery via answerSiteops, and the image modality — both distinct entry points.)
suite('siteops empty-decompose JOURNEY — state combinations', () => {
  // The OTHER seam branch, end-to-end: an empty/unreadable message with NO open batch is a genuine
  // non-update → "didn't catch", and touches no chase.
  test('(J4) empty decompose + NO open batch → "didn\'t catch", no chase touched', async () => {
    const seed: Seed = { ...loneChaseSeed(), chase_batches: [] }   // no open batch
    const fake = fakeSupabase(seed)
    await runSiteops(ctxFor(fake), 'కొంచెం రాంగ్ మెసేజ్')

    expect(fake.outbox().some((b) => /Didn't catch/i.test(b))).toBe(true)
    expect(fake.trail().length).toBe(0)
  })

  // NO-EAT under v2: an unreadable reply (model down) against a MULTI-item batch is PARKED (no-miss), and
  // — the invariant this test exists for — the chase is UNTOUCHED: no problems update, no batch close, no
  // trail. The message is never consumed onto a chase it didn't answer. (Witness changed from "didn't
  // catch" to "parked"; the no-eat property is identical.)
  test('(J5) empty decompose + multi-item batch, model down → parked (no-miss), chase UNTOUCHED (no eat)', async () => {
    const items: BatchItem[] = [
      { kind: 'issue', id: 'water', orgId: ORG, projectId: 'proj-asm', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'weather' },
      { kind: 'issue', id: 'cement', orgId: ORG, projectId: 'proj-asm', projectName: 'ASM Elite', title: 'cement short', taskName: null, cause: 'material' },
    ]
    const fake = fakeSupabase({
      ...loneChaseSeed(),
      chase_batches: [{ id: 'batch-1', items }],
      problems: { water: { id: 'water', status: 'OPEN' }, cement: { id: 'cement', status: 'OPEN' } },
    })
    await runSiteops(ctxFor(fake), 'ఏదో ఒక మెసేజ్')   // Telugu, model down in-harness → unreadable → park

    expect(fake.writesTo('siteops_unplaced').length).toBe(1)                            // parked, not dead-ended
    expect(fake.writesTo('problems').filter((w) => w.op === 'update').length).toBe(0)   // no re-time/advance/resolve
    expect(fake.writesTo('chase_batches').filter((w) => w.op === 'update').length).toBe(0) // batch untouched
  })

  // RESOLVE-AND-CLOSE under v2: a to-do chase + "done" is now MODEL-driven (closure words are deliberately
  // NOT bare acks, so "done" goes to the model, which grades closure_explicit=true → resolve). The executor
  // resolves the todo (→DONE) and drops it, closing the emptied batch. Exercises the todo resolve branch +
  // dropBatchItems through the full v2 stack.
  test('(J6) "done" + lone open TODO chase → model resolves it (todo→DONE) and closes the batch', async () => {
    const todo: BatchItem = { kind: 'todo', id: 'todo-1', orgId: ORG, projectId: 'proj-asm', projectName: 'ASM Elite', title: 'call the inspector', taskName: null, cause: null }
    const fake = fakeSupabase({
      ...loneChaseSeed(),
      chase_batches: [{ id: 'batch-1', items: [todo] }],
      todos: { 'todo-1': { id: 'todo-1', title: 'call the inspector', project_id: 'proj-asm', status: 'OPEN' } },
    })
    const resolveTodo = () => Promise.resolve(JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: 'todo-1', target_kind: 'todo', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'done' }] } }))
    await runSiteops(ctxFor(fake), 'done', { callModel: resolveTodo })

    expect(fake.writesTo('todos').some((w) => w.op === 'update' && w.payload?.status === 'DONE')).toBe(true)
    expect(fake.writesTo('chase_batches').some((w) => w.op === 'update' && w.payload?.status === 'CLOSED')).toBe(true)
    expect(fake.outbox().some((b) => /Didn't catch/i.test(b))).toBe(false)
  })
})

suite('siteops empty-decompose JOURNEY — bare-ack fast path (cardinality, no LLM)', () => {
  // The sari ruling, wired: a recognised bare ack + EXACTLY ONE open chase → that chase ADDRESSING,
  // deterministically, no model call, trailed `bare_ack`. RESOLVE stays behind the model (ack ≠ closure),
  // so the chase advances but never closes, and the batch stays open. Discriminator: a `bare_ack` trail —
  // absent on the pre-fast-path force-match path (which trails reply_received/status_changed).
  test('(FP1) "sari" + lone open chase → ADDRESSING via bare_ack, not resolved, batch stays open', async () => {
    const fake = fakeSupabase(loneChaseSeed())
    await runSiteops(ctxFor(fake), 'sari')

    expect(fake.trail().some((r) => r.type === 'bare_ack')).toBe(true)                 // fast-path marker
    const probUpd = fake.writesTo('problems').filter((w) => w.op === 'update')
    expect(probUpd.some((w) => w.payload?.status === 'ADDRESSING')).toBe(true)         // advanced
    expect(probUpd.some((w) => w.payload?.status === 'RESOLVED')).toBe(false)          // never closed on an ack
    expect(fake.writesTo('chase_batches').some((w) => w.op === 'update' && w.payload?.status === 'CLOSED')).toBe(false)
  })

  // Guard: MULTI-item batch + bare ack is genuinely ambiguous → NOT fast-pathed (no bare_ack trail); it
  // falls through to the normal path (→ the model, which correctly declines).
  test('(FP2) "sari" + MULTI-item batch → NOT fast-pathed (no bare_ack trail)', async () => {
    const items: BatchItem[] = [
      { kind: 'issue', id: 'water', orgId: ORG, projectId: 'proj-asm', projectName: 'ASM Elite', title: 'waterlogging', taskName: null, cause: 'weather' },
      { kind: 'issue', id: 'cement', orgId: ORG, projectId: 'proj-asm', projectName: 'ASM Elite', title: 'cement short', taskName: null, cause: 'material' },
    ]
    const fake = fakeSupabase({ ...loneChaseSeed(), chase_batches: [{ id: 'batch-1', items }], problems: { water: { status: 'OPEN' }, cement: { status: 'OPEN' } } })
    await runSiteops(ctxFor(fake), 'sari')
    expect(fake.trail().some((r) => r.type === 'bare_ack')).toBe(false)
  })

  // Guard: a CONTENTFUL message on a lone chase is not a bare ack → not fast-pathed (no bare_ack trail).
  test('(FP3) contentful "cement short" + lone chase → NOT fast-pathed (no bare_ack trail)', async () => {
    const fake = fakeSupabase(loneChaseSeed())
    await runSiteops(ctxFor(fake), 'cement short tomorrow')
    expect(fake.trail().some((r) => r.type === 'bare_ack')).toBe(false)
  })
})

suite('siteops cross-script match (Defect B — standing spec, expected-red)', () => {
  // TEST 2 — SKIPPED until Defect B (LLM-match-on-lexical-miss) lands. matchPieceToBatch tokenises on
  // /[a-z0-9]+/ (ASCII only), so a Telugu-script reply yields ZERO subject tokens and can never key-match a
  // Latin chase title. In a MULTI-item batch the lone-chase shortcut doesn't apply, so this is where the
  // cross-script gap bites: "waterlogging రిసాల్వ్డ్" cannot pick the waterlogging item out of several and
  // falls to 'leftover'. This is the spec Defect B must satisfy; kept as executable documentation, not a
  // failing run, so the gate signal stays clean. Un-skip when option (b) lands.
  test.skip(
    '(2) Telugu "waterlogging resolved" + MULTI-item batch → matches the waterlogging chase (needs Defect B)',
    'blocked on Defect B: LLM-match-on-lexical-miss; matchPieceToBatch is ASCII-only today',
    () => {
      const batch: BatchItem[] = [
        { kind: 'issue', id: 'water', orgId: ORG, projectId: 'P', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'weather' },
        { kind: 'issue', id: 'cement', orgId: ORG, projectId: 'P', projectName: 'ASM Elite', title: 'cement short', taskName: null, cause: 'material' },
      ]
      const v = classifyReplyFragment({ text: 'వాటర్ లాగింగ్ రిసాల్వ్డ్' }, batch, { singleFragment: true, hasObservation: true })
      expect(v).toEqual({ kind: 'match', index: 0 })
    },
  )
})
