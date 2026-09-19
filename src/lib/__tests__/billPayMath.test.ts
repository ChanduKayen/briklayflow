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

// POURING TICKED PAYMENTS INTO A BILL.
//
// Standing in front of the paper you tick the payments that paid it, and they pour into what it still
// asks for. Two things make that arithmetic worth proving: a payment larger than the remainder must
// give only what is needed — the rest is somebody else's bill, not this one's — and once the bill is
// covered, the payments ticked after it must give nothing at all rather than over-pay it.
//
// The order is the TICK order, not the list order, because that is the order the person chose.

import { allocateAcross } from '../billPayMath'

const ticked = (txnId: string, free: number) => ({
  txnId, date: '2026-09-01', total: free, free, projectId: null, sameProject: false, parts: [],
});

suite('pouring payments into a bill', () => {
  test('nothing ticked pours nothing', () => {
    expect(allocateAcross([], 5000)).toEqual([]);
  });

  test('one payment for exactly the amount', () => {
    expect(allocateAcross([ticked('A', 5000)], 5000).map((x) => x.use)).toEqual([5000]);
  });

  test('two payments that together cover it', () => {
    expect(allocateAcross([ticked('A', 3000), ticked('B', 2000)], 5000).map((x) => x.use)).toEqual([3000, 2000]);
  });

  test('a payment bigger than the remainder gives only what is needed', () => {
    expect(allocateAcross([ticked('A', 50000)], 5000).map((x) => x.use)).toEqual([5000]);
  });

  test('and the rest of it stays free', () => {
    const [a] = allocateAcross([ticked('A', 50000)], 5000);
    expect(a.pay.free - a.use).toBe(45000);
  });

  test('once the bill is covered, the ones after it give nothing', () => {
    expect(allocateAcross([ticked('A', 5000), ticked('B', 9000)], 5000).map((x) => x.use)).toEqual([5000, 0]);
  });

  test('the tick order is what decides, not the size', () => {
    expect(allocateAcross([ticked('B', 9000), ticked('A', 5000)], 5000).map((x) => x.use)).toEqual([5000, 0]);
  });

  test('ticking short of the amount leaves the rest to cover', () => {
    const al = allocateAcross([ticked('A', 1200)], 5000);
    expect(5000 - al.reduce((s, x) => s + x.use, 0)).toBe(3800);
  });

  test('a bill already paid takes nothing more', () => {
    expect(allocateAcross([ticked('A', 5000)], 0).map((x) => x.use)).toEqual([0]);
  });

  test('paise never accumulate into a rupee that is not there', () => {
    const al = allocateAcross([ticked('A', 33.34), ticked('B', 33.34), ticked('C', 33.34)], 100);
    expect(Math.round(al.reduce((s, x) => s + x.use, 0) * 100) / 100).toBe(100);
  });
});

// WHERE THE MONEY LANDS.
//
// A row in the drawer can be a first-class bill or a purchase order's own recorded bill, and they
// settle through different columns: a bill through txn_allocations.bill_id, a PO through
// order_type='PO' + order_ref. BillRow.kind does not tell them apart — both read as 'po', because
// that field is about which reader fetches the detail. The id's prefix is the only discriminator.
//
// Getting it wrong is silent and expensive: the bill's id goes into order_ref, where the bill's paid
// total never sees it, so a paid bill keeps reading Unpaid forever.

import { allocTargetOf } from '../billsApi'

suite('where a linked payment lands', () => {
  test('a first-class bill settles as a bill', () => {
    expect(allocTargetOf({ id: 'bl~9f2c', projectId: 'P1' }).kind).toBe('bill');
  });

  test('a consolidated bill settles as a bill', () => {
    expect(allocTargetOf({ id: 'cb~77a1', projectId: null }).kind).toBe('bill');
  });

  test("a purchase order's own bill settles against the order", () => {
    expect(allocTargetOf({ id: 'po~PO-112', projectId: 'P1' }).kind).toBe('po');
  });

  test('the id is handed on untouched — the writer strips the prefix itself', () => {
    expect(allocTargetOf({ id: 'bl~9f2c', projectId: 'P1' }).id).toBe('bl~9f2c');
  });

  test('and the site travels with it', () => {
    expect(allocTargetOf({ id: 'po~PO-9', projectId: 'P2' }).projectId).toBe('P2');
  });
});
