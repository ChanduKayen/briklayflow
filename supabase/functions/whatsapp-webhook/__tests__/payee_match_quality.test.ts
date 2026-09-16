// PAYEE MATCH QUALITY — money attribution is name-strict. People type the FIRST name / a jumble / a romanised
// spelling; the stored name is the full name. The auto floor is 0.95 (near-exact / exact-jumble ONLY): an
// exact or reordered full name auto-links; a first-name-only or romanised near-match is a CONFIRM (it names
// the likely person but asks), so money never silently lands on the wrong same-first-name person.
import { suite, test, expect } from './harness'
import { matchPayee, scorePayeeRich } from '../_match.ts'

suite('payee match — a first name CONFIRMS the full-name contact (never a silent auto-link)', () => {
  test('"ramu" (first name only) → confirm the likely Ramu, not auto', () => {
    const m = matchPayee('ramu', [{ stakeholder_id: 'A', name: 'Ramu Kojjavarapu' }, { stakeholder_id: 'B', name: 'Suresh' }])
    expect(m.band).toBe('confirm')
    expect(m.id).toBe('A')
  })
  test('an exact full name still auto-links', () => {
    expect(matchPayee('ramu kojjavarapu', [{ stakeholder_id: 'A', name: 'Ramu Kojjavarapu' }]).band).toBe('auto')
  })
})

suite('payee match — money never silently links to the wrong twin', () => {
  test('"ramu" with TWO Ramus → NOT auto (a confirm)', () => {
    const m = matchPayee('ramu', [
      { stakeholder_id: 'A', name: 'Ramu Kojjavarapu' },
      { stakeholder_id: 'B', name: 'Ramu Aradadi' },
    ])
    expect(m.band === 'auto').toBe(false)
    expect(m.band).toBe('confirm')
  })
})

suite('payee match — token-bag (jumbled / short↔full) + role', () => {
  test('jumbled order matches: "Aradadi Raju" ≡ "Raju Aradadi"', () => {
    expect(matchPayee('aradadi raju', [{ stakeholder_id: 'A', name: 'Raju Aradadi' }]).band).toBe('auto')
  })
  test('a trade word breaks a same-name tie: "raju supervisor" prefers the supervisor', () => {
    const m = matchPayee('raju supervisor', [
      { stakeholder_id: 'P', name: 'Raju', category: 'Painter' },
      { stakeholder_id: 'S', name: 'Raju', category: 'Supervisor' },
    ])
    expect(m.id).toBe('S')
  })
})

suite('payee match — money safety preserved (romanisation still asks, strangers still empty)', () => {
  test('"sreenu" → Srinu stays a CONFIRM near-match, never auto', () => {
    expect(matchPayee('sreenu', [{ stakeholder_id: 'S1', name: 'Srinu' }]).band).toBe('confirm')
  })
  test('a name nobody has → open, no id', () => {
    const m = matchPayee('zzzz qqqq', [{ stakeholder_id: 'S1', name: 'Srinu' }])
    expect(m.band).toBe('open')
    expect(m.id).toBeNull()
  })
  test('scorePayeeRich: first-name >= 0.9, stranger low', () => {
    expect(scorePayeeRich('ramu', { name: 'Ramu Kojjavarapu' }) >= 0.9).toBe(true)
    expect(scorePayeeRich('lakshmi', { name: 'Srinu' }) < 0.6).toBe(true)
  })
})
