// Bills — the vendor-bill register, read over TODAY's data (frontend-first; no `bills` table yet).
// A "bill" is assembled from the two places a vendor bill lives now:
//   · a PO's recorded bill  (purchase_orders.vendor_bill_amount, APPROVED + not cancelled)
//   · a consolidated bill    (consolidated_bills — a period bill, no single PO)
// Shaped to be forward-compatible with the planned first-class `bills` entity (a bill optionally
// names one PO; payments settle bills). Settlement is DERIVED from existing allocations:
//   · PO bill      → payments allocated to that PO (txn_allocations, non-voided)
//   · consolidated → the vendor's covered payments inside the period (no PO/WO allocation)
import { supabase } from './supabase';
import { billDateOf, BILL_DATE_COLUMNS } from './partyLedger';
import { readVendorBill, uploadBillDoc } from './vendorTrackingApi';

export type BillStatus = 'unpaid' | 'part' | 'settled';
export type BillRef =
  | { kind: 'po'; poId: string }
  | { kind: 'consolidated'; label: string }
  | { kind: 'none' };

export interface BillRow {
  id: string;                 // 'po~<poId>' | 'cb~<uuid>' — the detail key
  kind: 'po' | 'consolidated';
  vendorId: string | null;
  vendor: string;
  billNo: string | null;
  billDate: string | null;
  projectId: string | null;
  site: string | null;
  amount: number;
  paid: number;
  status: BillStatus;
  ref: BillRef;
}

export interface BillLine { name: string; spec: string | null; unit: string | null; qty: number; rate: number; amount: number }
export interface BillPayment { txnId: string; date: string | null; mode: string | null; amount: number }
export interface BillDetail extends BillRow {
  docUrl: string | null;
  lines: BillLine[];
  payments: BillPayment[];
  poId: string | null;
  poProjectId: string | null;
  periodFrom?: string; periodTo?: string; note?: string;
}

const num = (v: any) => Number(v) || 0;
const statusOf = (amount: number, paid: number): BillStatus =>
  paid >= amount - 0.5 ? 'settled' : paid > 0.5 ? 'part' : 'unpaid';

// ── list ─────────────────────────────────────────────────────────────────────
export async function loadBills(): Promise<BillRow[]> {
  const [billsR, poR, stkR, projR, cbR] = await Promise.all([
    supabase.from('bills').select('id, stakeholder_id, project_id, po_id, bill_no, bill_date, amount, created_at'),
    supabase.from('purchase_orders')
      .select(`po_id, stakeholder_id, project_id, vendor_bill_number, ${BILL_DATE_COLUMNS}, status, approval_status`)
      .eq('approval_status', 'APPROVED')
      .not('status', 'in', '("CANCELLED","Cancelled","cancelled")')
      .not('vendor_bill_amount', 'is', null).gt('vendor_bill_amount', 0),
    supabase.from('stakeholders').select('stakeholder_id, name'),
    supabase.from('projects').select('project_id, name'),
    supabase.from('consolidated_bills').select('id, stakeholder_id, period_from, period_to, amount, note'),
  ]);
  if (poR.error) throw poR.error;
  const billRows = (billsR.data ?? []) as any[];   // first-class bills (empty if migration not applied)
  // A PO named by a bills row is represented by that bill, not its own PO-bill row — suppress the dup.
  const billedPoIds = new Set(billRows.map(b => b.po_id).filter(Boolean));
  const pos = ((poR.data ?? []) as any[]).filter(p => !billedPoIds.has(p.po_id));
  const cbs = (cbR.data ?? []) as any[];
  const stkName: Record<string, string> = {}; (stkR.data ?? []).forEach((s: any) => { stkName[s.stakeholder_id] = s.name; });
  const projName: Record<string, string> = {}; (projR.data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; });

  // Per-bill paid — the RECORDED fact: payment→bill allocations (bill_id), non-voided.
  const paidByBill: Record<string, number> = {};
  if (billRows.length) {
    const bR = await supabase.from('txn_allocations').select('bill_id, allocated_amount, transactions(status)').in('bill_id', billRows.map(b => b.id));
    (bR.data ?? []).forEach((a: any) => { if (a.transactions?.status === 'Voided' || !a.bill_id) return; paidByBill[a.bill_id] = (paidByBill[a.bill_id] || 0) + num(a.allocated_amount); });
  }
  // Payments allocated to each PO (non-voided) — only the fallback PO-bills still settle via the PO.
  const poIds = [...new Set(pos.map(p => p.po_id))];
  const paidByPo: Record<string, number> = {};
  if (poIds.length) {
    const alR = await supabase.from('txn_allocations').select('order_ref, allocated_amount, transactions(status)').eq('order_type', 'PO').in('order_ref', poIds);
    (alR.data ?? []).forEach((a: any) => { if (a.transactions?.status === 'Voided') return; paidByPo[a.order_ref] = (paidByPo[a.order_ref] || 0) + num(a.allocated_amount); });
  }

  // Covered payments per consolidated bill: the vendor's non-voided txns inside the period with no
  // PO/WO allocation (same rule the party ledger uses to mark a payment "covered").
  const paidByCb: Record<string, number> = {};
  if (cbs.length) {
    const vids = [...new Set(cbs.map(c => c.stakeholder_id))];
    const txR = await supabase.from('transactions').select('txn_id, stakeholder_id, date, total_amount, status, txn_allocations(order_type)').in('stakeholder_id', vids);
    const vendorTxns = (txR.data ?? []).filter((t: any) => t.status !== 'Voided'
      && !((t.txn_allocations ?? []).some((a: any) => a.order_type === 'PO' || a.order_type === 'WO')));
    for (const cb of cbs) {
      paidByCb[cb.id] = vendorTxns
        .filter((t: any) => t.stakeholder_id === cb.stakeholder_id && t.date && t.date >= cb.period_from && t.date <= cb.period_to)
        .reduce((s: number, t: any) => s + num(t.total_amount), 0);
    }
  }

  const rows: BillRow[] = [];
  // First-class bills — paid from recorded payment→bill allocations.
  for (const b of billRows) {
    const amount = num(b.amount);
    const paid = Math.min(amount, paidByBill[b.id] || 0);
    rows.push({
      id: `bl~${b.id}`, kind: 'po', vendorId: b.stakeholder_id ?? null, vendor: stkName[b.stakeholder_id] || 'Vendor',
      billNo: b.bill_no || null, billDate: b.bill_date || (b.created_at ? String(b.created_at).slice(0, 10) : null),
      projectId: b.project_id ?? null, site: b.project_id ? (projName[b.project_id] || b.project_id) : null,
      amount, paid, status: statusOf(amount, paid),
      ref: b.po_id ? { kind: 'po', poId: b.po_id } : { kind: 'none' },
    });
  }
  for (const p of pos) {
    const amount = num(p.vendor_bill_amount);
    const paid = Math.min(amount, paidByPo[p.po_id] || 0);
    rows.push({
      id: `po~${p.po_id}`, kind: 'po', vendorId: p.stakeholder_id ?? null, vendor: stkName[p.stakeholder_id] || 'Vendor',
      billNo: p.vendor_bill_number || null, billDate: billDateOf(p), projectId: p.project_id ?? null,
      site: p.project_id ? (projName[p.project_id] || p.project_id) : null,
      amount, paid, status: statusOf(amount, paid), ref: { kind: 'po', poId: p.po_id },
    });
  }
  const fmtP = (d: string) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
  for (const cb of cbs) {
    const amount = num(cb.amount);
    const paid = Math.min(amount, paidByCb[cb.id] || 0);
    rows.push({
      id: `cb~${cb.id}`, kind: 'consolidated', vendorId: cb.stakeholder_id ?? null, vendor: stkName[cb.stakeholder_id] || 'Vendor',
      billNo: null, billDate: cb.period_to, projectId: null, site: null,
      amount, paid, status: statusOf(amount, paid),
      ref: { kind: 'consolidated', label: `Consolidated ${fmtP(cb.period_from)}–${fmtP(cb.period_to)}` },
    });
  }
  // Newest first.
  return rows.sort((a, b) => (b.billDate || '').localeCompare(a.billDate || ''));
}

// ── detail ───────────────────────────────────────────────────────────────────
export async function loadBillDetail(id: string): Promise<BillDetail | null> {
  const sep = id.indexOf('~');
  const kind = id.slice(0, sep), ref = id.slice(sep + 1);

  if (kind === 'bl') {
    const bR = await supabase.from('bills').select('*').eq('id', ref).maybeSingle();
    const b = bR.data as any; if (!b) return null;
    const [stk, proj, alR] = await Promise.all([
      supabase.from('stakeholders').select('name').eq('stakeholder_id', b.stakeholder_id).maybeSingle(),
      b.project_id ? supabase.from('projects').select('name').eq('project_id', b.project_id).maybeSingle() : Promise.resolve({ data: null } as any),
      supabase.from('txn_allocations').select('allocated_amount, transactions(txn_id, date, payment_mode, status)').eq('bill_id', ref),
    ]);
    const allocs = ((alR.data ?? []) as any[]).filter(a => a.transactions?.status !== 'Voided');
    const payments: BillPayment[] = allocs.map(a => ({ txnId: a.transactions?.txn_id, date: a.transactions?.date ?? null, mode: a.transactions?.payment_mode ?? null, amount: num(a.allocated_amount) }))
      .sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    const amount = num(b.amount);
    const paid = Math.min(amount, payments.reduce((s, x) => s + x.amount, 0));
    const lines: BillLine[] = Array.isArray(b.lines) ? b.lines.map((l: any) => ({
      name: l.name ?? l.item ?? '—', spec: l.spec ?? null, unit: l.unit ?? null, qty: num(l.qty), rate: num(l.rate), amount: num(l.amount) || num(l.qty) * num(l.rate),
    })) : [];
    return {
      id, kind: 'po', vendorId: b.stakeholder_id ?? null, vendor: (stk.data as any)?.name || 'Vendor',
      billNo: b.bill_no || null, billDate: b.bill_date || (b.created_at ? String(b.created_at).slice(0, 10) : null),
      projectId: b.project_id ?? null, site: (proj.data as any)?.name || null, amount, paid, status: statusOf(amount, paid),
      ref: b.po_id ? { kind: 'po', poId: b.po_id } : { kind: 'none' }, docUrl: b.doc_url || null,
      lines, payments, poId: b.po_id ?? null, poProjectId: b.project_id ?? null, note: b.note || undefined,
    };
  }

  if (kind === 'po') {
    const [poR, liR] = await Promise.all([
      supabase.from('purchase_orders').select(`po_id, stakeholder_id, project_id, vendor_bill_number, vendor_bill_doc_url, vendor_bill_url, ${BILL_DATE_COLUMNS}, status`).eq('po_id', ref).maybeSingle(),
      supabase.from('po_line_items').select('line_number, item_name, specification, unit, quantity_ordered, unit_rate, total_amount').eq('po_id', ref).order('line_number'),
    ]);
    const p = poR.data as any; if (!p) return null;
    const [stk, proj, alR] = await Promise.all([
      p.stakeholder_id ? supabase.from('stakeholders').select('name').eq('stakeholder_id', p.stakeholder_id).maybeSingle() : Promise.resolve({ data: null } as any),
      p.project_id ? supabase.from('projects').select('name').eq('project_id', p.project_id).maybeSingle() : Promise.resolve({ data: null } as any),
      supabase.from('txn_allocations').select('allocated_amount, transactions(txn_id, date, payment_mode, status)').eq('order_type', 'PO').eq('order_ref', ref),
    ]);
    const allocs = (alR.data ?? []).filter((a: any) => a.transactions?.status !== 'Voided');
    const payments: BillPayment[] = allocs.map((a: any) => ({ txnId: a.transactions?.txn_id, date: a.transactions?.date ?? null, mode: a.transactions?.payment_mode ?? null, amount: num(a.allocated_amount) }))
      .sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    const amount = num(p.vendor_bill_amount);
    const paid = Math.min(amount, payments.reduce((s, x) => s + x.amount, 0));
    const lines: BillLine[] = (liR.data ?? []).map((li: any) => {
      const qty = num(li.quantity_ordered), rate = num(li.unit_rate);
      return { name: li.item_name, spec: li.specification ?? null, unit: li.unit ?? null, qty, rate, amount: num(li.total_amount) || qty * rate };
    });
    return {
      id, kind: 'po', vendorId: p.stakeholder_id ?? null, vendor: (stk.data as any)?.name || 'Vendor',
      billNo: p.vendor_bill_number || null, billDate: billDateOf(p), projectId: p.project_id ?? null,
      site: (proj.data as any)?.name || null, amount, paid, status: statusOf(amount, paid),
      ref: { kind: 'po', poId: p.po_id }, docUrl: p.vendor_bill_doc_url || p.vendor_bill_url || null,
      lines, payments, poId: p.po_id, poProjectId: p.project_id ?? null,
    };
  }

  if (kind === 'cb') {
    const cbR = await supabase.from('consolidated_bills').select('*').eq('id', ref).maybeSingle();
    const cb = cbR.data as any; if (!cb) return null;
    const [stk, txR] = await Promise.all([
      supabase.from('stakeholders').select('name').eq('stakeholder_id', cb.stakeholder_id).maybeSingle(),
      supabase.from('transactions').select('txn_id, date, payment_mode, total_amount, status, txn_allocations(order_type)').eq('stakeholder_id', cb.stakeholder_id),
    ]);
    const covered = (txR.data ?? []).filter((t: any) => t.status !== 'Voided'
      && t.date && t.date >= cb.period_from && t.date <= cb.period_to
      && !((t.txn_allocations ?? []).some((a: any) => a.order_type === 'PO' || a.order_type === 'WO')));
    const payments: BillPayment[] = covered.map((t: any) => ({ txnId: t.txn_id, date: t.date, mode: t.payment_mode ?? null, amount: num(t.total_amount) }))
      .sort((x, y) => (x.date || '').localeCompare(y.date || ''));
    const amount = num(cb.amount);
    const paid = Math.min(amount, payments.reduce((s, x) => s + x.amount, 0));
    const fmtP = (d: string) => new Date(d).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' });
    return {
      id, kind: 'consolidated', vendorId: cb.stakeholder_id ?? null, vendor: (stk.data as any)?.name || 'Vendor',
      billNo: null, billDate: cb.period_to, projectId: null, site: null, amount, paid, status: statusOf(amount, paid),
      ref: { kind: 'consolidated', label: `Consolidated ${fmtP(cb.period_from)}–${fmtP(cb.period_to)}` },
      docUrl: cb.photo_url || null, lines: [], payments, poId: null, poProjectId: null,
      periodFrom: cb.period_from, periodTo: cb.period_to, note: cb.note || undefined,
    };
  }
  return null;
}

// ── minting a bill from an uploaded document ───────────────────────────────────
export interface ExtractedBill {
  vendor: string | null;         // vendor NAME as read (for display; user confirms/links a real party)
  billNo: string | null;
  billDate: string | null;       // ISO if parseable
  amount: number;
  lines: { name: string; spec: string | null; unit: string | null; qty: number; rate: number; amount: number }[];
}

// Read an uploaded bill (image/PDF) with the existing extract-only AI (reconcile-po-bill).
export async function extractBill(file: File): Promise<ExtractedBill> {
  const b64 = await fileToBase64(file);
  const r = await readVendorBill(b64, file.type || 'image/jpeg');
  return {
    vendor: r.vendor, billNo: r.billNo, billDate: normDate(r.billDate), amount: num(r.total),
    lines: (r.lines ?? []).map((l: any) => ({ name: l.item ?? '—', spec: null, unit: l.unit ?? null, qty: num(l.qty), rate: num(l.rate), amount: num(l.amount) || num(l.qty) * num(l.rate) })),
  };
}

// Same vendor + same bill number already on a bill → the duplicate to warn about before minting.
export interface DuplicateBill { id: string; billNo: string | null; billDate: string | null; amount: number }
export async function findDuplicateBill(stakeholderId: string, billNo: string): Promise<DuplicateBill | null> {
  const n = (billNo || '').trim();
  if (!n) return null;
  const { data } = await supabase.from('bills').select('id, bill_no, bill_date, amount').eq('stakeholder_id', stakeholderId).ilike('bill_no', n).limit(1);
  const b = (data ?? [])[0] as any;
  return b ? { id: b.id, billNo: b.bill_no, billDate: b.bill_date, amount: num(b.amount) } : null;
}

export interface NewBillInput {
  orgId: string; stakeholderId: string; projectId: string | null; poId?: string | null;
  billNo: string | null; billDate: string | null; amount: number;
  lines: ExtractedBill['lines']; note?: string | null; createdBy?: string | null; createdByName?: string | null;
  file: File | null;
}
export async function createBill(input: NewBillInput): Promise<string> {
  const docUrl = input.file ? await uploadBillDoc(input.file, 'bill') : null;
  const { data, error } = await supabase.from('bills').insert({
    org_id: input.orgId, stakeholder_id: input.stakeholderId, project_id: input.projectId, po_id: input.poId ?? null,
    bill_no: input.billNo, bill_date: input.billDate, amount: input.amount, doc_url: docUrl,
    lines: input.lines, note: input.note ?? null, created_by: input.createdBy ?? null, created_by_name: input.createdByName ?? null,
  }).select('id').single();
  if (error) throw error;
  return (data as any).id;
}

// ── payment → bill allocation (the tx "attach bill" picker) ────────────────────
// A pickable bill is either a first-class bills row ('bill') or an OLD PO-recorded bill still living on
// the PO ('po') — so a payment can settle both. Settling a 'bill' writes bill_id; a 'po' writes the
// legacy order_type='PO' allocation.
export interface UnpaidBill { id: string; kind: 'bill' | 'po'; billNo: string | null; billDate: string | null; amount: number; paid: number; remaining: number; projectId: string | null; site: string | null; docUrl: string | null }

export async function loadUnpaidBillsForVendor(stakeholderId: string): Promise<UnpaidBill[]> {
  const [bR, projR, poR] = await Promise.all([
    supabase.from('bills').select('id, project_id, bill_no, bill_date, amount, doc_url, created_at').eq('stakeholder_id', stakeholderId),
    supabase.from('projects').select('project_id, name'),
    supabase.from('purchase_orders').select(`po_id, project_id, vendor_bill_number, vendor_bill_doc_url, vendor_bill_url, ${BILL_DATE_COLUMNS}, status, approval_status`)
      .eq('stakeholder_id', stakeholderId).eq('approval_status', 'APPROVED')
      .not('status', 'in', '("CANCELLED","Cancelled","cancelled")').not('vendor_bill_amount', 'is', null).gt('vendor_bill_amount', 0),
  ]);
  const billRows = (bR.data ?? []) as any[];
  const projName: Record<string, string> = {}; (projR.data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; });

  // A PO named by a bills row is represented by that bill — don't also list the PO's own fallback bill.
  const billedPoIds = new Set(billRows.map(b => b.po_id).filter(Boolean));
  const pos = ((poR.data ?? []) as any[]).filter(p => !billedPoIds.has(p.po_id));

  // paid per first-class bill (bill_id) and per PO (order_type='PO').
  const paidByBill: Record<string, number> = {};
  if (billRows.length) {
    const alR = await supabase.from('txn_allocations').select('bill_id, allocated_amount, transactions(status)').in('bill_id', billRows.map(b => b.id));
    (alR.data ?? []).forEach((a: any) => { if (a.transactions?.status === 'Voided' || !a.bill_id) return; paidByBill[a.bill_id] = (paidByBill[a.bill_id] || 0) + num(a.allocated_amount); });
  }
  const paidByPo: Record<string, number> = {};
  if (pos.length) {
    const alR = await supabase.from('txn_allocations').select('order_ref, allocated_amount, transactions(status)').eq('order_type', 'PO').in('order_ref', pos.map(p => p.po_id));
    (alR.data ?? []).forEach((a: any) => { if (a.transactions?.status === 'Voided') return; paidByPo[a.order_ref] = (paidByPo[a.order_ref] || 0) + num(a.allocated_amount); });
  }

  const out: UnpaidBill[] = [];
  for (const b of billRows) {
    const amount = num(b.amount), paid = Math.min(amount, paidByBill[b.id] || 0);
    out.push({ id: b.id, kind: 'bill', billNo: b.bill_no || null, billDate: b.bill_date || (b.created_at ? String(b.created_at).slice(0, 10) : null), amount, paid, remaining: amount - paid, projectId: b.project_id ?? null, site: b.project_id ? (projName[b.project_id] || b.project_id) : null, docUrl: b.doc_url || null });
  }
  for (const p of pos) {
    const amount = num(p.vendor_bill_amount), paid = Math.min(amount, paidByPo[p.po_id] || 0);
    out.push({ id: p.po_id, kind: 'po', billNo: p.vendor_bill_number || p.po_id, billDate: billDateOf(p), amount, paid, remaining: amount - paid, projectId: p.project_id ?? null, site: p.project_id ? (projName[p.project_id] || p.project_id) : null, docUrl: p.vendor_bill_doc_url || p.vendor_bill_url || null });
  }
  return out.filter(b => b.remaining > 0.5).sort((a, b) => (a.billDate || '').localeCompare(b.billDate || '')); // oldest first
}

// Record a payment's bill allocation. Replaces the txn's full allocation set (must sum to its total):
// each selected bill → an allocation carrying the bill's site; any remainder (payment larger than the
// bills, or "no bill") → one unallocated part = the without-bills / advance bucket.
export interface BillPick { id: string; kind: 'bill' | 'po'; projectId: string | null; amount: number }
export async function saveBillAllocations(txnId: string, orgId: string, txnTotal: number, picks: BillPick[], remainderProjectId: string | null): Promise<void> {
  const parts: any[] = picks.filter(p => p.amount > 0).map(p => p.kind === 'po'
    ? { project_id: p.projectId ?? '', order_type: 'PO', order_ref: p.id, milestone_id: '', bill_id: '', allocated_amount: p.amount }
    : { project_id: p.projectId ?? '', order_type: '', order_ref: '', milestone_id: '', bill_id: p.id, allocated_amount: p.amount });
  const allocated = picks.reduce((s, p) => s + (p.amount > 0 ? p.amount : 0), 0);
  const remainder = Math.round((txnTotal - allocated) * 100) / 100;
  if (remainder > 0.5) parts.push({ project_id: remainderProjectId ?? '', order_type: '', order_ref: '', milestone_id: '', bill_id: '', allocated_amount: remainder });
  // Nothing picked at all → a single unallocated part (keeps the txn total intact; the without-bills bucket).
  if (parts.length === 0) parts.push({ project_id: remainderProjectId ?? '', order_type: '', order_ref: '', milestone_id: '', bill_id: '', allocated_amount: txnTotal });
  const { data, error } = await supabase.rpc('set_txn_allocations', { p_txn_id: txnId, p_org_id: orgId, p_parts: parts });
  const r = data as { success?: boolean; error?: string } | null;
  if (error || !r?.success) throw new Error(r?.error || error?.message || 'Could not record the allocation');
}

// The inert "towards PO-xxx" advance memo — pure tracking on the transaction, never a money link.
export async function setAdvanceMemo(txnId: string, poRef: string | null): Promise<void> {
  const { error } = await supabase.from('transactions').update({ advance_po_ref: poRef || null }).eq('txn_id', txnId);
  if (error) throw error;
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}
// The AI returns a human date string; keep only a clean ISO yyyy-mm-dd (or null).
function normDate(d: string | null): string | null {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(t.getTime()) ? null : t.toISOString().slice(0, 10);
}
