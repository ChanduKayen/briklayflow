// The financial-document disposer — the PAYMENT / BILL / BOTH decision, and the money-safety
// invariants that must never regress (never assume paid == bill total; ambiguity → the smaller claim).
import { suite, test, expect } from './harness'
import { decideFinancialAction, fuseCaptionPayment, type FinDocRead } from '../_financial_doc.ts'

const base: FinDocRead = {
  document_kind: 'invoice', payment_occurred: null,
  vendor: 'ACME Traders', bill_no: 'A-101', bill_date: '2026-09-01', bill_total: 50000, lines: [],
  paid_amount: null, mode: null, utr: null, project: null, note: null,
}
const read = (p: Partial<FinDocRead>): FinDocRead => ({ ...base, ...p })

suite('financial-doc decision — document type', () => {
  test('a payment proof (UTR, no invoice) → PAYMENT_ONLY (today\'s path)', () => {
    expect(decideFinancialAction(read({ document_kind: 'payment_proof', payment_occurred: true, paid_amount: 50000, bill_total: null }))
      .kind).toBe('PAYMENT_ONLY')
  })
  test('an OTHER image (router misroute) keeps today\'s behaviour → PAYMENT_ONLY', () => {
    expect(decideFinancialAction(read({ document_kind: 'other', payment_occurred: null, bill_total: null }))
      .kind).toBe('PAYMENT_ONLY')
  })
})

suite('financial-doc decision — an invoice, was it paid?', () => {
  test('invoice + payment occurred + amount → BILL_AND_PAYMENT carrying the PAID amount', () => {
    const a = decideFinancialAction(read({ payment_occurred: true, paid_amount: 20000, bill_total: 50000 }))
    expect(a.kind).toBe('BILL_AND_PAYMENT')
    // The payment is the amount PAID, never the bill total — a partial payment stays partial.
    expect(a.kind === 'BILL_AND_PAYMENT' ? a.paidAmount : -1).toBe(20000)
  })
  test('invoice + payment occurred but NO amount → BILL_ASK_PAYMENT (never assume paid == bill total)', () => {
    expect(decideFinancialAction(read({ payment_occurred: true, paid_amount: null, bill_total: 50000 }))
      .kind).toBe('BILL_ASK_PAYMENT')
  })
  test('invoice read as not paid → STILL asks (owner may have paid off-image) → BILL_ASK_PAYMENT', () => {
    // Never silently file a bill-only record — always offer to record a payment too.
    expect(decideFinancialAction(read({ payment_occurred: false })).kind).toBe('BILL_ASK_PAYMENT')
  })
  test('invoice, payment unclear → BILL_ASK_PAYMENT (record the bill, ask about the payment)', () => {
    expect(decideFinancialAction(read({ payment_occurred: null })).kind).toBe('BILL_ASK_PAYMENT')
  })
  test('an invoice stamped PAID with a UTR (document_kind both) + amount → BILL_AND_PAYMENT', () => {
    const a = decideFinancialAction(read({ document_kind: 'both', payment_occurred: true, paid_amount: 50000, utr: 'UTR123' }))
    expect(a.kind).toBe('BILL_AND_PAYMENT')
  })
})

suite('financial-doc — caption fusion (paid amount is in the caption, not the image)', () => {
  test('an invoice + caption "paid 10000" → payment folded in → BILL_AND_PAYMENT ₹10000', () => {
    const fused = fuseCaptionPayment(read({ payment_occurred: null, paid_amount: null }), { amount: 10000, direction: 'out', mode: 'cash' })
    expect(fused.payment_occurred).toBe(true)
    expect(fused.paid_amount).toBe(10000)
    const a = decideFinancialAction(fused)
    expect(a.kind).toBe('BILL_AND_PAYMENT')
    expect(a.kind === 'BILL_AND_PAYMENT' ? a.paidAmount : -1).toBe(10000)
  })
  test('vision already read the payment → caption does NOT override it', () => {
    const fused = fuseCaptionPayment(read({ payment_occurred: true, paid_amount: 20000 }), { amount: 10000, direction: 'out', mode: null })
    expect(fused.paid_amount).toBe(20000)
  })
  test('a received / "to pay" caption is NOT a payment (direction in, or no amount) → unchanged', () => {
    expect(fuseCaptionPayment(read({ payment_occurred: null }), { amount: 10000, direction: 'in', mode: null }).payment_occurred).toBeNull()
    expect(fuseCaptionPayment(read({ payment_occurred: null }), { amount: null, direction: 'out', mode: null }).payment_occurred).toBeNull()
  })
  test('no invoice → caption fusion never invents a bill', () => {
    const fused = fuseCaptionPayment(read({ document_kind: 'payment_proof', payment_occurred: null }), { amount: 10000, direction: 'out', mode: null })
    expect(decideFinancialAction(fused).kind).toBe('PAYMENT_ONLY')
  })
})

suite('financial-doc decision — safety edges', () => {
  test('a zero/garbage paid amount is treated as NO amount → BILL_ASK_PAYMENT, never a ₹0 payment', () => {
    expect(decideFinancialAction(read({ payment_occurred: true, paid_amount: 0 })).kind).toBe('BILL_ASK_PAYMENT')
    expect(decideFinancialAction(read({ payment_occurred: true, paid_amount: -5 })).kind).toBe('BILL_ASK_PAYMENT')
  })
})
