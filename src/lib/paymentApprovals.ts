/**
 * The run's middle stage — approved, waiting to be paid.
 *
 * A weekly run is a pipeline: approve → pay → paid. "Paid" has always been real (a transaction
 * stamped with the week and the row), but "approved" had nowhere to live, so the two collapsed into
 * one act. This is that stage, stored per (org, week, row) — see the payment_approvals migration.
 *
 * Every call degrades rather than throws on read: a run whose table has not been applied yet simply
 * has nothing approved, which is what it looked like before. Writing says why it failed.
 */
import { supabase } from './supabase';
import { mondayOf } from './weeklyPaymentsApi';

export interface Approval { rowKey: string; amount: number; via: string | null; byName: string | null; at: string }

const weekKey = (monday: Date) => mondayOf(monday).toISOString().slice(0, 10);
/** postgrest's "relation does not exist" — the migration has not been applied on this project yet. */
export const isMissingTable = (e: unknown) => {
  const c = (e as { code?: string } | null)?.code;
  return c === '42P01' || c === 'PGRST205' || c === 'PGRST202';
};

/** What is approved for this week, by row key. Empty when nothing is — or when the table is not there yet. */
export async function loadApprovals(monday: Date): Promise<Record<string, Approval>> {
  const { data, error } = await supabase
    .from('payment_approvals')
    .select('row_key, amount, via, approved_by_name, created_at')
    .eq('week', weekKey(monday));
  if (error || !data) return {};
  const out: Record<string, Approval> = {};
  for (const r of data as { row_key: string; amount: number; via: string | null; approved_by_name: string | null; created_at: string }[]) {
    out[r.row_key] = { rowKey: r.row_key, amount: Number(r.amount) || 0, via: r.via, byName: r.approved_by_name, at: r.created_at };
  }
  return out;
}

/** Agree this much, for this row, this week. Approving again changes the agreed amount. */
export async function approve(
  orgId: string, monday: Date,
  row: { rowKey: string; amount: number; via?: string | null; partyName?: string | null },
  who?: { id?: string | null; name?: string | null },
): Promise<void> {
  const { error } = await supabase.from('payment_approvals').upsert({
    org_id: orgId, week: weekKey(monday), row_key: row.rowKey, amount: row.amount,
    via: row.via ?? null, party_name: row.partyName ?? null,
    approved_by: who?.id ?? null, approved_by_name: who?.name ?? null,
  }, { onConflict: 'org_id,week,row_key' });
  if (error) throw error;
}

/** Send it back to Approve. */
export async function unapprove(orgId: string, monday: Date, rowKey: string): Promise<void> {
  const { error } = await supabase.from('payment_approvals').delete()
    .eq('org_id', orgId).eq('week', weekKey(monday)).eq('row_key', rowKey);
  if (error) throw error;
}
