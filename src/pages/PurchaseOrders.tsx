import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { LinearProgress } from '../components/LinearProgress';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<string, string> = {
  'ORDERED':   'bg-[#EFF6FF] text-[#3B82F6]',
  'AT_SITE':   'bg-[#F5F3FF] text-[#7C3AED]',
  'BILLED':    'bg-[#FFFBEB] text-[#D97706]',
  'PARTIAL':   'bg-[#FFF7ED] text-[#EA580C]',
  'PAID':      'bg-[#F0FDF4] text-[#16A34A]',
  'CANCELLED': 'bg-[#F9FAFB] text-[#6B7280]',
};

const STATUS_BORDER: Record<string, string> = {
  'ORDERED':   'border-l-4 border-l-[#3B82F6]',
  'AT_SITE':   'border-l-4 border-l-[#7C3AED]',
  'BILLED':    'border-l-4 border-l-[#D97706]',
  'PARTIAL':   'border-l-4 border-l-[#EA580C]',
  'PAID':      'border-l-4 border-l-[#16A34A]',
  'CANCELLED': 'border-l-4 border-l-[#6B7280]',
};

const STATUS_LABEL: Record<string, string> = {
  'ORDERED':   'Ordered',
  'AT_SITE':   'At Site',
  'BILLED':    'Billed',
  'PARTIAL':   'Partially Paid',
  'PAID':      'Paid',
  'CANCELLED': 'Cancelled',
};

const ALL_STATUSES = ['ORDERED', 'AT_SITE', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtLakh(n: number) {
  if (n >= 10000000) return `${(n / 10000000).toFixed(1).replace(/\.0$/, '')}Cr`;
  if (n >= 100000)   return `${(n / 100000).toFixed(1).replace(/\.0$/, '')}L`;
  if (n >= 1000)     return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return n.toLocaleString('en-IN');
}

function isOverdue(po: any): boolean {
  if (!po.expected_delivery) return false;
  const d = new Date(po.expected_delivery);
  if (isNaN(d.getTime())) return false;
  if (['AT_SITE', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED'].includes(po.status)) return false;
  return d < new Date();
}

function getItemsPreview(po: any): string {
  if (po.po_line_items?.length > 0) {
    return po.po_line_items.slice(0, 3).map((li: any) => li.item_name).join(', ')
      + (po.po_line_items.length > 3 ? ` +${po.po_line_items.length - 3} more` : '');
  }
  if (po.items?.length > 0) {
    return po.items.slice(0, 3).map((it: any) => it.description).join(', ')
      + (po.items.length > 3 ? ` +${po.items.length - 3} more` : '');
  }
  return '—';
}

// ── Date preset helpers ───────────────────────────────────────────────────────

type DatePreset = 'all' | 'today' | 'week' | 'month' | 'quarter';

function dateRange(preset: DatePreset): { from: Date | null; to: Date | null } {
  const now = new Date();
  if (preset === 'all')     return { from: null, to: null };
  if (preset === 'today')   return { from: new Date(now.setHours(0,0,0,0)), to: new Date() };
  if (preset === 'week') {
    const start = new Date(); start.setDate(start.getDate() - 7);
    return { from: start, to: new Date() };
  }
  if (preset === 'month') {
    const start = new Date(); start.setMonth(start.getMonth() - 1);
    return { from: start, to: new Date() };
  }
  if (preset === 'quarter') {
    const start = new Date(); start.setMonth(start.getMonth() - 3);
    return { from: start, to: new Date() };
  }
  return { from: null, to: null };
}

const DATE_LABELS: Record<DatePreset, string> = {
  all: 'All Time', today: 'Today', week: 'Last 7 Days', month: 'Last Month', quarter: 'Last Quarter',
};

// ── FilterChip ────────────────────────────────────────────────────────────────

function FilterChip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`bk-chip inline-flex items-center gap-1.5 px-3 h-8 rounded-full text-[12px] font-semibold border transition-colors whitespace-nowrap ${
        active
          ? 'bg-primary/[0.08] border-primary/30 text-primary'
          : 'bg-white border-outline-variant/40 text-on-surface-variant hover:bg-surface-container-low'
      }`}
    >
      {label}
      <span className="material-symbols-outlined text-[14px]">
        {active ? 'expand_less' : 'expand_more'}
      </span>
    </button>
  );
}

// ── Dropdown ──────────────────────────────────────────────────────────────────

function Dropdown({
  anchorRef, open, onClose, children,
}: { anchorRef: React.RefObject<HTMLElement>; open: boolean; onClose: () => void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (!open) return;
    if (anchorRef.current) {
      const r = anchorRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left });
    }
    function handler(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node) && !anchorRef.current?.contains(e.target as Node))
        onClose();
    }
    function scrollHandler() { onClose(); }
    document.addEventListener('mousedown', handler);
    window.addEventListener('scroll', scrollHandler, true);
    return () => {
      document.removeEventListener('mousedown', handler);
      window.removeEventListener('scroll', scrollHandler, true);
    };
  }, [open, onClose, anchorRef]);

  if (!open || !pos) return null;
  return createPortal(
    <div
      ref={ref}
      className="popover-animate bg-white rounded-xl shadow-elevation-8 border border-outline-variant/20 py-1 min-w-[180px]"
      style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
    >
      {children}
    </div>,
    document.body
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseOrders({ session }: { session: Session }) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const { show: showSnackbar } = useSnackbar();

  // ── Filter state ───────────────────────────────────────────────────────────
  const [datePreset, setDatePreset]       = useState<DatePreset>('all');
  const [filterStatus, setFilterStatus]   = useState<string[]>([]);
  const [filterVendor, setFilterVendor]   = useState<string[]>([]);
  const [filterProject, setFilterProject] = useState<string[]>([]);
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchTerm, setSearchTerm]       = useState('');

  // chip dropdown open state
  const [openChip, setOpenChip] = useState<'date' | 'status' | 'vendor' | 'project' | null>(null);

  // chip anchor refs
  const dateRef    = useRef<HTMLDivElement>(null);
  const statusRef  = useRef<HTMLDivElement>(null);
  const vendorRef  = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);

  const canManage =
    profile?.role === 'management' ||
    profile?.role === 'principal' ||
    profile?.role === 'accountant';

  const { data: pos, isLoading } = useQuery({
    queryKey: ['purchase_orders_enhanced'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`*, projects(name, site_location), stakeholders(name, category, gstin, is_approved), po_line_items(id, item_name)`)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const { data: poPayments } = useQuery({
    queryKey: ['po_payment_totals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('order_ref, allocated_amount')
        .eq('order_type', 'PO');
      if (error) throw error;
      const totals: Record<string, number> = {};
      for (const row of data ?? []) {
        if (row.order_ref) totals[row.order_ref] = (totals[row.order_ref] || 0) + Number(row.allocated_amount);
      }
      return totals;
    },
  });

  const recordSiteReceipt = useMutation({
    mutationFn: async (po: any) => {
      const { error } = await supabase.from('purchase_orders').update({
        status:              'AT_SITE',
        received_at_site:    new Date().toISOString(),
        received_by_name:    session.user.email,
        received_by_user_id: session.user.id,
      }).eq('po_id', po.po_id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      showSnackbar('Site receipt recorded ✓');
    },
    onError: (err: any) => showSnackbar(err?.message || 'Failed to record receipt', { type: 'error' }),
  });

  // ── Derived filter options ─────────────────────────────────────────────────
  const vendors  = [...new Set((pos ?? []).map(p => p.stakeholders?.name).filter(Boolean))].sort();
  const projects = [...new Set((pos ?? []).map(p => p.projects?.name).filter(Boolean))].sort();

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const totalCount      = pos?.length ?? 0;
  const totalCommitted  = pos?.reduce((s, p) => s + (Number(p.total_value) || Number(p.order_value) || 0), 0) ?? 0;
  const pendingDelivery = pos?.filter(p => p.status === 'ORDERED').length ?? 0;
  const unbilled        = pos?.filter(p => p.status === 'AT_SITE').length ?? 0;

  // ── Filtering ──────────────────────────────────────────────────────────────
  const { from: dateFrom, to: dateTo } = dateRange(datePreset);

  const filtered = (pos ?? []).filter(po => {
    if (dateFrom && dateTo) {
      const d = new Date(po.date_issued || po.created_at);
      if (d < dateFrom || d > dateTo) return false;
    }
    if (filterStatus.length && !filterStatus.includes(po.status)) return false;
    if (filterVendor.length && !filterVendor.includes(po.stakeholders?.name)) return false;
    if (filterProject.length && !filterProject.includes(po.projects?.name)) return false;
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      if (!(
        po.po_id?.toLowerCase().includes(q) ||
        po.stakeholders?.name?.toLowerCase().includes(q) ||
        po.projects?.name?.toLowerCase().includes(q) ||
        po.ordered_by?.toLowerCase().includes(q)
      )) return false;
    }
    return true;
  });

  const filteredTotal = filtered.reduce((s, p) => s + (Number(p.total_value) || Number(p.order_value) || 0), 0);
  const hasFilters = datePreset !== 'all' || filterStatus.length || filterVendor.length || filterProject.length || !!searchTerm;

  function toggleChip(name: typeof openChip) {
    setOpenChip(c => c === name ? null : name);
  }

  function MultiCheckList({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
    return (
      <div className="py-1 max-h-64 overflow-y-auto">
        <button
          onClick={() => onChange([])}
          className="w-full text-left px-4 py-2 text-[12px] text-on-surface-variant/60 hover:bg-surface-container-low"
        >
          All
        </button>
        {options.map(o => (
          <label key={o} className="flex items-center gap-2.5 px-4 py-2 text-[13px] hover:bg-surface-container-low cursor-pointer">
            <input
              type="checkbox"
              checked={selected.includes(o)}
              onChange={() => {
                if (selected.includes(o)) onChange(selected.filter(s => s !== o));
                else onChange([...selected, o]);
              }}
              className="accent-primary w-3.5 h-3.5"
            />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-surface-container-low/30">
      <div className="max-w-[1280px] mx-auto px-4 md:px-6 py-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-[24px] font-bold text-on-surface tracking-tight">Purchase Orders</h2>
            <div className="flex flex-wrap gap-2.5 mt-2">
              <span className="px-3 py-1 bg-surface-container text-[12px] rounded-full text-on-surface-variant">
                <span className="font-bold text-on-surface">{totalCount}</span> orders
              </span>
              <span className="px-3 py-1 bg-surface-container text-[12px] rounded-full text-on-surface-variant">
                Committed: <span className="font-bold text-on-surface font-data-mono">₹{fmtLakh(totalCommitted)}</span>
              </span>
              <span className="px-3 py-1 bg-amber-50 text-amber-700 text-[12px] rounded-full">
                <span className="font-bold">{pendingDelivery}</span> pending delivery
              </span>
              <span className="px-3 py-1 bg-violet-50 text-violet-700 text-[12px] rounded-full">
                <span className="font-bold">{unbilled}</span> unbilled
              </span>
            </div>
          </div>
          {canManage && (
            <button
              className="hidden md:flex bk-btn items-center gap-2 h-9 px-4 rounded-xl text-[13px] shrink-0"
              onClick={() => navigate('/purchase-orders/new')}
            >
              <span className="material-symbols-outlined text-[16px]">add</span>
              New PO
            </button>
          )}
        </div>

        {/* Filter bar — horizontal scroll on mobile, wraps on desktop */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar md:flex-wrap flex-nowrap mb-4 pb-0.5">

          {/* Date chip */}
          <div ref={dateRef} className="relative">
            <FilterChip
              label={datePreset === 'all' ? 'Date' : DATE_LABELS[datePreset]}
              active={datePreset !== 'all' || openChip === 'date'}
              onClick={() => toggleChip('date')}
            />
            <Dropdown anchorRef={dateRef as React.RefObject<HTMLElement>} open={openChip === 'date'} onClose={() => setOpenChip(null)}>
              {(['all','today','week','month','quarter'] as DatePreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => { setDatePreset(p); setOpenChip(null); }}
                  className={`w-full text-left px-4 py-2 text-[13px] hover:bg-surface-container-low ${datePreset === p ? 'font-semibold text-primary' : 'text-on-surface'}`}
                >
                  {DATE_LABELS[p]}
                </button>
              ))}
            </Dropdown>
          </div>

          {/* Status chip */}
          <div ref={statusRef} className="relative">
            <FilterChip
              label={filterStatus.length ? `Status (${filterStatus.length})` : 'Status'}
              active={filterStatus.length > 0 || openChip === 'status'}
              onClick={() => toggleChip('status')}
            />
            <Dropdown anchorRef={statusRef as React.RefObject<HTMLElement>} open={openChip === 'status'} onClose={() => setOpenChip(null)}>
              <MultiCheckList options={ALL_STATUSES} selected={filterStatus} onChange={setFilterStatus} />
            </Dropdown>
          </div>

          {/* Vendor chip */}
          <div ref={vendorRef} className="relative">
            <FilterChip
              label={filterVendor.length ? `Vendor (${filterVendor.length})` : 'Vendor'}
              active={filterVendor.length > 0 || openChip === 'vendor'}
              onClick={() => toggleChip('vendor')}
            />
            <Dropdown anchorRef={vendorRef as React.RefObject<HTMLElement>} open={openChip === 'vendor'} onClose={() => setOpenChip(null)}>
              <MultiCheckList options={vendors} selected={filterVendor} onChange={setFilterVendor} />
            </Dropdown>
          </div>

          {/* Project chip */}
          <div ref={projectRef} className="relative">
            <FilterChip
              label={filterProject.length ? `Project (${filterProject.length})` : 'Project'}
              active={filterProject.length > 0 || openChip === 'project'}
              onClick={() => toggleChip('project')}
            />
            <Dropdown anchorRef={projectRef as React.RefObject<HTMLElement>} open={openChip === 'project'} onClose={() => setOpenChip(null)}>
              <MultiCheckList options={projects} selected={filterProject} onChange={setFilterProject} />
            </Dropdown>
          </div>

          {/* Search */}
          {searchOpen ? (
            <div className="relative flex items-center">
              <span className="material-symbols-outlined absolute left-2.5 text-[16px] text-on-surface-variant/40 pointer-events-none">search</span>
              <input
                autoFocus
                className="pl-8 pr-8 h-8 rounded-full text-[12px] border border-outline-variant/40 bg-white outline-none focus:border-primary focus:ring-1 focus:ring-primary/20 w-44 transition-all"
                placeholder="Search…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-2.5 text-on-surface-variant/40 hover:text-on-surface">
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              )}
            </div>
          ) : (
            <button
              onClick={() => setSearchOpen(true)}
              className="bk-chip inline-flex items-center justify-center w-8 h-8 rounded-full border border-outline-variant/40 bg-white text-on-surface-variant hover:bg-surface-container-low"
            >
              <span className="material-symbols-outlined text-[16px]">search</span>
            </button>
          )}

          {/* Clear all */}
          {hasFilters && (
            <button
              onClick={() => { setDatePreset('all'); setFilterStatus([]); setFilterVendor([]); setFilterProject([]); setSearchTerm(''); setSearchOpen(false); }}
              className="text-[12px] font-semibold text-primary hover:underline ml-1"
            >
              Clear all
            </button>
          )}
        </div>

        {/* Result context */}
        <p className="text-[12px] text-on-surface-variant/50 mb-4">
          Showing <span className="font-semibold text-on-surface">{filtered.length}</span> of {totalCount} ·
          <span className="font-data-mono font-semibold text-on-surface ml-1">₹{fmtLakh(filteredTotal)}</span> total
        </p>

        {isLoading && <LinearProgress className="mb-4" />}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-16 text-on-surface-variant/50">
            <span className="material-symbols-outlined text-[48px] block mb-3">shopping_cart</span>
            <p className="text-[14px] font-semibold">No purchase orders found</p>
            {canManage && !hasFilters && (
              <button onClick={() => navigate('/purchase-orders/new')} className="mt-4 bk-btn text-[13px]">
                Create your first PO
              </button>
            )}
          </div>
        )}

        {/* Desktop table */}
        {filtered.length > 0 && (
          <div className="hidden md:block bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-outline-variant/10 bg-surface-container-low/40">
                  <th className="px-4 py-3 text-left w-[130px]">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">PO No / Date</span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Vendor</span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Project</span>
                  </th>
                  <th className="px-4 py-3 text-left hidden xl:table-cell">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Items</span>
                  </th>
                  <th className="px-4 py-3 text-right">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Amount</span>
                  </th>
                  <th className="px-4 py-3 text-right w-[120px]">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Bill Amt</span>
                  </th>
                  <th className="px-4 py-3 text-center w-[90px]">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">At Site</span>
                  </th>
                  <th className="px-4 py-3 text-left">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Status</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((po, idx) => {
                  const billAmt = po.vendor_bill_amount ?? null;
                  const hasBill = billAmt !== null && billAmt !== undefined;
                  return (
                    <tr
                      key={po.po_id}
                      className={`group cursor-pointer hover:bg-surface-container-low/40 transition-colors border-b border-outline-variant/[0.06] wo-row-animate ${STATUS_BORDER[po.status] ?? 'border-l-4 border-l-transparent'}`}
                      style={{ animationDelay: `${Math.min(idx, 20) * 15}ms` }}
                      onClick={() => navigate(`/purchase-orders/${po.po_id}`)}
                    >
                      {/* PO No / Date */}
                      <td className="px-4 py-3">
                        <p className="font-data-mono text-[13px] font-bold text-on-surface">{po.po_id}</p>
                        <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{fmtDate(po.date_issued)}</p>
                      </td>

                      {/* Vendor */}
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-semibold text-on-surface">{po.stakeholders?.name ?? '—'}</p>
                        <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{po.stakeholders?.category ?? ''}</p>
                      </td>

                      {/* Project */}
                      <td className="px-4 py-3">
                        <p className="text-[13px] font-medium text-on-surface">{po.projects?.name ?? '—'}</p>
                        <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{po.projects?.site_location ?? ''}</p>
                      </td>

                      {/* Items */}
                      <td className="px-4 py-3 max-w-[180px] hidden xl:table-cell">
                        <p className="text-[11px] text-on-surface-variant/60 line-clamp-2">{getItemsPreview(po)}</p>
                      </td>

                      {/* Amount */}
                      <td className="px-4 py-3 text-right">
                        <p className="font-data-mono text-[13px] font-semibold text-on-surface">
                          ₹{Number(po.total_value || po.order_value).toLocaleString('en-IN')}
                        </p>
                        {(() => {
                          const paid = poPayments?.[po.po_id] ?? 0;
                          if (paid > 0) {
                            const total = Number(po.total_value || po.order_value) || 0;
                            return (
                              <p className={`text-[11px] mt-0.5 font-data-mono ${paid >= total ? 'text-emerald-600' : 'text-amber-600'}`}>
                                Paid ₹{paid.toLocaleString('en-IN')}
                              </p>
                            );
                          }
                          return null;
                        })()}
                      </td>

                      {/* Bill Amount */}
                      <td className="px-4 py-3 text-right w-[120px]" onClick={e => e.stopPropagation()}>
                        {hasBill ? (
                          <div>
                            <p className="font-data-mono text-[13px] font-semibold text-on-surface">
                              ₹{Number(billAmt).toLocaleString('en-IN')}
                            </p>
                            {(() => {
                              const total = Number(po.total_value || po.order_value) || 0;
                              const diff  = Number(billAmt) - total;
                              const abs   = Math.abs(diff);
                              const pct   = total > 0 ? abs / total : 0;
                              if (abs < 100) return <p className="text-[10px] text-green-600 font-semibold">✓ Exact</p>;
                              return (
                                <p className={`text-[10px] font-data-mono font-semibold flex items-center gap-0.5 justify-end ${pct > 0.05 ? 'text-amber-600' : diff > 0 ? 'text-red-500' : 'text-green-600'}`}>
                                  {pct > 0.05 && <span className="material-symbols-outlined text-[11px]">warning</span>}
                                  {diff > 0 ? '+' : '-'}₹{abs.toLocaleString('en-IN')}
                                </p>
                              );
                            })()}
                          </div>
                        ) : po.status === 'AT_SITE' && canManage ? (
                          <button
                            onClick={() => navigate(`/purchase-orders/${po.po_id}`)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 ml-auto text-[11px] font-semibold text-amber-600 hover:text-amber-700 bg-amber-50 hover:bg-amber-100 px-2 py-0.5 rounded-lg"
                          >
                            <span className="material-symbols-outlined text-[13px]">receipt</span>
                            Add Bill
                          </button>
                        ) : (
                          <span className="text-on-surface-variant/30 text-[12px]">—</span>
                        )}
                      </td>

                      {/* At Site */}
                      <td className="px-4 py-3 text-center w-[90px]" onClick={e => e.stopPropagation()}>
                        {po.received_at_site ? (
                          <div>
                            <p className="text-[10px] font-bold text-teal-600">✓ {po.received_by_name?.split(' ')[0] ?? 'Received'}</p>
                            <p className="text-[10px] text-on-surface-variant/50 mt-0.5">{fmtDate(po.received_at_site)}</p>
                          </div>
                        ) : (po.status === 'ORDERED' && canManage) ? (
                          <button
                            onClick={() => recordSiteReceipt.mutate(po)}
                            disabled={recordSiteReceipt.isPending}
                            title="Mark received at site"
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 mx-auto text-[10px] text-on-surface-variant/40 hover:text-violet-600 disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[14px]">local_shipping</span>
                            <span>At site?</span>
                          </button>
                        ) : null}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_CHIP[po.status] ?? 'bg-surface-container text-on-surface-variant'}`}>
                          {STATUS_LABEL[po.status] ?? po.status}
                        </span>
                        {isOverdue(po) && (
                          <p className="text-[10px] text-red-500 font-semibold mt-1">Overdue</p>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile card list */}
        {filtered.length > 0 && (
          <div className="md:hidden space-y-3">
            {filtered.map((po, idx) => {
              return (
                <div
                  key={po.po_id}
                  className={`bg-white rounded-2xl border border-black/[0.06] shadow-sm p-4 cursor-pointer active:scale-[0.99] transition-transform wo-row-animate ${STATUS_BORDER[po.status] ?? ''}`}
                  style={{ animationDelay: `${Math.min(idx, 20) * 15}ms` }}
                  onClick={() => navigate(`/purchase-orders/${po.po_id}`)}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div>
                      <p className="font-data-mono text-[13px] font-bold text-on-surface">{po.po_id}</p>
                      <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{fmtDate(po.date_issued)}</p>
                    </div>
                    <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_CHIP[po.status] ?? 'bg-surface-container text-on-surface-variant'}`}>
                      {STATUS_LABEL[po.status] ?? po.status}
                    </span>
                  </div>
                  <p className="text-[13px] font-semibold text-on-surface">{po.stakeholders?.name ?? '—'}</p>
                  <p className="text-[11px] text-on-surface-variant/60 mt-0.5 line-clamp-1">{getItemsPreview(po)}</p>
                  <div className="flex justify-between items-center mt-3 pt-2.5 border-t border-outline-variant/10">
                    <p className="text-[11px] text-on-surface-variant/60">{po.projects?.name ?? '—'}</p>
                    <div className="text-right">
                      <p className="font-data-mono text-[13px] font-bold text-on-surface">
                        ₹{Number(po.total_value || po.order_value).toLocaleString('en-IN')}
                      </p>
                      {(() => {
                        const paid = poPayments?.[po.po_id] ?? 0;
                        if (paid > 0) {
                          const total = Number(po.total_value || po.order_value) || 0;
                          return (
                            <p className={`text-[10px] font-data-mono ${paid >= total ? 'text-emerald-600' : 'text-amber-600'}`}>
                              Paid ₹{paid.toLocaleString('en-IN')}
                            </p>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* FAB */}
        {canManage && (
          <button
            className="bk-fab md:hidden"
            onClick={() => navigate('/purchase-orders/new')}
            title="New Purchase Order"
          >
            <span className="material-symbols-outlined text-[24px]">add</span>
          </button>
        )}
      </div>

    </div>
  );
}
