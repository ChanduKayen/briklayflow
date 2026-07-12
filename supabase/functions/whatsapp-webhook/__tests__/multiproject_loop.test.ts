// STAGE 2 — the MULTI-PROJECT per-site loop + the serialized-ask DRAIN CURSOR. A narration naming two-plus
// sites splits into per-project GROUPS: every RESOLVED group runs its own singular unit now; UNRESOLVED
// groups serialize into which_project asks, the un-drained remainder riding the pick's slots so the answer
// resumes the drain. Single-project = array-of-one (covered elsewhere); this pins the multi-project shape.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }, { project_id: 'P2', name: 'Soundharya' }],
  problems: {},
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })

const DEC = (items: { type: string; text: string; project_hint: string | null }[]) =>
  JSON.stringify({ project_hint: null, items: items.map((i) => ({ type: i.type, text: i.text, task_hint: null, qc_statements: [], cause: i.type === 'issue' ? 'other' : null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: i.project_hint })) })
const R_CREATE = (detail: string, project_hint: string) => JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail, location: null, project_hint, confidence: 'high' }] }, update_found: { found: false, updates: [] } })
// key on the MESSAGE portion (after "MESSAGE:"), naming whatever project the message names (the resume
// prefixes the picked project → "<Project>: <text>", so the create lands on the resolved site).
const modelFor = (decompose: string) => (_s: string, user: string): Promise<string> => {
  if (!user.startsWith('CANDIDATES:')) return Promise.resolve(decompose)
  const msg = user.split('MESSAGE:')[1] ?? ''
  const hint = /ASM/i.test(msg) ? 'ASM Elite' : /Soundharya/i.test(msg) ? 'Soundharya' : 'ASM Elite'
  if (/cement/i.test(msg)) return Promise.resolve(R_CREATE('cement short', hint))
  if (/steel/i.test(msg)) return Promise.resolve(R_CREATE('steel short', hint))
  if (/slab/i.test(msg)) return Promise.resolve(R_CREATE('slab crack', hint))
  return Promise.resolve(JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: false, updates: [] } }))
}
const projectConvos = (fake: ReturnType<typeof fakeSupabase>) =>
  fake.writesTo('wa_conversations').filter((w) => w.payload?.slots_so_far?.kind === 'siteops_project')

suite('siteops Stage 2 — multi-project per-site loop + serialized-ask drain', () => {
  // (fan-out) two NAMED sites → each fragment runs its OWN unit on its OWN site; both land, no park, no ask.
  test('(fan-out) "ASM slab crack, Soundharya cement short" → both created on their own sites, no park', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack, Soundharya lo cement short', {
      callModel: modelFor(DEC([{ type: 'issue', text: 'slab crack at ASM', project_hint: 'ASM Elite' }, { type: 'issue', text: 'cement short at Soundharya', project_hint: 'Soundharya' }])),
    })
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P1')).toBe(true)   // slab → ASM
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P2')).toBe(true)   // cement → Soundharya
    expect(fake.writesTo('siteops_unplaced').length).toBe(0)                                                      // no compound-park
    expect(projectConvos(fake).length).toBe(0)                                                                    // both named → no ask
  })

  // (split) one site RESOLVES, one is UNKNOWN → the resolved runs now; the unknown opens a which_project ask
  // carrying ITS OWN message (not the resolved fragment's).
  test('(split) resolved + unknown → resolved created now, unknown asks with its own message', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack, Zeta lo cement short', {
      callModel: modelFor(DEC([{ type: 'issue', text: 'slab crack at ASM', project_hint: 'ASM Elite' }, { type: 'issue', text: 'cement short', project_hint: 'Zeta' }])),
    })
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P1')).toBe(true)   // the resolved one ran
    const asks = projectConvos(fake)
    // ONE ask MESSAGE for the unknown (C2c re-opens the SAME convo once to stash the held resolved summary, so
    // the convo has >1 slots-write; the question the supervisor sees is still exactly one).
    expect(fake.outbox().filter((b) => /which project/i.test(b)).length).toBe(1)
    expect(String(asks[0].payload?.slots_so_far?.messages?.[0] ?? '').includes('cement')).toBe(true)             // …carrying the UNKNOWN fragment
    expect((asks[0].payload?.slots_so_far?.pending_groups ?? []).length).toBe(0)                                  // nothing left to drain
  })

  // (drain) TWO unknown sites → ask the first, carry the second in pending_groups; answering the first RUNS it
  // and opens the ask for the second (the cursor advances). This is the serialized-ask drain.
  test('(drain) two unknown sites → first asks (carrying the second); the answer drains to the second ask', async () => {
    const fake = fakeSupabase(seed())
    const cm = modelFor(DEC([{ type: 'issue', text: 'cement short', project_hint: 'Zeta' }, { type: 'issue', text: 'steel short', project_hint: 'Yoda' }]))
    await runSiteops(ctxFor(fake), 'Zeta lo cement short, Yoda lo steel short', { callModel: cm })

    // FIRST ask: cement, carrying the steel group as pending
    const first = projectConvos(fake)
    expect(first.length).toBe(1)
    const slots = first[0].payload?.slots_so_far
    expect(String(slots?.messages?.[0] ?? '').includes('cement')).toBe(true)
    expect((slots?.pending_groups ?? []).length).toBe(1)
    expect(String(slots.pending_groups[0].messages?.[0] ?? '').includes('steel')).toBe(true)

    // ANSWER the first (pick project 1) → it runs, then the SECOND ask opens for the steel group
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const convo = { id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which project?', staged_entry_id: null, last_message_id: null, slots_so_far: slots } as any
    await answerSiteops(ctxFor(fake), '1', convo, { callModel: cm })

    const drained = projectConvos(fake).some((w) => w.payload?.slots_so_far?.messages?.[0]?.includes('steel'))
    expect(drained).toBe(true)                                                                                    // the cursor advanced to the second unknown
  })
})
