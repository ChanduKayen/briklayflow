import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { supabase } from '../lib/supabase';
import { LinearProgress } from '../components/LinearProgress';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<string, string> = {
  'ORDERED':   'bg-[#EFF6FF] text-[#3B82F6]',
  'BILLED':    'bg-[#FFFBEB] text-[#D97706]',
  'PARTIAL':   'bg-[#FFF7ED] text-[#EA580C]',
  'PAID':      'bg-[#F0FDF4] text-[#16A34A]',
  'CANCELLED': 'bg-[#F9FAFB] text-[#6B7280]',
};

const STATUS_BORDER: Record<string, string> = {
  'ORDERED':   'border-l-4 border-l-[#3B82F6]',
  'BILLED':    'border-l-4 border-l-[#D97706]',
  'PARTIAL':   'border-l-4 border-l-[#EA580C]',
  'PAID':      'border-l-4 border-l-[#16A34A]',
  'CANCELLED': 'border-l-4 border-l-[#6B7280]',
};

const STATUS_LABEL: Record<string, string> = {
  'ORDERED':   'Ordered',
  'BILLED':    'Billed',
  'PARTIAL':   'Partially Paid',
  'PAID':      'Paid',
  'CANCELLED': 'Cancelled',
};

const ALL_STATUSES = ['ORDERED', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED'];

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

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

// ── VendorBillCell ────────────────────────────────────────────────────────────

function VendorBillCell({
  po, canManage, currentUserName, onUpdate, showSnackbar,
}: {
  po: any;
  canManage: boolean;
  currentUserName: string;
  onUpdate: (poId: string, updates: any) => void;
  showSnackbar: (msg: string, opts?: any) => void;
}) {
  const [editing, setEditing]   = useState(false);
  const [amount, setAmount]     = useState('');
  const [billNo, setBillNo]     = useState('');
  const [saving, setSaving]     = useState(false);

  const hasBill = Number(po.vendor_bill_amount) > 0;

  const handleSave = async () => {
    const parsed = parseFloat(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    const { error } = await supabase
      .from('purchase_orders')
      .update({
        vendor_bill_amount:    parsed,
        vendor_bill_number:    billNo.trim() || null,
        vendor_bill_no:        billNo.trim() || null,
        bill_recorded_at:      new Date().toISOString(),
        bill_recorded_by_name: currentUserName,
      })
      .eq('po_id', po.po_id);
    setSaving(false);
    if (!error) {
      setEditing(false);
      onUpdate(po.po_id, {
        vendor_bill_amount: parsed,
        vendor_bill_number: billNo.trim() || null,
        bill_recorded_at:   new Date().toISOString(),
      });
      confetti({ particleCount: 60, spread: 50, origin: { y: 0.6 }, colors: ['#16A34A', '#F59E0B', '#ffffff'] });
      showSnackbar(`🎉 Bill recorded! ₹${parsed.toLocaleString('en-IN')} · Now mark as received at site`);
    } else {
      showSnackbar(error.message || 'Failed to save bill', { type: 'error' });
    }
  };

  // Read-only: no canManage
  if (!canManage) {
    if (hasBill) {
      return (
        <td className="px-3 py-2 w-[200px]">
          <div className="rounded-[10px] p-[10px_14px] bg-[#F0FDF4] border border-[#BBF7D0]">
            <p className="text-[18px] font-bold text-[#16A34A] font-mono leading-none">
              ₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}
            </p>
            {(po.vendor_bill_number || po.vendor_bill_no) && (
              <p className="text-[10px] font-mono text-on-surface-variant/60 mt-1">
                {po.vendor_bill_number || po.vendor_bill_no}
              </p>
            )}
          </div>
        </td>
      );
    }
    return <td className="px-3 py-2 w-[200px]"><span className="text-on-surface-variant/30 text-[12px]">—</span></td>;
  }

  // STATE A — no bill, not editing
  if (!hasBill && !editing) {
    return (
      <td className="px-3 py-2 w-[200px]" onClick={e => e.stopPropagation()}>
        <div
          onClick={() => { setAmount(''); setBillNo(po.vendor_bill_number || po.vendor_bill_no || ''); setEditing(true); }}
          className="rounded-[10px] bg-[#FFFBEB] border border-dashed border-amber-400 cursor-pointer hover:bg-[#FEF3C7] hover:border-solid transition-all flex items-center gap-2.5 px-[14px] py-[10px]"
        >
          <span className="text-[18px] shrink-0">💰</span>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-amber-700 leading-tight">Enter Vendor Bill</p>
            <p className="text-[10px] text-amber-600">Tap to record bill amount</p>
          </div>
        </div>
      </td>
    );
  }

  // STATE B — editing
  if (editing) {
    return (
      <td className="px-3 py-2 w-[200px]" onClick={e => e.stopPropagation()}>
        <div className="rounded-[10px] p-3 bg-white border-2 border-amber-400 shadow-[0_4px_12px_rgba(245,158,11,0.2)] relative z-10">
          <p className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide mb-2">Vendor Bill Amount</p>
          <div className="relative mb-2">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[18px] font-bold text-amber-600">₹</span>
            <input
              type="number"
              placeholder="0"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') handleSave();
                if (e.key === 'Escape') { setEditing(false); setAmount(''); }
              }}
              className="w-full h-11 text-[20px] font-bold pl-9 pr-3 border-2 border-amber-400 rounded-lg bg-amber-50 focus:outline-none focus:border-amber-600 focus:bg-white"
              autoFocus
            />
          </div>
          <input
            type="text"
            placeholder="Bill / Invoice No (optional)"
            value={billNo}
            onChange={e => setBillNo(e.target.value)}
            className="w-full h-8 px-3 mb-2.5 text-[12px] border border-outline-variant/30 rounded-lg focus:outline-none focus:border-amber-400 bg-white"
          />
          <div className="flex gap-2">
            <button
              onClick={handleSave}
              disabled={!amount || parseFloat(amount) <= 0 || saving}
              className={`flex-1 h-9 rounded-lg text-[13px] font-semibold transition-colors ${
                amount && parseFloat(amount) > 0
                  ? 'bg-amber-500 text-white hover:bg-amber-600'
                  : 'bg-gray-100 text-gray-400 cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving…' : 'Save Bill'}
            </button>
            <button
              onClick={() => { setEditing(false); setAmount(''); }}
              className="w-9 h-9 rounded-lg border border-outline-variant/30 text-on-surface-variant hover:bg-surface-container flex items-center justify-center text-[13px]"
            >
              ✕
            </button>
          </div>
        </div>
      </td>
    );
  }

  // STATE C — bill recorded
  return (
    <td className="px-3 py-2 w-[200px]" onClick={e => e.stopPropagation()}>
      <div
        onClick={() => { setAmount(String(po.vendor_bill_amount)); setBillNo(po.vendor_bill_number || po.vendor_bill_no || ''); setEditing(true); }}
        className="rounded-[10px] px-[14px] py-[10px] bg-[#F0FDF4] border border-[#BBF7D0] cursor-pointer hover:border-green-400 transition-colors group"
      >
        <div className="flex items-start justify-between">
          <p className="text-[18px] font-bold text-[#16A34A] font-mono leading-none">
            ₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}
          </p>
          <span className="text-[14px] text-green-500">✓</span>
        </div>
        {(po.vendor_bill_number || po.vendor_bill_no) && (
          <p className="text-[10px] font-mono text-on-surface-variant/60 mt-1">
            {po.vendor_bill_number || po.vendor_bill_no}
          </p>
        )}
        {po.bill_recorded_at && (
          <p className="text-[10px] text-on-surface-variant/50">
            Recorded {fmtShortDate(po.bill_recorded_at)}
          </p>
        )}
        <p className="text-[9px] text-on-surface-variant/40 opacity-0 group-hover:opacity-100 transition-opacity mt-0.5">
          Click to edit
        </p>
      </div>
    </td>
  );
}

// ── BillUploadCell ────────────────────────────────────────────────────────────

function BillUploadCell({
  po, canManage, onUpdate, showSnackbar,
}: {
  po: any;
  canManage: boolean;
  onUpdate: (poId: string, updates: any) => void;
  showSnackbar: (msg: string, opts?: any) => void;
}) {
  const [uploading, setUploading] = useState(false);
  const billUrl = po.vendor_bill_url || po.vendor_bill_doc_url;

  if (billUrl) {
    return (
      <td className="px-3 py-2 w-[140px]" onClick={e => e.stopPropagation()}>
        <a
          href={billUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center gap-2 px-3 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-[12px] font-medium hover:bg-green-100 transition-colors w-full justify-center"
        >
          <span>📄</span>
          View Bill
        </a>
      </td>
    );
  }

  if (!canManage) {
    return (
      <td className="px-3 py-2 w-[140px]">
        <span className="text-on-surface-variant/30 text-[12px]">—</span>
      </td>
    );
  }

  return (
    <td className="px-3 py-2 w-[140px]" onClick={e => e.stopPropagation()}>
      <label
        className={`flex items-center gap-2 px-3 py-2 border border-dashed border-outline-variant/40 rounded-lg text-[12px] text-on-surface-variant w-full justify-center transition-colors ${
          uploading
            ? 'cursor-wait opacity-60'
            : 'cursor-pointer hover:border-[#C8603A] hover:text-[#C8603A] hover:bg-orange-50'
        }`}
      >
        <span>{uploading ? '⟳' : '📎'}</span>
        {uploading ? 'Uploading…' : 'Upload Bill'}
        <input
          type="file"
          accept=".pdf,.jpg,.jpeg,.png"
          className="hidden"
          disabled={uploading}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
            const path = `po-bills/${po.po_id}-${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from('documents')
              .upload(path, file, { contentType: file.type });
            if (!upErr) {
              const { data: pub } = supabase.storage.from('documents').getPublicUrl(path);
              const url = pub.publicUrl;
              await supabase
                .from('purchase_orders')
                .update({ vendor_bill_url: url, vendor_bill_doc_url: url })
                .eq('po_id', po.po_id);
              onUpdate(po.po_id, { vendor_bill_url: url });
              showSnackbar('📎 Bill document uploaded!');
            } else {
              showSnackbar(upErr.message || 'Upload failed', { type: 'error' });
            }
            setUploading(false);
            e.target.value = '';
          }}
        />
      </label>
    </td>
  );
}

// ── SiteReceiptCell ───────────────────────────────────────────────────────────

function SiteReceiptCell({
  po, canManage, currentUserName, currentUserId, onUpdate, showSnackbar,
}: {
  po: any;
  canManage: boolean;
  currentUserName: string;
  currentUserId: string;
  onUpdate: (poId: string, updates: any) => void;
  showSnackbar: (msg: string, opts?: any) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving]         = useState(false);

  const hasBill    = Number(po.vendor_bill_amount) > 0;
  const isReceived = !!po.received_at_site;

  // RECEIVED
  if (isReceived) {
    return (
      <td className="px-3 py-2 w-[130px]">
        <div className="rounded-lg px-3 py-2 bg-purple-50 border border-purple-200">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-purple-500 shrink-0" />
            <p className="text-[12px] font-semibold text-purple-700">At Site ✓</p>
          </div>
          <p className="text-[10px] text-on-surface-variant/60 mt-0.5">
            {po.received_by_name?.split(' ')[0] ?? ''}
            {po.received_at_site ? ` · ${fmtShortDate(po.received_at_site)}` : ''}
          </p>
        </div>
      </td>
    );
  }

  if (!canManage) {
    return <td className="px-3 py-2 w-[130px]"><span className="text-on-surface-variant/30 text-[12px]">—</span></td>;
  }

  // LOCKED — no bill yet
  if (!hasBill) {
    return (
      <td className="px-3 py-2 w-[130px]">
        <div
          className="rounded-lg px-3 py-2 bg-gray-50 border border-gray-200 opacity-60"
          title="Enter vendor bill amount first"
        >
          <p className="text-[11px] text-on-surface-variant/60 text-center">🔒 Enter bill first</p>
        </div>
      </td>
    );
  }

  // CONFIRMING
  if (confirming) {
    return (
      <td className="px-3 py-2 w-[130px]" onClick={e => e.stopPropagation()}>
        <div className="rounded-lg p-3 bg-white border-2 border-purple-400 shadow-lg relative z-10">
          <p className="text-[11px] font-semibold text-purple-700 mb-2">Confirm site receipt?</p>
          <div className="flex gap-1.5">
            <button
              onClick={async () => {
                setSaving(true);
                const now = new Date().toISOString();
                const { error } = await supabase
                  .from('purchase_orders')
                  .update({
                    received_at_site:    now,
                    received_by_name:    currentUserName,
                    received_by_user_id: currentUserId,
                    status:              'BILLED',
                  })
                  .eq('po_id', po.po_id);
                setSaving(false);
                setConfirming(false);
                if (!error) {
                  onUpdate(po.po_id, {
                    received_at_site: now,
                    received_by_name: currentUserName,
                    status:           'BILLED',
                  });
                  showSnackbar('📦 Receipt confirmed — status updated to Billed');
                } else {
                  showSnackbar(error.message || 'Failed to confirm receipt', { type: 'error' });
                }
              }}
              disabled={saving}
              className="flex-1 py-1.5 rounded-md bg-purple-600 text-white text-[11px] font-semibold hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? '…' : '✓ Confirm'}
            </button>
            <button
              onClick={() => setConfirming(false)}
              className="px-2 py-1.5 rounded-md border border-outline-variant/30 text-[11px] text-on-surface-variant hover:bg-surface-container"
            >
              ✕
            </button>
          </div>
        </div>
      </td>
    );
  }

  // READY — bill exists, not yet received
  return (
    <td className="px-3 py-2 w-[130px]" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setConfirming(true)}
        className="flex items-center gap-2 px-3 py-2 w-full justify-center bg-purple-600 text-white rounded-lg text-[12px] font-medium hover:bg-purple-700 transition-colors shadow-sm shadow-purple-200"
      >
        <span>📦</span>
        Mark at Site
      </button>
    </td>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseOrders({ session }: { session: Session }) {
  const navigate    = useNavigate();
  const qc          = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const { show: showSnackbar } = useSnackbar();

  // ── Filter state ───────────────────────────────────────────────────────────
  const [datePreset, setDatePreset]       = useState<DatePreset>('all');
  const [filterStatus, setFilterStatus]   = useState<string[]>([]);
  const [filterVendor, setFilterVendor]   = useState<string[]>([]);
  const [filterProject, setFilterProject] = useState<string[]>([]);
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchTerm, setSearchTerm]       = useState('');

  const [openChip, setOpenChip] = useState<'date' | 'status' | 'vendor' | 'project' | null>(null);

  const dateRef    = useRef<HTMLDivElement>(null);
  const statusRef  = useRef<HTMLDivElement>(null);
  const vendorRef  = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);

  // ── Local optimistic overrides ─────────────────────────────────────────────
  const [poOverrides, setPoOverrides] = useState<Record<string, any>>({});

  const handlePOUpdate = (poId: string, updates: any) => {
    setPoOverrides(prev => ({ ...prev, [poId]: { ...(prev[poId] || {}), ...updates } }));
    qc.setQueryData(['purchase_orders_enhanced'], (old: any[] | undefined) =>
      old?.map(p => p.po_id === poId ? { ...p, ...updates } : p)
    );
  };

  const canManage =
    profile?.role === 'management' ||
    profile?.role === 'principal' ||
    profile?.role === 'accountant';

  const currentUserName: string = (profile as any)?.display_name || (profile as any)?.name || session.user.email || 'Unknown';
  const currentUserId: string   = session.user.id;

  // ── Data ───────────────────────────────────────────────────────────────────
  const { data: rawPos, isLoading } = useQuery({
    queryKey: ['purchase_orders_enhanced'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select(`
          po_id, status, date_issued, created_at, ordered_by, expected_delivery,
          total_value, order_value,
          vendor_bill_amount, vendor_bill_number, vendor_bill_no,
          vendor_bill_url, vendor_bill_doc_url, vendor_bill_date,
          bill_recorded_at, bill_recorded_by_name,
          received_at_site, received_by_name, received_by_user_id,
          stakeholder_id, project_id,
          projects(name, site_location),
          stakeholders(name, category, gstin, is_approved),
          po_line_items(id, item_name)
        `)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
  });

  // Merge server data with local optimistic overrides
  const pos = (rawPos ?? []).map(p =>
    poOverrides[p.po_id] ? { ...p, ...poOverrides[p.po_id] } : p
  );

  // ── Derived filter options ─────────────────────────────────────────────────
  const vendors  = [...new Set(pos.map(p => p.stakeholders?.name).filter(Boolean))].sort() as string[];
  const projects = [...new Set(pos.map(p => p.projects?.name).filter(Boolean))].sort() as string[];

  // ── KPIs ───────────────────────────────────────────────────────────────────
  const totalCount      = pos.length;
  const pendingDelivery = pos.filter(p => p.status === 'ORDERED').length;
  const pendingBill     = pos.filter(p => p.status === 'ORDERED' && !Number(p.vendor_bill_amount)).length;

  // ── Filtering ──────────────────────────────────────────────────────────────
  const { from: dateFrom, to: dateTo } = dateRange(datePreset);

  const filtered = pos.filter(po => {
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
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8">

        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-6">
          <div>
            <h2 className="text-[24px] font-bold text-on-surface tracking-tight">Purchase Orders</h2>
            <div className="flex flex-wrap gap-2.5 mt-2">
              <span className="px-3 py-1 bg-surface-container text-[12px] rounded-full text-on-surface-variant">
                <span className="font-bold text-on-surface">{totalCount}</span> orders
              </span>
              <span className="px-3 py-1 bg-amber-50 text-amber-700 text-[12px] rounded-full">
                <span className="font-bold">{pendingDelivery}</span> pending delivery
              </span>
              {pendingBill > 0 && (
                <span className="px-3 py-1 bg-orange-50 text-orange-700 text-[12px] rounded-full">
                  <span className="font-bold">{pendingBill}</span> need bill entry
                </span>
              )}
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

        {/* Filter bar */}
        <div className="flex items-center gap-2 overflow-x-auto no-scrollbar md:flex-wrap flex-nowrap mb-4 pb-0.5">

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
          Showing <span className="font-semibold text-on-surface">{filtered.length}</span> of {totalCount} orders
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
                  <th className="px-4 py-3 text-left w-[120px]">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Status</span>
                  </th>
                  <th className="px-3 py-3 text-left w-[200px]">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Vendor Bill</span>
                  </th>
                  <th className="px-3 py-3 text-left w-[140px]">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Bill Doc</span>
                  </th>
                  <th className="px-3 py-3 text-left w-[130px]">
                    <span className="text-[10px] font-bold text-on-surface-variant/60 uppercase tracking-wider">At Site</span>
                  </th>
                  <th className="px-3 py-3 w-[44px]" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((po, idx) => (
                  <tr
                    key={po.po_id}
                    className={`border-b border-outline-variant/[0.06] wo-row-animate ${STATUS_BORDER[po.status] ?? 'border-l-4 border-l-transparent'}`}
                    style={{ animationDelay: `${Math.min(idx, 20) * 15}ms` }}
                  >
                    {/* PO No / Date */}
                    <td
                      className="px-4 py-3 cursor-pointer hover:bg-surface-container-low/40 transition-colors"
                      onClick={() => navigate(`/purchase-orders/${po.po_id}`)}
                    >
                      <p className="font-data-mono text-[13px] font-bold text-primary hover:underline">{po.po_id}</p>
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

                    {/* Status */}
                    <td className="px-4 py-3 w-[120px]">
                      <span className={`text-[10px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_CHIP[po.status] ?? 'bg-surface-container text-on-surface-variant'}`}>
                        {STATUS_LABEL[po.status] ?? po.status}
                      </span>
                      {isOverdue(po) && (
                        <p className="text-[10px] text-red-500 font-semibold mt-1">Overdue</p>
                      )}
                    </td>

                    {/* Vendor Bill */}
                    <VendorBillCell
                      po={po}
                      canManage={canManage}
                      currentUserName={currentUserName}
                      onUpdate={handlePOUpdate}
                      showSnackbar={showSnackbar}
                    />

                    {/* Bill Doc */}
                    <BillUploadCell
                      po={po}
                      canManage={canManage}
                      onUpdate={handlePOUpdate}
                      showSnackbar={showSnackbar}
                    />

                    {/* At Site */}
                    <SiteReceiptCell
                      po={po}
                      canManage={canManage}
                      currentUserName={currentUserName}
                      currentUserId={currentUserId}
                      onUpdate={handlePOUpdate}
                      showSnackbar={showSnackbar}
                    />

                    {/* Navigate → */}
                    <td className="px-2 py-3 w-[44px]">
                      <button
                        onClick={() => navigate(`/purchase-orders/${po.po_id}`)}
                        className="w-8 h-8 rounded-lg flex items-center justify-center text-on-surface-variant/30 hover:bg-surface-container hover:text-on-surface transition-colors"
                        title="Open detail"
                      >
                        <span className="material-symbols-outlined text-[16px]">chevron_right</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile card list */}
        {filtered.length > 0 && (
          <div className="md:hidden space-y-3">
            {filtered.map((po, idx) => (
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
                  {Number(po.vendor_bill_amount) > 0 ? (
                    <p className="font-data-mono text-[13px] font-bold text-[#16A34A]">
                      ₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}
                      <span className="text-[10px] font-normal text-on-surface-variant/50 ml-1">bill</span>
                    </p>
                  ) : (
                    <p className="text-[11px] text-amber-600 font-medium">No bill entered</p>
                  )}
                </div>
              </div>
            ))}
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
