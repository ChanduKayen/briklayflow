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
import { assertLinkable, type TrackTxn } from './trackingApi';

export interface VendorBill {
  id: string;        // the PO id (the bill we clear)
  project_id: string | null; // the PO's site (for cross-project allocation)
  name: string;      // a readable line ("Cement — 50 bags")
  po: string;        // shown under the line (the PO id)
  due: number;       // amount still due
  total: number;     // the bill's full value (for the % paid / burn-down)
  paid: number;      // already paid against it
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
    if (due > 0) bills.push({ id: p.po_id, project_id: p.project_id, name: poName(p.items, p.po_id), po: p.po_id, due, total, paid: paidByPo[p.po_id] || 0 });
  }
  if (!projectId) siteBal = totalBal;

  const paidToDate = await vendorPaidToDate(stakeholderId, projectId);
  return { vendor, siteBal, totalBal, paidToDate, bills };
}

/** One site the payment already touches, with the amount placed on it. The payment→site split
 *  is done at record time (Day Book / New Transaction); Attach-bill INHERITS it — it never
 *  re-splits the paid money. Read straight from txn_allocations (summed per project). */
export interface TxnSite { projectId: string; name: string; paid: number }
export async function getTxnAllocations(txn: TrackTxn): Promise<TxnSite[]> {
  const txnId = txn?.txn_id;
  if (!txnId) return [];
  const { data } = await supabase
    .from('txn_allocations')
    .select('project_id, allocated_amount, projects(name)')
    .eq('txn_id', txnId)
    .not('project_id', 'is', null);
  const rows = (data ?? []) as Array<{ project_id: string; allocated_amount: number | null; projects: { name?: string | null } | null }>;
  const byProj: Record<string, TxnSite> = {};
  for (const r of rows) {
    if (!byProj[r.project_id]) byProj[r.project_id] = { projectId: r.project_id, name: r.projects?.name || 'Site', paid: 0 };
    byProj[r.project_id].paid += num(r.allocated_amount);
  }
  return Object.values(byProj).filter((s) => s.paid > 0);
}

/** Upload the attached bill image/PDF once to the private `documents` bucket and return its
 *  public-object URL (parsed + signed on read via resolveDocUrl). One upload is reused across
 *  every PO this bill fans out into. Returns null on failure (the bill is never a hard gate). */
export async function uploadBillDoc(file: File, txnId: string): Promise<string | null> {
  const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
  const path = `po-bills/attach_${txnId}_${uidStr()}.${ext}`;
  const { error } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type });
  if (error) return null;
  const { data } = supabase.storage.from('documents').getPublicUrl(path);
  return data?.publicUrl ?? null;
}

const uidStr = () => Math.random().toString(36).slice(2, 10);

/** supabase-js collapses any non-2xx from an edge function into the generic
 *  "Edge Function returned a non-2xx status code". The real reason is in the Response it
 *  attaches as `error.context` — pull the `{ error }` body out so the user sees WHY. */
async function fnErrorMessage(error: unknown, fallback: string): Promise<string> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      const body = await ctx.clone().json();
      if (body?.error) return String(body.error);
    } catch {
      try { const t = await ctx.clone().text(); if (t) return t.slice(0, 300); } catch { /* ignore */ }
    }
  }
  const msg = (error as { message?: string })?.message;
  return msg && !/non-2xx/i.test(msg) ? msg : fallback;
}

/** The vendor's recent purchase orders (most recent first), so the user can ALSO pin this same bill
 *  onto an existing PO. Read-only list — attaching happens on click via `attachBillDocToPO`. */
export interface VendorPO { poId: string; projectId: string | null; name: string; total: number; status: string | null; hasBill: boolean; projectName: string | null }
export async function getVendorPOs(txn: TrackTxn, projectIds?: string[]): Promise<VendorPO[]> {
  const stakeholderId = txn?.stakeholder_id ?? null;
  if (!stakeholderId) return [];
  let q = supabase.from('purchase_orders')
    .select('po_id, project_id, items, total_value, order_value, status, vendor_bill_url, date_issued, projects(name)')
    .eq('stakeholder_id', stakeholderId)
    .not('status', 'in', '("CANCELLED","Cancelled","cancelled")');
  const pids = (projectIds ?? []).filter(Boolean);
  if (pids.length) q = q.in('project_id', pids);
  const { data } = await q
    .order('date_issued', { ascending: false })
    .limit(20);
  return ((data ?? []) as Array<{ po_id: string; project_id: string | null; items: unknown; total_value: number | null; order_value: number | null; status: string | null; vendor_bill_url: string | null; projects: { name?: string | null } | null }>)
    .map((p) => ({
      poId: p.po_id, projectId: p.project_id, name: poName(p.items, p.po_id),
      total: num(p.total_value) || num(p.order_value), status: p.status ?? null,
      hasBill: !!p.vendor_bill_url, projectName: p.projects?.name ?? null,
    }));
}

/** Pin the (already-uploaded) bill image + number/date onto an EXISTING PO. Non-destructive: it does
 *  not touch the PO's amount or status — just attaches the picture and the bill's identifiers. */
export async function attachBillDocToPO(poId: string, doc: { billUrl?: string | null; billNo?: string | null; billDate?: string | null }): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (doc.billUrl) { patch.vendor_bill_url = doc.billUrl; patch.vendor_bill_doc_url = doc.billUrl; }
  if (doc.billNo) { patch.vendor_bill_number = doc.billNo; patch.vendor_bill_no = doc.billNo; }
  if (doc.billDate) patch.vendor_bill_date = doc.billDate;
  if (Object.keys(patch).length === 0) return;
  await supabase.from('purchase_orders').update(patch).eq('po_id', poId);
}

/** Attach a bill to an EXISTING PO and settle it against THIS payment. Records the actual bill amount
 *  as the PO's billed value (the ORDER value is left untouched — you ordered X, the vendor billed Y),
 *  pins the image, and re-points this payment's share for the PO's project onto the PO — so the PO's
 *  balance becomes bill − paid and the ledger chip resolves. Any other-project portion of the payment
 *  stays a plain project allocation. Uses set_txn_allocations. MONEY + image only. */
export async function linkBillToExistingPO(
  txn: TrackTxn, orgId: string,
  args: { poId: string; projectId: string | null; billAmount: number; billUrl?: string | null; billNo?: string | null; billDate?: string | null; sites: TxnSite[] },
): Promise<void> {
  assertLinkable(txn);
  const txnId = txn?.txn_id;
  if (!txnId) throw new Error('This payment has no id.');
  const total = Math.round(num(txn.total_amount));
  const poProject = args.projectId;

  // How much of this payment belongs to the PO's project (what gets applied to the PO).
  const poPaid = args.sites.length
    ? args.sites.filter((s) => s.projectId === poProject).reduce((a, s) => a + s.paid, 0)
    : total;

  // 1) Record the bill on the PO (billed = the actual bill; order value untouched).
  const nowIso = new Date().toISOString();
  const patch: Record<string, unknown> = {};
  if (args.billAmount > 0) {
    patch.vendor_bill_amount = Math.round(args.billAmount);
    patch.bill_recorded_at = nowIso;
    patch.vendor_bill_date = args.billDate || nowIso.split('T')[0];
    patch.status = poPaid >= args.billAmount - 0.005 ? 'PAID' : poPaid > 0 ? 'PARTIAL' : 'BILLED';
  }
  if (args.billUrl) { patch.vendor_bill_url = args.billUrl; patch.vendor_bill_doc_url = args.billUrl; }
  if (args.billNo) { patch.vendor_bill_number = args.billNo; patch.vendor_bill_no = args.billNo; }
  if (Object.keys(patch).length) await supabase.from('purchase_orders').update(patch).eq('po_id', args.poId);

  // 2) Re-point the payment: PO's project → the PO; other projects → keep as plain project
  //    allocations. Parts must sum to the payment total.
  const rows = args.sites.length ? args.sites : (poProject ? [{ projectId: poProject, name: '', paid: total }] : []);
  const parts = rows.map((s) => s.projectId === poProject
    ? { project_id: s.projectId, order_type: 'PO', order_ref: args.poId, milestone_id: null, allocated_amount: Math.round(s.paid) }
    : { project_id: s.projectId, order_type: null, order_ref: null, milestone_id: null, allocated_amount: Math.round(s.paid) });
  if (!parts.length) return; // no project to link against — bill recorded, nothing to allocate

  const { data, error } = await supabase.rpc('set_txn_allocations', { p_txn_id: txnId, p_org_id: orgId, p_parts: parts });
  if (error) throw error;
  const res = data as { success?: boolean; error?: string } | null;
  if (!res?.success) throw new Error(res?.error ?? 'Could not link the payment to the PO');
}

/** Pin the (already-uploaded) bill image/PDF onto the TRANSACTION itself, so it shows in the
 *  Transaction Detail "Proof of Payment" section (which reads `transactions.bill_doc_url`). Without
 *  this the bill only lived on the PO and the txn's proof stayed empty. */
export async function attachBillDocToTxn(txnId: string, billUrl: string): Promise<void> {
  if (!txnId || !billUrl) return;
  await supabase.from('transactions').update({ bill_doc_url: billUrl }).eq('txn_id', txnId);
}

export interface BillLine { item: string; qty: number | null; unit: string | null; rate: number | null; amount: number | null }
export interface BillRead {
  vendor: string | null;
  billNo: string | null;
  billDate: string | null;
  total: number;
  gst: number;
  lines: BillLine[];
}

/** Read a vendor bill (image) with NO existing PO — the "Attach bill" flow. Uses reconcile-po-bill
 *  in its extract-only mode (empty po_line_items) → returns vendor, total, GST and line items.
 *  Returns total 0 if nothing could be read, so the caller can fall back to manual entry. */
export async function readVendorBill(base64: string, mime: string): Promise<BillRead> {
  const { data, error } = await supabase.functions.invoke('reconcile-po-bill', {
    body: { bill_base64: base64, bill_mime_type: mime, po_line_items: [] },
  });
  if (error) throw new Error(await fnErrorMessage(error, 'Could not read the bill'));
  const d = (data ?? {}) as {
    vendor_name?: string | null; bill_number?: string | null; bill_date?: string | null;
    bill_total_extracted?: number | null; gst_amount?: number | null; line_items?: BillLine[] | null;
  };
  const lines = Array.isArray(d.line_items) ? d.line_items : [];
  const lineSum = lines.reduce((s, l) => s + num(l.amount), 0);
  const total = Math.round(num(d.bill_total_extracted) || lineSum);
  const gst = d.gst_amount != null ? Math.round(num(d.gst_amount)) : (total > 0 ? Math.round(total - total / 1.18) : 0);
  return { vendor: d.vendor_name ?? null, billNo: d.bill_number ?? null, billDate: d.bill_date ?? null, total, gst, lines };
}

/** One site's slice of an attached bill: a delivered PO for `projectId` billed `billAmount`, of
 *  which `paidAmount` is covered by this payment (balance = billAmount − paidAmount). Creates an
 *  auto-approved, RECEIVED PO (money + received marker only; no GRN/stock lines beyond the bill
 *  line). Returns the new PO id. */
export async function createDeliveredBillPO(
  txn: TrackTxn, orgId: string,
  row: { projectId: string; name: string; billAmount: number; paidAmount: number; gst?: number; billUrl?: string | null; billNo?: string | null },
): Promise<{ poId: string }> {
  assertLinkable(txn);
  const stakeholderId = txn?.stakeholder_id ?? null;
  const { data: u } = await supabase.auth.getUser();
  const createdBy = u?.user?.id ?? null;
  const items = [{ name: row.name, quantity: 1, rate: row.billAmount, amount: row.billAmount }];
  const lineItems = [{ line_number: 1, item_name: row.name, unit: 'Nos', quantity_ordered: 1, unit_rate: row.billAmount, basic_amount: row.billAmount, discount_percent: 0, discount_amount: 0, gst_rate: 0, cgst: 0, sgst: 0, igst: 0, total_amount: row.billAmount }];
  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_po_data: {
      org_id: orgId, project_id: row.projectId, stakeholder_id: stakeholderId,
      items, order_value: row.billAmount, total_value: row.billAmount, gst_value: row.gst ?? 0,
      status: 'BILLED',
      date_issued: new Date().toISOString().split('T')[0], payment_terms_days: 0, created_by: createdBy,
    },
    p_line_items: lineItems,
  });
  if (error) throw error;
  const res = data as { success?: boolean; error?: string; po_id?: string } | null;
  if (!res?.success || !res.po_id) throw new Error(res?.error ?? 'Could not record the bill');

  // Auto-approve + record the bill amount + set status from paid-vs-bill. We DO NOT mark the goods
  // received here: receipt is a physical event that must be confirmed explicitly at site (the receive
  // wizard on the PO detail page), never assumed just because a payment was recorded.
  const nowIso = new Date().toISOString();
  const status = row.paidAmount >= row.billAmount - 0.005 ? 'PAID' : row.paidAmount > 0 ? 'PARTIAL' : 'BILLED';
  await supabase.from('purchase_orders')
    .update({
      approval_status: 'APPROVED',
      vendor_bill_amount: row.billAmount, bill_recorded_at: nowIso, vendor_bill_date: nowIso.split('T')[0],
      status, created_after_payment: true,
      ...(row.billUrl ? { vendor_bill_url: row.billUrl, vendor_bill_doc_url: row.billUrl } : {}),
      ...(row.billNo ? { vendor_bill_number: row.billNo, vendor_bill_no: row.billNo } : {}),
    })
    .eq('po_id', res.po_id);
  return { poId: res.po_id };
}

/** A PENDING (unpaid) bill on `projectId`: an auto-approved PO carrying the bill amount as an
 *  owed balance, with the bill IMAGE attached — and NOTHING else. NOT delivered (no received
 *  marker) and NO payment allocation, so its full amount stays owed in the PO list. This is the
 *  "one or more projects → separate POs, just a bill picture with a pending amount" case: the
 *  bill total ran ahead of what this payment covered. MONEY + image only; no GRN/stock. */
export async function createPendingBillPO(
  txn: TrackTxn, orgId: string,
  row: { projectId: string; name: string; amount: number; gst?: number; billUrl?: string | null; billNo?: string | null },
): Promise<{ poId: string }> {
  assertLinkable(txn);
  const stakeholderId = txn?.stakeholder_id ?? null;
  const { data: u } = await supabase.auth.getUser();
  const createdBy = u?.user?.id ?? null;
  const items = [{ name: row.name, quantity: 1, rate: row.amount, amount: row.amount }];
  const lineItems = [{ line_number: 1, item_name: row.name, unit: 'Nos', quantity_ordered: 1, unit_rate: row.amount, basic_amount: row.amount, discount_percent: 0, discount_amount: 0, gst_rate: 0, cgst: 0, sgst: 0, igst: 0, total_amount: row.amount }];
  const { data, error } = await supabase.rpc('create_purchase_order', {
    p_po_data: {
      org_id: orgId, project_id: row.projectId, stakeholder_id: stakeholderId,
      items, order_value: row.amount, total_value: row.amount, gst_value: row.gst ?? 0,
      status: 'BILLED',
      date_issued: new Date().toISOString().split('T')[0], payment_terms_days: 0, created_by: createdBy,
    },
    p_line_items: lineItems,
  });
  if (error) throw error;
  const res = data as { success?: boolean; error?: string; po_id?: string } | null;
  if (!res?.success || !res.po_id) throw new Error(res?.error ?? 'Could not record the pending bill');

  // Auto-approve + record the bill amount + attach the image. No received marker (not delivered),
  // no txn allocation (unpaid) — the whole amount reads as owed. bill_recorded_at rides with the
  // amount so the party ledger's credit row keys correctly (see createVendorPurchase note).
  const nowIso = new Date().toISOString();
  await supabase.from('purchase_orders')
    .update({
      approval_status: 'APPROVED',
      vendor_bill_amount: row.amount, bill_recorded_at: nowIso, vendor_bill_date: nowIso.split('T')[0],
      status: 'BILLED', created_after_payment: true,
      ...(row.billUrl ? { vendor_bill_url: row.billUrl, vendor_bill_doc_url: row.billUrl } : {}),
      ...(row.billNo ? { vendor_bill_number: row.billNo, vendor_bill_no: row.billNo } : {}),
    })
    .eq('po_id', res.po_id);
  return { poId: res.po_id };
}

/** Book the payment across every site/PO of an attached bill IN ONE ATOMIC RE-SPLIT. Each part is a
 *  slice of THIS payment placed on a PO (order_type 'PO'); the parts must sum to the payment total.
 *  Uses set_txn_allocations (multi-project). MONEY ONLY. */
export async function commitBillSplit(
  txn: TrackTxn, orgId: string,
  parts: Array<{ projectId: string; poId: string; amount: number }>,
): Promise<void> {
  assertLinkable(txn);
  const txnId = txn?.txn_id;
  if (!txnId) throw new Error('This payment has no id.');
  const poParts = parts
    .filter((p) => p.amount > 0 && p.projectId && p.poId)
    .map((p) => ({ project_id: p.projectId, order_type: 'PO', order_ref: p.poId, milestone_id: null, allocated_amount: Math.round(p.amount) }));

  // The RPC replaces ALL of this payment's allocations and the schema requires them to sum to the
  // payment total. If the paid parts don't cover the whole payment (e.g. some was held as an advance
  // when the payment was recorded), keep that remainder as an ADVANCE so the sum-check holds and the
  // advance money isn't silently reassigned to a bill.
  const allParts: Array<{ project_id: string | null; order_type: string; order_ref: string | null; milestone_id: null; allocated_amount: number }> = [...poParts];
  const total = Math.round(num(txn.total_amount));
  const leftover = total - poParts.reduce((s, p) => s + p.allocated_amount, 0);
  if (leftover > 0.5) allParts.push({ project_id: null, order_type: 'ADVANCE', order_ref: null, milestone_id: null, allocated_amount: leftover });

  const { data, error } = await supabase.rpc('set_txn_allocations', {
    p_txn_id: txnId, p_org_id: orgId, p_parts: allParts,
  });
  if (error) throw error;
  const res = data as { success?: boolean; error?: string } | null;
  if (!res?.success) throw new Error(res?.error ?? 'Could not book the payment');
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
  assertLinkable(txn);
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
  //
  // bill_recorded_at RIDES WITH THE AMOUNT, ALWAYS. This was the only writer of vendor_bill_amount
  // that left the timestamp null (RecordBillSheet, PurchaseOrderDetail and ProjectPurchaseOrders
  // all set it), and a bill with an amount but no date is invisible to the party ledger: its credit
  // row is keyed on this timestamp, so `if (!po.bill_recorded_at) continue` silently dropped the
  // purchase. Net Balance then read as (0 − every payment), which is how Pattabhi Traders showed
  // "Advance Dr ₹1,28,014.96" while the tile beside it said ₹33,375 of bills were recorded.
  // An amount without a date is not a record of anything.
  const billedAt = new Date().toISOString();
  await supabase.from('purchase_orders')
    .update({
      approval_status: 'APPROVED',
      ...(b.hasBill ? { vendor_bill_amount: b.amount, bill_recorded_at: billedAt, vendor_bill_date: billedAt.split('T')[0] } : {}),
    })
    .eq('po_id', res.po_id);
  return { poId: res.po_id };
}

/** Record the payment: place the amounts the user set on each PO (txn_allocations
 *  order_type 'PO'), and park any leftover as an ADVANCE. The POs already exist (existing
 *  bills + purchases created on add). Sum of allocations equals the payment, so the
 *  project total on the existing allocation is preserved. MONEY ONLY. */
export async function commitVendorPayment(txn: TrackTxn, orgId: string, input: VendorCommitInput): Promise<void> {
  assertLinkable(txn);
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
