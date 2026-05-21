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
import { parseAmount } from '../lib/money';
import ReceiveAtSiteDrawer from '../components/ReceiveAtSiteDrawer';

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

// ── VendorBillDocCell ─────────────────────────────────────────────────────────

function VendorBillDocCell({
  po, canManage, currentUserName, onUpdate, showSnackbar, onEditingChange,
}: {
  po: any;
  canManage: boolean;
  currentUserName: string;
  onUpdate: (poId: string, updates: any) => void;
  showSnackbar: (msg: string, opts?: any) => void;
  onEditingChange?: (editing: boolean) => void;
}) {
  const [editing, setEditingInternal] = useState(false);
  const setEditing = (val: boolean) => {
    setEditingInternal(val);
    onEditingChange?.(val);
  };
  const [amount, setAmount] = useState('');
  const [billNo, setBillNo] = useState('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [uploadingDirect, setUploadingDirect] = useState(false);

  const hasBill = Number(po.vendor_bill_amount) > 0;
  const billUrl = po.vendor_bill_url || po.vendor_bill_doc_url;

  const handleUploadFile = async (file: File): Promise<string | null> => {
    const ext = file.type === 'application/pdf' ? 'pdf' : 'jpg';
    const path = `po-bills/${po.po_id}-${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from('documents').upload(path, file, { contentType: file.type });
    if (upErr) throw upErr;
    const { data: pub } = supabase.storage.from('documents').getPublicUrl(path);
    return pub.publicUrl;
  };

  const handleSave = async () => {
    const parsed = parseAmount(amount);
    if (!parsed || parsed <= 0) return;
    setSaving(true);
    try {
      let uploadedUrl = billUrl;
      if (selectedFile) {
        uploadedUrl = await handleUploadFile(selectedFile);
      }
      
      const updates: any = {
        vendor_bill_amount: parsed,
        vendor_bill_number: billNo.trim() || null,
        vendor_bill_no: billNo.trim() || null,
        bill_recorded_at: new Date().toISOString(),
        bill_recorded_by_name: currentUserName,
      };

      if (uploadedUrl) {
        updates.vendor_bill_url = uploadedUrl;
        updates.vendor_bill_doc_url = uploadedUrl;
      }

      const { error } = await supabase
        .from('purchase_orders')
        .update(updates)
        .eq('po_id', po.po_id);

      if (error) throw error;

      setEditing(false);
      setSelectedFile(null);
      onUpdate(po.po_id, updates);
      
      confetti({ particleCount: 60, spread: 50, origin: { y: 0.6 }, colors: ['#16A34A', '#F59E0B', '#ffffff'] });
      
      if (uploadedUrl) {
        showSnackbar(`🎉 Bill & document recorded! ₹${parsed.toLocaleString('en-IN')}`);
      } else {
        showSnackbar(`🎉 Bill amount recorded! ₹${parsed.toLocaleString('en-IN')} (Please upload invoice copy soon)`);
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to save bill', { type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleDirectUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingDirect(true);
    try {
      const uploadedUrl = await handleUploadFile(file);
      if (uploadedUrl) {
        const { error } = await supabase
          .from('purchase_orders')
          .update({
            vendor_bill_url: uploadedUrl,
            vendor_bill_doc_url: uploadedUrl,
          })
          .eq('po_id', po.po_id);

        if (error) throw error;

        onUpdate(po.po_id, {
          vendor_bill_url: uploadedUrl,
          vendor_bill_doc_url: uploadedUrl,
        });
        showSnackbar('📎 Invoice document attached successfully!');
        confetti({ particleCount: 40, spread: 40, colors: ['#10B981', '#34D399'] });
      }
    } catch (err: any) {
      showSnackbar(err.message || 'Upload failed', { type: 'error' });
    } finally {
      setUploadingDirect(false);
    }
  };

  // Read-only state (for non-managers)
  if (!canManage) {
    return (
      <td className="border-l border-outline-variant/15 bg-[#FAF9F5]/45 group-hover:bg-[#FAF9F5]/80 transition-colors px-4 py-4 w-[240px]">
        {hasBill ? (
          <div className="flex flex-col gap-1">
            <p className="text-[13px] font-semibold font-mono text-green-700 tabular-nums">
              ₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}
            </p>
            {billUrl ? (
              <a
                href={billUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-600 hover:text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full w-fit"
              >
                <span className="material-symbols-outlined text-[12px]">description</span>
                View Invoice
              </a>
            ) : (
              <span className="text-[10px] text-amber-600/70 font-medium">⚠️ No copy uploaded</span>
            )}
          </div>
        ) : (
          <span className="text-on-surface-variant/20 text-[12px]">—</span>
        )}
      </td>
    );
  }

  // Ref and click-outside effect for the edit popover
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setEditing(false);
        setAmount('');
        setBillNo('');
        setSelectedFile(null);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [editing]);

  return (
    <td 
      className={`border-l border-outline-variant/15 bg-[#FAF9F5]/45 group-hover:bg-[#FAF9F5]/80 transition-colors px-4 py-4 w-[240px] relative ${editing ? 'z-[100]' : ''}`} 
      onClick={e => e.stopPropagation()}
    >
      {/* Display State */}
      {!hasBill ? (
        <button
          onClick={() => { setAmount(''); setBillNo(po.vendor_bill_number || po.vendor_bill_no || ''); setEditing(true); }}
          className="w-full max-w-[200px] flex items-center justify-center gap-1.5 py-2 px-3 rounded-xl border border-dashed border-[#D5D0C5] hover:border-[#C8603A]/50 bg-white hover:bg-[#FCFBF9] text-[#8F7E68] hover:text-[#70624E] transition-all text-[12px] font-semibold shadow-[0_1px_2px_rgba(0,0,0,0.02)]"
        >
          <span className="material-symbols-outlined text-[14px]">add_circle</span>
          Record Bill
        </button>
      ) : (
        <div className="flex flex-col gap-1.5 max-w-[200px]">
          {/* Bill Amount */}
          <div className="flex items-center justify-between group/amount">
            <button
              onClick={() => { setAmount(String(po.vendor_bill_amount)); setBillNo(po.vendor_bill_number || po.vendor_bill_no || ''); setEditing(true); }}
              className="text-left"
            >
              <p className="text-[13px] font-bold font-mono text-green-700 tabular-nums hover:underline decoration-green-600/30 underline-offset-2 flex items-center gap-1">
                ₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}
                <span className="material-symbols-outlined text-[11px] text-on-surface-variant/20 group-hover/amount:text-[#C8603A] opacity-0 group-hover/amount:opacity-100 transition-all">edit</span>
              </p>
            </button>
          </div>

          {/* Invoice details */}
          {(po.vendor_bill_number || po.vendor_bill_no || po.bill_recorded_at) && (
            <p className="text-[10px] text-on-surface-variant/50 leading-none">
              {[po.vendor_bill_number || po.vendor_bill_no, po.bill_recorded_at && fmtShortDate(po.bill_recorded_at)].filter(Boolean).join(' · ')}
            </p>
          )}

          {/* Invoice Document Indicator & Actions */}
          {billUrl ? (
            <a
              href={billUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 hover:text-emerald-800 bg-emerald-50 hover:bg-emerald-100/70 border border-emerald-100/60 px-2.5 py-1 rounded-lg transition-colors w-fit shadow-[0_1px_2px_rgba(16,185,129,0.04)]"
            >
              <span className="material-symbols-outlined text-[13px]">description</span>
              View Invoice
            </a>
          ) : (
            /* Missing Document - Luxury Minimalist Champagne Trigger */
            <div className="relative">
              {uploadingDirect ? (
                <div className="flex items-center gap-1.5 py-1.5 px-3 bg-[#FAF8F5]/50 border border-[#EBE7DF] rounded-xl text-on-surface-variant/40 text-[10px] font-semibold w-fit">
                  <span className="material-symbols-outlined text-[13px] animate-spin text-on-surface-variant/35">progress_activity</span>
                  Uploading…
                </div>
              ) : (
                <div className="flex flex-col gap-1 w-fit">
                  <label className="group/btn relative inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-[#E9E4DB] hover:border-[#D0C9BA] bg-[#FCFBF9] hover:bg-[#FAF9F6] text-[11.5px] font-semibold text-[#8F7E68] hover:text-[#70624E] cursor-pointer transition-all duration-200 shadow-[0_1px_2px_rgba(143,126,104,0.03)] hover:shadow-[0_2px_6px_rgba(143,126,104,0.06)] active:scale-[0.98]">
                    <span className="w-1.5 h-1.5 rounded-full bg-[#C2A884]" />
                    <span>Attach invoice copy</span>
                    <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={handleDirectUpload} />
                  </label>
                  <span className="text-[9.5px] font-medium text-on-surface-variant/35 px-1 tracking-wide">
                    Required for payout
                  </span>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Elegant Absolute Popover Edit Panel */}
      {editing && (
        <div 
          ref={popoverRef}
          className="absolute right-2 top-2 z-50 w-[265px] rounded-2xl p-4 bg-white border border-[#E5E0D5] shadow-[0_12px_36px_rgba(143,126,104,0.22)] space-y-3.5 text-left popover-animate animate-fade-in"
        >
          <div className="flex items-center justify-between pb-2 border-b border-black/[0.05]">
            <div className="flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-[#C8603A]" />
              <p className="text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-wider">Record Vendor Bill</p>
            </div>
            <button 
              onClick={() => { setEditing(false); setAmount(''); setBillNo(''); setSelectedFile(null); }}
              className="text-on-surface-variant/40 hover:text-on-surface transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">close</span>
            </button>
          </div>

          {/* Amount Input */}
          <div>
            <label className="text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-[0.08em] block mb-1">Bill Amount *</label>
            <div className="relative">
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[13px] font-bold text-[#8F7E68]">₹</span>
              <input
                type="number"
                placeholder="0.00"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full h-9 text-[15px] font-semibold pl-7 pr-3 border border-[#EBE7DF] rounded-xl focus:outline-none focus:border-[#C8603A] focus:ring-1 focus:ring-[#C8603A]/10 bg-[#FCFBF9] transition-all font-mono text-on-surface"
                autoFocus
              />
            </div>
          </div>

          {/* Invoice Number Input */}
          <div>
            <label className="text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-[0.08em] block mb-1">Invoice / Bill Number</label>
            <input
              type="text"
              placeholder="e.g. INV-2026-001"
              value={billNo}
              onChange={e => setBillNo(e.target.value)}
              className="w-full h-8 px-3 text-[12px] border border-[#EBE7DF] rounded-lg focus:outline-none focus:border-[#C8603A] focus:ring-1 focus:ring-[#C8603A]/10 bg-[#FCFBF9] text-on-surface transition-all"
            />
          </div>

          {/* Document Upload Area */}
          <div>
            <label className="text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-[0.08em] block mb-1">Bill Copy Document</label>
            {selectedFile ? (
              <div className="flex items-center gap-2 px-2.5 py-2 bg-emerald-50/40 border border-emerald-100/60 rounded-xl">
                <span className="material-symbols-outlined text-[16px] text-emerald-600 shrink-0">description</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-emerald-800 truncate">{selectedFile.name}</p>
                  <p className="text-[9px] text-emerald-600/60 font-mono mt-0.5">{(selectedFile.size / 1024).toFixed(0)} KB</p>
                </div>
                <button onClick={() => setSelectedFile(null)} className="text-emerald-700/40 hover:text-red-500 transition-colors shrink-0">
                  <span className="material-symbols-outlined text-[14px]">close</span>
                </button>
              </div>
            ) : billUrl ? (
              <div className="flex items-center gap-2 px-2.5 py-2 bg-[#F8F7F4] border border-[#EBE7DF] rounded-xl">
                <span className="material-symbols-outlined text-[16px] text-[#A69E90] shrink-0">description</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[11px] font-semibold text-on-surface truncate">Existing Bill Attached</p>
                </div>
                <label className="text-[9px] font-bold text-[#C8603A] hover:underline cursor-pointer shrink-0">
                  Change
                  <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); }} />
                </label>
              </div>
            ) : (
              <label className="group flex flex-col items-center justify-center border border-dashed border-[#D5D0C5] hover:border-[#C8603A]/50 bg-[#FCFBF9] hover:bg-[#FAF9F6] rounded-xl py-3 text-center cursor-pointer transition-all duration-200">
                <span className="material-symbols-outlined text-[18px] text-[#A69E90] group-hover:text-[#C8603A] transition-colors mb-0.5">cloud_upload</span>
                <p className="text-[10px] font-bold text-[#8F7E68] group-hover:text-[#70624E]">Upload Invoice Copy</p>
                <p className="text-[8px] text-[#A69E90]/80 mt-0.5">PDF or Image up to 10MB</p>
                <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="hidden" onChange={e => { if (e.target.files?.[0]) setSelectedFile(e.target.files[0]); }} />
              </label>
            )}
          </div>

          {/* Action Buttons */}
          <div className="flex gap-2 pt-1">
            <button
              onClick={handleSave}
              disabled={!amount || parseFloat(amount) <= 0 || saving}
              className={`flex-1 h-8 rounded-xl text-[11.5px] font-bold transition-all ${
                amount && parseFloat(amount) > 0 && !saving
                  ? 'bg-[#C8603A] text-white hover:bg-[#B35230] shadow-[0_2px_4px_rgba(200,96,58,0.15)] active:scale-[0.98]'
                  : 'bg-[#FAF9F6] text-[#A69E90]/40 border border-[#EBE7DF] cursor-not-allowed'
              }`}
            >
              {saving ? 'Saving…' : 'Record Bill'}
            </button>
            <button
              onClick={() => { setEditing(false); setAmount(''); setBillNo(''); setSelectedFile(null); }}
              className="flex-1 h-8 rounded-xl border border-[#EBE7DF] hover:bg-[#FAF9F6] text-[#8F7E68] text-[11.5px] font-bold transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
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
  const [activeMetricFilter, setActiveMetricFilter] = useState<'overdue_delivery' | 'bill_copy_missing' | 'received_no_bill' | null>(null);

  const dateRef    = useRef<HTMLDivElement>(null);
  const statusRef  = useRef<HTMLDivElement>(null);
  const vendorRef  = useRef<HTMLDivElement>(null);
  const projectRef = useRef<HTMLDivElement>(null);

  const [poOverrides, setPoOverrides] = useState<Record<string, any>>({});
  const [drawerPO,    setDrawerPO]    = useState<any | null>(null);
  const [activeEditingPOId, setActiveEditingPOId] = useState<string | null>(null);

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

  const pos = (rawPos ?? []).map(p =>
    poOverrides[p.po_id] ? { ...p, ...poOverrides[p.po_id] } : p
  );

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

  const vendors  = [...new Set(pos.map(p => p.stakeholders?.name).filter(Boolean))].sort() as string[];
  const projects = [...new Set(pos.map(p => p.projects?.name).filter(Boolean))].sort() as string[];

  const totalCount      = pos.length;
  const totalOrderValue = pos.reduce((sum, p) => sum + (Number(p.total_value) || Number(p.order_value) || 0), 0);

  const overdueDeliveryPos  = pos.filter(p => isOverdue(p) && !(receiptSummaries?.[p.po_id]?.receipt_pct >= 100));
  const billCopyMissingPos   = pos.filter(p => Number(p.vendor_bill_amount) > 0 && !p.vendor_bill_url && !p.vendor_bill_doc_url);
  const receivedNoBillPos    = pos.filter(p => p.status !== 'CANCELLED' && !Number(p.vendor_bill_amount) && (receiptSummaries?.[p.po_id]?.receipt_pct > 0));

  const { from: dateFrom, to: dateTo } = dateRange(datePreset);

  const filtered = pos.filter(po => {
    // Metric Card Filters
    if (activeMetricFilter === 'overdue_delivery') {
      if (!(isOverdue(po) && !(receiptSummaries?.[po.po_id]?.receipt_pct >= 100))) return false;
    } else if (activeMetricFilter === 'bill_copy_missing') {
      if (!(Number(po.vendor_bill_amount) > 0 && !po.vendor_bill_url && !po.vendor_bill_doc_url)) return false;
    } else if (activeMetricFilter === 'received_no_bill') {
      if (!(po.status !== 'CANCELLED' && !Number(po.vendor_bill_amount) && (receiptSummaries?.[po.po_id]?.receipt_pct > 0))) return false;
    }

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

  const hasFilters = datePreset !== 'all' || filterStatus.length || filterVendor.length || filterProject.length || !!searchTerm || !!activeMetricFilter;

  function clearFilters() {
    setDatePreset('all'); setFilterStatus([]); setFilterVendor([]); setFilterProject([]); setSearchTerm(''); setSearchOpen(false);
    setActiveMetricFilter(null);
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

        {/* Sleek, Elegant Segmented Tab Bar */}
        <div className="bg-white border border-outline-variant/10 rounded-2xl p-1.5 mb-6 shadow-[0_1px_3px_rgba(0,0,0,0.01)] flex flex-col lg:flex-row gap-1">

          {/* Tab 2: Overdue Delivery */}
          <button
            onClick={() => setActiveMetricFilter(c => c === 'overdue_delivery' ? null : 'overdue_delivery')}
            className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl transition-all duration-300 ${
              activeMetricFilter === 'overdue_delivery'
                ? 'bg-[#FFF5F5] border border-red-100 shadow-[0_2px_8px_rgba(239,68,68,0.04)]'
                : 'border border-transparent hover:bg-red-50/30'
            }`}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500"></span>
            </span>
            <span className={`text-[12px] font-medium tracking-tight ${activeMetricFilter === 'overdue_delivery' ? 'text-red-700 font-bold' : 'text-on-surface-variant/70'}`}>
              Overdue Delivery
            </span>
            <span className={`font-mono text-[12px] px-2 py-0.5 rounded-full min-w-[22px] text-center transition-all ${
              activeMetricFilter === 'overdue_delivery'
                ? 'bg-red-600 text-white font-extrabold'
                : 'bg-red-50 text-red-600 border border-red-100/50 font-bold'
            }`}>
              {overdueDeliveryPos.length}
            </span>
          </button>

          {/* Tab 3: Bill Copy Missing */}
          <button
            onClick={() => setActiveMetricFilter(c => c === 'bill_copy_missing' ? null : 'bill_copy_missing')}
            className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl transition-all duration-300 ${
              activeMetricFilter === 'bill_copy_missing'
                ? 'bg-[#FCFAF7] border border-[#E9E4DB] shadow-[0_2px_8px_rgba(194,168,132,0.04)]'
                : 'border border-transparent hover:bg-[#FCFAF7]/55'
            }`}
          >
            <span className="w-1.5 h-1.5 rounded-full bg-[#BCA374]" />
            <span className={`text-[12px] font-medium tracking-tight ${activeMetricFilter === 'bill_copy_missing' ? 'text-[#8F7E68] font-bold' : 'text-on-surface-variant/70'}`}>
              Bill Copy Missing
            </span>
            <span className={`font-mono text-[12px] px-2 py-0.5 rounded-full min-w-[22px] text-center transition-all ${
              activeMetricFilter === 'bill_copy_missing'
                ? 'bg-[#8F7E68] text-white font-extrabold'
                : 'bg-[#FCFAF7] text-[#8F7E68] border border-[#E9E4DB] font-bold'
            }`}>
              {billCopyMissingPos.length}
            </span>
          </button>

          {/* Tab 4: Received but no Bill */}
          <button
            onClick={() => setActiveMetricFilter(c => c === 'received_no_bill' ? null : 'received_no_bill')}
            className={`flex-1 flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl transition-all duration-300 ${
              activeMetricFilter === 'received_no_bill'
                ? 'bg-[#FCF7F2] border border-[#F3E2D6] shadow-[0_2px_8px_rgba(194,94,45,0.04)]'
                : 'border border-transparent hover:bg-[#FCF7F2]/50'
            }`}
          >
            <span className="relative flex h-1.5 w-1.5">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#C25E2D]/40 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-1.5 w-1.5 bg-[#C25E2D]"></span>
            </span>
            <span className={`text-[12px] font-medium tracking-tight ${activeMetricFilter === 'received_no_bill' ? 'text-[#C25E2D] font-bold' : 'text-on-surface-variant/70'}`}>
              Received but no Bill
            </span>
            <span className={`font-mono text-[12px] px-2 py-0.5 rounded-full min-w-[22px] text-center transition-all ${
              activeMetricFilter === 'received_no_bill'
                ? 'bg-[#C25E2D] text-white font-extrabold'
                : 'bg-[#FCF7F2] text-[#C25E2D] border border-[#F3E2D6] font-bold'
            }`}>
              {receivedNoBillPos.length}
            </span>
          </button>
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
          <div className="hidden md:block bg-white rounded-2xl border border-black/[0.05] shadow-sm overflow-visible">
            <table className="w-full">
              <thead>
                <tr className="border-b border-outline-variant/[0.07]">
                  <th className="px-5 py-3 text-left"><span className="text-[11px] font-medium text-on-surface-variant/35">PO · Date</span></th>
                  <th className="px-4 py-3 text-left"><span className="text-[11px] font-medium text-on-surface-variant/35">Vendor</span></th>
                  <th className="px-4 py-3 text-left"><span className="text-[11px] font-medium text-on-surface-variant/35">Project</span></th>
                  <th className="px-4 py-3 text-left w-[100px]"><span className="text-[11px] font-medium text-on-surface-variant/35">Status</span></th>
                  
                  {/* Fulfillment Sequence Pipeline Group */}
                  <th className="px-4 py-3 text-left w-[240px] border-l border-outline-variant/20 bg-[#FAF9F5] relative rounded-tl-xl">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-bold">01</span>
                        <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/70">Bill Upload</span>
                      </div>
                      <span className="material-symbols-outlined text-[13px] text-on-surface-variant/20 mr-2">arrow_forward</span>
                    </div>
                  </th>
                  <th className="px-4 py-3 text-left w-[160px] bg-[#FAF9F5] rounded-tr-xl">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-outline-variant/40 text-on-surface-variant/70 font-bold">02</span>
                      <span className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/70">Site Receipt</span>
                    </div>
                  </th>
                  
                  <th className="px-3 py-3 w-[36px]" />
                </tr>
              </thead>
              <tbody>
                {filtered.map((po, idx) => (
                  <tr
                    key={po.po_id}
                    onClick={() => navigate(`/purchase-orders/${po.po_id}`)}
                    className={`group border-b border-outline-variant/[0.05] last:border-0 wo-row-animate hover:bg-surface-container-low/30 transition-all cursor-pointer ${STATUS_BORDER[po.status] ?? 'border-l-[3px] border-l-transparent'} ${activeEditingPOId === po.po_id ? 'relative z-[150] bg-white shadow-sm' : ''}`}
                    style={{ animationDelay: `${Math.min(idx, 20) * 15}ms` }}
                  >
                    <td className="px-5 py-4">
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

                    <VendorBillDocCell po={po} canManage={canManage} currentUserName={currentUserName} onUpdate={handlePOUpdate} showSnackbar={showSnackbar} onEditingChange={(editing) => setActiveEditingPOId(editing ? po.po_id : null)} />

                    {/* Receipt column */}
                    {(() => {
                      const rs = receiptSummaries?.[po.po_id];
                      const pct = Number(rs?.receipt_pct ?? 0);
                      const done = pct >= 100;
                      const hasBill = Number(po.vendor_bill_amount) > 0;
                      return (
                        <td className="bg-[#FAF9F5]/45 group-hover:bg-[#FAF9F5]/80 transition-colors px-4 py-4 w-[160px]" onClick={e => e.stopPropagation()}>
                          {done ? (
                            <div className="flex flex-col gap-1">
                              <span className="inline-flex items-center justify-center gap-1 text-[11px] font-bold text-emerald-700 bg-emerald-50 border border-emerald-100/60 px-2.5 py-1 rounded-lg w-full text-center shadow-[0_1px_2px_rgba(16,185,129,0.04)]">
                                <span className="material-symbols-outlined text-[13px]">check_circle</span>
                                Fully Received
                              </span>
                              <span className="text-[9px] text-on-surface-variant/40 text-center mt-0.5">Fulfillment Complete</span>
                            </div>
                          ) : canManage ? (
                            <div className="flex flex-col gap-2">
                              {/* Progress bar */}
                              {pct > 0 && (
                                <div>
                                  <div className="flex items-center justify-between mb-0.5">
                                    <span className="text-[10px] text-[#8F7E68] font-bold">{pct}% Received</span>
                                  </div>
                                  <div className="h-[4px] rounded-full bg-[#E9E4DB]/55 overflow-hidden">
                                    <div className="h-full rounded-full bg-[#C2A884] transition-all" style={{ width: `${pct}%` }} />
                                  </div>
                                </div>
                              )}
                              
                              {/* Sequence Status indicator and action button */}
                              {!hasBill ? (
                                <>
                                  <div className="flex items-center justify-center gap-1.5 text-[10px] text-on-surface-variant/45 font-semibold bg-[#F5F3ED] border border-[#E4DFD5] py-1 rounded-lg shadow-[0_1px_2px_rgba(0,0,0,0.01)]">
                                    <span className="material-symbols-outlined text-[12px] text-on-surface-variant/35">lock</span>
                                    <span>Awaiting Step 1</span>
                                  </div>
                                  <button
                                    onClick={() => setDrawerPO({
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
                                    })}
                                    className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg border border-[#E9E4DB] hover:border-primary/30 bg-[#FCFBF9] hover:bg-primary/[0.02] text-[#8F7E68] hover:text-primary text-[11px] font-semibold transition-all shadow-[0_1px_2px_rgba(0,0,0,0.01)]"
                                  >
                                    <span className="material-symbols-outlined text-[12px]">local_shipping</span>
                                    Receive anyway
                                  </button>
                                </>
                              ) : (
                                <>
                                  <div className="flex items-center justify-center gap-1 text-[10px] text-emerald-700 font-bold bg-emerald-50 border border-emerald-100 py-1 rounded-lg shadow-[0_1px_2px_rgba(16,185,129,0.03)]">
                                    <span className="material-symbols-outlined text-[12px] text-emerald-600">check_circle</span>
                                    <span>Ready for Step 2</span>
                                  </div>
                                  <button
                                    onClick={() => setDrawerPO({
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
                                    })}
                                    className="w-full flex items-center justify-center gap-1 py-1.5 rounded-lg bg-primary hover:bg-primary/95 text-white text-[11px] font-bold shadow-sm hover:shadow active:scale-[0.98] transition-all"
                                  >
                                    <span className="material-symbols-outlined text-[12px]">local_shipping</span>
                                    Receive Items
                                  </button>
                                </>
                              )}
                            </div>
                          ) : (
                            <span className="text-on-surface-variant/20 text-[12px]">—</span>
                          )}
                        </td>
                      );
                    })()}

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

                {/* Receipt progress bar + action (mobile) */}
                {(() => {
                  const rs  = receiptSummaries?.[po.po_id];
                  const pct = Number(rs?.receipt_pct ?? 0);
                  if (!canManage && pct === 0) return null;
                  return (
                    <div className="px-4 pb-3 pt-1" onClick={e => e.stopPropagation()}>
                      {pct >= 100 ? (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-green-700 bg-green-50 px-2 py-0.5 rounded-md">
                          <span className="material-symbols-outlined text-[12px]">done_all</span>
                          Fully received
                        </span>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex-1">
                            {pct > 0 && (
                              <div className="flex items-center gap-2 mb-1">
                                <div className="flex-1 h-[3px] rounded-full bg-outline-variant/15 overflow-hidden">
                                  <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
                                </div>
                                <span className="text-[10px] text-amber-600">{pct}%</span>
                              </div>
                            )}
                          </div>
                          {canManage && (
                            <button
                              onClick={() => setDrawerPO({
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
                              })}
                              className="flex items-center gap-1 text-[11px] font-medium text-primary border border-primary/20 rounded-lg px-2.5 py-1.5 hover:bg-primary/[0.04] transition-colors shrink-0"
                            >
                              <span className="material-symbols-outlined text-[13px]">local_shipping</span>
                              Receive at site
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })()}
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
