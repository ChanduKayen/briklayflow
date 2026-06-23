import { useState, useEffect, useRef, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import type { RoughEntry } from '../types';
import { useSnackbar } from './Snackbar';
import { useOrgId } from '../lib/auth/AuthProvider';
import { ImageLightbox } from './ImageLightbox';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';

// ── Walnut-ledger palette (mirrors NewTransaction.tsx) ──────────────────────────
// Warm cream canvas, walnut ink, terracotta accent for money-out, sage for money-in.
// Visual only — never read by any handler/mutation/query. Retuning these re-skins
// the editor at the source so it matches the New Transaction page exactly.
const VOICE = {
  user: '#2A211B', userSoft: '#5A4E42',
  system: '#5A4E42', systemFaint: '#9A8E80',
  ask: '#C75E32', askDeep: '#AC4D27', askWash: '#F7E9DF', askLine: '#E5C98F',
  confirm: '#4C6B47', confirmWash: '#EBF1E7',
  out: '#C75E32', outWash: '#F7E9DF', outLine: '#E8C5B4',
  inn: '#5E8157', innWash: '#EBF1E7', innLine: '#BFD8BC',
  page: '#F7F2E9', surface: '#FFFFFF', field: '#F4EEE3', line: '#EAE1D2',
  walnut: '#221A13', ivory: '#F3EADB', faint: '#C7BCAC', hairStrong: '#DDD2C0',
  cream2: '#FBF7EF', surface2: '#F4EEE3',
  accentSoft: '#E08A5C', accentDeep: '#AC4D27', accentTint: '#F7E9DF', innSoft: '#9CBB91',
  serif: "'Playfair Display', Georgia, 'Times New Roman', serif",
};
const VNUMS = { fontVariantNumeric: 'tabular-nums' as const };

// ── Helpers ────────────────────────────────────────────────────────────────────

type PayeeState = 'A' | 'B' | 'C' | 'confirmed';

// Names read better title-cased — capitalise the first letter of each word as the
// owner types, without fighting intentional caps elsewhere (e.g. "McRavi" stays).
const capitalizeWords = (v: string) => v.replace(/(^|\s)([a-z])/g, (_, sp, c) => sp + c.toUpperCase());

// ── Field question headline — serif, turns terracotta when the field is missing ──
function FieldQuestion({ text, missing }: { text: string; missing?: boolean }) {
  return (
    <h2 className="mb-3" style={{ fontFamily: VOICE.serif, fontSize: 19, fontWeight: 600, letterSpacing: '-0.2px', color: missing ? VOICE.out : VOICE.user }}>
      {text}
    </h2>
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
    <div className="mt-2 p-3 rounded-xl space-y-2" style={{ background: VOICE.askWash, border: `1px solid ${VOICE.outLine}` }}>
      <p className="text-[11px] font-semibold" style={{ color: VOICE.accentDeep }}>New Stakeholder</p>
      <input
        type="text"
        value={name}
        onChange={(e) => setName(capitalizeWords(e.target.value))}
        placeholder="Full name"
        autoFocus
        autoCapitalize="words"
        className="w-full text-[13px] px-2.5 py-1.5 rounded-lg outline-none transition-colors"
        style={{ border: `1px solid ${VOICE.line}`, background: VOICE.surface, color: VOICE.user }}
      />
      <div className="flex gap-1.5">
        {(['Worker', 'Vendor', 'Client'] as const).map(t => (
          <button key={t} type="button" onClick={() => { setType(t); setCategory(''); setCategoryOther(''); }}
            className="px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors"
            style={type === t
              ? { background: VOICE.walnut, color: VOICE.ivory }
              : { background: VOICE.field, color: VOICE.system }}
          >{t}</button>
        ))}
      </div>
      {type !== 'Client' && (
        <select
          value={category}
          onChange={(e) => { setCategory(e.target.value); setCategoryOther(''); }}
          className="w-full text-[13px] px-2.5 py-1.5 rounded-lg outline-none transition-colors appearance-none"
          style={{ border: `1px solid ${VOICE.line}`, background: VOICE.surface, color: category ? VOICE.user : VOICE.systemFaint }}
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
          className="w-full text-[13px] px-2.5 py-1.5 rounded-lg outline-none transition-colors"
          style={{ border: `1px solid ${VOICE.line}`, background: VOICE.surface, color: VOICE.user }}
        />
      )}
      <input
        type="tel"
        value={phone}
        onChange={(e) => setPhone(e.target.value)}
        placeholder="Phone (optional)"
        className="w-full text-[13px] px-2.5 py-1.5 rounded-lg outline-none transition-colors"
        style={{ border: `1px solid ${VOICE.line}`, background: VOICE.surface, color: VOICE.user }}
      />
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onCancel}
          className="flex-1 py-1.5 rounded-lg text-[12px] transition-colors"
          style={{ border: `1px solid ${VOICE.line}`, color: VOICE.system }}>
          Cancel
        </button>
        <button type="button" onClick={create} disabled={!name.trim() || creating}
          className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
          style={name.trim() && !creating
            ? { background: VOICE.walnut, color: VOICE.ivory }
            : { background: VOICE.field, color: VOICE.systemFaint, cursor: 'not-allowed' }}>
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

  // ── Drag-to-dismiss / swipe-to-full-height (mobile) ────────────────────────
  // Down-drag past a threshold dismisses (existing). Up-drag expands the sheet
  // toward full height (snaps to full on a small upward pull).
  const sheetRef = useRef<HTMLDivElement>(null);
  const dragStartY = useRef(0);
  const [dragY, setDragY] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [fullHeight, setFullHeight] = useState(false);
  const payeeRef = useRef<HTMLInputElement>(null);
  const projectRef = useRef<HTMLSelectElement>(null);

  const handleDragStart = useCallback((e: React.PointerEvent) => {
    setIsDragging(true);
    dragStartY.current = e.clientY;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const handleDragMove = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    const delta = e.clientY - dragStartY.current;
    // Only track downward drag for the transform (dismiss gesture). Upward drag is
    // resolved on release into a snap-to-full-height.
    setDragY(delta > 0 ? delta : 0);
  }, [isDragging]);

  const handleDragEnd = useCallback((e: React.PointerEvent) => {
    if (!isDragging) return;
    setIsDragging(false);
    const delta = e.clientY - dragStartY.current;
    const threshold = (sheetRef.current?.offsetHeight || 400) * 0.4;
    if (delta > threshold) { onClose(); return; }
    if (delta < -40) setFullHeight(true);   // small upward pull → snap to full height
    setDragY(0);
  }, [isDragging, onClose]);

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

  const isWhatsApp = entry.source.startsWith('WHATSAPP');

  // On open, focus the amount (matches NewTransaction's amount-first behaviour).
  useEffect(() => {
    setTimeout(() => document.getElementById('resolve-amount-input')?.focus({ preventScroll: true }), 60);
  }, []);

  // Lock the background scroll while the editor is open, so focusing a field can't jolt the
  // document underneath the fixed sheet (the source of the up/down jitter on mobile). The
  // sheet's own overflow-y-auto body still scrolls.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
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

  // ── Auto-focus / auto-advance (copied from NewTransaction) ──────────────────
  // Focus SYNCHRONOUSLY inside the tap so the cursor/keyboard activates on mobile.
  // On mobile we DON'T preventScroll — that disables the browser's native
  // "scroll the focused input above the keyboard" behaviour. Desktop just centers.
  const bringIntoFrame = (el: HTMLElement | null) => {
    if (!el) return;
    // Always preventScroll — inside a fixed sheet the native focus-scroll jolts the document.
    // Then scroll the field within the sheet's own scroll body: to the top on mobile (clears
    // the sticky header via scroll-margin and sits above the keyboard), centered on desktop.
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: window.innerWidth < 640 ? 'start' : 'center' });
  };
  const fieldEl = (k: 'amount' | 'payee' | 'description' | 'project'): HTMLElement | null =>
    k === 'amount' ? document.getElementById('resolve-amount-input')
      : k === 'payee' ? payeeRef.current
      : k === 'description' ? document.getElementById('resolve-description-input')
      : projectRef.current;

  // Smart-CTA gap order: amount → payee → description → project. While a gap
  // remains the footer names it; once none remain it becomes "File it".
  const nextGap: { label: string; key: 'amount' | 'payee' | 'description' | 'project' } | null = (() => {
    if (missingAmount) return { label: 'Enter the amount', key: 'amount' };
    if (missingPayee) return { label: 'Add the payee', key: 'payee' };
    if (missingDescription) return { label: 'Add a remark', key: 'description' };
    if (missingProject) return { label: 'Choose a project', key: 'project' };
    return null;
  })();
  const goToGap = () => { if (nextGap) bringIntoFrame(fieldEl(nextGap.key)); };

  // Called after a field is completed — jump to the first still-empty mandatory
  // field, cursor active, in the frame. Computed from CURRENT state synchronously
  // (treating `justFilled` as done, since its setState hasn't flushed yet).
  const advanceAfter = (justFilled: 'amount' | 'payee' | 'description' | 'project') => {
    const empty: Record<string, boolean> = {
      amount: missingAmount,
      payee: missingPayee,
      description: missingDescription,
      project: missingProject,
    };
    for (const k of ['amount', 'payee', 'description', 'project'] as const) {
      if (k !== justFilled && empty[k]) { bringIntoFrame(fieldEl(k)); return; }
    }
  };

  // On open (WhatsApp without a project) jump straight to the project picker.
  useEffect(() => {
    if (isWhatsApp && !projectId) setTimeout(() => projectRef.current?.focus(), 400);
  }, []);

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

  const sourceMeta: Record<string, { label: string; bg: string; fg: string }> = {
    WHATSAPP_TEXT:  { label: 'WhatsApp',       bg: VOICE.confirmWash, fg: VOICE.confirm },
    WHATSAPP_IMAGE: { label: 'WhatsApp Image', bg: VOICE.askWash,     fg: VOICE.accentDeep },
    WHATSAPP_VOICE: { label: 'WhatsApp Voice', bg: VOICE.askWash,     fg: VOICE.accentDeep },
    UI_TEXT:        { label: 'Manual',         bg: VOICE.field,       fg: VOICE.system },
    UI_IMAGE:       { label: 'Scan',           bg: VOICE.field,       fg: VOICE.system },
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
    payeeRef, advanceAfter, nextGap, goToGap,
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
          className="resolve-editor pointer-events-auto w-full max-w-[480px] max-h-[88vh] flex flex-col rounded-2xl shadow-[0_20px_60px_rgba(0,0,0,0.2)] overflow-hidden"
          style={{ background: VOICE.page, animation: 'popupIn 200ms cubic-bezier(0.4,0,0.2,1) both' }}
          onClick={(e) => e.stopPropagation()}
        >
          <PopupContents {...sharedProps} />
        </div>
      </div>

      {/* Mobile: bottom sheet (swipe up → full height, swipe down → dismiss) */}
      <div
        ref={sheetRef}
        className="resolve-editor md:hidden fixed bottom-0 left-0 right-0 z-[61] flex flex-col rounded-t-[20px] shadow-2xl overflow-hidden"
        style={{
          background: VOICE.page,
          height: fullHeight ? '100dvh' : undefined,
          maxHeight: fullHeight ? '100dvh' : '92vh',
          transform: `translateY(${isDragging ? dragY : 0}px)`,
          transition: isDragging ? 'none' : 'transform 280ms cubic-bezier(0.4,0,0.2,1), height 280ms cubic-bezier(0.4,0,0.2,1), max-height 280ms cubic-bezier(0.4,0,0.2,1)',
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
          <div className="w-8 h-1 rounded-full" style={{ background: VOICE.hairStrong }} />
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
        @media (max-width: 640px){
          .resolve-editor input:not(#resolve-amount-input), .resolve-editor select, .resolve-editor textarea { font-size: 16px }
        }
        .resolve-editor input, .resolve-editor textarea, .resolve-editor select, #resolve-amount-input { scroll-margin-top: 24px; scroll-margin-bottom: 150px; }
        #resolve-amount-input::placeholder { color: rgba(243,234,219,.26) }
        #resolve-amount-input::-webkit-outer-spin-button, #resolve-amount-input::-webkit-inner-spin-button { -webkit-appearance: none; margin: 0 }
        #resolve-amount-input { -moz-appearance: textfield }
      `}</style>
    </>
  );
}

// ── Inner shared content ───────────────────────────────────────────────────────

interface ContentProps {
  entry: RoughEntry;
  sm: { label: string; bg: string; fg: string };
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
  payeeRef: React.RefObject<HTMLInputElement | null>;
  advanceAfter: (justFilled: 'amount' | 'payee' | 'description' | 'project') => void;
  nextGap: { label: string; key: 'amount' | 'payee' | 'description' | 'project' } | null;
  goToGap: () => void;
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
  posting,
  showDismissConfirm, setShowDismissConfirm,
  onClose, handleSave, handleDismiss,
  payeeRef, advanceAfter, nextGap, goToGap,
}: ContentProps) {
  const payeeDropRef    = useRef<HTMLDivElement>(null);
  const [showCreateStkForm, setShowCreateStkForm] = useState(false);

  const ai = entry.ai_extracted;

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
    // Auto-advance to the next still-empty mandatory field (cursor active on mobile).
    advanceAfter('payee');
  };

  // Payee search list: sorted by similarity to ai.payee_raw, filtered by typed text
  const sortedPayees = sortByPayeeSimilarity(stakeholders, ai.payee_raw || '');
  const searchedPayees = payeeSearch
    ? sortedPayees.filter((s: any) => s.name.toLowerCase().includes(payeeSearch.toLowerCase()))
    : sortedPayees;
  // The name the owner typed (or what the AI heard) — used to personalise the "Add …" CTA.
  const typedName = (payeeSearch.trim() || ai.payee_raw || '').trim();

  // Shared field-input style — walnut-on-cream, terracotta wash when missing, sage when filled.
  const fieldStyle = (state: 'missing' | 'filled' | 'idle') => ({
    border: `1px solid ${state === 'missing' ? VOICE.outLine : state === 'filled' ? VOICE.innLine : VOICE.line}`,
    background: state === 'missing' ? VOICE.askWash : state === 'filled' ? VOICE.innWash : VOICE.surface,
    color: VOICE.user,
  });

  return (
    <>
      {/* ── Sticky header (compact) ── */}
      <div className="shrink-0 flex items-center justify-between px-4 py-1.5" style={{ borderBottom: `1px solid ${VOICE.line}` }}>
        <span className="font-data-mono text-[11px]" style={{ color: VOICE.systemFaint, ...VNUMS }}>{entry.re_number}</span>
        <button
          onClick={onClose}
          className="w-7 h-7 flex items-center justify-center rounded-lg transition-colors -mr-1"
          style={{ color: VOICE.system }}
        >
          <span className="material-symbols-outlined text-[18px]">close</span>
        </button>
      </div>

      {/* Scrollable body */}
      <div className="flex-1 overflow-y-auto">

      {/* ── Source strip ── */}
      <div className="shrink-0 px-4 py-3" style={{ background: VOICE.cream2, borderBottom: `1px solid ${VOICE.line}` }}>
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded-full" style={{ background: sm.bg, color: sm.fg }}>{sm.label}</span>
          <span className="text-[11px]" style={{ color: VOICE.systemFaint }}>{entry.sender_name || '—'}</span>
          <span className="text-[11px]" style={{ color: VOICE.faint }}>·</span>
          <span className="text-[11px]" style={{ color: VOICE.systemFaint }}>{fmtTime(entry.created_at)}</span>
        </div>
        {entry.raw_image_url ? (
          <div className="flex items-center gap-2.5 mt-2">
            <button
              onClick={() => setLightboxUrl(entry.raw_image_url!)}
              className="relative group shrink-0"
            >
              <img src={entry.raw_image_url} className="w-16 h-16 rounded-lg object-cover group-hover:opacity-80 transition-opacity" style={{ border: `1px solid ${VOICE.line}` }} />
              <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                <span className="bg-black/50 text-white text-[10px] px-1.5 py-0.5 rounded-full">View</span>
              </div>
            </button>
            <button onClick={() => setLightboxUrl(entry.raw_image_url!)}
               className="text-[12px] underline hover:opacity-80" style={{ color: VOICE.accentDeep }}>View full image →</button>
          </div>
        ) : entry.raw_text ? (
          <p className="text-[12px] italic leading-relaxed" style={{ color: VOICE.systemFaint }}>
            "{entry.raw_text.length > 120 ? entry.raw_text.slice(0, 120) + '…' : entry.raw_text}"
          </p>
        ) : null}
      </div>

      {/* ── Fields ── */}
      <div className="px-4 pt-5 pb-2 space-y-7">

        {/* 1. Amount — dark walnut "ledger" hero card (signature element) */}
        <div
          className="relative overflow-hidden"
          onClick={() => document.getElementById('resolve-amount-input')?.focus()}
          style={{
            borderRadius: 24, padding: '28px 26px 24px', cursor: 'text',
            background: 'radial-gradient(120% 120% at 85% 0%, rgba(224,138,92,.14) 0%, rgba(224,138,92,0) 42%), linear-gradient(158deg,#2D2118 0%,#221A13 60%,#1B140E 100%)',
            boxShadow: '0 26px 50px -28px rgba(34,26,19,.7), inset 0 0 0 1px rgba(243,234,219,.06)',
          }}
        >
          <span className="inline-flex items-center gap-1.5 mb-3.5" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: VOICE.accentSoft }}>
            <span className="material-symbols-outlined text-[13px]">north_east</span>
            Money going out
          </span>
          <div className="flex items-baseline gap-1.5 min-w-0">
            <span style={{ fontFamily: VOICE.serif, fontSize: 'clamp(24px, 7vw, 30px)', fontWeight: 600, color: VOICE.accentSoft, flex: '0 0 auto' }}>₹</span>
            <input
              id="resolve-amount-input"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={amount}
              onChange={(e) => setAmount(parseFloat(e.target.value) || '')}
              onFocus={(e) => e.target.select()}
              onClick={(e) => e.stopPropagation()}
              onWheel={(e) => e.currentTarget.blur()}
              placeholder="0"
              aria-label="Amount"
              style={{
                fontFamily: VOICE.serif, fontWeight: 600, lineHeight: 1, letterSpacing: '-1.5px',
                fontSize: 'clamp(58px, 17vw, 64px)',
                background: 'transparent', border: 'none', outline: 'none', color: VOICE.ivory,
                caretColor: VOICE.accentSoft,
                flex: '1 1 auto', width: '100%', minWidth: 0, padding: 0,
              }}
            />
          </div>
          <div className="mt-4 pt-3.5 flex items-center justify-between" style={{ borderTop: '1px solid rgba(243,234,219,.1)' }}>
            <span className="inline-flex items-center gap-1.5" style={{ fontSize: 12, fontWeight: 500, color: missingAmount ? '#F0A593' : 'rgba(243,234,219,.5)' }}>
              {missingAmount
                ? <><span className="material-symbols-outlined text-[14px]">error</span>Enter an amount above zero</>
                : 'Tap to enter the amount'}
            </span>
            <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.5px', color: 'rgba(243,234,219,.28)' }}>DRAFT</span>
          </div>
        </div>

        {/* 2. Payee */}
        <div>
          <FieldQuestion text="Who are you paying?" missing={missingPayee && payeeState !== 'B'} />

          {/* STATE A / confirmed — sage ✓ */}
          {(payeeState === 'A' || payeeState === 'confirmed') && (
            <div className="flex items-center justify-between py-2 px-3 rounded-xl" style={{ border: `1px solid ${VOICE.innLine}`, background: VOICE.innWash }}>
              <div className="flex items-center gap-2 min-w-0">
                <div className="min-w-0">
                  <span className="text-[14px] font-semibold" style={{ color: VOICE.user }}>{payeeName}</span>
                  {(() => {
                    const s = stakeholders.find((x: any) => x.stakeholder_id === payeeId);
                    return s?.category
                      ? <span className="text-[11px] ml-1.5" style={{ color: VOICE.systemFaint }}>· {s.category}</span>
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
                className="text-[11px] hover:underline shrink-0 ml-2" style={{ color: VOICE.accentDeep }}>
                change
              </button>
            </div>
          )}

          {/* STATE B — confirm match */}
          {payeeState === 'B' && (
            <div className="p-3 rounded-xl" style={{ background: VOICE.askWash, border: `1px solid ${VOICE.outLine}` }}>
              <p className="text-[11px] font-semibold flex items-center gap-1 mb-2" style={{ color: VOICE.accentDeep }}>
                <span className="text-[13px]">⚠</span> Confirm match
              </p>
              <p className="text-[12px] mb-2.5" style={{ color: VOICE.userSoft }}>
                AI matched{' '}
                <span className="font-semibold" style={{ color: VOICE.user }}>"{ai.payee_raw}"</span>
                {' → '}
                <span className="font-semibold" style={{ color: VOICE.user }}>{payeeName}</span>
                {(() => {
                  const s = stakeholders.find((x: any) => x.stakeholder_id === payeeId);
                  return s?.category
                    ? <span style={{ color: VOICE.systemFaint }}> · {s.category}</span>
                    : null;
                })()}
              </p>
              <div className="flex gap-2">
                <button type="button"
                  onClick={() => { setPayeeState('A'); advanceAfter('payee'); }}
                  className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                  style={{ background: VOICE.confirm, color: '#fff' }}
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
                  className="flex-1 py-1.5 rounded-lg text-[12px] font-semibold transition-colors"
                  style={{ border: `1px solid ${VOICE.line}`, color: VOICE.system }}
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
                <p className="text-[11px] font-medium mb-1.5 flex items-center gap-1" style={{ color: VOICE.accentDeep }}>
                  <span className="material-symbols-outlined text-[13px]">warning</span>
                  "{ai.payee_raw}" not found — search or add below
                </p>
              )}
              <div className="relative" ref={payeeDropRef}>
                <div className="relative">
                  <input
                    ref={payeeRef}
                    type="text"
                    value={payeeSearch}
                    onChange={(e) => {
                      setPayeeSearch(e.target.value);
                      if (payeeId) { setPayeeId(''); setPayeeName(''); }
                      setShowPayeeDrop(true);
                    }}
                    onFocus={() => setShowPayeeDrop(true)}
                    placeholder="Search name…"
                    className="w-full text-[13px] px-2.5 py-2 pr-8 rounded-lg outline-none transition-colors"
                    style={fieldStyle(missingPayee ? 'missing' : 'idle')}
                    autoComplete="off"
                  />
                  <span className="material-symbols-outlined absolute right-2 top-1/2 -translate-y-1/2 text-[15px] pointer-events-none" style={{ color: VOICE.systemFaint }}>
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
                  <div className="absolute left-0 right-0 top-full mt-1 z-10 rounded-xl shadow-lg max-h-56 overflow-y-auto"
                       style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}` }}
                       onMouseDown={(e) => e.stopPropagation()}>

                    {/* ── Zero matches → the create action is promoted to the top as the hero.
                         A brand-new name is one tap: the form opens pre-filled with what was typed. ── */}
                    {!hasMatches && (
                      <button type="button" onMouseDown={openCreate}
                        className="group w-full flex items-center gap-3 px-3 py-3 text-left transition-colors"
                        style={{ background: VOICE.askWash }}
                      >
                        <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[15px] font-bold shadow-sm" style={{ background: VOICE.walnut, color: VOICE.ivory }}>
                          {typedName ? typedName[0].toUpperCase() : '+'}
                        </span>
                        <span className="flex-1 min-w-0">
                          {typedName ? (
                            <>
                              <p className="text-[13px] font-semibold truncate" style={{ color: VOICE.user }}>Create &ldquo;{typedName}&rdquo;</p>
                              <p className="text-[11px]" style={{ color: VOICE.systemFaint }}>New contact · add type &amp; phone</p>
                            </>
                          ) : (
                            <>
                              <p className="text-[13px] font-semibold" style={{ color: VOICE.user }}>Add a new contact</p>
                              <p className="text-[11px]" style={{ color: VOICE.systemFaint }}>No one to match — create one</p>
                            </>
                          )}
                        </span>
                        <span className="material-symbols-outlined text-[18px] group-hover:translate-x-0.5 transition-transform" style={{ color: VOICE.accentDeep }}>
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
                          className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-black/[0.025]"
                          style={{ borderBottom: `1px solid ${VOICE.line}` }}
                        >
                          <div className="flex-1 min-w-0">
                            <p className="text-[13px] font-semibold" style={{ color: VOICE.user }}>{s.name}</p>
                            <p className="text-[11px]" style={{ color: VOICE.systemFaint }}>
                              {s.type} · {s.category}
                              {showHint && (
                                <span className="ml-1" style={{ color: VOICE.faint }}>· matched '{ai.payee_raw}'</span>
                              )}
                            </p>
                          </div>
                        </button>
                      );
                    })}

                    {/* ── Subtle "add" footer — only when matches exist (the hero covers the empty case) ── */}
                    {hasMatches && (
                      <button type="button" onMouseDown={openCreate}
                        className="w-full flex items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-black/[0.02]"
                        style={{ borderTop: `1px solid ${VOICE.line}` }}
                      >
                        <span className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 text-[12px] font-bold" style={{ background: VOICE.askWash, color: VOICE.accentDeep }}>
                          {typedName ? typedName[0].toUpperCase() : '+'}
                        </span>
                        <span className="flex-1 min-w-0 text-[12px]" style={{ color: VOICE.system }}>
                          {typedName ? (
                            <>Not here? Add <span className="font-semibold" style={{ color: VOICE.user }}>{typedName}</span> <span style={{ color: VOICE.systemFaint }}>· new contact</span></>
                          ) : (
                            <span className="font-semibold" style={{ color: VOICE.accentDeep }}>Add a new contact</span>
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
        </div>

        {/* 3. Description */}
        <div>
          <FieldQuestion text="What was this for?" missing={missingDescription} />
          <input
            id="resolve-description-input"
            type="text"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="What was this payment for?"
            className="w-full text-[13px] px-2.5 py-2 rounded-lg outline-none transition-colors"
            style={fieldStyle(missingDescription ? 'missing' : description.trim() ? 'filled' : 'idle')}
          />
        </div>

        {/* 4. Project */}
        <div>
          <FieldQuestion text="Which project is this for?" missing={missingProject && !projectUnmatched} />
          <select
            ref={projectRef}
            value={projectId}
            onChange={(e) => { setProjectId(e.target.value); if (e.target.value) advanceAfter('project'); }}
            className="w-full text-[13px] px-2.5 py-2 rounded-lg outline-none transition-colors appearance-none"
            style={fieldStyle(missingProject && !projectUnmatched ? 'missing' : projectId ? 'filled' : projectUnmatched ? 'missing' : 'idle')}
          >
            <option value="">Select project…</option>
            {projects.map((p) => (
              <option key={p.project_id} value={p.project_id}>{p.name}</option>
            ))}
          </select>

          {projectUnmatched && !projectId && (ai.project_closest_match?.length ?? 0) > 0 && (
            <div className="mt-2 p-2.5 rounded-xl" style={{ background: VOICE.askWash, border: `1px solid ${VOICE.outLine}` }}>
              <p className="text-[11px] font-medium mb-2 flex items-center gap-1" style={{ color: VOICE.accentDeep }}>
                <span className="material-symbols-outlined text-[13px]">warning</span>
                "<span className="italic">{ai.project_raw}</span>" didn't match a project
              </p>
              <div className="space-y-1">
                {ai.project_closest_match!.map((p: any) => (
                  <button key={p.id} type="button"
                    onClick={() => { setProjectId(p.id); advanceAfter('project'); }}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg text-[13px] font-semibold transition-colors"
                    style={{ background: VOICE.surface, border: `1px solid ${VOICE.outLine}`, color: VOICE.user }}
                  >
                    {p.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {isWhatsApp && !projectId && !projectUnmatched && (
            <div className="mt-1.5"><span className="inline-flex items-center gap-1 text-[11px]" style={{ color: VOICE.accentDeep }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: VOICE.accentSoft }} /> Pick a project</span></div>
          )}
        </div>

        {/* 5. Mode */}
        <div>
          <FieldQuestion text="How was it paid?" />
          <div className="flex gap-1.5 flex-wrap">
            {(['Cash', 'NEFT', 'UPI', 'Cheque'] as const).map((m) => (
              <button key={m} type="button"
                onClick={() => setMode(m)}
                className="px-3.5 py-1.5 rounded-full text-[12px] font-semibold transition-colors"
                style={mode === m
                  ? { background: VOICE.walnut, color: VOICE.ivory }
                  : { background: VOICE.field, color: VOICE.system }}
              >{m}</button>
            ))}
          </div>
        </div>
      </div>

      </div>

      {/* ── Sticky footer ── */}
      <div className="shrink-0 px-4 pt-3 pb-4" style={{ borderTop: `1px solid ${VOICE.line}`, background: VOICE.page, paddingBottom: 'max(16px, env(safe-area-inset-bottom))' }}>

        {showDismissConfirm && (
          <div className="mb-3 p-3 rounded-xl flex items-center gap-2 flex-wrap" style={{ background: VOICE.field }}>
            <p className="text-[12px] flex-1" style={{ color: VOICE.system }}>Dismiss this entry? It won't be deleted.</p>
            <div className="flex gap-2">
              <button onClick={() => setShowDismissConfirm(false)}
                className="text-[12px] px-2 py-1" style={{ color: VOICE.systemFaint }}>
                Keep
              </button>
              <button onClick={handleDismiss}
                className="text-[12px] font-semibold px-3 py-1 rounded-lg" style={{ color: VOICE.accentDeep }}>
                Yes, dismiss
              </button>
            </div>
          </div>
        )}

        <div className="flex flex-row gap-2 items-center">
          <button
            onClick={() => setShowDismissConfirm(true)}
            className="shrink-0 md:flex-none px-4 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
            style={{ border: `1px solid ${VOICE.line}`, color: VOICE.system }}
          >
            Dismiss
          </button>
          <div className="hidden md:block flex-1" />
          {nextGap ? (
            /* Incomplete → one guiding button that names the next gap and jumps to it. */
            <button type="button" onClick={goToGap}
              className="flex-1 md:flex-none flex items-center justify-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 active:scale-95"
              style={{ background: VOICE.walnut, color: VOICE.ivory, boxShadow: '0 8px 20px -10px rgba(34,26,19,.6)' }}>
              {nextGap.label}
              <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
            </button>
          ) : (
            /* Complete → the real save action. */
            <button
              onClick={handleSave}
              disabled={posting}
              className="flex-1 md:flex-none flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 active:scale-95"
              style={posting
                ? { background: VOICE.field, color: VOICE.systemFaint, cursor: 'not-allowed' }
                : { background: VOICE.walnut, color: VOICE.ivory, boxShadow: '0 8px 20px -10px rgba(34,26,19,.6)' }}
            >
              {posting ? (
                <>
                  <span className="w-4 h-4 border-2 rounded-full animate-spin" style={{ borderColor: 'rgba(154,142,128,.3)', borderTopColor: VOICE.system }} />
                  Saving…
                </>
              ) : (
                <>
                  <span className="material-symbols-outlined text-[16px]">check</span>
                  File it
                </>
              )}
            </button>
          )}
        </div>
      </div>

      <ImageLightbox url={lightboxUrl} title="Source Image" onClose={() => setLightboxUrl(null)} />
    </>
  );
}
