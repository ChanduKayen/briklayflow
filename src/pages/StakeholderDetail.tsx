import { useState, useRef, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import type { Session } from '@supabase/supabase-js';
import Breadcrumb from '../components/Breadcrumb';
import { useUserProfile } from '../App';
import { StarDisplay } from './Stakeholders';

type Tab = 'overview' | 'transactions' | 'work_orders' | 'balance';
type DatePreset = 'today' | 'week' | 'month' | 'last_month' | 'quarter' | 'fy' | 'all' | 'custom';

function getInitials(name: string) {
  return name
    .split(' ')
    .slice(0, 2)
    .map((w) => w[0] || '')
    .join('')
    .toUpperCase();
}

function fmtCurrency(n: number) {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n);
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getDateRange(preset: DatePreset, customFrom: string, customTo: string) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  switch (preset) {
    case 'today':
      return { from: today, to: today };
    case 'week': {
      const mon = new Date(today);
      mon.setDate(today.getDate() - today.getDay() + 1);
      const sun = new Date(mon);
      sun.setDate(mon.getDate() + 6);
      return { from: mon, to: sun };
    }
    case 'month':
      return {
        from: new Date(today.getFullYear(), today.getMonth(), 1),
        to: new Date(today.getFullYear(), today.getMonth() + 1, 0),
      };
    case 'last_month': {
      const lm = new Date(today.getFullYear(), today.getMonth() - 1, 1);
      return {
        from: lm,
        to: new Date(today.getFullYear(), today.getMonth(), 0),
      };
    }
    case 'quarter': {
      const q = Math.floor(today.getMonth() / 3);
      return {
        from: new Date(today.getFullYear(), q * 3, 1),
        to: new Date(today.getFullYear(), q * 3 + 3, 0),
      };
    }
    case 'fy': {
      const fyY = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
      return { from: new Date(fyY, 3, 1), to: new Date(fyY + 1, 2, 31) };
    }
    case 'custom':
      return {
        from: customFrom ? new Date(customFrom) : null,
        to: customTo ? new Date(customTo) : null,
      };
    default:
      return { from: null, to: null };
  }
}

function DateShortLabel(preset: DatePreset, customFrom: string, customTo: string): string | null {
  const now = new Date();
  if (preset === 'all') return null;
  if (preset === 'today') return 'Today';
  if (preset === 'week') return 'This Week';
  if (preset === 'month')
    return now.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  if (preset === 'last_month') {
    const lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    return lm.toLocaleDateString('en-IN', { month: 'short', year: 'numeric' });
  }
  if (preset === 'quarter') return `Q${Math.floor(now.getMonth() / 3) + 1}`;
  if (preset === 'fy') {
    const fyY = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
    return `FY ${fyY}–${String(fyY + 1).slice(2)}`;
  }
  if (preset === 'custom' && customFrom && customTo)
    return `${new Date(customFrom).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} – ${new Date(customTo).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}`;
  return null;
}

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This Week' },
  { value: 'month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'quarter', label: 'This Quarter' },
  { value: 'fy', label: 'Financial Year' },
  { value: 'all', label: 'All Time' },
];

function downloadCSV(rows: any[], filename: string) {
  const headers = ['Date', 'TXN ID', 'Project', 'Category', 'Amount', 'Status'];
  const lines = [
    headers.join(','),
    ...rows.map((r) =>
      [
        r.date,
        r.txn_id,
        r.project,
        r.category,
        r.total_amount,
        r.status,
      ]
        .map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`)
        .join(',')
    ),
  ];
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function StarRating({ value, onChange }: { value: number; onChange: (v: number) => void }) {
  const [hovered, setHovered] = useState(0);
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button"
          onMouseEnter={() => setHovered(n)} onMouseLeave={() => setHovered(0)}
          onClick={() => onChange(value === n ? 0 : n)} className="p-0.5 transition-transform hover:scale-110">
          <span className="material-symbols-outlined text-[24px]" style={{
            color: (hovered || value) >= n ? '#f59e0b' : '#d1d5db',
            fontVariationSettings: (hovered || value) >= n ? "'FILL' 1" : "'FILL' 0",
          }}>star</span>
        </button>
      ))}
    </div>
  );
}

export default function StakeholderDetail({ session }: { session: Session }) {
  const { stakeholderId } = useParams<{ stakeholderId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const canManage = profile?.role === 'management' || profile?.role === 'accountant';

  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Rating modal state
  const [showRateModal, setShowRateModal] = useState(false);
  const [rateOverall, setRateOverall] = useState(0);
  const [rateDelivery, setRateDelivery] = useState(0);
  const [rateQuality, setRateQuality] = useState(0);
  const [ratePricing, setRatePricing] = useState(0);
  const [showRateSubcats, setShowRateSubcats] = useState(false);

  // Date filter state (Transactions tab)
  const [datePreset, setDatePreset] = useState<DatePreset>('all');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [showDateDropdown, setShowDateDropdown] = useState(false);
  const [pendingCustomFrom, setPendingCustomFrom] = useState('');
  const [pendingCustomTo, setPendingCustomTo] = useState('');
  const dateDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dateDropdownRef.current && !dateDropdownRef.current.contains(e.target as Node)) {
        setShowDateDropdown(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ─── Rating mutation ───────────────────────────────────────────────────────

  const updateRating = useMutation({
    mutationFn: async () => {
      const payload: any = { rating: rateOverall || null };
      if (rateDelivery > 0) payload.rating_delivery = rateDelivery; else payload.rating_delivery = null;
      if (rateQuality > 0) payload.rating_quality = rateQuality; else payload.rating_quality = null;
      if (ratePricing > 0) payload.rating_pricing = ratePricing; else payload.rating_pricing = null;
      const { error } = await supabase.from('stakeholders').update(payload).eq('stakeholder_id', stakeholderId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stakeholder', stakeholderId] });
      qc.invalidateQueries({ queryKey: ['stakeholders'] });
      setShowRateModal(false);
    },
  });

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: stk, isLoading: stkLoading } = useQuery({
    queryKey: ['stakeholder', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stakeholders')
        .select('*')
        .eq('stakeholder_id', stakeholderId!)
        .single();
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
        .select(
          '*, txn_allocations(project_id, allocated_amount, projects(name))'
        )
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
        .select('*, projects(name), wo_milestones(*)')
        .eq('stakeholder_id', stakeholderId!)
        .order('date_issued', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stakeholderId,
  });

  // ─── Derived stats ─────────────────────────────────────────────────────────

  const activeTxns = (txns || []).filter((t) => t.status === 'Active');
  const totalPaid = activeTxns.reduce((s, t) => s + Number(t.total_amount || 0), 0);
  const txnCount = activeTxns.length;

  const openWOs = (workOrders || []).filter((w) =>
    ['Draft', 'Issued', 'Active'].includes(w.status)
  );
  const openWOValue = openWOs.reduce((s, w) => s + Number(w.order_value || 0), 0);
  // Pending = open contract value - paid so far (for workers)
  const pendingAmount = stk?.type === 'Worker' ? Math.max(0, openWOValue - totalPaid) : 0;

  // ─── Filtered transactions (Transactions tab) ──────────────────────────────

  const { from: dateFrom, to: dateTo } = getDateRange(datePreset, customFrom, customTo);
  const filteredTxns = (txns || []).filter((t) => {
    if (dateFrom || dateTo) {
      const d = new Date(t.date);
      d.setHours(0, 0, 0, 0);
      if (dateFrom && d < dateFrom) return false;
      if (dateTo && d > dateTo) return false;
    }
    return true;
  });

  const dateShortLabel = DateShortLabel(datePreset, customFrom, customTo);

  // ─── Balance ledger ────────────────────────────────────────────────────────

  type LedgerEntry = {
    date: string;
    description: string;
    debit: number | null;   // money paid out to stakeholder
    credit: number | null;  // work billed / goods received
    ref: string;
  };

  const balanceLedger: LedgerEntry[] = [];

  if (stk?.type === 'Worker') {
    // Credits: WO milestones completed/approved (work billed)
    for (const wo of workOrders || []) {
      for (const ms of wo.wo_milestones || []) {
        if (['Completed', 'Approved', 'Paid', 'Partially Paid'].includes(ms.status)) {
          balanceLedger.push({
            date: ms.completed_at || wo.date_issued,
            description: `${ms.name} — ${wo.wo_id}`,
            debit: null,
            credit: Number(ms.planned_amount || 0),
            ref: wo.wo_id,
          });
        }
      }
    }
    // Debits: payments made
    for (const t of activeTxns) {
      balanceLedger.push({
        date: t.date,
        description: `${t.category} — ${t.txn_id}`,
        debit: Number(t.total_amount || 0),
        credit: null,
        ref: t.txn_id,
      });
    }
  } else {
    // Vendor: just show payment history as debits, WO/PO issuances as credits
    for (const wo of workOrders || []) {
      balanceLedger.push({
        date: wo.date_issued,
        description: `WO Issued — ${wo.wo_id} (${wo.projects?.name || ''})`,
        debit: null,
        credit: Number(wo.order_value || 0),
        ref: wo.wo_id,
      });
    }
    for (const t of activeTxns) {
      balanceLedger.push({
        date: t.date,
        description: `${t.category} — ${t.txn_id}`,
        debit: Number(t.total_amount || 0),
        credit: null,
        ref: t.txn_id,
      });
    }
  }

  balanceLedger.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  let runningBalance = 0;
  const ledgerWithBalance = balanceLedger.map((entry) => {
    runningBalance += (entry.credit || 0) - (entry.debit || 0);
    return { ...entry, balance: runningBalance };
  });

  const netOutstanding = runningBalance; // positive = owe them, negative = overpaid

  // ─── WO stats (Work Orders tab) ────────────────────────────────────────────

  const totalWOValue = (workOrders || []).reduce((s, w) => s + Number(w.order_value || 0), 0);
  const totalWOPaid = totalPaid; // payments to this stakeholder

  // ─── Helpers ───────────────────────────────────────────────────────────────

  const openRateModal = () => {
    setRateOverall(stk?.rating ?? 0);
    setRateDelivery(stk?.rating_delivery ?? 0);
    setRateQuality(stk?.rating_quality ?? 0);
    setRatePricing(stk?.rating_pricing ?? 0);
    setShowRateSubcats(!!(stk?.rating_delivery || stk?.rating_quality || stk?.rating_pricing));
    setShowRateModal(true);
  };

  const statusColor = (s: string) => {
    if (s === 'Active') return 'bg-secondary-container text-on-secondary-container';
    if (s === 'Voided') return 'bg-error-container text-on-error-container';
    if (s === 'Closed' || s === 'Completed') return 'bg-surface-container-high text-on-surface-variant';
    if (s === 'Draft') return 'bg-surface-container-highest text-on-surface-variant';
    if (s === 'Issued') return 'bg-tertiary-container text-on-tertiary-container';
    return 'bg-surface-container text-on-surface-variant';
  };

  // ─── Loading / not found ───────────────────────────────────────────────────

  if (stkLoading) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
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

  // ─── Contact parsing ───────────────────────────────────────────────────────

  const contactParts = (stk.contact || '')
    .split(/[,;/]/)
    .map((s: string) => s.trim())
    .filter(Boolean);

  const phones = contactParts.filter((c: string) => !c.includes('@'));
  const emails = contactParts.filter((c: string) => c.includes('@'));

  // Bank details: detect UPI (has @) vs bank account
  const bankRaw = stk.bank_details || '';
  const isUPI = bankRaw.includes('@');

  // ─── Tabs ──────────────────────────────────────────────────────────────────

  const tabs: { id: Tab; label: string; icon: string }[] = [
    { id: 'overview', label: 'Overview', icon: 'dashboard' },
    { id: 'transactions', label: 'Transactions', icon: 'receipt_long' },
    ...(stk.type === 'Worker'
      ? [{ id: 'work_orders' as Tab, label: 'Work Orders', icon: 'file_present' }]
      : []),
    { id: 'balance', label: 'Balance', icon: 'account_balance_wallet' },
  ];

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-12">
      {/* Breadcrumb */}
      <Breadcrumb
        items={[
          { label: 'Dashboard', href: '/' },
          { label: 'Stakeholders', href: '/stakeholders' },
          { label: stk.name },
        ]}
      />

      {/* Two-column layout */}
      <div className="flex flex-col lg:flex-row gap-6 mt-2">
        {/* ── LEFT COLUMN ──────────────────────────────────────────────── */}
        <div className="lg:w-[35%] space-y-4 shrink-0">
          {/* Profile card */}
          <div className="bg-surface-container-lowest rounded-xl shadow-card border border-outline-variant/30 p-6">
            {/* Avatar + name */}
            <div className="flex flex-col items-center text-center mb-5">
              <div
                className={`w-16 h-16 rounded-full flex items-center justify-center text-2xl font-bold mb-3 ${
                  stk.type === 'Worker'
                    ? 'bg-primary-container text-on-primary'
                    : 'bg-tertiary-container text-on-tertiary-container'
                }`}
              >
                {getInitials(stk.name)}
              </div>
              <h1 className="text-headline-md font-headline-md text-on-surface leading-tight">{stk.name}</h1>
              <p className="text-body-sm text-on-surface-variant font-data-mono mt-0.5">{stk.stakeholder_id}</p>
              <div className="flex items-center gap-2 mt-2 flex-wrap justify-center">
                <span
                  className={`px-2.5 py-0.5 text-[10px] font-bold rounded-full ${
                    stk.type === 'Worker'
                      ? 'bg-secondary-container text-on-secondary-container'
                      : 'bg-surface-container-high text-on-surface'
                  }`}
                >
                  {stk.type?.toUpperCase()}
                </span>
                {stk.type === 'Vendor' && stk.is_approved && (
                  <span className="flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-800 rounded-full text-[10px] font-bold">
                    <span className="material-symbols-outlined text-[11px]" style={{ fontVariationSettings: "'FILL' 1" }}>verified</span>
                    Approved
                  </span>
                )}
                <span className="text-body-sm text-on-surface-variant">{stk.category}</span>
              </div>
            </div>

            <div className="border-t border-outline-variant/20 pt-4 space-y-4">
              {/* Contact */}
              {(phones.length > 0 || emails.length > 0) && (
                <div>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-2">Contact</p>
                  <div className="space-y-1.5">
                    {phones.map((ph: string, i: number) => (
                      <a
                        key={i}
                        href={`tel:${ph.replace(/\s/g, '')}`}
                        className="flex items-center gap-2 text-body-sm text-on-surface hover:text-primary transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0">call</span>
                        {ph}
                      </a>
                    ))}
                    {emails.map((em: string, i: number) => (
                      <a
                        key={i}
                        href={`mailto:${em}`}
                        className="flex items-center gap-2 text-body-sm text-on-surface hover:text-primary transition-colors break-all"
                      >
                        <span className="material-symbols-outlined text-[16px] text-on-surface-variant shrink-0">mail</span>
                        {em}
                      </a>
                    ))}
                  </div>
                </div>
              )}
              {phones.length === 0 && emails.length === 0 && !stk.contact && (
                <div>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-2">Contact</p>
                  <p className="text-body-sm text-on-surface-variant italic">Not set</p>
                </div>
              )}

              {/* Payment Details */}
              <div className="border-t border-outline-variant/20 pt-4">
                <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-2">Payment Details</p>
                {bankRaw ? (
                  isUPI ? (
                    <div className="flex items-start gap-2">
                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant mt-0.5 shrink-0">account_balance</span>
                      <div>
                        <p className="text-body-sm text-on-surface">UPI</p>
                        <p className="text-body-sm font-data-mono text-on-surface-variant">{bankRaw}</p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-start gap-2">
                      <span className="material-symbols-outlined text-[16px] text-on-surface-variant mt-0.5 shrink-0">account_balance</span>
                      <p className="text-body-sm text-on-surface">{bankRaw}</p>
                    </div>
                  )
                ) : (
                  <p className="text-body-sm text-on-surface-variant italic">Not set</p>
                )}
              </div>

              {/* GST Details (vendors only) */}
              {stk.type === 'Vendor' && (
                <div className="border-t border-outline-variant/20 pt-4 space-y-3">
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">GST Details</p>

                  <div className="flex items-center justify-between text-body-sm">
                    <span className="text-on-surface-variant">Registration</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                      stk.gst_reg_type === 'Regular' ? 'bg-blue-100 text-blue-800' :
                      stk.gst_reg_type === 'Composition' ? 'bg-amber-100 text-amber-800' :
                      stk.gst_reg_type === 'Unregistered' ? 'bg-surface-container-high text-on-surface-variant' :
                      'bg-surface-container-high text-on-surface-variant'
                    }`}>
                      {stk.gst_reg_type || 'Not set'}
                    </span>
                  </div>

                  <div className="flex items-start justify-between text-body-sm gap-2">
                    <span className="text-on-surface-variant shrink-0">GSTIN</span>
                    {stk.gstin
                      ? <span className="font-data-mono text-[12px] text-on-surface text-right break-all">{stk.gstin}</span>
                      : <span className="text-on-surface-variant italic text-[12px]">{stk.gst_reg_type === 'Unregistered' ? 'N/A' : 'Not set'}</span>}
                  </div>

                  <div className="flex items-center justify-between text-body-sm">
                    <span className="text-on-surface-variant">Approved</span>
                    {stk.is_approved
                      ? <span className="flex items-center gap-1 text-green-700 font-semibold text-[12px]">
                          <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span> Yes
                        </span>
                      : <span className="text-on-surface-variant/60 text-[12px]">No</span>}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Rating card (vendors only) */}
          {stk.type === 'Vendor' && (
            <div className="bg-surface-container-lowest rounded-xl shadow-card border border-outline-variant/30 p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Vendor Rating</p>
                {canManage && (
                  <button onClick={openRateModal}
                    className="text-[11px] font-bold text-primary hover:underline flex items-center gap-1">
                    <span className="material-symbols-outlined text-[13px]">edit</span>
                    {stk.rating ? 'Edit' : 'Rate'}
                  </button>
                )}
              </div>

              {stk.rating ? (
                <div className="space-y-2.5">
                  <div className="flex items-center gap-3">
                    <StarDisplay value={stk.rating} size={18} />
                    <span className="text-body-lg font-bold text-on-surface font-data-mono">{stk.rating}/5</span>
                  </div>
                  {(stk.rating_delivery || stk.rating_quality || stk.rating_pricing) && (
                    <div className="pt-2 border-t border-outline-variant/20 space-y-2">
                      {([
                        { label: 'Delivery', val: stk.rating_delivery },
                        { label: 'Quality', val: stk.rating_quality },
                        { label: 'Pricing', val: stk.rating_pricing },
                      ]).filter(r => r.val).map(r => (
                        <div key={r.label} className="flex items-center justify-between">
                          <span className="text-[12px] text-on-surface-variant">{r.label}</span>
                          <div className="flex items-center gap-1.5">
                            <StarDisplay value={r.val!} size={12} />
                            <span className="text-[11px] font-semibold text-on-surface-variant">{r.val}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-2">
                  <div className="flex justify-center mb-2">
                    <StarDisplay value={0} size={20} />
                  </div>
                  <p className="text-[12px] text-on-surface-variant italic mb-3">Not yet rated</p>
                  {canManage && (
                    <button onClick={openRateModal} className="bk-btn text-[12px] px-4 py-2 rounded-lg">
                      Rate this vendor
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Summary stats */}
          <div className="grid grid-cols-1 gap-3">
            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px] text-on-secondary-container">payments</span>
              </div>
              <div>
                <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Total Paid</p>
                <p className="text-headline-sm font-headline-sm text-on-surface font-data-mono mt-0.5">
                  {txnsLoading ? '—' : fmtCurrency(totalPaid)}
                </p>
              </div>
            </div>

            {stk.type === 'Worker' && (
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-4 flex items-center gap-4">
                <div className="w-10 h-10 rounded-full bg-tertiary-container flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[20px] text-on-tertiary-container">pending_actions</span>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Pending (Open WOs)</p>
                  <p className="text-headline-sm font-headline-sm text-on-surface font-data-mono mt-0.5">
                    {wosLoading ? '—' : fmtCurrency(pendingAmount)}
                  </p>
                </div>
              </div>
            )}

            <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-primary-container flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px] text-on-primary">receipt_long</span>
              </div>
              <div>
                <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Transactions</p>
                <p className="text-headline-sm font-headline-sm text-on-surface font-data-mono mt-0.5">
                  {txnsLoading ? '—' : txnCount}
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* ── RIGHT COLUMN ─────────────────────────────────────────────── */}
        <div className="flex-1 min-w-0">
          {/* Tabs */}
          <div className="flex gap-1 border-b border-outline-variant/30 mb-5 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-body-sm font-semibold border-b-2 transition-colors whitespace-nowrap -mb-px ${
                  activeTab === tab.id
                    ? 'border-primary text-primary'
                    : 'border-transparent text-on-surface-variant hover:text-on-surface hover:border-outline-variant/40'
                }`}
              >
                <span className="material-symbols-outlined text-[16px]">{tab.icon}</span>
                {tab.label}
              </button>
            ))}
          </div>

          {/* ── OVERVIEW TAB ─────────────────────────────────────── */}
          {activeTab === 'overview' && (
            <div className="space-y-6">
              {/* Recent Transactions */}
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-variant/20">
                  <h3 className="text-body-lg font-semibold text-on-surface">Recent Transactions</h3>
                  <button
                    onClick={() => setActiveTab('transactions')}
                    className="text-body-sm text-primary font-semibold hover:underline flex items-center gap-0.5"
                  >
                    View all
                    <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                  </button>
                </div>
                {txnsLoading ? (
                  <div className="p-4 space-y-2">
                    {[0, 1, 2].map((i) => (
                      <div key={i} className="h-8 bg-surface-container-highest rounded animate-pulse" />
                    ))}
                  </div>
                ) : (txns || []).length === 0 ? (
                  <p className="px-5 py-6 text-body-sm text-on-surface-variant italic">No transactions found.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="border-b border-outline-variant/20">
                          <th className="text-left px-5 py-2.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Date</th>
                          <th className="text-left px-3 py-2.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">TXN ID</th>
                          <th className="text-left px-3 py-2.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Project</th>
                          <th className="text-right px-5 py-2.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Amount</th>
                          <th className="text-left px-3 py-2.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(txns || []).slice(0, 5).map((t) => {
                          const project =
                            t.txn_allocations?.[0]?.projects?.name ||
                            (t.txn_allocations?.length > 1 ? 'Split' : '—');
                          return (
                            <tr
                              key={t.txn_id}
                              onClick={() => navigate(`/ledger/${t.txn_id}`)}
                              className="border-b border-outline-variant/10 hover:bg-surface-container-low cursor-pointer transition-colors last:border-0"
                            >
                              <td className="px-5 py-2.5 text-on-surface-variant whitespace-nowrap">{fmtDate(t.date)}</td>
                              <td className="px-3 py-2.5 font-data-mono text-primary text-[12px]">{t.txn_id}</td>
                              <td className="px-3 py-2.5 text-on-surface-variant max-w-[120px] truncate">{project}</td>
                              <td className="px-5 py-2.5 text-right font-data-mono font-semibold text-on-surface">
                                {fmtCurrency(Number(t.total_amount))}
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusColor(t.status)}`}>
                                  {t.status?.toUpperCase()}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>

              {/* Active Work Orders */}
              <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3.5 border-b border-outline-variant/20">
                  <h3 className="text-body-lg font-semibold text-on-surface">Active Work Orders</h3>
                  {stk.type === 'Worker' && (
                    <button
                      onClick={() => setActiveTab('work_orders')}
                      className="text-body-sm text-primary font-semibold hover:underline flex items-center gap-0.5"
                    >
                      View all
                      <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                    </button>
                  )}
                </div>
                {wosLoading ? (
                  <div className="p-4 space-y-2">
                    {[0, 1].map((i) => (
                      <div key={i} className="h-8 bg-surface-container-highest rounded animate-pulse" />
                    ))}
                  </div>
                ) : openWOs.length === 0 ? (
                  <p className="px-5 py-6 text-body-sm text-on-surface-variant italic">No active work orders.</p>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="border-b border-outline-variant/20">
                          <th className="text-left px-5 py-2.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">WO ID</th>
                          <th className="text-left px-3 py-2.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Project</th>
                          <th className="text-right px-5 py-2.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Value</th>
                          <th className="text-left px-3 py-2.5 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {openWOs.slice(0, 5).map((wo) => (
                          <tr
                            key={wo.wo_id}
                            onClick={() => navigate(`/work-orders/${wo.wo_id}`)}
                            className="border-b border-outline-variant/10 hover:bg-surface-container-low cursor-pointer transition-colors last:border-0"
                          >
                            <td className="px-5 py-2.5 font-data-mono text-primary text-[12px]">{wo.wo_id}</td>
                            <td className="px-3 py-2.5 text-on-surface-variant max-w-[140px] truncate">
                              {wo.projects?.name || '—'}
                            </td>
                            <td className="px-5 py-2.5 text-right font-data-mono font-semibold text-on-surface">
                              {fmtCurrency(Number(wo.order_value))}
                            </td>
                            <td className="px-3 py-2.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusColor(wo.status)}`}>
                                {wo.status?.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── TRANSACTIONS TAB ─────────────────────────────────── */}
          {activeTab === 'transactions' && (
            <div>
              {/* Filter row */}
              <div className="flex items-center justify-between mb-4 gap-2">
                <div className="relative flex items-center gap-0.5" ref={dateDropdownRef}>
                  <button
                    onClick={() => setShowDateDropdown((d) => !d)}
                    className={`relative flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[13px] font-medium transition-colors ${
                      datePreset !== 'all'
                        ? 'text-primary border-primary/25 bg-primary/5 hover:bg-primary/10'
                        : 'text-on-surface-variant border-outline-variant/30 bg-surface-container-high hover:bg-surface-container-highest'
                    }`}
                  >
                    {datePreset !== 'all' && (
                      <span className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-primary border-2 border-background" />
                    )}
                    <span className="material-symbols-outlined text-[18px]">calendar_today</span>
                    {dateShortLabel && <span className="text-[12px]">{dateShortLabel}</span>}
                  </button>
                  {datePreset !== 'all' && (
                    <button
                      onClick={() => {
                        setDatePreset('all');
                        setCustomFrom('');
                        setCustomTo('');
                        setShowDateDropdown(false);
                      }}
                      className="p-1 text-on-surface-variant hover:text-error transition-colors rounded"
                    >
                      <span className="material-symbols-outlined text-[14px]">close</span>
                    </button>
                  )}
                  {showDateDropdown && (
                    <div className="absolute top-full left-0 mt-1 w-52 bg-surface-container-lowest border border-outline-variant/40 rounded-xl shadow-card-lg z-50 overflow-hidden">
                      <div className="py-1.5">
                        {DATE_PRESETS.map((p) => (
                          <button
                            key={p.value}
                            onClick={() => {
                              setDatePreset(p.value);
                              setCustomFrom('');
                              setCustomTo('');
                              if (p.value !== 'custom') setShowDateDropdown(false);
                            }}
                            className={`w-full flex items-center justify-between px-4 py-2 text-[13px] hover:bg-surface-container-low transition-colors ${
                              datePreset === p.value ? 'text-primary font-semibold' : 'text-on-surface'
                            }`}
                          >
                            {p.label}
                            {datePreset === p.value && (
                              <span className="material-symbols-outlined text-[14px]">check</span>
                            )}
                          </button>
                        ))}
                        <div className="mx-4 border-t border-outline-variant/20 my-1" />
                        <button
                          onClick={() => setDatePreset('custom')}
                          className={`w-full flex items-center justify-between px-4 py-2 text-[13px] hover:bg-surface-container-low transition-colors ${
                            datePreset === 'custom' ? 'text-primary font-semibold' : 'text-on-surface'
                          }`}
                        >
                          Custom Range
                          {datePreset === 'custom' && (
                            <span className="material-symbols-outlined text-[14px]">check</span>
                          )}
                        </button>
                        {datePreset === 'custom' && (
                          <div className="px-4 pb-3 space-y-2 mt-1">
                            <input
                              type="date"
                              className="bk-input text-[12px] py-1.5"
                              value={pendingCustomFrom}
                              onChange={(e) => setPendingCustomFrom(e.target.value)}
                            />
                            <input
                              type="date"
                              className="bk-input text-[12px] py-1.5"
                              value={pendingCustomTo}
                              onChange={(e) => setPendingCustomTo(e.target.value)}
                            />
                            {pendingCustomFrom && pendingCustomTo && (
                              <button
                                onClick={() => {
                                  setCustomFrom(pendingCustomFrom);
                                  setCustomTo(pendingCustomTo);
                                  setShowDateDropdown(false);
                                }}
                                className="bk-btn text-[12px] py-1.5 w-full"
                              >
                                Apply
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <button
                  onClick={() =>
                    downloadCSV(
                      filteredTxns.map((t) => ({
                        date: t.date,
                        txn_id: t.txn_id,
                        project:
                          t.txn_allocations?.[0]?.projects?.name || '—',
                        category: t.category,
                        total_amount: t.total_amount,
                        status: t.status,
                      })),
                      `${stk.stakeholder_id}_transactions.csv`
                    )
                  }
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-outline-variant/30 text-[13px] font-medium text-on-surface-variant hover:bg-surface-container-high transition-colors"
                >
                  <span className="material-symbols-outlined text-[16px]">download</span>
                  Export CSV
                </button>
              </div>

              {txnsLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2, 3].map((i) => (
                    <div key={i} className="h-10 bg-surface-container-highest rounded animate-pulse" />
                  ))}
                </div>
              ) : filteredTxns.length === 0 ? (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-8 text-center">
                  <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40 mb-2 block">receipt_long</span>
                  <p className="text-body-sm text-on-surface-variant">No transactions for the selected period.</p>
                </div>
              ) : (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="border-b border-outline-variant/20 bg-surface-container-low">
                          <th className="text-left px-5 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Date</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">TXN ID</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Project</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Category</th>
                          <th className="text-right px-5 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Amount</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Mode</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredTxns.map((t) => {
                          const allocs = t.txn_allocations || [];
                          const project =
                            allocs.length === 1
                              ? allocs[0].projects?.name || '—'
                              : allocs.length > 1
                              ? `Split (${allocs.length})`
                              : '—';
                          return (
                            <tr
                              key={t.txn_id}
                              onClick={() => navigate(`/ledger/${t.txn_id}`, {
                                state: { from: 'stakeholder', stakeholderId: stk.stakeholder_id, stakeholderName: stk.name }
                              })}
                              className="border-b border-outline-variant/10 hover:bg-surface-container-low cursor-pointer transition-colors last:border-0"
                            >
                              <td className="px-5 py-3 text-on-surface-variant whitespace-nowrap">{fmtDate(t.date)}</td>
                              <td className="px-3 py-3 font-data-mono text-primary text-[12px]">{t.txn_id}</td>
                              <td className="px-3 py-3 text-on-surface-variant max-w-[140px] truncate">{project}</td>
                              <td className="px-3 py-3 text-on-surface-variant">{t.category}</td>
                              <td className="px-5 py-3 text-right font-data-mono font-semibold text-on-surface">
                                {fmtCurrency(Number(t.total_amount))}
                              </td>
                              <td className="px-3 py-3 text-on-surface-variant">{t.payment_mode}</td>
                              <td className="px-3 py-3">
                                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusColor(t.status)}`}>
                                  {t.status?.toUpperCase()}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── WORK ORDERS TAB (Workers only) ───────────────────── */}
          {activeTab === 'work_orders' && stk.type === 'Worker' && (
            <div>
              {/* Running totals banner */}
              <div className="grid grid-cols-3 gap-3 mb-5">
                {[
                  { label: 'Total WO Value', value: fmtCurrency(totalWOValue), icon: 'assignment' },
                  { label: 'Total Paid', value: fmtCurrency(totalWOPaid), icon: 'payments' },
                  {
                    label: 'Balance Due',
                    value: fmtCurrency(Math.max(0, totalWOValue - totalWOPaid)),
                    icon: 'account_balance_wallet',
                  },
                ].map((s) => (
                  <div key={s.label} className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-3.5">
                    <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-1">{s.label}</p>
                    <p className="text-body-lg font-bold font-data-mono text-on-surface">{wosLoading ? '—' : s.value}</p>
                  </div>
                ))}
              </div>

              {wosLoading ? (
                <div className="space-y-2">
                  {[0, 1, 2].map((i) => (
                    <div key={i} className="h-10 bg-surface-container-highest rounded animate-pulse" />
                  ))}
                </div>
              ) : (workOrders || []).length === 0 ? (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-8 text-center">
                  <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40 mb-2 block">assignment</span>
                  <p className="text-body-sm text-on-surface-variant">No work orders found.</p>
                </div>
              ) : (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="border-b border-outline-variant/20 bg-surface-container-low">
                          <th className="text-left px-5 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">WO ID</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Project</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Scope</th>
                          <th className="text-right px-5 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Value</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Issued</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(workOrders || []).map((wo) => (
                          <tr
                            key={wo.wo_id}
                            onClick={() => navigate(`/work-orders/${wo.wo_id}`, {
                              state: { from: 'stakeholder', stakeholderId: stk.stakeholder_id, stakeholderName: stk.name }
                            })}
                            className="border-b border-outline-variant/10 hover:bg-surface-container-low cursor-pointer transition-colors last:border-0"
                          >
                            <td className="px-5 py-3 font-data-mono text-primary text-[12px]">{wo.wo_id}</td>
                            <td className="px-3 py-3 text-on-surface-variant">{wo.projects?.name || '—'}</td>
                            <td className="px-3 py-3 text-on-surface max-w-[180px] truncate">{wo.scope_of_work}</td>
                            <td className="px-5 py-3 text-right font-data-mono font-semibold text-on-surface">
                              {fmtCurrency(Number(wo.order_value))}
                            </td>
                            <td className="px-3 py-3 text-on-surface-variant whitespace-nowrap">{fmtDate(wo.date_issued)}</td>
                            <td className="px-3 py-3">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${statusColor(wo.status)}`}>
                                {wo.status?.toUpperCase()}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── BALANCE TAB ──────────────────────────────────────── */}
          {activeTab === 'balance' && (
            <div>
              {/* Net outstanding */}
              <div
                className={`rounded-xl border p-4 mb-5 flex items-center gap-4 ${
                  netOutstanding > 0
                    ? 'bg-tertiary-container/30 border-tertiary-container'
                    : netOutstanding < 0
                    ? 'bg-error-container/20 border-error-container'
                    : 'bg-surface-container-low border-outline-variant/30'
                }`}
              >
                <span
                  className={`material-symbols-outlined text-[32px] ${
                    netOutstanding > 0
                      ? 'text-on-tertiary-container'
                      : netOutstanding < 0
                      ? 'text-error'
                      : 'text-on-surface-variant'
                  }`}
                >
                  {netOutstanding > 0 ? 'arrow_upward' : netOutstanding < 0 ? 'arrow_downward' : 'check_circle'}
                </span>
                <div>
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">
                    {netOutstanding > 0 ? 'We Owe' : netOutstanding < 0 ? 'Overpaid By' : 'Settled'}
                  </p>
                  <p className="text-headline-md font-headline-md font-data-mono text-on-surface">
                    {fmtCurrency(Math.abs(netOutstanding))}
                  </p>
                </div>
                <div className="ml-auto text-right text-body-sm text-on-surface-variant">
                  <p>Credits: <span className="font-semibold text-on-surface">{fmtCurrency(ledgerWithBalance.reduce((s, e) => s + (e.credit || 0), 0))}</span></p>
                  <p>Debits: <span className="font-semibold text-on-surface">{fmtCurrency(ledgerWithBalance.reduce((s, e) => s + (e.debit || 0), 0))}</span></p>
                </div>
              </div>

              {ledgerWithBalance.length === 0 ? (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 p-8 text-center">
                  <span className="material-symbols-outlined text-[40px] text-on-surface-variant/40 mb-2 block">account_balance_wallet</span>
                  <p className="text-body-sm text-on-surface-variant">No ledger entries yet.</p>
                </div>
              ) : (
                <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 overflow-hidden">
                  <div className="overflow-x-auto">
                    <table className="w-full text-body-sm">
                      <thead>
                        <tr className="border-b border-outline-variant/20 bg-surface-container-low">
                          <th className="text-left px-5 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Date</th>
                          <th className="text-left px-3 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Description</th>
                          <th className="text-right px-4 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Credit</th>
                          <th className="text-right px-4 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Debit</th>
                          <th className="text-right px-5 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Balance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {ledgerWithBalance.map((entry, i) => (
                          <tr
                            key={i}
                            className="border-b border-outline-variant/10 hover:bg-surface-container-low transition-colors last:border-0"
                          >
                            <td className="px-5 py-3 text-on-surface-variant whitespace-nowrap">{fmtDate(entry.date)}</td>
                            <td className="px-3 py-3 text-on-surface max-w-[220px] truncate">{entry.description}</td>
                            <td className="px-4 py-3 text-right font-data-mono text-[12px]">
                              {entry.credit != null ? (
                                <span className="text-on-secondary-container font-semibold">
                                  {fmtCurrency(entry.credit)}
                                </span>
                              ) : (
                                <span className="text-on-surface-variant/30">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-right font-data-mono text-[12px]">
                              {entry.debit != null ? (
                                <span className="text-error font-semibold">
                                  {fmtCurrency(entry.debit)}
                                </span>
                              ) : (
                                <span className="text-on-surface-variant/30">—</span>
                              )}
                            </td>
                            <td className="px-5 py-3 text-right font-data-mono font-bold text-[13px]">
                              <span className={entry.balance >= 0 ? 'text-on-surface' : 'text-error'}>
                                {entry.balance < 0 ? '-' : ''}{fmtCurrency(Math.abs(entry.balance))}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* ── RATING MODAL ──────────────────────────────────────────────────── */}
      {showRateModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowRateModal(false)}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-2xl p-6 w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-headline-sm font-bold">Rate {stk.name}</h3>
              <button onClick={() => setShowRateModal(false)} className="p-1.5 hover:bg-surface-container rounded-lg transition-colors">
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-2 block">Overall Rating</label>
                <div className="flex items-center gap-3">
                  <StarRating value={rateOverall} onChange={setRateOverall} />
                  {rateOverall > 0
                    ? <span className="text-body-sm font-semibold text-on-surface">{rateOverall}/5</span>
                    : <span className="text-body-sm text-on-surface-variant italic">Not rated</span>}
                </div>
              </div>

              {rateOverall > 0 && (
                <button type="button"
                  onClick={() => setShowRateSubcats((v) => !v)}
                  className="flex items-center gap-1.5 text-[12px] text-primary hover:underline">
                  <span className="material-symbols-outlined text-[14px]">{showRateSubcats ? 'expand_less' : 'expand_more'}</span>
                  {showRateSubcats ? 'Hide' : 'Add'} subcategory ratings
                </button>
              )}

              {showRateSubcats && (
                <div className="pl-4 border-l-2 border-outline-variant/30 space-y-3">
                  {([
                    { label: 'Delivery', value: rateDelivery, onChange: setRateDelivery },
                    { label: 'Quality', value: rateQuality, onChange: setRateQuality },
                    { label: 'Pricing', value: ratePricing, onChange: setRatePricing },
                  ] as const).map((r) => (
                    <div key={r.label}>
                      <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-1.5 block">{r.label}</label>
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
              <button onClick={() => setShowRateModal(false)} className="bk-btn-ghost px-4 py-2 rounded-xl text-body-sm">Cancel</button>
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
