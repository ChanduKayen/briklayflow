import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { RoughEntry } from '../types';
import { useSnackbar } from './Snackbar';
import { useOrgId } from '../lib/auth/AuthProvider';
import { ImageLightbox } from './ImageLightbox';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';

// ── Helpers ────────────────────────────────────────────────────────────────────

type PayeeState = 'A' | 'B' | 'C' | 'confirmed';

// Names read better title-cased — capitalise the first letter of each word as the
// owner types, without fighting intentional caps elsewhere (e.g. "McRavi" stays).
const capitalizeWords = (v: string) => v.replace(/(^|\s)([a-z])/g, (_, sp, c) => sp + c.toUpperCase());

function FieldRow({
  icon, label, children, required, missing,
}: {
  icon: string; label: string; children: React.ReactNode;
  required?: boolean; missing?: boolean;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-outline-variant/[0.06] last:border-0 min-h-[44px]">
      <span className={`material-symbols-outlined text-[18px] mt-0.5 shrink-0 ${missing ? 'text-amber-500/80' : 'text-on-surface-variant/35'}`}>
        {icon}
      </span>
      <div className="w-20 shrink-0 pt-0.5">
        <span className={`text-[11px] font-medium ${missing ? 'text-amber-600' : 'text-on-surface-variant/55'}`}>
          {label}{required && <span className="text-amber-500/70 ml-0.5">*</span>}
        </span>
      </div>
      <div className="flex-1 min-w-0">{children}</div>
    </div>
  );
}

// ── Payee fuzzy sort ──────────────────────────────────────────────────────────

function payeeSimilarityScore(name: string, q: string): number {
  if (!q) return 0;
  const n  = name.toLowerCase();
  const qL = q.toLowerCase();
  if (n === qL) return 100;
  if (n.includes(qL) || qL.includes(n.split(' ')[0])) return 80;
  if (n.split(' ')[0] === qL.split(' ')[0]) return 60;
  const overlap = [...qL].filter((c) => n.includes(c)).length;
  return Math.round((overlap / Math.max(qL.length, 1)) * 40);
}

function sortByPayeeSimilarity(list: any[], rawName: string): any[] {
  if (!rawName) return list;
  return [...list].sort(
    (a, b) => payeeSimilarityScore(b.name, rawName) - payeeSimilarityScore(a.name, rawName),
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
  const orgId = useOrgId();
  const [name, setName] = useState(capitalizeWords(defaultName));
  const [type, setType] = useState<'Worker' | 'Vendor' | 'Client'>('Worker');
  const [category, setCategory] = useState('');
  const [categoryOther, setCategoryOther] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);

  const create = async () => {
    if (!name.trim() || creating) return;
    setCreating(true);
    try {
      const newId = `STK-${Math.floor(1000 + Math.random() * 9000)}`;
      const trade = category === OTHER_TRADE ? (categoryOther.trim() || 'Other') : category;
      const { data, error } = await supabase.from('stakeholders').insert([{
        stakeholder_id: newId,
        name: name.trim(),
        type,
        category: trade || type,
        contact: phone.trim() || null,
        org_id: orgId,
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
        onChange={(e) => setName(capitalizeWords(e.target.value))}
        placeholder="Full name"
        autoFocus
        autoCapitalize="words"
        className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-outline-variant/30 bg-white outline-none focus:border-primary transition-colors"
      />
      <div className="flex gap-1.5">
        {(['Worker', 'Vendor', 'Client'] as const).map(t => (
          <button key={t} type="button" onClick={() => { setType(t); setCategory(''); setCategoryOther(''); }}
            className={`px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${
              type === t ? 'bg-primary text-on-primary' : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
            }`}
          >{t}</button>
        ))}
      </div>
      {type !== 'Client' && (
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setCategoryOther(''); }}
          className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-outline-variant/30 bg-white outline-none focus:border-primary transition-colors appearance-none"
          style={{ color: category ? undefined : '#9A9186' }}
        >
          <option value="">Trade / category…</option>
          {(type === 'Worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS).map(g => (
            <optgroup key={g.group} label={g.group}>
              {g.trades.map(tr => <option key={tr} value={tr}>{tr}</option>)}
            </optgroup>
          ))}
        </select>
      )}
      {type !== 'Client' && category === OTHER_TRADE && (
        <input
          type="text"
          value={categoryOther}
          onChange={(e) => setCategoryOther(e.target.value)}
          autoFocus
          placeholder="Specify trade…"
          className="w-full text-[13px] px-2.5 py-1.5 rounded-lg border border-outline-variant/30 bg-white outline-none focus:border-primary transition-colors"
        />
      )}
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

export function ResolvePopup({ entry, onClose, onUpdated }: Props) {
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();

  const ai = entry.ai_extracted;

  // ── Field state ────────────────────────────────────────────────────────────
  const [payeeId, setPayeeId] = useState(ai.payee_id || '');
  const [payeeName, setPayeeName] = useState(ai.payee_name || '');
  const [payeeSearch, setPayeeSearch] = useState(ai.payee_name || ai.payee_raw || '');
  const [showPayeeDrop, setShowPayeeDrop] = useState(false);
  const [amount, setAmount] = useState<number | ''>(ai.amount ?? '');
  const [description, setDescription] = useState(ai.description || ai.description_raw || '');
  const [projectId, setProjectId] = useState(ai.project_id || '');
  const [mode, setMode] = useState<'Cash' | 'NEFT' | 'UPI' | 'Cheque'>(ai.mode || 'Cash');
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

  // ── Sync payee after stakeholders load ─────────────────────────────────────
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

  const mandatoryFilled = !!payeeId && !!amount && Number(amount) > 0 && !!description.trim() && !!projectId;
  const missingPayee = !payeeId;
  const missingAmount = !amount || Number(amount) <= 0;
  const missingDescription = !description.trim();
  const missingProject = !projectId;
  const payeeUnmatched = !payeeId && !!(ai.payee_unmatched || ai.payee_name || ai.payee_raw);
  const projectUnmatched = !projectId && !!ai.project_unmatched;

  // ── Save action — Edit just records the owner's corrections back onto the entry so
  // the Day Book card reflects them. It does NOT file the transaction; that happens
  // when the owner taps Approve on the card. Status stays PENDING (still in review).
  const handleSave = async () => {
    if (posting) return;
    setPosting(true);
    try {
      const projectName = projects.find((p) => p.project_id === projectId)?.name ?? ai.project_name ?? null;
      const nextAi = {
        ...ai,
        payee_id: payeeId || null,
        payee_name: payeeName || null,
        amount: amount === '' ? null : Number(amount),
        project_id: projectId || null,
        project_name: projectName,
        description: description.trim(),
        mode,
      };
      const { data: updatedEntry } = await supabase
        .from('rough_entries')
        .update({ ai_extracted: nextAi })
        .eq('id', entry.id)
        .select().single();

      qc.invalidateQueries({ queryKey: ['rough_entries'] });
      onUpdated(updatedEntry as RoughEntry);
      onClose();
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to save', { type: 'error' });
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
    isWhatsApp,
    missingPayee, missingAmount, missingDescription, missingProject,
    payeeUnmatched, projectUnmatched,
    mandatoryFilled, posting,
    showDismissConfirm, setShowDismissConfirm,
    onClose, handleSave, handleDismiss,
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
  isWhatsApp: boolean;
  missingPayee: boolean; missingAmount: boolean; missingDescription: boolean; missingProject: boolean;
  payeeUnmatched: boolean; projectUnmatched: boolean;
  mandatoryFilled: boolean; posting: boolean;
  showDismissConfirm: boolean; setShowDismissConfirm: (v: boolean) => void;
  onClose: () => void; handleSave: () => void; handleDismiss: () => void;
}

function PopupContents({
  entry, sm, fmtTime,
  payeeId, payeeName, payeeSearch, setPayeeId, setPayeeName, setPayeeSearch,
  showPayeeDrop, setShowPayeeDrop, stakeholders,
  amount, setAmount,
  description, setDescription,
  projectId, setProjectId, projectRef, projects,
  mode, setMode,
  isWhatsApp,
  missingPayee, missingAmount, missingDescription, missingProject,
  payeeUnmatched, projectUnmatched,
  mandatoryFilled, posting,
  showDismissConfirm, setShowDismissConfirm,
  onClose, handleSave, handleDismiss,
}: ContentProps) {
  const payeeDropRef    = useRef<HTMLDivElement>(null);
  const [showCreateStkForm, setShowCreateStkForm] = useState(false);

  const ai = entry.ai_extracted;

  // Confidence values

  // ── Payee state machine ────────────────────────────────────────────────────
  // A = confirmed HIGH (auto-accepted)
  // B = matched but LOW confidence → show confirmation prompt
  // C = not matched / user searching
  // confirmed = user explicitly chose from B or C
  const [payeeState, setPayeeState] = useState<PayeeState>(() => {
    if (!ai.payee_id) return 'C';
    if (ai.payee_matched === true && ai.payee_confidence === 'LOW') return 'B';
    return 'A';
  });

  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // Close payee dropdown on outside click
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (payeeDropRef.current && !payeeDropRef.current.contains(e.target as Node)) {
        setShowPayeeDrop(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  const selectPayee = (id: string, name: string) => {
    setPayeeId(id);
    setPayeeName(name);
    setPayeeSearch(name);
    setShowPayeeDrop(false);
    setPayeeState('confirmed');
    setShowCreateStkForm(false);
  };

  // Payee search list: sorted by similarity to ai.payee_raw, filtered by typed text
  const sortedPayees = sortByPayeeSimilarity(stakeholders, ai.payee_raw || '');
  const searchedPayees = payeeSearch
    ? sortedPayees.filter((s: any) => s.name.toLowerCase().includes(payeeSearch.toLowerCase()))
    : sortedPayees;
  // The name the owner typed (or what the AI heard) — used to personalise the "Add …" CTA.
  const typedName = (payeeSearch.trim() || ai.payee_raw || '').trim();

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
            <button
              onClick={() => setLightboxUrl(entry.raw_image_url!)}
              className="relative group shrink-0"
            >
              <img src={entry.raw_image_url} className="w-16 h-16 rounded-lg object-cover border border-outline-variant/20 group-hover:opacity-80 transition-opacity" />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-full">View</span>
              </div>
            </button>
            <button onClick={() => setLightboxUrl(entry.raw_image_url!)}
               className="text-[12px] text-primary underline hover:text-primary/80">View full image →</button>
          </div>
        ) : entry.raw_text ? (
          <p className="text-[12px] italic text-on-surface-variant/60 leading-relaxed">
            "{entry.raw_text.length > 120 ? entry.raw_text.slice(0, 120) + '…' : entry.raw_text}"
          </p>
        ) : null}
      </div>

      {/* ── Fields ── */}
      <div className="px-4 py-1.5">

        {/* 1. Payee */}
        <FieldRow icon="person" label="Payee" required missing={missingPayee && payeeState !== 'B'}>

          {/* STATE A / confirmed — green ✓ */}
          {(payeeState === 'A' || payeeState === 'confirmed') && (
            <div className="flex items-center justify-between py-1.5 px-2.5 -mx-0.5 rounded-lg border border-emerald-300/45 bg-emerald-50/25">
              <div className="flex items-center gap-2 min-w-0">
                <div className="min-w-0">
                  <span className="text-[13px] font-semibold text-on-surface">{payeeName}</span>
                  {(() => {
                    const s = stakeholders.find((x: any) => x.stakeholder_id === payeeId);
                    return s?.category
                      ? <span className="text-[11px] text-on-surface-variant/50 ml-1.5">· {s.category}</span>
                      : null;
                  })()}
                </div>
              </div>
              <button type="button"
                onClick={() => {
                  setPayeeState('C');
                  setPayeeId('');
                  setPayeeName('');
                  setPayeeSearch(ai.payee_raw || '');
                  setTimeout(() => setShowPayeeDrop(true), 50);
                }}
                className="text-[11px] text-primary hover:underline shrink-0 ml-2">
                change
              </button>
            </div>
          )}

          {/* STATE B — amber ⚠ confirm */}
          {payeeState === 'B' && (
            <div className="mt-1 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-[11px] font-semibold text-amber-700 flex items-center gap-1 mb-2">
                <span className="text-[13px]">⚠</span> Confirm match
              </p>
              <p className="text-[12px] text-on-surface-variant/80 mb-2.5">
                AI matched{' '}
                <span className="font-semibold text-on-surface">"{ai.payee_raw}"</span>
                {' → '}
                <span className="font-semibold text-on-surface">{payeeName}</span>
                {(() => {
                  const s = stakeholders.find((x: any) => x.stakeholder_id === payeeId);
                  return s?.category
                    ? <span className="text-on-surface-variant/50"> · {s.category}</span>
                    : null;
                })()}
              </p>
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => setPayeeState('A')}
                  className="flex-1 py-1.5 rounded-lg bg-emerald-600 text-white text-[12px] font-semibold hover:bg-emerald-700 transition-colors"
                >
                  ✓ Yes, that's right
                </button>
                <button type="button"
                  onClick={() => {
                    setPayeeId('');
                    setPayeeName('');
                    setPayeeSearch(ai.payee_raw || '');
                    setPayeeState('C');
                    setTimeout(() => setShowPayeeDrop(true), 50);
                  }}
                  className="flex-1 py-1.5 rounded-lg border border-outline-variant/30 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container transition-colors"
                >
                  ✗ No
                </button>
              </div>
            </div>
          )}

          {/* STATE C — search + dropdown */}
          {payeeState === 'C' && (
            <>
              {ai.payee_raw && (ai.payee_unmatched || payeeUnmatched) && (
                <p className="text-[11px] text-amber-700 font-medium mb-1.5 flex items-center gap-1">
                  <span className="material-symbols-outlined text-[13px]">warning</span>
                  "{ai.payee_raw}" not found — search or add below
                </p>
              )}
              <div className="relative" ref={payeeDropRef}>
                <div className="relative">
                  <input
                    type="text"
                    value={payeeSearch}
                    onChange={(e) => {
                      setPayeeSearch(e.target.value);
                      if (payeeId) { setPayeeId(''); setPayeeName(''); }
                      setShowPayeeDrop(true);
                    }}
                    onFocus={() => setShowPayeeDrop(true)}
                    placeholder="Search name…"
                    className={`w-full text-[13px] px-2.5 py-1.5 pr-8 rounded-lg border outline-none transition-colors ${
                      missingPayee
                        ? 'border-amber-300/60 bg-amber-50/40'
                        : 'border-outline-variant/30 bg-surface-container-lowest/60'
                    }`}
                    autoComplete="off"
                  />
                  <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[15px] text-on-surface-variant/30 pointer-events-none">
                    search
                  </span>
                </div>

                {showPayeeDrop && (() => {
                  /* stopPropagation on mousedown prevents the hidden PopupContents instance's
                     document mousedown handler from closing this dropdown before onClick fires */
                  const hasMatches = searchedPayees.length > 0;
                  const openCreate = (e: React.MouseEvent) => {
                    e.preventDefault();
                    setShowPayeeDrop(false);
                    setShowCreateStkForm(true);
                  };
                  return (
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 bg-white border border-black/[0.08] rounded-xl shadow-lg max-h-56 overflow-y-auto"
                       onMouseDown={(e) => e.stopPropagation()}>

                    {/* ── Zero matches → the create action is promoted to the top as the hero.
                         A brand-new name is one tap: the form opens pre-filled with what was typed. ── */}
                    {!hasMatches && (
                      <button type="button" onMouseDown={openCreate}
                        className="group w-full flex items-center gap-3 px-3 py-3 text-left bg-primary/[0.05] hover:bg-primary/[0.09] transition-colors"
                      >
                        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[15px] font-bold bg-primary text-on-primary shadow-sm">
                          {typedName ? typedName[0].toUpperCase() : '+'}
                        </span>
                        <span className="flex-1 min-w-0">
                          {typedName ? (
                            <>
                              <p className="text-[13px] font-semibold text-on-surface truncate">Create &ldquo;{typedName}&rdquo;</p>
                              <p className="text-[11px] text-on-surface-variant/55">New contact · add type &amp; phone</p>
                            </>
                          ) : (
                            <>
                              <p className="text-[13px] font-semibold text-on-surface">Add a new contact</p>
                              <p className="text-[11px] text-on-surface-variant/55">No one to match — create one</p>
                            </>
                          )}
                        </span>
                        <span className="material-symbols-outlined text-[18px] text-primary/60 group-hover:translate-x-0.5 transition-transform">
                          arrow_forward
                        </span>
                      </button>
                    )}

                    {/* ── Matches, when present ── */}
                    {hasMatches && searchedPayees.slice(0, 8).map((s: any) => {
                      const score = payeeSimilarityScore(s.name, ai.payee_raw || '');
                      const showHint = ai.payee_raw && score > 30 && s.name.toLowerCase() !== (ai.payee_raw || '').toLowerCase();
                      return (
                        <button key={s.stakeholder_id} type="button"
                          onMouseDown={(e) => { e.preventDefault(); selectPayee(s.stakeholder_id, s.name); }}
                          className="w-full flex items-start gap-2.5 px-3 py-2 hover:bg-surface-container-low text-left border-b border-outline-variant/[0.06] last:border-0"
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold text-on-surface">{s.name}</p>
                            <p className="text-[11px] text-on-surface-variant/50">
                              {s.type} · {s.category}
                              {showHint && (
                                <span className="text-on-surface-variant/35 ml-1">· matched '{ai.payee_raw}'</span>
                              )}
                            </p>
                          </div>
                        </button>
                      );
                    })}

                    {/* ── Subtle "add" footer — only when matches exist (the hero covers the empty case) ── */}
                    {hasMatches && (
                      <button type="button" onMouseDown={openCreate}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left hover:bg-primary/[0.04] border-t border-outline-variant/[0.06]"
                      >
                        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold bg-primary/10 text-primary">
                          {typedName ? typedName[0].toUpperCase() : '+'}
                        </span>
                        <span className="flex-1 min-w-0 text-[12px] text-on-surface-variant">
                          {typedName ? (
                            <>Not here? Add <span className="font-semibold text-on-surface">{typedName}</span> <span className="text-on-surface-variant/45">· new contact</span></>
                          ) : (
                            <span className="font-semibold text-primary">Add a new contact</span>
                          )}
                        </span>
                      </button>
                    )}
                  </div>
                  );
                })()}
              </div>

              {showCreateStkForm && (
                <CreateStakeholderForm
                  defaultName={ai.payee_raw || payeeSearch}
                  onCreated={(id, name) => { selectPayee(id, name); setShowCreateStkForm(false); }}
                  onCancel={() => setShowCreateStkForm(false)}
                />
              )}
            </>
          )}

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
                  ? 'border-amber-300/60 bg-amber-50/40 text-on-surface'
                  : amount
                  ? 'border-emerald-300/45 bg-emerald-50/25 text-on-surface'
                  : 'border-outline-variant/30 bg-surface-container-lowest/60 text-on-surface'
              }`}
            />
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
                ? 'border-amber-300/60 bg-amber-50/40'
                : description.trim()
                ? 'border-emerald-300/45 bg-emerald-50/25'
                : 'border-outline-variant/30 bg-surface-container-lowest/60'
            }`}
          />
        </FieldRow>

        {/* 4. Project */}
        <FieldRow icon="domain" label="Project" required missing={missingProject && !projectUnmatched}>
          <select
            ref={projectRef}
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className={`w-full text-[13px] px-2.5 py-1.5 rounded-lg border outline-none transition-colors ${
              missingProject && !projectUnmatched
                ? 'border-amber-300/70 bg-amber-50/40'
                : projectId
                ? 'border-emerald-300/45 bg-emerald-50/25'
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

          {projectUnmatched && !projectId && (ai.project_closest_match?.length ?? 0) > 0 && (
            <div className="mt-2 p-2.5 bg-amber-50 border border-amber-200 rounded-xl">
              <p className="text-[11px] text-amber-700 font-medium mb-2 flex items-center gap-1">
                <span className="material-symbols-outlined text-[13px]">warning</span>
                "<span className="italic">{ai.project_raw}</span>" didn't match a project
              </p>
              <div className="space-y-1">
                {ai.project_closest_match!.map((p: any) => (
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

          {isWhatsApp && !projectId && !projectUnmatched && (
            <div className="mt-1.5"><span className="inline-flex items-center gap-1 text-[11px] text-amber-600"><span className="w-1.5 h-1.5 rounded-full bg-amber-500/80" /> Pick a project</span></div>
          )}
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
        </FieldRow>
      </div>

      {/* ── Sticky footer ── */}
      <div className="shrink-0 border-t border-outline-variant/[0.08] px-4 pt-3 pb-4"
           style={{ paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>

        {!mandatoryFilled && (
          <p className="text-[12px] text-amber-600 text-center mb-2.5">
            Some details still need confirming — you can save and finish on the card.
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
            onClick={handleSave}
            disabled={posting}
            className={`flex-1 flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold transition-all ${
              posting ? 'bg-surface-container text-on-surface-variant/40 cursor-not-allowed' : 'bg-[#C45B39] text-white hover:opacity-90 shadow-sm'
            }`}
          >
            {posting ? (
              <>
                <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                Saving…
              </>
            ) : (
              <>Done</>
            )}
          </button>
        </div>
      </div>

      <ImageLightbox url={lightboxUrl} title="Source Image" onClose={() => setLightboxUrl(null)} />
    </>
  );
}
