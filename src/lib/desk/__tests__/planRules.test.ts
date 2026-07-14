// PLAN SETUP — the rules that pick a building's systems.
//
// This is the only part of the setup screen that can be silently WRONG: a lift the rules forget is a
// building generated with no lift, and nobody finds out until someone walks up nine floors. So the
// thresholds are pinned here, exactly as the reference states them.

import { suite, test, expect } from './harness'
import { autoSet, isOn, chosen, toggle, ruleHints, ALL_SYSTEMS, SYSTEMS } from '../planRules'

const A = (f: number, u: number, p: 'none' | 'stilt' | 'cellar' = 'none') => autoSet(f, u, p)

suite('autoSet — what a building of this shape gets before anybody touches it', () => {
  test('every building gets water and a boundary, however small', () => {
    const a = A(1, 1)
    expect(a.has('Overhead tank')).toBe(true)
    expect(a.has('Sump / UG tank')).toBe(true)
    expect(a.has('Borewell')).toBe(true)
    expect(a.has('Compound wall & gate')).toBe(true)
  })

  test('a single home gets nothing it does not need', () => {
    const a = A(1, 1)
    expect(a.has('Lift')).toBe(false)
    expect(a.has('Common staircase')).toBe(false)
    expect(a.has('Corridor finishes')).toBe(false)
    expect(a.has('Transformer')).toBe(false)
    expect(a.has('DG / generator')).toBe(false)
    expect(a.has('Parking')).toBe(false)
  })

  test('a parking level means a Parking system — either kind', () => {
    expect(A(1, 1, 'stilt').has('Parking')).toBe(true)
    expect(A(1, 1, 'cellar').has('Parking')).toBe(true)
    expect(A(1, 1, 'none').has('Parking')).toBe(false)
  })

  test('two floors need a staircase; shared floors need a corridor', () => {
    expect(A(2, 1).has('Common staircase')).toBe(true)
    expect(A(2, 1).has('Corridor finishes')).toBe(false)   // one home per floor: no shared corridor
    expect(A(2, 2).has('Corridor finishes')).toBe(true)
  })

  test('THE CLIMB, not the floor count, calls the lift — a stilt is a storey your legs still climb', () => {
    expect(A(3, 1, 'none').has('Lift')).toBe(false)        // 3 floors: no lift
    expect(A(4, 1, 'none').has('Lift')).toBe(true)         // 4 floors: lift
    expect(A(3, 1, 'stilt').has('Lift')).toBe(true)        // 3 + stilt = a 4-storey climb
  })

  test('fire fighting and STP arrive with height OR with density', () => {
    expect(A(5, 1).has('Fire fighting')).toBe(true)        // tall
    expect(A(5, 1).has('STP')).toBe(true)
    expect(A(2, 4).has('Fire fighting')).toBe(true)        // 8 homes: dense
    expect(A(2, 4).has('STP')).toBe(true)
    expect(A(2, 2).has('STP')).toBe(false)                 // 4 homes: neither
  })

  test('power scales with homes: transformer above 4, DG above 8', () => {
    expect(A(2, 2).has('Transformer')).toBe(false)         // exactly 4 — above, not at
    expect(A(1, 5).has('Transformer')).toBe(true)
    expect(A(2, 4).has('DG / generator')).toBe(false)      // exactly 8
    expect(A(3, 3).has('DG / generator')).toBe(true)       // 9
  })
})

suite('the user overrules the rules — and the override is a DIVERGENCE, not a copy', () => {
  test('a tick that agrees with the rules is not remembered as an opinion', () => {
    const auto = A(4, 1)                                    // the rules already want a lift
    expect(auto.has('Lift')).toBe(true)
    const off = toggle('Lift', auto, {})                    // turn it off — that IS an opinion
    expect(off).toEqual({ Lift: false })
    const backOn = toggle('Lift', auto, off)                // turn it back on — it agrees again
    expect(backOn).toEqual({})                              // so nothing is stored
  })

  test('AND THAT IS WHY A STALE OPINION CANNOT FREEZE A SYSTEM ON', () => {
    // On a 4-floor building the rules want a lift. Turn it off, change your mind, turn it back on —
    // you now agree with the rules again, so NOTHING is remembered. Shrink to 2 floors and the lift
    // goes with the height. Had that second tick been stored as an opinion, the 2-floor building
    // would carry a lift nobody ever asked for.
    const auto = A(4, 1)
    const off = toggle('Lift', auto, {})
    const onAgain = toggle('Lift', auto, off)
    expect(onAgain).toEqual({})
    expect(isOn('Lift', A(2, 1), onAgain)).toBe(false)
  })

  test('a real override survives a change of shape', () => {
    const user = toggle('Rooftop solar', A(1, 1), {})       // the rules never want solar
    expect(user).toEqual({ 'Rooftop solar': true })
    expect(isOn('Rooftop solar', A(6, 3), user)).toBe(true) // still on, whatever the building becomes
  })

  test('chosen() reads in the popover order, not insertion order', () => {
    const auto = A(1, 1)
    const list = chosen(auto, { 'Rooftop solar': true })
    expect(list).toEqual(ALL_SYSTEMS.filter((n) => list.includes(n)))
  })
})

suite('the rules explain themselves', () => {
  test('a hint appears only while the RULE owns the pick', () => {
    expect(ruleHints(4, 1, 'none', {})).toEqual(['lift at 4 floors'])
    expect(ruleHints(3, 1, 'stilt', {})).toEqual(['lift at 3 floors over stilt'])
    // once the user has an opinion about the lift, the page stops explaining its own
    expect(ruleHints(4, 1, 'none', { Lift: false })).toEqual([])
  })

  test('every system the popover shows is a system the engine can build', () => {
    // (the id lookup lives in setupPlan.CA_SYSTEMS; here we pin that the groups cover ALL of them)
    expect(Object.values(SYSTEMS).flat().length).toBe(14)
    expect(new Set(ALL_SYSTEMS).size).toBe(14)
  })
})
