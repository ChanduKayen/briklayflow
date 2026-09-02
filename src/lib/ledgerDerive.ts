// The Allocation Ledger — derivation layer (Phase 1).
//
// Computes a party's position from the NEW tables only — ledger_credits + ledger_allocations,
// plus the raw payments (transactions) that are the debit side, plus the paid-side corrections
// (opening balance / adjustments) that don't yet have a first-class debit row. Every figure here
// is a query over rows; nothing is a stored flag. This is deliberately INDEPENDENT of the old
// netting in partyLedgerApi.loadPartyLedger — the parity harness diffs the two.
//
// §7 definitions:
//   open_credits          Σ over credits of max(0, amount − allocated-to-it)
//   unallocated_cash      Σ over payments of max(0, amount − allocated-from-it)  + paid corrections
//   to_pay                max(0, open_credits − unallocated_cash)                              §7.1
//   advance               a contract's pool net of settlements (no settlements in Phase 1)     §7.2
//   unclassified_ahead    max(0, unallocated_cash − open_credits)                              §7.3
//   paid_without_bills    Σ payments that are uncredited (zero allocations)                    §7.4
import { supabase } from './supabase';

const num = (v: any) => Number(v) || 0;

export interface DerivedSite { projectId: string | null; projectName: string | null; paid: number; credits: number; net: number }
export interface DerivedParty {
  stakeholderId: string;
  type: string;
  totalPaid: number;        // Σ non-voided payments
  creditsTotal: number;     // Σ ledger_credits.amount
  correctionDebits: number; // paid-ahead opening + paid-side adjustments (no debit row yet)
  openCredits: number;
  unallocatedCash: number;
  toPay: number;
  advance: number;          // Σ contract pools
  unclassifiedAhead: number;
  paidWithoutBills: number;
  net: number;              // totalPaid + correctionDebits − creditsTotal  (≡ old aheadNow)
  perContractAdvance: Record<string, number>;
  perSite: DerivedSite[];
}

export async function deriveParty(stakeholderId: string): Promise<DerivedParty> {
  const [stkR, txnR, credR, obR, adjR] = await Promise.all([
    supabase.from('stakeholders').select('stakeholder_id, type').eq('stakeholder_id', stakeholderId).single(),
    supabase.from('transactions').select('txn_id, total_amount, status, txn_allocations(project_id, allocated_amount, projects(name))').eq('stakeholder_id', stakeholderId),
    supabase.from('ledger_credits').select('credit_id, kind, amount, project_id, contract_ref').eq('stakeholder_id', stakeholderId),
    supabase.from('stakeholder_opening_balances').select('direction, total_amount').eq('stakeholder_id', stakeholderId).maybeSingle(),
    supabase.from('party_adjustments').select('side, amount').eq('stakeholder_id', stakeholderId),
  ]);
  if (stkR.error) throw stkR.error;

  const payments = (txnR.data ?? []).filter((t: any) => t.status !== 'Voided');
  const credits = (credR.data ?? []) as any[];
  const paymentIds = payments.map((p: any) => p.txn_id);

  // Allocations for this party = those whose payment is one of the party's payments.
  let allocs: any[] = [];
  if (paymentIds.length) {
    const { data, error } = await supabase
      .from('ledger_allocations')
      .select('payment_id, target_kind, credit_id, contract_ref, project_id, amount')
      .in('payment_id', paymentIds);
    if (error) throw error;
    allocs = data ?? [];
  }

  const allocByPayment: Record<string, number> = {};
  const allocByCredit: Record<string, number> = {};
  const perContractAdvance: Record<string, number> = {};
  for (const a of allocs) {
    allocByPayment[a.payment_id] = (allocByPayment[a.payment_id] || 0) + num(a.amount);
    if (a.target_kind === 'credit' && a.credit_id) allocByCredit[a.credit_id] = (allocByCredit[a.credit_id] || 0) + num(a.amount);
    if (a.target_kind === 'pool' && a.contract_ref) perContractAdvance[a.contract_ref] = (perContractAdvance[a.contract_ref] || 0) + num(a.amount);
  }

  // Paid-side corrections (no first-class debit row yet — read from source).
  const opening = obR.data as any;
  const correctionDebits =
    (opening?.direction === 'paid_ahead' ? num(opening.total_amount) : 0) +
    (adjR.data ?? []).filter((a: any) => a.side === 'paid').reduce((s: number, a: any) => s + num(a.amount), 0);

  const totalPaid = payments.reduce((s: number, p: any) => s + num(p.total_amount), 0);
  const creditsTotal = credits.reduce((s: number, c: any) => s + num(c.amount), 0);
  const openCredits = credits.reduce((s: number, c: any) => s + Math.max(0, num(c.amount) - (allocByCredit[c.credit_id] || 0)), 0);
  const unallocatedCash =
    payments.reduce((s: number, p: any) => s + Math.max(0, num(p.total_amount) - (allocByPayment[p.txn_id] || 0)), 0) + correctionDebits;
  const advance = Object.values(perContractAdvance).reduce((s, v) => s + v, 0);
  const toPay = Math.max(0, openCredits - unallocatedCash);
  const unclassifiedAhead = Math.max(0, unallocatedCash - openCredits);
  const paidWithoutBills = payments
    .filter((p: any) => !(allocByPayment[p.txn_id] > 0))
    .reduce((s: number, p: any) => s + num(p.total_amount), 0);
  const net = totalPaid + correctionDebits - creditsTotal;

  // Per-site (best-effort): payments by their txn_allocations site, credits by credit.project_id.
  const projName: Record<string, string> = {};
  const site: Record<string, DerivedSite> = {};
  const ensure = (pid: string | null) => {
    const k = pid ?? '∅';
    return (site[k] ||= { projectId: pid, projectName: pid ? (projName[pid] || pid) : 'No site', paid: 0, credits: 0, net: 0 });
  };
  for (const p of payments) {
    const pas = (p.txn_allocations ?? []) as any[];
    pas.forEach(a => { if (a.projects?.name && a.project_id) projName[a.project_id] = a.projects.name; });
    if (pas.length) pas.forEach(a => { ensure(a.project_id).paid += num(a.allocated_amount); });
    else ensure(null).paid += num(p.total_amount);
  }
  for (const c of credits) ensure(c.project_id).credits += num(c.amount);
  Object.values(site).forEach(s => { s.net = s.paid - s.credits; });
  const perSite = Object.values(site).sort((a, b) => b.paid - a.paid);

  return {
    stakeholderId, type: (stkR.data as any).type,
    totalPaid, creditsTotal, correctionDebits,
    openCredits, unallocatedCash, toPay, advance, unclassifiedAhead, paidWithoutBills, net,
    perContractAdvance, perSite,
  };
}
