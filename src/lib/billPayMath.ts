/**
 * The two pieces of arithmetic behind paying a bill from the bill.
 *
 * Kept apart from billsApi so they can be tested without a database: which of a vendor's loose
 * payments to put in front of somebody, and — once they pick one — exactly what that payment's
 * allocation set becomes. The second one moves money, so it is worth being able to prove.
 */

export interface LoosePayment {
  txnId: string; date: string | null; total: number; free: number;
  projectId: string | null; sameProject: boolean;
  parts: AllocPart[];
}
export interface AllocPart {
  project_id: string; order_type: string; order_ref: string; milestone_id: string;
  bill_id: string; allocated_amount: number;
}

/**
 * The order a person reads them in.
 *
 * They are looking for the payment they made FOR this bill, and the thing they remember about it is
 * the amount. So the nearest amount comes first. This site's payments sit ahead of ones not yet
 * placed on any site, because a payment already on this site is more likely to be the one; and a
 * remaining tie goes to the more recent, which is the one still in mind.
 */
export function rankLoosePayments<T extends LoosePayment>(rows: T[], target: number): T[] {
  return [...rows].sort((a, b) =>
    (Number(b.sameProject) - Number(a.sameProject))
    || (Math.abs(a.free - target) - Math.abs(b.free - target))
    || (b.date || '').localeCompare(a.date || ''));
}

/**
 * What the payment's allocations become once it is pointed at this bill.
 *
 * set_txn_allocations replaces a payment's WHOLE set, so this hands back everything the payment had
 * already placed — every part naming a bill or an order — untouched, adds the new part for this
 * bill, and lets whatever is left over fall back into the unallocated bucket it came from. Linking
 * can therefore never move money that was already somewhere.
 */
export function linkParts(
  pay: LoosePayment,
  bill: { rawId: string; kind: 'bill' | 'po'; projectId: string | null },
  amount: number,
): AllocPart[] {
  const apply = Math.round(Math.min(Math.max(0, amount), pay.free) * 100) / 100;
  if (apply <= 0.5) throw new Error('Nothing left on that payment to link');
  const keep = pay.parts.filter(p => p.bill_id || p.order_ref);
  const parts: AllocPart[] = [...keep, {
    project_id: bill.projectId ?? '',
    order_type: bill.kind === 'po' ? 'PO' : '',
    order_ref: bill.kind === 'po' ? bill.rawId : '',
    milestone_id: '',
    bill_id: bill.kind === 'po' ? '' : bill.rawId,
    allocated_amount: apply,
  }];
  const placed = parts.reduce((s, p) => s + p.allocated_amount, 0);
  const rest = Math.round((pay.total - placed) * 100) / 100;
  if (rest > 0.5) parts.push({ project_id: pay.projectId ?? '', order_type: '', order_ref: '', milestone_id: '', bill_id: '', allocated_amount: rest });
  return parts;
}
