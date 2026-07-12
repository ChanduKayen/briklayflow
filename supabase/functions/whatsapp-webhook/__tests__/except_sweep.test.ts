// EXCEPT-SWEEP CODE-FLOOR (2026-07-11). Live probe (The Pride): "wiring done for the whole apartment except
// the fifth floor" should SWEEP First/Second/Ground/Third/Fourth and leave Fifth — but the model dropped the
// all-quantifier (structure.all=false), so pinTask forced a single-floor which_item pick, and both "5" and
// "Fourth" wrongly landed on Wiring-Fourth. Worse, on a code-mixed transcript the model SPLITS the sentence
// into "all done" + "fifth pending", separating the quantifier from its carve-out.
//
// Two deterministic repairs (model-disobedience → code-floor, the house pattern):
//   (1) applyStructureCodeFloor — set all/except on ONE item from its own text.
//   (2) reconcileSweepComplement — MERGE a split "all done" + "one floor pending" into one sweep.

import { suite, test, expect } from './harness'
import { applyStructureCodeFloor, reconcileSweepComplement, decompose } from '../_siteops_extract.ts'
import type { SiteItem } from '../_siteops_extract.ts'

const prog = (text: string, structure: SiteItem['structure'] = null): SiteItem => ({
  type: 'progress', text, task_hint: null, structure, qc_statements: [], cause: null, cause_reason: null,
  owner_hint: null, date_hint: null, project_hint: null,
})
const issue = (text: string): SiteItem => ({ ...prog(text), type: 'issue', cause: 'other' })

suite('extract — applyStructureCodeFloor sets all/except the model missed', () => {
  test('"entire apartment except the fifth floor" → all:true, except Fifth', () => {
    const s = applyStructureCodeFloor(null, 'wiring completed for the entire apartment except the fifth floor')
    expect(s?.all).toBe(true)
    expect(s?.except?.floors ?? []).toEqual(['Fifth'])
  })
  test('a structural all-quantifier with NO except sweeps everything (except stays null)', () => {
    const s = applyStructureCodeFloor(null, 'all floors wired')
    expect(s?.all).toBe(true)
    expect(s?.except).toBe(null)
  })
  test('no all-quantifier → untouched (a single-floor report still asks/pins normally)', () => {
    expect(applyStructureCodeFloor(null, 'wiring done on the third floor')).toBe(null)
  })
  test('SAFETY: a BARE "all" (no structural scope) does NOT sweep — stays an ASK', () => {
    // "all good, wiring done" must not be read as "sweep every floor's wiring".
    expect(applyStructureCodeFloor(null, 'all good, wiring done')).toBe(null)
  })
  test('SAFETY: an except we cannot parse to a floor does NOT set all (never over-sweep the carve-out)', () => {
    // "penthouse" isn't in the floor vocab → we can't subtract it → refuse to sweep, let it ask.
    expect(applyStructureCodeFloor(null, 'everything done except the penthouse')).toBe(null)
  })
  test('Tenglish "antha ... thappa fifth" is detected too', () => {
    const s = applyStructureCodeFloor(null, 'wiring antha done, fifth floor thappa')
    expect(s?.all).toBe(true)
    expect(s?.except?.floors ?? []).toEqual(['Fifth'])
  })
})

suite('extract — reconcileSweepComplement merges a split "all done" + "floor pending"', () => {
  test('the pending floor folds into the all-item\'s except; the separate item is dropped', () => {
    const out = reconcileSweepComplement([
      prog('wiring completed for the entire apartment'),
      issue('fifth floor wiring pending'),
    ])
    expect(out.length).toBe(1)
    expect(out[0].type).toBe('progress')
    expect(out[0].structure?.all).toBe(true)
    expect(out[0].structure?.except?.floors ?? []).toEqual(['Fifth'])
  })
  test('GUARD: a different-trade "pending" item is NOT merged (no shared work word)', () => {
    const out = reconcileSweepComplement([
      prog('entire building plastering done'),   // structural all-quantifier, but a DIFFERENT trade
      issue('fifth floor wiring pending'),
    ])
    expect(out.length).toBe(2)   // plastering-all and wiring-pending are different work — untouched
  })
  test('no all-quantifier item → nothing merged', () => {
    const out = reconcileSweepComplement([prog('wiring done third floor'), issue('fifth floor wiring pending')])
    expect(out.length).toBe(2)
  })
})

suite('extract — decompose reconciles the live-probe split end to end', () => {
  const model = (): (s: string, u: string) => Promise<string> => () => Promise.resolve(JSON.stringify({
    project_hint: null,
    items: [
      { type: 'progress', text: 'wiring completed for the entire apartment', task_hint: null, structure: null, qc_statements: [] },
      { type: 'issue', text: 'fifth floor wiring pending', task_hint: null, structure: null, cause: 'other' },
    ],
  }))
  test('the two split items collapse to ONE sweep with except=Fifth (no bogus issue)', async () => {
    const { items } = await decompose('వైరింగ్ అంతా చేసేసాము అపార్ట్మెంట్ మొత్తం. ఫిఫ్త్ ఫ్లోర్ ఒకటే పెండింగ్ ఉంది.', [], model())
    expect(items.length).toBe(1)
    expect(items[0].type).toBe('progress')
    expect(items[0].structure?.all).toBe(true)
    expect(items[0].structure?.except?.floors ?? []).toEqual(['Fifth'])
  })
})
