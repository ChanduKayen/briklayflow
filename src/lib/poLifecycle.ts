/**
 * One human-facing lifecycle for a Purchase Order, derived from the three orthogonal
 * concerns the schema actually tracks:
 *   · approval gate   — approval_status: PENDING | APPROVED | REJECTED
 *   · price-readiness — is it priced, or a placeholder (e.g. promoted from a request)?
 *   · fulfillment     — status: ORDERED → BILLED → PARTIAL → PAID (+ CANCELLED)
 *
 * Screens should stop re-deriving "Draft / Awaiting / Live / Needs prices" ad hoc.
 * `poGateState` returns the FRONT-of-lifecycle state (before a PO is a live, priced
 * order) or null — in which case the caller renders its normal fulfillment status.
 */

export type PoGateTone = 'pending' | 'rejected' | 'attention';
export interface PoGate { label: string; tone: PoGateTone }

// The PO's PAYMENT status — the ONLY three states, DERIVED from money actually paid (rolled up from the
// PO's bills) vs what's billed. Never read from the stored `status` column, which drifts (a bill paid via
// bill_id never updated it; createDeliveredBillPO could stamp PAID up front). billed<=0 = no bill yet.
export type PoPayState = 'unpaid' | 'partial' | 'paid';
export function poPayState(paid: number, billed: number): PoPayState {
  const p = Number(paid) || 0, b = Number(billed) || 0;
  if (b <= 0) return 'unpaid';
  if (p >= b - 0.5) return 'paid';
  if (p > 0.5) return 'partial';
  return 'unpaid';
}
export const poPayLabel: Record<PoPayState, string> = { unpaid: 'Unpaid', partial: 'Partially paid', paid: 'Paid' };

/** A priced PO has a real value (header total or any line amount). A request promoted
 *  to a PO lands price-less (rate 0) and must be finished before it's a real order. */
export function poIsPriced(po: { total_value?: unknown; order_value?: unknown; items?: unknown }): boolean {
  if (Number(po?.total_value ?? 0) > 0) return true;
  if (Number(po?.order_value ?? 0) > 0) return true;
  const items = Array.isArray(po?.items) ? (po.items as Array<Record<string, unknown>>) : [];
  return items.some((it) => Number(it?.total_amount ?? it?.amount ?? it?.rate ?? 0) > 0);
}

/** The gate/readiness state, or null when the PO is past the gate and priced (the
 *  caller should then show its fulfillment status). One source of truth for the UI. */
export function poGateState(po: { approval_status?: unknown; total_value?: unknown; order_value?: unknown; items?: unknown }): PoGate | null {
  const a = String(po?.approval_status ?? 'APPROVED').toUpperCase();
  if (a === 'REJECTED') return { label: 'Rejected', tone: 'rejected' };
  const priced = poIsPriced(po);
  // An unpriced PO can't be approved on amount yet — it needs prices first, whether it's
  // a fresh PENDING promotion or (defensively) an APPROVED placeholder.
  if (!priced && (a === 'PENDING' || a === 'APPROVED')) return { label: 'Needs prices', tone: 'attention' };
  if (a === 'PENDING') return { label: 'Awaiting approval', tone: 'pending' };
  return null;
}
