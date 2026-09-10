// Paying a bill from the bill: which loose payment to offer first, and what happens to that
// payment's allocations when somebody takes the offer.
//
// The second half is the one that matters. set_txn_allocations replaces a payment's WHOLE set, so
// a careless link would quietly wipe money the payment had already placed on another bill or an
// order. These say it cannot.
import { suite, test, expect } from './harness'
import { rankLoosePayments, linkParts, type LoosePayment, type AllocPart } from '../billPayMath'

const pay = (o: Partial<LoosePayment> & { txnId: string; free: number }): LoosePayment => ({
  date: '2026-09-01', total: o.free, projectId: 'p1', sameProject: true, parts: [], ...o,
})
const bill = { rawId: 'B-77', kind: 'bill' as const, projectId: 'p1' }
const sum = (parts: AllocPart[]) => parts.reduce((s, p) => s + p.allocated_amount, 0)

suite('which payment is offered first', () => {
  test('the closest amount leads — that is the one being looked for', () => {
    const r = rankLoosePayments([
      pay({ txnId: 'far', free: 50000 }),
      pay({ txnId: 'near', free: 8200 }),
      pay({ txnId: 'mid', free: 12000 }),
    ], 8100)
    expect(r.map(x => x.txnId).join()).toBe('near,mid,far')
  })

  test('a payment on this site comes before one not yet placed, even if further off', () => {
    const r = rankLoosePayments([
      pay({ txnId: 'unplaced-exact', free: 8100, projectId: null, sameProject: false }),
      pay({ txnId: 'thissite-off', free: 15000 }),
    ], 8100)
    expect(r[0].txnId).toBe('thissite-off')
  })

  test('two equally close payments: the more recent first', () => {
    const r = rankLoosePayments([
      pay({ txnId: 'older', free: 8000, date: '2026-08-02' }),
      pay({ txnId: 'newer', free: 8200, date: '2026-09-09' }),
    ], 8100)
    expect(r[0].txnId).toBe('newer')
  })

  test('ranking never mutates what it was handed', () => {
    const rows = [pay({ txnId: 'a', free: 900 }), pay({ txnId: 'b', free: 100 })]
    rankLoosePayments(rows, 100)
    expect(rows[0].txnId).toBe('a')
  })
})

suite('what linking does to a payment’s allocations', () => {
  test('a clean payment, exactly the bill: one part, naming the bill', () => {
    const parts = linkParts(pay({ txnId: 't1', free: 8100 }), bill, 8100)
    expect(parts.length).toBe(1)
    expect(parts[0].bill_id).toBe('B-77')
    expect(parts[0].allocated_amount).toBe(8100)
    expect(sum(parts)).toBe(8100)
  })

  test('a payment bigger than the bill keeps the rest as an advance, not as this bill’s', () => {
    const parts = linkParts(pay({ txnId: 't2', free: 25000, total: 25000 }), bill, 8100)
    expect(parts.length).toBe(2)
    expect(parts[0].allocated_amount).toBe(8100)
    expect(parts[1].bill_id).toBe('')          // the without-bills bucket
    expect(parts[1].allocated_amount).toBe(16900)
    expect(sum(parts)).toBe(25000)
  })

  test('money already placed on another bill is handed back untouched', () => {
    const placed: AllocPart = { project_id: 'p1', order_type: '', order_ref: '', milestone_id: '', bill_id: 'B-11', allocated_amount: 5000 }
    const parts = linkParts(pay({ txnId: 't3', free: 3000, total: 8000, parts: [placed] }), bill, 3000)
    expect(parts.some(p => p.bill_id === 'B-11' && p.allocated_amount === 5000)).toBe(true)
    expect(sum(parts)).toBe(8000)               // the payment's total is preserved exactly
  })

  test('an order allocation survives a link just as a bill one does', () => {
    const onPo: AllocPart = { project_id: 'p1', order_type: 'PO', order_ref: 'PO-9', milestone_id: '', bill_id: '', allocated_amount: 4000 }
    const parts = linkParts(pay({ txnId: 't4', free: 2000, total: 6000, parts: [onPo] }), bill, 2000)
    expect(parts.some(p => p.order_ref === 'PO-9')).toBe(true)
    expect(sum(parts)).toBe(6000)
  })

  test('an existing unallocated part is NOT carried over — it is what the link is spending', () => {
    const loose: AllocPart = { project_id: 'p1', order_type: '', order_ref: '', milestone_id: '', bill_id: '', allocated_amount: 8000 }
    const parts = linkParts(pay({ txnId: 't5', free: 8000, total: 8000, parts: [loose] }), bill, 8000)
    expect(parts.length).toBe(1)
    expect(parts[0].bill_id).toBe('B-77')
    expect(sum(parts)).toBe(8000)
  })

  test('asking for more than is loose applies only what is loose', () => {
    const parts = linkParts(pay({ txnId: 't6', free: 3000, total: 3000 }), bill, 99999)
    expect(parts[0].allocated_amount).toBe(3000)
    expect(sum(parts)).toBe(3000)
  })

  test('a PO-backed bill is allocated as an order, not as a bill', () => {
    const parts = linkParts(pay({ txnId: 't7', free: 5000 }), { rawId: 'PO-42', kind: 'po', projectId: 'p1' }, 5000)
    expect(parts[0].order_type).toBe('PO')
    expect(parts[0].order_ref).toBe('PO-42')
    expect(parts[0].bill_id).toBe('')
  })

  test('a payment with nothing loose refuses rather than writing an empty allocation', () => {
    let msg = ''
    try { linkParts(pay({ txnId: 't8', free: 0, total: 9000 }), bill, 5000) } catch (e) { msg = (e as Error).message }
    expect(msg).toBe('Nothing left on that payment to link')
  })

  test('rounding: the parts still add up to the payment, to the paisa', () => {
    const parts = linkParts(pay({ txnId: 't9', free: 10000.5, total: 10000.5 }), bill, 3333.33)
    expect(Math.round(sum(parts) * 100) / 100).toBe(10000.5)
  })
})
