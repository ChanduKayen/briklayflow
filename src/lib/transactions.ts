/**
 * Transaction business logic shared across the ledger views (Ledger,
 * ProjectTransactions, TransactionDetail). Direction (money in vs out) is NOT a
 * stored column — it is derived here so every surface agrees. See
 * TRANSACTIONS_IMPLEMENTATION_BRIEF.md.
 */

export type TxnDirection = 'in' | 'out';

/**
 * Money in (a client receipt) vs money out (worker/supplier payment, expense).
 *
 * Client receipts are stored correctly — a Client stakeholder, category
 * 'CLIENT-RECEIPT', and ai_flag_data.type 'client_receipt' — but were
 * historically mislabeled "Expense" (and summed as outflow) because the list's
 * getTxnType never checked for them. This is the single source of truth.
 */
export function deriveDirection(txn: any): TxnDirection {
  if (
    txn?.stakeholders?.type === 'Client' ||
    txn?.category === 'CLIENT-RECEIPT' ||
    txn?.ai_flag_data?.type === 'client_receipt'
  ) {
    return 'in';
  }
  return 'out';
}

/**
 * Orphaned money: an outgoing transaction not fully anchored to a WO/PO.
 * Client receipts (money in) legitimately carry no WO/PO and are excluded.
 * An out txn is "not linked" if it has zero allocations, or ANY allocation
 * missing an order_type — partially anchored money is still orphaned money.
 */
export function isNotLinked(txn: any): boolean {
  if (deriveDirection(txn) === 'in') return false;
  const allocs: any[] = txn?.txn_allocations ?? [];
  if (allocs.length === 0) return true;
  return allocs.some((a) => !a?.order_type);
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Defensively pull a stage/phase label out of the remarks prefix, e.g.
 * "[WO-ASME-260521-004 - Full payment] - Pmt" -> "Full payment".
 *
 * Returns a label ONLY when the bracket cleanly wraps the given order_ref;
 * otherwise null. We never echo unparsed remark text into the anchor chip.
 * (Backend followup: promote this to a real stage_label column on
 * txn_allocations so the parse can be retired.)
 */
export function parseStageLabel(
  remarks: string | null | undefined,
  orderRef: string | null | undefined,
): string | null {
  if (!remarks || !orderRef) return null;
  const re = new RegExp('\\[\\s*' + escapeRegExp(orderRef) + '\\s*-\\s*([^\\]]+?)\\s*\\]');
  const m = remarks.match(re);
  const label = m?.[1]?.trim();
  return label ? label : null;
}

export type TxnAnchor =
  | { kind: 'WO' | 'PO' | 'CLIENT'; ref: string; label: string | null }
  | null;

/**
 * The anchor for a row's allocation. WO/PO ref comes from the STRUCTURED
 * allocation (never remark text); the label is parsed defensively. Client
 * receipts anchor to "Client billing" (· Stage N when ai_flag_data carries it).
 * Returns null for an unanchored outgoing allocation — the "link it" ask chip.
 */
export function resolveAnchor(txn: any, alloc: any): TxnAnchor {
  if (deriveDirection(txn) === 'in') {
    const stage = txn?.ai_flag_data?.stage ?? txn?.ai_flag_data?.stage_label ?? null;
    return { kind: 'CLIENT', ref: 'Client billing', label: stage ? String(stage) : null };
  }
  if (alloc?.order_type && alloc?.order_ref) {
    return {
      kind: alloc.order_type === 'PO' ? 'PO' : 'WO',
      ref: String(alloc.order_ref),
      label: parseStageLabel(txn?.remarks, alloc.order_ref),
    };
  }
  return null;
}
