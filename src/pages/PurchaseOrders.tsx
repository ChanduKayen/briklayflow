import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PageSkeleton } from '../components/SkeletonLoader';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';
import ReceiveAtSiteDrawer from '../components/ReceiveAtSiteDrawer';
import { usePrefetchPO } from '../hooks/usePrefetch';
import BottomSheet from '../components/BottomSheet';

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtShortDate(d: string | null | undefined) {
  if (!d) return '';
  const p = new Date(d);
  if (isNaN(p.getTime())) return '';
  return p.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
}

function isOverdue(po: any): boolean {
  if (!po.expected_delivery) return false;
  const d = new Date(po.expected_delivery);
  if (isNaN(d.getTime())) return false;
  if (['BILLED', 'PARTIAL', 'PAID', 'CANCELLED'].includes(po.status)) return false;
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
  return '';
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


// ─────────────────────────────────────────────────────────────────────────
//  Action-first redesign primitives (status pill, primary-action mapping,
//  POCard). The actual DB statuses are uppercase: ORDERED, BILLED, PARTIAL,
//  PAID, CANCELLED. There is no "Awaiting Quotes" status here — RFQ flow
//  lives under /procurement/quotes.
// ─────────────────────────────────────────────────────────────────────────

type ReceiptSummaryMap = Record<string, { receipt_pct?: number } | undefined>;
type PaymentTotalsMap = Record<string, number>;

const STATUS_PILL: Record<string, { bg: string; text: string; icon: string; label: string }> = {
  ORDERED:   { bg: 'bg-blue-50',   text: 'text-blue-700',   icon: 'receipt_long', label: 'Ordered'   },
  BILLED:    { bg: 'bg-amber-50',  text: 'text-amber-700',  icon: 'receipt',      label: 'Billed'    },
  PARTIAL:   { bg: 'bg-orange-50', text: 'text-orange-700', icon: 'payments',     label: 'Partial'   },
  PAID:      { bg: 'bg-green-50',  text: 'text-green-700',  icon: 'check_circle', label: 'Paid'      },
  CANCELLED: { bg: 'bg-gray-100',  text: 'text-gray-500',   icon: 'cancel',       label: 'Cancelled' },
};

function StatusPill({ status }: { status: string }) {
  const c = STATUS_PILL[status] ?? { bg: 'bg-surface-container', text: 'text-on-surface-variant', icon: 'circle', label: status };
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium ${c.bg} ${c.text}`}>
      <span className="material-symbols-outlined text-[12px]" style={{ fontVariationSettings: "'FILL' 1" }}>{c.icon}</span>
      {c.label}
    </span>
  );
}

function poHasBill(po: any): boolean { return Number(po.vendor_bill_amount) > 0; }
function poHasBillDoc(po: any): boolean { return !!(po.vendor_bill_url || po.vendor_bill_doc_url); }
function poReceiptPct(po: any, summaries?: ReceiptSummaryMap): number {
  return Number(summaries?.[po.po_id]?.receipt_pct ?? 0);
}
function poFullyReceived(po: any, summaries?: ReceiptSummaryMap): boolean {
  return poReceiptPct(po, summaries) >= 100;
}
function poPaidAmount(po: any, payments?: PaymentTotalsMap): number {
  return Number(payments?.[po.po_id] ?? 0);
}
/**
 * Outstanding rupees owed to the vendor for this PO. Returns `null` when the
 * PO is not in a "ready to pay" state (e.g. not yet received, no bill, no
 * bill doc, or cancelled).
 */
function poPendingPayment(po: any, summaries?: ReceiptSummaryMap, payments?: PaymentTotalsMap): number | null {
  if (po.status === 'CANCELLED') return null;
  if (!poFullyReceived(po, summaries)) return null;
  if (!poHasBill(po)) return null;
  if (!poHasBillDoc(po)) return null;
  const billed = Number(po.vendor_bill_amount) || 0;
  const paid = poPaidAmount(po, payments);
  return Math.max(0, billed - paid);
}
/**
 * "Archived" = nothing left to do. Items received, vendor bill recorded with
 * doc attached, and payment fully settled (either status=PAID, or paid total
 * meets the bill amount).
 */
function poIsArchived(po: any, summaries?: ReceiptSummaryMap, payments?: PaymentTotalsMap): boolean {
  if (po.status === 'CANCELLED') return false;
  if (!poFullyReceived(po, summaries)) return false;
  if (!poHasBill(po)) return false;
  if (!poHasBillDoc(po)) return false;
  if (po.status === 'PAID') return true;
  const pending = poPendingPayment(po, summaries, payments);
  return pending !== null && pending === 0;
}

function poNeedsAction(po: any, summaries?: ReceiptSummaryMap, payments?: PaymentTotalsMap): boolean {
  if (po.status === 'CANCELLED') return false;
  if (poIsArchived(po, summaries, payments)) return false;
  if (isOverdue(po) && !poFullyReceived(po, summaries)) return true;
  if (po.status === 'ORDERED' && !poHasBill(po)) return true;
  if (poHasBill(po) && !poHasBillDoc(po)) return true;
  if (['BILLED', 'PARTIAL', 'PAID'].includes(po.status) && !poFullyReceived(po, summaries)) return true;
  // Bill + doc + received but payment still pending → action needed (recording the payment lives elsewhere, surface it here)
  const pending = poPendingPayment(po, summaries, payments);
  if (pending !== null && pending > 0) return true;
  return false;
}

type POPrimaryAction =
  | { kind: 'click'; label: string; icon: string; variant: 'primary' | 'secondary'; onClick: () => void }
  | { kind: 'upload-bill'; label: string; icon: string; variant: 'primary' | 'secondary' };

function getPrimaryAction(args: {
  po: any;
  summaries?: ReceiptSummaryMap;
  payments?: PaymentTotalsMap;
  canManage: boolean;
  navigateToDetail: () => void;
  openReceiveDrawer: () => void;
}): POPrimaryAction | null {
  const { po, summaries, payments, canManage, navigateToDetail, openReceiveDrawer } = args;
  if (po.status === 'CANCELLED' || !canManage) return null;
  if (poIsArchived(po, summaries, payments)) return null;
  const received = poFullyReceived(po, summaries);
  const hasBill = poHasBill(po);
  const hasDoc = poHasBillDoc(po);

  if (po.status === 'ORDERED' && !hasBill) {
    return { kind: 'click', label: 'Record Bill', icon: 'receipt_long', variant: 'primary', onClick: navigateToDetail };
  }
  if (!received) {
    return { kind: 'click', label: 'Receive Items', icon: 'local_shipping', variant: hasBill ? 'primary' : 'secondary', onClick: openReceiveDrawer };
  }
  if (hasBill && !hasDoc) {
    // Inline file upload — no navigation. Handled by POCard.
    return { kind: 'upload-bill', label: 'Attach Bill Copy', icon: 'attach_file', variant: 'primary' };
  }
  return null;
}

function POCard({
  po, summaries, payments, canManage, showProject, onNavigate, onReceive, onAttachBill, uploadingBill, prefetchProps,
}: {
  po: any;
  summaries?: ReceiptSummaryMap;
  payments?: PaymentTotalsMap;
  canManage: boolean;
  showProject: boolean;
  onNavigate: () => void;
  onReceive: () => void;
  onAttachBill: (file: File) => void;
  uploadingBill: boolean;
  prefetchProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  const action = getPrimaryAction({
    po, summaries, payments, canManage,
    navigateToDetail: onNavigate,
    openReceiveDrawer: onReceive,
  });
  const overdue = isOverdue(po) && !poFullyReceived(po, summaries);
  const pct = poReceiptPct(po, summaries);
  const billed = poHasBill(po);
  const billAmount = Number(po.vendor_bill_amount) || 0;
  const orderAmount = Number(po.total_value) || Number(po.order_value) || 0;
  const itemsPreview = getItemsPreview(po);
  const pending = poPendingPayment(po, summaries, payments);
  const showPendingPayment = pending !== null && pending > 0;

  const actionClass = action
    ? `inline-flex items-center gap-1.5 px-4 min-h-[40px] rounded-lg text-[13px] font-medium transition-colors ${
        action.variant === 'primary'
          ? 'bg-primary/10 text-primary hover:bg-primary/20'
          : 'text-on-surface-variant hover:bg-surface-container'
      }`
    : '';

  return (
    <div
      onClick={onNavigate}
      {...prefetchProps}
      className={`bg-white rounded-2xl border border-outline-variant/15 shadow-sm hover:shadow-md hover:border-outline-variant/25 active:scale-[0.99] transition-all cursor-pointer overflow-hidden ${overdue ? 'border-l-[3px] border-l-red-400' : ''}`}
    >
      {/* Row 1: PO# left · amount right */}
      <div className="px-4 pt-3.5 flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-mono text-[11px] text-on-surface-variant/45 leading-none">{po.po_id}</p>
          <p className="text-[15px] font-semibold text-on-surface mt-1.5 leading-tight truncate">{po.stakeholders?.name ?? '—'}</p>
          <p className="text-[12px] text-on-surface-variant/50 mt-0.5 truncate">
            {[po.stakeholders?.category, itemsPreview].filter(Boolean).join(' · ') || '—'}
          </p>
        </div>
        <div className="text-right shrink-0">
          {billed ? (
            <>
              <p className="font-mono text-[15px] font-bold text-green-700 tabular-nums leading-none">
                ₹{billAmount.toLocaleString('en-IN')}
              </p>
              <p className="text-[10px] text-on-surface-variant/40 mt-1">billed</p>
            </>
          ) : orderAmount > 0 ? (
            <>
              <p className="font-mono text-[15px] font-semibold text-on-surface tabular-nums leading-none">
                ₹{orderAmount.toLocaleString('en-IN')}
              </p>
              <p className="text-[10px] text-amber-600/80 mt-1">no bill</p>
            </>
          ) : (
            <p className="text-[12px] text-on-surface-variant/30">₹ TBC</p>
          )}
        </div>
      </div>

      {/* Row 2: project · date · status */}
      <div className="px-4 mt-2 flex items-center gap-2 text-[11px] text-on-surface-variant/45">
        {showProject && po.projects?.name && <span className="truncate max-w-[40%]">{po.projects.name}</span>}
        {showProject && po.projects?.name && <span className="text-on-surface-variant/20">·</span>}
        <span>{po.expected_delivery ? fmtShortDate(po.expected_delivery) : fmtShortDate(po.date_issued)}</span>
        {overdue && <span className="text-red-500 font-medium">· Overdue</span>}
        <span className="ml-auto"><StatusPill status={po.status} /></span>
      </div>

      {/* Row 3a (optional): receipt progress bar */}
      {pct > 0 && pct < 100 && (
        <div className="px-4 mt-2.5 flex items-center gap-2">
          <div className="flex-1 h-[3px] rounded-full bg-outline-variant/15 overflow-hidden">
            <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] text-amber-600/80 tabular-nums">{pct}% received</span>
        </div>
      )}

      {/* Row 3b (optional): pending payment indicator */}
      {showPendingPayment && (
        <div className="mx-4 mt-2.5 flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-amber-50 border border-amber-100">
          <span className="material-symbols-outlined text-[14px] text-amber-600">schedule</span>
          <span className="text-[12px] font-medium text-amber-700">Pending payment</span>
          <span className="ml-auto font-mono text-[13px] font-bold text-amber-700 tabular-nums">
            ₹{pending!.toLocaleString('en-IN')}
          </span>
        </div>
      )}

      {/* Row 4: primary action (one button only) */}
      {action ? (
        <div className="mt-3 px-3 pb-3 pt-2 border-t border-outline-variant/10 flex justify-end">
          {action.kind === 'upload-bill' ? (
            <label
              onClick={e => e.stopPropagation()}
              className={`${actionClass} ${uploadingBill ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
            >
              <span className={`material-symbols-outlined text-[16px] ${uploadingBill ? 'animate-spin' : ''}`}>
                {uploadingBill ? 'progress_activity' : action.icon}
              </span>
              {uploadingBill ? 'Uploading…' : action.label}
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                disabled={uploadingBill}
                onChange={e => {
                  const f = e.target.files?.[0];
                  // Reset the input so re-selecting the same file still fires onChange
                  e.target.value = '';
                  if (f) onAttachBill(f);
                }}
              />
            </label>
          ) : (
            <button
              onClick={e => { e.stopPropagation(); action.onClick(); }}
              className={actionClass}
            >
              <span className="material-symbols-outlined text-[16px]">{action.icon}</span>
              {action.label}
            </button>
          )}
        </div>
      ) : (
        <div className="h-3" />
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseOrders({ session }: { session: Session }) {
  const navigate    = useNavigate();
  const qc          = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const { show: showSnackbar } = useSnackbar();

  // URL-synced active tab — ?status=ordered, etc.
  const [searchParams, setSearchParams] = useSearchParams();
  const activeTab = (searchParams.get('status') ?? 'all').toLowerCase();
  const setActiveTab = (tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      if (tab === 'all') next.delete('status');
      else next.set('status', tab);
      return next;
    }, { replace: true });
  };

  const [searchTerm, setSearchTerm]       = useState('');
  const [showFiltersSheet, setShowFiltersSheet] = useState(false);

  // Advanced filters (behind the Filters button)
  const [datePreset, setDatePreset]       = useState<DatePreset>('all');
  const [filterVendor, setFilterVendor]   = useState<string[]>([]);
  const [filterProject, setFilterProject] = useState<string[]>([]);

  const [drawerPO, setDrawerPO] = useState<any | null>(null);

  const canManage =
    profile?.role === 'management' ||
    profile?.role === 'principal' ||
    profile?.role === 'accountant';

  const prefetchPO = usePrefetchPO();

  const { data: rawPos, isLoading } = useQuery({
    queryKey: ['purchase_orders_enhanced'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          po_id, org_id, status, date_issued, created_at, ordered_by, expected_delivery,
          total_value, order_value,
          vendor_bill_amount, vendor_bill_number, vendor_bill_no,
          vendor_bill_url, vendor_bill_doc_url, vendor_bill_date,
          bill_recorded_at, bill_recorded_by_name,
          received_at_site, received_by_name, received_by_user_id,
          stakeholder_id, project_id,
          projects(name, site_location),
          stakeholders(name, category, gstin, is_approved),
          po_line_items(id, item_name, unit, quantity_ordered, unit_rate)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  const pos = rawPos ?? [];

  const { data: receiptSummaries } = useQuery({
    queryKey: ['po_receipt_summary'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('po_receipt_summary')
        .select('po_id, receipt_count, receipt_pct, last_receipt_date');
      if (error) throw error;
      const map: Record<string, any> = {};
      (data ?? []).forEach((r: any) => { map[r.po_id] = r; });
      return map;
    },
  });

  // Paid total per PO (sum of non-voided txn_allocations).
  // Used to drive "Pending payment ₹X" indicator and the Archived state.
  const { data: poPaymentTotals } = useQuery<PaymentTotalsMap>({
    queryKey: ['po_payment_totals'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('order_ref, allocated_amount, transactions!inner(status)')
        .eq('order_type', 'PO')
        .neq('transactions.status', 'Voided');
      if (error) throw error;
      const map: PaymentTotalsMap = {};
      (data ?? []).forEach((r: any) => {
        if (!r.order_ref) return;
        map[r.order_ref] = (map[r.order_ref] ?? 0) + Number(r.allocated_amount ?? 0);
      });
      return map;
    },
    staleTime: 60_000,
  });

  const vendors  = [...new Set(pos.map(p => p.stakeholders?.name).filter(Boolean))].sort() as string[];
  const projects = [...new Set(pos.map(p => p.projects?.name).filter(Boolean))].sort() as string[];

  const totalCount = pos.length;

  // ── Filtering pipeline ────────────────────────────────────────────────
  // 1) advanced filters (date / vendor / project) — behind the "Filters" button
  // 2) search — client-side, instant
  // 3) status tab — All / Action / Ordered / Billed / Partial / Paid / Cancelled

  const { from: dateFrom, to: dateTo } = dateRange(datePreset);

  const afterFilters = useMemo(() => pos.filter(po => {
    if (dateFrom && dateTo) {
      const d = new Date(po.date_issued || po.created_at);
      if (d < dateFrom || d > dateTo) return false;
    }
    if (filterVendor.length && !filterVendor.includes(po.stakeholders?.name)) return false;
    if (filterProject.length && !filterProject.includes(po.projects?.name)) return false;
    return true;
  }), [pos, dateFrom, dateTo, filterVendor, filterProject]);

  const afterSearch = useMemo(() => {
    if (!searchTerm.trim()) return afterFilters;
    const q = searchTerm.toLowerCase();
    return afterFilters.filter(po =>
      po.po_id?.toLowerCase().includes(q) ||
      po.stakeholders?.name?.toLowerCase().includes(q) ||
      po.stakeholders?.category?.toLowerCase().includes(q) ||
      po.projects?.name?.toLowerCase().includes(q) ||
      getItemsPreview(po).toLowerCase().includes(q)
    );
  }, [afterFilters, searchTerm]);

  // Tab counts use the post-filter, post-search universe so they react to
  // the current view rather than the raw list. Counts exclude archived POs
  // (except the Archived tab itself) so the main view stays decluttered.
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: 0,
      action: 0,
      ordered: 0,
      billed: 0,
      partial: 0,
      paid: 0,
      cancelled: 0,
      archived: 0,
    };
    for (const po of afterSearch) {
      const archived = poIsArchived(po, receiptSummaries, poPaymentTotals);
      if (archived) { counts.archived++; continue; }
      counts.all++;
      if (poNeedsAction(po, receiptSummaries, poPaymentTotals)) counts.action++;
      const key = (po.status ?? '').toLowerCase();
      if (counts[key] !== undefined) counts[key]++;
    }
    return counts;
  }, [afterSearch, receiptSummaries, poPaymentTotals]);

  const visiblePOs = useMemo(() => {
    switch (activeTab) {
      case 'archived':  return afterSearch.filter(p => poIsArchived(p, receiptSummaries, poPaymentTotals));
      case 'action':    return afterSearch.filter(p => !poIsArchived(p, receiptSummaries, poPaymentTotals) && poNeedsAction(p, receiptSummaries, poPaymentTotals));
      case 'ordered':
      case 'billed':
      case 'partial':
      case 'paid':
      case 'cancelled': return afterSearch.filter(p =>
        !poIsArchived(p, receiptSummaries, poPaymentTotals) && (p.status ?? '').toLowerCase() === activeTab);
      default:          return afterSearch.filter(p => !poIsArchived(p, receiptSummaries, poPaymentTotals));
    }
  }, [afterSearch, activeTab, receiptSummaries, poPaymentTotals]);

  // Auto-grouping when "all" tab is active
  const { actionPOs, recentPOs } = useMemo(() => {
    if (activeTab !== 'all') return { actionPOs: [], recentPOs: visiblePOs };
    const action: any[] = [];
    const rest: any[] = [];
    for (const po of visiblePOs) {
      if (poNeedsAction(po, receiptSummaries, poPaymentTotals)) action.push(po);
      else rest.push(po);
    }
    // Action: overdue first, then oldest first
    action.sort((a, b) => {
      const aOver = isOverdue(a) && !poFullyReceived(a, receiptSummaries);
      const bOver = isOverdue(b) && !poFullyReceived(b, receiptSummaries);
      if (aOver !== bOver) return aOver ? -1 : 1;
      return new Date(a.date_issued || a.created_at).getTime() - new Date(b.date_issued || b.created_at).getTime();
    });
    // Rest: newest first
    rest.sort((a, b) => new Date(b.date_issued || b.created_at).getTime() - new Date(a.date_issued || a.created_at).getTime());
    return { actionPOs: action, recentPOs: rest };
  }, [visiblePOs, activeTab, receiptSummaries, poPaymentTotals]);

  const advancedActiveCount =
    (datePreset !== 'all' ? 1 : 0) + (filterVendor.length ? 1 : 0) + (filterProject.length ? 1 : 0);
  const hasAnyFilter = !!searchTerm || advancedActiveCount > 0 || activeTab !== 'all';

  function clearAllFilters() {
    setDatePreset('all');
    setFilterVendor([]);
    setFilterProject([]);
    setSearchTerm('');
    setActiveTab('all');
  }

  useEffect(() => {
    const handler = () => navigate('/purchase-orders/new');
    window.addEventListener('shortcut:new-po', handler);
    return () => window.removeEventListener('shortcut:new-po', handler);
  }, [navigate]);

  // ── Inline "Attach Bill Copy" upload ────────────────────────────────
  // Same storage layout as the old VendorBillDocCell.handleDirectUpload —
  // keeps existing assets discoverable. Per-PO upload state lives in a map
  // so two concurrent uploads (rare on mobile) don't fight over one flag.
  const [uploadingBillIds, setUploadingBillIds] = useState<Record<string, boolean>>({});

  const handleAttachBill = async (po: any, file: File) => {
    setUploadingBillIds(prev => ({ ...prev, [po.po_id]: true }));
    try {
      const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
      const path = `po-bills/${po.po_id}-${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(path, file, { contentType: file.type });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from('documents').getPublicUrl(path);
      const url = pub.publicUrl;
      const { error } = await supabase
        .from('purchase_orders')
        .update({ vendor_bill_url: url, vendor_bill_doc_url: url })
        .eq('po_id', po.po_id);
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      showSnackbar('📎 Invoice document attached');
    } catch (err: any) {
      showSnackbar(err.message || 'Upload failed', { type: 'error' });
    } finally {
      setUploadingBillIds(prev => {
        const next = { ...prev };
        delete next[po.po_id];
        return next;
      });
    }
  };

  const openReceiveDrawerFor = (po: any) => {
    setDrawerPO({
      po_id:           po.po_id,
      org_id:          po.org_id,
      project_id:      po.project_id,
      stakeholder_id:  po.stakeholder_id,
      stakeholder_name: po.stakeholders?.name ?? '',
      line_items:      (po.po_line_items ?? []).map((li: any) => ({
        id:                  li.id,
        item_name:           li.item_name,
        unit:                li.unit ?? 'Nos',
        quantity_ordered:    Number(li.quantity_ordered ?? 0),
        unit_rate:           Number(li.unit_rate ?? 0),
        qty_received_so_far: 0,
      })),
    });
  };

  const STATUS_TABS: { key: string; label: string; icon?: string }[] = [
    { key: 'all',       label: 'All' },
    { key: 'action',    label: 'Action',   icon: 'priority_high' },
    { key: 'ordered',   label: 'Ordered'   },
    { key: 'billed',    label: 'Billed'    },
    { key: 'partial',   label: 'Partial'   },
    { key: 'paid',      label: 'Paid'      },
    { key: 'cancelled', label: 'Cancelled' },
    { key: 'archived',  label: 'Archived', icon: 'archive' },
  ];

  return (
    <div className="min-h-screen bg-surface-container-low/30">
      <div className="max-w-[960px] mx-auto px-4 md:px-6 pt-6 pb-24 md:pb-12">

        {/* Header — compact: title + count + New button */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <h1 className="text-[20px] md:text-[22px] font-semibold text-on-surface tracking-tight">Purchase Orders</h1>
            <span className="text-[12px] text-on-surface-variant/55 bg-surface-container px-2 py-0.5 rounded-full font-medium tabular-nums">
              {totalCount}
            </span>
          </div>
          {canManage && (
            <button
              onClick={() => navigate('/purchase-orders/new')}
              className="hidden md:inline-flex items-center gap-1.5 px-4 h-9 rounded-full text-white text-[13px] font-medium transition-colors shadow-sm"
              style={{ background: '#C8603A' }}
            >
              <span className="material-symbols-outlined text-[17px]">add</span>
              New Purchase Order
            </button>
          )}
        </div>

        {/* Search hero */}
        <div className="relative mb-3">
          <span className="material-symbols-outlined absolute left-3 top-1/2 -translate-y-1/2 text-[20px] text-on-surface-variant/40 pointer-events-none">search</span>
          <input
            type="text"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            placeholder="Search vendor, item, or PO number…"
            className="w-full h-12 pl-11 pr-10 rounded-xl border border-outline-variant/30 bg-white text-[15px] placeholder:text-on-surface-variant/35 focus:border-primary/50 focus:ring-2 focus:ring-primary/10 focus:outline-none transition-all"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm('')}
              aria-label="Clear search"
              className="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-full flex items-center justify-center text-on-surface-variant/40 hover:bg-surface-container"
            >
              <span className="material-symbols-outlined text-[18px]">close</span>
            </button>
          )}
        </div>

        {/* Status tabs + Filters button (horizontal scroll on mobile) */}
        <div className="flex items-center gap-2 mb-5 overflow-x-auto no-scrollbar pb-1">
          {STATUS_TABS.map(tab => {
            const count = tabCounts[tab.key];
            const isActive = activeTab === tab.key;
            // Hide zero-count tabs except 'all' and 'action'
            if ((count === 0 || count === undefined) && tab.key !== 'all' && tab.key !== 'action') return null;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`inline-flex items-center gap-1.5 px-3.5 h-9 rounded-full text-[13px] font-medium whitespace-nowrap shrink-0 touch-active transition-colors ${
                  isActive
                    ? 'bg-primary/10 text-primary'
                    : 'text-on-surface-variant/65 hover:bg-surface-container'
                }`}
              >
                {tab.icon && <span className="material-symbols-outlined text-[15px]">{tab.icon}</span>}
                {tab.label}
                <span className={`text-[11px] tabular-nums ${isActive ? 'text-primary/75' : 'text-on-surface-variant/40'}`}>
                  {count ?? 0}
                </span>
              </button>
            );
          })}
          <button
            onClick={() => setShowFiltersSheet(true)}
            className="inline-flex items-center gap-1.5 px-3 h-9 rounded-full text-[13px] text-on-surface-variant/65 hover:bg-surface-container whitespace-nowrap shrink-0 touch-active"
          >
            <span className="material-symbols-outlined text-[16px]">tune</span>
            Filters
            {advancedActiveCount > 0 && (
              <span className="ml-0.5 min-w-[18px] h-[18px] rounded-full bg-primary text-on-primary text-[10px] font-bold flex items-center justify-center px-1">
                {advancedActiveCount}
              </span>
            )}
          </button>
        </div>

        {/* Loading state */}
        {isLoading && <div className="mb-4"><PageSkeleton /></div>}

        {/* Empty: zero POs ever */}
        {!isLoading && pos.length === 0 && (
          <div className="flex flex-col items-center text-center py-16">
            <span className="material-symbols-outlined text-[48px] text-on-surface-variant/20 mb-3">shopping_cart</span>
            <h3 className="text-[16px] font-medium text-on-surface mb-1">No purchase orders yet</h3>
            <p className="text-[14px] text-on-surface-variant/55 max-w-xs mb-6">
              Create your first purchase order to start tracking vendor orders and payments.
            </p>
            {canManage && (
              <button
                onClick={() => navigate('/purchase-orders/new')}
                className="px-5 py-2.5 rounded-lg text-white text-[13px] font-medium"
                style={{ background: '#C8603A' }}
              >
                + New Purchase Order
              </button>
            )}
          </div>
        )}

        {/* Empty: search or tab returns nothing */}
        {!isLoading && pos.length > 0 && visiblePOs.length === 0 && (
          <div className="flex flex-col items-center text-center py-12">
            <span className="material-symbols-outlined text-[36px] text-on-surface-variant/20 mb-3">search_off</span>
            <p className="text-[14px] text-on-surface-variant/55">
              No purchase orders match {searchTerm ? <>&ldquo;{searchTerm}&rdquo;</> : <>the &ldquo;{activeTab}&rdquo; filter</>}
            </p>
            {hasAnyFilter && (
              <button onClick={clearAllFilters} className="text-[13px] text-primary mt-3 font-medium">
                Clear filters
              </button>
            )}
          </div>
        )}

        {/* "All caught up" banner — when on 'all' tab and nothing needs attention */}
        {!isLoading && activeTab === 'all' && pos.length > 0 && actionPOs.length === 0 && recentPOs.length > 0 && (
          <div className="flex items-center gap-2 px-4 py-3 bg-green-50/70 border border-green-100 rounded-xl mb-4">
            <span className="material-symbols-outlined text-[18px] text-green-600">task_alt</span>
            <span className="text-[13px] text-green-700 font-medium">All caught up — no orders need attention</span>
          </div>
        )}

        {/* Card sections */}
        {!isLoading && visiblePOs.length > 0 && (
          activeTab === 'all' ? (
            <>
              {actionPOs.length > 0 && (
                <section className="mb-6">
                  <div className="flex items-center gap-2 mb-3 px-1">
                    <span className="material-symbols-outlined text-[16px] text-amber-500">priority_high</span>
                    <h2 className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-[0.08em]">Needs attention</h2>
                    <span className="text-[11px] text-on-surface-variant/40 tabular-nums">{actionPOs.length}</span>
                  </div>
                  <div className="flex flex-col gap-3">
                    {actionPOs.map((po, i) => (
                      <div key={po.po_id} className="wo-row-animate" style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}>
                        <POCard
                          po={po}
                          summaries={receiptSummaries}
                          payments={poPaymentTotals}
                          canManage={canManage}
                          showProject
                          onNavigate={() => navigate(`/purchase-orders/${po.po_id}`)}
                          onReceive={() => openReceiveDrawerFor(po)}
                          onAttachBill={(file) => handleAttachBill(po, file)}
                          uploadingBill={!!uploadingBillIds[po.po_id]}
                          prefetchProps={prefetchPO(po.po_id)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}

              {recentPOs.length > 0 && (
                <section>
                  {actionPOs.length > 0 && (
                    <div className="flex items-center gap-2 mb-3 px-1">
                      <h2 className="text-[11px] font-semibold text-on-surface-variant/55 uppercase tracking-[0.08em]">Recent</h2>
                    </div>
                  )}
                  <div className="flex flex-col gap-3">
                    {recentPOs.map((po, i) => (
                      <div key={po.po_id} className="wo-row-animate" style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}>
                        <POCard
                          po={po}
                          summaries={receiptSummaries}
                          payments={poPaymentTotals}
                          canManage={canManage}
                          showProject
                          onNavigate={() => navigate(`/purchase-orders/${po.po_id}`)}
                          onReceive={() => openReceiveDrawerFor(po)}
                          onAttachBill={(file) => handleAttachBill(po, file)}
                          uploadingBill={!!uploadingBillIds[po.po_id]}
                          prefetchProps={prefetchPO(po.po_id)}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          ) : (
            <div className="flex flex-col gap-3">
              {visiblePOs
                .slice()
                .sort((a, b) => new Date(b.date_issued || b.created_at).getTime() - new Date(a.date_issued || a.created_at).getTime())
                .map((po, i) => (
                  <div key={po.po_id} className="wo-row-animate" style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}>
                    <POCard
                      po={po}
                      summaries={receiptSummaries}
                      payments={poPaymentTotals}
                      canManage={canManage}
                      showProject
                      onNavigate={() => navigate(`/purchase-orders/${po.po_id}`)}
                      onReceive={() => openReceiveDrawerFor(po)}
                      onAttachBill={(file) => handleAttachBill(po, file)}
                      uploadingBill={!!uploadingBillIds[po.po_id]}
                      prefetchProps={prefetchPO(po.po_id)}
                    />
                  </div>
                ))}
            </div>
          )
        )}


        {canManage && (
          <button className="bk-fab md:hidden" onClick={() => navigate('/purchase-orders/new')} title="New Purchase Order">
            <span className="material-symbols-outlined text-[24px]">add</span>
          </button>
        )}
      </div>

      {/* Advanced filters sheet — date range / vendor / project */}
      <BottomSheet
        open={showFiltersSheet}
        onClose={() => setShowFiltersSheet(false)}
        title="Filters"
        desktopAllowed
      >
        <div className="space-y-5 pb-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant/55 mb-2">Date range</p>
            <div className="flex flex-wrap gap-2">
              {(['all','today','week','month','quarter'] as DatePreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => setDatePreset(p)}
                  className={`px-3 h-9 rounded-full text-[13px] font-medium ${
                    datePreset === p ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant'
                  }`}
                >
                  {DATE_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {vendors.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant/55 mb-2">
                Vendor
                {filterVendor.length > 0 && <span className="ml-2 text-primary/70 tabular-nums">{filterVendor.length}</span>}
              </p>
              <div className="flex flex-wrap gap-2 max-h-[40vh] overflow-y-auto">
                {vendors.map(v => {
                  const on = filterVendor.includes(v);
                  return (
                    <button
                      key={v}
                      onClick={() => setFilterVendor(s => on ? s.filter(x => x !== v) : [...s, v])}
                      className={`px-3 h-9 rounded-full text-[13px] font-medium truncate max-w-[200px] ${
                        on ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant'
                      }`}
                    >
                      {v}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {projects.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] text-on-surface-variant/55 mb-2">
                Project
                {filterProject.length > 0 && <span className="ml-2 text-primary/70 tabular-nums">{filterProject.length}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {projects.map(p => {
                  const on = filterProject.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => setFilterProject(s => on ? s.filter(x => x !== p) : [...s, p])}
                      className={`px-3 h-9 rounded-full text-[13px] font-medium truncate max-w-[200px] ${
                        on ? 'bg-primary/10 text-primary' : 'bg-surface-container text-on-surface-variant'
                      }`}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-outline-variant/15">
            <button
              onClick={() => { setDatePreset('all'); setFilterVendor([]); setFilterProject([]); }}
              className="flex-1 h-10 rounded-lg border border-outline-variant text-[13px] font-medium text-on-surface-variant"
            >
              Reset
            </button>
            <button
              onClick={() => setShowFiltersSheet(false)}
              className="flex-1 h-10 rounded-lg bg-primary text-on-primary text-[13px] font-medium"
            >
              Show {visiblePOs.length} result{visiblePOs.length === 1 ? '' : 's'}
            </button>
          </div>
        </div>
      </BottomSheet>

      {/* Receive at site drawer */}
      {drawerPO && (
        <ReceiveAtSiteDrawer
          isOpen={!!drawerPO}
          po={drawerPO}
          session={session}
          onClose={() => setDrawerPO(null)}
          onSuccess={(grnId) => {
            setDrawerPO(null);
            qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
            qc.invalidateQueries({ queryKey: ['po_receipt_summary'] });
            showSnackbar(`GRN ${grnId} recorded`);
          }}
        />
      )}
    </div>
  );
}
