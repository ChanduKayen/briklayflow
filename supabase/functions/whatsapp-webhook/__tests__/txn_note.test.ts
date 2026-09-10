// TXN/BILL NOTE follow-up — a note sent right after a payment/bill attaches to that entry instead of leaking
// to SiteOps ("couldn't tell which work you meant"). The window/affirmation/note rule is pure + tested here;
// the "does it read as a note" judgement is an LLM call (conservative, default fresh) exercised live.
import { suite, test, expect } from './harness'
import { noteVerdict, entrySummary } from '../_txn_note.ts'

suite('txn note — the window/affirmation/note decision', () => {
  test('expired window → fresh (never a trap), even if it reads like a note', () => {
    expect(noteVerdict(false, 'for cement', true)).toBe('fresh')
  })
  test('within window + a real note reading → note (attach)', () => {
    expect(noteVerdict(true, 'for cement work at the slab', true)).toBe('note')
  })
  test('within window + not a note (a new payment/order/question/site-update) → fresh', () => {
    expect(noteVerdict(true, 'paid suresh 3000', false)).toBe('fresh')
  })
  test('a bare "ok"/"done"/Telugu "sari" → noop (nothing to attach, no re-route)', () => {
    expect(noteVerdict(true, 'ok', false)).toBe('noop')
    expect(noteVerdict(true, 'done 👍', false)).toBe('noop')
    expect(noteVerdict(true, 'sari', false)).toBe('noop')
  })
})

suite('txn note — the entry summary handed to the classifier', () => {
  test('a bill entry', () => {
    expect(entrySummary({ kind: 'BILL', vendor_name: 'Eastern Power', bill_total: 19627 }))
      .toBe('a bill from Eastern Power for ₹19,627')
  })
  test('a payment entry', () => {
    expect(entrySummary({ payee_name: 'Ramu', amount: 5000 })).toBe('a payment of ₹5,000 to Ramu')
  })
  test('a sparse entry still summarises safely', () => {
    expect(entrySummary({}).length > 0).toBe(true)
  })
})
