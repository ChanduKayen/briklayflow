import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import Breadcrumb from '../components/Breadcrumb';
import { useUserProfile } from '../App';
import { usePeek } from '../context/PeekContext';
import { StarDisplay } from './Stakeholders';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string) {
  return name.split(' ').slice(0, 2).map(w => w[0] || '').join('').toUpperCase();
}

function fmt(n: number) {
  return Math.abs(n).toLocaleString('en-IN');
}

function formatLedgerDate(dateStr: string): string {
  const d = new Date(dateStr);
  d.setHours(0, 0, 0, 0);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const yesterday = new Date(today); yesterday.setDate(today.getDate() - 1);
  if (d.getTime() === today.getTime()) return 'Today';
  if (d.getTime() === yesterday.getTime()) return 'Yesterday';
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  if (d.getFullYear() !== today.getFullYear()) opts.year = 'numeric';
  return d.toLocaleDateString('en-IN', opts);
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
  const [sortByDate, setSortByDate] = useState(false);
  const { openPeek } = usePeek();

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

  const stkType: string = stk?.type || 'Vendor'; // 'Vendor' | 'Worker' | 'Client'
  const activeTxns = (txns || []).filter((t: any) => t.status !== 'Voided');

  // ── Build ledger rows ────────────────────────────────────────────────

  interface LedgerRow {
    id: string;
    date: string;
    particulars: string;
    detail: string | null;
    project: string | null;
    ref_id: string | null;
    ref_number: string | null;
    ref_type: 'PO' | 'WO' | 'INV' | null;
    debit: number;
    credit: number;
    entry_type: 'DEBIT' | 'CREDIT';
    source: string;
    txn_id: string | null;
    txn_link: string | null;
    runningBalance: number;
  }

  const rawRows: Omit<LedgerRow, 'runningBalance'>[] = [];

  if (stkType === 'Vendor') {
    // CREDIT — vendor gave material (bill recorded)
    for (const po of (stakeholderPOs || [])) {
      if (!po.bill_recorded_at) continue;
      rawRows.push({
        id: `bill-${po.po_id}`,
        date: po.bill_recorded_at,
        particulars: 'By Purchase',
        detail: po.vendor_bill_number || po.vendor_bill_no || null,
        project: null,
        ref_id: po.po_id,
        ref_number: po.po_id,
        ref_type: 'PO',
        debit: 0,
        credit: Number(po.vendor_bill_amount || 0),
        entry_type: 'CREDIT',
        source: 'VENDOR_BILL',
        txn_id: null,
        txn_link: null,
      });
    }
    // DEBIT — you paid vendor
    for (const t of activeTxns) {
      const allocs: any[] = t.txn_allocations || [];
      const project = allocs.length === 1 ? (allocs[0].projects?.name || null) : allocs.length > 1 ? 'Multiple' : null;
      const poAlloc = allocs.find((a: any) => a.order_type === 'PO');
      rawRows.push({
        id: `txn-${t.txn_id}`,
        date: t.date,
        particulars: `To ${t.payment_mode || 'Cash'}`,
        detail: t.category + (t.remarks ? ` — ${t.remarks}` : ''),
        project,
        ref_id: poAlloc?.order_ref || null,
        ref_number: poAlloc?.order_ref || null,
        ref_type: poAlloc ? 'PO' : null,
        debit: Number(t.total_amount || 0),
        credit: 0,
        entry_type: 'DEBIT',
        source: 'PAYMENT',
        txn_id: t.txn_id,
        txn_link: `/ledger/${t.txn_id}`,
      });
    }
  }

  if (stkType === 'Worker') {
    // CREDIT — worker gave labour (milestone certified/paid)
    // NOTE: wo_milestones not yet included in workOrders query — add
    // .select('*, projects(name), wo_milestones(*)') to enable this path
    for (const wo of (workOrders || [])) {
      for (const m of ((wo as any).wo_milestones || [])) {
        if (m.status !== 'PAID') continue;
        rawRows.push({
          id: `ms-${m.milestone_id}`,
          date: m.updated_at || wo.date_issued,
          particulars: 'By Work Done',
          detail: m.name,
          project: wo.projects?.name || null,
          ref_id: wo.wo_id,
          ref_number: wo.wo_id,
          ref_type: 'WO',
          debit: 0,
          credit: Number(m.planned_amount || 0),
          entry_type: 'CREDIT',
          source: 'MILESTONE',
          txn_id: null,
          txn_link: null,
        });
      }
    }
    // DEBIT — you paid worker
    for (const t of activeTxns) {
      const allocs: any[] = t.txn_allocations || [];
      const project = allocs.length === 1 ? (allocs[0].projects?.name || null) : allocs.length > 1 ? 'Multiple' : null;
      const woAlloc = allocs.find((a: any) => a.order_type === 'WO');
      rawRows.push({
        id: `txn-${t.txn_id}`,
        date: t.date,
        particulars: `To ${t.payment_mode || 'Cash'}`,
        detail: t.category + (t.remarks ? ` — ${t.remarks}` : ''),
        project,
        ref_id: woAlloc?.order_ref || null,
        ref_number: woAlloc?.order_ref || null,
        ref_type: woAlloc ? 'WO' : null,
        debit: Number(t.total_amount || 0),
        credit: 0,
        entry_type: 'DEBIT',
        source: 'PAYMENT',
        txn_id: t.txn_id,
        txn_link: `/ledger/${t.txn_id}`,
      });
    }
  }

  if (stkType === 'Client') {
    // DEBIT — client received work (invoices)
    // Note: client invoices would come from a separate query; use activeTxns tagged as receipts for now
    // CREDIT — client paid (receipts = transactions on client account)
    for (const t of activeTxns) {
      const allocs: any[] = t.txn_allocations || [];
      const project = allocs.length === 1 ? (allocs[0].projects?.name || null) : allocs.length > 1 ? 'Multiple' : null;
      rawRows.push({
        id: `txn-${t.txn_id}`,
        date: t.date,
        particulars: `By ${t.payment_mode || 'Cash'}`,
        detail: t.category + (t.remarks ? ` — ${t.remarks}` : ''),
        project,
        ref_id: null,
        ref_number: null,
        ref_type: null,
        debit: 0,
        credit: Number(t.total_amount || 0),
        entry_type: 'CREDIT',
        source: 'RECEIPT',
        txn_id: t.txn_id,
        txn_link: `/ledger/${t.txn_id}`,
      });
    }
  }

  // Apply date filter
  const now2 = new Date();
  const fyStart2 = now2.getMonth() >= 3
    ? new Date(now2.getFullYear(), 3, 1)
    : new Date(now2.getFullYear() - 1, 3, 1);
  const threeMonthsAgo2 = new Date(now2);
  threeMonthsAgo2.setMonth(now2.getMonth() - 3);

  const filterRow = (row: Omit<LedgerRow, 'runningBalance'>) => {
    if (dateFilter === 'all') return true;
    const d = new Date(row.date);
    if (dateFilter === 'month') return d.getFullYear() === now2.getFullYear() && d.getMonth() === now2.getMonth();
    if (dateFilter === '3m') return d >= threeMonthsAgo2;
    if (dateFilter === 'fy') return d >= fyStart2;
    return true;
  };

  const filteredRows = rawRows.filter(filterRow);

  // Sort oldest first for running balance
  filteredRows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Running balance (Credit increases, Debit decreases)
  let runningBal = 0;
  const ledgerRows: LedgerRow[] = filteredRows.map(row => {
    runningBal += row.credit;
    runningBal -= row.debit;
    return { ...row, runningBalance: runningBal };
  });

  // Newest first for display
  const displayRows = [...ledgerRows].reverse();

  // Build PO/WO groups (default view)
  const seenGroupKeys = new Set<string>();
  const groupOrder: string[] = [];
  const poGroupsMap = new Map<string, LedgerRow[]>();
  for (const row of displayRows) {
    const key = row.ref_id || 'unlinked';
    if (!seenGroupKeys.has(key)) { seenGroupKeys.add(key); groupOrder.push(key); }
    if (!poGroupsMap.has(key)) poGroupsMap.set(key, []);
    poGroupsMap.get(key)!.push(row);
  }
  // Unlinked group goes last
  const orderedGroupKeys = [
    ...groupOrder.filter(k => k !== 'unlinked'),
    ...(groupOrder.includes('unlinked') ? ['unlinked'] : []),
  ];

  // Group by month
  const monthGroups = new Map<string, LedgerRow[]>();
  for (const row of displayRows) {
    const key = monthKey(row.date);
    if (!monthGroups.has(key)) monthGroups.set(key, []);
    monthGroups.get(key)!.push(row);
  }

  const totalDebit  = ledgerRows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
  const finalBalance = totalCredit - totalDebit; // Cr positive = payable, Dr negative = advance

  // Summary strip values
  const totalPaid = activeTxns.reduce((s: number, t: any) => s + Number(t.total_amount || 0), 0);
  const totalBilled = (stakeholderPOs || []).reduce((s: number, po: any) => s + Number(po.vendor_bill_amount || 0), 0);
  const totalWOValue = (workOrders || []).reduce((s: number, w: any) => s + Number(w.order_value || 0), 0);

  // Per-WO payment totals (for WO cards in Zone 4)
  const woPayments: Record<string, number> = {};
  for (const t of activeTxns) {
    for (const alloc of (t.txn_allocations || [])) {
      if (alloc.order_type === 'WO' && alloc.order_ref) {
        woPayments[alloc.order_ref] = (woPayments[alloc.order_ref] || 0) + Number(alloc.allocated_amount || 0);
      }
    }
  }

  // FY label for filter chips
  const fyY = fyStart2.getFullYear();

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

          {/* Col 1: Credit (for vendor/worker) or Debit (for client) */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
              {stkType === 'Client' ? 'Total Invoiced' : 'Total Credit'}
            </p>
            <p className="text-[22px] font-semibold tabular-nums text-[#16A34A] leading-tight">
              {txnsLoading ? '—' : `₹${fmt(stkType === 'Vendor' ? totalBilled : stkType === 'Worker' ? totalCredit : totalDebit)}`}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-0.5">
              {stkType === 'Client' ? 'invoices raised' : stkType === 'Vendor' ? 'bills recorded' : 'work certified'}
            </p>
          </div>

          {/* Col 2: Debit (for vendor/worker) or Credit (for client) */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
              {stkType === 'Client' ? 'Total Received' : 'Total Debit'}
            </p>
            <p className="text-[22px] font-semibold tabular-nums text-on-surface leading-tight">
              {txnsLoading ? '—' : `₹${fmt(totalPaid)}`}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-0.5">
              {activeTxns.length} payments
            </p>
          </div>

          {/* Col 3: Balance */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">Balance</p>
            {finalBalance > 0 ? (
              <>
                <p className="text-[22px] font-semibold tabular-nums text-[#DC2626] leading-tight">₹{fmt(finalBalance)}</p>
                <p className="text-[11px] text-[#DC2626] mt-0.5 font-medium">
                  {stkType === 'Client' ? 'Receivable Dr' : 'Payable Cr'}
                </p>
              </>
            ) : finalBalance < 0 ? (
              <>
                <p className="text-[22px] font-semibold tabular-nums text-amber-600 leading-tight">₹{fmt(Math.abs(finalBalance))}</p>
                <p className="text-[11px] text-amber-600 mt-0.5 font-medium">
                  {stkType === 'Client' ? 'Advance Cr' : 'Advance Dr'}
                </p>
              </>
            ) : (
              <>
                <p className="text-[22px] font-semibold tabular-nums text-green-600 leading-tight">Nil</p>
                <p className="text-[11px] text-green-600 mt-0.5 font-medium">Settled ✓</p>
              </>
            )}
          </div>

          {/* Col 4: Orders count */}
          <div className="px-5 py-4">
            <p className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant mb-1">
              {stkType === 'Client' ? 'Transactions' : stkType === 'Worker' ? 'Work Orders' : 'Orders'}
            </p>
            <p className="text-[22px] font-semibold tabular-nums text-on-surface leading-tight">
              {stkType === 'Worker' ? (workOrders || []).length : activeTxns.length}
            </p>
            <p className="text-[11px] text-on-surface-variant mt-0.5">
              {stkType === 'Vendor' ? `${(stakeholderPOs || []).length} POs with bills` : stkType === 'Worker' ? `₹${fmt(totalWOValue)} total value` : 'receipts'}
            </p>
          </div>
        </div>
      </div>

      {/* ── ZONE 3: LEDGER ───────────────────────────────────────────── */}
      <div className="mb-6">
        {/* Label + date filter chips + view toggle */}
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
            <span className="w-px h-3 bg-outline-variant/40 mx-0.5" />
            <button
              onClick={() => setSortByDate(v => !v)}
              title={sortByDate ? 'Switch to group by PO' : 'Switch to sort by date'}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-medium transition-colors ${
                sortByDate
                  ? 'bg-secondary-container text-on-secondary-container'
                  : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
              }`}
            >
              <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>
                {sortByDate ? 'calendar_month' : 'folder_open'}
              </span>
              {sortByDate ? 'By Date' : 'By PO'}
            </button>
          </div>
        </div>

        {/* Table */}
        {txnsLoading ? (
          <div className="space-y-2">
            {[0, 1, 2, 3].map(i => (
              <div key={i} className="h-12 bg-surface-container-highest rounded animate-pulse" />
            ))}
          </div>
        ) : displayRows.length === 0 ? (
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
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Particulars</th>
                    <th className="text-left px-3 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant hidden md:table-cell w-[110px]">Ref</th>
                    <th className="text-right px-3 py-2.5 w-[110px] hidden md:table-cell">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Debit</div>
                      <div className="text-[9px] font-normal text-on-surface-variant/50 mt-0.5">
                        {stkType === 'Client' ? '(Work Done)' : '(Payment Made)'}
                      </div>
                    </th>
                    <th className="text-right px-3 py-2.5 w-[110px]">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant">Credit</div>
                      <div className="text-[9px] font-normal text-on-surface-variant/50 mt-0.5">
                        {stkType === 'Client' ? '(Payment Recd)' : '(Bill / Work)'}
                      </div>
                    </th>
                    <th className="text-right pl-3 pr-4 py-2.5 text-[10px] font-bold uppercase tracking-wider text-on-surface-variant w-[120px]">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {sortByDate
                    /* ── DATE VIEW: group by month ─────────────────────── */
                    ? Array.from(monthGroups.entries()).flatMap(([key, rows]) => {
                        const monthDebits  = rows.reduce((s, r) => s + r.debit, 0);
                        const monthCredits = rows.reduce((s, r) => s + r.credit, 0);
                        return [
                          <tr key={`mh-${key}`} className="bg-surface-container-low/60">
                            <td colSpan={6} className="pl-4 pr-4 py-1.5">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/60">
                                {monthHeading(key)}
                              </span>
                            </td>
                          </tr>,
                          ...rows.map(row => {
                            const bal = row.runningBalance;
                            const balLabel = bal > 0 ? `₹${fmt(bal)} Cr` : bal < 0 ? `₹${fmt(Math.abs(bal))} Dr` : 'Nil';
                            const balColor = bal > 0 ? 'text-[#DC2626]' : bal < 0 ? 'text-[#D97706]' : 'text-[#16A34A]';
                            const isCredit = row.entry_type === 'CREDIT';
                            return (
                              <tr key={row.id} onClick={() => row.txn_link && navigate(row.txn_link)}
                                className={`border-b border-black/[0.04] transition-colors ${row.txn_link ? 'cursor-pointer hover:bg-black/[0.02]' : ''} ${isCredit ? 'bg-[rgba(22,163,74,0.02)]' : 'bg-white'}`}>
                                <td className="pl-4 pr-3 py-3 align-top w-[80px]">
                                  <p className={`text-[12px] font-medium whitespace-nowrap ${formatLedgerDate(row.date) === 'Today' ? 'text-[#C8603A]' : 'text-on-surface'}`}>{formatLedgerDate(row.date)}</p>
                                </td>
                                <td className="px-3 py-3 align-top">
                                  <p className={`text-[13px] font-medium ${isCredit ? 'text-[#16A34A]' : 'text-on-surface'}`}>{row.particulars}</p>
                                  {row.detail && <p className="text-[11px] text-on-surface-variant italic mt-0.5">{row.detail}</p>}
                                  {row.project && <p className="text-[11px] text-on-surface-variant/60 mt-0.5">{row.project}</p>}
                                  <span className={`inline-block mt-1 text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${isCredit ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {row.source === 'VENDOR_BILL' ? 'Bill' : row.source === 'PAYMENT' ? 'Payment' : row.source === 'MILESTONE' ? 'Certified' : row.source === 'INVOICE' ? 'Invoice' : row.source === 'RECEIPT' ? 'Receipt' : row.source}
                                  </span>
                                </td>
                                <td className="px-3 py-3 align-top hidden md:table-cell w-[110px]">
                                  {row.ref_number ? (
                                    <button type="button" onMouseDown={e => { e.stopPropagation(); openPeek(row.ref_type === 'WO' ? 'WO' : 'PO', row.ref_id!); }}
                                      className="font-data-mono text-[11px] text-primary hover:underline text-left">{row.ref_number} ↗</button>
                                  ) : <span className="text-on-surface-variant/40 text-[12px]">—</span>}
                                  {row.txn_id && <p className="font-data-mono text-[10px] text-on-surface-variant/50 mt-0.5">{row.txn_id}</p>}
                                </td>
                                <td className="px-3 py-3 align-top text-right w-[110px] hidden md:table-cell">
                                  {row.entry_type === 'DEBIT' ? <span className="text-[13px] font-semibold font-data-mono text-on-surface">{fmt(row.debit)}</span> : <span className="text-[12px] text-on-surface-variant/40">—</span>}
                                </td>
                                <td className="px-3 py-3 align-top text-right w-[110px]">
                                  {row.entry_type === 'CREDIT' ? <span className="text-[13px] font-semibold font-data-mono text-[#16A34A]">{fmt(row.credit)}</span> : <span className="text-[12px] text-on-surface-variant/40">—</span>}
                                </td>
                                <td className={`pl-3 pr-4 py-3 align-top text-right w-[120px] ${balColor}`}>
                                  <span className="text-[13px] font-semibold font-data-mono">{balLabel}</span>
                                </td>
                              </tr>
                            );
                          }),
                          <tr key={`ms-${key}`} className="bg-[rgba(0,0,0,0.02)] border-b border-outline-variant/10">
                            <td colSpan={3} className="py-2 pl-4 text-[11px] text-on-surface-variant/60 italic hidden md:table-cell">Month total</td>
                            <td className="py-2 px-3 text-right text-[12px] font-data-mono font-medium hidden md:table-cell">{monthDebits > 0 ? fmt(monthDebits) : '—'}</td>
                            <td className="py-2 px-3 text-right text-[12px] font-data-mono font-medium text-[#16A34A]">{monthCredits > 0 ? fmt(monthCredits) : '—'}</td>
                            <td />
                          </tr>,
                        ];
                      })

                    /* ── PO GROUP VIEW: group by PO/WO ref ─────────────── */
                    : orderedGroupKeys.flatMap(groupKey => {
                        const rows = poGroupsMap.get(groupKey)!;
                        const groupCr  = rows.reduce((s, r) => s + r.credit, 0);
                        const groupDr  = rows.reduce((s, r) => s + r.debit, 0);
                        const groupBal = groupCr - groupDr;
                        const borderColor = groupBal > 0 ? '#DC2626' : groupBal < 0 ? '#D97706' : '#16A34A';
                        const bgTint     = groupBal > 0 ? 'rgba(220,38,38,0.025)' : groupBal < 0 ? 'rgba(217,119,6,0.025)' : 'rgba(22,163,74,0.025)';
                        const refType    = rows[0]?.ref_type;
                        return [
                          /* Group header row */
                          <tr key={`gh-${groupKey}`}
                            style={{ boxShadow: `inset 3px 0 0 ${borderColor}`, backgroundColor: 'rgba(0,0,0,0.02)' }}
                            className="border-t border-black/[0.07]">
                            <td colSpan={6} className="pl-4 pr-4 py-2.5">
                              <div className="flex items-center justify-between gap-3 flex-wrap">
                                <div className="flex items-center gap-2">
                                  {groupKey !== 'unlinked' && (
                                    <span className={`text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${
                                      refType === 'WO' ? 'bg-secondary-container text-on-secondary-container' : 'bg-surface-container-high text-on-surface-variant'
                                    }`}>{refType || 'PO'}</span>
                                  )}
                                  {groupKey !== 'unlinked' ? (
                                    <button type="button"
                                      onMouseDown={e => { e.stopPropagation(); openPeek(refType === 'WO' ? 'WO' : 'PO', groupKey); }}
                                      className="font-data-mono text-[12px] font-semibold text-on-surface hover:text-primary hover:underline">
                                      {groupKey} ↗
                                    </button>
                                  ) : (
                                    <span className="text-[12px] text-on-surface-variant/60 italic">Other transactions</span>
                                  )}
                                  <span className="text-[10px] text-on-surface-variant/40">{rows.length} {rows.length === 1 ? 'entry' : 'entries'}</span>
                                </div>
                                <div className="flex items-center gap-4 text-[11px]">
                                  {groupCr > 0 && (
                                    <span className="text-on-surface-variant/60">Cr <span className="font-data-mono font-semibold text-[#16A34A]">₹{fmt(groupCr)}</span></span>
                                  )}
                                  {groupDr > 0 && (
                                    <span className="text-on-surface-variant/60">Dr <span className="font-data-mono font-semibold text-on-surface">₹{fmt(groupDr)}</span></span>
                                  )}
                                  <span className="font-semibold font-data-mono text-[12px]" style={{ color: borderColor }}>
                                    {groupBal > 0 ? `₹${fmt(groupBal)} due` : groupBal < 0 ? `₹${fmt(Math.abs(groupBal))} advance` : 'Settled ✓'}
                                  </span>
                                </div>
                              </div>
                            </td>
                          </tr>,

                          /* Data rows */
                          ...rows.map(row => {
                            const bal = row.runningBalance;
                            const balLabel = bal > 0 ? `₹${fmt(bal)} Cr` : bal < 0 ? `₹${fmt(Math.abs(bal))} Dr` : 'Nil';
                            const balColor = bal > 0 ? '#DC2626' : bal < 0 ? '#D97706' : '#16A34A';
                            const isCredit = row.entry_type === 'CREDIT';
                            return (
                              <tr key={row.id}
                                onClick={() => row.txn_link && navigate(row.txn_link)}
                                style={{ boxShadow: `inset 3px 0 0 ${borderColor}`, backgroundColor: bgTint }}
                                className={`border-b border-black/[0.04] transition-all ${row.txn_link ? 'cursor-pointer hover:brightness-95' : ''}`}>
                                <td className="pl-4 pr-3 py-3 align-top w-[80px]">
                                  <p className={`text-[12px] font-medium whitespace-nowrap ${formatLedgerDate(row.date) === 'Today' ? 'text-[#C8603A]' : 'text-on-surface'}`}>{formatLedgerDate(row.date)}</p>
                                </td>
                                <td className="px-3 py-3 align-top">
                                  <p className={`text-[13px] font-medium ${isCredit ? 'text-[#16A34A]' : 'text-on-surface'}`}>{row.particulars}</p>
                                  {row.detail && <p className="text-[11px] text-on-surface-variant italic mt-0.5">{row.detail}</p>}
                                  {row.project && <p className="text-[11px] text-on-surface-variant/60 mt-0.5">{row.project}</p>}
                                  <span className={`inline-block mt-1 text-[9px] font-medium uppercase tracking-wide px-1.5 py-0.5 rounded-sm ${isCredit ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                                    {row.source === 'VENDOR_BILL' ? 'Bill' : row.source === 'PAYMENT' ? 'Payment' : row.source === 'MILESTONE' ? 'Certified' : row.source === 'INVOICE' ? 'Invoice' : row.source === 'RECEIPT' ? 'Receipt' : row.source}
                                  </span>
                                </td>
                                <td className="px-3 py-3 align-top hidden md:table-cell w-[110px]">
                                  {row.ref_number ? (
                                    <button type="button" onMouseDown={e => { e.stopPropagation(); openPeek(row.ref_type === 'WO' ? 'WO' : 'PO', row.ref_id!); }}
                                      className="font-data-mono text-[11px] text-primary hover:underline text-left">{row.ref_number} ↗</button>
                                  ) : <span className="text-on-surface-variant/40 text-[12px]">—</span>}
                                  {row.txn_id && <p className="font-data-mono text-[10px] text-on-surface-variant/50 mt-0.5">{row.txn_id}</p>}
                                </td>
                                <td className="px-3 py-3 align-top text-right w-[110px] hidden md:table-cell">
                                  {row.entry_type === 'DEBIT' ? <span className="text-[13px] font-semibold font-data-mono text-on-surface">{fmt(row.debit)}</span> : <span className="text-[12px] text-on-surface-variant/40">—</span>}
                                </td>
                                <td className="px-3 py-3 align-top text-right w-[110px]">
                                  {row.entry_type === 'CREDIT' ? <span className="text-[13px] font-semibold font-data-mono text-[#16A34A]">{fmt(row.credit)}</span> : <span className="text-[12px] text-on-surface-variant/40">—</span>}
                                </td>
                                <td className="pl-3 pr-4 py-3 align-top text-right w-[120px]">
                                  <span className="text-[13px] font-semibold font-data-mono" style={{ color: balColor }}>{balLabel}</span>
                                </td>
                              </tr>
                            );
                          }),
                        ];
                      })
                  }
                </tbody>

                {/* Footer totals */}
                <tfoot>
                  <tr className="border-t-2 border-on-surface/20 bg-[rgba(0,0,0,0.02)]">
                    <td colSpan={3} className="py-3 pl-4 text-[12px] font-bold uppercase tracking-wide hidden md:table-cell">
                      Total
                    </td>
                    <td className="py-3 px-3 text-right text-[14px] font-bold font-data-mono hidden md:table-cell">
                      {fmt(totalDebit)}
                    </td>
                    <td className="py-3 px-3 text-right text-[14px] font-bold font-data-mono text-[#16A34A]">
                      {fmt(totalCredit)}
                    </td>
                    <td className={`py-3 pl-3 pr-4 text-right text-[14px] font-bold font-data-mono ${finalBalance > 0 ? 'text-[#DC2626]' : finalBalance < 0 ? 'text-[#D97706]' : 'text-[#16A34A]'}`}>
                      {finalBalance > 0 ? `${fmt(finalBalance)} Cr` : finalBalance < 0 ? `${fmt(Math.abs(finalBalance))} Dr` : 'Nil'}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Balance statement below table */}
            <div className="px-4 py-3 border-t border-black/[0.06] bg-surface-container-low/30">
              {finalBalance > 0 ? (
                <p className="text-[13px] font-medium text-[#DC2626]">
                  Balance Payable: ₹{fmt(finalBalance)} Cr
                  <span className="text-[11px] font-normal text-on-surface-variant ml-2">(payable to {stk.name})</span>
                </p>
              ) : finalBalance < 0 ? (
                <p className="text-[13px] font-medium text-[#D97706]">
                  Advance Balance: ₹{fmt(Math.abs(finalBalance))} Dr
                  <span className="text-[11px] font-normal text-on-surface-variant ml-2">({stk.name} owes Briklay)</span>
                </p>
              ) : (
                <p className="text-[13px] font-medium text-[#16A34A]">Account settled — Nil balance</p>
              )}
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
