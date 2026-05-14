import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import Breadcrumb from '../components/Breadcrumb';
import { useUserProfile } from '../App';
import { StarDisplay } from './Stakeholders';
import { WOPeek } from '../components/WOPeek';
import { POPeek } from '../components/POPeek';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

function fmt(n: number) {
  return Math.abs(n).toLocaleString('en-IN');
}

const _today = new Date();
_today.setHours(0, 0, 0, 0);
const _yesterday = new Date(_today);
_yesterday.setDate(_today.getDate() - 1);

function rowDateLabel(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  if (d.getTime() === _today.getTime()) return 'Today';
  if (d.getTime() === _yesterday.getTime()) return 'Yesterday';
  const label = d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return d.getFullYear() !== _today.getFullYear() ? `${label} ${d.getFullYear()}` : label;
}

function monthKey(dateStr: string) {
  const d = new Date(dateStr);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function monthHeading(key: string) {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1)
    .toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })
    .toUpperCase();
}

type DateFilter = 'all' | 'month' | '3m' | 'fy';

function woStatusClass(s: string) {
  if (s === 'Active')    return 'bg-amber-100 text-amber-800';
  if (s === 'Closed')    return 'bg-green-100 text-green-800';
  if (s === 'Issued')    return 'bg-violet-100 text-violet-800';
  if (s === 'Assigned')  return 'bg-blue-50 text-blue-700';
  if (s === 'Cancelled') return 'bg-rose-50 text-rose-700';
  return 'bg-surface-container-high text-on-surface-variant';
}

// ─── Star rating input ────────────────────────────────────────────────────────

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map(n => (
        <button key={n} type="button"
          onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(value === n ? 0 : n)}
          className="p-0.5 transition-transform hover:scale-110">
          <span className="material-symbols-outlined text-[24px]" style={{
            color: (hovered || value) >= n ? '#f59e0b' : '#d1d5db',
            fontVariationSettings: (hovered || value) >= n ? "'FILL' 1" : "'FILL' 0",
          }}>star</span>
        </button>
      ))}
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function StakeholderDetail({ session }: { session: Session }) {
  const { stakeholderId } = useParams<{ stakeholderId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const canManage = profile?.role === 'management' || profile?.role === 'accountant';

  // ─── UI state ───────────────────────────────────────────────────────────

  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [showWOs, setShowWOs] = useState(false);
  const [peek, setPeek] = useState<{ type: 'WO' | 'PO'; id: string } | null>(null);

  // Rating modal
  const [showRateModal, setShowRateModal] = useState(false);
  const [rateOverall, setRateOverall]   = useState(0);
  const [rateDelivery, setRateDelivery] = useState(0);
  const [rateQuality, setRateQuality]   = useState(0);
  const [ratePricing, setRatePricing]   = useState(0);
  const [showRateSubcats, setShowRateSubcats] = useState(false);

  // ─── Queries ────────────────────────────────────────────────────────────

  const { data: stk, isLoading: stkLoading } = useQuery({
    queryKey: ['stakeholder', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stakeholders').select('*')
        .eq('stakeholder_id', stakeholderId!).single();
      if (error) throw error;
      return data;
    },
    enabled: !!stakeholderId,
  });

  const { data: txns, isLoading: txnsLoading } = useQuery({
    queryKey: ['stakeholder_txns', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, txn_allocations(project_id, order_type, order_ref, allocated_amount, projects(name))')
        .eq('stakeholder_id', stakeholderId!)
        .order('date', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId,
  });

  const { data: workOrders, isLoading: wosLoading } = useQuery({
    queryKey: ['stakeholder_wos', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, projects(name)')
        .eq('stakeholder_id', stakeholderId!)
        .order('date_issued', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId,
  });

  const { data: stakeholderPOs } = useQuery({
    queryKey: ['stakeholder_po_bills', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('po_id, vendor_bill_number, vendor_bill_no, vendor_bill_amount, bill_recorded_at')
        .eq('stakeholder_id', stakeholderId!)
        .not('vendor_bill_amount', 'is', null)
        .gt('vendor_bill_amount', 0);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId,
  });

  // ─── Rating mutation ─────────────────────────────────────────────────────

  const updateRating = useMutation({
    mutationFn: async () => {
      const payload: any = { rating: rateOverall || null };
      payload.rating_delivery = rateDelivery > 0 ? rateDelivery : null;
      payload.rating_quality  = rateQuality  > 0 ? rateQuality  : null;
      payload.rating_pricing  = ratePricing  > 0 ? ratePricing  : null;
      const { error } = await supabase.from('stakeholders').update(payload).eq('stakeholder_id', stakeholderId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stakeholder', stakeholderId] });
      qc.invalidateQueries({ queryKey: ['stakeholders'] });
      setShowRateModal(false);
    },
  });

  // ─── Derived data ────────────────────────────────────────────────────────

  const activeTxns = (txns || []).filter(t => t.status !== 'Voided');
  const totalPaid   = activeTxns.reduce((s, t) => s + Number(t.total_amount || 0), 0);
  const advancePaid = activeTxns.filter(t => t.category === 'Advance')
    .reduce((s, t) => s + Number(t.total_amount || 0), 0);
  const runningPaid = activeTxns.filter(t => t.category === 'Running Bill')
    .reduce((s, t) => s + Number(t.total_amount || 0), 0);
  const totalWOValue = (workOrders || []).reduce((s, w) => s + Number(w.order_value || 0), 0);
  const netDue      = Math.max(0, totalWOValue - totalPaid);
  const netAdvance  = totalWOValue > 0 ? Math.max(0, totalPaid - totalWOValue) : 0;

  // Per-WO payment totals (from allocations)
  const woPayments: Record<string, number> = {};
  for (const t of activeTxns) {
    for (const alloc of (t.txn_allocations || [])) {
      if (alloc.order_type === 'WO' && alloc.order_ref) {
        woPayments[alloc.order_ref] = (woPayments[alloc.order_ref] || 0) + Number(alloc.allocated_amount || 0);
      }
    }
  }

  // WO order value map for progress computation
  const woValueMap: Record<string, number> = {};
  for (const wo of (workOrders || [])) {
    woValueMap[wo.wo_id] = Number(wo.order_value || 0);
  }

  // Two-pass: compute per-transaction WO cumulative paid across all time (not filtered)
  const _allChronoSorted = [...activeTxns].sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  const _woPaidRunning: Record<string, number> = {};
  const txnWoPaid: Record<string, number> = {};
  const txnWoId: Record<string, string> = {};
  const txnPoId: Record<string, string> = {};
  for (const t of _allChronoSorted) {
    const allocs: any[] = t.txn_allocations || [];
    const woAlloc = allocs.find((a: any) => a.order_type === 'WO');
    const poAlloc = allocs.find((a: any) => a.order_type === 'PO');
    if (woAlloc?.order_ref) {
      _woPaidRunning[woAlloc.order_ref] = (_woPaidRunning[woAlloc.order_ref] || 0) + Number(t.total_amount || 0);
      txnWoPaid[t.txn_id] = _woPaidRunning[woAlloc.order_ref];
      txnWoId[t.txn_id] = woAlloc.order_ref;
    }
    if (poAlloc?.order_ref) {
      txnPoId[t.txn_id] = poAlloc.order_ref;
    }
  }

  // ─── Date filter ─────────────────────────────────────────────────────────

  const now = new Date();
  const fyStart = now.getMonth() >= 3
    ? new Date(now.getFullYear(), 3, 1)
    : new Date(now.getFullYear() - 1, 3, 1);
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);
  const fyY = fyStart.getFullYear();

  const filterDate = (t: any) => {
    if (dateFilter === 'all') return true;
    const d = new Date(t.date);
    if (dateFilter === 'month')
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (dateFilter === '3m') return d >= threeMonthsAgo;
    if (dateFilter === 'fy') return d >= fyStart;
    return true;
  };

  // ─── Build ledger rows ───────────────────────────────────────────────────

  const chronoRows = [...activeTxns]
    .filter(filterDate)
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
    .map(t => {
      const allocs: any[] = t.txn_allocations || [];
      const project = allocs.length === 1
        ? (allocs[0].projects?.name || null)
        : allocs.length > 1 ? 'Multiple' : null;
      const woId = txnWoId[t.txn_id] || null;
      const poId = txnPoId[t.txn_id] || null;
      const woOrderValue = woId ? (woValueMap[woId] || 0) : 0;
      const woPaidCumulative = woId ? (txnWoPaid[t.txn_id] || 0) : 0;
      const woPctAtPoint = (woId && woOrderValue > 0)
        ? Math.min(100, Math.round((woPaidCumulative / woOrderValue) * 100))
        : null;
      return {
        id:               t.txn_id,
        type:             'payment' as const,
        date:             t.date,
        description:      t.category || 'Payment',
        subDesc:          t.remarks || null,
        project,
        ref:              woId || poId || null,
        woId,
        poId,
        mode:             t.payment_mode || null,
        debit:            Number(t.total_amount || 0),
        credit:           0,
        balance:          0,
        woOrderValue,
        woPaidCumulative,
        woPctAtPoint,
      };
    });

  // Running balance = cumulative paid (oldest → newest)
  let running = 0;
  chronoRows.forEach(r => { running += r.debit; r.balance = running; });

  // Newest first for display
  const displayRows = [...chronoRows].reverse();

  // Vendor bill credit rows (shown for Vendor stakeholders only)
  const creditRows = (stk?.type === 'Vendor' ? (stakeholderPOs || []) : [])
    .filter((po: any) => po.bill_recorded_at)
    .filter((po: any) => filterDate({ date: po.bill_recorded_at }))
    .map((po: any) => ({
      id:               `bill-${po.po_id}`,
      type:             'credit' as const,
      date:             po.bill_recorded_at,
      description:      'Vendor Bill',
      subDesc:          po.vendor_bill_number || po.vendor_bill_no || null,
      project:          null,
      ref:              po.po_id,
      woId:             null,
      poId:             po.po_id,
      mode:             null,
      debit:            0,
      credit:           Number(po.vendor_bill_amount || 0),
      balance:          0,
      woOrderValue:     0,
      woPaidCumulative: 0,
      woPctAtPoint:     null,
    }));

  // Merge payment + credit rows, newest first
  const allDisplayRows = [...displayRows, ...creditRows].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Group by month (all row types)
  const monthGroups = new Map<string, typeof allDisplayRows>();
  for (const row of allDisplayRows) {
    const key = monthKey(row.date);
    if (!monthGroups.has(key)) monthGroups.set(key, []);
    monthGroups.get(key)!.push(row);
  }

  const totalDebit = displayRows.reduce((s, r) => s + r.debit, 0);

  // ─── Loading / not found ─────────────────────────────────────────────────

  if (stkLoading) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6 max-w-[900px] mx-auto">
        <div className="h-8 w-48 bg-surface-container-highest rounded animate-pulse mb-4" />
        <div className="h-64 bg-surface-container-lowest rounded-xl animate-pulse" />
      </div>
    );
  }
  if (!stk) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <p className="text-error">Stakeholder not found.</p>
      </div>
    );
  }

  const contactParts = (stk.contact || '').split(/[,;/]/).map((s: string) => s.trim()).filter(Boolean);
  const phones = contactParts.filter((c: string) => !c.includes('@'));

  const openRateModal = () => {
    setRateOverall(stk.rating ?? 0);
    setRateDelivery(stk.rating_delivery ?? 0);
    setRateQuality(stk.rating_quality ?? 0);
    setRatePricing(stk.rating_pricing ?? 0);
    setShowRateSubcats(!!(stk.rating_delivery || stk.rating_quality || stk.rating_pricing));
    setShowRateModal(true);
  };

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-16 max-w-[900px] mx-auto">
      <Breadcrumb items={[
        { label: 'Dashboard', href: '/' },
        { label: 'Stakeholders', href: '/stakeholders' },
        { label: stk.name },
      ]} />

      {/* ── ZONE 1: IDENTITY ─────────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mt-4 mb-5">
        <div className="flex items-center gap-3">
          <div className={`w-11 h-11 rounded-full flex items-center justify-center text-[15px] font-bold shrink-0 ${
            stk.type === 'Worker'
              ? 'bg-primary-container text-on-primary'
              : 'bg-tertiary-container text-on-tertiary-container'
          }`}>
            {getInitials(stk.name)}
          </div>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-[20px] font-bold text-on-surface leading-tight">{stk.name}</h1>
              <span className={`px-2 py-0.5 text-[10px] font-bold rounded-full ${
                stk.type === 'Worker'
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'bg-surface-container-high text-on-surface'
              }`}>{stk.type?.toUpperCase()}</span>
              {stk.type === 'Vendor' && stk.is_approved && (
                <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">
                  <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                  Approved
                </span>
              )}
            </div>
            <p className="text-[12px] text-on-surface-variant mt-0.5">
              {stk.category}
              {phones[0] && <> · {phones[0]}</>}
              <span className="font-data-mono text-[11px] opacity-50 ml-1">· {stk.stakeholder_id}</span>
            </p>
            {stk.type === 'Vendor' && stk.rating != null && (
              <div className="mt-1">
                <StarDisplay value={stk.rating} size={13} />
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {stk.type === 'Vendor' && canManage && (
            <button onClick={openRateModal}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/40 text-[12px] font-medium text-on-surface-variant hover:bg-surface-container transition-colors">
              <span className="material-symbols-outlined text-[15px]">star</span>
              Rate
            </button>
          )}
          <button
            onClick={() => navigate('/ledger/new', {
              state: { stakeholderId: stk.stakeholder_id, stakeholderName: stk.name }
            })}
            className="bk-btn flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold"
          >
            <span className="material-symbols-outlined text-[16px]">add</span>
            Add Transaction
          </button>
        </div>
      </div>

      {/* ── ZONE 2: SUMMARY STRIP ────────────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-xl border border-black/[0.06] overflow-hidden mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 divide-y md:divide-y-0 divide-x divide-black/[0.06]">

          {/* Total Paid */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Total Paid</p>
            <p className="text-[22px] font-semibold tabular-nums text-on-surface leading-tight">
              {txnsLoading ? '—' : '₹' + fmt(totalPaid)}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-0.5">{activeTxns.length} transactions</p>
          </div>

          {/* Advances / POs */}
          {stk.type === 'Worker' ? (
            <div className="px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Advances</p>
              <p className="text-[22px] font-semibold tabular-nums text-on-surface leading-tight">
                {txnsLoading ? '—' : '₹' + fmt(advancePaid)}
              </p>
              <p className="text-[11px] text-on-surface-variant mt-0.5">Running bills ₹{fmt(runningPaid)}</p>
            </div>
          ) : (
            <div className="px-5 py-4">
              <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Total Orders</p>
              <p className="text-[22px] font-semibold tabular-nums text-on-surface leading-tight">
                {wosLoading ? '—' : '₹' + fmt(totalWOValue)}
              </p>
              <p className="text-[11px] text-on-surface-variant mt-0.5">{(workOrders || []).length} orders</p>
            </div>
          )}

          {/* WO Total */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
              {stk.type === 'Worker' ? 'Work Orders' : 'Order Value'}
            </p>
            <p className="text-[22px] font-semibold tabular-nums text-on-surface leading-tight">
              {wosLoading ? '—' : '₹' + fmt(totalWOValue)}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-0.5">{(workOrders || []).length} work orders</p>
          </div>

          {/* Balance */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Balance</p>
            {netDue > 0 ? (
              <>
                <p className="text-[22px] font-semibold tabular-nums text-[#DC2626] leading-tight">₹{fmt(netDue)}</p>
                <p className="text-[11px] text-[#DC2626] mt-0.5 font-medium">Due ↑</p>
              </>
            ) : netAdvance > 0 ? (
              <>
                <p className="text-[22px] font-semibold tabular-nums text-amber-600 leading-tight">₹{fmt(netAdvance)}</p>
                <p className="text-[11px] text-amber-600 mt-0.5 font-medium">Advance ↓</p>
              </>
            ) : (
              <>
                <p className="text-[22px] font-semibold tabular-nums text-green-600 leading-tight">₹0</p>
                <p className="text-[11px] text-green-600 mt-0.5 font-medium">Settled ✓</p>
              </>
            )}
          </div>
        </div>
      </div>

      {/* ── ZONE 3: LEDGER ───────────────────────────────────────────── */}
      <div className="mb-6">
        {/* Label + date filter chips */}
        <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
          <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant">Account Ledger</p>
          <div className="flex items-center gap-1.5 flex-wrap">
            {([
              { key: 'all',   label: 'All' },
              { key: 'month', label: 'This Month' },
              { key: '3m',    label: 'Last 3M' },
              { key: 'fy',    label: `FY ${fyY}–${String(fyY + 1).slice(2)}` },
            ] as { key: DateFilter; label: string }[]).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setDateFilter(key)}
                className={`px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                  dateFilter === key
                    ? 'bg-primary text-on-primary'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Table */}
        {txnsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-surface-container-highest rounded animate-pulse" />
            ))}
          </div>
        ) : allDisplayRows.length === 0 ? (
          <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-10 text-center">
            <span className="material-symbols-outlined text-[40px] text-on-surface-variant/30 mb-2 block">receipt_long</span>
            <p className="text-[13px] text-on-surface-variant">No transactions for this period.</p>
          </div>
        ) : (
          <div className="bg-surface-container-lowest rounded-xl border border-black/[0.06] overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-black/[0.06]">
                    <th className="text-left pl-4 pr-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant w-[80px]">Date</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Details</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hidden md:table-cell w-[120px]">Project</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hidden md:table-cell w-[100px]">Ref</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hidden md:table-cell w-[130px]">WO Progress</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hidden lg:table-cell w-[60px]">Mode</th>
                    <th className="text-right px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant w-[90px]">Debit</th>
                    <th className="text-right pl-3 pr-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant w-[100px]">Cumulative</th>
                  </tr>
                </thead>
                <tbody>
                  {Array.from(monthGroups.entries()).flatMap(([key, rows]) => {
                    const monthTotal = rows.filter(r => r.type === 'payment').reduce((s, r) => s + r.debit, 0);
                    return [
                      // Month header row
                      <tr key={`mh-${key}`} className="bg-surface-container-low/60">
                        <td colSpan={8} className="pl-4 pr-4 py-1.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
                            {monthHeading(key)}
                          </span>
                        </td>
                      </tr>,

                      // Transaction rows (payments + vendor bill credits)
                      ...rows.map(row => {
                        if (row.type === 'credit') {
                          return (
                            <tr
                              key={row.id}
                              onClick={() => navigate(`/purchase-orders/${row.ref}`)}
                              className="border-b border-black/[0.04] cursor-pointer transition-colors"
                              style={{ borderLeft: '3px solid #16a34a', backgroundColor: 'rgba(22,163,74,0.03)' }}
                            >
                              <td className="pl-4 pr-3 py-3 align-top">
                                <p className="text-[12px] font-medium whitespace-nowrap text-on-surface">{rowDateLabel(row.date)}</p>
                              </td>
                              <td className="px-3 py-3 align-top">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <p className="text-[13px] font-medium text-on-surface">{row.description}</p>
                                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-green-100 text-green-700">BILLED</span>
                                </div>
                                {row.subDesc && (
                                  <p className="text-[11px] text-on-surface-variant font-data-mono mt-0.5">{row.subDesc}</p>
                                )}
                              </td>
                              <td className="px-3 py-3 hidden md:table-cell">
                                <span className="text-on-surface-variant/30 text-[12px]">—</span>
                              </td>
                              <td className="px-3 py-3 hidden md:table-cell">
                                <button
                                  onMouseDown={e => { e.stopPropagation(); setPeek({ type: 'PO', id: row.ref! }); }}
                                  className="font-data-mono text-[11px] text-primary hover:underline flex items-center gap-0.5"
                                >
                                  {row.ref}
                                  <span className="material-symbols-outlined text-[10px] opacity-50">open_in_new</span>
                                </button>
                              </td>
                              <td className="px-3 py-3 hidden md:table-cell">
                                <span className="text-on-surface-variant/30 text-[12px]">—</span>
                              </td>
                              <td className="px-3 py-3 hidden lg:table-cell">
                                <span className="text-on-surface-variant/30 text-[12px]">—</span>
                              </td>
                              <td className="px-3 py-3 text-right">
                                <span className="text-[13px] font-semibold font-data-mono text-green-600">
                                  {fmt(row.credit)}
                                </span>
                              </td>
                              <td className="pl-3 pr-4 py-3 text-right">
                                <span className="text-on-surface-variant/30 text-[12px]">—</span>
                              </td>
                            </tr>
                          );
                        }

                        return (
                        <tr
                          key={row.id}
                          onClick={() => navigate(`/ledger/${row.id}`, {
                            state: { from: 'stakeholder', stakeholderId: stk.stakeholder_id, stakeholderName: stk.name }
                          })}
                          className="border-b border-black/[0.04] hover:bg-black/[0.02] cursor-pointer transition-colors"
                        >
                          {/* Date */}
                          <td className="pl-4 pr-3 py-3 align-top">
                            <p className={`text-[12px] font-medium whitespace-nowrap ${
                              rowDateLabel(row.date) === 'Today' ? 'text-[#C8603A]' : 'text-on-surface'
                            }`}>{rowDateLabel(row.date)}</p>
                          </td>

                          {/* Details */}
                          <td className="px-3 py-3 align-top">
                            <p className="text-[13px] font-medium text-on-surface leading-tight">{row.description}</p>
                            {row.subDesc && (
                              <p className="text-[11px] text-on-surface-variant italic mt-0.5 max-w-[200px] truncate">{row.subDesc}</p>
                            )}
                          </td>

                          {/* Project */}
                          <td className="px-3 py-3 align-top hidden md:table-cell">
                            <p className="text-[12px] text-on-surface-variant max-w-[110px] truncate">{row.project || '—'}</p>
                          </td>

                          {/* Ref */}
                          <td className="px-3 py-3 align-top hidden md:table-cell">
                            {row.ref ? (
                              <button
                                onMouseDown={e => { e.stopPropagation(); setPeek({ type: row.woId ? 'WO' : 'PO', id: row.ref! }); }}
                                className="font-data-mono text-[11px] text-primary hover:underline flex items-center gap-0.5"
                              >
                                {row.ref}
                                <span className="material-symbols-outlined text-[10px] opacity-50">open_in_new</span>
                              </button>
                            ) : (
                              <span className="text-on-surface-variant/40 text-[12px]">—</span>
                            )}
                          </td>

                          {/* WO Progress */}
                          <td className="px-3 py-3 align-top hidden md:table-cell">
                            {row.woPctAtPoint !== null ? (
                              <div>
                                <div className="flex items-center gap-1.5 mb-1">
                                  <div className="w-[80px] h-[4px] bg-surface-container-high rounded-full overflow-hidden">
                                    <div
                                      className="h-full rounded-full transition-all"
                                      style={{
                                        width: `${row.woPctAtPoint}%`,
                                        backgroundColor: row.woPctAtPoint === 100 ? '#16a34a' : '#C8603A',
                                      }}
                                    />
                                  </div>
                                  <span className="text-[11px] font-medium text-on-surface-variant">{row.woPctAtPoint}%</span>
                                </div>
                                <p className="text-[10px] text-on-surface-variant/50">
                                  ₹{fmt(row.woPaidCumulative)} / ₹{fmt(row.woOrderValue)}
                                </p>
                              </div>
                            ) : (
                              <span className="text-on-surface-variant/40 text-[12px]">—</span>
                            )}
                          </td>

                          {/* Mode */}
                          <td className="px-3 py-3 align-top hidden lg:table-cell">
                            <p className="text-[11px] text-on-surface-variant">{row.mode || '—'}</p>
                          </td>

                          {/* Debit */}
                          <td className="px-3 py-3 align-top text-right">
                            <span className="text-[13px] font-medium font-data-mono text-[#DC2626]">
                              {fmt(row.debit)}
                            </span>
                          </td>

                          {/* Cumulative balance */}
                          <td className="pl-3 pr-4 py-3 align-top text-right">
                            <span className="text-[12px] font-medium font-data-mono text-on-surface-variant">
                              {fmt(row.balance)}
                            </span>
                          </td>
                        </tr>
                        );
                      }),

                      // Month subtotal
                      <tr key={`ms-${key}`} className="border-b border-black/[0.06]">
                        <td colSpan={6} className="hidden md:table-cell" />
                        <td colSpan={2} className="pr-4 py-1.5 text-right">
                          <span className="text-[11px] text-on-surface-variant/60">
                            {monthHeading(key).split(' ')[0]} total:{' '}
                            <span className="font-semibold text-on-surface-variant">₹{fmt(monthTotal)}</span> paid
                          </span>
                        </td>
                      </tr>,
                    ];
                  })}
                </tbody>

                {/* Footer totals */}
                <tfoot>
                  <tr className="border-t-2 border-primary/20 bg-surface-container-low/40">
                    <td colSpan={6} className="pl-4 py-3 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant hidden md:table-cell">
                      Total
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="text-[14px] font-bold font-data-mono text-[#DC2626]">₹{fmt(totalDebit)}</span>
                    </td>
                    <td className="pl-3 pr-4 py-3 text-right">
                      <span className="text-[13px] font-semibold font-data-mono text-on-surface">₹{fmt(totalDebit)}</span>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Balance statement below table */}
            <div className="px-4 py-3 border-t border-black/[0.06] bg-surface-container-low/30">
              <p className="text-[12px] text-on-surface-variant">
                {netDue > 0 ? (
                  <>
                    <span className="font-semibold text-[#DC2626]">₹{fmt(netDue)}</span>
                    {' '}payable to {stk.name}
                  </>
                ) : netAdvance > 0 ? (
                  <>
                    <span className="font-semibold text-amber-600">₹{fmt(netAdvance)}</span>
                    {' '}advance outstanding — {stk.name} owes ₹{fmt(netAdvance)} worth of work
                  </>
                ) : (
                  <span className="text-green-600 font-medium">Account settled ✓</span>
                )}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* ── ZONE 4: WORK ORDERS ──────────────────────────────────────── */}
      <div className="mb-6">
        <button
          onClick={() => setShowWOs(v => !v)}
          className="flex items-center gap-1.5 mb-3 text-[11px] font-bold uppercase tracking-wider text-on-surface-variant hover:text-on-surface transition-colors"
        >
          <span className="material-symbols-outlined text-[16px]">
            {showWOs ? 'expand_less' : 'expand_more'}
          </span>
          {(workOrders || []).length} Work Order{(workOrders || []).length !== 1 ? 's' : ''}
          {!showWOs && (
            <span className="normal-case font-normal tracking-normal text-on-surface-variant/50 ml-1">· View →</span>
          )}
        </button>

        {showWOs && (
          <div className="space-y-2">
            {wosLoading ? (
              [0, 1, 2].map(i => (
                <div key={i} className="h-16 bg-surface-container-highest rounded-lg animate-pulse" />
              ))
            ) : (workOrders || []).length === 0 ? (
              <p className="text-[13px] text-on-surface-variant italic">No work orders found.</p>
            ) : (
              (workOrders || []).map((wo: any) => {
                const paid  = woPayments[wo.wo_id] || 0;
                const value = Number(wo.order_value || 0);
                const pct   = value > 0 ? Math.min(100, Math.round((paid / value) * 100)) : 0;
                const due   = Math.max(0, value - paid);
                return (
                  <div
                    key={wo.wo_id}
                    onClick={() => navigate(`/work-orders/${wo.wo_id}`, {
                      state: { from: 'stakeholder', stakeholderId: stk.stakeholder_id, stakeholderName: stk.name }
                    })}
                    className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-4 cursor-pointer hover:border-primary/30 hover:shadow-sm transition-all"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-data-mono text-[12px] text-primary font-semibold">{wo.wo_id}</span>
                          <span className="text-[12px] text-on-surface-variant">{wo.projects?.name || '—'}</span>
                        </div>
                        <p className="text-[13px] text-on-surface font-medium mt-0.5 truncate">{wo.scope_of_work}</p>
                      </div>
                      <span className={`shrink-0 px-2 py-0.5 rounded text-[10px] font-bold ${woStatusClass(wo.status)}`}>
                        {wo.status}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 text-[11px] text-on-surface-variant mb-2 flex-wrap">
                      <span>₹{fmt(value)} value</span>
                      <span>·</span>
                      <span>₹{fmt(paid)} paid</span>
                      {due > 0 && (
                        <><span>·</span><span className="text-[#DC2626] font-medium">₹{fmt(due)} due</span></>
                      )}
                    </div>
                    <div className="w-full h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full transition-all"
                        style={{ width: `${pct}%`, backgroundColor: pct === 100 ? '#16a34a' : '#6366f1' }}
                      />
                    </div>
                    <p className="text-[10px] text-on-surface-variant/50 mt-1">{pct}% paid</p>
                  </div>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* ── PEEK ─────────────────────────────────────────────────────── */}
      {peek?.type === 'WO' && (
        <WOPeek woId={peek.id} onClose={() => setPeek(null)} session={session} />
      )}
      {peek?.type === 'PO' && (
        <POPeek poId={peek.id} onClose={() => setPeek(null)} />
      )}

      {/* ── RATING MODAL ─────────────────────────────────────────────── */}
      {showRateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm"
          onClick={() => setShowRateModal(false)}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4"
            onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-headline-sm font-bold">Rate {stk.name}</h3>
              <button onClick={() => setShowRateModal(false)}
                className="p-1.5 hover:bg-surface-container rounded-lg transition-colors">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-2 block">
                  Overall Rating
                </label>
                <div className="flex items-center gap-3">
                  <StarRating value={rateOverall} onChange={setRateOverall} />
                  {rateOverall > 0
                    ? <span className="text-body-sm font-semibold text-on-surface">{rateOverall}/5</span>
                    : <span className="text-body-sm text-on-surface-variant italic">Not rated</span>}
                </div>
              </div>

              {rateOverall > 0 && (
                <button type="button"
                  onClick={() => setShowRateSubcats(v => !v)}
                  className="flex items-center gap-1.5 text-[12px] text-primary hover:underline">
                  <span className="material-symbols-outlined text-[14px]">
                    {showRateSubcats ? 'expand_less' : 'expand_more'}
                  </span>
                  {showRateSubcats ? 'Hide' : 'Add'} subcategory ratings
                </button>
              )}

              {showRateSubcats && (
                <div className="pl-4 border-l-2 border-outline-variant/30 space-y-3">
                  {([
                    { label: 'Delivery', value: rateDelivery, onChange: setRateDelivery },
                    { label: 'Quality',  value: rateQuality,  onChange: setRateQuality  },
                    { label: 'Pricing',  value: ratePricing,  onChange: setRatePricing  },
                  ] as const).map(r => (
                    <div key={r.label}>
                      <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-1.5 block">
                        {r.label}
                      </label>
                      <div className="flex items-center gap-3">
                        <StarRating value={r.value} onChange={r.onChange} />
                        {r.value > 0 && <span className="text-body-sm text-on-surface-variant">{r.value}/5</span>}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="flex gap-3 justify-end mt-6 pt-4 border-t border-outline-variant/20">
              <button onClick={() => setShowRateModal(false)}
                className="bk-btn-ghost px-4 py-2 rounded-xl text-body-sm">Cancel</button>
              <button
                disabled={updateRating.isPending}
                onClick={() => updateRating.mutate()}
                className="bk-btn px-5 py-2 rounded-xl text-body-sm disabled:opacity-50"
              >
                {updateRating.isPending ? 'Saving…' : 'Save Rating'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
