import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import Breadcrumb from '../components/Breadcrumb';
import { TxnRow } from '../components/TxnRow';
import { usePeek } from '../context/PeekContext';
import { useUserProfile } from '../App';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function fmtLakh(n: number): string {
  if (n >= 1_00_000) return `₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)    return `₹${Math.round(n / 1_000)}K`;
  return `₹${Math.round(n).toLocaleString('en-IN')}`;
}

// ── AnimatedNumber — runs once per value transition from 0 ────────────────────

function AnimatedNumber({ value, format = fmtLakh }: { value: number; format?: (n: number) => string }) {
  const [shown, setShown] = useState(0);
  const fired = useRef(false);
  const raf   = useRef<number | null>(null);

  useEffect(() => {
    if (value <= 0) { setShown(0); return; }
    if (fired.current) { setShown(value); return; }
    fired.current = true;
    const duration = 600;
    const t0 = performance.now();
    const tick = (now: number) => {
      const p = Math.min((now - t0) / duration, 1);
      const e = 1 - (1 - p) ** 3;
      setShown(Math.round(value * e));
      if (p < 1) raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => { if (raf.current) cancelAnimationFrame(raf.current); };
  }, [value]);

  return <>{format(shown)}</>;
}

// ── Status chip maps ──────────────────────────────────────────────────────────

const WO_STATUS: Record<string, string> = {
  Draft:     'bg-slate-100 text-slate-500',
  Assigned:  'bg-blue-50 text-blue-600',
  Issued:    'bg-violet-50 text-violet-700',
  Active:    'bg-amber-50 text-amber-600',
  Closed:    'bg-emerald-50 text-emerald-600',
  Cancelled: 'bg-rose-50 text-rose-600',
};

const PO_STATUS: Record<string, string> = {
  ORDERED:   'bg-blue-50 text-blue-600',
  BILLED:    'bg-amber-50 text-amber-700',
  PARTIAL:   'bg-orange-50 text-orange-600',
  PAID:      'bg-green-50 text-green-700',
  CANCELLED: 'bg-gray-100 text-gray-400',
};

const PROJECT_STATUS: Record<string, string> = {
  Active:     'bg-emerald-50 text-emerald-700',
  'On Hold':  'bg-amber-50 text-amber-700',
  Completed:  'bg-blue-50 text-blue-700',
};

// ── WO Row ────────────────────────────────────────────────────────────────────

function WORowCard({ wo, onClick }: { wo: any; onClick: () => void }) {
  const orderVal = Number(wo.order_value) || 0;
  const milestones: any[] = wo.wo_milestones ?? [];
  const paidMs  = milestones.filter(m => ['Paid', 'Approved'].includes(m.status));
  const paidAmt = paidMs.reduce((s: number, m: any) => s + Number(m.amount), 0);
  const pct     = orderVal > 0 ? Math.min(Math.round((paidAmt / orderVal) * 100), 100) : 0;

  return (
    <div
      onClick={onClick}
      style={{ minHeight: 64 }}
      className="flex items-center justify-between px-4 py-3.5 border-b border-black/[0.05] last:border-0 cursor-pointer hover:bg-surface-container-low/40 transition-colors group"
    >
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-[11px] font-mono text-on-surface-variant/35 leading-none mb-0.5">{wo.wo_id}</p>
        <p className="text-[14px] font-[500] text-on-surface truncate leading-snug">
          {wo.stakeholders?.name || '—'}
        </p>
        {wo.scope_of_work && (
          <p className="text-[12px] text-on-surface-variant/50 truncate mt-0.5">{wo.scope_of_work}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${WO_STATUS[wo.status] || 'bg-surface-container text-on-surface'}`}>
            {wo.status}
          </span>
          <span className="text-[13px] font-semibold font-mono text-on-surface">
            ₹{orderVal.toLocaleString('en-IN')}
          </span>
        </div>
        {orderVal > 0 && (
          <div className="flex items-center gap-2">
            <div className="w-14 h-1 bg-outline-variant/20 rounded-full overflow-hidden">
              <div className="h-full bg-[#D97757] rounded-full" style={{ width: `${pct}%` }} />
            </div>
            <span className="text-[11px] text-on-surface-variant/35 tabular-nums">{pct}%</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── PO Row ────────────────────────────────────────────────────────────────────

function PORowCard({ po, onClick }: { po: any; onClick: () => void }) {
  const billAmt  = Number(po.vendor_bill_amount) || 0;
  const orderVal = Number(po.total_value) || Number(po.order_value) || 0;
  const displayAmt = billAmt > 0 ? billAmt : orderVal;

  const items: any[] = po.po_line_items ?? [];
  const preview = (() => {
    if (!items.length) return '';
    const names = items.slice(0, 2).map((li: any) => li.item_name || li.description).filter(Boolean);
    const extra = items.length - 2;
    return names.join(', ') + (extra > 0 ? ` +${extra} more` : '');
  })();

  const fmtShort = (d: string) => {
    const p = new Date(d);
    return isNaN(p.getTime()) ? '' : p.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  };

  return (
    <div
      onClick={onClick}
      style={{ minHeight: 64 }}
      className="flex items-center justify-between px-4 py-3.5 border-b border-black/[0.05] last:border-0 cursor-pointer hover:bg-surface-container-low/40 transition-colors group"
    >
      <div className="flex-1 min-w-0 mr-4">
        <p className="text-[11px] font-mono text-on-surface-variant/35 leading-none mb-0.5">{po.po_id}</p>
        <p className="text-[14px] font-[500] text-on-surface truncate leading-snug">
          {po.stakeholders?.name || '—'}
        </p>
        {preview && (
          <p className="text-[12px] text-on-surface-variant/50 truncate mt-0.5">{preview}</p>
        )}
      </div>
      <div className="flex flex-col items-end gap-1.5 shrink-0">
        <div className="flex items-center gap-2">
          <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-full ${PO_STATUS[po.status] || 'bg-surface-container text-on-surface'}`}>
            {po.status.charAt(0) + po.status.slice(1).toLowerCase()}
          </span>
          <span className={`text-[13px] font-semibold font-mono ${billAmt > 0 ? 'text-emerald-700' : 'text-on-surface/60'}`}>
            ₹{displayAmt.toLocaleString('en-IN')}
          </span>
        </div>
        {po.received_at_site && (
          <p className="text-[11px] text-purple-600">✓ Received {fmtShort(po.received_at_site)}</p>
        )}
      </div>
    </div>
  );
}

// ── Financial Strip Cell ──────────────────────────────────────────────────────

function FinCell({
  label, amount, sub, subAccent = false, onClick,
}: {
  label: string;
  amount: number | null;
  sub?: string;
  subAccent?: boolean;
  onClick?: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`px-4 py-4 ${onClick ? 'cursor-pointer hover:bg-surface-container-low/50 transition-colors' : ''}`}
    >
      <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/40 mb-1.5 whitespace-nowrap">
        {label}
      </p>
      <p className="text-[20px] font-semibold tabular-nums text-on-surface leading-none mb-1">
        {amount === null ? '—' : <AnimatedNumber value={amount} />}
      </p>
      {sub && (
        <p className={`text-[11px] ${subAccent ? 'text-amber-600' : 'text-on-surface-variant/40'} whitespace-nowrap`}>
          {sub}
        </p>
      )}
    </div>
  );
}

// ── Tab Bar ───────────────────────────────────────────────────────────────────

type TabKey = 'overview' | 'work_orders' | 'purchase_orders' | 'transactions';

function TabBar({
  active, onChange, tabs,
}: {
  active: TabKey;
  onChange: (k: TabKey) => void;
  tabs: { key: TabKey; label: string; count?: number }[];
}) {
  return (
    <div className="flex border-b border-outline-variant/20 overflow-x-auto no-scrollbar gap-0">
      {tabs.map(tab => (
        <button
          key={tab.key}
          onClick={() => onChange(tab.key)}
          className={`relative px-4 py-2.5 text-[13px] font-[500] whitespace-nowrap transition-colors ${
            active === tab.key
              ? 'text-[#D97757]'
              : 'text-on-surface-variant/50 hover:text-on-surface'
          }`}
        >
          {tab.label}
          {tab.count !== undefined && (
            <span className={`ml-1 text-[12px] ${active === tab.key ? 'text-[#D97757]/60' : 'text-on-surface-variant/30'}`}>
              ({tab.count})
            </span>
          )}
          {active === tab.key && (
            <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-[#D97757] rounded-t-sm" />
          )}
        </button>
      ))}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function ProjectDetail({ session }: { session: Session }) {
  const { projectId } = useParams();
  const navigate      = useNavigate();
  const { openPeek }  = usePeek();
  const { data: profile } = useUserProfile(session.user.id);

  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [woFilter,  setWoFilter]  = useState<string[]>([]);
  const [poFilter,  setPoFilter]  = useState<string[]>([]);
  const [mounted,   setMounted]   = useState(false);

  const isPrincipal = profile?.role === 'principal' || profile?.role === 'management';
  const canManage   = isPrincipal || profile?.role === 'accountant';

  useEffect(() => {
    const t = setTimeout(() => setMounted(true), 40);
    return () => clearTimeout(t);
  }, []);

  // ── Queries ───────────────────────────────────────────────────────────────

  const { data: project, isLoading: loadingProject } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('projects')
        .select('*')
        .eq('project_id', projectId)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!projectId,
  });

  const { data: workOrders = [], isLoading: loadingWOs } = useQuery({
    queryKey: ['project_wos_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, stakeholders(name, category), wo_milestones(amount, status)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId,
  });

  const { data: purchaseOrders = [], isLoading: loadingPOs } = useQuery({
    queryKey: ['project_pos_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, stakeholders(name, category), po_line_items(id, item_name, description)')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId,
  });

  const { data: allocations = [], isLoading: loadingTxns } = useQuery({
    queryKey: ['project_allocs_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select(`
          allocated_amount,
          transactions(
            txn_id, date, category, status, payment_mode,
            total_amount, annotation,
            stakeholders(name, type, category)
          )
        `)
        .eq('project_id', projectId);
      if (error) throw error;
      return (data ?? []).filter((a: any) => a.transactions?.status === 'Active');
    },
    enabled: !!projectId,
  });

  const { data: clientInvoices = [] } = useQuery({
    queryKey: ['project_invoices_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_invoices')
        .select('invoice_id, total_amount, paid_amount, status')
        .eq('project_id', projectId)
        .neq('status', 'Void')
        .neq('status', 'Cancelled');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId && isPrincipal,
  });

  const { data: budgetLines = [] } = useQuery({
    queryKey: ['project_budgets_total', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('project_budgets')
        .select('planned_amount')
        .eq('project_id', projectId);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!projectId,
  });

  // ── Computed ──────────────────────────────────────────────────────────────

  const totalBudget = budgetLines.reduce((s: number, b: any) => s + Number(b.planned_amount), 0);

  const totalSpent = allocations.reduce((s: number, a: any) => {
    const cat = (a.transactions?.category ?? '').toLowerCase();
    if (cat.includes('receipt') || cat.includes('funding')) return s;
    return s + Number(a.allocated_amount);
  }, 0);

  const activeWOs = workOrders.filter((wo: any) => ['Active', 'Issued', 'Assigned'].includes(wo.status));
  const openPOs   = purchaseOrders.filter((po: any) => !['PAID', 'CANCELLED'].includes(po.status));

  const totalCommitted = [
    ...activeWOs.map((wo: any) => {
      const ms = (wo.wo_milestones ?? []).reduce((s: number, m: any) => s + Number(m.amount), 0);
      return ms || Number(wo.order_value) || 0;
    }),
    ...openPOs.map((po: any) =>
      Number(po.vendor_bill_amount) || Number(po.total_value) || Number(po.order_value) || 0
    ),
  ].reduce((s: number, v: number) => s + v, 0);

  const totalBilled   = clientInvoices.reduce((s: number, i: any) => s + Number(i.total_amount), 0);
  const totalReceived = allocations
    .filter((a: any) => (a.transactions?.category ?? '').toLowerCase().includes('receipt'))
    .reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);

  const outstanding = totalBilled > totalReceived ? totalBilled - totalReceived : 0;

  const spentPct     = totalBudget > 0 ? Math.min((totalSpent / totalBudget) * 100, 100) : 0;
  const committedPct = totalBudget > 0 ? Math.min((totalCommitted / totalBudget) * 100, 100 - spentPct) : 0;
  const remaining    = totalBudget > 0 ? Math.max(0, totalBudget - totalSpent - totalCommitted) : 0;

  const filteredWOs = woFilter.length ? workOrders.filter((wo: any) => woFilter.includes(wo.status)) : workOrders;
  const filteredPOs = poFilter.length ? purchaseOrders.filter((po: any) => poFilter.includes(po.status)) : purchaseOrders;

  const sortedAllocations = [...allocations].sort((a: any, b: any) =>
    new Date(b.transactions?.date ?? 0).getTime() - new Date(a.transactions?.date ?? 0).getTime()
  );

  // ── Guards ────────────────────────────────────────────────────────────────

  if (loadingProject) {
    return (
      <div className="flex justify-center items-center min-h-[50vh]">
        <Loader2 className="animate-spin text-primary/30" size={32} />
      </div>
    );
  }

  if (!project) {
    return (
      <div className="max-w-[900px] mx-auto px-6 pt-8">
        <div className="bg-error-container text-on-error-container p-6 rounded-xl text-[14px]">
          Project not found.
        </div>
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────

  const tabs: { key: TabKey; label: string; count?: number }[] = [
    { key: 'overview',        label: 'Overview' },
    { key: 'work_orders',     label: 'Work Orders',     count: workOrders.length },
    { key: 'purchase_orders', label: 'Purchase Orders', count: purchaseOrders.length },
    { key: 'transactions',    label: 'Transactions',    count: allocations.length },
  ];

  return (
    <div className="min-h-screen bg-white">
      <div className="max-w-[900px] mx-auto px-4 md:px-6 pt-6 pb-16">

        {/* ── Breadcrumb ────────────────────────────────────────────────── */}
        <div className={`transition-opacity duration-300 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
          <Breadcrumb items={[
            { label: 'Projects', href: '/projects' },
            { label: project.name },
          ]} />
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* ZONE 1 — PROJECT HEADER                                         */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className={`mt-5 transition-all duration-300 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-1'}`}>

          {/* Name + status */}
          <div className="flex items-start gap-3 flex-wrap mb-1.5">
            <h1 className="text-[24px] font-bold tracking-[-0.03em] text-on-surface leading-tight">
              {project.name}
            </h1>
            <span className={`mt-1 text-[11px] font-semibold px-2.5 py-0.5 rounded-full ${
              PROJECT_STATUS[project.status] || 'bg-surface-container-high text-on-surface-variant'
            }`}>
              {project.status?.toUpperCase()}
            </span>
          </div>

          {/* Location */}
          {project.site_location && (
            <p className="text-[14px] text-on-surface-variant/55 mb-3">{project.site_location}</p>
          )}

          {/* Client */}
          {project.client_name && (
            <div className="mb-3">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-on-surface-variant/35 mb-0.5">Client</p>
              <p className="text-[14px] font-[500] text-on-surface">{project.client_name}</p>
            </div>
          )}

          {/* Meta */}
          <p className="text-[13px] text-on-surface-variant/45 mb-4">
            {project.start_date && <>Started {fmtDate(project.start_date)}</>}
            {project.project_id && <> · <span className="font-mono">{project.project_id}</span></>}
          </p>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap mb-5">
            {[
              { label: 'Edit',          onClick: () => {} },
              { label: '+ Transaction', onClick: () => navigate('/ledger', { state: { projectId } }) },
              ...(canManage ? [
                { label: '+ WO', onClick: () => navigate('/work-orders/new',     { state: { projectId } }) },
                { label: '+ PO', onClick: () => navigate('/purchase-orders/new', { state: { projectId } }) },
              ] : []),
            ].map(({ label, onClick }) => (
              <button
                key={label}
                onClick={onClick}
                className="h-8 px-3 rounded-lg border border-outline-variant/30 text-[12px] font-medium text-on-surface-variant/65 hover:border-outline-variant/60 hover:text-on-surface transition-colors whitespace-nowrap"
              >
                {label}
              </button>
            ))}
          </div>

          <div className="h-px bg-outline-variant/15 mb-6" />
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* ZONE 2 — FINANCIAL STRIP                                        */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className={`transition-all duration-300 delay-75 ${mounted ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2'}`}>

          {/* 5-column strip */}
          <div className="border border-outline-variant/20 rounded-xl overflow-x-auto mb-3 bg-white shadow-sm">
            <div className="grid grid-cols-5 divide-x divide-outline-variant/15 min-w-[520px]">
              <FinCell
                label="Budget"
                amount={totalBudget > 0 ? totalBudget : null}
                sub={totalBudget > 0 ? 'set' : 'not set'}
              />
              <FinCell
                label="Spent"
                amount={totalSpent}
                sub={`${allocations.length} payment${allocations.length !== 1 ? 's' : ''}`}
              />
              <FinCell
                label="Committed"
                amount={totalCommitted}
                sub={`${activeWOs.length} WO · ${openPOs.length} PO open`}
              />
              <FinCell
                label="Billed"
                amount={isPrincipal ? totalBilled : null}
                sub={isPrincipal ? `${clientInvoices.length} invoice${clientInvoices.length !== 1 ? 's' : ''}` : 'restricted'}
              />
              <FinCell
                label="Received"
                amount={isPrincipal ? totalReceived : null}
                sub={isPrincipal ? (outstanding > 0 ? `${fmtLakh(outstanding)} outstanding` : 'fully collected') : 'restricted'}
                subAccent={isPrincipal && outstanding > 0}
              />
            </div>
          </div>

          {/* Progress bar */}
          {totalBudget > 0 && (
            <div className="mb-6">
              <div className="h-1.5 bg-outline-variant/15 rounded-full overflow-hidden flex">
                <div
                  className="h-full bg-[#D97757] transition-all duration-700"
                  style={{ width: `${spentPct}%` }}
                />
                <div
                  className="h-full bg-amber-300/80 transition-all duration-700 delay-100"
                  style={{ width: `${committedPct}%` }}
                />
              </div>
              <p className="text-[11px] text-on-surface-variant/40 mt-1.5">
                <span className="text-on-surface/70 font-[500]">{fmtLakh(remaining)}</span> remaining of{' '}
                {fmtLakh(totalBudget)} budget
              </p>
            </div>
          )}
        </div>

        {/* ─────────────────────────────────────────────────────────────── */}
        {/* ZONE 3 — TABBED CONTENT                                         */}
        {/* ─────────────────────────────────────────────────────────────── */}
        <div className={`transition-all duration-300 delay-100 ${mounted ? 'opacity-100' : 'opacity-0'}`}>

          <TabBar active={activeTab} onChange={setActiveTab} tabs={tabs} />

          <div className="mt-6">

            {/* ── OVERVIEW ──────────────────────────────────────────────── */}
            {activeTab === 'overview' && (
              <div className="grid grid-cols-1 md:grid-cols-[1fr_280px] gap-8">

                {/* LEFT */}
                <div className="space-y-7 min-w-0">

                  {/* Recent Activity */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/35">
                        Recent Activity
                      </p>
                      <button
                        onClick={() => setActiveTab('transactions')}
                        className="text-[12px] text-primary hover:underline"
                      >
                        View all →
                      </button>
                    </div>
                    {loadingTxns ? (
                      <p className="text-[13px] text-on-surface-variant/30 py-3">Loading…</p>
                    ) : sortedAllocations.length === 0 ? (
                      <p className="text-[13px] text-on-surface-variant/40 py-3">No transactions yet.</p>
                    ) : (
                      <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden">
                        {sortedAllocations.slice(0, 5).map((alloc: any, idx: number) => (
                          <TxnRow
                            key={`${alloc.transactions?.txn_id}-${idx}`}
                            txn={alloc.transactions}
                            context="project"
                            variant="compact"
                            onClick={() => openPeek('TRANSACTION', alloc.transactions?.txn_id)}
                          />
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Active Work Orders */}
                  <section>
                    <div className="flex items-center justify-between mb-3">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/35">
                        Active Work Orders
                      </p>
                      <button
                        onClick={() => setActiveTab('work_orders')}
                        className="text-[12px] text-primary hover:underline"
                      >
                        View all →
                      </button>
                    </div>
                    {loadingWOs ? (
                      <p className="text-[13px] text-on-surface-variant/30 py-3">Loading…</p>
                    ) : activeWOs.length === 0 ? (
                      <p className="text-[13px] text-on-surface-variant/40 py-3">No active work orders.</p>
                    ) : (
                      <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden">
                        {activeWOs.slice(0, 3).map((wo: any) => (
                          <WORowCard key={wo.wo_id} wo={wo} onClick={() => openPeek('WO', wo.wo_id)} />
                        ))}
                      </div>
                    )}
                  </section>
                </div>

                {/* RIGHT */}
                <div className="space-y-7">

                  {/* Project Details */}
                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/35 mb-3">
                      Project Details
                    </p>
                    <div className="space-y-3">
                      {([
                        project.client_name    && { label: 'Client',    value: project.client_name, mono: false },
                        project.site_location  && { label: 'Location',  value: project.site_location, mono: false },
                        project.start_date     && { label: 'Started',   value: fmtDate(project.start_date), mono: false },
                        project.project_id     && { label: 'Reference', value: project.project_id, mono: true },
                        project.project_type   && { label: 'Type',      value: project.project_type, mono: false },
                        project.area_sqft      && { label: 'Area',      value: `${Number(project.area_sqft).toLocaleString('en-IN')} sqft`, mono: false },
                      ] as ({ label: string; value: string; mono: boolean } | false)[]).filter(Boolean).map(row => {
                        const r = row as { label: string; value: string; mono: boolean };
                        return (
                          <div key={r.label}>
                            <p className="text-[10px] text-on-surface-variant/35 mb-0.5 uppercase tracking-wide">
                              {r.label}
                            </p>
                            <p className={`text-[13px] text-on-surface ${r.mono ? 'font-mono' : 'font-[450]'}`}>
                              {r.value}
                            </p>
                          </div>
                        );
                      })}
                    </div>
                  </section>

                  {/* Quick Stats */}
                  <section>
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-on-surface-variant/35 mb-3">
                      Quick Stats
                    </p>
                    <div className="space-y-2.5">
                      {([
                        { label: 'Active WOs',        value: activeWOs.length },
                        { label: 'Open POs',           value: openPOs.length },
                        { label: 'Total transactions', value: allocations.length },
                        totalBudget > 0 && { label: 'Budget used', value: `${Math.round((totalSpent / totalBudget) * 100)}%` },
                      ] as ({ label: string; value: string | number } | false)[]).filter(Boolean).map(stat => {
                        const s = stat as { label: string; value: string | number };
                        return (
                          <div key={s.label} className="flex items-center justify-between">
                            <span className="text-[13px] text-on-surface-variant/55">{s.label}</span>
                            <span className="text-[13px] font-[600] text-on-surface tabular-nums">{s.value}</span>
                          </div>
                        );
                      })}
                    </div>
                  </section>
                </div>
              </div>
            )}

            {/* ── WORK ORDERS ───────────────────────────────────────────── */}
            {activeTab === 'work_orders' && (
              <div>
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {['Active', 'Assigned', 'Issued', 'Closed', 'Cancelled'].map(s => (
                      <button
                        key={s}
                        onClick={() => setWoFilter(f => f.includes(s) ? f.filter(x => x !== s) : [...f, s])}
                        className={`h-7 px-3 rounded-full text-[11px] font-medium transition-all whitespace-nowrap ${
                          woFilter.includes(s)
                            ? 'bg-primary/[0.07] text-primary border border-primary/20'
                            : 'border border-outline-variant/25 text-on-surface-variant/55 hover:border-outline-variant/50'
                        }`}
                      >
                        {s}
                      </button>
                    ))}
                    {woFilter.length > 0 && (
                      <button
                        onClick={() => setWoFilter([])}
                        className="text-[11px] text-on-surface-variant/35 hover:text-error transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {canManage && (
                    <button
                      onClick={() => navigate('/work-orders/new', { state: { projectId } })}
                      className="h-8 px-3.5 rounded-xl bg-primary text-on-primary text-[12px] font-semibold flex items-center gap-1 shrink-0"
                    >
                      <span className="material-symbols-outlined text-[15px]">add</span>
                      New WO
                    </button>
                  )}
                </div>

                {loadingWOs ? (
                  <div className="py-10 flex justify-center">
                    <Loader2 className="animate-spin text-primary/25" size={24} />
                  </div>
                ) : filteredWOs.length === 0 ? (
                  <div className="py-16 text-center">
                    <span className="material-symbols-outlined text-[48px] text-on-surface-variant/10 block mb-3">
                      engineering
                    </span>
                    <p className="text-[14px] font-[500] text-on-surface/40">
                      {woFilter.length ? 'No work orders match this filter' : 'No work orders yet'}
                    </p>
                    {canManage && !woFilter.length && (
                      <button
                        onClick={() => navigate('/work-orders/new', { state: { projectId } })}
                        className="mt-4 bk-btn text-[13px]"
                      >
                        + Create first work order
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden shadow-sm">
                    {filteredWOs.map((wo: any) => (
                      <WORowCard key={wo.wo_id} wo={wo} onClick={() => openPeek('WO', wo.wo_id)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── PURCHASE ORDERS ───────────────────────────────────────── */}
            {activeTab === 'purchase_orders' && (
              <div>
                <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {['ORDERED', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED'].map(s => (
                      <button
                        key={s}
                        onClick={() => setPoFilter(f => f.includes(s) ? f.filter(x => x !== s) : [...f, s])}
                        className={`h-7 px-3 rounded-full text-[11px] font-medium transition-all whitespace-nowrap ${
                          poFilter.includes(s)
                            ? 'bg-primary/[0.07] text-primary border border-primary/20'
                            : 'border border-outline-variant/25 text-on-surface-variant/55 hover:border-outline-variant/50'
                        }`}
                      >
                        {s.charAt(0) + s.slice(1).toLowerCase()}
                      </button>
                    ))}
                    {poFilter.length > 0 && (
                      <button
                        onClick={() => setPoFilter([])}
                        className="text-[11px] text-on-surface-variant/35 hover:text-error transition-colors"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  {canManage && (
                    <button
                      onClick={() => navigate('/purchase-orders/new', { state: { projectId } })}
                      className="h-8 px-3.5 rounded-xl bg-primary text-on-primary text-[12px] font-semibold flex items-center gap-1 shrink-0"
                    >
                      <span className="material-symbols-outlined text-[15px]">add</span>
                      New PO
                    </button>
                  )}
                </div>

                {loadingPOs ? (
                  <div className="py-10 flex justify-center">
                    <Loader2 className="animate-spin text-primary/25" size={24} />
                  </div>
                ) : filteredPOs.length === 0 ? (
                  <div className="py-16 text-center">
                    <span className="material-symbols-outlined text-[48px] text-on-surface-variant/10 block mb-3">
                      receipt_long
                    </span>
                    <p className="text-[14px] font-[500] text-on-surface/40">
                      {poFilter.length ? 'No purchase orders match this filter' : 'No purchase orders yet'}
                    </p>
                    {canManage && !poFilter.length && (
                      <button
                        onClick={() => navigate('/purchase-orders/new', { state: { projectId } })}
                        className="mt-4 bk-btn text-[13px]"
                      >
                        + Create first purchase order
                      </button>
                    )}
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden shadow-sm">
                    {filteredPOs.map((po: any) => (
                      <PORowCard key={po.po_id} po={po} onClick={() => openPeek('PO', po.po_id)} />
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* ── TRANSACTIONS ──────────────────────────────────────────── */}
            {activeTab === 'transactions' && (
              <div>
                <div className="flex items-center justify-between mb-4">
                  <p className="text-[12px] text-on-surface-variant/40">
                    {allocations.length} transaction{allocations.length !== 1 ? 's' : ''}
                    {totalSpent > 0 && (
                      <> · <span className="text-on-surface/70 font-[500]">{fmtLakh(totalSpent)}</span> spent</>
                    )}
                  </p>
                  <button
                    onClick={() => navigate('/ledger', { state: { projectId } })}
                    className="h-8 px-3.5 rounded-xl bg-primary text-on-primary text-[12px] font-semibold flex items-center gap-1"
                  >
                    <span className="material-symbols-outlined text-[15px]">add</span>
                    Add
                  </button>
                </div>

                {loadingTxns ? (
                  <div className="py-10 flex justify-center">
                    <Loader2 className="animate-spin text-primary/25" size={24} />
                  </div>
                ) : sortedAllocations.length === 0 ? (
                  <div className="py-16 text-center">
                    <span className="material-symbols-outlined text-[48px] text-on-surface-variant/10 block mb-3">
                      receipt
                    </span>
                    <p className="text-[14px] font-[500] text-on-surface/40">No transactions yet</p>
                  </div>
                ) : (
                  <div className="bg-white rounded-xl border border-outline-variant/15 overflow-hidden shadow-sm">
                    {sortedAllocations.map((alloc: any, idx: number) => (
                      <TxnRow
                        key={`${alloc.transactions?.txn_id}-${idx}`}
                        txn={alloc.transactions}
                        context="project"
                        variant="full"
                        onClick={() => openPeek('TRANSACTION', alloc.transactions?.txn_id)}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}

          </div>
        </div>
      </div>
    </div>
  );
}
