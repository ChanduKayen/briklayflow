// Split reconciliation — a payment-proof caption that itemises the ONE payment ("salary 15k + 3650 site
// expenses" on ₹18,650) must collapse to one payment, not file the parts as extra payments (the ₹37,300
// double-count). Genuinely separate payments (that don't sum to one of themselves) stay separate.
import { suite, test, expect } from './harness'
import { reconcileSplitPayment, buildSplitTotal } from '../_split_reconcile.ts'
import type { TxnExtract } from '../_extract.ts'

const mk = (amount: number | null, payee: string | null, note: string | null = null): TxnExtract => ({
  amount, amount_source_phrase: null, amount_confidence: null, payee, project: null,
  direction: 'out', mode: null, note, ref: null,
})

suite('split reconcile — detect a caption breakdown', () => {
  test('the reported case: 15,000 + 3,650 = 18,650 → collapse (total is the 18,650)', () => {
    const e = [mk(18650, 'Alluri Bhaskar Raju'), mk(15000, 'Bhaskar Raju', 'salary'), mk(3650, null, 'site expenses')]
    const r = reconcileSplitPayment(e)
    expect(r).toEqual({ totalIndex: 0, partIndexes: [1, 2] })
  })
  test('order-independent: the total need not be first', () => {
    const e = [mk(15000, 'Bhaskar', 'salary'), mk(3650, null, 'site expenses'), mk(18650, 'Alluri Bhaskar Raju')]
    expect(reconcileSplitPayment(e)).toEqual({ totalIndex: 2, partIndexes: [0, 1] })
  })
  test('genuinely separate payments (no sum matches) → null, stay a batch', () => {
    const e = [mk(10000, 'Ramu'), mk(5000, 'Suresh'), mk(2000, 'Lakshmi')]
    expect(reconcileSplitPayment(e)).toBe(null)
  })
  test('only two entries (a total + one part) → null (not a breakdown)', () => {
    const e = [mk(18650, 'Alluri'), mk(18650, 'Bhaskar')]
    expect(reconcileSplitPayment(e)).toBe(null)
  })
  test('small tolerance: 15,000 + 3,655 ≈ 18,650 within 1% → collapse', () => {
    const e = [mk(18650, 'Alluri'), mk(15000, 'Bhaskar'), mk(3655, null, 'expenses')]
    expect(reconcileSplitPayment(e)).toEqual({ totalIndex: 0, partIndexes: [1, 2] })
  })
  test('outside tolerance: 15,000 + 5,000 vs 18,650 → null', () => {
    const e = [mk(18650, 'Alluri'), mk(15000, 'Bhaskar'), mk(5000, null, 'expenses')]
    expect(reconcileSplitPayment(e)).toBe(null)
  })
  test('a single entry never collapses', () => {
    expect(reconcileSplitPayment([mk(18650, 'Alluri')])).toBe(null)
  })
})

suite('split reconcile — fold parts into the one payment', () => {
  test('keeps the total payee + amount, records the split + a readable note', () => {
    const total = buildSplitTotal(
      mk(18650, 'Alluri Bhaskar Raju'),
      [mk(15000, 'Bhaskar Raju', 'salary'), mk(3650, null, 'site expenses')],
    )
    expect(total.amount).toBe(18650)
    expect(total.payee).toBe('Alluri Bhaskar Raju')
    expect(total.split).toEqual([
      { amount: 15000, purpose: 'salary', payee: 'Bhaskar Raju' },
      { amount: 3650, purpose: 'site expenses', payee: null },
    ])
    expect((total.note ?? '').includes('Split:')).toBe(true)
    expect((total.note ?? '').includes('₹15,000 salary')).toBe(true)
  })
})
