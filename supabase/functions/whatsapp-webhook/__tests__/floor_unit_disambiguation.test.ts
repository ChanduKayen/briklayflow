// THE TASK PIN (redesign, 2026-07-11). The model names a task TYPE; CODE pins the physical row from the
// narration's structure slot. The model is NEVER shown a floor, so it cannot pick the wrong one — pinning is
// a deterministic FILTER over the type's open rows, not a guess. This file is the pin's spec.
//
// filter type rows by slot.floor/unit →  1 row → APPLY  ·  >1 → ASK (which_item over the rows)  ·
//   all-quantifier → SWEEP (minus except)  ·  0-with-floor → geometry decides: the floor doesn't exist → ASK
//   over the rows that do (see no_such_floor_ask.test.ts)  ·  it exists but isn't tracked → acked_no_place.

import { suite, test, expect } from './harness'
import {
  executeResolution,
  type ResolutionContract, type ResolutionContext, type Terminal, type AttachUpdate, type TaskRowRef, type StructureSlot, type Geometry,
} from '../_siteops_resolution.ts'

const TYPE = 'T'   // the task TYPE id the model names; code pins a row from it
const tUpd = (o: Partial<AttachUpdate> = {}): AttachUpdate => ({
  target_id: TYPE, target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: '', ...o,
})
const base = (u: AttachUpdate): ResolutionContract => ({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [u] },
})
// The context: the type's OPEN rows + the narration's structure slot (+ optional geometry).
const ctxPin = (rows: TaskRowRef[], slot: Partial<StructureSlot> = {}, geometry: Geometry | null = null): ResolutionContext => ({
  candidateIds: new Set([TYPE]),
  isImage: false,
  taskRowsByType: new Map([[TYPE, rows]]),
  structure: { floor: null, unit: null, all: false, except: null, ...slot },
  geometry,
})
const row = (id: string, floor: string | null, unit: string | null): TaskRowRef => ({ id, name: 'Plumbing rough-in', floor, unit, title: `Plumbing rough-in${floor ? ` — ${floor}` : ''}${unit ? ` · ${unit}` : ''}` })
const askShortlist = (t: Terminal[]): string[] => t.flatMap((x) => (x.kind === 'question_asked' ? (x.shortlistIds ?? []) : []))
const collectiveIds = (t: Terminal[]): string[] => t.flatMap((x) => (x.kind === 'object_updated' ? (x.collectiveTargetIds ?? []) : []))
const updatedId = (t: Terminal[]): string | null => { const o = t.find((x) => x.kind === 'object_updated'); return o && o.kind === 'object_updated' ? o.update.target_id : null }

// five floors of the same trade, ONE unit each (the exact live shape)
const FIVE_FLOORS: TaskRowRef[] = [row('pr-ground', 'Ground', null), row('pr-first', 'First', null), row('pr-second', 'Second', null), row('pr-third', 'Third', null), row('pr-fourth', 'Fourth', null)]
// Fourth floor with TWO units; Third with one
const MIXED_UNITS: TaskRowRef[] = [row('pr-4a', 'Fourth', 'Unit A'), row('pr-4b', 'Fourth', 'Unit B'), row('pr-3a', 'Third', 'Unit A')]

suite('siteops resolution v2 — the task pin (type + structure slot)', () => {
  // THE BUG the redesign kills — a floorless report over 5 same-name rows. The model can no longer target a
  // floor (it only names the type); with no floor in the slot the pin can't narrow → ASK, never a silent write.
  test('no floor, 5 rows → which_item ASK over all five, no write', () => {
    const t = executeResolution(base(tUpd()), ctxPin(FIVE_FLOORS))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('question_asked')
    expect(t[0].kind === 'question_asked' && t[0].about).toBe('which_item')
    expect(new Set(askShortlist(t))).toEqual(new Set(['pr-ground', 'pr-first', 'pr-second', 'pr-third', 'pr-fourth']))
    expect(t.some((x) => x.kind === 'object_updated')).toBe(false)
  })

  // Floor named, that floor has 2 units → ask WHICH UNIT, over THAT floor's units only (Third's isn't offered).
  test('floor named, 2 units on it → which_item ASK over that floor’s units only, no write', () => {
    const t = executeResolution(base(tUpd()), ctxPin(MIXED_UNITS, { floor: 'Fourth' }))
    expect(t[0].kind).toBe('question_asked')
    expect(new Set(askShortlist(t))).toEqual(new Set(['pr-4a', 'pr-4b']))
    expect(t.some((x) => x.kind === 'object_updated')).toBe(false)
  })

  // Floor named, that floor has ONE unit → pinned → APPLY (no unit ask falls out of the count).
  test('floor named, single unit on it → APPLIES, no unit ask', () => {
    const oneUnit = [row('pr-4', 'Fourth', null), row('pr-3', 'Third', null)]
    const t = executeResolution(base(tUpd()), ctxPin(oneUnit, { floor: 'Fourth' }))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('object_updated')
    expect(updatedId(t)).toBe('pr-4')
  })

  // Floor + unit both named → applies to exactly that row.
  test('floor + unit named → applies to exactly that row', () => {
    const t = executeResolution(base(tUpd()), ctxPin(MIXED_UNITS, { floor: 'Fourth', unit: 'Unit B' }))
    expect(t[0].kind).toBe('object_updated')
    expect(updatedId(t)).toBe('pr-4b')
  })

  // The slot pins Unit B → pr-4b. (The old "model targeted the wrong unit" case is gone: the model never
  // targets a unit now — only the type — so there is nothing to retarget off. The slot IS the location.)
  test('slot names Unit B → pins that row, not any other', () => {
    const t = executeResolution(base(tUpd()), ctxPin(MIXED_UNITS, { floor: 'Fourth', unit: 'Unit B' }))
    expect(updatedId(t)).toBe('pr-4b')
  })

  // A uniquely-placed type (one open row) is unambiguous even with no floor → APPLY.
  test('single row, no floor → APPLIES, no ask', () => {
    const t = executeResolution(base(tUpd()), ctxPin([row('pr-only', 'Ground', null)]))
    expect(t[0].kind).toBe('object_updated')
    expect(updatedId(t)).toBe('pr-only')
  })

  // "4th" (a message ordinal) canonicalises to the structure's "Fourth" — both sides pass through canonFloor.
  test('slot floor "4th" canonicalises to "Fourth" → pinned, applies', () => {
    const oneUnit = [row('pr-4', 'Fourth', null), row('pr-3', 'Third', null)]
    const t = executeResolution(base(tUpd()), ctxPin(oneUnit, { floor: '4th' }))
    expect(t[0].kind).toBe('object_updated')
    expect(updatedId(t)).toBe('pr-4')
  })

  // ── the "all" quantifier (now a slot flag, not a per-update field) ─────────────────────────────────────
  test('all, no floor → SWEEP all five, no ask', () => {
    const t = executeResolution(base(tUpd()), ctxPin(FIVE_FLOORS, { all: true }))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('object_updated')
    expect(new Set(collectiveIds(t))).toEqual(new Set(['pr-ground', 'pr-first', 'pr-second', 'pr-third', 'pr-fourth']))
    expect(t.some((x) => x.kind === 'question_asked')).toBe(false)
  })

  test('all + floor → SWEEP that floor’s units only', () => {
    const t = executeResolution(base(tUpd()), ctxPin(MIXED_UNITS, { floor: 'Fourth', all: true }))
    expect(t[0].kind).toBe('object_updated')
    expect(new Set(collectiveIds(t))).toEqual(new Set(['pr-4a', 'pr-4b']))
  })

  test('all + except → SWEEP everything but the carve-out', () => {
    const t = executeResolution(base(tUpd()), ctxPin(FIVE_FLOORS, { all: true, except: { floors: ['Fifth', 'Fourth'], units: [] } }))
    const ids = [...collectiveIds(t)].sort()
    expect(ids).toEqual(['pr-first', 'pr-ground', 'pr-second', 'pr-third'])   // Fourth carved out; Fifth vacuous
  })

  test('NOT all, 5 rows, no floor → still a which_item ASK (no accidental sweep)', () => {
    const t = executeResolution(base(tUpd()), ctxPin(FIVE_FLOORS))
    expect(t[0].kind).toBe('question_asked')
    expect(collectiveIds(t).length).toBe(0)
  })

  // ── geometry: a floor with no matching row — missing floor vs untracked task ───────────────────────────
  const geo = (floors: string[]): Geometry => ({ floors, unitsByFloor: new Map(floors.map((f) => [f, []])) })

  // A floor that is not in the building is AMBIGUITY, not a dead end — the pin ASKS over the rows that do
  // exist, carrying "this site has no floor Fifth" as the question's preamble. See no_such_floor_ask.test.ts
  // for the full spec (and the live photo it was born from).
  test('slot names a floor NOT in the geometry → which_item ASK over the real rows, no write', () => {
    const t = executeResolution(base(tUpd()), ctxPin(FIVE_FLOORS, { floor: 'Fifth' }, geo(['Ground', 'First', 'Second', 'Third', 'Fourth'])))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('question_asked')
    expect(new Set(askShortlist(t))).toEqual(new Set(['pr-ground', 'pr-first', 'pr-second', 'pr-third', 'pr-fourth']))
    expect(t.some((x) => x.kind === 'object_updated')).toBe(false)
  })

  test('floor EXISTS but this type has no row there → acked_no_place (nothing to pick between)', () => {
    // Wiring rows on 1–4; the message says the 5th, and the 5th DOES exist in the building.
    const t = executeResolution(base(tUpd()), ctxPin(FIVE_FLOORS, { floor: 'Fifth' }, geo(['Ground', 'First', 'Second', 'Third', 'Fourth', 'Fifth'])))
    expect(t[0].kind).toBe('acked_no_place')
    expect(t.some((x) => x.kind === 'question_asked')).toBe(false)
  })

  test('no geometry + floor with no row → acked_no_place (degrades honestly, never a wrong "no such floor")', () => {
    const t = executeResolution(base(tUpd()), ctxPin(FIVE_FLOORS, { floor: 'Fifth' }, null))
    expect(t[0].kind).toBe('acked_no_place')
  })
})
