// JOURNEY GATE — the testing corollary to the ASM Elite postmortem: a PURE test pins a DECISION; only a
// JOURNEY test pins that the decision is REACHED. These drive the REAL runSiteops over a fake supabase
// (no LLM key in-harness → decompose throws exactly as the empty-valve does in prod).
//
// HISTORY (2026-07-09): this file was born pinning the bare-ack shortcut — that a terse "sari" against a
// lone chase should reach the batch handler and advance the item. That whole path is now deleted. An
// acknowledgement NAMES nothing, so it acts on nothing: the router hands it to the concierge, which shows
// the supervisor how to name the work. What survives here are the journeys that were never about acks —
// no-eat under a model failure, and resolve-and-close on a message that does name its referent.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'
import type { BatchItem } from '../_siteops_batch.ts'

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

    expect(fake.outbox().some((b) => /nothing updated/i.test(b))).toBe(false)   // not dead-ended (Defect-A invariant)
    expect(fake.writesTo('siteops_unplaced').length).toBe(1)                 // reached the engine, held for review
  })

  // DELETED (2026-07-09) — test (3) 'bare "sari" ack reaches the batch handler', and the (seam) test for
  // routeEmptyDecompose. Both pinned the shortcut that made an ack resolve a chase. The batch handler and
  // the seam are deleted; an ack is no longer a site update. See router_referent.test.ts.
})

// STATE-COMBINATION JOURNEYS — the systemic close the ASM Elite postmortem asked for: now that the
// harness exists, the reachability matrix is cheap. First tranche below covers the seam's decline branch,
// the no-eat guarantee under the new wiring, and the resolve-and-close path. (Still to fill as the harness
// grows: pending-pick recovery via answerSiteops, and the image modality — both distinct entry points.)
suite('siteops empty-decompose JOURNEY — state combinations', () => {
  // The OTHER seam branch, end-to-end: an empty/unreadable message with NO open batch is a genuine
  // non-update → "didn't catch", and touches no chase.
  // The model READ it and found no site content (valid JSON, zero items) — that is an answer, not an outage,
  // and it is the only thing that may be answered with "nothing updated". An UNREADABLE response (a dead
  // model) parks instead; see decompose_failure.test.
  test('(J4) empty decompose + NO open batch → "didn\'t catch", no chase touched', async () => {
    const seed: Seed = { ...loneChaseSeed(), chase_batches: [] }   // no open batch
    const fake = fakeSupabase(seed)
    const emptyExtraction = () => Promise.resolve(JSON.stringify({ project_hint: null, items: [] }))
    await runSiteops(ctxFor(fake), 'కొంచెం రాంగ్ మెసేజ్', { callModel: emptyExtraction })

    expect(fake.outbox().some((b) => /nothing updated/i.test(b))).toBe(true)
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
  test('(J6) "inspector call is done" + lone open TODO chase → model resolves it (todo→DONE), closes the batch', async () => {
    const todo: BatchItem = { kind: 'todo', id: 'todo-1', orgId: ORG, projectId: 'proj-asm', projectName: 'ASM Elite', title: 'call the inspector', taskName: null, cause: null }
    const fake = fakeSupabase({
      ...loneChaseSeed(),
      chase_batches: [{ id: 'batch-1', items: [todo] }],
      todos: { 'todo-1': { id: 'todo-1', text: 'call the inspector', project_id: 'proj-asm', status: 'OPEN' } },
    })
    const resolveTodo = () => Promise.resolve(JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: 'todo-1', target_kind: 'todo', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'done' }] } }))
    // NB: the message NAMES the to-do. A bare "done" no longer reaches SiteOps at all (referent rule).
    await runSiteops(ctxFor(fake), 'inspector call is done', { callModel: resolveTodo })

    expect(fake.writesTo('todos').some((w) => w.op === 'update' && w.payload?.status === 'DONE')).toBe(true)
    expect(fake.writesTo('chase_batches').some((w) => w.op === 'update' && w.payload?.status === 'CLOSED')).toBe(true)
    expect(fake.outbox().some((b) => /nothing updated/i.test(b))).toBe(false)
  })
})

// DELETED (2026-07-09) — the bare-ack fast-path suite (FP1/FP2/FP3). The path it pinned is gone: an
// acknowledgement names nothing, so it no longer advances a chase item to ADDRESSING, no longer re-times
// the chase, and no longer writes a `bare_ack` trail row. `sari` never reaches SiteOps at all now — the
// router reads the conversation and hands it to the concierge, which shows the supervisor how to name the
// work. What replaces these: the routing contract in router_referent.test.ts.


// DELETED (2026-07-09) — the cross-script suite, a skipped standing spec for 'Defect B': matchPieceToBatch
// tokenised on /[a-z0-9]+/, so a Telugu-script reply produced ZERO tokens and could never key-match a Latin
// chase title. That defect is not fixed; its cause is deleted. Reply-matching by SPELLING is gone — the
// resolution model matches a reply to the ⭐-ranked candidates by MEANING, in any script, which is what the
// spec was asking someone to hand-write. See resolution_llm.test.ts.
