// ONE ASK CURSOR PER TURN (live failure 2026-07-11). A 9-item voice note across three sites asked a
// which_project question ("Which project is *tie gunny bags to columns today* for?") AND, in the same turn,
// a which_item pick ("tiles being laid → 1..9"). Both call openConversation, which upserts THE single open
// conversation per (org, sender) — so the item pick silently overwrote the project pick. The supervisor
// answered the project question ("Dr Shyam's Residence") and that answer landed on the TILES pick, where it
// was meaning-matched to a task and WROTE "Floor tiling (First)" active on the wrong site.
//
// which_item asks were already serialized (askQueue → drainItemAsks). which_project was not: it sent inline
// from inside applyTerminals. This pins the composer contract — inside a serialized turn (a queue is
// present), applyTerminals OPENS NO CONVERSATION and SENDS NO QUESTION; it enqueues, and runSiteops asks
// exactly one thing (the project first — a site is a prerequisite — carrying the item asks in its slots).
//
// Without a queue (the direct/resume callers) the inline behaviour is unchanged.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, applyTerminals, type ExecCtx, type PendingItemAsk, type PendingProjectAsk } from '../_agents/siteops.ts'
import type { Terminal, AttachUpdate } from '../_siteops_resolution.ts'
import type { BatchItem } from '../_siteops_batch.ts'

const ORG = 'org-1'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: '919900000000', orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const waterItem: BatchItem = { kind: 'issue', id: 'iss-water', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'other' }
const execCtx = (extra: Partial<ExecCtx> = {}): ExecCtx => ({
  itemsById: new Map([['iss-water', waterItem]]), labelById: new Map([['iss-water', 'waterlogging in basement']]),
  cadenceMap: new Map(), actorId: null, now: new Date('2026-07-11T00:00:00Z'), narrationId: 'narr-1', projectId: 'P1', ...extra,
})

const upd = (o: Partial<AttachUpdate> & { target_id: string }): AttachUpdate =>
  ({ target_kind: 'issue', action: 'progress', confidence: 'low', closure_explicit: false, reason: 'maybe this', ...o })
const tQProject: Terminal = {
  kind: 'question_asked', about: 'which_project', ref: 'tie gunny bags to columns today',
  item: { kind: 'snag', detail: 'tie gunny bags to columns today', location: null, project_hint: null, confidence: 'high' },
  reason: 'no site',
}
const tQItem: Terminal = { kind: 'question_asked', about: 'which_item', ref: 'iss-water', update: upd({ target_id: 'iss-water' }), reason: 'low' }

const convos = (fake: ReturnType<typeof fakeSupabase>) => fake.writesTo('wa_conversations')

suite('siteops — ONE ask cursor per turn (which_project may not clobber the item asks)', () => {
  // THE LIVE BUG. Both asks in one turn → the second openConversation ate the first.
  test('(C1) serialized turn: which_project + which_item → NO conversation opened, both enqueued', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: "Dr Shyam's Residence" }] })
    const askQueue: PendingItemAsk[] = []
    const projectAskQueue: PendingProjectAsk[] = []
    await applyTerminals(ctxFor(fake), [tQProject, tQItem], execCtx({ askQueue, projectAskQueue }))

    expect(convos(fake).length).toBe(0)                                  // nothing opened inside the unit…
    expect(fake.outbox().filter((b) => /which project/i.test(b)).length).toBe(0)   // …and nothing asked yet
    expect(projectAskQueue.length).toBe(1)                               // the project ask waits its turn
    expect(projectAskQueue[0].item.text).toBe('tie gunny bags to columns today')
    expect(askQueue.length).toBe(1)                                      // the item ask still queued (unchanged)
  })

  // The project ask is still an OK outcome (it is asked, later, by the caller) — never a park, never a miss.
  test('(C2) the enqueued which_project reports ok (it is deferred, not dropped)', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })
    const outcomes = await applyTerminals(ctxFor(fake), [tQProject], execCtx({ askQueue: [], projectAskQueue: [] }))

    expect(outcomes.length).toBe(1)
    expect(outcomes[0].status).toBe('ok')
    expect(fake.writesTo('siteops_unplaced').length).toBe(0)             // deferred ≠ parked
  })

  // The direct/resume callers (no queue) keep today's inline behaviour exactly.
  test('(C3) unserialized caller (no queue) → which_project still opens the pick inline', async () => {
    const fake = fakeSupabase({ projects: [{ project_id: 'P1', name: 'ASM Elite' }] })
    await applyTerminals(ctxFor(fake), [tQProject], execCtx())

    expect(convos(fake).some((w) => w.payload?.slots_so_far?.kind === 'siteops_project')).toBe(true)
    expect(fake.outbox().some((b) => /which project/i.test(b))).toBe(true)
  })
})

// ── THE ASK THAT SHOULD NEVER HAVE BEEN RAISED ────────────────────────────────────────────────────────────
// The live turn logged `[siteops:groups] count=3 resolved=3 … via:"named"` — every site was known — and then
// asked "Which project is *tie gunny bags to columns today* for?" anyway. planObserve asked purely because
// the RESOLUTION model (a different call, per item) returned project_hint:null on that fragment. The site was
// never in doubt: decompose named it, and the Stage-2 loop was already running the item under that project's
// candidate set. An item the unit is running for a KNOWN site is created on that site, not quizzed.
const SITE_SEED = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  problems: {}, chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: '919900000000', is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const DEC_ONE = JSON.stringify({
  project_hint: 'ASM Elite',
  items: [{ type: 'todo', text: 'tie gunny bags to columns today', task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: 'ASM Elite' }],
})
// the resolution model names a NEW planned snag but omits the site (exactly what it did live)
const R_NO_HINT = JSON.stringify({
  issue_snag_found: { found: true, items: [{ kind: 'snag', detail: 'tie gunny bags to columns today', location: null, project_hint: null, confidence: 'high', planned: true }] },
  update_found: { found: false, updates: [], nearest: [] },
})
const model = (_s: string, user: string): Promise<string> => Promise.resolve(user.startsWith('CANDIDATES:') ? R_NO_HINT : DEC_ONE)

suite('siteops — a KNOWN site is never quizzed (the redundant which_project)', () => {
  test('(P1) resolved group + model project_hint:null → created on the group\'s site, no project ask', async () => {
    const fake = fakeSupabase(SITE_SEED())
    await runSiteops(ctxFor(fake), 'ASM lo columns ki gunny bags kattali', { callModel: model })

    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P1')).toBe(true)
    expect(convos(fake).some((w) => w.payload?.slots_so_far?.kind === 'siteops_project')).toBe(false)
    expect(fake.outbox().filter((b) => /which project/i.test(b)).length).toBe(0)
  })
})
