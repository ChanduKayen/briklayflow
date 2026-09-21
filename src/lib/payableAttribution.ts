/**
 * "Towards which payable?" — the single attribution model behind the ledger chip and the Day Book ask.
 *
 * A payment to a party is offered against what that party is owed on this site, and the user chooses —
 * NOTHING is pre-selected, NOTHING is auto-linked. The three shapes:
 *   · Vendor          → their unpaid BILLS (a real allocation, txn_allocations.bill_id) + Other.
 *   · Worker, day-wage → This week's payable · Past ledger balance · Other  (a TAG; the derived
 *                        balance already nets the payment, so this only records intent).
 *   · Worker, contract → the contract's PHASES + Other. Picking a phase settles that stage from the
 *                        payment (attribute_worker_payment: contract-level accepted-work cert, phase
 *                        recorded for display). Muster-tracked contracts can't settle from a payment.
 *
 * Attribution is a convenience, never an accounting gate — "Other"/skip still files; the balance nets.
 */
import type { QueryClient } from '@tanstack/react-query';
import { supabase } from './supabase';
import { loadUnpaidBillsForVendor, saveBillAllocations, type BillPick } from './billsApi';
import { loadWeeklyPayments } from './weeklyPaymentsApi';

export type PayeeType = 'Vendor' | 'Worker' | null | undefined;
export type PayableTag = 'this_week' | 'past' | 'other';

export interface BillTarget {
  id: string; kind: 'bill' | 'po'; billNo: string | null; date: string | null;
  amount: number; remaining: number; projectId: string | null;
  /** a short read of what's ON the bill (its line items), so you attribute against something concrete */
  items: string | null;
  /** the payment predates this bill — offered, but flagged (never hidden, never auto-linked) */
  earlier: boolean;
}
export interface PhaseTarget { milestoneId: string; name: string; value: number; certified: number; remaining: number; spec: string }

export type AttributionTargets =
  | { kind: 'vendor'; bills: BillTarget[] }
  | { kind: 'worker_day'; thisWeek: number; pastBalance: number; owedBefore: number; isAdvance: boolean }
  | { kind: 'worker_contract'; woId: string; woLabel: string; tracked: boolean; wagesMode: boolean; phases: PhaseTarget[]; thisWeek: number; pastBalance: number; owedBefore: number; isAdvance: boolean };

const num = (v: unknown) => Number(v) || 0;

function mondayOf(d: Date): Date {
  const x = new Date(d); const day = (x.getDay() + 6) % 7; // 0 = Monday
  x.setDate(x.getDate() - day); x.setHours(0, 0, 0, 0); return x;
}

/** The worker's engagement on this site. ANY crew with a wo_id is "on a contract" — in either format:
 *  work-done (accrual_basis !== 'day') or wages-set-off (accrual_basis === 'day', wagesMode). Returns
 *  null when there's no contract engagement (pure day-wage). */
async function workerEngagement(stakeholderId: string, projectId: string): Promise<{ woId: string; wagesMode: boolean; stageIds: string[] } | null> {
  const { data } = await supabase.from('labour_crews')
    .select('wo_id, is_contract, accrual_basis, stage_ids')
    .eq('stakeholder_id', stakeholderId).eq('project_id', projectId);
  const rows = (data ?? []) as Array<{ wo_id: string | null; is_contract: boolean | null; accrual_basis: string | null; stage_ids: string[] | null }>;
  const onWo = rows.filter((r) => r.wo_id);
  if (!onWo.length) return null;
  // Prefer a work-done contract if the worker has both; else the wages-mode one.
  const workDone = onWo.find((r) => r.accrual_basis && r.accrual_basis !== 'day');
  const row = workDone ?? onWo[0];
  return { woId: row.wo_id as string, wagesMode: (row.accrual_basis ?? 'day') === 'day', stageIds: Array.isArray(row.stage_ids) ? row.stage_ids : [] };
}

async function loadPhases(woId: string, stageIds: string[] = []): Promise<{ tracked: boolean; phases: PhaseTarget[] }> {
  const [{ data: ms }, tracked] = await Promise.all([
    supabase.from('wo_milestones').select('milestone_id, name, unit_type, planned_amount, quantity, rate, seq_no').eq('wo_id', woId).order('seq_no'),
    (async () => {
      const { data } = await supabase.from('wo_milestones').select('milestone_id').eq('wo_id', woId);
      const ids = (data ?? []).map((m: { milestone_id: string }) => m.milestone_id);
      if (!ids.length) return false;
      const { data: rd } = await supabase.from('labour_attendance').select('id').eq('subject_type', 'stage').in('milestone_id', ids).limit(1);
      return !!(rd && rd.length);
    })(),
  ]);
  // Only the phases THIS crew was put on (labour_crews.stage_ids) — the same ones its attendance sheet
  // shows. An empty stage_ids means the whole contract (no narrowing was chosen).
  const all = (ms ?? []) as Array<{ milestone_id: string; name: string; unit_type: string | null; planned_amount: number; quantity: number; rate: number }>;
  const rows = stageIds.length ? all.filter((m) => stageIds.includes(m.milestone_id)) : all;
  const ids = rows.map((m) => m.milestone_id);
  const certByMs: Record<string, { lump?: number; measured: number }> = {};
  if (ids.length) {
    const { data: certs } = await supabase.from('work_certifications')
      .select('milestone_id, reading_kind, computed_amount, status').in('milestone_id', ids).eq('status', 'approved');
    (certs ?? []).forEach((wc: { milestone_id: string; reading_kind: string; computed_amount: number }) => {
      const e = (certByMs[wc.milestone_id] ||= { measured: 0 });
      if (wc.reading_kind === 'lump') e.lump = num(wc.computed_amount);
      else e.measured += num(wc.computed_amount);
    });
  }
  const inrShort = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN');
  const phases: PhaseTarget[] = rows.map((m) => {
    const isLump = (m.unit_type || 'LS') === 'LS';
    const value = isLump ? num(m.planned_amount) : num(m.quantity) * num(m.rate);
    const c = certByMs[m.milestone_id];
    const certified = isLump ? (c?.lump || 0) : (c?.measured || 0);
    // the quotation line for this stage — what was priced, so the picker shows what it's for.
    const spec = isLump ? `Lump sum · ${inrShort(value)}` : `${num(m.quantity)} ${(m.unit_type || 'unit')} × ${inrShort(num(m.rate))}`;
    return { milestoneId: m.milestone_id, name: m.name, value, certified, remaining: Math.max(0, value - certified), spec };
  });
  return { tracked, phases };
}

async function siteBalance(stakeholderId: string, projectId: string): Promise<{ toPay: number; advance: number }> {
  const { data, error } = await supabase.from('v_party_site_balance')
    .select('to_pay, advance').eq('stakeholder_id', stakeholderId).eq('project_id', projectId).maybeSingle();
  if (error) return { toPay: 0, advance: 0 };
  const r = data as { to_pay?: number; advance?: number } | null;
  return { toPay: num(r?.to_pay), advance: num(r?.advance) };
}

/**
 * Load what to offer for a given payment.
 *
 * `selfPaid` is how much THIS payment already subtracts from the party's balance — its amount when it
 * is already in the ledger and NOT offset by its own certification; 0 in the Day Book (not filed yet)
 * or when a phase-cert already offsets it. We add it back so the wizard shows the due this payment is
 * SETTLING, not the residual after it — otherwise a payment that covers the dues reads as ₹0 owed and
 * looks like an advance. txnDate flags earlier-dated vendor bills.
 */
export async function loadAttributionTargets(
  payee: { id: string; type: PayeeType }, projectId: string, txnDate: string | null, selfPaid = 0,
): Promise<AttributionTargets> {
  if (payee.type === 'Vendor') {
    const bills = await loadUnpaidBillsForVendor(payee.id, projectId);
    return {
      kind: 'vendor',
      bills: bills.map((b) => ({
        id: b.id, kind: b.kind, billNo: b.billNo, date: b.billDate, amount: b.amount,
        remaining: b.remaining, projectId: b.projectId, items: b.items ?? null,
        earlier: !!(txnDate && b.billDate && b.billDate > txnDate),
      })),
    };
  }
  // Worker — anchor on the WEEKLY RUN (exactly what the Payables page shows). The site-balance view
  // can diverge from it and must never zero out a real this-week payable, so it's only a fallback.
  let wkThisWeek = 0, wkBalanceBf = 0, wkFound = false;
  try {
    const wk = await loadWeeklyPayments(mondayOf(new Date()));
    for (const sec of wk.sections) for (const r of sec.rows) {
      if (r.stakeholderId === payee.id && r.projectId === projectId) { wkThisWeek = r.thisWeek; wkBalanceBf = r.balanceBf; wkFound = true; }
    }
  } catch { /* weekly unavailable → fall back to the site balance below */ }

  const eng = await workerEngagement(payee.id, projectId);
  // This payment reduced the CARRIED balance (not this week's gross earned) — add it back so the
  // figures are what was owed BEFORE it.
  let pastBalance = Math.max(0, wkBalanceBf + selfPaid);
  if (!wkFound) {
    const bal = await siteBalance(payee.id, projectId);
    pastBalance = Math.max(0, (bal.toPay - bal.advance) + selfPaid);
  }
  const thisWeek = Math.max(0, wkThisWeek);
  const owedBefore = thisWeek + pastBalance;
  const isAdvance = owedBefore <= 0.5;

  if (eng?.woId) {
    const [{ tracked, phases }, woRow] = await Promise.all([
      loadPhases(eng.woId, eng.stageIds),
      supabase.from('work_orders').select('title, scope_of_work').eq('wo_id', eng.woId).maybeSingle(),
    ]);
    const w = woRow.data as { title?: string; scope_of_work?: string } | null;
    return { kind: 'worker_contract', woId: eng.woId, woLabel: w?.title || w?.scope_of_work || 'Contract', tracked, wagesMode: eng.wagesMode, phases, thisWeek, pastBalance, owedBefore, isAdvance };
  }
  return { kind: 'worker_day', thisWeek, pastBalance, owedBefore, isAdvance };
}

// The one query key both the picker's useQuery and any prefetch share (so a prefetch warms the exact
// cache the card then reads).
export const attrTargetsKey = (payee: { id: string; type: PayeeType }, projectId: string, txnDate: string | null, selfPaid = 0) =>
  ['attr_targets', payee.id, payee.type, projectId, txnDate, selfPaid] as const;

/** Warm the attribution targets for a payment so the card/picker opens instantly. Cheap to call on a
 *  page load or when a card opens; a no-op without a party + site. */
export function prefetchAttrTargets(qc: QueryClient, payee: { id: string; type: PayeeType }, projectId: string, txnDate: string | null, selfPaid = 0): void {
  if (!payee.id || !projectId) return;
  void qc.prefetchQuery({
    queryKey: attrTargetsKey(payee, projectId, txnDate, selfPaid),
    queryFn: () => loadAttributionTargets(payee, projectId, txnDate, selfPaid),
    staleTime: 60_000,
  });
}

// ── writers — each is an EXPLICIT user choice, never automatic ────────────────────────────────────

/** Vendor: point the payment at the chosen bills (real allocation). picks come from the user's ticks. */
export async function attributeToBills(txnId: string, orgId: string, txnTotal: number, picks: BillPick[], projectId: string | null): Promise<void> {
  await saveBillAllocations(txnId, orgId, txnTotal, picks, projectId);
}

/** Worker day-wage: record intent only. The derived balance already nets the payment. */
export async function attributeTag(txnId: string, tag: PayableTag | null): Promise<void> {
  const { data } = await supabase.from('transactions').select('ai_flag_data').eq('txn_id', txnId).maybeSingle();
  const flag = { ...((data as { ai_flag_data?: Record<string, unknown> } | null)?.ai_flag_data ?? {}) };
  if (tag) flag.payable_tag = tag; else delete flag.payable_tag;
  const { error } = await supabase.from('transactions').update({ ai_flag_data: flag }).eq('txn_id', txnId);
  if (error) throw error;
}

/**
 * Worker contract: point the payment at a phase.
 *  · certify=true  (work-done): settle that stage — a contract-level accepted-work cert + phase for display.
 *  · certify=false (wages)    : link the allocation to the WO + phase for DISPLAY only (no cert; the wage
 *                               settlement owns certification, so a cert here would double-count).
 */
export async function attributeToPhase(txnId: string, woId: string, milestoneId: string | null, on: boolean, certify: boolean): Promise<void> {
  const { data, error } = await supabase.rpc('attribute_worker_payment', {
    p_txn_id: txnId, p_wo_id: woId, p_milestone_id: milestoneId ?? '', p_on: on, p_certify: certify,
  });
  const r = data as { success?: boolean; error?: string } | null;
  if (error || !r?.success) throw new Error(r?.error || error?.message || 'Could not attribute the payment');
}

// ── the user's choice, applied to a payment (existing, or one just filed) ──────────────────────────
export type Selection =
  | { type: 'bills'; picks: BillPick[] }
  | { type: 'tag'; tag: PayableTag }
  | { type: 'phase'; woId: string; milestoneId: string | null; certify: boolean }
  | { type: 'other' }
  | { type: 'skip' };

/** Apply a picker Selection to a payment. The Day Book files first, then applies to the new txn;
 *  the ledger applies to the existing one. 'skip' writes nothing; 'other' records the decision as a
 *  tag so the chip stops nudging. Never auto-links — every branch is an explicit user choice. */
export async function applyAttribution(
  txnId: string, orgId: string, amount: number, projectId: string | null, sel: Selection,
): Promise<void> {
  if (sel.type === 'bills') await attributeToBills(txnId, orgId, amount, sel.picks, projectId);
  else if (sel.type === 'tag') await attributeTag(txnId, sel.tag);
  else if (sel.type === 'phase') await attributeToPhase(txnId, sel.woId, sel.milestoneId, true, sel.certify);
  else if (sel.type === 'other') await attributeTag(txnId, 'other');
  // 'skip' → nothing
}

// ── readers — what a payment is attributed to, for every surface that shows it ────────────────────

/** The tag a payment carries, if the owner has said what it settles. */
export function payableTagOf(txn: { ai_flag_data?: unknown } | null | undefined): PayableTag | null {
  const t = (txn?.ai_flag_data as { payable_tag?: string } | null | undefined)?.payable_tag;
  return t === 'this_week' || t === 'past' || t === 'other' ? t : null;
}

/** The tag, in words. Short for a chip; `long` for a line that stands on its own. Written in the
 *  ledger's own voice: what the payment SETTLES, not a generic bucket. */
export function payableTagLabel(tag: PayableTag | null | undefined, long = false): string | null {
  if (tag === 'this_week') return long ? "This week's wages" : 'This week';
  if (tag === 'past') return long ? 'Earlier dues' : 'Earlier dues';
  if (tag === 'other') return long ? 'On account — not against work done' : 'On account';
  return null;
}

// ── reader — the chip's current state ─────────────────────────────────────────────────────────────
export interface CurrentAttribution { linked: boolean; label: string | null }

/** What (if anything) this payment is already attributed to, for the chip's linked-target display. */
export async function loadCurrentAttribution(txnId: string, payeeType: PayeeType): Promise<CurrentAttribution> {
  if (payeeType === 'Vendor') {
    const { data } = await supabase.from('txn_allocations').select('bill_id').eq('txn_id', txnId).not('bill_id', 'is', null);
    const n = (data ?? []).filter((a: { bill_id: string | null }) => a.bill_id).length;
    return n ? { linked: true, label: n === 1 ? 'Bill' : `${n} bills` } : { linked: false, label: null };
  }
  // Worker: a phase attribution (cert) wins; else a day-wage tag.
  const { data: cert } = await supabase.from('work_certifications')
    .select('attributed_milestone_id, phase:wo_milestones!attributed_milestone_id(name)')
    .eq('txn_id', txnId).eq('source', 'payment').maybeSingle();
  if (cert) {
    const name = (cert as { phase?: { name?: string } } | null)?.phase?.name;
    return { linked: true, label: name || 'Contract' };
  }
  const { data: t } = await supabase.from('transactions').select('ai_flag_data').eq('txn_id', txnId).maybeSingle();
  const tag = (t as { ai_flag_data?: { payable_tag?: PayableTag } } | null)?.ai_flag_data?.payable_tag;
  if (tag === 'this_week') return { linked: true, label: 'This week' };
  if (tag === 'past') return { linked: true, label: 'Past balance' };
  if (tag === 'other') return { linked: true, label: 'Other' };
  return { linked: false, label: null };
}
