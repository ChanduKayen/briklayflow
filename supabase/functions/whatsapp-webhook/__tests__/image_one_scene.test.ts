// ONE PHOTO IS ONE SCENE (live probe, 2026-07-11, 18:23).
//
// Caption: "The pride 4th floor corridor ceilings..". ONE photo. The vision pass returned TWO items — not
// two works, but two HALVES OF THE SAME FRAME:
//
//   • "…corridor ceiling: false ceiling/ceiling boarding and smooth POP/ceiling finish are installed over
//      the FRONT corridor section…"
//   • "…corridor/lift lobby ceiling: false-ceiling metal frame/grid is still exposed at the REAR section…"
//
// Same site, same floor, same ceiling. The prompt says "emit ONE item per DISTINCT observation"; the model
// read "distinct observation" as "distinct region of the picture". Downstream did exactly as it was told:
// two items → two resolveInbound calls → two which_item asks over overlapping ceiling types → he answered
// "False-ceiling frame" TWICE → the SAME row was written twice and the readback said it twice:
//
//     ✓ “False-ceiling frame (Fourth)” updated — The Pride
//     ✓ “False-ceiling frame (Fourth)” updated — The Pride
//
// Two floors, because a prompt can only ask and code must enforce:
//
//   THE MERGE      — a photo is one frame of one place. Items from ONE image that share a place and a kind
//                    are one THOUGHT: they merge into a single grading message (both sentences kept — the
//                    resolver reads them together and may still return two updates if they are two works).
//                    The ack still shows BOTH bullets: what we SAW is reported honestly; what we ASK about
//                    is one question.
//   THE IDEMPOTENCY— the same row, the same action, twice in one turn is one fact. Write it once, say it
//                    once. This is the floor under ANY over-decomposition, not just this one.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'
import { mergeSameScene } from '../_siteops_vision.ts'
import { combineReadbacks } from '../_siteops_readback.ts'
import type { SiteItem } from '../_siteops_extract.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const CAPTION = 'The pride 4th floor corridor ceilings..'
const DESCRIPTION = 'The image shows a view of the corridor ceiling on the 4th floor, under construction.'

// The Pride's real ceiling shape: four ceiling-ish types, each with a Fourth-floor row (the four the live
// probe's two asks offered between them).
const task = (id: string, name: string, floor: string, trade: string, phase: string) =>
  ({ task_id: id, name, project_id: 'P1', status: 'OPEN', floor_label: floor, node_key: id, trade, phase })
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'The Pride' }],
  problems: {}, chase_batches: [],
  site_tasks: {
    'fcf-third': task('fcf-third', 'False-ceiling frame', 'Third', 'ceiling', 'services'),
    'fcf-fourth': task('fcf-fourth', 'False-ceiling frame', 'Fourth', 'ceiling', 'services'),
    'cb-fourth': task('cb-fourth', 'Ceiling boarding', 'Fourth', 'ceiling', 'finishes'),
    'pop-fourth': task('pop-fourth', 'POP / ceiling finish', 'Fourth', 'ceiling', 'finishes'),
    'ohs-fourth': task('ohs-fourth', 'Overhead services (in ceiling void)', 'Fourth', 'mep', 'services'),
  },
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const imgCtx = (fake: ReturnType<typeof fakeSupabase>) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const,
  image: { base64: 'x', mime: 'image/jpeg', caption: CAPTION, description: DESCRIPTION, storagePath: 'rough/x.jpg' },
})

const FRONT = 'The Pride 4th floor corridor ceiling: false ceiling/ceiling boarding and smooth POP/ceiling finish are installed over the front corridor section.'
const REAR = 'The Pride 4th floor corridor/lift lobby ceiling: false-ceiling metal frame/grid is still exposed and in progress at the rear section.'
const visItem = (text: string) => ({ type: 'progress', text, confidence: 'high', task_hint: 'ceiling', structure: null, qc_statements: [] })
// the live vision output: two REGIONS of one ceiling, no floor of its own (the caption carries it)
const VISION_TWO_HALVES = JSON.stringify({ project_hint: 'The Pride', items: [visItem(FRONT), visItem(REAR)] })

const FRAME = 'type:P1:false ceiling frame'
const upd = (target: string, alts: string[] = [], reason = 'ceiling work') => ({
  target_id: target, target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason, alt_target_ids: alts,
})
const resolution = (updates: unknown[]) => JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates, nearest: [] },
})
// the live shape: the model names the frame and says the other ceiling types fit just as well → a TIE → ask.
const R_TIE = resolution([upd(FRAME, ['type:P1:ceiling boarding', 'type:P1:pop ceiling finish', 'type:P1:overhead services in ceiling void'])])
// …and the shape the merge itself makes likelier: ONE message that mentions the frame twice (installed at the
// front, exposed at the rear) → the model returns TWO updates that pin to the SAME row.
const R_SAME_ROW_TWICE = resolution([upd(FRAME, [], 'frame boarded over at the front'), upd(FRAME, [], 'frame still exposed at the rear')])

interface Call { system: string; user: string }
const model = (calls: Call[], resolveRaw: string) => (system: string, user: string): Promise<string> => {
  calls.push({ system, user })
  if (user.startsWith('CANDIDATES:')) return Promise.resolve(resolveRaw)
  if (user.includes('Decompose the image')) return Promise.resolve(VISION_TWO_HALVES)
  return Promise.resolve('')
}
const resolutionCalls = (calls: Call[]) => calls.filter((c) => c.user.startsWith('CANDIDATES:'))
const asks = (fake: ReturnType<typeof fakeSupabase>) => fake.outbox().filter((b) => b.includes('❓'))

// ── THE MERGE, as a pure function (no model, no network) ─────────────────────────────────────────────────
const item = (text: string, floor: string | null, type: SiteItem['type'] = 'progress'): SiteItem => ({
  type, text, task_hint: null, structure: floor ? { floor, unit: null, all: false, except: null } : null,
  qc_statements: [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null,
})

suite('siteops — one photo is one scene (the merge)', () => {
  test('(MS1) two observations at the SAME place, same kind → ONE item, both sentences kept', () => {
    const out = mergeSameScene([item(FRONT, 'Fourth'), item(REAR, 'Fourth')])
    expect(out.length).toBe(1)
    expect(out[0].text.includes('front corridor section')).toBe(true)
    expect(out[0].text.includes('rear section')).toBe(true)
    expect(out[0].structure?.floor).toBe('Fourth')
  })

  test('(MS2) the floor is canonicalised before it is compared ("4th" and "Fourth" are one place)', () => {
    expect(mergeSameScene([item(FRONT, '4th'), item(REAR, 'Fourth')]).length).toBe(1)
  })

  test('(MS3) DIFFERENT places do NOT merge — a photo of two floors is two thoughts', () => {
    expect(mergeSameScene([item(FRONT, 'Fourth'), item(REAR, 'Third')]).length).toBe(2)
  })

  test('(MS4) progress + issue do NOT merge — "a photo can show progress AND a defect; return BOTH"', () => {
    const out = mergeSameScene([item(FRONT, 'Fourth'), item('a crack in the beam', 'Fourth', 'issue')])
    expect(out.length).toBe(2)
  })

  // ONLY PROGRESS MERGES. Two DEFECTS at one place are two defects — a crack in the beam and a leak at the
  // wall are not one thought, and merging them into one message risks the resolver returning one finding and
  // losing the other. The double-ask this merge exists to kill is a TASK-MATCHING cost, and only a progress
  // report is matched to a task; an issue creates its own row and asks nobody. So the merge buys nothing on
  // the issue side and can only lose a defect there.
  test('(MS7) two ISSUES at the same place do NOT merge — a defect is never folded into another defect', () => {
    const out = mergeSameScene([item('a crack in the beam soffit', 'Fourth', 'issue'), item('water seeping at the lift wall', 'Fourth', 'issue')])
    expect(out.length).toBe(2)
  })

  test('(MS8) two to-dos at the same place do NOT merge either — only progress folds', () => {
    const out = mergeSameScene([item('order the tiles', 'Fourth', 'todo'), item('call the inspector', 'Fourth', 'todo')])
    expect(out.length).toBe(2)
  })

  test('(MS9) a merged progress pair KEEPS its issue sibling, in order', () => {
    const out = mergeSameScene([item(FRONT, 'Fourth'), item('a crack in the beam', 'Fourth', 'issue'), item(REAR, 'Fourth')])
    expect(out.length).toBe(2)
    expect(out.map((i) => i.type)).toEqual(['progress', 'issue'])
    expect(out[0].text.includes('rear section')).toBe(true)
  })

  test('(MS5) placeless items merge too (one photo, one unnamed place) — the pin still asks, but ONCE', () => {
    expect(mergeSameScene([item(FRONT, null), item(REAR, null)]).length).toBe(1)
  })

  test('(MS6) a single item passes through untouched', () => {
    const one = [item(FRONT, 'Fourth')]
    expect(mergeSameScene(one)).toEqual(one)
  })
})

// ── THE IDEMPOTENCY, as a pure function ─────────────────────────────────────────────────────────────────
suite('siteops — the readback never says one thing twice', () => {
  test('(ID1) two identical lines for one site collapse to one', () => {
    const line = 'Got it — ✓ “False-ceiling frame (Fourth)” updated'
    const body = combineReadbacks([{ project: 'The Pride', body: line }, { project: 'The Pride', body: line }])
    expect(body.split('False-ceiling frame').length - 1).toBe(1)
  })

  test('(ID2) genuinely different lines all survive', () => {
    const body = combineReadbacks([
      { project: 'The Pride', body: 'Got it — ✓ “False-ceiling frame (Fourth)” updated' },
      { project: 'The Pride', body: 'Got it — ✓ “Ceiling boarding (Fourth)” updated' },
    ])
    expect(body.includes('False-ceiling frame')).toBe(true)
    expect(body.includes('Ceiling boarding')).toBe(true)
  })
})

// ── THE LIVE JOURNEY, END TO END ────────────────────────────────────────────────────────────────────────
suite('siteops — the ceiling photo asks ONCE (the live 18:23 probe)', () => {
  test('(J1) two halves of one ceiling → ONE grading pass and ONE which-item ask (not two)', async () => {
    const fake = fakeSupabase(seed())
    const calls: Call[] = []
    await runSiteops(imgCtx(fake), `${CAPTION} -- ${DESCRIPTION}`, { callModel: model(calls, R_TIE) })

    // the two halves merged into ONE thought → the resolver graded once…
    expect(resolutionCalls(calls).length).toBe(1)
    // …and he is asked about his ceiling exactly once.
    expect(asks(fake).length).toBe(1)
  })

  test('(J2) the ack still shows BOTH bullets — what we SAW is reported in full; only the ASK is one', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake), `${CAPTION} -- ${DESCRIPTION}`, { callModel: model([], R_TIE) })
    const ack = fake.outbox().find((b) => /I see:/.test(b)) ?? ''
    expect(ack.includes('front corridor section')).toBe(true)
    expect(ack.includes('rear section')).toBe(true)
  })

  test('(J3) the merged message names the same row twice → ONE write, ONE readback line', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake), `${CAPTION} -- ${DESCRIPTION}`, { callModel: model([], R_SAME_ROW_TWICE) })

    // the row is written ONCE, however many times the model named it
    const writes = fake.writesTo('site_tasks').filter((w) => w.op === 'update' && w.filters.some(([k, v]) => k === 'task_id' && v === 'fcf-fourth'))
    expect(writes.length).toBe(1)
    // …and he is told once, not twice
    const readback = fake.outbox().find((b) => /updated/.test(b)) ?? ''
    expect(readback.split('False-ceiling frame').length - 1).toBe(1)
  })
})
