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
  // TEST 1 — the reported failure. A Telugu-script voice transcript that MEANS "waterlogging issue ASM
  // Elite resolved" decomposes to nothing (self-resolved-drop / unreadable → empty-valve throws). Over an
  // open lone chase it MUST reach handleBatchReply, not "Didn't catch". Witness: a followup_events trail
  // row on the chase item + no "Didn't catch" reply.
  test('(1) Telugu "waterlogging resolved" + open lone chase → reaches the batch handler (not "didn\'t catch")', async () => {
    const fake = fakeSupabase(loneChaseSeed())
    await runSiteops(ctxFor(fake), 'వాటర్ లాగింగ్ ఇష్యూ ఏసీ ఎమ్ఎల్ఐటీ రిసాల్వ్డ్')

    const reached = fake.trail().some((r) => r.problem_id === CHASE_ID)
    const didntCatch = fake.outbox().some((b) => /Didn't catch/i.test(b))
    expect(reached).toBe(true)       // RED until Defect A: the chase reply must touch the chase item
    expect(didntCatch).toBe(false)   // RED until Defect A: it must not dead-end at "didn't catch"
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
