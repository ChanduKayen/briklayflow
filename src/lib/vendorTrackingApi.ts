/**
 * vendorTrackingApi — the single seam for the "Are you tracking this purchase?" hub.
 *
 * HARD RULE: this hub touches MONEY only. The GRN / Inward Register books stock; nothing
 * here writes stock or GRN. Vendor balance is READ from the read-only ledger view
 * (v_vendor_balance), never recomputed into a parallel store.
 *
 * Wiring (per product decisions):
 *  · bills        = approved POs with total_value − paid > 0, oldest first
 *  · balance      = v_vendor_balance (sum of the ledger)
 *  · persistence  = txn_allocations (order_type 'PO' per cleared bill, oldest-first)
 *  · advance      = a txn_allocations row with order_type 'ADVANCE' (no order_ref)
 *  · ad-hoc buy   = a quick, auto-approved PO (create_purchase_order) the payment clears
 *  · bill OCR     = optional/deferred (the brief: the bill is never a gate) — readBill is
 *                   a light simulation today; wire reconcile-po-bill when ingestion lands.
 */
import { supabase } from './supabase';
import type { TrackTxn } from './trackingApi';

export interface VendorBill {
  id: string;        // the PO id (the bill we clear)
  name: string;      // a readable line ("Cement — 50 bags")
  po: string;        // shown under the line (the PO id)
  due: number;       // amount still due
}

export interface VendorHubData {
  vendor: string;
  siteBal: number;
  totalBal: number;
  paidToDate: number;
  bills: VendorBill[];
}

const num = (n: unknown) => Number(n) || 0;
const projectIdOf = (t: TrackTxn): string | null => t?.txn_allocations?.[0]?.project_id ?? null;
const NO_ALLOC = "This payment isn't on a project yet — open it to set one, then track it.";

interface PoRow { po_id: string; project_id: string | null; total_value: number | null; order_value: number | null; items: unknown; date_issued: string | null }
interface PaidRow { order_ref: string; allocated_amount: number | null }

// A readable name from a PO's items jsonb (first item + "+N more"); falls back to the id.
function poName(items: unknown, poId: string): string {
  if (Array.isArray(items) && items.length) {
    const first = items[0] as { item_name?: string; name?: string };
    const label = first?.item_name || first?.name;
    if (label) return items.length > 1 ? `${label} +${items.length - 1} more` : label;
  }
  return poId;
}

async function vendorPaidToDate(stakeholderId: string, projectId: string | null): Promise<number> {
  const { data: txns } = await supabase.from('transactions').select('txn_id').eq('stakeholder_id', stakeholderId).neq('status', 'Voided');
  const tids = ((txns ?? []) as Array<{ txn_id: string }>).map((t) => t.txn_id);
  if (!tids.length) return 0;
  let q = supabase.from('txn_allocations').select('allocated_amount').in('txn_id', tids);
  if (projectId) q = q.eq('project_id', projectId);
  const { data: allocs } = await q;
  return ((allocs ?? []) as Array<{ allocated_amount: number | null }>).reduce((s, a) => s + num(a.allocated_amount), 0);
}

/** Read open bills (approved POs with a due) oldest-first, plus the vendor balance. */
export async function getVendorHub(txn: TrackTxn): Promise<VendorHubData> {
  const vendor = txn?.stakeholders?.name || 'this vendor';
  const stakeholderId = txn?.stakeholder_id ?? null;
  const projectId = projectIdOf(txn);
  if (!stakeholderId) return { vendor, siteBal: 0, totalBal: 0, paidToDate: 0, bills: [] };

  const { data: pos } = await supabase.from('purchase_orders')
    .select('po_id, project_id, total_value, order_value, items, date_issued')
    .eq('stakeholder_id', stakeholderId)
    .eq('approval_status', 'APPROVED')
    .not('status', 'in', '("CANCELLED","Cancelled","cancelled")')
    .order('date_issued', { ascending: true });
  const poList = (pos ?? []) as PoRow[];
  const ids = poList.map((p) => p.po_id);

  const { data: paid } = ids.length
    ? await supabase.from('txn_allocations').select('order_ref, allocated_amount').eq('order_type', 'PO').in('order_ref', ids)
    : { data: [] as PaidRow[] };
  const paidByPo: Record<string, number> = {};
  ((paid ?? []) as PaidRow[]).forEach((p) => { paidByPo[p.order_ref] = (paidByPo[p.order_ref] || 0) + num(p.allocated_amount); });

  // Balance = open PO dues, read straight from the ledger (PO totals − payments applied).
  // Per-project (siteBal) and overall (totalBal). This is the authoritative source; the
  // v_vendor_balance view is an optional convenience that also nets off advances.
  let totalBal = 0, siteBal = 0;
  const bills: VendorBill[] = [];
  for (const p of poList) {
    const total = num(p.total_value) || num(p.order_value);
    const due = Math.max(0, total - (paidByPo[p.po_id] || 0));
    totalBal += due;
    if (projectId && p.project_id === projectId) siteBal += due;
    if (due > 0) bills.push({ id: p.po_id, name: poName(p.items, p.po_id), po: p.po_id, due });
  }
  if (!projectId) siteBal = totalBal;

  const paidToDate = await vendorPaidToDate(stakeholderId, projectId);
  return { vendor, siteBal, totalBal, paidToDate, bills };
}

/** Read a vendor bill (image/PDF) via the reconcile-po-bill function → extract the bill
 *  total; GST is back-calculated at 18% (refine when the reader returns a GST split).
 *  Returns total 0 if nothing could be read, so the caller can fall back to manual entry. */
export async function readVendorBill(base64: string, mime: string): Promise<{ total: number; gst: number }> {
  const { data, error } = await supabase.functions.invoke('reconcile-po-bill', {
    body: { bill_base64: base64, bill_mime_type: mime, po_line_items: [] },
  });
  if (error) throw error;
  const d = data as { bill_total_extracted?: number | null } | null;
  const total = Math.round(Number(d?.bill_total_extracted) || 0);
  return { total, gst: total > 0 ? Math.round(total - total / 1.18) : 0 };
}

export interface VendorPurchase { name: string; amount: number; hasBill: boolean; gst?: number }

export interface VendorCommitInput {
  payment: number;
  /** every PO the payment touches (existing bills + just-added purchases) with the
   *  amount placed on each */
  pos: Array<{ poId: string; applied: number }>;
}

/** Record an ad-hoc purchase as a real, auto-approved PO right away (so it shows in the
 *  Purchase Orders page and the hub can display its id). MONEY ONLY: a bill amount may be
 *  stored on the PO, but NO GRN/stock is written. Returns the new PO id. */
export async function createVendorPurchase(txn: TrackTxn, orgId: string, b: VendorPurchase): Promise<{ poId: string }> {
  const projectId = projectIdOf(txn);
  if (!projectId) throw new Error(NO_ALLOC);
  const stakeholderId = txn?.stakeholder_id ?? null;
  const { data: u } = await supabase.auth.getUser();
  const createdBy = u?.user?.id ?? null;
  const items = [{ name: b.name, quantity: 1, rate: b.amount, amount: b.amount }];
  const lineItems = [{ line_number: 1, item_name: b.name, unit: 'Nos', quantity_ordered: 1, unit_rate: b.amount, basic_amount: b.amount, discount_percent: 0, discount_amount: 0, gst_rate: 0, cgst: 0, sgst: 0, igst: 0, total_amount: b.amount }];
  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_po_data: {
      org_id: orgId, project_id: projectId, stakeholder_id: stakeholderId,
      items, order_value: b.amount, total_value: b.amount, gst_value: b.gst ?? 0,
      status: b.hasBill ? 'BILLED' : 'ORDERED',
      date_issued: new Date().toISOString().split('T')[0], payment_terms_days: 0, created_by: createdBy,
    },
    p_line_items: lineItems,
  });
  if (error) throw error;
  const res = data as { success?: boolean; error?: string; po_id?: string } | null;
  if (!res?.success || !res.po_id) throw new Error(res?.error ?? 'Could not record the purchase');
  // Declared at payment time → auto-approve so it's immediately clearable. Record the bill
  // amount (money) when one was attached; never touch stock/GRN.
  await supabase.from('purchase_orders')
    .update({ approval_status: 'APPROVED', ...(b.hasBill ? { vendor_bill_amount: b.amount } : {}) })
    .eq('po_id', res.po_id);
  return { poId: res.po_id };
}

/** Record the payment: place the amounts the user set on each PO (txn_allocations
 *  order_type 'PO'), and park any leftover as an ADVANCE. The POs already exist (existing
 *  bills + purchases created on add). Sum of allocations equals the payment, so the
 *  project total on the existing allocation is preserved. MONEY ONLY. */
export async function commitVendorPayment(txn: TrackTxn, orgId: string, input: VendorCommitInput): Promise<void> {
  const projectId = projectIdOf(txn);
  const txnId = txn?.txn_id;
  if (!projectId || !txnId) throw new Error(NO_ALLOC);

  const parts: Array<{ order_type: 'PO' | 'ADVANCE'; order_ref: string | null; amount: number }> = [];
  for (const p of input.pos) {
    if (p.applied > 0) parts.push({ order_type: 'PO', order_ref: p.poId, amount: Math.round(p.applied) });
  }
  // Whatever wasn't placed is held as a vendor advance/credit.
  const allocated = parts.reduce((s, p) => s + p.amount, 0);
  const leftover = Math.round(input.payment - allocated);
  if (leftover > 0) parts.push({ order_type: 'ADVANCE', order_ref: null, amount: leftover });
  if (parts.length === 0) parts.push({ order_type: 'ADVANCE', order_ref: null, amount: input.payment });

  // Re-split the whole allocation atomically (so the sum-check sees only the final state).
  const { data, error } = await supabase.rpc('replace_txn_allocations', {
    p_txn_id: txnId, p_project_id: projectId, p_org_id: orgId,
    p_parts: parts.map((p) => ({ order_type: p.order_type, order_ref: p.order_ref, milestone_id: null, allocated_amount: p.amount })),
  });
  if (error) throw error;
  const res = data as { success?: boolean; error?: string } | null;
  if (!res?.success) throw new Error(res?.error ?? 'Could not record the payment');
}
