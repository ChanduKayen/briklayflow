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
  const [poR, stkR, projR, cbR] = await Promise.all([
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
  const pos = (poR.data ?? []) as any[];
  const cbs = (cbR.data ?? []) as any[];
  const stkName: Record<string, string> = {}; (stkR.data ?? []).forEach((s: any) => { stkName[s.stakeholder_id] = s.name; });
  const projName: Record<string, string> = {}; (projR.data ?? []).forEach((p: any) => { projName[p.project_id] = p.name; });

  // Payments allocated to each PO (non-voided).
  const poIds = pos.map(p => p.po_id);
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
