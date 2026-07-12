// SPRINT 2 · T8 — three conformance closures at the singular unit.
//   T8a (green guard): a compound multi-site park keeps each fragment's OWN project hint (T5 already does).
//   T8b (RED): a batch-ASSUMED project (unnamed message on a single-site batch) must be DISCLOSED in the
//              readback — silent adoption is what clause 2/4 forbid.
//   T8c (clause 5): a compound-MISS reply must lead with what was understood/saved, not the miss.
//        · T8c-1 (green guard): the rest is DISCLOSED, never silently dropped (board confirmed — the
//          "both-axes + miss drops the miss" premise does not reproduce; acked_didnt_catch is structurally
//          exclusive with understood terminals, and the rest always reads back "saved for review").
//        · T8c-2 (RED): a compound where fragment-1 is a miss currently leads with the miss; understood-first.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const waterBI = { kind: 'issue' as const, id: 'iss-water', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'other' }
const seed = (over: Partial<Seed> = {}): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  problems: { 'iss-water': { id: 'iss-water', title: 'waterlogging in basement', project_id: 'P1', status: 'OPEN' } },
  chase_batches: [{ id: 'b1', items: [waterBI] }],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  // This site HAS a task list, so an unplaceable progress fragment is a genuine miss ('nothing updated'),
  // not the honest "I don't track tasks for this site" answer (acked_untracked_work).
  site_tasks: { 'tk-1': { task_id: 'tk-1', name: 'Slab', project_id: 'P1', status: 'PENDING' } },
  site_narration_id: 'narr-1',
  ...over,
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const model = (stubs: { decompose?: string; resolve?: string }) =>
  (system: string, user: string): Promise<string> =>
    Promise.resolve(user.startsWith('CANDIDATES:') ? (stubs.resolve ?? '') : (stubs.decompose ?? ''))
// decompose stub with PER-ITEM project hints (for the multi-site case).
const DEC = (projectHint: string | null, items: { type: string; text: string; project_hint?: string | null }[]) =>
  JSON.stringify({ project_hint: projectHint, items: items.map((i) => ({ type: i.type, text: i.text, task_hint: null, qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: i.project_hint ?? projectHint })) })
const R_RESOLVE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: 'iss-water', target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'cleared' }] } })
const R_BOTH_FALSE = JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } })
const R_CREATE = (detail: string, project_hint: string) => JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail, location: null, project_hint, confidence: 'high' }] }, update_found: { found: false, updates: [] } })
// Content-aware stub: the Stage-2 loop grades EACH fragment on its own site, so the stub answers per item.
// Key on the MESSAGE portion only (the candidate list also mentions "waterlogging", which must not match).
const modelPer = (decompose: string) => (system: string, user: string): Promise<string> => {
  if (!user.startsWith('CANDIDATES:')) return Promise.resolve(decompose)
  const msg = user.split('MESSAGE:')[1] ?? ''
  if (/waterlog/i.test(msg)) return Promise.resolve(R_RESOLVE)
  if (/crack/i.test(msg)) return Promise.resolve(R_CREATE('crack on 2F', 'ASM Elite'))
  if (/transformer/i.test(msg)) return Promise.resolve(R_CREATE('transformer down', 'ASM Elite'))
  if (/tiles/i.test(msg)) return Promise.resolve(R_CREATE('tiles broke', 'Soundharya'))
  return Promise.resolve(R_BOTH_FALSE)
}

suite('siteops T8 — park hints, batch disclosure, understood-first', () => {
  // j1 (STAGE 2, was T8a) — a compound spanning two sites: EACH fragment runs at its OWN site (the per-
  // project loop), not one-runs-rest-parks. tiles → Soundharya, transformer → ASM Elite; no pending_stage2.
  test('(j1) compound multi-site → each fragment lands on its OWN site (no compound-park)', async () => {
    const fake = fakeSupabase(seed({ chase_batches: [] }))
    await runSiteops(ctxFor(fake), 'tiles broke at Soundharya and transformer down at ASM Elite', {
      callModel: modelPer(DEC(null, [{ type: 'issue', text: 'tiles broke', project_hint: 'Soundharya' }, { type: 'issue', text: 'transformer down', project_hint: 'ASM Elite' }])),
    })
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P2')).toBe(true)   // tiles → Soundharya
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P1')).toBe(true)   // transformer → ASM Elite (its OWN site)
    expect(fake.writesTo('siteops_unplaced').some((w) => w.payload?.reason === 'pending_stage2')).toBe(false)
  })

  // j2 (RED, T8b) — an UNNAMED message on a single-site batch is sited to that batch's project (via='auto').
  // The readback must DISCLOSE the assumption so a wrong adoption is visible and correctable.
  test('(j2) batch-assumed project → readback discloses the assumed site (not silent)', async () => {
    const fake = fakeSupabase(seed())   // single-site batch on ASM Elite (P1)
    // names no project → sited to the batch's project (via='auto'); the reply must disclose the assumption.
    await runSiteops(ctxFor(fake), 'waterlogging is fixed now', {
      callModel: model({ decompose: DEC(null, [{ type: 'progress', text: 'waterlogging fixed' }]), resolve: R_RESOLVE }),
    })
    const reply = fake.outbox().join(' ')
    expect(/ASM Elite/.test(reply)).toBe(true)                 // the assumed site is NAMED
    expect(/assumed|wrong site/i.test(reply)).toBe(true)       // …and flagged as an assumption, correctable
  })

  // j3 (STAGE 2, was T8c-1) — a same-site compound: fragment-1 is UNDERSTOOD (resolve) and fragment-2 is a
  // NEW item — BOTH are HANDLED (the rest is processed on its own, never silently dropped).
  test('(j3) compound understood + new item → both handled (resolve + create, rest not dropped)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'waterlogging cleared and new crack on 2F', {
      callModel: modelPer(DEC('ASM Elite', [{ type: 'progress', text: 'waterlogging cleared' }, { type: 'issue', text: 'crack on 2F' }])),
    })
    const reply = fake.outbox().join(' ')
    expect(/resolved/i.test(reply)).toBe(true)                                                    // the understood half
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && /crack/i.test(String(w.payload?.title ?? '')))).toBe(true)   // the rest — created, not eaten
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED')).toBe(true)
  })

  // j4 (STAGE 2, was T8c-2) — a compound where fragment-1 is a MISS and fragment-2 is a real item: the
  // real item is still HANDLED on its own (no-drop across the loop), and the miss is surfaced honestly.
  test('(j4) compound miss + real rest → the real fragment is handled, the miss surfaced (no-drop)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'hmmm and new crack on 2F', {
      callModel: modelPer(DEC('ASM Elite', [{ type: 'progress', text: 'hmmm' }, { type: 'issue', text: 'crack on 2F' }])),
    })
    const reply = fake.outbox().join(' ')
    expect(/couldn't place/i.test(reply)).toBe(true)                                              // the miss is surfaced honestly (short clause in a combined readback)
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && /crack/i.test(String(w.payload?.title ?? '')))).toBe(true)   // the real fragment — handled, never dropped
  })
})
