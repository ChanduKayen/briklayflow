// THE SAME-MEANING TYPE TIE (live probe, 2026-07-11). ASM Elite tracks THREE tiling task types — "Tiling",
// "Floor tiling" and "Wall tiling / dado" — all three `tiling · finishes`, all three with a real First·Unit A
// row. "ఫస్ట్ ఫ్లోర్ యూనిట్ ఏ లో టైల్స్ క్లియర్ చేసేసాం" ("tiles done, first floor Unit A") fits ALL THREE and
// distinguishes NONE. The contract forced ONE target_id, gave the model no way to say "one of these three",
// and BANNED a task from `nearest` — so the only expressible answer left was found:false, which landed on
// acked_didnt_catch ("I couldn't tell which work you meant"). Twice, non-deterministically: the second run
// filled `nearest` with an unrelated DOOR issue that merely shared the location, and asked about that.
//
// Three types of tiling is NOT a data bug (ruled 2026-07-11) — they are genuinely different scopes of work.
// So no prompt and no cleanup can ever pick one: THE ONLY CORRECT OUTPUT IS A QUESTION. This file is that
// question's spec.
//
//   alt_target_ids  — the model names its best TYPE + the equally-fitting others; CODE pins each type's row
//                     from the structure slot and asks over the survivors (a tie that collapses to one row
//                     APPLIES — code disposes, no needless question).
//   the LOW gate    — a low-confidence TASK ask must offer the PINNED ROW ("Floor tiling — First · Unit A"),
//                     never the bare TYPE id (which no executor can write to).
//   the HEDGE VETO  — the prompt already bans a `nearest` whose reason says "may relate"/"might be"; the live
//                     probe shipped exactly that at plausibility med. A prompt can only ask. Code enforces.

import { suite, test, expect } from './harness'
import {
  executeResolution,
  type ResolutionContract, type ResolutionContext, type Terminal, type AttachUpdate, type NearestGuess, type TaskRowRef, type StructureSlot,
} from '../_siteops_resolution.ts'

// the three tiling TYPES, each with its own First·Unit A row (the live ASM Elite shape)
const FLOOR_T = 'type:ASM:floor tiling'
const WALL_T = 'type:ASM:wall tiling dado'
const PLAIN_T = 'type:ASM:tiling'
const row = (id: string, name: string, floor: string | null, unit: string | null): TaskRowRef =>
  ({ id, name, floor, unit, title: `${name}${floor ? ` — ${floor}` : ''}${unit ? ` · ${unit}` : ''}` })

const ROWS = new Map<string, TaskRowRef[]>([
  [FLOOR_T, [row('ft-1a', 'Floor tiling', 'First', 'Unit A'), row('ft-2a', 'Floor tiling', 'Second', 'Unit A')]],
  [WALL_T, [row('wt-1a', 'Wall tiling / dado', 'First', 'Unit A'), row('wt-2a', 'Wall tiling / dado', 'Second', 'Unit A')]],
  [PLAIN_T, [row('pt-1a', 'Tiling', 'First', 'Unit A')]],
])

const tUpd = (o: Partial<AttachUpdate> = {}): AttachUpdate => ({
  target_id: FLOOR_T, target_kind: 'task', action: 'progress', confidence: 'high', closure_explicit: false, reason: 'tiles done', ...o,
})
const base = (u: AttachUpdate): ResolutionContract => ({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [u] },
})
const ctxTie = (slot: Partial<StructureSlot> = {}, rows = ROWS): ResolutionContext => ({
  candidateIds: new Set([...rows.keys()]),
  isImage: false,
  taskRowsByType: rows,
  structure: { floor: null, unit: null, all: false, except: null, ...slot },
  geometry: null,
  itemType: 'progress',
})
const FIRST_A: Partial<StructureSlot> = { floor: 'First', unit: 'Unit A' }
const shortlist = (t: Terminal[]): string[] => t.flatMap((x) => (x.kind === 'question_asked' ? (x.shortlistIds ?? []) : []))
const updatedId = (t: Terminal[]): string | null => { const o = t.find((x) => x.kind === 'object_updated'); return o && o.kind === 'object_updated' ? o.update.target_id : null }

suite('siteops resolution — the same-meaning TYPE TIE (three tiling types)', () => {
  // THE LIVE BUG. The model can now say "Floor tiling, but Wall tiling and Tiling fit just as well". Code pins
  // each type's First·Unit A row and asks over the three — the supervisor taps one. Never a silent miss, and
  // never an arbitrary pick between three real, different scopes of work.
  test('(TIE1) three fitting types → ONE which_item ask over the three PINNED rows, no write', () => {
    const t = executeResolution(base(tUpd({ confidence: 'med', alt_target_ids: [WALL_T, PLAIN_T] })), ctxTie(FIRST_A))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('question_asked')
    expect(t[0].kind === 'question_asked' && t[0].about).toBe('which_item')
    // the ROW ids at the named location — not the TYPE ids, and not the Second-floor rows
    expect(new Set(shortlist(t))).toEqual(new Set(['ft-1a', 'wt-1a', 'pt-1a']))
    expect(t.some((x) => x.kind === 'object_updated')).toBe(false)
    expect(t.some((x) => x.kind === 'acked_didnt_catch')).toBe(false)
  })

  // CODE DISPOSES. A tie is only a tie if more than one type actually EXISTS at the named place. If the
  // structure slot narrows it to ONE surviving row, there is nothing to ask: apply it.
  test('(TIE2) tie collapses to ONE row at the named location → APPLY, no needless question', () => {
    const rows = new Map(ROWS)
    rows.set(WALL_T, [row('wt-2a', 'Wall tiling / dado', 'Second', 'Unit A')])   // no First·Unit A wall-tiling row
    rows.set(PLAIN_T, [row('pt-2a', 'Tiling', 'Second', 'Unit A')])              // nor plain tiling
    const t = executeResolution(base(tUpd({ confidence: 'high', alt_target_ids: [WALL_T, PLAIN_T] })), ctxTie(FIRST_A, rows))
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('object_updated')
    expect(updatedId(t)).toBe('ft-1a')          // the ONLY tiling row on First · Unit A
  })

  // An alt the call never offered is an INVENTED referent — the membership guard applies to alts exactly as it
  // does to target_id. It is dropped from the tie, never asked about.
  test('(TIE3) an un-offered alt id is ignored (no invented referent enters the ask)', () => {
    const t = executeResolution(base(tUpd({ confidence: 'med', alt_target_ids: [WALL_T, 'type:ASM:nonexistent'] })), ctxTie(FIRST_A))
    expect(new Set(shortlist(t))).toEqual(new Set(['ft-1a', 'wt-1a']))
  })

  // THE LOW GATE, fixed. A low-confidence TASK update asked over the bare TYPE id — a "type:…" handle that is
  // not a task_id, so a confirm loaded no row and parked. The ask must offer the PINNED ROW, whose label is the
  // thing a human can actually read and tap ("Floor tiling — First · Unit A").
  test('(TIE4) LOW-confidence task update → ask offers the PINNED ROW id, never the TYPE id', () => {
    const t = executeResolution(base(tUpd({ confidence: 'low' })), ctxTie(FIRST_A))
    expect(t[0].kind).toBe('question_asked')
    expect(shortlist(t)).toEqual(['ft-1a'])
    expect(shortlist(t).some((id) => id.startsWith('type:'))).toBe(false)
    expect(t.some((x) => x.kind === 'object_updated')).toBe(false)
  })
})

// ── THE HEDGE VETO (the recall floor's code floor) ───────────────────────────────────────────────────────
// RESOLUTION_SYSTEM already says it: "If the reason you would write contains 'may relate', 'might be', or
// 'possibly', the honest answer is []". The live probe answered:
//   "…tiles have been cleared in First floor Unit A, which MAY RELATE to progress on fixing the door issue"
// at plausibility MED — the one value that asks — matching on the LOCATION, not the work. A prompt can only
// ask; code enforces. A model that would BET on a match does not hedge, so the veto cannot cost a real one.
const nearest = (o: Partial<NearestGuess> = {}): NearestGuess => ({
  target_id: 'iss-door', target_kind: 'issue', plausibility: 'med', action: 'progress', closure_explicit: false,
  reason: 'the transformer issue is the same work', ...o,
})
const bothFalse = (n: NearestGuess[]): ResolutionContract => ({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: false, updates: [], nearest: n },
})
const ctxNear = (): ResolutionContext => ({
  candidateIds: new Set(['iss-door']), isImage: false, itemType: 'progress', taskCoverage: 'open',
})

suite('siteops resolution — the nearest HEDGE VETO', () => {
  test('(HV1) a MED nearest whose reason hedges ("may relate") does NOT ask — honest didn’t-catch instead', () => {
    const t = executeResolution(bothFalse([nearest({ reason: 'tiles cleared in First floor Unit A, which may relate to progress on fixing the door issue in that unit' })]), ctxNear())
    expect(t.length).toBe(1)
    expect(t[0].kind).toBe('acked_didnt_catch')
    expect(t.some((x) => x.kind === 'question_asked')).toBe(false)
  })

  test('(HV2) other hedges are vetoed too (might be / possibly / could be / perhaps / not sure)', () => {
    for (const r of ['this might be the same work', 'possibly the same item', 'could be about the tiling', 'perhaps related', 'not sure, but close']) {
      const t = executeResolution(bothFalse([nearest({ reason: r })]), ctxNear())
      expect(t[0].kind).toBe('acked_didnt_catch')
    }
  })

  // NO REGRESSION — a MED nearest that actually BETS still asks. The veto reads the model's own justification,
  // it does not second-guess the meaning.
  test('(HV3) a MED nearest with a confident reason still ASKS (the recall floor survives)', () => {
    const t = executeResolution(bothFalse([nearest({ reason: 'the message reports the transformer issue is fixed — same item' })]), ctxNear())
    expect(t[0].kind).toBe('question_asked')
    expect(t[0].kind === 'question_asked' && t[0].about).toBe('which_item')
    expect(shortlist(t)).toEqual(['iss-door'])
  })
})
