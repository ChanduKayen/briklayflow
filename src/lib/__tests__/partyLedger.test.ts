// THE BILL THAT WASN'T IN THE LEDGER.
//
// Pattabhi Traders, live, 2026-07-17:
//
//     Total Supplied  ₹33,375   "recorded bills"     ← Σ vendor_bill_amount, ungated
//     Total Payouts   ₹1,28,015
//     Net Balance     ₹1,28,015  Advance Dr          ← 0 credits − every payment
//
// One tile says ₹33,375 of bills are recorded. The tile beside it computes as though none are. Both read
// the same column. The difference: the balance goes through the ledger ROWS, and the rows were built by
//
//     if (!po.bill_recorded_at) continue;        // …and then: date: po.bill_recorded_at
//
// which reads like a filter and isn't — the row needed a date, and that was the only date fetched. So both
// of Pattabhi's bills vanished: no ledger rows, no credit side, nothing in the Download Statement PDF, and
// a Net Balance of (0 − payouts) presented as a fact.
//
// bill_recorded_at is NULL on all four of his POs. Two causes, both real: the column landed 2026-05-14 and
// vendor_bill_amount landed 2026-05-12 (so anything billed between, or imported, has an amount and no
// timestamp), and vendorTrackingApi wrote the amount without the timestamp until today. The second is fixed
// at the source. The first cannot be — you cannot back-fill a date nobody recorded. Hence a fallback.

import { suite, test, expect } from './harness'
import { billDateOf, BILL_DATE_COLUMNS } from '../partyLedger'

suite('billDateOf — the amount is the gate, not the timestamp', () => {
  // THE BUG, in one assertion. Both of Pattabhi's bills look like this.
  test('a bill with an amount and NO timestamp still lands, dated by its PO', () => {
    expect(billDateOf({ vendor_bill_amount: 15000, date_issued: '2026-05-13' })).toBe('2026-05-13')
  })

  test('no amount → not a bill → no row (this gate is real)', () => {
    expect(billDateOf({ vendor_bill_amount: 0, date_issued: '2026-05-13' })).toBe(null)
    expect(billDateOf({ date_issued: '2026-05-13' })).toBe(null)
    expect(billDateOf({ vendor_bill_amount: null, bill_recorded_at: '2026-06-01T00:00:00Z' })).toBe(null)
  })

  // A bill with an amount and no date ANYWHERE is the one case we still cannot place in time.
  test('an amount with no date at all is still dropped — there is nowhere to put it', () => {
    expect(billDateOf({ vendor_bill_amount: 15000 })).toBe(null)
  })
})

suite('billDateOf — the truest date available wins', () => {
  // The vendor's own bill date beats when we happened to type it in.
  test('vendor_bill_date leads', () => {
    expect(billDateOf({
      vendor_bill_amount: 18375,
      vendor_bill_date: '2026-06-10',
      bill_recorded_at: '2026-07-01T09:00:00Z',
      date_issued: '2026-05-01',
    })).toBe('2026-06-10')
  })

  test('…then bill_recorded_at', () => {
    expect(billDateOf({
      vendor_bill_amount: 18375,
      bill_recorded_at: '2026-07-01T09:00:00Z',
      date_issued: '2026-05-01',
    })).toBe('2026-07-01T09:00:00Z')
  })

  test('…then the PO date, as a floor', () => {
    expect(billDateOf({ vendor_bill_amount: 18375, date_issued: '2026-05-01' })).toBe('2026-05-01')
  })

  // A string amount is what PostgREST hands back for a numeric column. If this coerced wrong, every bill
  // would silently vanish again — the same failure, one type-cast lower down.
  test('a numeric-as-string amount is still an amount', () => {
    expect(billDateOf({ vendor_bill_amount: '15000', date_issued: '2026-05-13' })).toBe('2026-05-13')
    expect(billDateOf({ vendor_bill_amount: '0', date_issued: '2026-05-13' })).toBe(null)
  })
})

// The rule is only as good as the columns the query fetches: billDateOf silently degrades to the PO date if
// vendor_bill_date was never selected. Naming the column list once is what stops the two ledgers drifting
// apart again — which is exactly how this bug survived in the first place.
suite('BILL_DATE_COLUMNS — the query cannot forget a date', () => {
  test('it names every column billDateOf reads', () => {
    for (const col of ['vendor_bill_amount', 'vendor_bill_date', 'bill_recorded_at', 'date_issued']) {
      expect(BILL_DATE_COLUMNS.includes(col)).toBe(true)
    }
  })
})
