// The BILL path — the pure pieces: how the "did you pay this?" reply is read, and the ai_extracted shape a
// staged bill carries. (Importing bill.ts here also bundles its whole module graph under the Node gate.)
import { suite, test, expect } from './harness'
import { parseBillAnswer, billAi } from '../_agents/bill.ts'
import type { FinDocRead } from '../_financial_doc.ts'

const read: FinDocRead = {
  document_kind: 'invoice', payment_occurred: null,
  vendor: 'ACME Traders', bill_no: 'A-101', bill_date: '2026-09-01', bill_total: 50000,
  lines: [{ name: 'Cement', spec: null, unit: 'bags', qty: 50, rate: 400, amount: 20000 }],
  paid_amount: null, mode: null, utr: null, project: null, note: 'Cement supply',
}

suite('bill answer — did you pay this?', () => {
  test('the "Not paid yet" button → no (keeps it a record-only bill)', () => {
    expect(parseBillAnswer('', 'bill_not_paid').kind).toBe('no')
  })
  test('a plain amount → attach that payment', () => {
    const a = parseBillAnswer('20000')
    expect(a.kind).toBe('amount'); expect(a.amount).toBe(20000)
  })
  test('a "20k" amount folds to 20000', () => {
    expect(parseBillAnswer('20k').amount).toBe(20000)
  })
  test('English "no" → not paid', () => { expect(parseBillAnswer('no').kind).toBe('no') })
  test('Telugu "ledu" (not there / no) → not paid', () => { expect(parseBillAnswer('ledu').kind).toBe('no') })
  test('"not paid yet" text → not paid', () => { expect(parseBillAnswer('not paid yet').kind).toBe('no') })
  test('cancel/vaddu → cancel (discard the bill)', () => {
    expect(parseBillAnswer('cancel').kind).toBe('cancel')
    expect(parseBillAnswer('వద్దు').kind).toBe('cancel')
  })
  test('a bare "yes" with no number → unclear (re-ask the amount, never a ₹0 payment)', () => {
    expect(parseBillAnswer('yes').kind).toBe('unclear')
  })
})

suite('bill ai_extracted shape', () => {
  test('BILL_ONLY → kind BILL, no payment, unpaid', () => {
    const ai = billAi(read, { kind: 'BILL_ONLY' })
    expect(ai.kind).toBe('BILL')
    expect(ai.payment).toBeNull()
    expect(ai.payment_status).toBe('unpaid')
    expect(ai.vendor_name).toBe('ACME Traders')
    expect(ai.bill_total).toBe(50000)
  })
  test('BILL_AND_PAYMENT → carries the paid amount, status paid', () => {
    const ai = billAi({ ...read, payment_occurred: true, paid_amount: 20000 }, { kind: 'BILL_AND_PAYMENT', paidAmount: 20000 })
    expect((ai.payment as { amount: number }).amount).toBe(20000)
    expect(ai.payment_status).toBe('paid')
  })
  test('BILL_ASK_PAYMENT → status unknown until the sender answers', () => {
    const ai = billAi(read, { kind: 'BILL_ASK_PAYMENT' })
    expect(ai.payment_status).toBe('unknown')
    expect(ai.payment).toBeNull()
  })
})
