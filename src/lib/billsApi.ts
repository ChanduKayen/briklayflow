// Bills — the vendor-bill register, read over TODAY's data (frontend-first; no `bills` table yet).
// A "bill" is assembled from the two places a vendor bill lives now:
//   · a PO's recorded bill  (purchase_orders.vendor_bill_amount, APPROVED + not cancelled)
//   · a consolidated bill    (consolidated_bills — a period bill, no single PO)
// Shaped to be forward-compatible with the planned first-class `bills` entity (a bill optionally
// names one PO; payments settle bills). Settlement is DERIVED from existing allocations:
//   · PO bill      → payments allocated to that PO (txn_allocations, non-voided)
//   · consolidated → the vendor's covered payments inside the period (no PO/WO allocation)
import { supabase } from './supabase';
import { rankLoosePayments, linkParts } from './billPayMath';
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
  /** The bill's own photo/PDF, when one was filed with it. The phone's list shows it. */
  docUrl: string | null;
  /** How many separate invoices this one upload turned out to hold (1 for the ordinary case).
   *  The reader tags each line with the invoice it came from, so counting those tags is the
   *  honest answer — a "×3" on a row means three invoices really are inside that paper. */
  docCount: number;
}

export interface BillLine { name: string; spec: string | null; unit: string | null; qty: number; rate: number; amount: number }
export interface BillPayment { txnId: string; date: string | null; mode: string | null; amount: number }
export interface BillDetail extends BillRow {
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
/**
 * How many separate invoices one filed paper turned out to hold.
 *
 * The reader tags every line with the invoice it came from (`spec: "Bill 3445"`), because one
 * upload from a vendor is routinely three tax invoices in one PDF. Counting the distinct tags is
 * the only honest source for the "×3" a row wears — the bill NUMBER can't be counted on, since a
 * single invoice numbered SVD/26-27-1358 has slashes of its own.
 */
function invoiceCount(lines: unknown): number {
  if (!Array.isArray(lines)) return 1;
  const tags = new Set<string>();
  for (const l of lines as Array<Record<string, unknown>>) {
    const spec = typeof l?.spec === 'string' ? l.spec.trim() : '';
    if (spec) tags.add(spec);
  }
  return Math.max(1, tags.size);
}

export async function loadBills(): Promise<BillRow[]> {
  const [billsR, poR, stkR, projR, cbR] = await Promise.all([
    supabase.from('bills').select('id, stakeholder_id, project_id, po_id, bill_no, bill_date, amount, created_at, doc_url, lines'),
    supabase.from('purchase_orders')
      .select(`po_id, stakeholder_id, project_id, vendor_bill_number, vendor_bill_doc_url, vendor_bill_url, ${BILL_DATE_COLUMNS}, status, approval_status`)
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
      docUrl: b.doc_url || null, docCount: invoiceCount(b.lines),
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
      docUrl: p.vendor_bill_doc_url || p.vendor_bill_url || null, docCount: 1,
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
      docUrl: null, docCount: 1,
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
      ref: b.po_id ? { kind: 'po', poId: b.po_id } : { kind: 'none' },
      docUrl: b.doc_url || null, docCount: invoiceCount(lines),
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
      ref: { kind: 'po', poId: p.po_id },
      docUrl: p.vendor_bill_doc_url || p.vendor_bill_url || null, docCount: 1,
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
      docUrl: cb.photo_url || null, docCount: 1, lines: [], payments, poId: null, poProjectId: null,
      periodFrom: cb.period_from, periodTo: cb.period_to, note: cb.note || undefined,
    };
  }
  return null;
}

// Delete a bill. A first-class bill (bl~) is removed and any payment allocated to it is freed back to
// unallocated (txn_allocations.bill_id → NULL via the FK, so the payment reverts to an advance). A
// legacy PO-column bill (po~) clears the PO's bill fields. A consolidated bill (cb~) deletes its row.
// The vendor's balance re-derives automatically (the bill leaves v_party_ledger_line).
export async function deleteBill(id: string): Promise<void> {
  const sep = id.indexOf('~');
  const kind = sep >= 0 ? id.slice(0, sep) : 'bl';
  const ref = sep >= 0 ? id.slice(sep + 1) : id;
  if (kind === 'bl') {
    const { error } = await supabase.from('bills').delete().eq('id', ref);
    if (error) throw error;
  } else if (kind === 'po') {
    const { error } = await supabase.from('purchase_orders')
      .update({ vendor_bill_amount: null, vendor_bill_number: null, vendor_bill_date: null, vendor_bill_doc_url: null, vendor_bill_url: null })
      .eq('po_id', ref);
    if (error) throw error;
  } else if (kind === 'cb') {
    const { error } = await supabase.from('consolidated_bills').delete().eq('id', ref);
    if (error) throw error;
  }
}

// A vendor's bills as ledger lines (for the new-engine reader, which reads ledger_credits and would
// otherwise never show a first-class bill). Paid per bill comes from bill_id allocations.
export interface VendorBillLine { id: string; billNo: string | null; billDate: string | null; amount: number; paid: number; projectId: string | null; projectName: string | null }
export async function loadVendorBills(stakeholderId: string): Promise<VendorBillLine[]> {
  const { data } = await supabase.from('bills').select('id, project_id, bill_no, bill_date, amount, created_at').eq('stakeholder_id', stakeholderId);
  const rows = (data ?? []) as any[];
  if (!rows.length) return [];
  const pids = [...new Set(rows.map(b => b.project_id).filter(Boolean))];
  const projName: Record<string, string> = {};
  if (pids.length) { const pr = await supabase.from('projects').select('project_id, name').in('project_id', pids); (pr.data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; }); }
  const paidByBill: Record<string, number> = {};
  const alR = await supabase.from('txn_allocations').select('bill_id, allocated_amount, transactions(status)').in('bill_id', rows.map(b => b.id));
  (alR.data ?? []).forEach((a: any) => { if (a.transactions?.status === 'Voided' || !a.bill_id) return; paidByBill[a.bill_id] = (paidByBill[a.bill_id] || 0) + num(a.allocated_amount); });
  return rows.map(b => ({
    id: b.id, billNo: b.bill_no || null, billDate: b.bill_date || (b.created_at ? String(b.created_at).slice(0, 10) : null),
    amount: num(b.amount), paid: Math.min(num(b.amount), paidByBill[b.id] || 0),
    projectId: b.project_id ?? null, projectName: b.project_id ? (projName[b.project_id] || b.project_id) : null,
  }));
}

// ── PO-linked bills (the PO detail shows links to these; billed = Σ) ───────────
export interface PoBill { id: string; billNo: string | null; billDate: string | null; amount: number; docUrl: string | null; lines: any[] }
export async function loadBillsForPO(poId: string): Promise<PoBill[]> {
  const { data } = await supabase.from('bills').select('id, bill_no, bill_date, amount, doc_url, lines, created_at').eq('po_id', poId).order('bill_date', { ascending: true });
  return ((data ?? []) as any[]).map(b => ({ id: b.id, billNo: b.bill_no || null, billDate: b.bill_date || (b.created_at ? String(b.created_at).slice(0, 10) : null), amount: num(b.amount), docUrl: b.doc_url || null, lines: Array.isArray(b.lines) ? b.lines : [] }));
}
// Paid per BILL for a PO's bills (Σ non-voided txn_allocations.bill_id) — the per-bill balance rollup the
// PO detail shows. Keyed by bill id. Plus the PO's rolled-up total (v_po_paid: de-duplicated over
// bill_id ∪ order_type='PO'), so the PO reflects payments made against its bills even without a direct link.
export async function poPaidRollup(_poId: string, billIds: string[]): Promise<{ total: number; perBill: Record<string, number> }> {
  // A PO's paid rolls up strictly from ITS BILLS (txn_allocations.bill_id). A payment recorded straight
  // against the PO (order_type='PO') with NO bill is an ADVANCE — it belongs to the vendor's ledger, not to
  // "bill paid", and counting it made the PO read "₹120 paid" while its ₹200 bill sat fully due. So: only
  // bill payments count here, keeping the PO's paid, its per-bill balances, and its status all consistent.
  const perBill: Record<string, number> = {};
  if (billIds.length) {
    const { data } = await supabase.from('txn_allocations')
      .select('bill_id, allocated_amount, transactions(status)').in('bill_id', billIds);
    (data ?? []).forEach((a: any) => { if (a.transactions?.status === 'Voided' || !a.bill_id) return; perBill[a.bill_id] = (perBill[a.bill_id] || 0) + num(a.allocated_amount); });
  }
  const total = Object.values(perBill).reduce((s, v) => s + v, 0);
  return { total, perBill };
}

// Σ billed per PO, for a batch of POs (the PO list). Only counts first-class bills.
export async function billedByPO(poIds: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  if (!poIds.length) return out;
  const { data } = await supabase.from('bills').select('po_id, amount').in('po_id', poIds);
  (data ?? []).forEach((b: any) => { if (b.po_id) out[b.po_id] = (out[b.po_id] || 0) + num(b.amount); });
  return out;
}

// Convert-on-view: a legacy PO bill (vendor_bill_amount on the PO, no bill entity yet) becomes a
// first-class bills entity so every PO is uniform (a link to its bill). Idempotent — only mints when
// the PO carries a bill amount and no bills row names it. Returns true if it minted one.
export async function convertLegacyPoBill(po: { po_id: string; org_id: string; stakeholder_id: string | null; project_id: string | null; vendor_bill_amount: number | null; vendor_bill_number?: string | null; vendor_bill_date?: string | null; bill_recorded_at?: string | null; date_issued?: string | null; vendor_bill_doc_url?: string | null; vendor_bill_url?: string | null }): Promise<boolean> {
  if (!po.stakeholder_id || !(num(po.vendor_bill_amount) > 0)) return false;
  const existing = await supabase.from('bills').select('id').eq('po_id', po.po_id).limit(1);
  if ((existing.data ?? []).length) return false;
  const { error } = await supabase.from('bills').insert({
    org_id: po.org_id, stakeholder_id: po.stakeholder_id, project_id: po.project_id, po_id: po.po_id,
    bill_no: po.vendor_bill_number ?? null, bill_date: billDateOf(po as any), amount: num(po.vendor_bill_amount),
    doc_url: po.vendor_bill_doc_url || po.vendor_bill_url || null, lines: [], note: 'Migrated from the PO',
  });
  return !error;
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
    // A vendor's "bill" is routinely one PDF holding three tax invoices. Keep which invoice each
    // line came from — otherwise three identical cement lines read as one line entered twice.
    lines: (r.lines ?? []).map((l: any) => ({
      name: l.item ?? '—',
      spec: l.source_doc ? `Bill ${String(l.source_doc).replace(/^bill\s*/i, '')}` : null,
      unit: l.unit ?? null, qty: num(l.qty), rate: num(l.rate),
      amount: num(l.amount) || num(l.qty) * num(l.rate),
    })),
  };
}

// A bill already on file that fingerprints to the same document → warn (and offer to link) before minting.
export interface DuplicateBill { id: string; stakeholderId: string | null; vendorName: string | null; billNo: string | null; billDate: string | null; amount: number; via: 'number' | 'name' | 'amount' }
// Normalise a bill number so formatting/OCR variance can't hide a match: "SDS/1142", "sds 1142",
// "SDS-1142" all fingerprint to "SDS1142".
const normNo = (s: any) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
// Normalise a vendor/header name to a token bag: lowercased words, common suffixes dropped, so
// "M/s ACME Traders." ≈ "acme traders" ≈ "Acme Traders Pvt Ltd".
const NAME_STOP = new Set(['ms', 'm/s', 'the', 'pvt', 'private', 'ltd', 'limited', 'llp', 'co', 'company', 'traders', 'trader', 'trading', 'enterprises', 'enterprise', 'associates', 'agencies', 'agency', 'suppliers', 'supplier', 'industries', 'and']);
const nameTokens = (s: any): string[] => String(s ?? '').toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(w => w.length > 1 && !NAME_STOP.has(w));
function nameMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const ta = nameTokens(a), tb = nameTokens(b);
  if (!ta.length || !tb.length) return false;
  const setB = new Set(tb);
  const overlap = ta.filter(t => setB.has(t)).length;
  // one name's meaningful words are essentially contained in the other's (either direction)
  return overlap >= Math.min(ta.length, tb.length);
}

// Is this DOCUMENT already on file anywhere in the org? Dedupe is org-wide, not per-vendor: the same
// paper reaches us through two doors that can link it to two DIFFERENT vendor rows, so keying on the
// linked stakeholder would miss it. Three fingerprints, strongest first:
//   (1) same NORMALISED bill number, when the number is specific enough to be an identity (≥4 chars);
//   (2) same VENDOR HEADER NAME + same amount (±₹1) + near date (±5 days) — catches the two-doors case
//       above and a re-upload whose number read differently;
//   (3) same amount (±₹1) + near date (±5 days) alone — the weakest, last-resort catch.
// Warns, never blocks (the door lets the user add it anyway, or link to the existing one).
export async function findDuplicateBill(fp: { orgId: string; billNo?: string | null; amount?: number; billDate?: string | null; vendorName?: string | null }): Promise<DuplicateBill | null> {
  if (!fp.orgId) return null;
  const { data } = await supabase.from('bills').select('id, stakeholder_id, vendor_name, bill_no, bill_date, amount, stakeholders(name)').eq('org_id', fp.orgId);
  const rows = (data ?? []) as any[];
  if (!rows.length) return null;
  const headerOf = (b: any): string | null => b.vendor_name || b.stakeholders?.name || null;
  const toDup = (b: any, via: 'number' | 'name' | 'amount'): DuplicateBill => ({ id: b.id, stakeholderId: b.stakeholder_id ?? null, vendorName: headerOf(b), billNo: b.bill_no, billDate: b.bill_date, amount: num(b.amount), via });

  const nkey = normNo(fp.billNo);
  if (nkey.length >= 4) {
    const hit = rows.find(b => { const k = normNo(b.bill_no); return k && k === nkey; });
    if (hit) return toDup(hit, 'number');
  }
  const amt = num(fp.amount);
  const t = fp.billDate ? Date.parse(fp.billDate) : NaN;
  const nearAmtDate = (b: any) => Math.abs(num(b.amount) - amt) < 1
    && (isNaN(t) || !b.bill_date || Math.abs(Date.parse(b.bill_date) - t) <= 5 * 864e5);
  if (amt > 0.5) {
    if (fp.vendorName) {
      const hit = rows.find(b => nearAmtDate(b) && nameMatch(headerOf(b), fp.vendorName));
      if (hit) return toDup(hit, 'name');
    }
    const hit = rows.find(nearAmtDate);
    if (hit) return toDup(hit, 'amount');
  }
  return null;
}

export interface NewBillInput {
  orgId: string; stakeholderId: string; projectId: string | null; poId?: string | null;
  billNo: string | null; billDate: string | null; amount: number; vendorName?: string | null;
  lines: ExtractedBill['lines']; note?: string | null; createdBy?: string | null; createdByName?: string | null;
  file: File | null;
  docUrl?: string | null;   // an ALREADY-uploaded document (e.g. a WhatsApp-staged bill's raw_image_url) — used when file is null
}
export async function createBill(input: NewBillInput): Promise<string> {
  const docUrl = input.file ? await uploadBillDoc(input.file, 'bill') : (input.docUrl ?? null);
  const { data, error } = await supabase.from('bills').insert({
    org_id: input.orgId, stakeholder_id: input.stakeholderId, project_id: input.projectId, po_id: input.poId ?? null,
    bill_no: input.billNo, bill_date: input.billDate, amount: input.amount, doc_url: docUrl, vendor_name: input.vendorName ?? null,
    lines: input.lines, note: input.note ?? null, created_by: input.createdBy ?? null, created_by_name: input.createdByName ?? null,
  }).select('id').single();
  if (error) throw error;
  return (data as any).id;
}

export interface AttachBillRow {
  id: string; billNo: string | null; billDate: string | null; amount: number; docUrl: string | null;
  projectId: string | null; projectName: string | null; vendorId: string | null; vendorName: string | null;
  linked: boolean; poId: string | null; paid: number; remaining: number;
}

/** ALL of the org's bills for the PO's "Bills" popup — every vendor, with each bill's paid/remaining and
 *  whether it's already on a PO (`linked`). The popup filters by site + payee and hides attached/settled ones
 *  by default; the caller passes the PO's site + vendor as the default filters. Newest first. */
export async function getBillsForAttach(orgId: string): Promise<AttachBillRow[]> {
  const { data, error } = await supabase.from('bills')
    .select('id, bill_no, bill_date, amount, doc_url, project_id, po_id, stakeholder_id, created_at, projects(name), stakeholders(name)')
    .eq('org_id', orgId)
    .order('bill_date', { ascending: false }).order('created_at', { ascending: false });
  if (error) throw error;
  const rows = (data ?? []) as any[];
  const ids = rows.map((b) => b.id);
  const paidBy: Record<string, number> = {};
  if (ids.length) {
    const { data: al } = await supabase.from('txn_allocations').select('bill_id, allocated_amount, transactions(status)').in('bill_id', ids);
    (al ?? []).forEach((a: any) => { if (a.transactions?.status === 'Voided' || !a.bill_id) return; paidBy[a.bill_id] = (paidBy[a.bill_id] || 0) + num(a.allocated_amount); });
  }
  return rows.map((b) => {
    const amount = num(b.amount); const paid = Math.min(amount, paidBy[b.id] || 0);
    return {
      id: b.id, billNo: b.bill_no ?? null, billDate: b.bill_date ?? (b.created_at ? String(b.created_at).slice(0, 10) : null),
      amount, docUrl: b.doc_url ?? null, projectId: b.project_id ?? null, projectName: b.projects?.name ?? null,
      vendorId: b.stakeholder_id ?? null, vendorName: b.stakeholders?.name ?? null,
      linked: !!b.po_id, poId: b.po_id ?? null, paid, remaining: amount - paid,
    };
  });
}

/** Link an EXISTING first-class bill to a PO (no new bill minted): set bills.po_id, and mirror the bill onto
 *  the PO (amount / number / date / doc) so the PO detail shows it. The ledger counts it once — via the bills
 *  row — because the view's PO fallback is suppressed when a bills row names the PO. Prevents duplicate bills. */
export async function linkExistingBillToPO(billId: string, poId: string, poProjectId: string | null): Promise<void> {
  const { data: bill, error: bErr } = await supabase.from('bills').select('*').eq('id', billId).single();
  if (bErr || !bill) throw new Error(bErr?.message || 'Bill not found');
  const b = bill as any;
  const { error: upBill } = await supabase.from('bills')
    .update({ po_id: poId, project_id: b.project_id ?? poProjectId ?? null }).eq('id', billId);
  if (upBill) throw upBill;
  const nowIso = new Date().toISOString();
  const { error: upPo } = await supabase.from('purchase_orders').update({
    vendor_bill_amount: num(b.amount),
    vendor_bill_number: b.bill_no ?? null, vendor_bill_no: b.bill_no ?? null,
    vendor_bill_date: b.bill_date ?? nowIso.split('T')[0],
    vendor_bill_url: b.doc_url ?? null, vendor_bill_doc_url: b.doc_url ?? null,
    bill_recorded_at: nowIso, status: 'BILLED',
  }).eq('po_id', poId);
  if (upPo) throw upPo;
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
  // A first-class bill that BELONGS TO A PO must settle that PO too: carry order_type='PO' / order_ref=po_id
  // on the same allocation (alongside bill_id), so the PO's derived paid (which sums order_type='PO'
  // allocations) actually sees the payment. Without this the bill's paid updated but its PO stayed at ₹0.
  // Bills with no PO stay bill_id-only.
  const billPickIds = picks.filter(p => p.kind === 'bill' && p.amount > 0).map(p => p.id);
  const poByBill: Record<string, string> = {};
  if (billPickIds.length) {
    const { data } = await supabase.from('bills').select('id, po_id').in('id', billPickIds);
    (data ?? []).forEach((b: any) => { if (b.po_id) poByBill[b.id] = String(b.po_id); });
  }
  const parts: any[] = picks.filter(p => p.amount > 0).map(p => {
    if (p.kind === 'po') return { project_id: p.projectId ?? '', order_type: 'PO', order_ref: p.id, milestone_id: '', bill_id: '', allocated_amount: p.amount };
    const poId = poByBill[p.id] ?? '';
    return { project_id: p.projectId ?? '', order_type: poId ? 'PO' : '', order_ref: poId, milestone_id: '', bill_id: p.id, allocated_amount: p.amount };
  });
  const allocated = picks.reduce((s, p) => s + (p.amount > 0 ? p.amount : 0), 0);
  const remainder = Math.round((txnTotal - allocated) * 100) / 100;
  if (remainder > 0.5) parts.push({ project_id: remainderProjectId ?? '', order_type: '', order_ref: '', milestone_id: '', bill_id: '', allocated_amount: remainder });
  // Nothing picked at all → a single unallocated part (keeps the txn total intact; the without-bills bucket).
  if (parts.length === 0) parts.push({ project_id: remainderProjectId ?? '', order_type: '', order_ref: '', milestone_id: '', bill_id: '', allocated_amount: txnTotal });
  const { data, error } = await supabase.rpc('set_txn_allocations', { p_txn_id: txnId, p_org_id: orgId, p_parts: parts });
  const r = data as { success?: boolean; error?: string } | null;
  if (error || !r?.success) throw new Error(r?.error || error?.message || 'Could not record the allocation');
}

/**
 * PAY A BILL, from the bill.
 *
 * Everywhere else in Briklay a payment starts as a payment and finds its bill afterwards. Standing
 * in front of the paper on a phone the order is the other way round, and the two facts a payment
 * needs — who, how much — are already on the screen. So this writes both halves in the order the
 * ledger expects: the transaction first, then the allocation that says which bill it settles.
 *
 * It is the same pair of writes the ledger's own attach-bill flow makes (insert_transaction_with_
 * allocations, then set_txn_allocations); nothing here is a private path to money.
 */
export interface PayBillInput {
  orgId: string;
  bill: { id: string; kind: 'bill' | 'po'; vendorId: string | null; projectId: string | null };
  amount: number;
  date: string;                 // yyyy-mm-dd
  mode: 'NEFT' | 'UPI' | 'Cheque' | 'Cash';
  remarks?: string | null;
}
export async function payBill(input: PayBillInput): Promise<string> {
  const { orgId, bill, amount, date, mode } = input;
  if (!(amount > 0)) throw new Error('Enter an amount to pay');
  const txnId = `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
  const { error } = await supabase.rpc('insert_transaction_with_allocations', {
    p_txn: {
      txn_id: txnId, stakeholder_id: bill.vendorId, date, total_amount: amount,
      payment_mode: mode, category: 'Material Purchase',
      remarks: input.remarks ?? null, ai_flag_status: 'Clean', ai_flag_data: {}, org_id: orgId,
    },
    p_allocations: [{ project_id: bill.projectId ?? '', order_type: null, order_ref: null, milestone_id: null, allocated_amount: amount }],
  });
  if (error) throw error;
  // Second write: the same allocation, now naming the bill it settles.
  await saveBillAllocations(txnId, orgId, amount, [{ id: rawBillId(bill.id), kind: bill.kind, projectId: bill.projectId, amount }], bill.projectId);
  return txnId;
}

/**
 * A payment already on the books that could be the one settling this bill.
 *
 * Site offices pay first and file the paper days later, so by the time a bill is recorded its money
 * is often already in the ledger with nothing to point at. These are this vendor's payments with
 * something still unattached — the same project first (a payment carrying no project at all is
 * still offered; it has simply not been placed yet), and within that, the one whose loose amount is
 * nearest what this bill is asking for. That closest match is what a person is looking for, so it
 * comes to the top rather than being hunted for by date.
 */
export interface LinkablePayment {
  txnId: string; date: string | null; mode: string | null;
  total: number;
  /** What of it is not yet spoken for by a bill or an order. */
  free: number;
  projectId: string | null;
  sameProject: boolean;
  /** Everything already allocated on that payment — set_txn_allocations replaces the whole set,
   *  so linking must hand these back untouched alongside the new part. */
  parts: Array<{ project_id: string; order_type: string; order_ref: string; milestone_id: string; bill_id: string; allocated_amount: number }>;
}
export async function loadLinkablePayments(
  stakeholderId: string, projectId: string | null, target: number,
): Promise<LinkablePayment[]> {
  if (!stakeholderId) return [];
  const { data, error } = await supabase
    .from('transactions')
    .select('txn_id, date, payment_mode, total_amount, status, txn_allocations(project_id, order_type, order_ref, milestone_id, bill_id, allocated_amount)')
    .eq('stakeholder_id', stakeholderId)
    .order('date', { ascending: false })
    .limit(120);
  if (error) throw error;

  interface AllocRow { project_id?: string | null; order_type?: string | null; order_ref?: string | null; milestone_id?: string | null; bill_id?: string | null; allocated_amount?: number | string | null }
  interface TxnRow { txn_id: string; date?: string | null; payment_mode?: string | null; total_amount?: number | string | null; status?: string | null; txn_allocations?: AllocRow[] | null }

  const out: LinkablePayment[] = [];
  for (const t of (data ?? []) as TxnRow[]) {
    if (t.status === 'Voided') continue;
    const allocs: AllocRow[] = t.txn_allocations ?? [];
    // "Spoken for" is an allocation that names something — a bill or an order. A part with neither
    // is the without-bills bucket: money sitting on the payment, free to be pointed at this bill.
    const spoken = allocs.reduce((s, a) => s + ((a.bill_id || a.order_ref) ? num(a.allocated_amount) : 0), 0);
    const total = num(t.total_amount);
    const free = Math.round((total - spoken) * 100) / 100;
    if (free <= 0.5) continue;
    const txnProject = allocs.find(a => a.project_id)?.project_id ?? null;
    // Same site, or not yet placed on one. A payment already tied to a different site is not this
    // bill's money and is never offered.
    if (projectId && txnProject && txnProject !== projectId) continue;
    out.push({
      txnId: t.txn_id, date: t.date ?? null, mode: t.payment_mode ?? null,
      total, free, projectId: txnProject, sameProject: !!projectId && txnProject === projectId,
      parts: allocs.map(a => ({
        project_id: a.project_id ?? '', order_type: a.order_type ?? '', order_ref: a.order_ref ?? '',
        milestone_id: a.milestone_id ?? '', bill_id: a.bill_id ?? '', allocated_amount: num(a.allocated_amount),
      })),
    });
  }
  return rankLoosePayments(out, target);
}

/**
 * Point an existing payment at this bill.
 *
 * set_txn_allocations replaces a payment's whole allocation set, so everything it already carried
 * is handed back unchanged and only the free part is re-pointed: whatever the bill still needs, up
 * to what the payment has loose. Any remainder stays exactly where it was — the without-bills
 * bucket — so linking can never move money the payment had already placed somewhere else.
 */
export async function linkPaymentToBill(
  orgId: string, pay: LinkablePayment,
  bill: { id: string; kind: 'bill' | 'po'; projectId: string | null }, amount: number,
): Promise<void> {
  const parts = linkParts(pay, { rawId: rawBillId(bill.id), kind: bill.kind, projectId: bill.projectId }, amount);
  const { data, error } = await supabase.rpc('set_txn_allocations', { p_txn_id: pay.txnId, p_org_id: orgId, p_parts: parts });
  const r = data as { success?: boolean; error?: string } | null;
  if (error || !r?.success) throw new Error(r?.error || error?.message || 'Could not link that payment');
}

/** A list row's id is prefixed for routing ('bl~<uuid>', 'po~<poId>'); the allocation wants the bare one. */
const rawBillId = (id: string) => id.replace(/^(bl|po|cb)~/, '');

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
