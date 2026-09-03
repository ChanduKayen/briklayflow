// Work certification + engagement basis + ledger cutover — the Phase-1 "confirmation layer" data seam.
//
//  · basis     : each engagement (crew / direct worker) DECLARES how it's owed (day/work/measurement/piece).
//  · cutover   : the org's ledger go-live date; before it is settled (opening balances), after it accrues.
//  · certify   : an evidenced, role-gated event that mints a contract obligation. Only APPROVED counts.
//                submit auto-approves within the submitter's authority, else routes to the Works Approver
//                (project-first, member-fallback), server-enforced in submit_work_certification.
import { supabase } from './supabase';

export type AccrualBasis = 'day' | 'work' | 'measurement' | 'piece';
export const BASIS_LABEL: Record<AccrualBasis, string> = {
  day: 'Day-wage (attendance)', work: 'Contract (certified work)', measurement: 'Measured by attendance', piece: 'Piece / lump (gutha)',
};

// ── the current user's certification authority (gates the approval UI) ───────
export interface CertAuthority { canCertify: boolean; limit: number | null; isManager: boolean }
export async function loadMyCertAuthority(orgId: string, userId: string): Promise<CertAuthority> {
  const { data } = await supabase.from('org_memberships')
    .select('can_certify_work, work_certification_limit, role')
    .eq('org_id', orgId).eq('user_id', userId).eq('status', 'active').maybeSingle();
  const r = (data ?? {}) as any;
  return { canCertify: !!r.can_certify_work, limit: r.work_certification_limit ?? null, isManager: r.role === 'management' || r.role === 'principal' };
}
/** May this user approve a certification of `amount`? (holds the power + within cap, or is management.) */
export function canApproveAmount(a: CertAuthority | undefined, amount: number): boolean {
  if (!a) return false;
  if (a.isManager) return true;
  return a.canCertify && (a.limit == null || amount <= a.limit);
}

// ── engagement basis ────────────────────────────────────────────────────────
export async function setEngagementBasis(kind: 'crew' | 'direct', id: string, basis: AccrualBasis): Promise<void> {
  const table = kind === 'crew' ? 'labour_crews' : 'labour_direct_workers';
  const key = kind === 'crew' ? 'crew_id' : 'id';
  const { error } = await supabase.from(table).update({ accrual_basis: basis, basis_confirmed: true }).eq(key, id);
  if (error) throw error;
}

// ── ledger cutover ──────────────────────────────────────────────────────────
export async function loadLedgerCutover(orgId: string): Promise<string | null> {
  const { data } = await supabase.from('organizations').select('ledger_start_date').eq('org_id', orgId).maybeSingle();
  return (data as any)?.ledger_start_date ?? null;
}
export async function setLedgerCutover(orgId: string, date: string | null): Promise<void> {
  const { error } = await supabase.from('organizations').update({ ledger_start_date: date }).eq('org_id', orgId);
  if (error) throw error;
}

// ── certification ─────────────────────────────────────────────────────────────
export interface CertifyInput {
  orgId: string; projectId: string | null; woId: string | null; milestoneId: string | null;
  crewId: string | null; stakeholderId: string | null;
  readingKind: 'lump' | 'measured' | 'piece';
  readingValue: number; computedAmount: number; readingDate: string;
  evidenceUrl?: string | null; note?: string | null;
}
export interface CertifyResult { id: string; status: 'pending' | 'approved'; escalatedTo: string | null }

/** Compute the ₹ a reading asserts. lump = planned × % (cumulative); measured = rate × qty; piece = the entered ₹. */
export function computeCertAmount(kind: 'lump' | 'measured' | 'piece', reading: number, planned: number, rate: number): number {
  if (kind === 'lump') return Math.round((planned || 0) * (reading || 0) / 100);
  if (kind === 'measured') return Math.round((rate || 0) * (reading || 0));
  return Math.round(reading || 0); // piece: reading IS the ₹
}

export async function submitWorkCertification(i: CertifyInput): Promise<CertifyResult> {
  const { data, error } = await supabase.rpc('submit_work_certification', {
    p_org_id: i.orgId, p_project_id: i.projectId ?? '', p_wo_id: i.woId ?? '', p_milestone_id: i.milestoneId,
    p_crew_id: i.crewId, p_stakeholder_id: i.stakeholderId ?? '',
    p_reading_kind: i.readingKind, p_reading_value: i.readingValue, p_computed_amount: i.computedAmount,
    p_reading_date: i.readingDate, p_evidence_url: i.evidenceUrl ?? '', p_note: i.note ?? '',
  });
  if (error) throw error;
  const r = data as { success?: boolean; error?: string; id?: string; status?: string; escalated_to?: string | null } | null;
  if (!r?.success || !r.id) throw new Error(r?.error ?? 'Could not submit the certification');
  return { id: r.id, status: (r.status as 'pending' | 'approved') ?? 'pending', escalatedTo: r.escalated_to ?? null };
}

export async function decideWorkCertification(id: string, approve: boolean): Promise<'approved' | 'rejected'> {
  const { data, error } = await supabase.rpc('decide_work_certification', { p_id: id, p_approve: approve });
  if (error) throw error;
  const r = data as { success?: boolean; error?: string; status?: string } | null;
  if (!r?.success) throw new Error(r?.error ?? 'Could not record the decision');
  return (r.status as 'approved' | 'rejected') ?? 'rejected';
}

export interface PendingCert {
  id: string; projectId: string | null; woId: string | null; milestoneId: string | null; stakeholderId: string | null;
  readingKind: string; readingValue: number; computedAmount: number; readingDate: string; note: string | null;
  evidenceUrl: string | null; partyName?: string; projectName?: string;
}
/** Certifications awaiting the current user (or, for management, all pending in the org). */
export async function loadPendingCertifications(): Promise<PendingCert[]> {
  const { data, error } = await supabase
    .from('work_certifications')
    .select('id, project_id, wo_id, milestone_id, stakeholder_id, reading_kind, reading_value, computed_amount, reading_date, note, evidence_url, stakeholders(name), projects(name)')
    .eq('status', 'pending').order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id, projectId: r.project_id, woId: r.wo_id, milestoneId: r.milestone_id, stakeholderId: r.stakeholder_id,
    readingKind: r.reading_kind, readingValue: Number(r.reading_value) || 0, computedAmount: Number(r.computed_amount) || 0,
    readingDate: r.reading_date, note: r.note, evidenceUrl: r.evidence_url,
    partyName: r.stakeholders?.name, projectName: r.projects?.name,
  }));
}

/** A milestone's approved-certified total + latest reading, for the wizard's "certified so far" context. */
export async function loadMilestoneCertified(milestoneId: string): Promise<{ total: number; latestPct: number }> {
  const { data } = await supabase.from('work_certifications')
    .select('reading_kind, reading_value, computed_amount, reading_date, status')
    .eq('milestone_id', milestoneId).eq('status', 'approved').order('reading_date', { ascending: false });
  const rows = (data ?? []) as any[];
  if (!rows.length) return { total: 0, latestPct: 0 };
  if (rows[0].reading_kind === 'lump') return { total: Number(rows[0].computed_amount) || 0, latestPct: Number(rows[0].reading_value) || 0 };
  const total = rows.reduce((s, r) => s + (Number(r.computed_amount) || 0), 0);
  return { total, latestPct: 0 };
}
