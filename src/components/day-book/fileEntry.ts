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
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

/** The mandatory fields, resolved — either by the AI or by the owner inline. */
export interface ResolvedFields {
  payeeId: string;
  projectId: string;
  amount: number;
  description: string;
}

/** Ready to file once every mandatory field is resolved (payee + project must
 *  be matched to real records, not just heard). Drives the File button + swipe. */
export function isResolved(r: ResolvedFields): boolean {
  return Boolean(r.payeeId) && Boolean(r.projectId) && r.amount > 0 && Boolean(r.description.trim());
}

/**
 * Commit the file. Throws on any failure so the caller's file-journey can show
 * an honest error and return the card to the queue — never a false "Filed".
 * `resolved` carries the final mandatory fields (AI read merged with any inline
 * edits the owner made on the card). Returns the new txn_id on success.
 */
export async function fileRoughEntry(entry: RoughEntry, orgId: string, resolved: ResolvedFields): Promise<string> {
  const ai = entry.ai_extracted || {};
  const newTxnId = genTxnId();

  const payload = {
    txn_id: newTxnId,
    stakeholder_id: resolved.payeeId,
    date: ai.date || new Date().toISOString().slice(0, 10),
    total_amount: resolved.amount,
    payment_mode: ai.mode || 'Cash',
    category: ai.category_code || null,
    remarks: resolved.description,
    bill_doc_url: null,
    proof_document_url: entry.raw_image_url || null,
    ai_flag_status: 'Clean',
    ai_flag_data: {},
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
 * Create a new party inline (same shape as ResolvePopup's new-stakeholder form),
 * so the owner can link a heard-but-unknown payee without leaving the card.
 * Returns the new stakeholder id + name.
 */
export async function createParty(
  name: string,
  type: 'Worker' | 'Vendor' | 'Client',
  orgId: string,
): Promise<{ id: string; name: string }> {
  const newId = `STK-${Math.floor(1000 + Math.random() * 9000)}`;
  const { data, error } = await supabase.from('stakeholders').insert([{
    stakeholder_id: newId,
    name: name.trim(),
    type,
    category: type,
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
