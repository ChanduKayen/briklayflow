// PAYEE MATCH QUALITY — the fix for "the search almost never finds a name, it says I don't have that payee".
// People type the FIRST name / a jumble / a romanised spelling; the stored name is the full name. The old
// 0.95 auto floor made every non-verbatim match "new". Now a confident, unambiguous person match auto-links,
// a same-name tie is demoted (never a silent wrong-ledger link), and a strong near-match is soft-confirmed.
import { suite, test, expect } from './harness'
import { matchPayee, scorePayeeRich } from '../_match.ts'

suite('payee match — a first name links to the full-name contact', () => {
  test('"ramu" → the only Ramu, auto-linked (not "new")', () => {
    const m = matchPayee('ramu', [{ stakeholder_id: 'A', name: 'Ramu Kojjavarapu' }, { stakeholder_id: 'B', name: 'Suresh' }])
    expect(m.band).toBe('auto')
    expect(m.id).toBe('A')
    expect(m.ambiguous).toBe(false)
  })
  test('an exact full name still auto-links', () => {
    expect(matchPayee('ramu kojjavarapu', [{ stakeholder_id: 'A', name: 'Ramu Kojjavarapu' }]).band).toBe('auto')
  })
})

suite('payee match — ambiguity is guarded (money never silently links to the wrong twin)', () => {
  test('"ramu" with TWO Ramus → NOT auto; demoted + flagged ambiguous', () => {
    const m = matchPayee('ramu', [
      { stakeholder_id: 'A', name: 'Ramu Kojjavarapu' },
      { stakeholder_id: 'B', name: 'Ramu Aradadi' },
    ])
    expect(m.band).toBe('confirm')
    expect(m.ambiguous).toBe(true)
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
