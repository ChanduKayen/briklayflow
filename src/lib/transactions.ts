/**
 * Transaction business logic shared across the ledger views (Ledger,
 * ProjectTransactions, TransactionDetail). Direction (money in vs out) is NOT a
 * stored column — it is derived here so every surface agrees. See
 * TRANSACTIONS_IMPLEMENTATION_BRIEF.md.
 */

import { getCostCode, isCompanyHead } from './costCodes';

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
  // A wallet RETURN / settle (wallet → bank, a transfer out of the wallet) brings cash BACK to the
  // office — it's money IN on the bank ledger, not another payment. Without this it wrongly reads −.
  if (txn?.wallet_dir === 'out' && txn?.is_transfer) return 'in';
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
 * Spend direction — for the Transactions rollups only (what was actually spent). The wallet (site-cash)
 * channel is money MOVING, not spending, until it's used (docs/site-cash-wallet-spec.md):
 *   • a FLOAT (wallet_dir 'in') is a transfer bank→wallet — still the company's money → 'skip'.
 *   • a RETURN (wallet_dir 'out', is_transfer) is a transfer wallet→bank → 'skip'.
 *   • a wallet SPEND (wallet_dir 'out', not a transfer) IS the real expense → 'out'.
 *   • everything else = the normal deriveDirection.
 * So a float never inflates the "out" total (it isn't spent yet); the spend counts once, when it happens.
 * This is ONLY for aggregate totals; a row's own display direction still uses deriveDirection.
 */
export function cashDirection(txn: any): 'in' | 'out' | 'skip' {
  if (txn?.wallet_dir) return (txn.wallet_dir === 'out' && !txn.is_transfer) ? 'out' : 'skip';
  return deriveDirection(txn);
}

/**
 * Orphaned money: an outgoing transaction not fully anchored to a WO/PO.
 * Client receipts (money in) legitimately carry no WO/PO and are excluded.
 * An out txn is "not linked" if it has zero allocations, or ANY allocation
 * missing an order_type — partially anchored money is still orphaned money.
 */
export function isNotLinked(txn: any): boolean {
  if (deriveDirection(txn) === 'in') return false;
  if (txn?.is_one_time) return false; // a deliberate one-time payment is resolved, not orphaned
  // A day-wage payable carries no allocation to point at — the derived balance already nets it, so
  // the owner's answer to "what is this settling?" lives on the transaction as a tag. It is an
  // answer all the same: a payment that has one is not unlinked money waiting to be explained.
  if ((txn?.ai_flag_data as { payable_tag?: string } | null)?.payable_tag) return false;
  const allocs: any[] = txn?.txn_allocations ?? [];
  if (allocs.length === 0) return true;
  // A bill_id allocation IS a link (the payment settles a recorded bill) — not orphaned money.
  return allocs.some((a) => !a?.order_type && !a?.bill_id);
}

/**
 * A general expense is a deliberately party-less transaction — the Day Book
 * "General expense" path files stakeholder_id = NULL under a GEN-xx category.
 * The GEN category distinguishes it from a NULL caused by a deleted stakeholder
 * (ON DELETE SET NULL), which is NOT a general expense.
 */
export function isGeneralExpense(txn: any): boolean {
  return !txn?.stakeholder_id && String(txn?.category ?? '').toUpperCase().startsWith('GEN');
}

/**
 * The specific general-expense head for a txn, by its GEN-xx category — e.g.
 * "Loading & unloading (hamali)" or "Transport & logistics". We surface the KIND
 * of expense rather than the generic bucket. Falls back to "General expense" only
 * when the code is missing/unknown (and treats the GEN-99 catch-all as generic too).
 */
export function generalExpenseLabel(txn: any): string {
  const code = String(txn?.category ?? '').toUpperCase();
  if (!code || code === 'GEN-99') return 'General expense';
  return getCostCode(code)?.item.name ?? 'General expense';
}

/**
 * A general expense filed under a head the FIRM pays — the office rent, the bank's charges, the GST
 * payment, the auditor's fee (COMPANY_GEN_HEADS). It belongs to no job, so it carries no allocation
 * unless somebody deliberately named a site, and it reads as "Company" wherever a site would go.
 */
export function isCompanyOverhead(txn: unknown): boolean {
  const t = txn as { category?: string | null } | null;
  return isGeneralExpense(txn) && isCompanyHead(t?.category);
}

/**
 * The label for the "payee" slot. Linked party -> its name. General expense ->
 * its specific head (e.g. "Loading & unloading (hamali)"). A NULL stakeholder that
 * isn't a general expense -> the party was removed.
 */
export function payeeLabel(txn: any): string {
  // A wallet transfer (float in / return out) names the wallet it moved to/from, never a payee.
  if (txn?.wallet_dir && txn?.is_transfer) return txn?.wallets?.holder_name ? `${txn.wallets.holder_name}'s wallet` : 'Wallet';
  if (txn?.stakeholders?.name) return txn.stakeholders.name;
  if (!txn?.stakeholder_id) return isGeneralExpense(txn) ? generalExpenseLabel(txn) : '(removed contact)';
  return 'Unknown';
}

/** True for a wallet float/return — a transfer, not a spend (excluded from cost, marked in the list). */
export function isWalletTransfer(txn: any): boolean {
  return !!(txn?.wallet_dir && txn?.is_transfer);
}
/** True for a spend funded from a wallet (still a real expense, but drawn from site cash). */
export function isWalletSpend(txn: any): boolean {
  return txn?.wallet_dir === 'out' && !txn?.is_transfer;
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
