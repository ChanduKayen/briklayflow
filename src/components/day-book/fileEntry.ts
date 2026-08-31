/**
 * The Day Book write path. ONE place that turns a reviewed capture into a real
 * transaction, mirroring ResolvePopup.handlePost so a filed Day-book entry and a
 * hand-made transaction are identical records downstream (same RPC, same
 * provenance via source_re_id). Quick-file (a ready card) and the Fix popup both
 * post the same way.
 */
import { supabase } from '../../lib/supabase';
import type { RoughEntry } from '../../types';

function genTxnId() {
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

/**
 * Best-effort human message from any thrown value. Supabase's PostgrestError is a
 * plain object (NOT an Error), so `instanceof Error` misses it and the real reason
 * gets swallowed behind a generic fallback. Surface message/details/hint/code.
 */
export function errMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) return err.message;
  if (err && typeof err === 'object') {
    const e = err as { message?: string; details?: string; hint?: string; code?: string };
    const parts = [e.message, e.details, e.hint].filter(Boolean);
    if (parts.length) return parts.join(' — ') + (e.code ? ` (${e.code})` : '');
  }
  return fallback;
}

/** The mandatory fields, resolved — either by the AI or by the owner inline. */
export interface ResolvedFields {
  payeeId: string;
  projectId: string;
  amount: number;
  description: string;
  generalExpense?: boolean;       // a general expense needs no linked party
  generalExpenseHead?: string;    // the GEN-xx head it's filed under (default GEN-99)
}

/**
 * Ready to file once every mandatory field is resolved.
 *
 * THE REASON IS NOT MANDATORY, AND NEVER SHOULD HAVE BEEN. A payment with a payee, a project and an
 * amount is a complete transaction — it is who, where, and how much, and a ledger has been able to
 * record exactly that for six hundred years. The reason is a NOTE on it. Demanding one meant a card
 * that knew everything that matters sat there refusing to file because nobody had typed "cement".
 *
 * `payeeId` and `projectId` must be REAL rows — see resolveIds() in ReviewCard. They arrive from the
 * AI as strings in a jsonb blob, and a string that looks like a key is not a key.
 */
export function isResolved(r: ResolvedFields): boolean {
  const payeeOk = r.generalExpense ? true : Boolean(r.payeeId);
  return payeeOk && Boolean(r.projectId) && r.amount > 0;
}

/**
 * WHAT IS ACTUALLY MISSING — the list, in the order a person would fix it.
 *
 * This is the whole basis of the assist: ONE gap is a question we can ask on the card and answer in a
 * single press. TWO OR MORE is a conversation, and that is what the editor is for.
 */
export type Gap = 'amount' | 'payee' | 'project';

export function gapsOf(r: ResolvedFields): Gap[] {
  const out: Gap[] = [];
  if (!(r.amount > 0)) out.push('amount');
  if (!r.generalExpense && !r.payeeId) out.push('payee');
  if (!r.projectId) out.push('project');
  return out;
}

/**
 * Commit the file. Throws on any failure so the caller's file-journey can show
 * an honest error and return the card to the queue — never a false "Filed".
 * `resolved` carries the final mandatory fields (AI read merged with any inline
 * edits the owner made on the card). Returns the new txn_id on success.
 */
/** The DB enum public.payment_mode — the RPC casts to it, so anything else throws. */
const PAYMENT_MODES = ['Cash', 'NEFT', 'UPI', 'Cheque'] as const;

export async function fileRoughEntry(entry: RoughEntry, orgId: string, resolved: ResolvedFields): Promise<string> {
  const ai = entry.ai_extracted || {};
  const newTxnId = genTxnId();

  // The AI read is free-form; the RPC casts payment_mode + date to strict pg types.
  // ResolvePopup launders these through validated UI state — quick-file must do the
  // same here, or a stray mode ("Bank Transfer") / date format trips the enum/date cast.
  const mode = PAYMENT_MODES.includes(ai.mode as typeof PAYMENT_MODES[number]) ? ai.mode! : 'Cash';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ai.date || '') ? ai.date! : new Date().toISOString().slice(0, 10);

  // A general expense is recorded with NO party (stakeholder_id null) under the
  // general-expense category; everything else keeps its linked payee + inferred category.
  const isGeneral = !!resolved.generalExpense;
  // A general expense has no party, but it may still have a heard name ("labours",
  // "auto driver"). Preserve it so the detail page can show who it was for.
  const genName = isGeneral ? String(ai.payee_name || ai.payee_raw || '').trim() : '';

  const payload = {
    txn_id: newTxnId,
    stakeholder_id: isGeneral ? null : resolved.payeeId,
    date,
    total_amount: resolved.amount,
    payment_mode: mode,
    category: isGeneral ? (resolved.generalExpenseHead || 'GEN-99') : (ai.category_code || null),
    remarks: resolved.description,
    bill_doc_url: null,
    proof_document_url: entry.raw_image_url || null,
    ai_flag_status: 'Clean',
    ai_flag_data: genName ? { general_payee: genName } : {},
    org_id: orgId,
  };
  const allocations = [{
    project_id: resolved.projectId, order_type: null, order_ref: null,
    milestone_id: null, allocated_amount: resolved.amount,
  }];

  const { error: rpcErr } = await supabase.rpc('insert_transaction_with_allocations', {
    p_txn: payload, p_allocations: allocations,
  });
  if (rpcErr) throw rpcErr;

  // provenance: point the transaction back at its capture (read channel/sender
  // through this FK; no denormalised source column by design)
  await supabase.from('transactions')
    .update({ source_re_id: entry.id, proof_document_url: entry.raw_image_url || null })
    .eq('txn_id', newTxnId);

  const { error: postErr } = await supabase.from('rough_entries')
    .update({ status: 'POSTED', resolved_txn_id: newTxnId })
    .eq('id', entry.id);
  if (postErr) throw postErr;

  return newTxnId;
}

/**
 * One slice of a split file. Every slice needs a project + amount. It MAY also carry its own
 * payee / description / general-expense head — when it does, that row becomes its own distinct
 * transaction (the "split into multiple transactions" case). When it doesn't, the row inherits
 * the shared payee/description from `base` (the "same payee across sites" case).
 */
export interface ProjectSplit {
  projectId: string;
  amount: number;
  payeeId?: string | null;
  description?: string | null;
  generalExpense?: boolean;
  generalExpenseHead?: string;
}

/**
 * File a captured entry as a SPLIT — N separate transactions, atomic via
 * insert_split_transactions. `base` carries the shared fallback fields (payee/description/
 * general-expense); each split may override payee/description/category per row. Returns the
 * new txn_ids.
 */
export async function fileRoughEntrySplit(
  entry: RoughEntry,
  orgId: string,
  base: Omit<ResolvedFields, 'projectId'>,
  splits: ProjectSplit[],
): Promise<string[]> {
  const ai = entry.ai_extracted || {};
  const mode = PAYMENT_MODES.includes(ai.mode as typeof PAYMENT_MODES[number]) ? ai.mode! : 'Cash';
  const date = /^\d{4}-\d{2}-\d{2}$/.test(ai.date || '') ? ai.date! : new Date().toISOString().slice(0, 10);
  const isGeneral = !!base.generalExpense;
  const genName = isGeneral ? String(ai.payee_name || ai.payee_raw || '').trim() : '';

  const p_base = {
    stakeholder_id: isGeneral ? null : base.payeeId,
    date,
    payment_mode: mode,
    category: isGeneral ? (base.generalExpenseHead || 'GEN-99') : (ai.category_code || null),
    remarks: base.description,
    bill_doc_url: null,
    proof_document_url: entry.raw_image_url || null,
    ai_flag_status: 'Clean',
    ai_flag_data: genName ? { general_payee: genName } : {},
    org_id: orgId,
  };
  const baseTs = Date.now();
  const rnd = Math.random().toString(36).slice(2, 5).toUpperCase();
  const p_splits = splits.map((s, i) => {
    const rowGeneral = !!s.generalExpense;
    // Per-row overrides — omitted keys fall back to p_base inside the RPC (COALESCE).
    const row: Record<string, unknown> = {
      txn_id: `TXN-${new Date().getFullYear()}-${String(baseTs + i).slice(-6)}-${rnd}${i}`,
      total_amount: s.amount,
      project_id: s.projectId,
      order_type: null, order_ref: null, milestone_id: null,
    };
    if (s.payeeId !== undefined) row.stakeholder_id = rowGeneral ? '' : (s.payeeId || '');
    if (s.description != null) row.remarks = s.description;
    if (rowGeneral) row.category = s.generalExpenseHead || 'GEN-99';
    return row;
  });

  const { data, error: rpcErr } = await supabase.rpc('insert_split_transactions', { p_base, p_splits });
  if (rpcErr) throw rpcErr;
  const ids = (((data as any)?.txn_ids as string[]) ?? p_splits.map(s => s.txn_id));

  // provenance: point every split transaction back at its capture
  await supabase.from('transactions')
    .update({ source_re_id: entry.id, proof_document_url: entry.raw_image_url || null })
    .in('txn_id', ids);

  const { error: postErr } = await supabase.from('rough_entries')
    .update({ status: 'POSTED', resolved_txn_id: ids[0] ?? null })
    .eq('id', entry.id);
  if (postErr) throw postErr;

  return ids;
}

/**
 * Create a new party inline (same shape as ResolvePopup's new-stakeholder form),
 * so the owner can link a heard-but-unknown payee without leaving the card.
 * Returns the new stakeholder id + name.
 */
export async function createParty(
  name: string,
  type: 'Worker' | 'Vendor' | 'Client',
  orgId: string,
  category?: string,
): Promise<{ id: string; name: string }> {
  const newId = `STK-${Math.floor(1000 + Math.random() * 9000)}`;
  const { data, error } = await supabase.from('stakeholders').insert([{
    stakeholder_id: newId,
    name: name.trim(),
    type,
    category: category?.trim() || type,
    contact: null,
    org_id: orgId,
  }]).select().single();
  if (error) throw error;
  return { id: data.stakeholder_id, name: data.name };
}

/** Reject (cheap, reversible). Move-back restores PENDING. */
export async function rejectRoughEntry(entry: RoughEntry): Promise<void> {
  const { error } = await supabase.from('rough_entries')
    .update({ status: 'DISMISSED' }).eq('id', entry.id);
  if (error) throw error;
}

export async function restoreRoughEntry(entry: RoughEntry): Promise<void> {
  const { error } = await supabase.from('rough_entries')
    .update({ status: 'PENDING' }).eq('id', entry.id);
  if (error) throw error;
}
