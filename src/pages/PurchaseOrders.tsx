import { useState, useRef, useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { supabase } from '../lib/supabase';
import { ShortcutTicker } from '../components/ShortcutTicker';
import { PageSkeleton } from '../components/SkeletonLoader';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useSnackbar } from '../components/Snackbar';

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_CHIP: Record<string, string> = {
  'ORDERED':   'bg-blue-50 text-blue-600',
  'BILLED':    'bg-amber-50 text-amber-700',
  'PARTIAL':   'bg-orange-50 text-orange-600',
  'PAID':      'bg-green-50 text-green-700',
  'CANCELLED': 'bg-gray-100 text-gray-400',
};

const STATUS_BORDER: Record<string, string> = {
  'ORDERED':   'border-l-[3px] border-l-blue-400',
  'BILLED':    'border-l-[3px] border-l-amber-400',
  'PARTIAL':   'border-l-[3px] border-l-orange-400',
  'PAID':      'border-l-[3px] border-l-green-400',
  'CANCELLED': 'border-l-[3px] border-l-gray-200',
};

const STATUS_LABEL: Record<string, string> = {
  'ORDERED':   'Ordered',
  'BILLED':    'Billed',
  'PARTIAL':   'Partial',
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

// ── FilterChip ────────────────────────────────────────────────────────────────

function FilterChip({
  label, active, onClick,
}: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`bk-chip inline-flex items-center gap-1 px-3 h-7 rounded-full text-[12px] font-medium transition-colors whitespace-nowrap ${
        active
          ? 'bg-primary/[0.08] text-primary'
          : 'text-on-surface-variant/60 hover:bg-black/[0.04]'
      }`}
    >
      {label}
      <span className="material-symbols-outlined text-[13px]">
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
  const [editing, setEditing] = useState(false);
  const [amount, setAmount]   = useState('');
  const [billNo, setBillNo]   = useState('');
  const [saving, setSaving]   = useState(false);

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

  // Read-only
  if (!canManage) {
    return (
      <td className="px-4 py-4">
        {hasBill
          ? <p className="text-[13px] font-semibold font-mono text-green-700 tabular-nums">₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}</p>
          : <span className="text-on-surface-variant/20 text-[12px]">—</span>
        }
      </td>
    );
  }

  // Inline edit form
  if (editing) {
    return (
      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
        <div className="rounded-xl p-3 bg-white border-2 border-amber-300 shadow-[0_4px_20px_rgba(245,158,11,0.12)] relative z-10 w-[180px]">
          <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-2">Bill Amount</p>
          <div className="relative mb-2">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[14px] font-bold text-amber-400">₹</span>
            <input
              type="number" placeholder="0" value={amount} onChange={e => setAmount(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') handleSave(); if (e.key === 'Escape') { setEditing(false); setAmount(''); } }}
              className="w-full h-9 text-[17px] font-bold pl-7 pr-2 border border-amber-200 rounded-lg bg-amber-50/50 focus:outline-none focus:border-amber-400 focus:bg-white"
              autoFocus
            />
          </div>
          <input
            type="text" placeholder="Invoice no. (optional)" value={billNo} onChange={e => setBillNo(e.target.value)}
            className="w-full h-7 px-2.5 mb-2 text-[11px] border border-outline-variant/20 rounded-lg focus:outline-none focus:border-amber-300 bg-white"
          />
          <div className="flex gap-1.5">
            <button
              onClick={handleSave} disabled={!amount || parseFloat(amount) <= 0 || saving}
              className={`flex-1 h-7 rounded-lg text-[12px] font-semibold transition-colors ${amount && parseFloat(amount) > 0 ? 'bg-amber-500 text-white hover:bg-amber-600' : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}
            >
              {saving ? '…' : 'Save'}
            </button>
            <button onClick={() => { setEditing(false); setAmount(''); }} className="w-7 h-7 rounded-lg border border-outline-variant/15 text-on-surface-variant/40 hover:bg-surface-container flex items-center justify-center">
              <span className="material-symbols-outlined text-[13px]">close</span>
            </button>
          </div>
        </div>
      </td>
    );
  }

  // No bill yet
  if (!hasBill) {
    return (
      <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
        <button
          onClick={() => { setAmount(''); setBillNo(po.vendor_bill_number || po.vendor_bill_no || ''); setEditing(true); }}
          className="flex items-center gap-1 text-[12px] font-medium text-amber-500 hover:text-amber-700 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">add</span>
          Add bill
        </button>
      </td>
    );
  }

  // Bill recorded
  return (
    <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => { setAmount(String(po.vendor_bill_amount)); setBillNo(po.vendor_bill_number || po.vendor_bill_no || ''); setEditing(true); }}
        className="text-left group"
      >
        <p className="text-[13px] font-semibold font-mono text-green-700 tabular-nums group-hover:underline">
          ₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}
        </p>
        <p className="text-[11px] text-on-surface-variant/40 mt-0.5">
          {[po.vendor_bill_number || po.vendor_bill_no, po.bill_recorded_at && fmtShortDate(po.bill_recorded_at)].filter(Boolean).join(' · ') || 'Recorded'}
        </p>
      </button>
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
      <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
        <a href={billUrl} target="_blank" rel="noopener noreferrer"
          className="flex items-center gap-1 text-[12px] font-medium text-green-700 hover:text-green-800 transition-colors"
        >
          <span className="material-symbols-outlined text-[14px]">description</span>
          View
        </a>
      </td>
    );
  }

  if (!canManage) {
    return <td className="px-4 py-4"><span className="text-on-surface-variant/20 text-[12px]">—</span></td>;
  }

  return (
    <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
      <label className={`flex items-center gap-1 text-[12px] font-medium transition-colors ${uploading ? 'text-on-surface-variant/30 cursor-wait' : 'text-on-surface-variant/35 hover:text-primary cursor-pointer'}`}>
        <span className="material-symbols-outlined text-[14px]">{uploading ? 'hourglass_empty' : 'attach_file'}</span>
        {uploading ? 'Uploading…' : 'Attach'}
        <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" disabled={uploading}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            setUploading(true);
            const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
            const path = `po-bills/${po.po_id}-${Date.now()}.${ext}`;
            const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type });
            if (!upErr) {
              const { data: pub } = supabase.storage.from('documents').getPublicUrl(path);
              const url = pub.publicUrl;
              await supabase.from('purchase_orders').update({ vendor_bill_url: url, vendor_bill_doc_url: url }).eq('po_id', po.po_id);
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

  if (isReceived) {
    return (
      <td className="px-4 py-4">
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-purple-400 shrink-0" />
          <p className="text-[12px] font-medium text-purple-700">At Site</p>
        </div>
        <p className="text-[11px] text-on-surface-variant/40 mt-0.5 pl-3">
          {[po.received_by_name?.split(' ')[0], po.received_at_site && fmtShortDate(po.received_at_site)].filter(Boolean).join(' · ')}
        </p>
      </td>
    );
  }

  if (!canManage) {
    return <td className="px-4 py-4"><span className="text-on-surface-variant/20 text-[12px]">—</span></td>;
  }

  if (!hasBill) {
    return <td className="px-4 py-4"><span className="text-on-surface-variant/20 text-[12px]">—</span></td>;
  }

  if (confirming) {
    return (
      <td className="px-3 py-2" onClick={e => e.stopPropagation()}>
        <div className="rounded-xl p-3 bg-white border-2 border-purple-200 shadow-lg relative z-10 w-[160px]">
          <p className="text-[11px] font-medium text-purple-700 mb-2">Confirm site receipt?</p>
          <div className="flex gap-1.5">
            <button
              onClick={async () => {
                setSaving(true);
                const now = new Date().toISOString();
                const { error } = await supabase
                  .from('purchase_orders')
                  .update({ received_at_site: now, received_by_name: currentUserName, received_by_user_id: currentUserId, status: 'BILLED' })
                  .eq('po_id', po.po_id);
                setSaving(false);
                setConfirming(false);
                if (!error) {
                  onUpdate(po.po_id, { received_at_site: now, received_by_name: currentUserName, status: 'BILLED' });
                  showSnackbar('📦 Receipt confirmed — status updated to Billed');
                } else {
                  showSnackbar(error.message || 'Failed to confirm receipt', { type: 'error' });
                }
              }}
              disabled={saving}
              className="flex-1 py-1.5 rounded-lg bg-purple-600 text-white text-[11px] font-semibold hover:bg-purple-700 disabled:opacity-50"
            >
              {saving ? '…' : 'Confirm'}
            </button>
            <button onClick={() => setConfirming(false)} className="px-2 py-1.5 rounded-lg border border-outline-variant/15 text-on-surface-variant/40 hover:bg-surface-container">
              <span className="material-symbols-outlined text-[12px]">close</span>
            </button>
          </div>
        </div>
      </td>
    );
  }

  return (
    <td className="px-4 py-4" onClick={e => e.stopPropagation()}>
      <button
        onClick={() => setConfirming(true)}
        className="flex items-center gap-1 text-[12px] font-medium text-purple-600 hover:text-purple-800 border border-purple-200 rounded-lg px-2.5 py-1 hover:bg-purple-50 transition-colors"
      >
        <span className="material-symbols-outlined text-[13px]">done_all</span>
        Mark received
      </button>
    </td>
  );
}

function CreateHint({ message, children }: { message: string; children: ReactNode }) {
  const [show, setShow] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  return (
    <div
      className="relative inline-block"
      onMouseEnter={() => { timer.current = setTimeout(() => setShow(true), 300); }}
      onMouseLeave={() => { if (timer.current) clearTimeout(timer.current); setShow(false); }}
    >
      {children}
      {show && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none whitespace-nowrap">
          <div style={{ background: 'rgba(11,28,48,0.88)', color: 'white', fontSize: 11, padding: '6px 10px', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 6, boxShadow: '0 4px 12px rgba(0,0,0,0.15)' }}>
            <span style={{ fontFamily: 'monospace', fontSize: 10, border: '1px solid rgba(255,255,255,0.2)', borderRadius: 4, padding: '1px 5px', lineHeight: 1, color: 'rgba(255,255,255,0.6)' }}>/</span>
            <span style={{ color: 'rgba(255,255,255,0.8)' }}>{message}</span>
          </div>
          <div style={{ position: 'absolute', top: '100%', left: '50%', transform: 'translateX(-50%)', width: 0, height: 0, borderLeft: '5px solid transparent', borderRight: '5px solid transparent', borderTop: '5px solid rgba(11,28,48,0.88)' }} />
        </div>
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

  const [datePreset, setDatePreset]       = useState<DatePreset>('all');
  const [filterStatus, setFilterStatus]   = useState<string[]>([]);
  const [filterVendor, setFilterVendor]   = useState<string[]>([]);
  const [filterProject, setFilterProject] = useState<string[]>([]);
  const [searchOpen, setSearchOpen]       = useState(false);
  const [searchTerm, setSearchTerm]       = useState('');
  const [openChip, setOpenChip]           = useState<'date' | 'status' | 'vendor' | 'project' | null>(null);

  const dateRef    = useRef<HTMLDivElement>(null);
  const statusRef  = useRef<HTMLDivElement>(null);
  const vendorRef  = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);

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

  const pos = (rawPos ?? []).map(p =>
    poOverrides[p.po_id] ? { ...p, ...poOverrides[p.po_id] } : p
  );

  const vendors  = [...new Set(pos.map(p => p.stakeholders?.name).filter(Boolean))].sort() as string[];
  const projects = [...new Set(pos.map(p => p.projects?.name).filter(Boolean))].sort() as string[];

  const totalCount      = pos.length;
  const pendingDelivery = pos.filter(p => p.status === 'ORDERED').length;
  const pendingBill     = pos.filter(p => p.status === 'ORDERED' && !Number(p.vendor_bill_amount)).length;
  const totalOrderValue = pos.reduce((sum, p) => sum + (Number(p.total_value) || Number(p.order_value) || 0), 0);

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

  function clearFilters() {
    setDatePreset('all'); setFilterStatus([]); setFilterVendor([]); setFilterProject([]); setSearchTerm(''); setSearchOpen(false);
  }

  useEffect(() => {
    const handler = () => navigate('/purchase-orders/new');
    window.addEventListener('shortcut:new-po', handler);
    return () => window.removeEventListener('shortcut:new-po', handler);
  }, [navigate]);

  function toggleChip(name: typeof openChip) {
    setOpenChip(c => c === name ? null : name);
  }

  function MultiCheckList({ options, selected, onChange }: { options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
    return (
      <div className="py-1 max-h-64 overflow-y-auto">
        <button onClick={() => onChange([])} className="w-full text-left px-4 py-2 text-[12px] text-on-surface-variant/60 hover:bg-surface-container-low">
          All
        </button>
        {options.map(o => (
          <label key={o} className="flex items-center gap-2.5 px-4 py-2 text-[13px] hover:bg-surface-container-low cursor-pointer">
            <input type="checkbox" checked={selected.includes(o)}
              onChange={() => { if (selected.includes(o)) onChange(selected.filter(s => s !== o)); else onChange([...selected, o]); }}
              className="accent-primary w-3.5 h-3.5"
            />
            <span>{o}</span>
          </label>
        ))}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface-container-low/30">
      <div className="max-w-[1400px] mx-auto px-4 md:px-6 py-8">

        {/* Header */}
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-[22px] font-bold text-on-surface tracking-tight">Purchase Orders</h2>
            <p className="text-[12px] text-on-surface-variant/45 mt-1 leading-relaxed">
              {totalCount} orders
              {totalOrderValue > 0 && (
                <> · <span className="font-mono">₹{totalOrderValue >= 100000 ? `${(totalOrderValue / 100000).toFixed(1)}L` : totalOrderValue.toLocaleString('en-IN')}</span></>
              )}
              {pendingDelivery > 0 && (
                <> · <span className="text-amber-600">{pendingDelivery} pending delivery</span></>
              )}
              {pendingBill > 0 && (
                <> · <span className="text-orange-500">{pendingBill} need bill</span></>
              )}
            </p>
          </div>
          {canManage && (
            <div className="hidden md:flex flex-col items-end gap-1">
              <CreateHint message="press / to create a new purchase order">
              <button
                onClick={() => navigate('/purchase-orders/new')}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  height: 32, padding: '0 16px 0 12px',
                  borderRadius: 99, border: 'none',
                  background: '#C8603A', cursor: 'pointer', outline: 'none',
                  fontSize: 13, fontWeight: 500, color: '#fff',
                  letterSpacing: '-0.01em',
                  boxShadow: '0 1px 2px rgba(200,96,58,0.25)',
                  transition: 'opacity 120ms, box-shadow 120ms',
                }}
                onMouseEnter={e => { e.currentTarget.style.opacity = '0.88'; e.currentTarget.style.boxShadow = '0 3px 8px rgba(200,96,58,0.35)'; }}
                onMouseLeave={e => { e.currentTarget.style.opacity = '1';    e.currentTarget.style.boxShadow = '0 1px 2px rgba(200,96,58,0.25)'; }}
              >
                <span style={{ fontSize: 17, fontWeight: 300, lineHeight: 1 }}>+</span>
                New Purchase Order
              </button>
              </CreateHint>
              <ShortcutTicker hints={[
                { key: '/',       label: 'new purchase order' },
                { key: 'T',       label: 'view transactions' },
                { key: 'P',       label: 'view purchase orders' },
                { key: 'W',       label: 'view work orders' },
                { key: 'L',       label: 'view logbook' },
                { key: '⟵ hold', label: 'long press screen for quick actions' },
              ]} className="w-full" />
            </div>
          )}
        </div>

        {/* Filter bar */}
        <div className="flex items-center gap-0.5 overflow-x-auto no-scrollbar flex-nowrap md:flex-wrap border-b border-outline-variant/[0.08] pb-3 mb-4">
          <div ref={dateRef} className="relative">
            <FilterChip label={datePreset === 'all' ? 'Date' : DATE_LABELS[datePreset]} active={datePreset !== 'all' || openChip === 'date'} onClick={() => toggleChip('date')} />
            <Dropdown anchorRef={dateRef as React.RefObject<HTMLElement>} open={openChip === 'date'} onClose={() => setOpenChip(null)}>
              {(['all','today','week','month','quarter'] as DatePreset[]).map(p => (
                <button key={p} onClick={() => { setDatePreset(p); setOpenChip(null); }}
                  className={`w-full text-left px-4 py-2 text-[13px] hover:bg-surface-container-low ${datePreset === p ? 'font-semibold text-primary' : 'text-on-surface'}`}
                >{DATE_LABELS[p]}</button>
              ))}
            </Dropdown>
          </div>

          <div ref={statusRef} className="relative">
            <FilterChip label={filterStatus.length ? `Status (${filterStatus.length})` : 'Status'} active={filterStatus.length > 0 || openChip === 'status'} onClick={() => toggleChip('status')} />
            <Dropdown anchorRef={statusRef as React.RefObject<HTMLElement>} open={openChip === 'status'} onClose={() => setOpenChip(null)}>
              <MultiCheckList options={ALL_STATUSES} selected={filterStatus} onChange={setFilterStatus} />
            </Dropdown>
          </div>

          <div ref={vendorRef} className="relative">
            <FilterChip label={filterVendor.length ? `Vendor (${filterVendor.length})` : 'Vendor'} active={filterVendor.length > 0 || openChip === 'vendor'} onClick={() => toggleChip('vendor')} />
            <Dropdown anchorRef={vendorRef as React.RefObject<HTMLElement>} open={openChip === 'vendor'} onClose={() => setOpenChip(null)}>
              <MultiCheckList options={vendors} selected={filterVendor} onChange={setFilterVendor} />
            </Dropdown>
          </div>

          <div ref={projectRef} className="relative">
            <FilterChip label={filterProject.length ? `Project (${filterProject.length})` : 'Project'} active={filterProject.length > 0 || openChip === 'project'} onClick={() => toggleChip('project')} />
            <Dropdown anchorRef={projectRef as React.RefObject<HTMLElement>} open={openChip === 'project'} onClose={() => setOpenChip(null)}>
              <MultiCheckList options={projects} selected={filterProject} onChange={setFilterProject} />
            </Dropdown>
          </div>

          <div className="w-px h-4 bg-outline-variant/15 mx-1.5 shrink-0" />

          {searchOpen ? (
            <div className="relative flex items-center">
              <span className="material-symbols-outlined absolute left-2.5 text-[14px] text-on-surface-variant/35 pointer-events-none">search</span>
              <input autoFocus
                className="pl-8 pr-7 h-7 rounded-full text-[12px] border border-outline-variant/25 bg-white outline-none focus:border-primary/40 w-36 transition-all"
                placeholder="Search…" value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button onClick={() => setSearchTerm('')} className="absolute right-2 text-on-surface-variant/30 hover:text-on-surface">
                  <span className="material-symbols-outlined text-[12px]">close</span>
                </button>
              )}
            </div>
          ) : (
            <button onClick={() => setSearchOpen(true)} className="inline-flex items-center justify-center w-7 h-7 rounded-full text-on-surface-variant/40 hover:bg-black/[0.04] transition-colors">
              <span className="material-symbols-outlined text-[15px]">search</span>
            </button>
          )}

          {hasFilters && (
            <button onClick={clearFilters} className="text-[11px] text-on-surface-variant/40 hover:text-primary ml-1 whitespace-nowrap transition-colors">
              Clear
            </button>
          )}
        </div>

        {isLoading && <div className="mb-4"><PageSkeleton /></div>}

        {!isLoading && filtered.length === 0 && (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-[44px] block mb-3 text-on-surface-variant/15">receipt_long</span>
            <p className="text-[14px] font-medium text-on-surface/40">
              {hasFilters ? 'No orders match your filters' : 'No purchase orders yet'}
            </p>
            <p className="text-[12px] mt-1 text-on-surface-variant/30">
              {hasFilters ? 'Try adjusting or clearing the filters' : 'Purchase orders will appear here once created'}
            </p>
            {hasFilters && <button onClick={clearFilters} className="mt-4 bk-btn text-[13px]">Clear filters</button>}
            {canManage && !hasFilters && <button onClick={() => navigate('/purchase-orders/new')} className="mt-4 bk-btn text-[13px]">Create your first PO</button>}
          </div>
        )}

        {/* Result count — only when filtered */}
        {!isLoading && filtered.length > 0 && hasFilters && (
          <p className="text-[11px] text-on-surface-variant/35 mb-3">{filtered.length} of {totalCount}</p>
        )}

        {/* Desktop table */}
        {filtered.length > 0 && (
          <div className="hidden md:block bg-white rounded-2xl border border-black/[0.05] shadow-sm overflow-hidden">
            <table className="w-full">
              <thead>
                <tr className="border-b border-outline-variant/[0.07]">
                  <th className="px-5 py-3 text-left"><span className="text-[11px] font-medium text-on-surface-variant/35">PO · Date</span></th>
                  <th className="px-4 py-3 text-left"><span className="text-[11px] font-medium text-on-surface-variant/35">Vendor</span></th>
                  <th className="px-4 py-3 text-left"><span className="text-[11px] font-medium text-on-surface-variant/35">Project</span></th>
                  <th className="px-4 py-3 text-left w-[100px]"><span className="text-[11px] font-medium text-on-surface-variant/35">Status</span></th>
                  <th className="px-4 py-3 text-left w-[160px]"><span className="text-[11px] font-medium text-on-surface-variant/35">Vendor Bill</span></th>
                  <th className="px-4 py-3 text-left w-[90px]"><span className="text-[11px] font-medium text-on-surface-variant/35">Doc</span></th>
                  <th className="px-4 py-3 text-left w-[150px]"><span className="text-[11px] font-medium text-on-surface-variant/35">At Site</span></th>
                  <th className="px-3 py-3 w-[36px]" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((po, idx) => (
                  <tr
                    key={po.po_id}
                    className={`group border-b border-outline-variant/[0.05] last:border-0 wo-row-animate hover:bg-surface-container-low/25 transition-colors ${STATUS_BORDER[po.status] ?? 'border-l-[3px] border-l-transparent'}`}
                    style={{ animationDelay: `${Math.min(idx, 20) * 15}ms` }}
                  >
                    <td className="px-5 py-4 cursor-pointer" onClick={() => navigate(`/purchase-orders/${po.po_id}`)}>
                      <p className="font-mono text-[13px] font-semibold text-primary group-hover:underline leading-none">{po.po_id}</p>
                      <p className="text-[11px] text-on-surface-variant/35 mt-1">{fmtDate(po.date_issued)}</p>
                    </td>

                    <td className="px-4 py-4">
                      <p className="text-[13px] font-medium text-on-surface">{po.stakeholders?.name ?? '—'}</p>
                      {po.stakeholders?.category && (
                        <p className="text-[11px] text-on-surface-variant/40 mt-0.5">{po.stakeholders.category}</p>
                      )}
                      {getItemsPreview(po) && (
                        <p className="text-[11px] text-on-surface-variant/25 mt-0.5 truncate max-w-[200px]">{getItemsPreview(po)}</p>
                      )}
                    </td>

                    <td className="px-4 py-4">
                      <p className="text-[13px] font-medium text-on-surface">{po.projects?.name ?? '—'}</p>
                      {po.projects?.site_location && (
                        <p className="text-[11px] text-on-surface-variant/40 mt-0.5">{po.projects.site_location}</p>
                      )}
                    </td>

                    <td className="px-4 py-4 w-[100px]">
                      <span className={`text-[11px] font-semibold px-2 py-0.5 rounded-md ${STATUS_CHIP[po.status] ?? 'bg-surface-container text-on-surface-variant'}`}>
                        {STATUS_LABEL[po.status] ?? po.status}
                      </span>
                      {isOverdue(po) && <p className="text-[10px] text-red-400 font-medium mt-1">Overdue</p>}
                    </td>

                    <VendorBillCell po={po} canManage={canManage} currentUserName={currentUserName} onUpdate={handlePOUpdate} showSnackbar={showSnackbar} />
                    <BillUploadCell po={po} canManage={canManage} onUpdate={handlePOUpdate} showSnackbar={showSnackbar} />
                    <SiteReceiptCell po={po} canManage={canManage} currentUserName={currentUserName} currentUserId={currentUserId} onUpdate={handlePOUpdate} showSnackbar={showSnackbar} />

                    <td className="px-2 py-4 w-[36px]">
                      <button
                        onClick={() => navigate(`/purchase-orders/${po.po_id}`)}
                        className="w-7 h-7 rounded-md flex items-center justify-center text-on-surface-variant/10 group-hover:text-on-surface-variant/35 hover:bg-surface-container transition-colors"
                      >
                        <span className="material-symbols-outlined text-[15px]">chevron_right</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Mobile cards */}
        {filtered.length > 0 && (
          <div className="md:hidden space-y-2">
            {filtered.map((po, idx) => (
              <div
                key={po.po_id}
                className={`bg-white rounded-2xl border border-black/[0.05] shadow-sm cursor-pointer active:scale-[0.99] transition-transform wo-row-animate ${STATUS_BORDER[po.status] ?? ''}`}
                style={{ animationDelay: `${Math.min(idx, 20) * 15}ms` }}
                onClick={() => navigate(`/purchase-orders/${po.po_id}`)}
              >
                <div className="px-4 pt-3.5 pb-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <p className="font-mono text-[11px] font-medium text-on-surface-variant/50">{po.po_id}</p>
                        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md ${STATUS_CHIP[po.status] ?? 'bg-surface-container text-on-surface-variant'}`}>
                          {STATUS_LABEL[po.status] ?? po.status}
                        </span>
                        {isOverdue(po) && <span className="text-[10px] font-medium text-red-400">Overdue</span>}
                      </div>
                      <p className="text-[14px] font-semibold text-on-surface leading-snug">{po.stakeholders?.name ?? '—'}</p>
                      {po.stakeholders?.category && (
                        <p className="text-[11px] text-on-surface-variant/40 mt-0.5">{po.stakeholders.category}</p>
                      )}
                      {getItemsPreview(po) && (
                        <p className="text-[11px] text-on-surface-variant/30 mt-1 line-clamp-1">{getItemsPreview(po)}</p>
                      )}
                    </div>
                    <div className="text-right shrink-0 pt-0.5">
                      {Number(po.vendor_bill_amount) > 0 ? (
                        <>
                          <p className="font-mono text-[14px] font-bold text-green-700 tabular-nums">₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}</p>
                          <p className="text-[10px] text-on-surface-variant/35 mt-0.5">billed</p>
                        </>
                      ) : (Number(po.total_value) > 0 || Number(po.order_value) > 0) ? (
                        <>
                          <p className="font-mono text-[14px] font-semibold text-on-surface/60 tabular-nums">₹{(Number(po.total_value) || Number(po.order_value)).toLocaleString('en-IN')}</p>
                          <p className="text-[10px] text-amber-500 mt-0.5">no bill</p>
                        </>
                      ) : null}
                    </div>
                  </div>
                </div>
                <div className="flex items-center justify-between px-4 py-2 border-t border-outline-variant/[0.05]">
                  <p className="text-[11px] text-on-surface-variant/45 truncate flex-1">{po.projects?.name ?? '—'}</p>
                  <p className="text-[11px] text-on-surface-variant/30 ml-3 shrink-0">
                    {po.expected_delivery
                      ? <span className={isOverdue(po) ? 'text-red-400' : ''}>{fmtShortDate(po.expected_delivery)}</span>
                      : fmtShortDate(po.date_issued)
                    }
                  </p>
                </div>
              </div>
            ))}
          </div>
        )}

        {canManage && (
          <button className="bk-fab md:hidden" onClick={() => navigate('/purchase-orders/new')} title="New Purchase Order">
            <span className="material-symbols-outlined text-[24px]">add</span>
          </button>
        )}
      </div>
    </div>
  );
}
