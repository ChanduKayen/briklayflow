// THE TRADE GUARD (live failure, 2026-07-13).
//
// He said: "Unit B ki electrical గాడులు తీసాము" — we cut the ELECTRICAL chases for Unit B.
//
// A chase (గాడు) is the groove cut into a wall to bury something; every trade cuts them. But the word
// "chases" appears in exactly ONE label in the whole library — "Plumbing — in-wall lines (chases & sleeves)"
// — and the electrical task is called "Electrical — conduiting (1st fix)" and never says "chase" at all.
//
// So the model picked the plumbing task, and admitted it in its own reason: "…most closely matches the
// in-wall lines (chases & sleeves) task, THOUGH IT IS LABELED AS PLUMBING; the system should confirm."
//
// It confirmed, all right. It asked him to confirm a PLUMBING task, offering exactly one option and no
// electrical alternative. He literally could not say "no, the electrical one".
//
// TWO invariants, and they are different:
//   · A wrong-trade pick is not "low confidence about WHICH ROW". It is the WRONG TASK. Never write it.
//   · An ask must offer something he can say yes to. Being unsure is exactly when the alternatives matter.

import { suite, test, expect } from './harness'
import {
  executeResolution,
  type ResolutionContract, type ResolutionContext, type Terminal, type AttachUpdate, type TaskRowRef, type StructureSlot,
} from '../_siteops_resolution.ts'
import { tradeMismatch, tradeGroups } from '../_siteops_trades.ts'

const PLUMB = 'type:P:plumbing in wall lines chases sleeves'
const ELEC = 'type:P:electrical conduiting 1st fix'

const rows = (name: string, ids: [string, string, string | null][]): TaskRowRef[] =>
  ids.map(([id, floor, unit]) => ({ id, name, floor, unit, title: `${name} — ${floor}${unit ? ` · ${unit}` : ''}` }))

// The real shape: both trades have a row on Second · Unit B.
const PLUMB_ROWS = rows('Plumbing — in-wall lines (chases & sleeves)', [['pl-2b', 'Second', 'Unit B'], ['pl-2a', 'Second', 'Unit A']])
const ELEC_ROWS = rows('Electrical — conduiting (1st fix)', [['el-2b', 'Second', 'Unit B'], ['el-2a', 'Second', 'Unit A']])

const upd = (o: Partial<AttachUpdate> = {}): AttachUpdate => ({
  target_id: PLUMB, target_kind: 'task', action: 'progress', confidence: 'low', closure_explicit: false, reason: '', ...o,
})
const contract = (u: AttachUpdate): ResolutionContract => ({
  issue_snag_found: { found: false, items: [] },
  update_found: { found: true, updates: [u] },
})
const ctx = (message: string, slot: Partial<StructureSlot> = {}): ResolutionContext => ({
  candidateIds: new Set([PLUMB, ELEC]),
  isImage: false,
  taskRowsByType: new Map([[PLUMB, PLUMB_ROWS], [ELEC, ELEC_ROWS]]),
  structure: { floor: 'Second', unit: 'Unit B', all: false, except: null, ...slot },
  geometry: null,
  message,
})
const shortlist = (t: Terminal[]): string[] => t.flatMap((x) => (x.kind === 'question_asked' ? (x.shortlistIds ?? []) : []))
const wrote = (t: Terminal[]): boolean => t.some((x) => x.kind === 'object_updated')

const MSG = 'electrical chases made for 2nd floor Unit B'

suite('the trade is never uncertain', () => {
  test('a trade word decides a trade; a chase does not', () => {
    // "chase" is trade-NEUTRAL and must stay out of the groups. Putting it under electrical would move the
    // bug; putting it under BOTH would make every chase-bearing label match both trades and disable the guard.
    expect(tradeGroups('chases made')).toEqual([])
    expect(tradeMismatch(MSG, 'Plumbing — in-wall lines (chases & sleeves)')).toBe(true)
    expect(tradeMismatch(MSG, 'Electrical — conduiting (1st fix)')).toBe(false)
  })

  test('it reads the language he actually speaks', () => {
    // A guard that only reads English cannot guard a Telugu site.
    expect(tradeMismatch('ఎలక్ట్రికల్ గాడులు తీసాము', 'Plumbing — in-wall lines (chases & sleeves)')).toBe(true)
    expect(tradeMismatch('ఎలక్ట్రికల్ గాడులు తీసాము', 'Electrical — conduiting (1st fix)')).toBe(false)
    expect(tradeMismatch('కరెంట్ పని అయిపోయింది', 'Electrical — wire pulling (2nd fix)')).toBe(false)
  })

  test('SILENCE IS NOT EVIDENCE — a message naming no trade never triggers the guard', () => {
    // Most messages do not name a trade. The guard must be quiet on them, not suspicious of everything.
    expect(tradeMismatch('done for Unit B', 'Plumbing — in-wall lines (chases & sleeves)')).toBe(false)
    expect(tradeMismatch(MSG, 'Snagging & handover')).toBe(false)   // the TASK names no trade
  })

  // ── THE LIVE FAILURE, END TO END ──
  test('a wrong-trade pick NEVER writes — even when the model is confident', () => {
    // HIGH confidence and the wrong trade is still the wrong task. The ladder must not let it land.
    const t = executeResolution(contract(upd({ confidence: 'high' })), ctx(MSG))
    expect(wrote(t)).toBe(false)
    expect(t[0].kind).toBe('question_asked')
  })

  test('…and the ask OFFERS HIM THE ELECTRICAL ONE — the thing he actually said', () => {
    const t = executeResolution(contract(upd()), ctx(MSG))
    const offered = shortlist(t)
    expect(offered.includes('el-2b')).toBe(true)      // his trade, his floor, his unit
    expect(offered.includes('pl-2b')).toBe(true)      // the model's pick still rides along — never fewer options
    // and NOT the other unit: he said Unit B, and the pin still holds
    expect(offered.includes('el-2a')).toBe(false)
    expect(offered.includes('pl-2a')).toBe(false)
  })

  test('a LOW-confidence pick in the RIGHT trade also gains its alternatives', () => {
    // The old shortlist was the rows of the model's OWN pick — so on a low-confidence guess we offered him
    // only the thing we were unsure about. Being unsure is when alternatives matter most.
    const t = executeResolution(contract(upd({ target_id: ELEC, confidence: 'low' })), ctx('electrical work done on 2nd floor Unit B'))
    expect(shortlist(t).includes('el-2b')).toBe(true)
    expect(wrote(t)).toBe(false)
  })

  test('a HIGH-confidence pick in the RIGHT trade still lands — the guard adds no friction', () => {
    const t = executeResolution(contract(upd({ target_id: ELEC, confidence: 'high' })), ctx(MSG))
    expect(wrote(t)).toBe(true)
  })
})
