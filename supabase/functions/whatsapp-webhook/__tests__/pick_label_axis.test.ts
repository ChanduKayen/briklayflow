// THE PICK ASKED THE WRONG QUESTION (live, 2026-07-16). He said, in Telugu:
//
//   "డాక్టర్ సౌందర్య సైట్లో ఫస్ట్ ఫ్లోర్లో సీలింగ్ పిఓపి షీట్స్ ఎక్కించేశాము."
//   (At Dr Soundarya site, on the FIRST FLOOR, we installed ceiling POP sheets.)
//
// He named the floor. Every option we offered was ALREADY on that floor. And we asked him
// "Where should this go?" — a question whose answer ("first floor") is true of every row on
// the list. He asked, reasonably: why are you asking me for a floor I just gave you?
//
// THE ASK ITSELF WAS RIGHT. Two engine types genuinely fit: `ceiling_board` ("Ceiling — boarding",
// hanging the sheets) and `pop_finish` ("Ceiling — POP finish", the plaster over them). His words
// name the boarding ACT and the POP MATERIAL, so the tie is real and the resolver tagged it
// axis:'meaning' — WHICH WORK. The renderer then threw that away and re-derived the axis by
// STRING-SPLITTING the display label on its first ' — ':
//
//   "Ceiling — POP finish — First"  →  name "Ceiling", loc "POP finish — First"
//   "Ceiling — boarding — First"    →  name "Ceiling", loc "boarding — First"
//
// Same name, both locs non-empty → "these differ by LOCATION" → "Where should this go?", and a row
// titled "POP finish — First". Every fact in that reading is wrong.
//
// The collision is structural, not incidental: the engine's naming contract is `Category — Work`
// (library.ts — "Ceiling — POP finish", "Floor — tiling", "Electrical — wire pulling"), and the row
// composer appends the floor with the SAME ' — ' separator. The first ' — ' is therefore NEVER the
// name/location boundary for a real engine label. It only looked like one because every fixture in
// the suite used single-segment names the engine has never emitted ("Floor tiling", "Plumbing
// rough-in"), which is exactly why this shipped.
//
// THE RULE: name and location are FACTS (site_tasks.name / floor_label / unit_label), carried from
// the row to the renderer. They are never re-derived from a display string. A label is for reading;
// it is not a data structure.

import { suite, test, expect } from './harness'
import { fakeSupabase } from './fake_supabase'
import { applyTerminals, type ExecCtx } from '../_agents/siteops.ts'
import type { Terminal } from '../_siteops_resolution.ts'

const ORG = 'org-1'
const SENDER = '919900000000'
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) =>
  ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const, interactiveId: null })

// A row as the PRODUCTION composer builds it: the title is COMPOSED from the facts
// (`_siteops_resolution_llm.ts` rowTitle → `${name}${' — '+floor}${' · '+unit}`), never parsed back.
type Row = { id: string; name: string; floor: string | null; unit: string | null }
const titleOf = (r: Row) => `${r.name}${r.floor ? ` — ${r.floor}` : ''}${r.unit ? ` · ${r.unit}` : ''}`

// The live tie — two REAL engine labels (library.ts:410 + :418), both pinned to First.
const CEILING_ROWS: Row[] = [
  { id: 'cb-1', name: 'Ceiling — boarding', floor: 'First', unit: null },
  { id: 'pf-1', name: 'Ceiling — POP finish', floor: 'First', unit: null },
]
// One real engine label on four floors — the genuine LOCATION axis, with an internal ' — ' too.
const WIRING_ROWS: Row[] = ['First', 'Second', 'Third', 'Fourth'].map((f, i) => ({
  id: `w-${i}`, name: 'Electrical — wire pulling', floor: f, unit: 'Unit A',
}))

const seedOf = (rows: Row[]) => ({
  projects: [{ project_id: 'P1', name: 'Dr Sonudharya Residence' }],
  site_tasks: Object.fromEntries(rows.map((r) => [r.id, {
    task_id: r.id, project_id: 'P1', org_id: ORG, name: r.name, status: 'OPEN',
    floor_label: r.floor, unit_label: r.unit,
  }])),
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
})

const askTerminal = (ids: string[], axis: 'meaning' | 'location'): Terminal => ({
  kind: 'question_asked', about: 'which_item', axis, ref: ids[0], shortlistIds: ids, reason: '',
})

// candById as runSiteops builds it (siteops.ts — one entry per PHYSICAL row, carrying the row's
// structured facts alongside the composed title).
const execFor = (rows: Row[], message: string): ExecCtx => ({
  itemsById: new Map(),
  labelById: new Map(rows.map((r) => [r.id, titleOf(r)])),
  candById: new Map(rows.map((r) => [r.id, {
    kind: 'task' as const, title: titleOf(r), projectId: 'P1' as string | null,
    projectName: 'Dr Sonudharya Residence' as string | null,
    name: r.name, floor: r.floor, unit: r.unit,
  }])),
  cadenceMap: new Map(), actorId: 'u1', now: new Date('2026-07-16T13:45:00Z'),
  narrationId: 'narr-1', projectId: 'P1', message,
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const listOf = (fake: ReturnType<typeof fakeSupabase>): any =>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fake.writesTo('outbox').map((w: any) => w.payload?.payload).find((p: any) => p?.kind === 'list')

suite('siteops — the pick names the axis its options actually vary on', () => {
  // THE LIVE BUG, pinned.
  test('(A1) two ceiling types on the floor he named → "Which work is this?", never "Where should this go?"', async () => {
    const fake = fakeSupabase(seedOf(CEILING_ROWS))
    await applyTerminals(ctxFor(fake), [askTerminal(['cb-1', 'pf-1'], 'meaning')],
      execFor(CEILING_ROWS, 'first floor ceiling pop sheets installed'))

    const list = listOf(fake)
    expect(!!list).toBe(true)
    // He gave us the floor. Asking for it back is the non-sequitur.
    expect(/Where should this go\?/.test(list.body)).toBe(false)
    expect(/Which work is this\?/.test(list.body)).toBe(true)
  })

  test('(A2) …and the row TITLE is the work that tells them apart — never a mis-split of the label', async () => {
    const fake = fakeSupabase(seedOf(CEILING_ROWS))
    await applyTerminals(ctxFor(fake), [askTerminal(['cb-1', 'pf-1'], 'meaning')],
      execFor(CEILING_ROWS, 'first floor ceiling pop sheets installed'))

    const list = listOf(fake)
    // The differentiator is the WORK (both are on First), so the work is the title — whole, both
    // segments of it. "POP finish — First" was the old mis-split: a work fragment glued to a floor.
    expect(list.rows[0].title).toBe('Ceiling — boarding')
    expect(list.rows[1].title).toBe('Ceiling — POP finish')
    // …and the description still carries the fact whole, floor included, on every row.
    expect(list.rows[0].description).toBe('Ceiling — boarding — First')
    expect(list.rows[1].description).toBe('Ceiling — POP finish — First')
  })

  // The mirror image: the location axis must SURVIVE the fix. A real engine label carries an internal
  // ' — ' here too, so the old split mangled this case as well — it just happened to mangle it into the
  // right answer, by reading "wire pulling — First · Unit A" as the location.
  test('(A3) one real engine label on four floors → still the LOCATION axis, and the floor is the title', async () => {
    const fake = fakeSupabase(seedOf(WIRING_ROWS))
    await applyTerminals(ctxFor(fake), [askTerminal(WIRING_ROWS.map((r) => r.id), 'location')],
      execFor(WIRING_ROWS, 'wire pulling done'))

    const list = listOf(fake)
    expect(/Where should this go\?/.test(list.body)).toBe(true)
    expect(list.rows[0].title).toBe('First · Unit A')
    expect(list.rows[3].title).toBe('Fourth · Unit A')
    expect(list.rows[0].description).toBe('Electrical — wire pulling — First · Unit A')
  })

  // A grab-bag (different work AND different places) must claim neither axis.
  test('(A4) different work in different places → "Which one is it?" (neither axis is the differentiator)', async () => {
    const MIXED: Row[] = [
      { id: 'cb-1', name: 'Ceiling — boarding', floor: 'First', unit: null },
      { id: 'ft-2', name: 'Floor — tiling', floor: 'Second', unit: null },
    ]
    const fake = fakeSupabase(seedOf(MIXED))
    await applyTerminals(ctxFor(fake), [askTerminal(['cb-1', 'ft-2'], 'meaning')], execFor(MIXED, 'work done'))

    const list = listOf(fake)
    expect(/Which one is it\?/.test(list.body)).toBe(true)
    expect(list.rows[0].title).toBe('Ceiling — boarding')
  })
})
