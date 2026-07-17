/**
 * partyLedger — the rules BOTH party ledgers must agree on.
 *
 * There are two of them: the StakeholderDetail page and the StakeholderLedgerDrawer. They build the same
 * rows from the same tables in duplicated code, and they drifted — which is how a vendor's purchases went
 * missing from one balance while the tile beside it, reading the same column, showed them. Anything both
 * must agree on belongs here, not copied twice.
 */

/** The columns a bill row needs to place itself in time. */
export interface BillDated {
  vendor_bill_amount?: number | string | null;
  vendor_bill_date?: string | null;
  bill_recorded_at?: string | null;
  date_issued?: string | null;
}

/**
 * When a recorded bill HAPPENED — or null if this PO carries no bill at all.
 *
 * ══ WHY THIS EXISTS ═══════════════════════════════════════════════════════════════════════════════════
 * Both ledgers opened their vendor-bill loop with:
 *
 *     if (!po.bill_recorded_at) continue;        // …and then: date: po.bill_recorded_at
 *
 * That reads like a filter and isn't. It is there because the row needs a DATE to sort by, and
 * bill_recorded_at was the only date fetched. A bill with an amount and no timestamp wasn't skipped on
 * purpose — it fell through a gap, taking its credit row with it.
 *
 * The cost, live (Pattabhi Traders, 2026-07-17): ₹15,000 and ₹18,375 of bills produced NO ledger rows.
 * The statement showed payments and no purchases, Download Statement exported that same hole, totalCredit
 * summed to 0, and Net Balance rendered as (0 − every payment) — "Advance Dr ₹1,28,014.96" — one tile away
 * from "Total Supplied ₹33,375 · recorded bills", which reads the SAME column ungated. Same screen, same
 * bills, two answers.
 *
 * Two reasons the timestamp is missing, both real:
 *   • bill_recorded_at landed 2026-05-14 (migration 20260514100001); vendor_bill_amount landed 2026-05-12.
 *     Anything billed in that window, or imported, has an amount and no timestamp. Those rows exist and
 *     cannot be back-filled with a date nobody recorded — hence a fallback, not a repair.
 *   • vendorTrackingApi wrote the amount without the timestamp until 2026-07-17. Fixed at the source; this
 *     fallback is for the rows it already made.
 *
 * THE AMOUNT IS THE GATE, because the amount is what makes it a bill. The date is then the best available:
 * the bill's own date first (what the vendor put on it — the truest answer), then when we recorded it, then
 * the PO's issue date as a floor. A bill dated by its PO is slightly wrong in time and exactly right in
 * money. Dropping it is wrong in both, and wrong in the direction that invents a ₹96,640 error.
 */
export function billDateOf(po: BillDated): string | null {
  if (!(Number(po.vendor_bill_amount ?? 0) > 0)) return null;
  return po.vendor_bill_date || po.bill_recorded_at || po.date_issued || null;
}

/** The columns every bill-bearing PO query must select for billDateOf() to do its job. Named once so a
 *  query that forgets `vendor_bill_date` fails loudly here rather than silently dating bills wrong. */
export const BILL_DATE_COLUMNS = 'vendor_bill_amount, vendor_bill_date, bill_recorded_at, date_issued';
