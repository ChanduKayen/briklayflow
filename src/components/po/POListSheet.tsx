// PO list — exact port of po-list.html (reference), wired to real data.
// Scoped under .polx so its CSS can't leak into the rest of the app. Fonts use the app's
// existing stacks (serif title, system sans, mono numerics) per decision.
//
// Used by both the main /purchase-orders page and the per-project PO list — pass projectId to scope.
import type React from 'react';
import { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../../lib/supabase';
import SendToVendorModal from '../po-new-ui/SendToVendorModal';

const POLX_CSS = `
.polx{
  --cream:#F6F2EA; --paper:#FFFDF9; --paper-2:#FBF8F2;
  --ink:#2F2622; --ink-2:#6E635B; --ink-3:#A39A91;
  --line:#E4DCD0; --line-2:#EFE9DF;
  --terra:#C4613A; --terra-deep:#A94E2B; --terra-tint:#F8E7DE;
  --sage:#5F7F5B; --sage-tint:#E7EFE4;
  --gold:#B8862E; --gold-tint:#F7EEDA;
  --r:8px; --ease:cubic-bezier(.2,.7,.2,1);
  --shadow:0 1px 2px rgba(47,38,34,.04),0 8px 24px -18px rgba(47,38,34,.25);
  --serif:Georgia,'Times New Roman',serif;
  --sans:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;
  --mono:ui-monospace,'SF Mono',Menlo,Consolas,monospace;
  background:var(--cream);color:var(--ink);font:15px/1.45 var(--sans);-webkit-font-smoothing:antialiased;min-height:100vh;
}
.polx *{box-sizing:border-box}
.polx button,.polx input{font:inherit;color:inherit}
.polx input::placeholder{color:var(--ink-3)}
.polx .mono{font-family:var(--mono);font-feature-settings:"tnum";font-variant-numeric:tabular-nums}
.polx .page{max-width:100%;margin:0 auto;padding:26px 32px 80px}
.polx .top{display:flex;align-items:center;gap:14px;margin-bottom:18px}
.polx h1{font:600 28px/1.1 var(--serif);margin:0;letter-spacing:-.01em}
.polx .top .count{font:500 13px var(--mono);color:var(--ink-2);background:var(--paper);border:1px solid var(--line);padding:5px 9px;border-radius:6px}
.polx .figs{display:grid;grid-template-columns:repeat(4,1fr);background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow);margin-bottom:18px}
.polx .figs>div{padding:14px 20px 12px;border-right:1px solid var(--line-2);position:relative;cursor:pointer;transition:background .15s}
.polx .figs>div:hover{background:var(--paper-2)}
.polx .figs>div:last-child{border-right:0}
.polx .figs>div::before{content:"";position:absolute;left:0;right:0;top:0;height:3px;background:var(--line-2)}
.polx .figs .terra::before{background:var(--terra)}.polx .figs .gold::before{background:var(--gold)}.polx .figs .sage::before{background:var(--sage)}
.polx .figs small{display:block;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:var(--ink-2);margin-bottom:4px}
.polx .figs .mono{font-size:22px;font-weight:500;letter-spacing:-.01em}
.polx .figs .sub{font-size:12.5px;color:var(--ink-3);margin-top:2px}
.polx .figs .terra .mono{color:var(--terra)}
.polx .tools{display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap}
.polx .search{position:relative;flex:1;min-width:240px;max-width:380px}
.polx .search svg{position:absolute;left:12px;top:50%;transform:translateY(-50%);width:15px;height:15px;stroke:var(--ink-3);fill:none;stroke-width:1.8}
.polx .search input{width:100%;height:38px;border:1px solid var(--line);border-radius:var(--r);background:var(--paper);padding:0 12px 0 34px;outline:none;transition:border-color .15s,box-shadow .15s}
.polx .search input:focus{border-color:var(--terra);box-shadow:0 0 0 3px var(--terra-tint)}
.polx .chips{display:flex;gap:6px;flex-wrap:wrap}
.polx .chip{height:34px;padding:0 12px;border-radius:999px;border:1px solid var(--line);background:var(--paper);color:var(--ink-2);cursor:pointer;display:inline-flex;align-items:center;gap:6px;font-size:13.5px;font-weight:500;transition:background .15s,color .15s,border-color .15s,transform .12s}
.polx .chip:hover{background:var(--paper-2);border-color:var(--ink-3)}
.polx .chip:active{transform:scale(.96)}
.polx .chip .n{font-family:var(--mono);font-size:12px;color:var(--ink-3)}
.polx .chip.on{background:var(--ink);border-color:var(--ink);color:var(--paper)}
.polx .chip.on .n{color:rgba(255,253,249,.6)}
.polx .chip.on.warn{background:var(--terra);border-color:var(--terra)}
.polx .btn{display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 16px;border-radius:var(--r);border:1px solid var(--terra);background:var(--terra);color:#fff;font-weight:500;cursor:pointer;transition:background .16s,transform .12s var(--ease),box-shadow .16s}
.polx .btn:hover{background:var(--terra-deep);border-color:var(--terra-deep);transform:translateY(-1px);box-shadow:0 6px 16px -8px rgba(196,97,58,.7)}
.polx .btn:active{transform:translateY(0) scale(.97);box-shadow:none;background:#93441F}
.polx .btn svg{width:15px;height:15px;stroke:currentColor;fill:none;stroke-width:2}
.polx .sheet{background:var(--paper);border:1px solid var(--line);border-radius:10px;overflow:hidden;box-shadow:var(--shadow)}
.polx table{width:100%;border-collapse:collapse;table-layout:fixed}
.polx thead th{position:sticky;top:0;z-index:2;font-weight:500;font-size:12px;color:var(--ink-2);text-align:left;padding:10px 12px;background:var(--paper-2);border-bottom:1px solid var(--line);letter-spacing:.02em;white-space:nowrap;cursor:pointer;user-select:none;transition:color .15s}
.polx thead th:hover{color:var(--ink)}
.polx thead th .arr{display:inline-block;width:0;margin-left:4px;opacity:0;transition:opacity .15s;font-size:10px}
.polx thead th.sorted .arr{opacity:1}
.polx thead th.num,.polx td.num{text-align:right}
.polx tbody tr{cursor:pointer;transition:background .12s}
.polx tbody tr:hover td{background:var(--paper-2)}
.polx td{padding:10px 12px;border-bottom:1px solid var(--line-2);vertical-align:middle;height:58px}
.polx tbody tr:last-child td{border-bottom:0}
.polx .po b{display:block;font-weight:600;letter-spacing:-.005em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .po .mono{font-size:12px;color:var(--ink-3)}
.polx .items{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:flex;align-items:center;gap:0}
.polx .items span.t{overflow:hidden;text-overflow:ellipsis;min-width:0}
.polx .items .more{display:inline-block;font:500 11px/1 var(--mono);color:var(--ink-2);background:var(--paper-2);border:1px solid var(--line-2);padding:3px 6px;border-radius:4px;margin-left:6px;vertical-align:1px;cursor:help}
.polx .items .more:hover{background:var(--terra-tint);border-color:transparent;color:var(--terra)}
.polx .site{color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.polx .when{white-space:nowrap}.polx .when small{display:block;color:var(--ink-3);font-size:12px}
.polx .dim{color:var(--ink-3)}
.polx .val{font-weight:500}
.polx .val small{display:block;font-size:11.5px;font-family:var(--sans);font-weight:400;color:var(--ink-3)}
.polx .val small.over{color:var(--terra)}
.polx .bal.owe{color:var(--terra);font-weight:500}.polx .bal.adv{color:var(--sage);font-weight:500}.polx .bal.nil{color:var(--sage)}.polx .bal small{font-size:10.5px;font-weight:600;opacity:.72;margin-left:1px}
.polx .dlv{white-space:nowrap}
.polx .dlv .late{color:var(--terra);font-weight:500}
.polx .dlv .due{color:var(--gold);font-weight:500}
.polx .dlv .ok{color:var(--sage);font-weight:500}
.polx .dlv .sent{color:#3b7bb5;font-weight:500}
.polx .dlv .none{color:var(--ink-2)}
.polx .dlv small{display:block;color:var(--ink-3);font-size:12px}
.polx .dlv .send-link{display:inline-block;margin-top:4px;background:none;border:0;padding:0;font-family:inherit;font-size:12px;color:#1a9d5a;text-decoration:underline;text-underline-offset:2px;cursor:pointer;transition:color .14s}
.polx .dlv .send-link:hover{color:#127c46;text-decoration-thickness:2px}
.polx .dlv small b{font-weight:500}
.polx .dlv .partial{display:inline-flex;align-items:center;gap:8px;font-weight:500;color:var(--gold)}
.polx .dlv .partial i{width:44px;height:6px;border-radius:3px;background:var(--line-2);position:relative;overflow:hidden}
.polx .dlv .partial i::after{content:"";position:absolute;left:0;top:0;bottom:0;width:var(--w);background:var(--gold);border-radius:3px}
.polx .dlv[data-tip]{cursor:help}
.polx tr.cancelled td{color:var(--ink-3)}.polx tr.cancelled .po b{text-decoration:line-through;color:var(--ink-3)}
.polx td.act{width:150px;text-align:right}
.polx .next{height:30px;padding:0 10px;border-radius:6px;border:1px solid var(--line);background:var(--paper);font-size:13px;font-weight:500;color:var(--ink);cursor:pointer;opacity:0;transform:translateX(4px);transition:opacity .15s,transform .2s var(--ease),background .15s,border-color .15s}
.polx tbody tr:hover .next{opacity:1;transform:none}
.polx .next:hover{background:var(--terra-tint);border-color:transparent;color:var(--terra)}
.polx .next:active{transform:scale(.96)}
.polx .next.primary{background:var(--terra);border-color:var(--terra);color:#fff}
.polx .next.primary:hover{background:var(--terra-deep)}
.polx .next.soft{opacity:.7;transform:none;background:transparent;border-color:transparent;color:var(--ink-2)}
.polx .next.soft:hover{opacity:1}
.polx .empty{padding:48px 20px;text-align:center;color:var(--ink-3)}
.polx .foot{display:flex;justify-content:space-between;align-items:center;padding:10px 16px;background:var(--paper-2);border-top:1px solid var(--line);font-size:13px;color:var(--ink-2)}
.polx .foot .mono{color:var(--ink)}
.polx .tip{position:fixed;z-index:80;background:var(--ink);color:var(--paper);border-radius:8px;padding:8px 4px;min-width:220px;max-width:300px;font-size:13px;box-shadow:0 12px 30px -10px rgba(47,38,34,.5);pointer-events:none}
.polx .tip h4{margin:0 0 4px;padding:2px 10px;font:500 11px var(--sans);letter-spacing:.12em;text-transform:uppercase;color:rgba(255,253,249,.55)}
.polx .tip ul{list-style:none;margin:0;padding:0}
.polx .tip li{display:flex;align-items:center;gap:8px;padding:5px 10px;border-radius:5px}
.polx .tip li .q{font-family:var(--mono);color:rgba(255,253,249,.7);font-size:12px;white-space:nowrap}
.polx .tip li.r{color:rgba(255,253,249,.45)}.polx .tip li.r .q{color:rgba(255,253,249,.35)}
.polx .tip li .g{width:14px;flex:none;text-align:center}.polx .tip li .nm{flex:1}
.polx .tip li.r .g::before{content:"✓";color:#9DBB98}
.polx .tip li.p .g::before{content:"○";color:#E0B45B}
.polx .tip::after{content:"";position:absolute;left:18px;top:-5px;width:10px;height:10px;background:var(--ink);transform:rotate(45deg);border-radius:2px}
.polx tbody tr.rfq td{background:var(--paper-2)}
.polx tbody tr.rfq:hover td{background:var(--gold-tint)}
.polx tbody tr.rfq td:first-child{box-shadow:inset 3px 0 0 var(--terra)}
.polx tbody tr.rfq .po .mono{color:var(--gold)}
.polx .chip.quote{color:var(--gold);border-color:#EBD9B4}
.polx .chip.quote .n{color:var(--gold)}
.polx .chip.quote.on{background:var(--gold);border-color:var(--gold);color:#fff}
.polx .chip.quote.on .n{color:rgba(255,255,255,.65)}
@media (max-width:980px){
  .polx .page{padding:16px 14px 60px}
  .polx .figs{grid-template-columns:1fr 1fr}
  .polx .sheet{overflow-x:auto}.polx table{min-width:1080px}
}
@media (prefers-reduced-motion:reduce){.polx *{animation-duration:.01ms !important;transition-duration:.01ms !important}}
`;

interface POItem { n: string; q: string; r: boolean }
interface PORow {
  id: string; vendor: string; stakeholderId: string; vendorContact: string | null;
  site: string; by: string; ordered: string; createdAt: string;
  items: POItem[]; value: number; billed: number; paid: number;
  due: string | null; recv: string | null; sent: string | null; cancelled: boolean; rfq: boolean;
}

const fmt = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
const D = (s: string | null) => (s ? new Date(s) : new Date(NaN));
const dstr = (d: Date) => (isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }));
const days = (a: Date, b: Date) => Math.round((b.getTime() - a.getTime()) / 86400000);

function usePOListData(projectId?: string) {
  const posQ = useQuery({
    queryKey: ['po_list_sheet', projectId ?? 'all'],
    queryFn: async () => {
      let q = supabase
        .from('purchase_orders')
        .select('po_id, status, approval_status, date_issued, created_at, ordered_by, expected_delivery, total_value, order_value, vendor_bill_amount, received_at_site, sent_to_vendor_at, stakeholder_id, project_id, items, projects(name), stakeholders(name, contact), po_line_items(id, item_name, unit, quantity_ordered)')
        .order('created_at', { ascending: false });
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error) throw error;
      // Strict reference has no approval queue — hide pending-approval drafts (but never hide a cancelled PO).
      return (data ?? []).filter((po: any) => (po.approval_status ?? 'APPROVED') !== 'PENDING' || po.status === 'CANCELLED');
    },
  });
  const pos = posQ.data ?? [];
  const poIds = pos.map((p: any) => p.po_id);

  const receiptQ = useQuery({
    queryKey: ['po_list_receipt', projectId ?? 'all'],
    queryFn: async () => {
      const { data, error } = await supabase.from('po_receipt_summary').select('po_id, receipt_pct, last_receipt_date');
      if (error) throw error;
      const m: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { m[r.po_id] = r; });
      return m;
    },
  });

  const paidQ = useQuery({
    queryKey: ['po_list_paid', projectId ?? 'all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('order_ref, allocated_amount, transactions!inner(status)')
        .eq('order_type', 'PO')
        .neq('transactions.status', 'Voided');
      if (error) throw error;
      const m: Record<string, number> = {};
      (data ?? []).forEach((r: any) => { if (r.order_ref) m[r.order_ref] = (m[r.order_ref] || 0) + (Number(r.allocated_amount) || 0); });
      return m;
    },
  });

  // Per-line received quantities (drives the accurate got/pending counts + tooltip).
  const grnQ = useQuery({
    queryKey: ['po_list_grn', poIds],
    enabled: poIds.length > 0,
    queryFn: async () => {
      const { data: grns, error: gErr } = await supabase.from('po_grn').select('grn_id, po_id').in('po_id', poIds);
      if (gErr) throw gErr;
      const grnIds = (grns ?? []).map((g: any) => g.grn_id);
      const byGrn: Record<string, string> = {};
      (grns ?? []).forEach((g: any) => { byGrn[g.grn_id] = g.po_id; });
      if (!grnIds.length) return {} as Record<string, number>;
      const { data: items, error: iErr } = await supabase.from('po_grn_items').select('grn_id, po_line_item_id, qty_received').in('grn_id', grnIds);
      if (iErr) throw iErr;
      const recvByLine: Record<string, number> = {};
      (items ?? []).forEach((it: any) => {
        if (!it.po_line_item_id) return;
        recvByLine[it.po_line_item_id] = (recvByLine[it.po_line_item_id] || 0) + (Number(it.qty_received) || 0);
      });
      return recvByLine;
    },
  });

  const rows: PORow[] = useMemo(() => {
    const receipt = receiptQ.data ?? {};
    const paid = paidQ.data ?? {};
    const recvByLine = grnQ.data ?? {};
    return pos.map((po: any): PORow => {
      const cancelled = po.status === 'CANCELLED';
      const value = Number(po.total_value || po.order_value) || 0;
      const billed = Number(po.vendor_bill_amount) || 0;
      const rfq = !cancelled && value === 0 && billed === 0;
      const pct = Number(receipt[po.po_id]?.receipt_pct ?? 0);
      const fullyReceived = pct >= 100 || !!po.received_at_site;

      // Build items — prefer real line items; fall back to the legacy items json.
      const lineItems = (po.po_line_items ?? []) as any[];
      let items: POItem[];
      if (lineItems.length) {
        items = lineItems.map((li: any) => {
          const ordered = Number(li.quantity_ordered) || 0;
          const rec = recvByLine[li.id] || 0;
          const r = fullyReceived || (ordered > 0 && rec + 1e-6 >= ordered);
          return { n: li.item_name || 'Item', q: `${li.quantity_ordered ?? ''}${li.unit ? ' ' + li.unit : ''}`.trim(), r };
        });
      } else {
        const jsonItems = (po.items ?? []) as any[];
        const n = jsonItems.length;
        const recvCount = fullyReceived ? n : Math.round((pct / 100) * n);
        items = jsonItems.map((it: any, i: number) => ({ n: it.description || 'Item', q: `${it.qty ?? ''}${it.unit ? ' ' + it.unit : ''}`.trim(), r: i < recvCount }));
      }
      return {
        id: po.po_id,
        vendor: po.stakeholders?.name || 'Vendor',
        stakeholderId: po.stakeholder_id,
        vendorContact: po.stakeholders?.contact ?? null,
        site: po.projects?.name || '',
        by: po.ordered_by || '',
        ordered: po.date_issued || po.created_at,
        createdAt: po.created_at,
        items,
        value, billed,
        paid: paid[po.po_id] || 0,
        due: po.expected_delivery || null,
        recv: po.received_at_site || receipt[po.po_id]?.last_receipt_date || null,
        sent: po.sent_to_vendor_at || null,
        cancelled, rfq,
      };
    });
  }, [pos, receiptQ.data, paidQ.data, grnQ.data]);

  return { rows, isLoading: posQ.isLoading };
}

interface RfqRow { rfq_id: string; created_at: string; site: string; summary: string; itemCount: number; sent: number; replied: number; best: number | null }
function useOpenRfqs(projectId?: string) {
  return useQuery({
    queryKey: ['open_rfqs', projectId ?? 'all'],
    queryFn: async (): Promise<RfqRow[]> => {
      // NB: rfqs has no FK to projects, so we can't embed projects(name) — fetch names separately.
      let q = supabase.from('rfqs').select('rfq_id, created_at, items, status, project_id').eq('status', 'open').order('created_at', { ascending: false });
      if (projectId) q = q.eq('project_id', projectId);
      const { data, error } = await q;
      if (error) throw error;
      const rows = (data ?? []) as any[];
      const ids = rows.map((r) => r.rfq_id);
      const agg: Record<string, { sent: number; replied: number; best: number | null }> = {};
      if (ids.length) {
        const { data: rc } = await supabase.from('rfq_recipients').select('rfq_id, status, quoted_total').in('rfq_id', ids);
        (rc ?? []).forEach((r: any) => {
          const c = agg[r.rfq_id] ?? (agg[r.rfq_id] = { sent: 0, replied: 0, best: null });
          c.sent++;
          if (r.status === 'quoted') { c.replied++; const t = Number(r.quoted_total) || 0; if (t > 0 && (c.best == null || t < c.best)) c.best = t; }
        });
      }
      const pids = [...new Set(rows.map((r) => r.project_id).filter(Boolean))];
      const nameById: Record<string, string> = {};
      if (pids.length) {
        const { data: pj } = await supabase.from('projects').select('project_id, name').in('project_id', pids);
        (pj ?? []).forEach((p: any) => { nameById[p.project_id] = p.name; });
      }
      return rows.map((r) => {
        const names = ((r.items ?? []) as any[]).map((it) => it.item_name).filter(Boolean);
        const summary = names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`;
        return { rfq_id: r.rfq_id, created_at: r.created_at, site: nameById[r.project_id] || '', summary, itemCount: (r.items ?? []).length, sent: agg[r.rfq_id]?.sent || 0, replied: agg[r.rfq_id]?.replied || 0, best: agg[r.rfq_id]?.best ?? null };
      });
    },
  });
}

export default function POListSheet({ projectId }: { projectId?: string }) {
  const navigate = useNavigate();
  const { rows, isLoading } = usePOListData(projectId);
  const { data: openRfqs = [] } = useOpenRfqs(projectId);
  const [filter, setFilter] = useState<'all' | 'mine' | 'late' | 'open' | 'vendor' | 'done' | 'quotes'>('all');
  const [sortK, setSortK] = useState<'vendor' | 'site' | 'ordered' | 'delivery' | 'value' | 'balance'>('ordered');
  const [sortDir, setSortDir] = useState(-1);
  const [q, setQ] = useState('');
  const [tip, setTip] = useState<{ id: string; pending: boolean; x: number; y: number } | null>(null);
  // The PO whose "Send PO to vendor" link was tapped — opens the send dialog over the list.
  const [sendRow, setSendRow] = useState<PORow | null>(null);

  const TODAY = useMemo(() => new Date(), []);
  const balance = (p: PORow) => (p.billed || p.value) - p.paid;
  // Balance shown as a vendor-ledger position: owed to the vendor = Credit (they're a creditor);
  // paid ahead of the bill = Debit (an advance). Signed = billed/value − paid.
  const balCell = (p: PORow) => {
    if (p.rfq || p.cancelled) return <span className="dim">—</span>;
    const b = balance(p);
    if (b > 0.5) return <span className="bal owe">{fmt(b)}<small>Cr</small></span>;
    if (b < -0.5) return <span className="bal adv">{fmt(-b)}<small>Dr</small></span>;
    return <span className="bal nil">—</span>;
  };
  const got = (p: PORow) => p.items.filter(i => i.r).length;
  const pend = (p: PORow) => p.items.filter(i => !i.r);
  const full = (p: PORow) => !p.cancelled && !p.rfq && p.items.length > 0 && got(p) === p.items.length;
  const late = (p: PORow) => !p.cancelled && !full(p) && !!p.due && D(p.due) < TODAY;
  const mine = (p: PORow) => !p.cancelled && !p.rfq && !full(p) && (late(p) || got(p) > 0 || (!!p.due && days(TODAY, D(p.due)) <= 0));

  const FILTERS: Record<string, (p: PORow) => boolean> = {
    all: () => true,
    mine,
    late,
    open: (p) => !p.cancelled && !p.rfq && !full(p),
    vendor: (p) => p.rfq || (!p.cancelled && !full(p) && !late(p) && got(p) === 0),
    done: full,
  };
  const KEY: Record<string, (p: PORow) => number | string> = {
    vendor: (p) => p.vendor,
    site: (p) => p.site,
    ordered: (p) => D(p.ordered).getTime(),
    delivery: (p) => (full(p) ? 2 : got(p) > 0 ? 1 : 0),
    value: (p) => p.value,
    balance: (p) => balance(p),
  };

  const list = useMemo(() => {
    let l = rows.filter(FILTERS[filter] ?? (() => false));   // 'quotes' shows no POs
    if (q) l = l.filter(p => (p.vendor + p.id + p.site + p.items.map(i => i.n).join(' ')).toLowerCase().includes(q));
    l = l.slice().sort((a, b) => { const x = KEY[sortK](a), y = KEY[sortK](b); return (x > y ? 1 : x < y ? -1 : 0) * sortDir; });
    return l;
  }, [rows, filter, q, sortK, sortDir]);

  // RFQs awaiting quotes, interleaved with POs by date (only in All / Quotes).
  const rfqShown = useMemo(() => (filter === 'all' || filter === 'quotes')
    ? openRfqs.filter(r => !q || ('quote request enquiry ' + r.site + ' ' + r.summary + ' ' + r.rfq_id).toLowerCase().includes(q))
    : [], [openRfqs, filter, q]);
  type MergedRow = { kind: 'po'; po: PORow } | { kind: 'rfq'; rfq: RfqRow };
  const merged: MergedRow[] = useMemo(() => {
    if (filter === 'quotes') return rfqShown.map(r => ({ kind: 'rfq' as const, rfq: r }));
    const rows: MergedRow[] = list.map(p => ({ kind: 'po' as const, po: p }));
    if (rfqShown.length === 0) return rows;
    // Slot each quote into the list by when it was created (real created_at, not
    // the PO's issue date) so quotes appear in chronological place among the POs
    // instead of all bunched at the top. POs keep their existing sort order.
    const desc = !(sortK === 'ordered' && sortDir > 0);
    const keyOf = (m: MergedRow) => D(m.kind === 'po' ? m.po.createdAt : m.rfq.created_at).getTime();
    for (const r of rfqShown) {
      const q: MergedRow = { kind: 'rfq', rfq: r };
      const t = D(r.created_at).getTime();
      let i = rows.findIndex(row => (desc ? keyOf(row) < t : keyOf(row) > t));
      if (i < 0) i = rows.length;
      rows.splice(i, 0, q);
    }
    return rows;
  }, [list, rfqShown, filter, sortK, sortDir]);

  const live = useMemo(() => rows.filter(p => !p.cancelled && !p.rfq), [rows]);
  const fLate = rows.filter(late).length;
  const fMine = rows.filter(mine).length;
  const fOpen = live.filter(p => !full(p)).reduce((a, p) => a + p.value, 0);
  const fBal = live.reduce((a, p) => a + Math.max(0, balance(p)), 0);
  const cAll = rows.length;
  const cMine = fMine;
  const cVendor = rows.filter(FILTERS.vendor).length;
  const cDone = rows.filter(FILTERS.done).length;
  const footTotal = list.reduce((a, p) => a + (p.cancelled ? 0 : p.value), 0);

  const openPO = (id: string) => navigate(`/purchase-orders/${id}`, { state: projectId ? { from: 'project', projectId } : { from: 'list' } });
  const onSort = (k: typeof sortK) => {
    if (sortK === k) setSortDir(d => d * -1);
    else { setSortK(k); setSortDir(k === 'ordered' || k === 'value' || k === 'balance' ? -1 : 1); }
  };
  const arr = (k: string) => sortK === k ? (sortDir < 0 ? '▼' : '▲') : '▲';

  const dueLabel = (p: PORow): React.ReactNode => {
    if (!p.due) return 'no date from vendor';
    const d = days(TODAY, D(p.due));
    if (d < 0) return <b className="late">{-d} day{-d > 1 ? 's' : ''} late</b>;
    if (d === 0) return <b className="due">due today</b>;
    return <>due {dstr(D(p.due))}</>;
  };
  const recvCell = (p: PORow): React.ReactNode => {
    if (p.cancelled) return <span className="dim">—</span>;
    const n = p.items.length, g = got(p), pl = pend(p);
    const fully = n > 0 && g === n;
    const tipProps = g > 0 && !fully
      ? { onMouseEnter: (e: React.MouseEvent) => showTip(e, p.id, true), onMouseLeave: () => setTip(null) }
      : {};

    // The status line for this PO's delivery.
    let status: React.ReactNode;
    if (fully) status = <><span className="ok">✓ Received</span><small>{dstr(D(p.recv))}</small></>;
    else if (g > 0) status = (
      <>
        <span className="partial"><i style={{ ['--w' as any]: `${g / n * 100}%` }} />{g} of {n} received</span>
        <small>{pl.length === 1 ? pl[0].n + ' pending' : pl.length + ' pending'} · {dueLabel(p)}</small>
      </>
    );
    // Sent to the vendor (ordered, on its way) — wins over the "awaiting price" RFQ label.
    else if (p.sent) status = <><span className="sent">✓ PO sent</span><small>to vendor · {dstr(D(p.sent))} · {dueLabel(p)}</small></>;
    else if (p.rfq) status = <><span className="dim">Not ordered yet</span><small>awaiting price</small></>;
    else status = <><span className={late(p) ? 'late' : 'none'}>Not received</span><small>{n} item{n !== 1 ? 's' : ''} · {dueLabel(p)}</small></>;

    // Not yet sent and not delivered → a subtle, clearly-clickable way to send the PO to the vendor.
    const canSend = !p.sent && !fully && !!p.stakeholderId;
    return (
      <div className="dlv" {...tipProps}>
        {status}
        {canSend && (
          <button type="button" className="send-link" onClick={(e) => { e.stopPropagation(); setSendRow(p); }}>
            Send PO to vendor
          </button>
        )}
      </div>
    );
  };

  function showTip(e: React.MouseEvent, id: string, pending: boolean) {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setTip({ id, pending, x: Math.max(8, r.left - 14), y: r.bottom + 10 });
  }

  const tipRow = tip ? rows.find(r => r.id === tip.id) : null;

  return (
    <div className="polx">
      <style>{POLX_CSS}</style>
      <div className="page">
        <div className="top">
          <h1>Purchase orders</h1>
          <span className="count">{rows.length}</span>
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => navigate('/purchase-orders/new', projectId ? { state: { projectId } } : undefined)}>
            <svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" /></svg>New PO
          </button>
        </div>

        <div className="figs">
          <div className="terra" onClick={() => setFilter('late')}><small>Late</small><span className="mono">{fLate}</span><div className="sub">past the date the vendor gave</div></div>
          <div className="gold" onClick={() => setFilter('mine')}><small>To receive</small><span className="mono">{fMine}</span><div className="sub">due or partly at site</div></div>
          <div onClick={() => setFilter('open')}><small>In transit</small><span className="mono">{fmt(fOpen)}</span><div className="sub">ordered, not fully received</div></div>
          <div className="sage" onClick={() => setFilter('all')}><small>Balance to vendors</small><span className="mono">{fmt(fBal)}</span><div className="sub">across live POs</div></div>
        </div>

        <div className="tools">
          <div className="search">
            <svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
            <input placeholder="Vendor, PO number, item, site" value={q} onChange={(e) => setQ(e.target.value.trim().toLowerCase())} />
          </div>
          <div className="chips">
            <button className={`chip${filter === 'all' ? ' on' : ''}`} onClick={() => setFilter('all')}>All <span className="n">{cAll}</span></button>
            <button className={`chip warn${filter === 'mine' ? ' on' : ''}`} onClick={() => setFilter('mine')}>To receive <span className="n">{cMine}</span></button>
            <button className={`chip${filter === 'vendor' ? ' on' : ''}`} onClick={() => setFilter('vendor')}>On the way <span className="n">{cVendor}</span></button>
            <button className={`chip quote${filter === 'quotes' ? ' on' : ''}`} onClick={() => setFilter('quotes')}>Quotations <span className="n">{openRfqs.length}</span></button>
            <button className={`chip${filter === 'done' ? ' on' : ''}`} onClick={() => setFilter('done')}>Received <span className="n">{cDone}</span></button>
          </div>
        </div>

        <div className="sheet">
          <table>
            <colgroup><col style={{ width: '17%' }} /><col style={{ width: '19%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /><col style={{ width: '12%' }} /></colgroup>
            <thead><tr>
              <th className={sortK === 'vendor' ? 'sorted' : ''} onClick={() => onSort('vendor')}>Vendor · PO<span className="arr">{arr('vendor')}</span></th>
              <th style={{ cursor: 'default' }}>Items</th>
              <th className={sortK === 'site' ? 'sorted' : ''} onClick={() => onSort('site')}>Site<span className="arr">{arr('site')}</span></th>
              <th className={sortK === 'ordered' ? 'sorted' : ''} onClick={() => onSort('ordered')}>Ordered<span className="arr">{arr('ordered')}</span></th>
              <th className={sortK === 'delivery' ? 'sorted' : ''} onClick={() => onSort('delivery')}>Delivery<span className="arr">{arr('delivery')}</span></th>
              <th className={`num${sortK === 'value' ? ' sorted' : ''}`} onClick={() => onSort('value')}>Value<span className="arr">{arr('value')}</span></th>
              <th className={`num${sortK === 'balance' ? ' sorted' : ''}`} onClick={() => onSort('balance')} title="Owed to vendor = Credit · Advance = Debit">Balance<span className="arr">{arr('balance')}</span></th>
            </tr></thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="empty">Loading…</td></tr>
              ) : merged.length === 0 ? (
                <tr><td colSpan={7} className="empty">Nothing here. {filter === 'quotes' ? 'No open quote requests.' : filter === 'mine' ? 'Nothing waiting on you — go build something.' : 'Try another filter.'}</td></tr>
              ) : merged.map((row) => {
                if (row.kind === 'rfq') {
                  const r = row.rfq;
                  const ref = 'ENQ-' + r.rfq_id.slice(0, 6).toUpperCase();
                  const siteShort = r.site.replace(' Residence', '').replace("'s", '');
                  return (
                    <tr key={'rfq-' + r.rfq_id} className="rfq" tabIndex={0} onClick={() => navigate(`/rfq/${r.rfq_id}`)} onKeyDown={(e) => { if (e.key === 'Enter') navigate(`/rfq/${r.rfq_id}`); }}>
                      <td className="po"><b>{r.sent} vendor{r.sent !== 1 ? 's' : ''} asked</b><span className="mono">{ref} · enquiry</span></td>
                      <td><div className="items"><span className="t">{r.summary || `${r.itemCount} items`}</span></div></td>
                      <td className="site" title={r.site}>{siteShort}</td>
                      <td className="when">{dstr(D(r.created_at))}</td>
                      <td><div className="dlv">
                        {r.replied > 0
                          ? <><span className="due">{r.replied} of {r.sent} quoted</span><small>{r.best != null ? `best ${fmt(r.best)} · ` : ''}tap to compare</small></>
                          : <><span className="due">Awaiting quotes</span><small>{r.sent} vendor{r.sent !== 1 ? 's' : ''} asked · {dstr(D(r.created_at))}</small></>}
                      </div></td>
                      <td className="num"><span className="dim">—</span></td>
                      <td className="num"><span className="dim">—</span></td>
                    </tr>
                  );
                }
                const p = row.po;
                const shown = p.items.slice(0, 2).map(i => i.n).join(', ');
                const rest = p.items.length - 2;
                const siteShort = p.site.replace(' Residence', '').replace("'s", '');
                return (
                  <tr key={p.id} tabIndex={0} className={p.cancelled ? 'cancelled' : ''} onClick={() => openPO(p.id)} onKeyDown={(e) => { if (e.key === 'Enter') openPO(p.id); }}>
                    <td className="po"><b>{p.vendor}</b><span className="mono">{p.id}</span></td>
                    <td><div className="items"><span className="t">{shown || <span className="dim">No items</span>}</span>{rest > 0 && <span className="more" onMouseEnter={(e) => showTip(e, p.id, false)} onMouseLeave={() => setTip(null)}>+{rest} item{rest > 1 ? 's' : ''}</span>}</div></td>
                    <td className="site" title={p.site}>{siteShort}</td>
                    <td className="when">{dstr(D(p.ordered))}<small>{p.by}</small></td>
                    <td>{recvCell(p)}</td>
                    <td className="num val">{p.rfq ? <span className="dim">—</span> : p.cancelled ? <span className="dim">{fmt(p.value)}</span> : fmt(p.value)}</td>
                    <td className="num">{balCell(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <div className="foot">
            <span>{list.length} purchase order{list.length !== 1 ? 's' : ''}{filter !== 'all' || q ? ' shown' : ''}</span>
            <span>Showing total <span className="mono">{fmt(footTotal)}</span></span>
          </div>
        </div>
      </div>

      {tip && tipRow && createPortal(
        <div className="polx"><div className="tip show" role="tooltip" style={{ left: tip.x, top: tip.y, opacity: 1, transform: 'none' }}>
          <h4>{tip.pending ? `${got(tipRow)} of ${tipRow.items.length} received` : `${tipRow.items.length} items`}</h4>
          <ul>{tipRow.items.map((i, k) => (<li key={k} className={i.r ? 'r' : 'p'}><span className="g" /><span className="nm">{i.n}</span><span className="q">{i.q}</span></li>))}</ul>
        </div></div>,
        document.body,
      )}

      {sendRow && (
        <SendToVendorModal
          open={!!sendRow}
          poId={sendRow.id}
          vendorId={sendRow.stakeholderId}
          vendorName={sendRow.vendor}
          vendorContact={sendRow.vendorContact}
          projectName={sendRow.site}
          totalLabel={sendRow.rfq ? undefined : fmt(sendRow.value)}
          onClose={() => setSendRow(null)}
        />
      )}
    </div>
  );
}
