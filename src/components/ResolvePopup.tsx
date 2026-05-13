import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { RoughEntry } from '../types';
import { useSnackbar } from './Snackbar';
import { useUserProfile } from '../App';
import { CostCodePicker } from './CostCodePicker';

// ── Helpers ────────────────────────────────────────────────────────────────────

function genTxnId() {
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

type Confidence = 'HIGH' | 'MEDIUM' | 'LOW' | null;

function ConfBadge({ c, label }: { c: Confidence; label?: string }) {
  if (!c) return <span className="text-[11px] text-red-500 font-semibold">✗ {label || 'Required'}</span>;
  if (c === 'HIGH') return <span className="text-[11px] text-emerald-600">✓</span>;
  if (c === 'MEDIUM') return <span className="text-[11px] text-amber-500 font-semibold">⚠ Verify</span>;
  return <span className="text-[11px] text-red-500 font-semibold">✗ Check</span>;
}

function FieldRow({
  icon, label, children, required, missing,
}: {
  icon: string; label: string; children: React.ReactNode;
  required?: boolean; missing?: boolean;
}) {
  return (
    <div className={`flex items-start gap-3 py-2.5 border-b border-outline-variant/[0.06] last:border-0 min-h-[44px] ${missing ? 'bg-red-50/40' : ''}`}>
      <span className={`material-symbols-outlined text-[18px] mt-0.5 shrink-0 ${missing ? 'text-red-400' : 'text-on-surface-variant/35'}`}>
        {icon}
      </span>
      <div className="w-20 shrink-0 pt-0.5">
        <span className={`text-[11px] font-medium ${missing ? 'text-red-500' : 'text-on-surface-variant/55'}`}>
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ── Inline Create Stakeholder Form ────────────────────────────────────────────

function CreateStakeholderForm({
  defaultName,
  onCreated,
  onCancel,
}: {
  defaultName: string;
  onCreated: (id: string, name: string) => void;
  onCancel: () => void;
}) {
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const [name, setName] = useState(defaultName);
  const [type, setType] = useState<'Worker' | 'Vendor' | 'Client'>('Worker');
  const [category, setCategory] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const newId = `STK-${Math.floor(1000 + Math.random() * 9000)}`;
      const { data, error } = await supabase.from('stakeholders').insert([{
        stakeholder_id: newId,
        name: name.trim(),
        type,
        category: category.trim() || type,
        contact: phone.trim() || null,
      }]).select().single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ['stakeholders'] });
      onCreated(data.stakeholder_id, data.name);
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to create stakeholder', { type: 'error' });
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="mt-2 p-3 bg-primary/[0.04] border border-primary/20 rounded-xl space-y-2">
      <p className="text-[11px] font-semibold text-primary">New Stakeholder</p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Full name"
        autoFocus
        className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-outline-variant/30 bg-white outline-none focus:border-primary transition-colors"
      />
      <div className="flex gap-1.5">
        {(['Worker', 'Vendor', 'Client'] as const).map(t => (
          <button key={t} type="button" onClick={() => setType(t)}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
              type === t ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >{t}</button>
        ))}
      </div>
      <input
        type="text"
        value={category}
        onChange={(e) => setCategory(e.target.value)}
        placeholder="Trade / category (e.g. Mason, Cement Dealer)"
        className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-outline-variant/30 bg-white outline-none focus:border-primary transition-colors"
      />
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone (optional)"
        className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-outline-variant/30 bg-white outline-none focus:border-primary transition-colors"
      />
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 py-1.5 rounded-lg border border-outline-variant/30 text-[12px] text-on-surface-variant hover:bg-surface-container transition-colors">
          Cancel
        </button>
        <button type="button" onClick={create} disabled={!name.trim() || creating}
          className={`flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors ${
            name.trim() && !creating
              ? 'bg-primary text-on-primary hover:opacity-90'
              : 'bg-surface-container text-on-surface-variant/40 cursor-not-allowed'
          }`}>
          {creating ? 'Creating…' : 'Create & Select'}
        </button>
      </div>
    </div>
  );
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  entry: RoughEntry;
  onClose: () => void;
  onUpdated: (entry: RoughEntry) => void;
  session: Session;
}

export function ResolvePopup({ entry, onClose, onUpdated, session }: Props) {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  useUserProfile(session.user.id); // keeps the cache warm for other callers

  const ai = entry.ai_extracted;

  // ── Field state ────────────────────────────────────────────────────────────
  // sender_name is the WhatsApp sender / logged-in user — NOT the payee.
  // Payee init reads only ai_extracted.payee_id / payee_name / payee_raw.
  const [payeeId, setPayeeId] = useState(ai.payee_id || '');
  const [payeeName, setPayeeName] = useState(ai.payee_name || '');
  const [payeeSearch, setPayeeSearch] = useState(ai.payee_name || ai.payee_raw || '');
  const [showPayeeDrop, setShowPayeeDrop] = useState(false);
  const [amount, setAmount] = useState<number | ''>(ai.amount ?? '');
  // description_raw comes from new WhatsApp extraction; description from ai-extract-entry
  const [description, setDescription] = useState(ai.description || ai.description_raw || '');
  const [projectId, setProjectId] = useState(ai.project_id || '');
  const [mode, setMode] = useState<'Cash' | 'NEFT' | 'UPI' | 'Cheque'>(ai.mode || 'Cash');
  const [categoryCode, setCategoryCode] = useState(ai.category_code || '');
  const [date, setDate] = useState(() => {
    if (ai.date) {
      const d = new Date(ai.date);
      if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    }
    return new Date().toISOString().split('T')[0];
  });
  const [notes, setNotes] = useState('');
  const [showDismissConfirm, setShowDismissConfirm] = useState(false);
  const [posting, setPosting] = useState(false);

  // ── Drag-to-dismiss (mobile) ───────────────────────────────────────────────
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const delta = e.clientY - dragStartY.current;
    if (delta > 0) setDragY(delta);
  }, [isDragging]);

  const handleDragEnd = useCallback(() => {
    if (!isDragging) return;
    setIsDragging(false);
    const threshold = (sheetRef.current?.offsetHeight || 400) * 0.4;
    if (dragY > threshold) onClose();
    else setDragY(0);
  }, [isDragging, dragY, onClose]);

  // ── Queries ────────────────────────────────────────────────────────────────
  const { data: stakeholders = [] } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => {
      const { data } = await supabase.from('stakeholders').select('*').order('name');
      return (data ?? []) as any[];
    },
  });

  const { data: projects = [] } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('*').eq('status', 'Active').order('name');
      return (data ?? []) as any[];
    },
  });

  const { data: workOrders = [] } = useQuery({
    queryKey: ['work_orders_active'],
    queryFn: async () => {
      const { data } = await supabase
        .from('work_orders')
        .select('wo_id, project_id, stakeholder_id, scope_of_work, status')
        .not('status', 'in', '("Cancelled","Settled")');
      return (data ?? []) as any[];
    },
    enabled: !!projectId,
  });

  // ── Sync payee selection after stakeholders load ───────────────────────────
  // stakeholders is fetched async; payeeId from ai.payee_id is set at mount.
  // Without this effect, displayPayee falls back to payeeSearch (raw text)
  // until the user interacts. This effect runs once when the list arrives.
  const hasPreselected = useRef(false);
  useEffect(() => {
    if (hasPreselected.current || !stakeholders.length || !ai.payee_id) return;
    const match = stakeholders.find((s) => s.stakeholder_id === ai.payee_id);
    if (match) {
      setPayeeId(match.stakeholder_id);
      setPayeeName(match.name);
      setPayeeSearch(match.name);
      hasPreselected.current = true;
    }
  }, [stakeholders, ai.payee_id]);

  const projectRef = useRef<HTMLSelectElement>(null);
  const isWhatsApp = entry.source.startsWith('WHATSAPP');
  useEffect(() => {
    if (isWhatsApp && !projectId) setTimeout(() => projectRef.current?.focus(), 400);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const filteredPayees = stakeholders.filter(
    (s) => s.name.toLowerCase().includes(payeeSearch.toLowerCase())
  );
  const relatedWOs = workOrders.filter(
    (wo) => wo.project_id === projectId && (!payeeId || wo.stakeholder_id === payeeId)
  );

  const mandatoryFilled = !!payeeId && !!amount && Number(amount) > 0 && !!description.trim() && !!projectId;
  const missingPayee = !payeeId;
  const missingAmount = !amount || Number(amount) <= 0;
  const missingDescription = !description.trim();
  const missingProject = !projectId;
  // Amber state: AI/session extracted a name but couldn't match a stakeholder ID.
  // Covers both ai.payee_unmatched (session-reply path) and the WhatsApp extraction
  // path where payee_name / payee_raw exist but payee_id was never resolved.
  const payeeUnmatched = !payeeId && !!(ai.payee_unmatched || ai.payee_name || ai.payee_raw);
  const projectUnmatched = !projectId && !!ai.project_unmatched;

  // ── Post action ────────────────────────────────────────────────────────────
  const handlePost = async () => {
    if (!mandatoryFilled || posting) return;
    setPosting(true);
    try {
      const newTxnId = genTxnId();
      const payload = {
        txn_id: newTxnId,
        stakeholder_id: payeeId,
        date,
        total_amount: Number(amount),
        payment_mode: mode,
        category: categoryCode || null,
        remarks: [description.trim(), notes.trim()].filter(Boolean).join(' · '),
        bill_doc_url: null,
        ai_flag_status: 'Clean',
        ai_flag_data: {},
      };
      const allocations = [{ project_id: projectId, order_type: null, order_ref: null, milestone_id: null, allocated_amount: Number(amount) }];

      const { error: rpcErr } = await supabase.rpc('insert_transaction_with_allocations', {
        p_txn: payload,
        p_allocations: allocations,
      });
      if (rpcErr) throw rpcErr;

      await supabase.from('transactions').update({ source_re_id: entry.id }).eq('txn_id', newTxnId);

      const { data: updatedEntry } = await supabase
        .from('rough_entries')
        .update({ status: 'POSTED', resolved_txn_id: newTxnId })
        .eq('id', entry.id)
        .select().single();

      qc.invalidateQueries({ queryKey: ['rough_entries'] });
      qc.invalidateQueries({ queryKey: ['inbox_badge'] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] });

      onUpdated(updatedEntry as RoughEntry);
      onClose();
      showSnackbar(`${newTxnId} posted ✓`, {
        action: { label: 'View', onClick: () => navigate(`/ledger/${newTxnId}`) },
      });
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to post', { type: 'error' });
    } finally {
      setPosting(false);
    }
  };

  // ── Dismiss action ─────────────────────────────────────────────────────────
  const handleDismiss = async () => {
    const { data: updatedEntry } = await supabase
      .from('rough_entries')
      .update({ status: 'DISMISSED' })
      .eq('id', entry.id)
      .select().single();
    qc.invalidateQueries({ queryKey: ['rough_entries'] });
    qc.invalidateQueries({ queryKey: ['inbox_badge'] });
    onUpdated(updatedEntry as RoughEntry);
    onClose();
  };

  const fmtTime = (ts: string) => new Date(ts).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });

  const sourceMeta: Record<string, { label: string; color: string }> = {
    WHATSAPP_TEXT:  { label: 'WhatsApp', color: 'bg-emerald-100 text-emerald-700' },
    WHATSAPP_IMAGE: { label: 'WhatsApp Image', color: 'bg-purple-100 text-purple-700' },
    WHATSAPP_VOICE: { label: 'WhatsApp Voice', color: 'bg-orange-100 text-orange-700' },
    UI_TEXT:        { label: 'Manual', color: 'bg-surface-container text-on-surface-variant' },
    UI_IMAGE:       { label: 'Scan', color: 'bg-surface-container text-on-surface-variant' },
  };
  const sm = sourceMeta[entry.source] || sourceMeta.UI_TEXT;

  const sharedProps: ContentProps = {
    entry, sm, fmtTime,
    payeeId, payeeName, payeeSearch,
    setPayeeId, setPayeeName, setPayeeSearch,
    showPayeeDrop, setShowPayeeDrop,
    stakeholders, filteredPayees,
    amount, setAmount,
    description, setDescription,
    projectId, setProjectId, projectRef, projects,
    mode, setMode,
    categoryCode, setCategoryCode,
    relatedWOs,
    date, setDate,
    notes, setNotes,
    isWhatsApp,
    missingPayee, missingAmount, missingDescription, missingProject,
    payeeUnmatched, projectUnmatched,
    mandatoryFilled, posting,
    showDismissConfirm, setShowDismissConfirm,
    onClose, handlePost, handleDismiss,
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <>
      <div
        className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[3px] transition-opacity duration-150"
        onClick={onClose}
      />

      {/* Desktop: centered modal */}
      <div className="hidden md:flex fixed inset-0 z-[61] items-center justify-center p-4 pointer-events-none">
        <div
          className="pointer-events-auto w-full max-w-[480px] max-h-[88vh] flex flex-col bg-white rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.2)] overflow-hidden"
          style={{ animation: 'popupIn 200ms cubic-bezier(0.4,0,0.2,1) both' }}
          onClick={(e) => e.stopPropagation()}
        >
          <PopupContents {...sharedProps} />
        </div>
      </div>

      {/* Mobile: bottom sheet */}
      <div
        ref={sheetRef}
        className="md:hidden fixed bottom-0 left-0 right-0 z-[61] flex flex-col bg-white rounded-t-[20px] shadow-2xl overflow-hidden"
        style={{
          maxHeight: '92vh',
          transform: `translateY(${isDragging ? dragY : 0}px)`,
          transition: isDragging ? 'none' : 'transform 280ms cubic-bezier(0.4,0,0.2,1)',
          animation: isDragging ? 'none' : 'sheetIn 280ms cubic-bezier(0.4,0,0.2,1) both',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="flex justify-center pt-3 pb-1 cursor-grab active:cursor-grabbing shrink-0"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <div className="w-8 h-1 rounded-full bg-black/15" />
        </div>
        <PopupContents {...sharedProps} />
      </div>

      <style>{`
        @keyframes popupIn {
          from { opacity: 0; transform: scale(0.96); }
          to   { opacity: 1; transform: scale(1); }
        }
        @keyframes sheetIn {
          from { transform: translateY(100%); }
          to   { transform: translateY(0); }
        }
      `}</style>
    </>
  );
}

// ── Inner shared content ───────────────────────────────────────────────────────

interface ContentProps {
  entry: RoughEntry;
  sm: { label: string; color: string };
  fmtTime: (ts: string) => string;
  payeeId: string; payeeName: string; payeeSearch: string;
  setPayeeId: (v: string) => void; setPayeeName: (v: string) => void; setPayeeSearch: (v: string) => void;
  showPayeeDrop: boolean; setShowPayeeDrop: (v: boolean) => void;
  stakeholders: any[];
  filteredPayees: any[];
  amount: number | ''; setAmount: (v: number | '') => void;
  description: string; setDescription: (v: string) => void;
  projectId: string; setProjectId: (v: string) => void; projectRef: React.RefObject<HTMLSelectElement | null>;
  projects: any[];
  mode: 'Cash' | 'NEFT' | 'UPI' | 'Cheque'; setMode: (v: 'Cash' | 'NEFT' | 'UPI' | 'Cheque') => void;
  categoryCode: string; setCategoryCode: (v: string) => void;
  relatedWOs: any[];
  date: string; setDate: (v: string) => void;
  notes: string; setNotes: (v: string) => void;
  isWhatsApp: boolean;
  missingPayee: boolean; missingAmount: boolean; missingDescription: boolean; missingProject: boolean;
  payeeUnmatched: boolean; projectUnmatched: boolean;
  mandatoryFilled: boolean; posting: boolean;
  showDismissConfirm: boolean; setShowDismissConfirm: (v: boolean) => void;
  onClose: () => void; handlePost: () => void; handleDismiss: () => void;
}

function PopupContents({
  entry, sm, fmtTime,
  payeeId, payeeSearch, setPayeeId, setPayeeName, setPayeeSearch,
  showPayeeDrop, setShowPayeeDrop, stakeholders, filteredPayees,
  amount, setAmount,
  description, setDescription,
  projectId, setProjectId, projectRef, projects,
  mode, setMode,
  categoryCode, setCategoryCode,
  relatedWOs,
  date, setDate,
  notes, setNotes,
  isWhatsApp,
  missingPayee, missingAmount, missingDescription, missingProject,
  payeeUnmatched, projectUnmatched,
  mandatoryFilled, posting,
  showDismissConfirm, setShowDismissConfirm,
  onClose, handlePost, handleDismiss,
}: ContentProps) {
  const payeeDropRef = useRef<HTMLDivElement>(null);
  const [showCreateStkForm, setShowCreateStkForm] = useState(false);

  const selectPayee = (id: string, name: string) => {
    setPayeeId(id);
    setPayeeName(name);
    setPayeeSearch(name);
    setShowPayeeDrop(false);
  };

  const ai = entry.ai_extracted;
  // Resolve confidence values: prefer flat fields, fall back to nested
  const payeeConf = ai.payee_confidence ?? ai.confidence?.payee ?? null;
  const amountConf = ai.amount_confidence ?? ai.confidence?.amount ?? null;
  const descConf = ai.description_confidence ?? ai.confidence?.description ?? null;
  const projConf = ai.project_confidence ?? ai.confidence?.project ?? null;
  const overallConf = ai.overall_confidence ?? ai.confidence?.overall ?? null;

  // Confidence banner
  const bannerState = (() => {
    if (!ai.processed) return null;
    if (payeeUnmatched || overallConf === 'LOW') return 'error' as const;
    if (projectUnmatched || overallConf === 'MEDIUM') return 'warn' as const;
    return 'ok' as const;
  })();

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (payeeDropRef.current && !payeeDropRef.current.contains(e.target as Node)) {
        setShowPayeeDrop(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const displayPayee = payeeId
    ? filteredPayees.find(s => s.stakeholder_id === payeeId)?.name || payeeSearch
    : payeeSearch;

  return (
    <>
      {/* ── Sticky header ── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-3 border-b border-outline-variant/[0.08]">
        <span className="font-data-mono text-[12px] text-on-surface-variant/50">{entry.re_number}</span>
        <button
          onClick={onClose}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-surface-container transition-colors text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-[20px]">close</span>
        </button>
      </div>

      {/* ── Source strip ── */}
      <div className="shrink-0 px-4 py-3 bg-surface-container-lowest/70 border-b border-outline-variant/[0.06]">
        <div className="flex items-center gap-2 mb-1.5">
          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${sm.color}`}>{sm.label}</span>
          <span className="text-[11px] text-on-surface-variant/50">{entry.sender_name || '—'}</span>
          <span className="text-[11px] text-on-surface-variant/30">·</span>
          <span className="text-[11px] text-on-surface-variant/40">{fmtTime(entry.created_at)}</span>
        </div>
        {entry.raw_image_url ? (
          <div className="flex items-center gap-2.5 mt-2">
            <img src={entry.raw_image_url} className="w-16 h-16 rounded-lg object-cover border border-outline-variant/20" />
            <a href={entry.raw_image_url} target="_blank" rel="noopener noreferrer"
               className="text-[12px] text-primary underline">View full image →</a>
          </div>
        ) : entry.raw_text ? (
          <p className="text-[12px] italic text-on-surface-variant/60 leading-relaxed">
            "{entry.raw_text.length > 120 ? entry.raw_text.slice(0, 120) + '…' : entry.raw_text}"
          </p>
        ) : null}
      </div>

      {/* ── Confidence banner ── */}
      {bannerState && (
        <div className={`shrink-0 px-4 py-2 border-b border-outline-variant/[0.06] flex items-center gap-2 ${
          bannerState === 'error' ? 'bg-red-50/80' :
          bannerState === 'warn'  ? 'bg-amber-50/80' :
          'bg-emerald-50/80'
        }`}>
          <span className={`material-symbols-outlined text-[14px] ${
            bannerState === 'error' ? 'text-red-600' :
            bannerState === 'warn'  ? 'text-amber-600' :
            'text-emerald-600'
          }`} style={{ fontVariationSettings: "'FILL' 1" }}>
            {bannerState === 'error' ? 'error' : bannerState === 'warn' ? 'warning' : 'check_circle'}
          </span>
          <span className={`text-[11px] font-medium ${
            bannerState === 'error' ? 'text-red-700' :
            bannerState === 'warn'  ? 'text-amber-700' :
            'text-emerald-700'
          }`}>
            {bannerState === 'error'
              ? (payeeUnmatched ? 'Payee not matched — review required' : 'Low confidence — review carefully')
              : bannerState === 'warn'
              ? (projectUnmatched ? 'Project not identified — assign manually' : 'Some fields need review')
              : 'All fields verified by AI ✓'}
          </span>
        </div>
      )}

      {/* ── Fields ── */}
      <div className="flex-1 overflow-y-auto px-4 py-2">

        {/* 1. Payee */}
        <FieldRow icon="person" label="Payee" required missing={missingPayee && !payeeId && !payeeUnmatched}>
          <div className="relative" ref={payeeDropRef}>
            <input
              type="text"
              value={displayPayee}
              onChange={(e) => {
                setPayeeSearch(e.target.value);
                if (payeeId) { setPayeeId(''); setPayeeName(''); }
                setShowPayeeDrop(true);
              }}
              onFocus={() => setShowPayeeDrop(true)}
              placeholder="Search stakeholder…"
              className={`w-full text-[13px] px-2.5 py-1.5 rounded-lg border outline-none transition-colors ${
                missingPayee && !payeeId && !payeeUnmatched
                  ? 'border-red-300 bg-red-50'
                  : payeeId
                  ? 'border-emerald-300 bg-emerald-50/30'
                  : payeeUnmatched
                  ? 'border-amber-300 bg-amber-50/30'
                  : 'border-outline-variant/30 bg-surface-container-lowest/60'
              }`}
              autoComplete="off"
            />
            {payeeId && (
              <span className="absolute right-2 top-1/2 -translate-y-1/2 material-symbols-outlined text-[15px] text-emerald-600"
                style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
            )}
            {showPayeeDrop && !payeeId && (
              <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-black/[0.08] rounded-xl shadow-lg max-h-48 overflow-y-auto">
                {filteredPayees.slice(0, 10).map((s) => (
                  <button key={s.stakeholder_id} type="button"
                    onClick={() => { selectPayee(s.stakeholder_id, s.name); setShowCreateStkForm(false); }}
                    className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-surface-container-low text-left border-b border-outline-variant/[0.06] last:border-0"
                  >
                    <div>
                      <p className="text-[13px] font-semibold text-on-surface">{s.name}</p>
                      <p className="text-[11px] text-on-surface-variant/50">{s.type} · {s.category}</p>
                    </div>
                  </button>
                ))}
                {filteredPayees.length === 0 && (
                  <p className="px-3 py-3 text-[12px] text-on-surface-variant/50 text-center">No matches</p>
                )}
              </div>
            )}
          </div>

          {/* STATE B: Unmatched — show closest matches + create option */}
          {payeeUnmatched && !payeeId && !showCreateStkForm && (
            <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-[11px] text-amber-700 font-medium mb-2 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">warning</span>
                "<span className="italic">{ai.payee_raw}</span>" not found in stakeholders
              </p>
              {(ai.payee_closest_match?.length ?? 0) > 0 && (
                <div className="space-y-1 mb-2">
                  <p className="text-[10px] text-amber-600/70 uppercase tracking-wide font-semibold mb-1">Did you mean?</p>
                  {ai.payee_closest_match!.map(m => (
                    <button key={m.id} type="button"
                      onClick={() => selectPayee(m.id, m.name)}
                      className="w-full text-left px-2.5 py-1.5 rounded-lg bg-white border border-amber-200 hover:border-amber-400 hover:bg-amber-50/50 transition-colors"
                    >
                      <span className="text-[13px] font-semibold text-on-surface">{m.name}</span>
                      <span className="text-[11px] text-on-surface-variant/50 ml-1.5">· {m.type} · {m.category}</span>
                    </button>
                  ))}
                </div>
              )}
              <button type="button"
                onClick={() => setShowCreateStkForm(true)}
                className="text-[12px] text-primary font-semibold hover:underline flex items-center gap-1"
              >
                <span className="material-symbols-outlined text-[14px]">add_circle</span>
                Create new stakeholder
              </button>

              {/* Full dropdown escape hatch */}
              <div className="mt-2 pt-2 border-t border-amber-200">
                <p className="text-[10px] text-amber-600/70 uppercase tracking-wide font-semibold mb-1">Or select from all stakeholders:</p>
                <select
                  defaultValue=""
                  onChange={(e) => {
                    const s = stakeholders.find((x: any) => x.stakeholder_id === e.target.value);
                    if (s) selectPayee(s.stakeholder_id, s.name);
                  }}
                  className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-amber-300 bg-white outline-none focus:border-amber-500 transition-colors"
                >
                  <option value="">Select stakeholder…</option>
                  {stakeholders.map((s: any) => (
                    <option key={s.stakeholder_id} value={s.stakeholder_id}>
                      {s.name} · {s.category}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          )}

          {/* STATE C: Inline create form */}
          {showCreateStkForm && (
            <CreateStakeholderForm
              defaultName={ai.payee_raw || payeeSearch}
              onCreated={(id, name) => { selectPayee(id, name); setShowCreateStkForm(false); }}
              onCancel={() => setShowCreateStkForm(false)}
            />
          )}

          <div className="mt-1">
            <ConfBadge c={!payeeId ? null : payeeConf || 'HIGH'} label="Required" />
          </div>
        </FieldRow>

        {/* 2. Amount */}
        <FieldRow icon="currency_rupee" label="Amount" required missing={missingAmount}>
          <div className="flex items-center gap-1.5">
            <span className="text-[14px] font-bold text-on-surface-variant/40 font-data-mono">₹</span>
            <input
              type="number"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || '')}
              onFocus={(e) => e.target.select()}
              placeholder="0"
              className={`w-full text-[14px] font-bold font-data-mono px-2 py-1 rounded-lg border outline-none transition-colors ${
                missingAmount
                  ? 'border-red-300 bg-red-50 text-red-600'
                  : 'border-outline-variant/30 bg-surface-container-lowest/60 text-on-surface'
              }`}
            />
          </div>
          <div className="mt-1">
            <ConfBadge c={!amount ? null : amountConf || 'HIGH'} label="Required" />
          </div>
        </FieldRow>

        {/* 3. Description */}
        <FieldRow icon="notes" label="Description" required missing={missingDescription}>
          <input
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was this payment for?"
            className={`w-full text-[13px] px-2.5 py-1.5 rounded-lg border outline-none transition-colors ${
              missingDescription
                ? 'border-red-300 bg-red-50'
                : 'border-outline-variant/30 bg-surface-container-lowest/60'
            }`}
          />
          <div className="mt-1">
            <ConfBadge c={!description ? null : descConf || 'HIGH'} label="Required" />
          </div>
        </FieldRow>

        {/* 4. Project */}
        <FieldRow icon="domain" label="Project" required missing={missingProject && !projectUnmatched}>
          <select
            ref={projectRef}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={`w-full text-[13px] px-2.5 py-1.5 rounded-lg border outline-none transition-colors ${
              missingProject && !projectUnmatched
                ? 'border-red-400 bg-red-50 ring-1 ring-red-300'
                : projectId
                ? 'border-emerald-300 bg-emerald-50/30'
                : projectUnmatched
                ? 'border-amber-300 bg-amber-50/30'
                : 'border-outline-variant/30 bg-surface-container-lowest/60'
            }`}
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.project_id} value={p.project_id}>{p.name}</option>
            ))}
          </select>

          {/* STATE B: project unmatched — show closest matches */}
          {projectUnmatched && !projectId && (ai.project_closest_match?.length ?? 0) > 0 && (
            <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-[11px] text-amber-700 font-medium mb-2 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">warning</span>
                "<span className="italic">{ai.project_raw}</span>" didn't match a project
              </p>
              <div className="space-y-1">
                {ai.project_closest_match!.map(p => (
                  <button key={p.id} type="button"
                    onClick={() => setProjectId(p.id)}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg bg-white border border-amber-200 hover:border-amber-400 hover:bg-amber-50/50 transition-colors text-[13px] font-semibold text-on-surface"
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="mt-1">
            {isWhatsApp && !projectId && !projectUnmatched
              ? <span className="text-[11px] text-red-500 font-semibold">✗ Required — WhatsApp entries never have a project</span>
              : <ConfBadge c={!projectId ? null : projConf || 'HIGH'} label="Required" />
            }
          </div>
        </FieldRow>

        {/* 5. Mode */}
        <FieldRow icon="credit_card" label="Mode">
          <div className="flex gap-1.5 flex-wrap">
            {(['Cash', 'NEFT', 'UPI', 'Cheque'] as const).map((m) => (
              <button key={m} type="button"
                onClick={() => setMode(m)}
                className={`px-3 py-1 rounded-full text-[12px] font-semibold transition-colors ${
                  mode === m
                    ? 'bg-[#C45B39] text-white'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
                }`}
              >{m}</button>
            ))}
          </div>
          <div className="mt-1"><ConfBadge c="HIGH" /></div>
        </FieldRow>

        {/* 6. Category */}
        <FieldRow icon="sell" label="Category">
          <CostCodePicker value={categoryCode} onChange={setCategoryCode} />
        </FieldRow>

        {/* 7. Work Order */}
        {relatedWOs.length > 0 && (
          <FieldRow icon="description" label="Work Order">
            <select
              value=""
              className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest/60 outline-none"
            >
              <option value="">None / Unlinked</option>
              {relatedWOs.map((wo) => (
                <option key={wo.wo_id} value={wo.wo_id}>
                  {wo.wo_id} · {wo.scope_of_work?.slice(0, 30)}
                </option>
              ))}
            </select>
          </FieldRow>
        )}

        {/* 8. Date */}
        <FieldRow icon="calendar_today" label="Date">
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="text-[13px] px-2.5 py-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest/60 outline-none"
          />
          <div className="mt-1"><ConfBadge c="HIGH" /></div>
        </FieldRow>

        {/* 9. Notes */}
        <FieldRow icon="chat_bubble" label="Notes">
          <input
            type="text"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Add a note (optional)"
            className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-outline-variant/30 bg-surface-container-lowest/60 outline-none"
          />
        </FieldRow>
      </div>

      {/* ── Sticky footer ── */}
      <div className="shrink-0 border-t border-outline-variant/[0.08] px-4 pt-3 pb-4"
           style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>

        {!mandatoryFilled && (
          <p className="text-[12px] text-amber-600 text-center mb-2.5">
            {missingProject ? 'Select a project to post' :
             missingPayee   ? (payeeUnmatched ? 'Match or create a payee to post' : 'Select a payee to post') :
             missingAmount  ? 'Enter an amount to post' :
             'Add a description to post'}
          </p>
        )}

        {showDismissConfirm && (
          <div className="mb-3 p-3 bg-surface-container rounded-xl flex items-center gap-2 flex-wrap">
            <p className="text-[12px] text-on-surface-variant flex-1">Dismiss this entry? It won't be deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowDismissConfirm(false)}
                className="text-[12px] text-on-surface-variant/60 hover:text-on-surface px-2 py-1">
                Keep
              </button>
              <button onClick={handleDismiss}
                className="text-[12px] text-error font-semibold px-3 py-1 rounded-lg hover:bg-error-container/20">
                Yes, dismiss
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-col-reverse md:flex-row gap-2">
          <button
            onClick={() => setShowDismissConfirm(true)}
            className="flex-1 md:flex-none px-4 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-medium text-on-surface-variant hover:bg-surface-container transition-colors"
          >
            Dismiss
          </button>
          <button
            onClick={handlePost}
            disabled={!mandatoryFilled || posting}
            className={`flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold transition-all ${
              mandatoryFilled && !posting
                ? 'bg-[#C45B39] text-white hover:opacity-90 shadow-sm'
                : 'bg-surface-container text-on-surface-variant/40 cursor-not-allowed'
            }`}
          >
            {posting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Posting…
              </>
            ) : (
              <>Post Transaction →</>
            )}
          </button>
        </div>
      </div>
    </>
  );
}
