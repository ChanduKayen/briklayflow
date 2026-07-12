// BATCHED READBACK — a compound / multi-project message gets ONE combined reply, not a message per item.
// Asks still fire inline; the combined readback lands last (owner's "ask first, then one readback"). A
// multi-project reply labels each line with its site so an ASM line can't read as a Soundharya line.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

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

const DEC = (items: { text: string; hint: string }[]) => JSON.stringify({ project_hint: null, items: items.map((i) => ({ type: 'issue', text: i.text, task_hint: null, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: i.hint })) })
const R_CREATE = (detail: string, hint: string) => JSON.stringify({ issue_snag_found: { found: true, items: [{ kind: 'issue', detail, location: null, project_hint: hint, confidence: 'high' }] }, update_found: { found: false, updates: [] } })
const model = (decompose: string) => (_s: string, user: string): Promise<string> => {
  if (!user.startsWith('CANDIDATES:')) return Promise.resolve(decompose)
  const msg = user.split('MESSAGE:')[1] ?? ''
  if (/slab/i.test(msg)) return Promise.resolve(R_CREATE('slab crack', /ASM/i.test(msg) ? 'ASM Elite' : 'Soundharya'))
  return Promise.resolve(R_CREATE('cement short', /ASM/i.test(msg) ? 'ASM Elite' : 'Soundharya'))
}
const readbacks = (fake: ReturnType<typeof fakeSupabase>) => fake.outbox().filter((b) => /Got it|logged new/i.test(b))

suite('siteops — batched readback (one combined reply)', () => {
  test('multi-project compound → ONE reply, both sites labelled, both items present', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack, Soundharya lo cement short', {
      callModel: model(DEC([{ text: 'slab crack at ASM', hint: 'ASM Elite' }, { text: 'cement short at Soundharya', hint: 'Soundharya' }])),
    })
    const rb = readbacks(fake)
    expect(rb.length).toBe(1)                          // ONE combined reply, not two
    expect(/ASM Elite/.test(rb[0])).toBe(true)          // each line labelled with its site
    expect(/Soundharya/.test(rb[0])).toBe(true)
    expect(/slab crack/.test(rb[0]) && /cement short/.test(rb[0])).toBe(true)
  })

  test('same-project compound → ONE reply with both items, no per-item spray', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack and cement short', {
      callModel: model(DEC([{ text: 'slab crack', hint: 'ASM Elite' }, { text: 'cement short', hint: 'ASM Elite' }])),
    })
    const rb = readbacks(fake)
    expect(rb.length).toBe(1)
    expect(/slab crack/.test(rb[0]) && /cement short/.test(rb[0])).toBe(true)
  })
})

// STEP B — the professional, sectioned readback: a warm header, per-SITE sections (multi-project), and a
// closing invitation — replacing the ` · ` run-on. Single-entry readbacks are UNCHANGED (verbatim, keeps undo).
suite('siteops — Step B: professional sectioned readback format', () => {
  const landed = (fake: ReturnType<typeof fakeSupabase>) => fake.outbox().find((b) => /everything landed/i.test(b)) ?? ''

  test('multi-project compound → sectioned layout (header, per-site headers, closing), no dot run-on', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack, Soundharya lo cement short', {
      callModel: model(DEC([{ text: 'slab crack at ASM', hint: 'ASM Elite' }, { text: 'cement short at Soundharya', hint: 'Soundharya' }])),
    })
    const rb = landed(fake)
    expect(/here'?s where everything landed/i.test(rb)).toBe(true)   // warm header
    expect(/\n\*ASM Elite\*\n/.test(rb)).toBe(true)                   // per-site header on its own line
    expect(/\n\*Soundharya\*\n/.test(rb)).toBe(true)
    expect(/anything off/i.test(rb)).toBe(true)                       // closing invitation
    expect(/ · /.test(rb)).toBe(false)                               // NO ` · ` run-on join
  })

  test('single-item readback is UNCHANGED — no "everything landed" wrapper (keeps its verbatim + undo shape)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack', { callModel: model(DEC([{ text: 'slab crack', hint: 'ASM Elite' }])) })
    expect(fake.outbox().some((b) => /everything landed/i.test(b))).toBe(false)
    expect(fake.outbox().some((b) => /logged new/i.test(b))).toBe(true)   // the plain single readback still lands
  })
})

// CONCURRENT PROJECT GROUPS (2026-07-09) — different sites touch disjoint rows, so their units run in
// parallel. The one thing that must survive is ORDER: the combined readback's per-site sections, and the ask
// drain's cursor, both assume group order. A merge in COMPLETION order would reorder them silently, and a test
// whose groups happen to finish in order would never notice.
//
// So: make the FIRST group's model call finish LAST. If the sections still read ASM-then-Soundharya, the merge
// is by group index; if they flip, it is by completion.
suite('siteops — concurrent project groups preserve GROUP order (not completion order)', () => {
  const slowFirst = (decompose: string) => (_s: string, user: string): Promise<string> => {
    if (!user.startsWith('CANDIDATES:')) return Promise.resolve(decompose)
    const msg = user.split('MESSAGE:')[1] ?? ''
    const isAsm = /ASM/i.test(msg)
    const body = isAsm ? R_CREATE('slab crack', 'ASM Elite') : R_CREATE('cement short', 'Soundharya')
    // ASM is group 0 and resolves SLOWEST; Soundharya (group 1) returns immediately.
    return new Promise((res) => setTimeout(() => res(body), isAsm ? 40 : 0))
  }

  test('the slow FIRST group still reads back first', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack, Soundharya lo cement short', {
      callModel: slowFirst(DEC([{ text: 'slab crack at ASM', hint: 'ASM Elite' }, { text: 'cement short at Soundharya', hint: 'Soundharya' }])),
    })
    const rb = readbacks(fake)
    expect(rb.length).toBe(1)
    expect(rb[0].indexOf('ASM Elite') < rb[0].indexOf('Soundharya')).toBe(true)
  })

  // Both groups ran: parallelism must not drop a site's work.
  test('both groups still land (concurrency does not lose a site)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(ctxFor(fake), 'ASM lo slab crack, Soundharya lo cement short', {
      callModel: slowFirst(DEC([{ text: 'slab crack at ASM', hint: 'ASM Elite' }, { text: 'cement short at Soundharya', hint: 'Soundharya' }])),
    })
    const created = fake.writesTo('problems').filter((w) => w.op === 'insert')
    expect(created.length).toBe(2)
  })
})

// THE MULTI-PROJECT STRIKE-OFF (a live bug, fixed 2026-07-09). dropBatchItems rewrites `items` from the
// CALLER'S in-memory snapshot of the batch. Each project group used to call it with the SAME `batch` object,
// so group B wrote "every item except B's resolves" — resurrecting the items group A had just struck off, and
// never closing the batch. The bug predates concurrency; parallelism only made it obvious.
// The turn now collects resolved ids across groups and drops ONCE.
suite('siteops — one chase batch, two sites: a single strike-off closes it', () => {
  const BI = (id: string, projectId: string, projectName: string, title: string) =>
    ({ kind: 'issue' as const, id, orgId: ORG, projectId, projectName, title, taskName: null, cause: 'other' })
  const chaseSeed = (): Seed => ({
    ...seed(),
    problems: {
      'iss-a': { id: 'iss-a', title: 'slab crack', project_id: 'P1', status: 'OPEN' },
      'iss-b': { id: 'iss-b', title: 'cement short', project_id: 'P2', status: 'OPEN' },
    },
    chase_batches: [{ id: 'b1', items: [BI('iss-a', 'P1', 'ASM Elite', 'slab crack'), BI('iss-b', 'P2', 'Soundharya', 'cement short')] }],
  })
  const R_RESOLVE = (id: string) => JSON.stringify({ issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ target_id: id, target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'fixed' }] } })
  const resolveBoth = (decompose: string) => (_s: string, user: string): Promise<string> => {
    if (!user.startsWith('CANDIDATES:')) return Promise.resolve(decompose)
    const msg = user.split('MESSAGE:')[1] ?? ''
    return Promise.resolve(R_RESOLVE(/ASM/i.test(msg) ? 'iss-a' : 'iss-b'))
  }

  test('both sites resolved → ONE chase_batches write, and it CLOSES the batch', async () => {
    const fake = fakeSupabase(chaseSeed())
    await runSiteops(ctxFor(fake), 'ASM slab crack fixed, Soundharya cement short resolved', {
      callModel: resolveBoth(DEC([{ text: 'ASM slab crack fixed', hint: 'ASM Elite' }, { text: 'Soundharya cement short resolved', hint: 'Soundharya' }])),
    })
    expect(fake.writesTo('problems').filter((w) => w.op === 'update' && w.payload?.status === 'RESOLVED').length).toBe(2)

    const drops = fake.writesTo('chase_batches').filter((w) => w.op === 'update')
    expect(drops.length).toBe(1)                       // ONE strike-off, not one per group
    expect(drops[0].payload?.status).toBe('CLOSED')    // both items gone → the batch closes
  })
})
