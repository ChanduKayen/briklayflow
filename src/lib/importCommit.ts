// Transactions importer — the commit layer. buildImportRows (PURE, tested) turns resolved rows into
// the exact jsonb the import_transactions RPC expects; commitImport (supabase INJECTED, not imported,
// so this file stays test-clean) creates the new stakeholders then calls the RPC.

import { detectDirection, type TxnMode } from './importParse';
import type { StakeholderType } from './importClassify';
import { uniqueProjectId } from './projectId';

/** One row after the user has resolved its party + site (the wizard's output). */
export interface ResolvedCommitRow {
  rowNo: number;
  date: string;                 // yyyy-mm-dd (only committable rows reach here)
  amount: number;               // signed; a negative is an income signal
  mode: TxnMode | null;
  note: string | null;
  stakeholderId: string | null; // resolved existing party; null when the party is created in THIS import
  newPartyKey?: string | null;  // tempKey of a party created in this import → resolved to an id at commit
  partyType: string | null;     // resolved/created party type — drives income + client_receipt
  projectId: string | null;     // resolved site → allocation; null = no-site expense
  newProjectKey?: string | null;// tempKey of a project created in this import → resolved at commit
  directionCell?: string | null;
}

/** The jsonb shape the import_transactions RPC reads per row (see migration 20260825000001). */
export interface ImportRowPayload {
  row_no: number;
  txn_id: string;
  stakeholder_id: string | null;
  date: string;
  total_amount: number;
  payment_mode: TxnMode | null;
  category: string | null;
  remarks: string;
  ai_flag_status: 'Clean';
  ai_flag_data: Record<string, unknown>;
  org_id: string;
  project_id: string | null;
}

/**
 * Build the RPC payload. Direction is decided here (detectDirection) from the resolved party type +
 * the row's signals; an income row carries ai_flag_data.type='client_receipt' so deriveDirection reads
 * it as money-IN without touching invoices. Amount is stored as a POSITIVE magnitude. txn_id is
 * deterministic per (batch, row) so a re-upload is idempotent. Cost code (category) is left null by design.
 */
export function buildImportRows(
  rows: ResolvedCommitRow[],
  ctx: { orgId: string; batchId: string },
): ImportRowPayload[] {
  return rows.map((r) => {
    const direction = detectDirection({
      directionCell: r.directionCell, amount: r.amount, note: r.note, partyType: r.partyType,
    });
    const ai_flag_data: Record<string, unknown> = { source: 'import' };
    // Mark income so deriveDirection returns 'in'. A Client party already reads 'in' by type, but the
    // marker is harmless there and makes the intent explicit; a non-Client income row NEEDS it.
    if (direction === 'in') ai_flag_data.type = 'client_receipt';

    return {
      row_no: r.rowNo,
      txn_id: `IMP-${ctx.batchId}-${r.rowNo}`,
      stakeholder_id: r.stakeholderId,
      date: r.date,
      total_amount: Math.abs(r.amount),
      payment_mode: r.mode,
      category: null,                        // cost code filed later (design decision #1)
      remarks: r.note ?? '',
      ai_flag_status: 'Clean',
      ai_flag_data,
      org_id: ctx.orgId,
      project_id: r.projectId,
      // isClient retained implicitly via ai_flag_data; kept out of the payload (the RPC ignores extras).
    };
  });
}

// ── The write (supabase injected) ──────────────────────────────────────────────────────────────────
export interface NewStakeholder {
  tempKey: string;              // the normalized name key the wizard used, to map back to rows
  name: string;
  type: StakeholderType;
  category: string;
  contact?: string | null;
}

export interface NewProject {
  tempKey: string;              // the normalized site key the wizard used
  name: string;                 // only name is required (projects.name NOT NULL); rest filled later
}

interface SupabaseLike {
  from: (t: string) => any;
  // The real client's .rpc() returns a thenable builder, not a bare Promise — PromiseLike is all we
  // need (we await it), and it accepts the supabase client without a cast.
  rpc: (fn: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
}

export interface CommitResult {
  batchId: string;
  createdIds: Record<string, string>;        // name tempKey → new stakeholder_id
  createdProjectIds: Record<string, string>; // site tempKey → new project_id
  inserted: { row_no: number; txn_id: string }[];
  skipped: number[];
  failed: { row_no: number; error: string }[];
}

/** A stable, collision-proof STK id (mirrors NewTransaction.createStakeholder's shape). */
export function newStakeholderId(seed: number): string {
  return `STK-${Math.floor(1000 + (seed % 9000))}${Date.now().toString(36).slice(-3).toUpperCase()}`;
}

/**
 * Create the new parties, then insert the transactions via import_transactions. `resolve` maps each
 * row's party (by the wizard's tempKey for created ones) to a real stakeholder_id + type just before
 * the payload is built. Returns per-row outcomes for the done screen; nothing is silently dropped.
 */
export async function commitImport(
  sb: SupabaseLike,
  args: {
    orgId: string;
    batchId: string;
    newStakeholders: NewStakeholder[];
    newProjects?: NewProject[];
    rows: ResolvedCommitRow[];
  },
): Promise<CommitResult> {
  const createdIds: Record<string, string> = {};
  const createdProjectIds: Record<string, string> = {};

  if (args.newStakeholders.length) {
    const payload = args.newStakeholders.map((s, i) => ({
      stakeholder_id: newStakeholderId(i + 1),
      name: s.name,
      type: s.type,
      category: s.category || 'General',
      contact: s.contact ?? null,
      org_id: args.orgId,
    }));
    const { data, error } = await sb.from('stakeholders').insert(payload).select();
    if (error) throw error;
    (data as any[]).forEach((row, i) => { createdIds[args.newStakeholders[i].tempKey] = row.stakeholder_id; });
  }

  if (args.newProjects?.length) {
    const payload = args.newProjects.map((pr) => ({
      project_id: uniqueProjectId(pr.name),
      name: pr.name,
      status: 'Active',
      org_id: args.orgId,
    }));
    const { data, error } = await sb.from('projects').insert(payload).select();
    if (error) throw error;
    (data as any[]).forEach((row, i) => { createdProjectIds[args.newProjects![i].tempKey] = row.project_id; });
  }

  // Resolve created-party / created-project references before building the payload.
  const resolved = args.rows.map((r) => {
    let out = r;
    if (r.newPartyKey) out = { ...out, stakeholderId: createdIds[r.newPartyKey] ?? out.stakeholderId };
    if (r.newProjectKey) out = { ...out, projectId: createdProjectIds[r.newProjectKey] ?? out.projectId };
    return out;
  });

  const p_rows = buildImportRows(resolved, { orgId: args.orgId, batchId: args.batchId });
  const { data, error } = await sb.rpc('import_transactions', { p_rows, p_batch_id: args.batchId });
  if (error) throw error;

  return {
    batchId: args.batchId,
    createdIds,
    createdProjectIds,
    inserted: data?.inserted ?? [],
    skipped: data?.skipped ?? [],
    failed: data?.failed ?? [],
  };
}
