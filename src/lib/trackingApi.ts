/**
 * trackingApi — the single seam between the "Track this transaction" hub and the
 * backend. Everything the hub reads or writes goes through here, so a path can be
 * re-pointed (or un-stubbed) in one place.
 *
 * Wiring status (per product decision):
 *  · getTrackingOptions / attachToContract / createContract → REAL (work_orders + txn_allocations)
 *  · markDailyWage → MOCK. The NMR / muster / attendance backend isn't built yet;
 *    this returns the computed shape with NO DB write. Swap the body for the real
 *    muster RPC once it lands — callers don't change.
 *  · fileAsLabour → no-op acknowledgement. A one-off has no tracking object and the
 *    payment already sits in the project's cost breakdown via its allocation. There
 *    is no "intentionally untracked" flag in the schema yet, so nothing is written.
 *
 * A "contract" in this hub is a Work Order (work_orders). Its balance is COMPUTED
 * (order_value − allocations linked to it), never stored.
 */
import { supabase } from './supabase';

/** The slice of a ledger transaction the hub needs (the row is otherwise untyped). */
export interface TrackTxn {
  txn_id?: string;
  total_amount?: number | string | null;
  remarks?: string | null;
  stakeholder_id?: string | null;
  stakeholders?: { name?: string | null; category?: string | null } | null;
  txn_allocations?: Array<{
    allocation_id?: string | null;
    project_id?: string | null;
    projects?: { name?: string | null } | null;
  }> | null;
}

export interface ContractPhase {
  milestoneId: string;
  name: string;
  /** planned_amount */
  planned: number;
  /** amount already paid against this phase */
  paid: number;
  /** max(0, planned − paid) */
  left: number;
  seqNo: number;
}

export interface OpenContract {
  woId: string;
  /** scope_of_work — the contract's name */
  name: string;
  /** order_value — the agreed contract total */
  total: number;
  /** total − amount already paid against it */
  balance: number;
  /** round(paid / total × 100) */
  paidPct: number;
  /** milestones, seq-ordered. One phase → auto-allocate; many → phase picker. */
  phases: ContractPhase[];
}

export interface TrackingOptions {
  payee: string;
  projectId: string | null;
  projectName: string | null;
  amount: number;
  /** the transaction's note (remarks) — seeds the new-contract placeholder */
  note: string | null;
  /** the worker's trade (stakeholders.category) — seeds a trade-based placeholder */
  suggestedTrade: string | null;
  openContracts: OpenContract[];
}

interface WoRow { wo_id: string; scope_of_work: string | null; order_value: number | null; status: string | null }
interface MsRow { wo_id: string; milestone_id: string; name: string | null; seq_no: number | null; planned_amount: number | null }
interface MsCreatedRow { milestone_id: string; name: string | null; seq_no: number | null; planned_amount: number | null }
interface PaidRow { order_ref: string; milestone_id: string | null; allocated_amount: number | null }

const num = (n: unknown) => Number(n) || 0;
const projectIdOf = (txn: TrackTxn): string | null => txn.txn_allocations?.[0]?.project_id ?? null;
const allocIdOf = (txn: TrackTxn): string | null => txn.txn_allocations?.[0]?.allocation_id ?? null;

const NO_ALLOC = "This payment isn't on a project yet — open it to set one, then track it.";

/** Read everything the hub needs for a transaction: the party, the project, the
 *  amount, and the payee's open contracts (with their burn-down already computed). */
export async function getTrackingOptions(txn: TrackTxn): Promise<TrackingOptions> {
  const projectId = projectIdOf(txn);
  const projectName = txn.txn_allocations?.[0]?.projects?.name ?? null;
  const stakeholderId = txn.stakeholder_id ?? null;
  const payee = txn.stakeholders?.name || 'this payee';
  const amount = num(txn.total_amount);
  const note = (txn.remarks || '').trim() || null;
  const suggestedTrade = txn.stakeholders?.category || null;

  let openContracts: OpenContract[] = [];
  if (projectId && stakeholderId) {
    const { data: wos, error } = await supabase
      .from('work_orders')
      .select('wo_id, scope_of_work, order_value, status')
      .eq('project_id', projectId)
      .eq('stakeholder_id', stakeholderId)
      .not('status', 'in', '("Closed","Cancelled")')
      .order('date_issued', { ascending: false });
    if (error) throw error;

    const rows = (wos ?? []) as WoRow[];
    const ids = rows.map((w) => w.wo_id);
    // Milestones (for the phase picker / single-phase auto-allocate) are read separately
    // so a failed embed can't null the whole query and hide every contract.
    const { data: ms } = ids.length
      ? await supabase.from('wo_milestones').select('wo_id, milestone_id, name, seq_no, planned_amount').in('wo_id', ids)
      : { data: [] as MsRow[] };
    const { data: paid } = ids.length
      ? await supabase.from('txn_allocations').select('order_ref, milestone_id, allocated_amount').eq('order_type', 'WO').in('order_ref', ids)
      : { data: [] as PaidRow[] };

    const paidByWo: Record<string, number> = {};
    const paidByMs: Record<string, number> = {};
    ((paid ?? []) as PaidRow[]).forEach((p) => {
      paidByWo[p.order_ref] = (paidByWo[p.order_ref] || 0) + num(p.allocated_amount);
      if (p.milestone_id) paidByMs[p.milestone_id] = (paidByMs[p.milestone_id] || 0) + num(p.allocated_amount);
    });
    const msByWo: Record<string, MsRow[]> = {};
    ((ms ?? []) as MsRow[]).forEach((m) => { (msByWo[m.wo_id] ||= []).push(m); });

    openContracts = rows.map((w) => {
      const total = num(w.order_value);
      const used = paidByWo[w.wo_id] || 0;
      const phases: ContractPhase[] = (msByWo[w.wo_id] ?? [])
        .slice()
        .sort((a, b) => (a.seq_no || 0) - (b.seq_no || 0))
        .map((m) => {
          const planned = num(m.planned_amount);
          const mp = paidByMs[m.milestone_id] || 0;
          return { milestoneId: m.milestone_id, name: m.name || `Phase ${m.seq_no ?? ''}`.trim(), planned, paid: mp, left: Math.max(0, planned - mp), seqNo: m.seq_no || 0 };
        });
      return {
        woId: w.wo_id,
        name: w.scope_of_work || w.wo_id,
        total,
        balance: Math.max(0, total - used),
        paidPct: total > 0 ? Math.round((used / total) * 100) : 0,
        phases,
      };
    });
  }

  return { payee, projectId, projectName, amount, note, suggestedTrade, openContracts };
}

/** Attach the whole transaction to an existing contract, optionally to a specific
 *  phase (milestone). Burn-down is reported at the CONTRACT level so the confirmation
 *  animates the contract balance regardless of which phase the money landed in. */
export async function attachToContract(txn: TrackTxn, contract: OpenContract, milestoneId: string | null = null): Promise<{ balance: number; paidPct: number }> {
  const allocId = allocIdOf(txn);
  if (!allocId) throw new Error(NO_ALLOC);
  const { error } = await supabase
    .from('txn_allocations')
    .update({ order_type: 'WO', order_ref: contract.woId, milestone_id: milestoneId })
    .eq('allocation_id', allocId);
  if (error) throw error;

  const amount = num(txn.total_amount);
  const newBalance = Math.max(0, contract.balance - amount);
  const used = contract.total - newBalance;
  return {
    balance: newBalance,
    paidPct: contract.total > 0 ? Math.min(100, Math.round((used / contract.total) * 100)) : 0,
  };
}

export interface NewPhase { name: string; amount: number }

export interface CreateContractInput {
  orgId: string;
  txn: TrackTxn;
  value: number;
  description: string;
  /** Optional split. Empty/omitted → one "Full Payment" milestone of the full value. */
  phases?: NewPhase[];
}

export interface CreatedContract {
  woId: string;
  total: number;
  balance: number;
  /** true → the payment was already linked (single phase). false → caller must pick a
   *  phase from `phases` and call attachToContract to place it. */
  attached: boolean;
  /** the freshly created phases (only meaningful when attached === false). */
  phases: ContractPhase[];
}

/** Create a new contract (a Draft Work Order, instant — no approval gate). One phase
 *  (or no split) → the payment is linked to that phase here and attached === true.
 *  Multiple phases → nothing is linked yet; the caller shows a phase picker over the
 *  returned phases (just like an existing multi-phase contract) and attaches the choice. */
export async function createContract({ orgId, txn, value, description, phases }: CreateContractInput): Promise<CreatedContract> {
  const projectId = projectIdOf(txn);
  const stakeholderId = txn.stakeholder_id ?? null;
  if (!projectId || !stakeholderId) throw new Error(NO_ALLOC);

  const usePhases = !!phases && phases.length > 0;
  const milestones = usePhases
    ? phases!.map((p, i) => ({ seq_no: i + 1, name: p.name.trim() || `Phase ${i + 1}`, unit_type: 'LS', quantity: 1, rate: null, planned_amount: p.amount, ai_extracted: false }))
    : [{ seq_no: 1, name: 'Full Payment', unit_type: 'LS', quantity: 1, rate: null, planned_amount: value, ai_extracted: false }];

  const dateIssued = new Date().toISOString().split('T')[0];
  const { data, error } = await supabase.rpc('create_work_order', {
    p_org_id: orgId,
    p_project_id: projectId,
    p_stakeholder_id: stakeholderId,
    p_scope: description,
    p_order_value: value,
    p_date_issued: dateIssued,
    p_source: 'manual',
    p_milestones: milestones,
  });
  if (error) throw error;
  const result = data as { success?: boolean; error?: string; wo_id?: string } | null;
  if (!result?.success || !result.wo_id) throw new Error(result?.error ?? 'Failed to create contract');

  const woId = result.wo_id;
  const allocId = allocIdOf(txn);
  const amount = num(txn.total_amount);

  // The RPC returns only wo_id, so read the created milestones back (for the id to link
  // to, or for the phase picker).
  const { data: msNew } = await supabase
    .from('wo_milestones').select('milestone_id, name, seq_no, planned_amount').eq('wo_id', woId)
    .order('seq_no', { ascending: true });
  const created = (msNew ?? []) as MsCreatedRow[];

  // Multiple phases → leave the payment unplaced; the caller asks which phase.
  if (created.length > 1) {
    const builtPhases: ContractPhase[] = created.map((m) => {
      const planned = num(m.planned_amount);
      return { milestoneId: m.milestone_id, name: m.name || `Phase ${m.seq_no ?? ''}`.trim(), planned, paid: 0, left: planned, seqNo: m.seq_no || 0 };
    });
    return { woId, total: value, balance: value, attached: false, phases: builtPhases };
  }

  // Single phase → link the payment to it so the phase reads as paid.
  const milestoneId = created[0]?.milestone_id ?? null;
  if (allocId) {
    const { error: e2 } = await supabase
      .from('txn_allocations')
      .update({ order_type: 'WO', order_ref: woId, milestone_id: milestoneId })
      .eq('allocation_id', allocId);
    if (e2) throw e2;
  }
  return { woId, total: value, balance: Math.max(0, value - amount), attached: true, phases: [] };
}

/** Split the whole transaction across several phases of one contract: update the
 *  existing allocation to the first part, insert a row for each remaining part. The
 *  parts must sum to the payment so the project allocation total is preserved (the
 *  caller enforces this). RLS lets the client insert with its own org_id. */
export async function splitAcrossPhases(txn: TrackTxn, woId: string, parts: Array<{ milestoneId: string; amount: number }>, orgId: string): Promise<void> {
  const allocId = allocIdOf(txn);
  const projectId = projectIdOf(txn);
  const txnId = txn.txn_id;
  if (!allocId || !projectId || !txnId) throw new Error(NO_ALLOC);
  const valid = parts.filter((p) => p.amount > 0);
  if (valid.length === 0) throw new Error('Enter at least one phase amount.');

  const [first, ...rest] = valid;
  const { error } = await supabase
    .from('txn_allocations')
    .update({ order_type: 'WO', order_ref: woId, milestone_id: first.milestoneId, allocated_amount: first.amount })
    .eq('allocation_id', allocId);
  if (error) throw error;

  if (rest.length) {
    const rows = rest.map((p) => ({
      txn_id: txnId, project_id: projectId, order_type: 'WO', order_ref: woId,
      milestone_id: p.milestoneId, allocated_amount: p.amount, org_id: orgId,
    }));
    const { error: e2 } = await supabase.from('txn_allocations').insert(rows);
    if (e2) throw e2;
  }
}

export interface DailyWageResult { rate: number; days: number; amount: number; }

/** MOCK — the NMR / muster backend is not built yet. No DB write. When the muster
 *  module lands, replace this body with the real RPC; the hub stays unchanged. */
export async function markDailyWage(txn: TrackTxn, { rate }: { rate: number }): Promise<DailyWageResult> {
  const amount = num(txn.total_amount);
  return { rate, days: rate > 0 ? amount / rate : 0, amount };
}

/** File the payment as a one-off labour expense — no tracking object. The money is
 *  already in the project's cost breakdown via its allocation, so this is purely an
 *  acknowledgement today (pending the labour module / an "untracked" flag). */
export async function fileAsLabour(txn: TrackTxn): Promise<void> {
  void txn; // accepted for API symmetry; nothing is written yet
  return;
}
