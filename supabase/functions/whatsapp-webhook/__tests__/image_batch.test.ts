// AUDIT CONTRADICTION #1 — IMAGE-UNDER-BATCH ACCEPTANCE JOURNEYS (h–l). Landed RED-FIRST (two-commit
// discipline): the spec-fidelity audit found the adopted handleBatchReply NEVER returns false, so an open
// chase batch is a GATE on the image path — every image from a chased sender enters the batch engine with
// the LEGACY ALL-PROJECTS candidate set (the Fix-X image-hijack, silently re-broken by adoption, live
// today). These journeys are the spec the fix is built to, through the REAL entry point (runSiteops):
//
//   an image arrives → resolve THE project FIRST (caption / vision hint / single-project batch as prior /
//   ask) → a chase-free project routes FRESH (batch invisible — Fix 2 restored) → same-project chases run
//   THE SINGULAR UNIT (candidates = THAT project only, batch a ⭐ prior) → photo evidence RIDES the
//   terminals (attached on create, answer-evidence on update, carried in the evidence park — never lost).
//
// Test-injection contract (extends the a–g board): opts.callModel drives EVERY model call — decompose
// ('<narration>'), resolveInbound ('CANDIDATES:'), and now decomposeImage (user contains 'Decompose the
// image'; the injected door replaces callVision in tests — commit 2 wires it).

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const PHOTO = 'wa_919900000000_1.jpg'
const waterBI = { kind: 'issue' as const, id: 'iss-water', orgId: ORG, projectId: 'P1', projectName: 'ASM Elite', title: 'waterlogging in basement', taskName: null, cause: 'other' }
const tilesBI = { kind: 'issue' as const, id: 'iss-tiles', orgId: ORG, projectId: 'P2', projectName: 'Soundharya', title: 'tiles not arrived at site', taskName: null, cause: 'material' }

// Same world as the a–g board: P1 ASM Elite (chased waterlogging + the transformer bait), P2 Soundharya
// (open tiles issue). The batch default is the lone ASM chase; journeys override per-case.
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
const imgCtx = (fake: ReturnType<typeof fakeSupabase>, caption: string) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-img', lang: 'te' as const,
  image: { base64: 'zz', mime: 'image/jpeg', caption, storagePath: PHOTO },
})

// ── the dispatching model stub (single injection point, three doors) ──────────
interface Call { system: string; user: string }
const imgModel = (calls: Call[], stubs: { vision?: string; resolve?: string; decompose?: string }) =>
  (system: string, user: string): Promise<string> => {
    calls.push({ system, user })
    if (user.startsWith('CANDIDATES:')) return Promise.resolve(stubs.resolve ?? '')
    if (user.includes('Decompose the image')) return Promise.resolve(stubs.vision ?? '')
    return Promise.resolve(stubs.decompose ?? '')
  }
const resolutionCalls = (calls: Call[]) => calls.filter((c) => c.user.startsWith('CANDIDATES:'))

// vision-shaped raw response (decomposeImage's validate() input shape; confidence high so issues survive)
const VIS = (projectHint: string | null, items: { type: string; text: string; project_hint?: string | null }[]) =>
  JSON.stringify({
    project_hint: projectHint,
    items: items.map((i) => ({
      type: i.type, text: i.text, confidence: 'high', task_hint: null,
      cause: i.type === 'issue' ? 'other' : null, cause_reason: null,
      owner_hint: null, date_hint: null, project_hint: i.project_hint ?? null, qc_statements: [],
    })),
  })

// resolution contracts
const R_CREATE = (detail: string, projectHint: string) => JSON.stringify({
  issue_snag_found: { found: true, items: [{ kind: 'issue', detail, location: null, project_hint: projectHint, confidence: 'high' }] },
  update_found: { found: false, updates: [] },
})
const R_RESOLVE_WATER = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: 'iss-water', target_kind: 'issue', action: 'resolve', confidence: 'high', closure_explicit: true, reason: 'basement clear in the photo' }] },
})
const R_BOTH_FALSE = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: false, updates: [] },
})

suite('siteops image-under-batch — audit-#1 acceptance journeys (h–l)', () => {
  // (h) THE RE-BROKEN FIX-X CASE, re-pointed to the T5 cutover: a fresh photo for Soundharya arrives while a
  // chase batch is open on ASM Elite. Post-cutover the chase-free project runs THE UNIT (not finishRoute):
  // the batch is INVISIBLE, the photo rides the created object, and the LADDER runs ONCE scoped to THE
  // project — the other project's items never reach any model call.
  test('(h) fresh photo at Soundharya + batch on ASM → UNIT creates at Soundharya w/ photo linked, batch invisible', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, 'Soundharya lift pit'), 'Soundharya lift pit -- flooded pit in photo', {
      callModel: imgModel(calls, {
        vision: VIS('Soundharya', [{ type: 'issue', text: 'lift pit flooded' }]),
        resolve: R_CREATE('lift pit flooded', 'Soundharya'),
      }),
    })
    // the observation lands on THE project, with its evidence
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P2')).toBe(true)
    expect(fake.writesTo('attachments').some((w) => w.payload?.object_path === PHOTO && w.payload?.parent_type === 'problem')).toBe(true)
    // the ASM chase is untouched — not consumed, not mutated
    expect(fake.writesTo('problems').some((w) => w.op === 'update')).toBe(false)
    expect(fake.writesTo('chase_batches').length).toBe(0)
    // the UNIT (ladder) ran ONCE, project-scoped — the other project's items never reached any model call.
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(1)
    expect(rc[0].user.includes('iss-water')).toBe(false)
    expect(rc[0].user.includes('iss-tfmr-asm')).toBe(false)
  })

  // (i) a photo ABOUT the chased project runs the unit: candidates = THAT project only, its chase ⭐ top;
  // the created object still gets the photo (evidence rides object_created through the unit).
  test('(i) photo at chased ASM → unit runs project-scoped (⭐ chase offered, other project invisible), photo linked', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, 'ASM Elite cement store'), 'ASM Elite cement store -- soaked bags', {
      callModel: imgModel(calls, {
        vision: VIS('ASM Elite', [{ type: 'issue', text: 'cement bags soaked' }]),
        resolve: R_CREATE('cement bags soaked', 'ASM Elite'),
      }),
    })
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(1)
    expect(rc[0].user.includes('⭐ [iss-water')).toBe(true)    // the same-project chase — a ranked prior
    expect(rc[0].user.includes('iss-tiles')).toBe(false)       // the other project — invisible by construction
    expect(fake.writesTo('problems').some((w) => w.op === 'insert' && w.payload?.project_id === 'P1')).toBe(true)
    expect(fake.writesTo('attachments').some((w) => w.payload?.object_path === PHOTO)).toBe(true)
  })

  // (j) a chase-reply PHOTO resolves its item: the ladder applies RESOLVE (+undo), and the photo attaches
  // as ANSWER EVIDENCE to the chased issue — the role='answer' path the adoption flip silently dropped.
  test('(j) chase-reply photo → RESOLVE + undo, photo attached role=answer, batch closed', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, 'ASM basement clear now'), 'ASM basement clear now -- dry floor', {
      callModel: imgModel(calls, {
        vision: VIS('ASM Elite', [{ type: 'progress', text: 'basement waterlogging cleared' }]),
        resolve: R_RESOLVE_WATER,
      }),
    })
    expect(fake.writesTo('problems').some((w) => w.op === 'update' && w.payload?.status === 'RESOLVED' && w.filters.some(([k, v]) => k === 'id' && v === 'iss-water'))).toBe(true)
    expect(fake.writesTo('outbox').some((w) => w.payload?.payload?.kind === 'buttons' && (w.payload?.payload?.buttons ?? []).some((b: { id: string }) => b.id === 'siteops_undo'))).toBe(true)
    expect(fake.writesTo('attachments').some((w) => w.payload?.role === 'answer' && w.payload?.parent_id === 'iss-water' && w.payload?.object_path === PHOTO)).toBe(true)
    expect(fake.writesTo('chase_batches').some((w) => w.payload?.status === 'CLOSED')).toBe(true)
  })

  // (n) FOUNDER FIX (2026-07-16): a siteless photo must not be silently filed onto the sender's active site
  // — even with a SINGLE-site open batch. A photo carries no site WORDS, so the batch prior is not enough to
  // write to a building: it ASKS which project, carrying the photo. (Was: adopted the lone batch site as
  // via='auto' and ran the unit with no ask — the reported live regression.)
  test('(n) siteless photo + single-site batch → ASK which project (no silent adoption), photo carried', async () => {
    const fake = fakeSupabase(seed())   // default batch-1 is single-site (ASM / P1)
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, ''), 'Image received', {
      callModel: imgModel(calls, {
        vision: VIS(null, [{ type: 'issue', text: 'wall crack near stairs' }]),
        resolve: R_BOTH_FALSE,
      }),
    })
    const convoW = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    expect(!!convoW).toBe(true)                                              // it ASKS, never adopts
    expect(convoW?.payload?.slots_so_far?.image?.storagePath).toBe(PHOTO)   // …carrying the photo in the pick
    expect(resolutionCalls(calls).length).toBe(0)                            // project is a precondition — no resolve ran
    expect(fake.writesTo('problems').length).toBe(0)                         // nothing written to any building
  })

  // (o) FOUNDER FIX (2026-07-16): the which_project ask must never leak OUR read of the photo — no <photo>
  // markers, no vision essay. A siteless photo with a long read asks about "your photo"; only the sender's
  // own caption is ever quoted back. (Was: `Got "<photo>…whole paragraph…</photo>" — which project?`)
  test('(o) siteless photo → project ask says "your photo", never the <photo> essay', async () => {
    const fake = fakeSupabase(seed())
    const ESSAY = 'Interior lobby/corridor finishing in progress: walls and soffit have plaster and putty, ' +
      'loose wiring hangs from the left wall, dust and protective sheets cover the floor'
    await runSiteops(imgCtx(fake, ''), 'Image received', {
      callModel: imgModel([], { vision: VIS(null, [{ type: 'progress', text: ESSAY }]), resolve: R_BOTH_FALSE }),
    })
    const convoW = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    const askBody: string = convoW?.payload?.slots_so_far?.ask_body ?? ''
    expect(askBody.includes('<photo>')).toBe(false)        // the marker never leaks
    expect(askBody.includes('loose wiring')).toBe(false)   // …nor the essay
    expect(/your photo/i.test(askBody)).toBe(true)         // a one-liner stand-in instead
  })

  // (k) no project signal + a MULTI-project batch: the batch cannot say which site, so ASK FIRST — the
  // pick carries the photo in its slots. NEVER a model call over multi-project candidates.
  test('(k) siteless photo + multi-project batch → ask-first carrying the photo, zero cross-project calls', async () => {
    const fake = fakeSupabase(seed({ chase_batches: [{ id: 'batch-2', items: [waterBI, tilesBI] }] }))
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, ''), 'Image received', {
      callModel: imgModel(calls, {
        vision: VIS(null, [{ type: 'issue', text: 'wall crack near stairs' }]),
        resolve: R_BOTH_FALSE,
      }),
    })
    const convoW = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    expect(!!convoW).toBe(true)
    expect(convoW?.payload?.slots_so_far?.image?.storagePath).toBe(PHOTO)   // the pick carries the photo
    expect(resolutionCalls(calls).length).toBe(0)                            // project is a PRECONDITION
    expect(fake.writesTo('problems').length).toBe(0)
  })

  // (m) PROBE-P4 DEFECT (D1): UNREADABLE photo + RESOLVED project + chase-free. The parity cell the h–l
  // board missed: finishRoute([]) sent "got your update, logged" while logging NOTHING and dropping the
  // photo (zero attachments, zero parks — the eat wearing a receipt, live 2026-07-05). Target: the unit
  // runs (caption text + image against THE project's candidates); nothing confident → the evidence park,
  // carrying object_path AND project_id. Never a "logged" receipt over an empty route.
  test('(m) unreadable photo + resolved chase-free project → evidence park w/ path+project, never a false "logged" receipt', async () => {
    const fake = fakeSupabase(seed())   // batch on ASM (P1); the photo names Soundharya (P2) — chase-free
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, 'Soundharya corridor'), 'Soundharya corridor -- corridor under construction', {
      callModel: imgModel(calls, { vision: '', resolve: R_BOTH_FALSE }),
    })
    expect(fake.outbox().some((b) => /got your update, logged/i.test(b))).toBe(false)   // the false receipt is dead
    const park = fake.writesTo('siteops_unplaced')[0]
    expect(park?.payload?.object_path).toBe(PHOTO)      // the evidence survives, findable
    expect(park?.payload?.project_id).toBe('P2')        // …and sited
    expect(fake.outbox().some((b) => /photo saved as evidence/i.test(b))).toBe(true)    // honest terminal
    expect(fake.writesTo('problems').length).toBe(0)
    expect(fake.writesTo('chase_batches').length).toBe(0)
    const rc = resolutionCalls(calls)
    expect(rc.length).toBe(1)                            // the unit ran, once
    expect(rc[0].user.includes('iss-tiles')).toBe(true)  // …scoped to THE project
    expect(rc[0].user.includes('iss-water')).toBe(false)
  })

  // (l) UNREADABLE photo + no site signal + multi-project batch: the FLOOR case — the evidence parks WITH
  // its object_path (never lost), an honest reply goes out, the batch is untouched, and no model call is
  // made over multi-project candidates.
  test('(l) unreadable siteless photo + multi-project batch → park carries object_path, honest reply, batch untouched', async () => {
    const fake = fakeSupabase(seed({ chase_batches: [{ id: 'batch-2', items: [waterBI, tilesBI] }] }))
    const calls: Call[] = []
    await runSiteops(imgCtx(fake, ''), 'Image received', {
      callModel: imgModel(calls, { vision: '', resolve: R_BOTH_FALSE }),
    })
    expect(fake.writesTo('siteops_unplaced').some((w) => w.payload?.object_path === PHOTO)).toBe(true)   // evidence survives
    expect(fake.outbox().length > 0).toBe(true)                              // an honest terminal, never silence
    expect(resolutionCalls(calls).length).toBe(0)
    expect(fake.writesTo('problems').length).toBe(0)
    expect(fake.writesTo('chase_batches').length).toBe(0)
  })
})
