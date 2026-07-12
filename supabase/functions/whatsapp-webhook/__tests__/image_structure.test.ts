// THE PHOTO'S FLOOR (live failure 2026-07-11, 15:22).
//
// Caption: "Ceiling work in pride site 4th floor." One photo. The reply offered NINE rows:
//     False-ceiling frame — Cellar / First / Fourth / Ground / Second / Third
//     False Ceiling — Ground / First / Second
// Every ceiling row on every floor of the building, when the message named the floor in its first sentence.
//
// Cause: `structure` — the typed slot that is the ONLY input the task pin reads — is produced by the TEXT
// extractor and was never produced by the VISION extractor. So `structures: [null…]`, `pinTask` had no floor
// to filter by, every row survived, and >1 row means ASK.
//
// With the floor pinned to Fourth, the two ceiling types collapse: "False Ceiling" has no Fourth row at all,
// so exactly ONE row survives — and one row means APPLY. The whole question was an artifact of a dropped fact.
//
// And a second truth: the pick quoted our own description back at him as "You said" ("…Ceiling installation
// framework visible at the construction site"). He never said that. We did.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { runSiteops } from '../_agents/siteops.ts'
import { applyMediaStructure, _validateForTest } from '../_siteops_vision.ts'
import { floorFromText, unitFromText, structureFromText, type SiteItem } from '../_siteops_extract.ts'
import { mediaComposite, humanizeInbound, parseComposite } from '../_siteops_media.ts'

// ── the deterministic reader (no model can be the only guard) ────────────────────────────────────────────
suite('siteops — the floor, read from plain text', () => {
  test('(F1) a floor named as a floor is read, in every shape a site says it', () => {
    expect(floorFromText('Ceiling work in pride site 4th floor.')).toBe('Fourth')
    expect(floorFromText('false ceiling on the fourth floor')).toBe('Fourth')
    expect(floorFromText('slab poured, 2F')).toBe('Second')
    expect(floorFromText('ground floor plastering done')).toBe('Ground')
    expect(floorFromText('cellar parking flooring')).toBe(null)          // "cellar" alone is not "cellar floor"
    expect(floorFromText('work on floor 3 today')).toBe('Third')
  })

  test('(F2) a floor WORD is not a floor — never invent one from a trade or an ordinal', () => {
    expect(floorFromText('first coat of paint done')).toBe(null)
    expect(floorFromText('second opinion needed on the beam')).toBe(null)
    expect(floorFromText('ground the wire properly')).toBe(null)
    expect(floorFromText('ceiling work at the pride site')).toBe(null)   // no floor named → the pin ASKS, as it should
  })

  test('(F3) units too', () => {
    expect(unitFromText('tiles laid in unit B')).toBe('Unit B')
    expect(unitFromText('flat 2 wiring pending')).toBe('Unit B')
    expect(unitFromText('unit work is on')).toBe(null)
  })

  test('(F4) structureFromText carries the sweep quantifier through the existing code floor', () => {
    const s = structureFromText('wiring done for the entire apartment except the fifth floor')
    expect(s?.all).toBe(true)
    expect(s?.except?.floors?.includes('Fifth')).toBe(true)
  })
})

// ── the two voices, each labelled ───────────────────────────────────────────────────────────────────────
suite('siteops — a photo speaks twice, and we say which is which', () => {
  const parts = { caption: 'Ceiling work in pride site 4th floor.', description: 'Ceiling grid installed on the 4th floor.' }

  test('(M1) the composite marks both halves, and parses back apart', () => {
    const c = mediaComposite(parts)
    expect(c.includes('<caption>Ceiling work in pride site 4th floor.</caption>')).toBe(true)
    expect(c.includes('<photo>Ceiling grid installed on the 4th floor.</photo>')).toBe(true)
    expect(parseComposite(c)).toEqual(parts)
  })

  test('(M2) OUR description is never quoted as HIS words', () => {
    const { said, seen } = humanizeInbound(mediaComposite(parts))
    expect(said).toBe('Ceiling work in pride site 4th floor.')          // only the caption is "You said"
    expect(seen).toBe('Ceiling grid installed on the 4th floor.')       // our read, owned by us
  })

  test('(M3) plain text (a voice note) passes through untouched', () => {
    expect(humanizeInbound('tiles laid on the fourth floor')).toEqual({ said: 'tiles laid on the fourth floor', seen: null })
  })
})

// ── caption wins; the photo supplies what the caption omits ─────────────────────────────────────────────
const item = (text: string, structure: SiteItem['structure'] = null): SiteItem => ({
  type: 'progress', text, task_hint: null, structure, qc_statements: [],
  cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null,
})

suite('siteops — the caption is authoritative, the photo corroborates', () => {
  test('(S1) the caption\'s floor lands on EVERY item the photo produced (inheritance)', () => {
    const out = applyMediaStructure([item('false ceiling grid up'), item('one panel damaged')],
      { caption: 'Ceiling work in pride site 4th floor.', description: 'Ceiling framework visible.' })
    expect(out[0].structure?.floor).toBe('Fourth')
    expect(out[1].structure?.floor).toBe('Fourth')
  })

  test('(S2) no floor in the caption → the PHOTO\'s floor is used (the half we used to throw away)', () => {
    const out = applyMediaStructure([item('false ceiling grid up')],
      { caption: 'ceiling work at pride', description: 'A "4F" sign is visible on the lift panel.' })
    expect(out[0].structure?.floor).toBe('Fourth')
  })

  test('(S3) they CONFLICT → the caption wins (he was standing there)', () => {
    const out = applyMediaStructure([item('grid up', { floor: 'Third', unit: null, all: false, except: null })],
      { caption: 'ceiling work on the 4th floor', description: 'looks like the 3rd floor' })
    expect(out[0].structure?.floor).toBe('Fourth')
  })

  test('(S4) nobody names a floor → NO slot (the pin widens and asks; it never guesses)', () => {
    const out = applyMediaStructure([item('false ceiling grid up')], { caption: 'ceiling work at pride', description: 'a ceiling grid' })
    expect(out[0].structure).toBe(null)
  })

  test('(S5) the vision model\'s own slot is coerced (and a malformed one degrades to null)', () => {
    const good = _validateForTest(JSON.stringify({ project_hint: 'The Pride', items: [{ type: 'progress', text: 'grid up', confidence: 'high', structure: { floor: '4th', unit: null, all: false, except: null } }] }))
    expect(good.items[0].structure?.floor).toBe('4th')
    const bad = _validateForTest(JSON.stringify({ project_hint: null, items: [{ type: 'progress', text: 'grid up', confidence: 'high', structure: 'fourth-ish' }] }))
    expect(bad.items[0].structure).toBe(null)
  })
})

// ── THE LIVE CASE, END TO END ───────────────────────────────────────────────────────────────────────────
const ORG = 'org-1'
const SENDER = '919900000000'
// The Pride's real shape: a ceiling type on every floor, and a second ceiling type on only three of them.
const seed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'The Pride' }],
  problems: {}, chase_batches: [],
  site_tasks: {
    'fcf-cellar': { task_id: 'fcf-cellar', name: 'False-ceiling frame', project_id: 'P1', status: 'OPEN', floor_label: 'Cellar', node_key: 'n1', trade: 'ceiling', phase: 'services' },
    'fcf-ground': { task_id: 'fcf-ground', name: 'False-ceiling frame', project_id: 'P1', status: 'OPEN', floor_label: 'Ground', node_key: 'n2', trade: 'ceiling', phase: 'services' },
    'fcf-first': { task_id: 'fcf-first', name: 'False-ceiling frame', project_id: 'P1', status: 'OPEN', floor_label: 'First', node_key: 'n3', trade: 'ceiling', phase: 'services' },
    'fcf-second': { task_id: 'fcf-second', name: 'False-ceiling frame', project_id: 'P1', status: 'OPEN', floor_label: 'Second', node_key: 'n4', trade: 'ceiling', phase: 'services' },
    'fcf-third': { task_id: 'fcf-third', name: 'False-ceiling frame', project_id: 'P1', status: 'OPEN', floor_label: 'Third', node_key: 'n5', trade: 'ceiling', phase: 'services' },
    'fcf-fourth': { task_id: 'fcf-fourth', name: 'False-ceiling frame', project_id: 'P1', status: 'OPEN', floor_label: 'Fourth', node_key: 'n6', trade: 'ceiling', phase: 'services' },
    'fc-ground': { task_id: 'fc-ground', name: 'False Ceiling', project_id: 'P1', status: 'OPEN', floor_label: 'Ground', node_key: 'n7', trade: 'false_ceiling', phase: 'build_out' },
    'fc-first': { task_id: 'fc-first', name: 'False Ceiling', project_id: 'P1', status: 'OPEN', floor_label: 'First', node_key: 'n8', trade: 'false_ceiling', phase: 'build_out' },
    'fc-second': { task_id: 'fc-second', name: 'False Ceiling', project_id: 'P1', status: 'OPEN', floor_label: 'Second', node_key: 'n9', trade: 'false_ceiling', phase: 'build_out' },
  },
  wa_registered_numbers: [{ user_id: 'u1', phone_number: SENDER, is_active: true }],
  user_profiles: [{ id: 'u1', name: 'Ramesh' }],
  site_narration_id: 'narr-1',
})
const CAPTION = 'Ceiling work in pride site 4th floor.'
const DESCRIPTION = 'Ceiling installation framework visible at the construction site on the 4th floor.'
const imgCtx = (fake: ReturnType<typeof fakeSupabase>) => ({
  supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'en' as const,
  image: { base64: 'x', mime: 'image/jpeg', caption: CAPTION, description: DESCRIPTION, storagePath: 'rough/x.jpg' },
})
// the vision model names the work but NOT the floor (the common case — and the reason a code floor exists)
const VISION = JSON.stringify({
  project_hint: 'The Pride',
  items: [{ type: 'progress', text: 'False ceiling framework installed', confidence: 'high', task_hint: 'ceiling', structure: null, qc_statements: [] }],
})
// …and the resolution model names the TYPE, never a floor (it is never shown one)
const R_UPDATE = JSON.stringify({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [{ target_id: 'type:P1:false ceiling frame', target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'ceiling frame going up' }] },
})
const model = (_s: string, user: string) => Promise.resolve(user.startsWith('CANDIDATES:') ? R_UPDATE : VISION)

suite('siteops — the ceiling photo pins its floor (one apply, zero questions)', () => {
  test('(J1) caption names the 4th floor → ONE row survives → APPLY, and no which-item pick', async () => {
    const fake = fakeSupabase(seed())
    await runSiteops(imgCtx(fake), `${CAPTION} -- ${DESCRIPTION}`, { callModel: model })

    // the pin filtered to Fourth: the ONE ceiling-frame row there is written, and nothing else is
    const writes = fake.writesTo('site_tasks').filter((w) => w.op === 'update')
    expect(writes.length).toBe(1)
    expect(writes[0].filters.some(([k, v]) => k === 'task_id' && v === 'fcf-fourth')).toBe(true)
    // …and the nine-row interrogation is gone
    expect(fake.outbox().some((b) => /Which of these is it about/i.test(b))).toBe(false)
    expect(fake.writesTo('wa_conversations').length).toBe(0)
  })
})
