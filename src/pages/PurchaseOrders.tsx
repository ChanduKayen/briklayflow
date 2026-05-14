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
  'Draft':               'bg-surface-container-highest text-on-surface-variant',
  'Pending Approval':    'bg-amber-100 text-amber-800',
  'Approved':            'bg-blue-100 text-blue-700',
  'Ordered':             'bg-blue-100 text-blue-800',
  'Partially Delivered': 'bg-teal-100 text-teal-700',
  'Delivered':           'bg-teal-100 text-teal-800',
  'Tallied':             'bg-green-100 text-green-800',
  'Disputed':            'bg-red-100 text-red-800',
  'Cancelled':           'bg-surface-container text-on-surface-variant/50',
  'Issued':              'bg-blue-100 text-blue-800',
  'Received':            'bg-teal-100 text-teal-800',
  'Closed':              'bg-green-100 text-green-800',
};

const STATUS_BORDER: Record<string, string> = {
  'Draft':               'border-l-4 border-l-on-surface-variant/20',
  'Pending Approval':    'border-l-4 border-l-amber-400',
  'Approved':            'border-l-4 border-l-blue-400',
  'Ordered':             'border-l-4 border-l-blue-500',
  'Partially Delivered': 'border-l-4 border-l-teal-400',
  'Delivered':           'border-l-4 border-l-teal-600',
  'Tallied':             'border-l-4 border-l-green-500',
  'Disputed':            'border-l-4 border-l-red-500',
  'Cancelled':           'border-l-4 border-l-on-surface-variant/30',
  'Issued':              'border-l-4 border-l-blue-500',
  'Received':            'border-l-4 border-l-teal-500',
  'Closed':              'border-l-4 border-l-green-500',
};

const ALL_STATUSES = ['Draft','Pending Approval','Approved','Ordered','Partially Delivered','Delivered','Tallied','Disputed','Cancelled'];

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
  if (['Delivered', 'Tallied', 'Cancelled', 'Closed'].includes(po.status)) return false;
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

function billState(po: any): 'none' | 'attached' | 'tallied' | 'disputed' {
  if (!po.vendor_bill_no) return 'none';
  if (po.status === 'Tallied' || po.three_way_match === 'MATCHED') return 'tallied';
  if (po.status === 'Disputed' || po.three_way_match === 'MISMATCHED') return 'disputed';
  return 'attached';
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

// ── Quick Attach Bill Modal ───────────────────────────────────────────────────

function QuickAttachModal({
  po, onClose, onSave, isPending,
}: { po: any; onClose: () => void; onSave: (bill: { billNo: string; billDate: string; billAmount: string; file: File | null }) => void; isPending?: boolean }) {
  const totalValue = Number(po.total_value || po.order_value) || 0;
  const [billNo, setBillNo]         = useState(po.vendor_bill_no || '');
  const [billDate, setBillDate]     = useState(po.vendor_bill_date || new Date().toISOString().split('T')[0]);
  const [billAmount, setBillAmount] = useState(po.vendor_bill_amount ? String(po.vendor_bill_amount) : '');
  const [billFile, setBillFile]     = useState<File | null>(null);

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
          <div>
            <p className="text-[15px] font-bold text-on-surface">Vendor Bill</p>
            <p className="text-[12px] text-on-surface-variant/50 font-data-mono mt-0.5">{po.po_id}</p>
          </div>
          <button onClick={onClose} className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg">
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Vendor Bill No *</label>
            <input className="bk-input font-data-mono" placeholder="e.g. INV/2026/001" value={billNo} onChange={e => setBillNo(e.target.value)} />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Bill Date</label>
              <input type="date" className="bk-input" value={billDate} onChange={e => setBillDate(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Bill Amount (₹)</label>
              <input
                type="number"
                className="bk-input font-data-mono"
                placeholder={String(totalValue)}
                value={billAmount}
                onChange={e => setBillAmount(e.target.value)}
                step="any"
              />
            </div>
          </div>
          <p className="text-[11px] text-on-surface-variant/50">
            PO Value: <span className="font-data-mono font-semibold text-on-surface">₹{totalValue.toLocaleString('en-IN')}</span>
            {billAmount && Math.abs(parseFloat(billAmount) - totalValue) > 0 && (
              <span className={`ml-2 ${Math.abs(parseFloat(billAmount) - totalValue) / totalValue > 0.02 ? 'text-red-500' : 'text-green-600'}`}>
                {parseFloat(billAmount) > totalValue ? '▲' : '▼'} ₹{Math.abs(parseFloat(billAmount) - totalValue).toLocaleString('en-IN')} variance
              </span>
            )}
          </p>
          <div>
            <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Bill Document</label>
            <label className="flex items-center gap-2 px-3 py-2 rounded-xl border border-outline-variant/30 cursor-pointer hover:bg-surface-container-low transition-colors w-fit">
              <span className="material-symbols-outlined text-[16px] text-on-surface-variant">upload_file</span>
              <span className="text-[12px] text-on-surface-variant">
                {billFile ? billFile.name : 'Upload PDF / image'}
              </span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                onChange={e => setBillFile(e.target.files?.[0] ?? null)}
              />
            </label>
            {billFile && (
              <button
                onClick={() => setBillFile(null)}
                className="mt-1 text-[11px] text-on-surface-variant/50 hover:text-red-500 flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[13px]">close</span>
                Remove
              </button>
            )}
          </div>
        </div>
        <div className="px-6 py-4 border-t border-outline-variant/10 flex gap-3 justify-end">
          <button onClick={onClose} className="bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2 rounded-xl">
            Cancel
          </button>
          <button
            onClick={() => onSave({ billNo, billDate, billAmount, file: billFile })}
            disabled={!billNo.trim() || isPending}
            className="bk-btn text-[13px] px-5 py-2 rounded-xl flex items-center gap-2 disabled:opacity-50"
          >
            {isPending ? 'Saving…' : 'Save Bill'}
            <span className="material-symbols-outlined text-[16px]">{isPending ? 'hourglass_empty' : 'rule'}</span>
          </button>
        </div>
      </div>
    </div>
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
  const [filterTally, setFilterTally]     = useState<string[]>([]);
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchTerm, setSearchTerm]       = useState('');

  // chip dropdown open state
  const [openChip, setOpenChip] = useState<'date' | 'status' | 'vendor' | 'project' | 'tally' | null>(null);

  // chip anchor refs
  const dateRef    = useRef<HTMLDivElement>(null);
  const statusRef  = useRef<HTMLDivElement>(null);
  const vendorRef  = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);
  const tallyRef   = useRef<HTMLDivElement>(null);

  // bill attach modal
  const [attachPO, setAttachPO] = useState<any | null>(null);

  // inline bill editing
  const [editingBill, setEditingBill] = useState<string | null>(null);
  const [billEditNo, setBillEditNo]   = useState('');
  const [billEditAmt, setBillEditAmt] = useState('');

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

  const attachBill = useMutation({
    mutationFn: async ({ po, billNo, billDate, billAmount, file }: { po: any; billNo: string; billDate: string; billAmount: string; file: File | null }) => {
      const totalValue  = Number(po.total_value || po.order_value) || 0;
      const parsedAmt   = parseFloat(billAmount);
      const hasAmount   = !isNaN(parsedAmt) && billAmount.trim() !== '';

      let vendor_bill_doc_url: string | undefined;
      if (file) {
        const ext  = file.name.split('.').pop();
        const path = `po-bills/${po.po_id}-${Date.now()}.${ext}`;
        const { error: upErr } = await supabase.storage.from('documents').upload(path, file);
        if (upErr) throw upErr;
        const { data: pub } = supabase.storage.from('documents').getPublicUrl(path);
        vendor_bill_doc_url = pub.publicUrl;
      }

      const patch: Record<string, any> = {
        vendor_bill_no:   billNo.trim(),
        vendor_bill_date: billDate || null,
        three_way_match:  'PENDING',
        ...(vendor_bill_doc_url ? { vendor_bill_doc_url } : {}),
      };

      let match = 'PENDING';
      if (hasAmount) {
        const ratio = totalValue > 0 ? Math.abs(parsedAmt - totalValue) / totalValue : 0;
        match = ratio < 0.02 ? 'MATCHED' : 'MISMATCHED';
        patch.vendor_bill_amount = parsedAmt;
        patch.three_way_match    = match;
        patch.status             = match === 'MATCHED' ? 'Tallied' : 'Disputed';
      }

      const { error } = await supabase.from('purchase_orders').update(patch).eq('po_id', po.po_id);
      if (error) throw error;
      return match;
    },
    onSuccess: (match) => {
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setAttachPO(null);
      showSnackbar(
        match === 'MATCHED'    ? 'Bill tallied — amounts match' :
        match === 'MISMATCHED' ? 'Bill attached — amounts differ, marked Disputed' :
                                 'Bill attached — enter amount to run match'
      );
    },
    onError: (err: any) => {
      showSnackbar(err?.message || 'Failed to attach bill', { type: 'error' });
    },
  });

  const saveBillInline = useMutation({
    mutationFn: async ({ po, billNo, billAmt }: { po: any; billNo: string; billAmt: string }) => {
      const totalValue = Number(po.total_value || po.order_value) || 0;
      const parsedAmt  = parseFloat(billAmt);
      const hasAmount  = !isNaN(parsedAmt) && billAmt.trim() !== '';

      const patch: Record<string, any> = {
        vendor_bill_no:  billNo.trim(),
        three_way_match: 'PENDING',
      };

      let match = 'PENDING';
      if (hasAmount) {
        const ratio = totalValue > 0 ? Math.abs(parsedAmt - totalValue) / totalValue : 0;
        match = ratio < 0.02 ? 'MATCHED' : 'MISMATCHED';
        patch.vendor_bill_amount = parsedAmt;
        patch.three_way_match    = match;
        patch.status             = match === 'MATCHED' ? 'Tallied' : 'Disputed';
      }

      const { error } = await supabase.from('purchase_orders').update(patch).eq('po_id', po.po_id);
      if (error) throw error;
      return match;
    },
    onSuccess: (match) => {
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setEditingBill(null);
      showSnackbar(
        match === 'MATCHED'    ? 'Bill tallied — amounts match' :
        match === 'MISMATCHED' ? 'Bill attached — amounts differ, marked Disputed' :
                                 'Bill attached'
      );
    },
    onError: (err: any) => showSnackbar(err?.message || 'Failed to save bill', { type: 'error' }),
  });

  const recordSiteReceipt = useMutation({
    mutationFn: async (po: any) => {
      const { error } = await supabase.from('purchase_orders').update({
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

  function startBillEdit(po: any) {
    setEditingBill(po.po_id);
    setBillEditNo(po.vendor_bill_no || '');
    setBillEditAmt(po.vendor_bill_amount ? String(po.vendor_bill_amount) : '');
  }

  // ── Derived filter options ─────────────────────────────────────────────────
  const vendors  = [...new Set((pos ?? []).map(p => p.stakeholders?.name).filter(Boolean))].sort();
  const projects = [...new Set((pos ?? []).map(p => p.projects?.name).filter(Boolean))].sort();
  const TALLY_OPTS = ['Tallied', 'Disputed', 'Pending'];

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const totalCount      = pos?.length ?? 0;
  const totalCommitted  = pos?.reduce((s, p) => s + (Number(p.total_value) || Number(p.order_value) || 0), 0) ?? 0;
  const pendingDelivery = pos?.filter(p => ['Ordered', 'Partially Delivered', 'Approved', 'Issued'].includes(p.status)).length ?? 0;
  const untallied       = pos?.filter(p => ['Ordered', 'Partially Delivered', 'Delivered', 'Received'].includes(p.status)).length ?? 0;

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
    if (filterTally.length) {
      const bs = billState(po);
      if (filterTally.includes('Tallied')  && bs !== 'tallied')  return false;
      if (filterTally.includes('Disputed') && bs !== 'disputed') return false;
      if (filterTally.includes('Pending')  && bs !== 'none')     return false;
    }
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
  const hasFilters = datePreset !== 'all' || filterStatus.length || filterVendor.length || filterProject.length || filterTally.length || searchTerm;

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
              <span className="px-3 py-1 bg-blue-50 text-blue-700 text-[12px] rounded-full">
                <span className="font-bold">{untallied}</span> untallied
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

          {/* Tally chip */}
          <div ref={tallyRef} className="relative">
            <FilterChip
              label={filterTally.length ? `Tally (${filterTally.length})` : 'Tally'}
              active={filterTally.length > 0 || openChip === 'tally'}
              onClick={() => toggleChip('tally')}
            />
            <Dropdown anchorRef={tallyRef as React.RefObject<HTMLElement>} open={openChip === 'tally'} onClose={() => setOpenChip(null)}>
              <MultiCheckList options={TALLY_OPTS} selected={filterTally} onChange={setFilterTally} />
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
              onClick={() => { setDatePreset('all'); setFilterStatus([]); setFilterVendor([]); setFilterProject([]); setFilterTally([]); setSearchTerm(''); setSearchOpen(false); }}
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
                  <th className="px-4 py-3 text-center w-[80px]">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Bill</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((po, idx) => {
                  const bs = billState(po);
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

                      {/* Bill Amount — inline edit */}
                      <td className="px-4 py-3 text-right w-[120px]" onClick={e => e.stopPropagation()}>
                        {editingBill === po.po_id ? (
                          <div className="flex flex-col gap-1 items-end">
                            <input
                              autoFocus
                              className="w-full text-right text-[11px] border border-outline-variant/40 rounded px-1.5 py-0.5 font-data-mono focus:outline-none focus:border-primary bg-white"
                              placeholder="Bill #"
                              value={billEditNo}
                              onChange={e => setBillEditNo(e.target.value)}
                              onClick={e => e.stopPropagation()}
                            />
                            <input
                              type="number"
                              className="w-full text-right text-[11px] border border-outline-variant/40 rounded px-1.5 py-0.5 font-data-mono focus:outline-none focus:border-primary bg-white"
                              placeholder="₹ Amount"
                              value={billEditAmt}
                              onChange={e => setBillEditAmt(e.target.value)}
                              onClick={e => e.stopPropagation()}
                            />
                            <div className="flex gap-1 mt-0.5">
                              <button
                                onClick={() => saveBillInline.mutate({ po, billNo: billEditNo, billAmt: billEditAmt })}
                                disabled={!billEditNo.trim() || saveBillInline.isPending}
                                className="px-2 py-0.5 rounded text-[10px] font-bold bg-primary text-white disabled:opacity-50 hover:bg-primary/90"
                              >
                                {saveBillInline.isPending ? '…' : '✓'}
                              </button>
                              <button
                                onClick={() => setEditingBill(null)}
                                className="px-2 py-0.5 rounded text-[10px] text-on-surface-variant hover:bg-surface-container"
                              >
                                ✕
                              </button>
                            </div>
                          </div>
                        ) : po.vendor_bill_amount ? (
                          <div className="cursor-pointer" onClick={() => startBillEdit(po)}>
                            <p className="font-data-mono text-[13px] font-semibold text-on-surface">
                              ₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}
                            </p>
                            {(() => {
                              const total = Number(po.total_value || po.order_value) || 0;
                              const diff  = Number(po.vendor_bill_amount) - total;
                              const abs   = Math.abs(diff);
                              if (abs < 100) return <p className="text-[10px] text-green-600 font-semibold">✓ Exact</p>;
                              return (
                                <p className={`text-[10px] font-data-mono font-semibold ${diff > 0 ? 'text-red-500' : 'text-green-600'}`}>
                                  {diff > 0 ? '+' : '-'}₹{abs.toLocaleString('en-IN')}
                                </p>
                              );
                            })()}
                          </div>
                        ) : po.vendor_bill_no ? (
                          <div className="cursor-pointer text-right" onClick={() => startBillEdit(po)}>
                            <p className="text-[10px] text-amber-600 font-data-mono truncate max-w-[100px] ml-auto">{po.vendor_bill_no}</p>
                            <p className="text-[10px] text-on-surface-variant/50">No amount</p>
                          </div>
                        ) : canManage ? (
                          <button
                            onClick={() => startBillEdit(po)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity text-[11px] text-on-surface-variant/40 hover:text-primary flex items-center gap-0.5 ml-auto"
                          >
                            <span className="material-symbols-outlined text-[13px]">add</span>
                            Add bill
                          </button>
                        ) : (
                          <span className="text-on-surface-variant/30 text-[12px]">—</span>
                        )}
                      </td>

                      {/* At Site */}
                      <td className="px-4 py-3 text-center w-[90px]" onClick={e => e.stopPropagation()}>
                        {po.received_at_site ? (
                          <div>
                            <p className="text-[10px] font-bold text-teal-600">✓ Received</p>
                            <p className="text-[10px] text-on-surface-variant/50 mt-0.5">{fmtDate(po.received_at_site)}</p>
                          </div>
                        ) : (['Ordered','Partially Delivered','Delivered','Received','Issued','Approved'].includes(po.status) && canManage) ? (
                          <button
                            onClick={() => recordSiteReceipt.mutate(po)}
                            disabled={recordSiteReceipt.isPending}
                            title="Record site receipt"
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-0.5 mx-auto text-[10px] text-on-surface-variant/40 hover:text-teal-600 disabled:opacity-50"
                          >
                            <span className="material-symbols-outlined text-[14px]">local_shipping</span>
                            <span>At site?</span>
                          </button>
                        ) : null}
                      </td>

                      {/* Status */}
                      <td className="px-4 py-3">
                        <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_CHIP[po.status] ?? STATUS_CHIP['Draft']}`}>
                          {po.status?.toUpperCase()}
                        </span>
                        {isOverdue(po) && (
                          <p className="text-[10px] text-red-500 font-semibold mt-1">Overdue</p>
                        )}
                      </td>

                      {/* Bill column */}
                      <td className="px-4 py-3 text-center" onClick={e => e.stopPropagation()}>
                        {bs === 'tallied' && (
                          <span title="Bill tallied" className="material-symbols-outlined text-[18px] text-green-500">attach_money</span>
                        )}
                        {bs === 'disputed' && (
                          <span title="Mismatch" className="material-symbols-outlined text-[18px] text-red-500">receipt_long</span>
                        )}
                        {bs === 'attached' && (
                          <span title="Bill attached" className="material-symbols-outlined text-[18px] text-amber-500">attach_file</span>
                        )}
                        {bs === 'none' && canManage && (
                          <button
                            title="Attach bill"
                            onClick={() => setAttachPO(po)}
                            className="opacity-0 group-hover:opacity-100 transition-opacity w-7 h-7 rounded-lg flex items-center justify-center mx-auto hover:bg-surface-container text-on-surface-variant/50 hover:text-on-surface"
                          >
                            <span className="material-symbols-outlined text-[17px]">attach_file</span>
                          </button>
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
              const bs = billState(po);
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
                    <div className="flex items-center gap-2">
                      {bs === 'tallied'  && <span className="material-symbols-outlined text-[16px] text-green-500">attach_money</span>}
                      {bs === 'disputed' && <span className="material-symbols-outlined text-[16px] text-red-500">receipt_long</span>}
                      {bs === 'attached' && <span className="material-symbols-outlined text-[16px] text-amber-500">attach_file</span>}
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_CHIP[po.status] ?? STATUS_CHIP['Draft']}`}>
                        {po.status?.toUpperCase()}
                      </span>
                    </div>
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

      {/* Quick attach modal */}
      {attachPO && (
        <QuickAttachModal
          po={attachPO}
          onClose={() => setAttachPO(null)}
          isPending={attachBill.isPending}
          onSave={({ billNo, billDate, billAmount, file }) =>
            attachBill.mutate({ po: attachPO, billNo, billDate, billAmount, file })
          }
        />
      )}
    </div>
  );
}
