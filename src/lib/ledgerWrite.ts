// The Allocation Ledger — write engine (infrastructure).
//
// The primitives every feature calls. Nothing here decides WHEN to cut off, WHETHER to backfill, or
// which bills to enter — those are levers the operator pulls through the feature flows built on top.
// This file is just the verbs: mint a credit, allocate a payment, settle FIFO, void with cascade.
//
// The INV-2 / INV-3 amount ceilings are enforced by the DB trigger (fn_ledger_alloc_guard), so an
// over-allocation here throws from Postgres rather than passing silently.
import { supabase } from './supabase';

export type CreditKind = 'vendor_bill' | 'consolidated' | 'plan' | 'certified' | 'self_settle' | 'opening' | 'adjustment';
export type LedgerSource = 'manual' | 'plan' | 'attendance' | 'import' | 'whatsapp' | 'backfill' | 'cutover';

const num = (v: any) => Number(v) || 0;

async function orgOfStakeholder(stakeholderId: string): Promise<string> {
  const { data, error } = await supabase.from('stakeholders').select('org_id').eq('stakeholder_id', stakeholderId).single();
  if (error) throw error;
  return (data as any).org_id;
}
async function paymentContext(paymentId: string): Promise<{ orgId: string; stakeholderId: string; total: number }> {
  const { data, error } = await supabase.from('transactions').select('org_id, stakeholder_id, total_amount').eq('txn_id', paymentId).single();
  if (error) throw error;
  const t = data as any;
  return { orgId: t.org_id, stakeholderId: t.stakeholder_id, total: num(t.total_amount) };
}

// ── mint a credit (any §2 event) ───────────────────────────────────────────
export interface CreateCreditInput {
  stakeholderId: string;
  kind: CreditKind;
  amount: number;
  entryDate: string;                 // YYYY-MM-DD
  projectId?: string | null;
  source?: LedgerSource;
  contractRef?: string | null;       // wo_id / po_id
  milestoneId?: string | null;
  parentPaymentId?: string | null;   // §2.5 self-settle child (INV-6: dies with its payment)
  docFlag?: 'vendor' | 'kacha' | 'none' | null;
  note?: string | null;
  confirmed?: boolean;
}
export async function createCredit(input: CreateCreditInput): Promise<string> {
  const org_id = await orgOfStakeholder(input.stakeholderId);
  const { data, error } = await supabase.from('ledger_credits').insert({
    org_id, stakeholder_id: input.stakeholderId, project_id: input.projectId ?? null,
    kind: input.kind, amount: input.amount, entry_date: input.entryDate,
    source: input.source ?? 'manual', contract_ref: input.contractRef ?? null, milestone_id: input.milestoneId ?? null,
    parent_payment_id: input.parentPaymentId ?? null, doc_flag: input.docFlag ?? null,
    note: input.note ?? null, confirmed: input.confirmed ?? false,
  }).select('credit_id').single();
  if (error) throw error;
  return (data as any).credit_id;
}

// ── allocate a payment (debit) to a credit, or to a contract advance pool ────
export async function allocateToCredit(paymentId: string, creditId: string, amount: number, opts?: { projectId?: string | null; source?: LedgerSource; orgId?: string }): Promise<string> {
  const orgId = opts?.orgId ?? (await paymentContext(paymentId)).orgId;
  const { data, error } = await supabase.from('ledger_allocations').insert({
    org_id: orgId, payment_id: paymentId, target_kind: 'credit', credit_id: creditId,
    project_id: opts?.projectId ?? null, amount, source: opts?.source ?? 'manual',
  }).select('allocation_id').single();
  if (error) throw error;   // INV-2 / INV-3 may raise here
  return (data as any).allocation_id;
}
export async function allocateToPool(paymentId: string, contractRef: string, amount: number, opts?: { projectId?: string | null; source?: LedgerSource; orgId?: string }): Promise<string> {
  const orgId = opts?.orgId ?? (await paymentContext(paymentId)).orgId;
  const { data, error } = await supabase.from('ledger_allocations').insert({
    org_id: orgId, payment_id: paymentId, target_kind: 'pool', contract_ref: contractRef,
    project_id: opts?.projectId ?? null, amount, source: opts?.source ?? 'manual',
  }).select('allocation_id').single();
  if (error) throw error;
  return (data as any).allocation_id;
}

// ── the party's still-open credits (amount − already allocated), oldest first ─
export interface OpenCredit { creditId: string; kind: CreditKind; amount: number; open: number; entryDate: string; projectId: string | null; contractRef: string | null }
export async function openCreditsFor(stakeholderId: string): Promise<OpenCredit[]> {
  const { data: creds, error } = await supabase.from('ledger_credits')
    .select('credit_id, kind, amount, entry_date, project_id, contract_ref').eq('stakeholder_id', stakeholderId).order('entry_date');
  if (error) throw error;
  const ids = (creds ?? []).map((c: any) => c.credit_id);
  const allocByCredit: Record<string, number> = {};
  if (ids.length) {
    const { data: al } = await supabase.from('ledger_allocations').select('credit_id, amount').in('credit_id', ids);
    (al ?? []).forEach((a: any) => { if (a.credit_id) allocByCredit[a.credit_id] = (allocByCredit[a.credit_id] || 0) + num(a.amount); });
  }
  return (creds ?? []).map((c: any) => ({
    creditId: c.credit_id, kind: c.kind, amount: num(c.amount), open: Math.max(0, num(c.amount) - (allocByCredit[c.credit_id] || 0)),
    entryDate: c.entry_date, projectId: c.project_id, contractRef: c.contract_ref,
  })).filter(c => c.open > 0.005);
}

// ── settle a payment's unallocated remainder across open credits, oldest first ─
// FIFO-by-default (§1.5): the honest fallback when the operator hasn't pointed the money by hand.
export async function settleFIFO(paymentId: string): Promise<{ allocated: number; touched: number }> {
  const ctx = await paymentContext(paymentId);
  const { data: mine } = await supabase.from('ledger_allocations').select('amount').eq('payment_id', paymentId);
  const alreadyAllocated = (mine ?? []).reduce((s: number, a: any) => s + num(a.amount), 0);
  let remainder = ctx.total - alreadyAllocated;
  if (remainder <= 0.005) return { allocated: 0, touched: 0 };
  const open = await openCreditsFor(ctx.stakeholderId);
  let touched = 0, allocated = 0;
  for (const c of open) {
    if (remainder <= 0.005) break;
    const amt = Math.min(remainder, c.open);
    if (amt <= 0.005) continue;
    await allocateToCredit(paymentId, c.creditId, amt, { projectId: c.projectId, orgId: ctx.orgId, source: 'manual' });
    remainder -= amt; allocated += amt; touched++;
  }
  return { allocated, touched };
}

// ── fill a credit from the party's oldest unallocated payments (bill → settle) ─
// After recording a bill, point the earlier "paid without a bill" money at it, oldest first, up to
// the bill amount. Anything beyond the bill stays as advance/ahead — honestly unallocated.
export async function fillCredit(creditId: string): Promise<{ allocated: number; touched: number }> {
  const { data: c, error } = await supabase.from('ledger_credits').select('stakeholder_id, amount, project_id, org_id').eq('credit_id', creditId).single();
  if (error) throw error;
  const cr = c as any;
  const { data: existing } = await supabase.from('ledger_allocations').select('amount').eq('credit_id', creditId);
  let remaining = num(cr.amount) - (existing ?? []).reduce((s: number, a: any) => s + num(a.amount), 0);
  if (remaining <= 0.005) return { allocated: 0, touched: 0 };

  const { data: pays } = await supabase.from('transactions').select('txn_id, total_amount, status').eq('stakeholder_id', cr.stakeholder_id).order('date', { ascending: true });
  const active = (pays ?? []).filter((p: any) => p.status !== 'Voided');
  const ids = active.map((p: any) => p.txn_id);
  const allocByPayment: Record<string, number> = {};
  if (ids.length) { const { data: al } = await supabase.from('ledger_allocations').select('payment_id, amount').in('payment_id', ids); (al ?? []).forEach((a: any) => { allocByPayment[a.payment_id] = (allocByPayment[a.payment_id] || 0) + num(a.amount); }); }

  let allocated = 0, touched = 0;
  for (const p of active) {
    if (remaining <= 0.005) break;
    const free = num(p.total_amount) - (allocByPayment[p.txn_id] || 0);
    if (free <= 0.005) continue;
    const amt = Math.min(free, remaining);
    await allocateToCredit(p.txn_id, creditId, amt, { projectId: cr.project_id, orgId: cr.org_id, source: 'manual' });
    remaining -= amt; allocated += amt; touched++;
  }
  return { allocated, touched };
}

// ── remove a payment's allocations (bank-imported undo, §04a) ────────────────
export async function reverseAllocations(paymentId: string): Promise<void> {
  const { error } = await supabase.from('ledger_allocations').delete().eq('payment_id', paymentId);
  if (error) throw error;
}

// ── void a payment (the ONE void, §02·E) ────────────────────────────────────
// Marks the transaction Voided (kept, hidden by default, provenance retained), deletes its
// allocations, and voids any credit it minted (§2.5 self-settle child — deleting the child credit
// cascades that credit's own allocations via FK). The §04(b) barriers (covered by a consolidated
// bill / absorbed by a certification / inside a settled period) are a feature-level guard layered
// on top — this primitive is the mechanical void the guarded flow calls once it has decided.
export async function voidPayment(paymentId: string): Promise<void> {
  await supabase.from('ledger_allocations').delete().eq('payment_id', paymentId);
  await supabase.from('ledger_credits').delete().eq('parent_payment_id', paymentId); // self-settle children
  const { error } = await supabase.from('transactions').update({ status: 'Voided' }).eq('txn_id', paymentId);
  if (error) throw error;
}

// ── certify a contract stage (§2.4 / §6.2) ──────────────────────────────────
// Mints a `certified` credit for the certified value, then settles the contract's advance pool
// against it OLDEST FIRST — moving each advance from the pool to this credit. Shortfall of advances
// → the credit's remainder is to-pay; excess advances stay in the pool toward the next stage.
export interface CertifyResult { creditId: string; settled: number; open: number; poolLeft: number }
export async function certifyStage(input: { stakeholderId: string; contractRef: string; amount: number; entryDate: string; projectId?: string | null; milestoneId?: string | null; note?: string | null }): Promise<CertifyResult> {
  const org = await orgOfStakeholder(input.stakeholderId);
  const creditId = await createCredit({
    stakeholderId: input.stakeholderId, kind: 'certified', amount: input.amount, entryDate: input.entryDate,
    projectId: input.projectId ?? null, contractRef: input.contractRef, milestoneId: input.milestoneId ?? null,
    note: input.note ?? null, source: 'attendance',
  });

  // pool allocations for this contract, oldest payment first
  const { data: pools, error } = await supabase.from('ledger_allocations')
    .select('allocation_id, payment_id, amount, project_id, transactions(date)')
    .eq('target_kind', 'pool').eq('contract_ref', input.contractRef);
  if (error) throw error;
  const sorted = (pools ?? []).sort((a: any, b: any) => ((a.transactions?.date || '') as string).localeCompare(b.transactions?.date || ''));

  let remaining = input.amount, settled = 0;
  for (const p of sorted) {
    if (remaining <= 0.005) break;
    const move = Math.min(num(p.amount), remaining);
    if (move <= 0.005) continue;
    // reduce the pool allocation FIRST (so INV-2 never sees the payment over-allocated), then bind to the credit
    if (move >= num(p.amount) - 0.005) await supabase.from('ledger_allocations').delete().eq('allocation_id', p.allocation_id);
    else await supabase.from('ledger_allocations').update({ amount: num(p.amount) - move }).eq('allocation_id', p.allocation_id);
    await allocateToCredit(p.payment_id, creditId, move, { projectId: p.project_id, orgId: org, source: 'attendance' });
    remaining -= move; settled += move;
  }

  const { data: after } = await supabase.from('ledger_allocations').select('amount').eq('target_kind', 'pool').eq('contract_ref', input.contractRef);
  const poolLeft = (after ?? []).reduce((s: number, a: any) => s + num(a.amount), 0);
  return { creditId, settled, open: Math.max(0, input.amount - settled), poolLeft };
}

// ── self-settling payment (§2.5): mint a matching credit AND allocate to it ──
// "against work done / goods received, no bill". The credit is a child of the payment (INV-6).
export async function selfSettle(paymentId: string, opts?: { projectId?: string | null; contractRef?: string | null; docFlag?: 'vendor' | 'kacha' | 'none'; note?: string; entryDate?: string }): Promise<{ creditId: string }> {
  const ctx = await paymentContext(paymentId);
  const { data: t } = await supabase.from('transactions').select('date').eq('txn_id', paymentId).single();
  const creditId = await createCredit({
    stakeholderId: ctx.stakeholderId, kind: 'self_settle', amount: ctx.total,
    entryDate: opts?.entryDate ?? (t as any)?.date ?? new Date().toISOString().slice(0, 10),
    projectId: opts?.projectId ?? null, contractRef: opts?.contractRef ?? null,
    parentPaymentId: paymentId, docFlag: opts?.docFlag ?? 'none', note: opts?.note ?? null, source: 'manual',
  });
  await allocateToCredit(paymentId, creditId, ctx.total, { projectId: opts?.projectId ?? null, orgId: ctx.orgId });
  return { creditId };
}
