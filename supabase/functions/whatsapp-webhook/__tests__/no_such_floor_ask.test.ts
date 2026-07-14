// THE NAMED FLOOR THAT DOESN'T EXIST — a QUESTION, not a dead end (live probe, 2026-07-11).
//
// A photo captioned "ASM Cellar flooring" landed on `acked_no_place(no_structure)`: we told the truth ("this
// site has no floor cellar; the floors it has are Stilt, Ground, First…") and then HUNG UP — no conversation
// was opened, nothing was pending. The supervisor answered the question we had just asked him —
//
//     "Save it to stilt floor"
//
// — and, because no question was OPEN, that reply named no referent, reached SiteOps with nothing to attach
// to, and was answered "I couldn't tell which work you meant." The work was lost, and the photo with it.
//
// A named floor we cannot place is AMBIGUITY, and ambiguity is what a pick is for. The type is real and its
// rows sit on floors that DO exist, so the honest sentence becomes the PREAMBLE of a which_item ask over
// those rows. Everything else follows from the one composer: the pick's slots carry the photo, "None of
// these" reproduces exactly today's no-write outcome, and a typed answer ("stilt floor") resolves by meaning.
//
// no_task is UNCHANGED — the floor exists, the task type simply isn't tracked there. That is a different
// question (pass 2's add-task offer), not this one.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops, answerSiteops } from '../_agents/siteops.ts'
import {
  executeResolution,
  type ResolutionContract, type ResolutionContext, type Terminal, type AttachUpdate, type TaskRowRef, type StructureSlot, type Geometry,
} from '../_siteops_resolution.ts'

// ── the PIN spec (pure) ──────────────────────────────────────────────────────────────────────────────────
const TYPE = 'T'
const tUpd = (o: Partial<AttachUpdate> = {}): AttachUpdate => ({
  target_id: TYPE, target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: true, reason: 'flooring done', ...o,
})
const base = (u: AttachUpdate): ResolutionContract => ({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [u] },
})
const ctxPin = (rows: TaskRowRef[], slot: Partial<StructureSlot> = {}, geometry: Geometry | null = null): ResolutionContext => ({
  candidateIds: new Set([TYPE]),
  isImage: false,
  taskRowsByType: new Map([[TYPE, rows]]),
  structure: { floor: null, unit: null, all: false, except: null, ...slot },
  geometry,
})
const row = (id: string, floor: string | null, unit: string | null): TaskRowRef =>
  ({ id, name: 'Flooring', floor, unit, title: `Flooring${floor ? ` — ${floor}` : ''}${unit ? ` · ${unit}` : ''}` })
const shortlist = (t: Terminal[]): string[] => t.flatMap((x) => (x.kind === 'question_asked' ? (x.shortlistIds ?? []) : []))
const preambleOf = (t: Terminal[]): string => t.flatMap((x) => (x.kind === 'question_asked' && x.preamble ? [x.preamble] : []))[0] ?? ''

// the live ASM Elite shape — flooring tracked on three real floors; no cellar anywhere in the building
const REAL_FLOORS: TaskRowRef[] = [row('fl-stilt', 'Stilt', null), row('fl-ground', 'Ground', null), row('fl-first', 'First', null)]
const geo = (floors: string[], units: string[] = []): Geometry => ({ floors, unitsByFloor: new Map(floors.map((f) => [f, units])) })

suite('siteops — a named floor that does not exist is a QUESTION (no_structure → which_item ask)', () => {
  // (NF1) THE LIVE BUG. "cellar flooring" on a building with no cellar → ask over the flooring rows that DO
  // exist. No terminal, no write, and the honest "there is no cellar" sentence rides along as the preamble.
  test('(NF1) floor not in the geometry → which_item ASK over the type’s real rows, no dead-end terminal', () => {
    const t = executeResolution(base(tUpd()), ctxPin(REAL_FLOORS, { floor: 'Cellar' }, geo(['Stilt', 'Ground', 'First'])))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('question_asked')
    expect(t[0].kind === 'question_asked' && t[0].about).toBe('which_item')
    expect(t[0].kind === 'question_asked' && t[0].axis).toBe('location')
    expect(new Set(shortlist(t))).toEqual(new Set(['fl-stilt', 'fl-ground', 'fl-first']))
    expect(t.some((x) => x.kind === 'acked_no_place')).toBe(false)   // the dead end is gone
    expect(t.some((x) => x.kind === 'object_updated')).toBe(false)   // still never a wrong write
  })

  // The truth we told before is not lost — it becomes the PREAMBLE the pick is asked under: the floor they
  // named, and the floors that actually exist.
  test('(NF2) the ask carries the honest preamble — the missing floor AND the real ones', () => {
    const t = executeResolution(base(tUpd()), ctxPin(REAL_FLOORS, { floor: 'Cellar' }, geo(['Stilt', 'Ground', 'First'])))
    const p = preambleOf(t)
    expect(/cellar/i.test(p)).toBe(true)
    expect(/Stilt/.test(p) && /Ground/.test(p) && /First/.test(p)).toBe(true)
  })

  // A UNIT that doesn't exist on a real floor narrows to THAT floor's rows — we know the floor, only the unit
  // was wrong, so the pick must not re-offer the whole building.
  test('(NF3) unit not in the geometry → ask over the NAMED floor’s rows only', () => {
    const rows = [row('fl-1a', 'First', 'Unit A'), row('fl-1b', 'First', 'Unit B'), row('fl-2a', 'Second', 'Unit A')]
    const t = executeResolution(base(tUpd()), ctxPin(rows, { floor: 'First', unit: 'Unit Z' }, geo(['First', 'Second'], ['Unit A', 'Unit B'])))
    expect(t[0].kind).toBe('question_asked')
    expect(new Set(shortlist(t))).toEqual(new Set(['fl-1a', 'fl-1b']))   // Second floor's row is not re-offered
  })

  // NO REGRESSION — the floor EXISTS, the type just isn't tracked there. That is not ambiguity: there is
  // nothing to pick between. It stays the honest no-place terminal (pass 2 offers to add the task).
  test('(NF4) floor EXISTS but the type has no row there → still acked_no_place, no ask', () => {
    const t = executeResolution(base(tUpd()), ctxPin(REAL_FLOORS, { floor: 'Second' }, geo(['Stilt', 'Ground', 'First', 'Second'])))
    expect(t[0].kind).toBe('acked_no_place')
    expect(t[0].kind === 'acked_no_place' && t[0].floor).toBe('Second')
    expect(t.some((x) => x.kind === 'question_asked')).toBe(false)
  })

  // NO REGRESSION — no geometry loaded means we cannot CLAIM a floor is missing, so we must not ask as if it
  // were. Unchanged: the honest untracked-task terminal.
  test('(NF5) no geometry → acked_no_place (never a wrong "no such floor"), no ask', () => {
    const t = executeResolution(base(tUpd()), ctxPin(REAL_FLOORS, { floor: 'Cellar' }, null))
    expect(t[0].kind).toBe('acked_no_place')
    expect(t.some((x) => x.kind === 'question_asked')).toBe(false)
  })
})

// ── the JOURNEY — the live transcript, end to end ────────────────────────────────────────────────────────
const ORG = 'org-1'
const SENDER = '919900000000'
const PHOTO = 'wa_919900000000_1.jpg'
const TYPE_ID = 'type:P1:flooring'   // taskTypeId(projectId, name) — the handle the model names

// ONE project (so the caption resolves the site), flooring tracked on Stilt/Ground/First, and a construction
// stack that says the same — so geometry KNOWS there is no cellar.
const seed = (): Seed => ({
  projects: [{
    project_id: 'P1', name: 'ASM Elite', org_id: ORG, status: 'Active', has_common_areas: false,
    construction_stack: {
      levels: [
        { label: 'Stilt', kind: 'parking', zones: [] },
        { label: 'Ground', kind: 'residential', zones: [{ use: 'residential', units: 1 }] },
        { label: 'First', kind: 'residential', zones: [{ use: 'residential', units: 1 }] },
      ],
    },
  }],
  // The node_keys are the engine's REAL ones for this stack (`floor_tile@<Floor>/unit`), not invented
  // handles. They used to read `flooring@Stilt` — a key the library has never generated — and the VM
  // guardrail (node_key ∈ VM) should have refused every write onto them. It did not, because the fake
  // could not see `projects.org_id` (added by a DO-block loop, invisible to the column parser), so
  // materialize read the project as NULL, built an EMPTY VM, and the guardrail disabled itself — its
  // documented "absent → can't judge → proceed" case. The guardrail was therefore never once exercised by a
  // journey. Now that the parser sees the column, an invented key is refused here exactly as in prod.
  // (The NAME stays 'Flooring': the guardrail keys off node_key, and the narrative reads better.)
  site_tasks: {
    'tk-stilt': { task_id: 'tk-stilt', project_id: 'P1', name: 'Flooring', trade: 'finishes', floor_label: 'Stilt', unit_label: null, status: 'open', node_key: 'floor_tile@Stilt/unit' },
    'tk-ground': { task_id: 'tk-ground', project_id: 'P1', name: 'Flooring', trade: 'finishes', floor_label: 'Ground', unit_label: null, status: 'open', node_key: 'floor_tile@Ground/unit' },
    'tk-first': { task_id: 'tk-first', project_id: 'P1', name: 'Flooring', trade: 'finishes', floor_label: 'First', unit_label: null, status: 'open', node_key: 'floor_tile@First/unit' },
  },
  problems: {},
  chase_batches: [],
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})

const imgCtx = (fake: ReturnType<typeof fakeSupabase>, caption: string) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-img', lang: 'te' as const,
  image: { base64: 'zz', mime: 'image/jpeg', caption, storagePath: PHOTO },
})
const textCtx = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-txt', lang: 'te' as const })

// The photo reads as ONE progress report, and the vision model puts the caption's floor in the structure slot
// — exactly as the live run did ("cellar"). NB the caption's code floor cannot see it: "cellar flooring" names
// no FLOOR WORD ("cellar floor" would), so the slot comes from the model, as it did live.
const VIS = JSON.stringify({
  project_hint: 'ASM Elite',
  items: [{
    type: 'progress', text: 'flooring done', confidence: 'high', task_hint: 'Flooring',
    structure: { floor: 'cellar', unit: null, all: false, except: null },
    cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null, qc_statements: [],
  }],
})
// …and the resolver names the flooring TYPE (it is never shown a floor — the pin owns the floor)
const R_UPD = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: TYPE_ID, target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: true, reason: 'flooring done' }] },
})
const model = (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? R_UPD : VIS)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const convoOf = (slots: any): any => ({ id: 'c1', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which item?', staged_entry_id: null, last_message_id: null, slots_so_far: slots })

// A WRITE ONTO THE WORK — a task's STATE moving. Not every touch of the site_tasks table is one: since the
// project is now reconciled before it is read (2026-07-13), the ENGINE also writes here — it lays down the
// rows the library generates and re-sequences the ones it already had. Those are the generator keeping the
// list true, and they say nothing about the supervisor's report. What these tests mean by "no wrong write"
// is that nothing MOVED A TASK — so look for the status, which is the only thing a narration ever sets.
const stateWrites = (fake: ReturnType<typeof fakeSupabase>) =>
  fake.writesTo('site_tasks').filter((w) => w.op === 'update' && !!w.payload && (!!w.payload.status || !!w.payload.status_history))

suite('siteops — the live cellar journey: photo → ask → "save it to stilt floor" lands the work', () => {
  test('(J1) a photo captioned "ASM Cellar flooring" OPENS a pick (state pending), never a dead end', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake, 'ASM Cellar flooring'), 'Image received', { callModel: model })

    const convo = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')
    expect(!!convo).toBe(true)                                            // a question is OPEN — the state is pending
    const slots = convo!.payload.slots_so_far
    const ids = (slots.candidates as { id: string }[]).map((c) => c.id)
    expect(new Set(ids)).toEqual(new Set(['tk-stilt', 'tk-ground', 'tk-first']))
    expect(slots.image?.storagePath).toBe(PHOTO)                          // the photo rides the pick
    // the honest sentence survives, now as the question's preamble
    const q = fake.outbox().find((b) => b.includes('❓')) ?? ''
    expect(/cellar/i.test(q)).toBe(true)
    expect(/stilt/i.test(q)).toBe(true)
    expect(stateWrites(fake).length).toBe(0)                              // still no wrong write
  })

  test('(J2) "Save it to stilt floor" resolves the open pick → the Stilt row is updated, the photo attached', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake, 'ASM Cellar flooring'), 'Image received', { callModel: model })
    const slots = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')!.payload.slots_so_far

    await answerSiteops(textCtx(fake), 'Save it to stilt floor', convoOf(slots), { callModel: model })

    const updated = stateWrites(fake)
    expect(updated.some((w) => w.filters.some(([k, v]) => k === 'task_id' && v === 'tk-stilt'))).toBe(true)
    expect(updated.some((w) => w.filters.some(([k, v]) => k === 'task_id' && (v === 'tk-ground' || v === 'tk-first')))).toBe(false)
    // the photo the whole exchange was about lands on the row it was about
    expect(fake.writesTo('attachments').some((w) => w.payload?.object_path === PHOTO && w.payload?.parent_type === 'site_task')).toBe(true)
  })

  // "None of these" is the escape that REPRODUCES the old outcome — nothing written, saved for review — but
  // now it is the supervisor's choice, made after being asked, instead of ours, made for him.
  test('(J3) "None of these" → nothing written, parked for review (the old behaviour, now chosen)', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake, 'ASM Cellar flooring'), 'Image received', { callModel: model })
    const slots = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_batch_collision')!.payload.slots_so_far

    await answerSiteops(textCtx(fake), 'none of these', convoOf(slots), { callModel: model })

    expect(stateWrites(fake).length).toBe(0)
    expect(fake.writesTo('siteops_unplaced').length > 0).toBe(true)
  })
})

// ── THE SAME DISEASE, THE IMAGE'S OWN DEAD END (live probe, 2026-07-11) ──────────────────────────────────
//
// The SAME photo, captioned "ASM Stilt floor". The vision model returned NOTHING that time (a transient), so
// there were no items and — crucially — no `project_hint` from the model. The caption alone scores below the
// auto band against two active sites, so the project came back unresolved, and the image path did this:
//
//     "Couldn't read that photo — kept it on your to-place list so it isn't lost."
//
// …and closed. No question, nothing pending, the work untracked. But the TEXT path, twenty lines below in the
// same file, has already ruled on exactly this case (clause 2 / A2): a message that NAMES a site we could not
// resolve is a placeable message → ASK WHICH SITE, never a silent miss. The image path never got the rule.
//
// It also threw away what he SAID. "ASM Stilt floor" names a floor ("stilt floor" — a floor word, so the code
// floor reads it without any model at all). That caption is the whole message when vision is down, and it must
// ride the ask so the pick's resume can pin the row instead of re-asking a question he already answered.
const SEED2 = (): Seed => ({
  ...seed(),
  // TWO active sites → no auto-resolve; the caption must be what places the photo.
  projects: [seed().projects![0], { project_id: 'P2', name: 'Soundharya', org_id: ORG, status: 'Active' }],
})
// vision is DOWN — no items, no project_hint (the live transient). The resolver, when it finally runs on the
// picked site, sees the caption and reports flooring progress.
const R_UPD_STILT = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: TYPE_ID, target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: true, reason: 'stilt floor flooring' }] },
})
const blindModel = (_s: string, user: string): Promise<string> =>
  Promise.resolve(user.startsWith('CANDIDATES:') ? R_UPD_STILT : '')   // '' → decomposeImage yields nothing
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const projConvoOf = (slots: any): any => ({ id: 'c2', org_id: ORG, sender_number: SENDER, status: 'OPEN', owning_agent: 'SITEOPS', pending_question: 'which project?', staged_entry_id: null, last_message_id: null, slots_so_far: slots })

suite('siteops — an unreadable photo that NAMES its site is a question, not a to-place park', () => {
  test('(S1) vision returns nothing + caption names the site → ASK WHICH SITE (photo carried), no dead-end park', async () => {
    const fake = fakeSupabase(SEED2())
    await runSiteops(imgCtx(fake, 'ASM Stilt floor'), 'ASM Stilt floor', { callModel: blindModel })

    const convo = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')
    expect(!!convo).toBe(true)                                          // a question is OPEN
    expect(convo!.payload.slots_so_far.image?.storagePath).toBe(PHOTO)  // …carrying the photo
    expect(fake.outbox().some((b) => /couldn't read that photo/i.test(b))).toBe(false)
    expect(fake.writesTo('siteops_unplaced').length).toBe(0)            // nothing dead-ended
  })

  test('(S2) picking the site runs the caption: the Stilt row is updated and the photo attached', async () => {
    const fake = fakeSupabase(SEED2())
    await runSiteops(imgCtx(fake, 'ASM Stilt floor'), 'ASM Stilt floor', { callModel: blindModel })
    const slots = fake.writesTo('wa_conversations').find((w) => w.payload?.slots_so_far?.kind === 'siteops_project')!.payload.slots_so_far

    await answerSiteops(textCtx(fake), 'ASM Elite', projConvoOf(slots), { callModel: blindModel })

    // the caption's OWN floor ("stilt floor") survived the ask — so the pin lands one row, and asks nothing
    const updated = fake.writesTo('site_tasks').filter((w) => w.op === 'update')
    expect(updated.some((w) => w.filters.some(([k, v]) => k === 'task_id' && v === 'tk-stilt'))).toBe(true)
    expect(fake.writesTo('attachments').some((w) => w.payload?.object_path === PHOTO)).toBe(true)
  })

  // NO REGRESSION — a photo with NOTHING said and nothing read really is unreadable. It still parks (the photo
  // is never lost), and the honest message stands: there is no question to ask.
  test('(S3) vision returns nothing AND no caption → still the honest to-place park', async () => {
    const fake = fakeSupabase(SEED2())
    await runSiteops(imgCtx(fake, ''), 'Image received', { callModel: blindModel })

    expect(fake.writesTo('siteops_unplaced').length > 0).toBe(true)
    expect(fake.outbox().some((b) => /couldn't read that photo/i.test(b))).toBe(true)
    expect(fake.writesTo('wa_conversations').some((w) => w.payload?.slots_so_far?.kind === 'siteops_project')).toBe(false)
  })
})
