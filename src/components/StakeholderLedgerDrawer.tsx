import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { usePeek } from '../context/PeekContext';
import { StarDisplay } from '../pages/Stakeholders';

// ── Types ─────────────────────────────────────────────────────────────────────

interface StakeholderLedgerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  stakeholderId: string;
}

type DateFilter = 'all' | 'month' | '3m' | 'fy';

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

// ── Helpers ───────────────────────────────────────────────────────────────────

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

// ── Skeleton Loader Component ──────────────────────────────────────────────────

function DrawerSkeleton() {
  return (
    <div className="space-y-6 animate-pulse p-6">
      <div className="flex items-center gap-3">
        <div className="w-12 h-12 bg-stone-200 rounded-full" />
        <div className="space-y-2">
          <div className="h-4 w-48 bg-stone-200 rounded" />
          <div className="h-3 w-32 bg-stone-200 rounded" />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="h-20 bg-stone-100 rounded-xl" />
        <div className="h-20 bg-stone-100 rounded-xl" />
        <div className="h-20 bg-stone-100 rounded-xl" />
      </div>
      <div className="space-y-3">
        <div className="h-8 bg-stone-100 rounded" />
        <div className="h-16 bg-stone-50 rounded-xl border border-stone-200/40" />
        <div className="h-16 bg-stone-50 rounded-xl border border-stone-200/40" />
        <div className="h-16 bg-stone-50 rounded-xl border border-stone-200/40" />
      </div>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function StakeholderLedgerDrawer({
  isOpen,
  onClose,
  stakeholderId,
}: StakeholderLedgerDrawerProps) {
  const navigate = useNavigate();
  const { openPeek } = usePeek();

  // Drawer transition mounting states
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  // Filters and Grouping toggles
  const [dateFilter, setDateFilter] = useState<DateFilter>('all');
  const [sortByDate, setSortByDate] = useState(false); // Default to group by PO

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      // Double requestAnimationFrame guarantees the DOM is painted so CSS transition plays smoothly
      requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
    }
  }, [isOpen]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => {
      setMounted(false);
      setClosing(false);
      onClose();
    }, 350); // Matches transition duration
  };

  // Close on Escape Key
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        handleClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen]);

  // ── Queries ─────────────────────────────────────────────────────────────────

  const { data: stk, isLoading: stkLoading } = useQuery({
    queryKey: ['stk_drawer_stk', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stakeholders')
        .select('*')
        .eq('stakeholder_id', stakeholderId)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!stakeholderId && isOpen,
  });

  const { data: txns, isLoading: txnsLoading } = useQuery({
    queryKey: ['stk_drawer_txns', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, txn_allocations(project_id, order_type, order_ref, allocated_amount, projects(name))')
        .eq('stakeholder_id', stakeholderId)
        .order('date', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId && isOpen,
  });

  const { data: workOrders, isLoading: wosLoading } = useQuery({
    queryKey: ['stk_drawer_wos', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, projects(name), wo_milestones(*)')
        .eq('stakeholder_id', stakeholderId)
        .order('date_issued', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId && isOpen,
  });

  const { data: stakeholderPOs, isLoading: posLoading } = useQuery({
    queryKey: ['stk_drawer_pos', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('po_id, vendor_bill_number, vendor_bill_no, vendor_bill_amount, bill_recorded_at')
        .eq('stakeholder_id', stakeholderId)
        .not('vendor_bill_amount', 'is', null)
        .gt('vendor_bill_amount', 0);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId && isOpen,
  });

  if (!isOpen && !closing) return null;

  const sheetVisible = mounted && !closing;
  const isLoading = stkLoading || txnsLoading || wosLoading || posLoading;

  // ── Derived Data & Ledger Logic ─────────────────────────────────────────────

  const stkType = stk?.type || 'Vendor';
  const activeTxns = (txns || []).filter((t: any) => t.status !== 'Voided');
  const rawRows: Omit<LedgerRow, 'runningBalance'>[] = [];

  if (stk) {
    if (stkType === 'Vendor') {
      // CREDIT — vendor bill recorded
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
      // DEBIT — payments made to vendor
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
    } else if (stkType === 'Worker') {
      // CREDIT — work milestone certified
      for (const wo of (workOrders || [])) {
        for (const m of (wo.wo_milestones || [])) {
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
      // DEBIT — payment to worker
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
    } else if (stkType === 'Client') {
      // DEBIT — client invoiced, CREDIT — client payment receipt
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
  }

  // Apply Date Filter
  const now = new Date();
  const fyStart = now.getMonth() >= 3
    ? new Date(now.getFullYear(), 3, 1)
    : new Date(now.getFullYear() - 1, 3, 1);
  const threeMonthsAgo = new Date(now);
  threeMonthsAgo.setMonth(now.getMonth() - 3);

  const filterRow = (row: Omit<LedgerRow, 'runningBalance'>) => {
    if (dateFilter === 'all') return true;
    const d = new Date(row.date);
    if (dateFilter === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    if (dateFilter === '3m') return d >= threeMonthsAgo;
    if (dateFilter === 'fy') return d >= fyStart;
    return true;
  };

  const filteredRows = rawRows.filter(filterRow);

  // Sort chronologically (oldest first) to compute precise running balance
  filteredRows.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let runningBal = 0;
  const ledgerRows: LedgerRow[] = filteredRows.map(row => {
    runningBal += row.credit;
    runningBal -= row.debit;
    return { ...row, runningBalance: runningBal };
  });

  // Display newest first in presentation module
  const displayRows = [...ledgerRows].reverse();

  // Create PO Groups for PO Group View
  const seenGroupKeys = new Set<string>();
  const groupOrder: string[] = [];
  const poGroupsMap = new Map<string, LedgerRow[]>();
  for (const row of displayRows) {
    const key = row.ref_id || 'unlinked';
    if (!seenGroupKeys.has(key)) {
      seenGroupKeys.add(key);
      groupOrder.push(key);
    }
    if (!poGroupsMap.has(key)) {
      poGroupsMap.set(key, []);
    }
    poGroupsMap.get(key)!.push(row);
  }
  const orderedGroupKeys = [
    ...groupOrder.filter(k => k !== 'unlinked'),
    ...(groupOrder.includes('unlinked') ? ['unlinked'] : []),
  ];

  // Create Month Groups for Chronological Date View
  const monthGroups = new Map<string, LedgerRow[]>();
  for (const row of displayRows) {
    const key = monthKey(row.date);
    if (!monthGroups.has(key)) {
      monthGroups.set(key, []);
    }
    monthGroups.get(key)!.push(row);
  }

  // Totals calculations
  const totalDebit = ledgerRows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = ledgerRows.reduce((s, r) => s + r.credit, 0);
  const finalBalance = totalCredit - totalDebit; // Cr positive = payable, Dr negative = advance
  const totalPaid = activeTxns.reduce((s: number, t: any) => s + Number(t.total_amount || 0), 0);
  const totalBilled = (stakeholderPOs || []).reduce((s: number, po: any) => s + Number(po.vendor_bill_amount || 0), 0);

  const initials = getInitials(stk?.name || '');
  const phones = (stk?.contact || '').split(/[,;/]/).map((s: string) => s.trim()).filter(Boolean);

  const handleAddTransaction = () => {
    navigate('/ledger/new', { state: { stakeholderId } });
  };

  return (
    <>
      {/* Drawer Animations & Custom Styles */}
      <style>{`
        @keyframes drawer-fade-in {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes drawer-slide-in {
          from { transform: translateX(100%); }
          to   { transform: translateX(0); }
        }
        .luxury-scrollbar::-webkit-scrollbar {
          width: 5px;
        }
        .luxury-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .luxury-scrollbar::-webkit-scrollbar-thumb {
          background: #EAE6DE;
          border-radius: 99px;
        }
        .luxury-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #D4CEB8;
        }
      `}</style>

      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed',
          inset: 0,
          zIndex: 49,
          background: 'rgba(24,24,27,0.25)', // Softer backdrop overlay
          backdropFilter: 'blur(4px)',
          opacity: sheetVisible ? 1 : 0,
          transition: 'opacity 0.35s cubic-bezier(0.16, 1, 0.3, 1)',
          animation: 'drawer-fade-in 0.35s cubic-bezier(0.16, 1, 0.3, 1) both',
        }}
      />

      {/* Notion-style Slide-Over Drawer */}
      <div
        style={{
          position: 'fixed',
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 50,
          width: '95vw',
          maxWidth: '720px',
          height: '100vh',
          backgroundColor: '#FAF9F6', // Plaster background
          borderLeft: '1px solid #EAE6DE',
          display: 'flex',
          flexDirection: 'column',
          transform: sheetVisible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)',
          boxShadow: '-12px 0 40px rgba(28,25,23,0.03), -1px 0 0 rgba(0,0,0,0.02)',
          overflow: 'hidden',
        }}
      >
        {/* Drawer Header Block */}
        {!isLoading && stk && (
          <div className="bg-white px-6 py-5 border-b border-[#EAE6DE]/60 flex flex-col gap-4 shrink-0 shadow-[0_1px_3px_rgba(28,25,23,0.005)]">
            {/* Row 1: Profile bubble, metadata badges, close button */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3.5">
                {/* Premium Ultra-Elegant Monogram Avatar */}
                <div className={`w-12 h-12 rounded-full flex items-center justify-center text-[14px] font-semibold tracking-wider shrink-0 shadow-xs border ${
                  stk.type === 'Worker'
                    ? 'bg-amber-50/70 text-amber-700 border-amber-250/30'
                    : stk.type === 'Client'
                      ? 'bg-indigo-50/70 text-indigo-700 border-indigo-250/30'
                      : 'bg-stone-100/80 text-stone-700 border-stone-200/50'
                }`}>
                  {initials}
                </div>
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-[18px] font-bold text-stone-800 leading-tight tracking-tight font-sans">
                      {stk.name}
                    </h2>
                    <span className="px-2.5 py-0.5 text-[9px] font-semibold tracking-wide rounded-full bg-stone-50 border border-stone-200/40 text-stone-550">
                      {stk.type}
                    </span>
                    {stk.type === 'Vendor' && stk.is_approved && (
                      <span className="flex items-center gap-0.5 px-2 py-0.5 bg-emerald-50/80 border border-emerald-200/30 text-emerald-700 rounded-full text-[9px] font-semibold tracking-wide">
                        <span className="material-symbols-outlined text-[10.5px] text-emerald-600" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                        Verified
                      </span>
                    )}
                  </div>
                  <p className="text-[12px] text-stone-500 mt-1 font-medium">
                    {stk.category}
                    {phones[0] && <span className="text-stone-300 mx-1.5">·</span>}
                    {phones[0] && <span className="font-sans text-stone-600">{phones[0]}</span>}
                  </p>
                </div>
              </div>

              <button
                onClick={handleClose}
                className="w-8 h-8 rounded-full border border-stone-200/45 flex items-center justify-center text-stone-400 hover:text-stone-750 hover:bg-stone-50 hover:border-stone-300 transition-all shrink-0"
              >
                <span className="material-symbols-outlined text-[16px]">close</span>
              </button>
            </div>

            {/* Row 2: ID, Star rating & Quick Actions */}
            <div className="flex items-center justify-between gap-4 border-t border-stone-100 pt-3">
              <div className="flex items-center gap-2">
                {stk.type === 'Vendor' && stk.rating != null && (
                  <StarDisplay value={stk.rating} size={11} />
                )}
                <span className="font-sans text-[10px] text-stone-400 font-medium">
                  UID: {stk.stakeholder_id.slice(0, 8)}
                </span>
              </div>
              <button
                onClick={handleAddTransaction}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-full bg-stone-850 text-white text-[11px] font-semibold tracking-wide hover:bg-stone-950 transition-all duration-150 shadow-xs"
              >
                <span className="material-symbols-outlined text-[13px] font-bold">add</span>
                Record Transaction
              </button>
            </div>
          </div>
        )}

        {/* Scrollable Presentation Area */}
        <div className="flex-1 overflow-y-auto px-6 py-6 space-y-6 luxury-scrollbar">
          {isLoading ? (
            <DrawerSkeleton />
          ) : !stk ? (
            <div className="text-center py-16">
              <span className="material-symbols-outlined text-[32px] text-stone-300 mb-2">person_off</span>
              <p className="text-[12px] text-stone-500 font-medium">Stakeholder not found.</p>
            </div>
          ) : (
            <>
              {/* EXECUTIVE STATEMENT GRID (Fintech Aesthetic) */}
              <div className="bg-white rounded-2xl border border-stone-200/80 shadow-[0_2px_12px_rgba(28,25,23,0.01)] overflow-hidden shrink-0">
                <div className="grid grid-cols-3 divide-x divide-stone-200/45">
                  {/* Col 1: Total Supplied / Invoiced */}
                  <div className="p-4 sm:p-5">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 mb-1.5">
                      {stkType === 'Client' ? 'Total Invoiced' : 'Total Supplied'}
                    </p>
                    <p className="text-[21px] font-semibold text-stone-800 tracking-tight leading-none font-sans">
                      ₹{fmt(stkType === 'Vendor' ? totalBilled : stkType === 'Worker' ? totalCredit : totalDebit)}
                    </p>
                    <p className="text-[10px] text-stone-450 mt-2 font-medium">
                      {stkType === 'Client' ? 'bills issued' : stkType === 'Vendor' ? 'recorded bills' : 'certified milestones'}
                    </p>
                  </div>

                  {/* Col 2: Total Paid / Payouts */}
                  <div className="p-4 sm:p-5">
                    <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 mb-1.5">
                      {stkType === 'Client' ? 'Total Receipts' : 'Total Payouts'}
                    </p>
                    <p className="text-[21px] font-semibold text-stone-800 tracking-tight leading-none font-sans">
                      ₹{fmt(totalPaid)}
                    </p>
                    <p className="text-[10px] text-stone-450 mt-2 font-medium">
                      {activeTxns.length} entry allocation{activeTxns.length !== 1 ? 's' : ''}
                    </p>
                  </div>

                  {/* Col 3: Balance status card (Fintech Elegant Badge) */}
                  <div className="p-4 sm:p-5 bg-stone-50/20 flex flex-col justify-between">
                    <div>
                      <p className="text-[10px] font-medium uppercase tracking-wider text-stone-400 mb-1.5">Net Balance</p>
                      {finalBalance > 0 ? (
                        <p className="text-[21px] font-semibold text-stone-800 tracking-tight leading-none font-sans">
                          ₹{fmt(finalBalance)}
                        </p>
                      ) : finalBalance < 0 ? (
                        <p className="text-[21px] font-semibold text-stone-800 tracking-tight leading-none font-sans">
                          ₹{fmt(Math.abs(finalBalance))}
                        </p>
                      ) : (
                        <p className="text-[21px] font-semibold text-emerald-700 tracking-tight leading-none font-sans">
                          Nil
                        </p>
                      )}
                    </div>
                    
                    <div className="flex mt-2">
                      {finalBalance > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-semibold bg-rose-50/70 text-rose-700 border border-rose-100/50">
                          {stkType === 'Client' ? 'Receivable' : 'Payable Cr'}
                        </span>
                      ) : finalBalance < 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-semibold bg-amber-50/70 text-amber-800 border border-amber-100/50">
                          {stkType === 'Client' ? 'Advance Cr' : 'Advance Dr'}
                        </span>
                      ) : (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[9.5px] font-semibold bg-emerald-50/70 text-emerald-800 border border-emerald-100/50">
                          Settled
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {/* FILTER & INTERACTIVE ACTION SLATE */}
              <div className="space-y-4">
                <div className="flex items-center justify-between flex-wrap gap-3">
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-stone-450">Account Ledger</span>

                  <div className="flex items-center gap-2 flex-wrap">
                    {/* Period Selector switcher */}
                    <div className="flex bg-stone-100/80 p-0.5 rounded-full border border-stone-200/40 shadow-xs">
                      {([
                        { key: 'all',   label: 'All' },
                        { key: 'month', label: 'Month' },
                        { key: '3m',    label: '3M' },
                        { key: 'fy',    label: `FY` },
                      ] as { key: DateFilter; label: string }[]).map(({ key, label }) => (
                        <button
                          key={key}
                          onClick={() => setDateFilter(key)}
                          className={`px-3 py-1 rounded-full text-[10px] font-medium tracking-wide transition-all duration-150 ${
                            dateFilter === key
                              ? 'bg-white text-stone-850 shadow-xs border border-stone-200/20 font-semibold'
                              : 'text-stone-500 hover:text-stone-750'
                          }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>

                    <span className="w-px h-3 bg-stone-200 mx-0.5" />

                    {/* Group toggle button (Tactile capsule switches) */}
                    <button
                      onClick={() => setSortByDate(v => !v)}
                      className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-semibold tracking-wide transition-all duration-150 border ${
                        sortByDate
                          ? 'bg-white border-stone-200 text-stone-600 hover:text-stone-850 hover:bg-stone-50 hover:border-stone-300'
                          : 'bg-stone-800 border-stone-800 text-white hover:bg-stone-900 shadow-xs'
                      }`}
                    >
                      <span className="material-symbols-outlined text-[13px] font-bold">
                        {sortByDate ? 'calendar_month' : 'view_headline'}
                      </span>
                      {sortByDate ? 'By Date' : 'By Contract (PO)'}
                    </button>
                  </div>
                </div>

                {/* LEDGER DATA VIEWPORT */}
                {displayRows.length === 0 ? (
                  <div className="bg-white rounded-2xl border border-stone-200/80 p-10 text-center shadow-sm">
                    <span className="material-symbols-outlined text-[36px] text-stone-300 mb-2 block">receipt_long</span>
                    <p className="text-[12px] text-stone-500 font-semibold tracking-wide">No ledger records within this window.</p>
                  </div>
                ) : sortByDate ? (
                  /* ── CHRONOLOGICAL DATE VIEW (World-Class Clean Table) ────── */
                  <div className="bg-white rounded-2xl border border-[#EAE6DE]/75 overflow-hidden shadow-[0_4px_24px_rgba(28,25,23,0.015)]">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-[#EAE6DE]/60 bg-stone-50/[0.45]">
                          <th className="pl-4 pr-2 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-450 w-[70px]">Date</th>
                          <th className="px-3 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-450">Particulars</th>
                          <th className="px-3 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-450 hidden sm:table-cell w-[95px]">Contract</th>
                          <th className="px-3 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-450 text-right w-[95px]">Debit (Dr)</th>
                          <th className="px-3 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-450 text-right w-[95px]">Credit (Cr)</th>
                          <th className="pl-3 pr-4 py-3 text-[9px] font-semibold uppercase tracking-wider text-stone-450 text-right w-[115px]">Balance</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-stone-100">
                        {Array.from(monthGroups.entries()).map(([monthKeyStr, rows]) => (
                          <div key={monthKeyStr} className="contents">
                            {/* Month Header Banner */}
                            <tr className="bg-stone-50/[0.2] border-b border-[#EAE6DE]/40">
                              <td colSpan={6} className="pl-4 py-2">
                                <span className="text-[9px] font-semibold uppercase tracking-wider text-stone-400">
                                  {monthHeading(monthKeyStr)}
                                </span>
                              </td>
                            </tr>
                            {/* Rows */}
                            {rows.map(row => {
                              const bal = row.runningBalance;
                              const balLabel = bal > 0 ? `₹${fmt(bal)} Cr` : bal < 0 ? `₹${fmt(Math.abs(bal))} Dr` : 'Nil';
                              const balColor = bal > 0 ? 'text-rose-600' : bal < 0 ? 'text-amber-600' : 'text-emerald-700';
                              const isCredit = row.entry_type === 'CREDIT';

                              return (
                                <tr
                                  key={row.id}
                                  onClick={() => row.txn_id && openPeek('TRANSACTION', row.txn_id)}
                                  className={`hover:bg-[#FAF9F6]/50 transition-colors group ${
                                    row.txn_id ? 'cursor-pointer' : ''
                                  } ${isCredit ? 'bg-emerald-50/[0.02]' : ''}`}
                                >
                                  {/* Date Column */}
                                  <td className="pl-4 pr-2 py-3.5 align-top text-[10.5px] text-stone-450 tracking-tight whitespace-nowrap">
                                    {formatLedgerDate(row.date)}
                                  </td>
                                  
                                  {/* Particulars Column */}
                                  <td className="px-3 py-3.5 align-top">
                                    <p className={`text-[12.5px] font-medium tracking-tight ${isCredit ? 'text-emerald-800' : 'text-stone-850'}`}>
                                      {row.particulars}
                                    </p>
                                    {row.detail && <p className="text-[10px] text-stone-450 mt-0.5 font-medium leading-relaxed">{row.detail}</p>}
                                    {row.project && (
                                      <p className="text-[9.5px] text-stone-400 font-medium uppercase tracking-wider mt-1 flex items-center gap-1">
                                        <span className="material-symbols-outlined text-[10px] text-stone-300">location_on</span>
                                        {row.project}
                                      </p>
                                    )}
                                    <span className={`inline-flex items-center mt-2.5 text-[8.5px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                      isCredit 
                                        ? 'bg-emerald-50/70 text-emerald-700 border-emerald-250/20' 
                                        : 'bg-stone-50/70 text-stone-600 border-stone-200/40'
                                    }`}>
                                      {row.source === 'VENDOR_BILL' ? 'Bill' : row.source === 'PAYMENT' ? 'Payment' : row.source === 'MILESTONE' ? 'Certified' : row.source === 'INVOICE' ? 'Invoice' : row.source === 'RECEIPT' ? 'Receipt' : row.source}
                                    </span>
                                  </td>

                                  {/* Contract Reference Column */}
                                  <td className="px-3 py-3.5 align-top hidden sm:table-cell">
                                    {row.ref_number ? (
                                      <button
                                        type="button"
                                        onClick={e => {
                                          e.stopPropagation();
                                          openPeek(row.ref_type === 'WO' ? 'WO' : 'PO', row.ref_id!);
                                        }}
                                        className="font-sans text-[11px] font-semibold text-stone-600 hover:text-stone-900 hover:underline text-left flex items-center gap-0.5 group/link"
                                      >
                                        {row.ref_number.slice(0, 8)}
                                        <span className="material-symbols-outlined text-[9px] text-stone-400 group-hover/link:text-stone-900 transition-colors">arrow_outward</span>
                                      </button>
                                    ) : (
                                      <span className="text-stone-250 text-[11px]">—</span>
                                    )}
                                  </td>

                                  {/* Debit Column */}
                                  <td className="px-3 py-3.5 align-top text-right text-[12px] font-semibold font-sans text-stone-750 tracking-tight">
                                    {row.entry_type === 'DEBIT' ? fmt(row.debit) : <span className="text-stone-200 font-normal">—</span>}
                                  </td>

                                  {/* Credit Column */}
                                  <td className="px-3 py-3.5 align-top text-right text-[12px] font-semibold font-sans text-emerald-700 tracking-tight">
                                    {row.entry_type === 'CREDIT' ? fmt(row.credit) : <span className="text-stone-200 font-normal">—</span>}
                                  </td>

                                  {/* Running Balance Column */}
                                  <td className={`pl-3 pr-4 py-3.5 align-top text-right text-[12px] font-semibold font-sans tracking-tight ${balColor}`}>
                                    {balLabel}
                                  </td>
                                </tr>
                              );
                            })}
                          </div>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  /* ── CONTRACT/PO CARD TIMELINE VIEW (Visual Masterpiece) ───── */
                  <div className="space-y-5">
                    {orderedGroupKeys.map(groupKey => {
                      const rows = poGroupsMap.get(groupKey)!;
                      const groupCr = rows.reduce((s, r) => s + r.credit, 0);
                      const groupDr = rows.reduce((s, r) => s + r.debit, 0);
                      const groupBal = groupCr - groupDr;

                      const isWO = rows[0]?.ref_type === 'WO';
                      const badgeBg = isWO ? 'bg-amber-50/70 text-amber-700 border-amber-250/20' : 'bg-stone-50/70 text-stone-600 border-stone-200/40';

                      // Progress Calculations
                      const totalBilledVal = groupCr;
                      const totalPaidVal = groupDr;
                      const payPercent = totalBilledVal > 0 ? Math.min(100, Math.round((totalPaidVal / totalBilledVal) * 100)) : 0;

                      return (
                        <div
                          key={groupKey}
                          className="bg-white rounded-2xl border border-[#EAE6DE]/80 shadow-[0_4px_20px_rgba(28,25,23,0.015)] overflow-hidden transition-all hover:shadow-[0_6px_28px_rgba(28,25,23,0.035)]"
                        >
                          {/* Group Card Header */}
                          <div className="px-5 py-4 bg-stone-50/[0.35] border-b border-[#EAE6DE]/50 flex flex-wrap items-center justify-between gap-4">
                            <div className="flex items-center gap-2">
                              {groupKey !== 'unlinked' ? (
                                <>
                                  <span className={`text-[9px] font-semibold tracking-wider uppercase px-2 py-0.5 rounded-full border ${badgeBg}`}>
                                    {rows[0]?.ref_type || 'PO'}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => openPeek(isWO ? 'WO' : 'PO', groupKey)}
                                    className="font-sans text-[11.5px] font-semibold text-stone-800 hover:underline flex items-center gap-1 group/peeklink"
                                  >
                                    {groupKey.slice(0, 10)}
                                    <span className="material-symbols-outlined text-[10px] text-stone-400 group-hover/peeklink:text-stone-900 transition-colors">open_in_new</span>
                                  </button>
                                </>
                              ) : (
                                <span className="text-[11.5px] font-semibold text-stone-400 uppercase tracking-wider">Unassociated Ledger Entries</span>
                              )}
                              <span className="text-[10px] text-stone-400 font-medium">({rows.length} {rows.length === 1 ? 'entry' : 'entries'})</span>
                            </div>

                            <div className="flex items-center gap-4 text-[10.5px] font-medium">
                              {groupCr > 0 && (
                                <span className="text-stone-450">Billed <span className="font-sans font-semibold text-emerald-700">₹{fmt(groupCr)}</span></span>
                              )}
                              {groupDr > 0 && (
                                <span className="text-stone-450">Paid <span className="font-sans font-semibold text-stone-800">₹{fmt(groupDr)}</span></span>
                              )}
                              <span className={`font-semibold font-sans text-[10.5px] px-2.5 py-0.5 rounded-full border ${
                                groupBal > 0 
                                  ? 'bg-rose-50/60 text-rose-700 border-rose-200/25' 
                                  : groupBal < 0 
                                    ? 'bg-amber-50/60 text-amber-800 border-amber-200/25' 
                                    : 'bg-emerald-50/60 text-emerald-750 border-emerald-200/25'
                              }`}>
                                {groupBal > 0 ? `₹${fmt(groupBal)} due` : groupBal < 0 ? `₹${fmt(Math.abs(groupBal))} adv` : 'Settled ✓'}
                              </span>
                            </div>
                          </div>

                          {/* Dynamic Payment Progress Segment */}
                          {totalBilledVal > 0 && (
                            <div className="px-5 pb-3.5 pt-2 bg-stone-50/[0.2] border-b border-[#EAE6DE]/40">
                              <div className="flex items-center justify-between text-[9.5px] font-semibold text-stone-400 mb-1.5 uppercase tracking-wider">
                                <span>Disbursement Progress</span>
                                <span className="font-sans font-medium text-stone-500">{payPercent}% Paid</span>
                              </div>
                              <div className="w-full h-1.5 bg-stone-150 rounded-full overflow-hidden flex shadow-inner">
                                <div className="bg-gradient-to-r from-emerald-600 to-emerald-500 rounded-full shadow-[0_0_4px_rgba(16,185,129,0.2)]" style={{ width: `${payPercent}%` }} />
                              </div>
                            </div>
                          )}

                          {/* Group Timeline Rows with connectors */}
                          <div className="divide-y divide-stone-100 relative">
                            {/* Vertical Hairline Connector Line */}
                            {rows.length > 1 && (
                              <div className="absolute left-[21px] top-[24px] bottom-[24px] w-[1.5px] bg-stone-200/55" />
                            )}

                            {rows.map(row => {
                              const isCredit = row.entry_type === 'CREDIT';
                              return (
                                <div
                                  key={row.id}
                                  onClick={() => row.txn_id && openPeek('TRANSACTION', row.txn_id)}
                                  className={`pl-12 pr-5 py-4 flex items-start justify-between gap-4 transition-colors relative ${
                                    row.txn_id ? 'cursor-pointer hover:bg-[#FAF9F6]/40' : ''
                                  } ${isCredit ? 'bg-emerald-50/[0.01]' : ''}`}
                                >
                                  {/* Custom Timeline Micro hollow Bullet */}
                                  <div className={`absolute left-[17px] top-[22px] w-2.5 h-2.5 rounded-full border-2 bg-white z-10 ${
                                    isCredit 
                                      ? 'border-emerald-500' 
                                      : 'border-stone-400'
                                  }`} />

                                  <div>
                                    <div className="flex items-center gap-1.5 flex-wrap">
                                      <p className={`text-[12.5px] font-medium tracking-tight ${isCredit ? 'text-emerald-800' : 'text-stone-850'}`}>
                                        {row.particulars}
                                      </p>
                                      <span className="text-[10.5px] font-medium text-stone-400 tracking-tight">
                                        ({formatLedgerDate(row.date)})
                                      </span>
                                    </div>
                                    {row.detail && <p className="text-[10px] text-stone-450 mt-0.5 leading-relaxed font-medium">{row.detail}</p>}
                                    {row.project && (
                                      <p className="text-[9.5px] text-stone-400 font-medium uppercase tracking-wider mt-1 flex items-center gap-0.5">
                                        <span className="material-symbols-outlined text-[9.5px]">location_on</span>
                                        {row.project}
                                      </p>
                                    )}
                                    <span className={`inline-flex items-center mt-2.5 text-[8.5px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full border ${
                                      isCredit 
                                        ? 'bg-emerald-50/70 text-emerald-700 border-emerald-250/20' 
                                        : 'bg-stone-50/70 text-stone-600 border-stone-200/40'
                                    }`}>
                                      {row.source === 'VENDOR_BILL' ? 'Bill' : row.source === 'PAYMENT' ? 'Payment' : row.source === 'MILESTONE' ? 'Certified' : row.source === 'INVOICE' ? 'Invoice' : row.source === 'RECEIPT' ? 'Receipt' : row.source}
                                    </span>
                                  </div>

                                  <div className="text-right shrink-0">
                                    <p className={`text-[12px] font-semibold font-sans tracking-tight ${isCredit ? 'text-emerald-750' : 'text-stone-750'}`}>
                                      {isCredit ? `+₹${fmt(row.credit)}` : `-₹${fmt(row.debit)}`}
                                    </p>
                                    <p className="text-[10.5px] text-stone-450 font-sans mt-1 font-medium">
                                      Bal: ₹{fmt(row.runningBalance)} {row.runningBalance > 0 ? 'Cr' : row.runningBalance < 0 ? 'Dr' : ''}
                                    </p>
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}
