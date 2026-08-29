import { useState, useEffect, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Stakeholder, Project } from '../types';
import type { Session } from '@supabase/supabase-js';
import { WORKER_TRADE_GROUPS, VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import { useSnackbar } from '../components/Snackbar';
import { useOrgId } from '../lib/auth/AuthProvider';
import { CostCodePicker } from '../components/CostCodePicker';
import { GenHeadPicker } from '../components/GenHeadPicker';
import { getCostCode, costCodeLabel, ALL_COST_CODES, GEN_HEADS, GEN_FALLBACK } from '../lib/costCodes';
import { autoCloseWOIfFullyPaid } from '../lib/woAutoClose';

// ── New Transaction UI redesign — four-voice + money-direction tokens ──────────
// Visual only (NewTransaction_v1.jsx reference). Applied via inline styles; never
// read by any handler/mutation/query. worker/material/expense = OUT, receipt = IN.
// "Walnut-ledger" palette — briklay-new-transaction reference. Warm cream canvas,
// walnut ink, terracotta accent for money-out, sage for money-in. The whole page reads
// its colour from here, so retuning these values re-skins it at the source.
const VOICE = {
  user: '#2A211B', userSoft: '#5A4E42',
  system: '#5A4E42', systemFaint: '#9A8E80',
  ask: '#C75E32', askDeep: '#AC4D27', askWash: '#F7E9DF', askLine: '#E5C98F',
  confirm: '#4C6B47', confirmWash: '#EBF1E7',
  out: '#C75E32', outWash: '#F7E9DF', outLine: '#E8C5B4',
  inn: '#5E8157', innWash: '#EBF1E7', innLine: '#BFD8BC',
  page: '#F7F2E9', surface: '#FFFFFF', field: '#F4EEE3', line: '#EAE1D2',
  // added for the redesign
  walnut: '#221A13', ivory: '#F3EADB', faint: '#C7BCAC', hairStrong: '#DDD2C0',
  cream2: '#FBF7EF', surface2: '#F4EEE3',
  accentSoft: '#E08A5C', accentDeep: '#AC4D27', accentTint: '#F7E9DF', innSoft: '#9CBB91',
  serif: "'Playfair Display', Georgia, 'Times New Roman', serif",
};
const VNUMS = { fontVariantNumeric: 'tabular-nums' as const };

// ── Constants ─────────────────────────────────────────────────────────────────

// Smart COA defaults by transaction type
const COA_DEFAULTS: Record<string, { type: 'MAT' | 'WRK'; division?: string }> = {
  worker:   { type: 'WRK', division: 'WRK-21' },
  material: { type: 'MAT' },
  expense:  { type: 'WRK', division: 'WRK-22' },
};

type TxnType = 'worker' | 'material' | 'expense' | 'client_receipt';
type PayMode = 'NEFT' | 'UPI' | 'Cheque' | 'Cash';
interface AllocDraft { id: string; project_id: string; order_type: 'WO' | 'PO' | ''; order_ref: string; milestone_id: string; allocated_amount: number; }

const TXN_TYPES: { key: TxnType; icon: string; label: string; dir: 'in' | 'out' }[] = [
  { key: 'worker',         icon: 'engineering',   label: 'Worker payment',    dir: 'out' },
  { key: 'material',       icon: 'shopping_cart', label: 'Material purchase', dir: 'out' },
  { key: 'expense',        icon: 'receipt_long',  label: 'General expense',   dir: 'out' },
  { key: 'client_receipt', icon: 'payments',      label: 'Client receipt',    dir: 'in'  },
];

function genTxnId() {
  // PK (text). The old `Date.now().slice(-6)` cycled every ~16.7 min → duplicate-key collisions on
  // transactions_pkey. A short random suffix makes it collision-proof while keeping the readable form.
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}-${Math.random().toString(36).slice(2, 5).toUpperCase()}`;
}

// "Today, 23 Jun" when the date is today, else "23 Jun" — for the header date pill.
function fmtDateShort(d: string) {
  const dt = new Date(d + 'T00:00:00');
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const m = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const lbl = `${dt.getDate()} ${m[dt.getMonth()]}`;
  return dt.getTime() === today.getTime() ? `Today, ${lbl}` : lbl;
}

// ── Section label ─────────────────────────────────────────────────────────────
function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3 ml-0.5">
      <span className="text-[10px] font-bold tabular-nums" style={{ color: VOICE.systemFaint }}>{n}</span>
      <span className="h-px flex-1" style={{ background: VOICE.line }} />
      <span className="text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ color: VOICE.system }}>{title}</span>
    </div>
  );
}

// One document uploader (dashed drop-zone ↔ chosen-file chip). Reused for the two categories a
// transaction can carry: the vendor Bill and the Proof of payment. Each is optional.
function DocUpload({ id, file, onFile, cta }: { id: string; file: File | null; onFile: (f: File | null) => void; cta: string }) {
  return (
    <>
      <input type="file" id={id} onChange={(e) => onFile(e.target.files?.[0] || null)} className="hidden" accept=".pdf,.jpg,.jpeg,.png" />
      {file ? (
        <div className="flex items-center gap-3.5 p-4 rounded-2xl border border-black/[0.05] bg-white shadow-[0_4px_20px_rgba(0,0,0,0.015)] animate-fadeIn">
          <div className="w-12 h-12 rounded-xl bg-black/[0.02] border border-black/[0.04] flex flex-col items-center justify-center shrink-0">
            <span className="text-[9px] font-extrabold uppercase tracking-widest text-on-surface-variant/40 leading-none">{file.name.split('.').pop()?.slice(0, 3)}</span>
            <span className="material-symbols-outlined text-[18px] text-on-surface-variant/30 mt-1">description</span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-semibold text-on-surface truncate" title={file.name}>{file.name}</p>
            <p className="text-[10px] text-on-surface-variant/40 font-bold font-data-mono mt-0.5">{(file.size / 1024).toFixed(0)} KB</p>
          </div>
          <button type="button" onClick={(e) => { e.preventDefault(); onFile(null); }}
            className="w-8 h-8 rounded-xl hover:bg-red-50 text-on-surface-variant/40 hover:text-red-600 transition-colors flex items-center justify-center shrink-0 active:scale-95">
            <span className="material-symbols-outlined text-[18px]">delete</span>
          </button>
        </div>
      ) : (
        <label htmlFor={id}
          className="flex flex-col items-center justify-center border-2 border-dashed border-black/[0.06] hover:border-[#006c49]/30 rounded-2xl p-6 bg-white/40 backdrop-blur-md cursor-pointer transition-all duration-300 group text-center shadow-[0_8px_30px_rgb(0,0,0,0.01)] hover:bg-white/[0.6]">
          <div className="w-11 h-11 rounded-full bg-black/[0.02] group-hover:bg-[#006c49]/[0.04] flex items-center justify-center transition-colors mb-2.5">
            <span className="material-symbols-outlined text-[20px] text-on-surface-variant/35 group-hover:text-[#006c49] transition-transform duration-300 group-hover:-translate-y-1">cloud_upload</span>
          </div>
          <p className="text-[13px] font-semibold text-on-surface group-hover:text-[#006c49] transition-colors">{cta}</p>
          <p className="text-[11px] text-on-surface-variant/40 mt-1">PDF, JPG or PNG · optional</p>
        </label>
      )}
    </>
  );
}

// ── Obligation types + balance helpers ───────────────────────────────────────

interface SelectedObligation {
  type: 'WO_PHASE' | 'WO' | 'PO';
  wo_id?: string;
  phase_id?: string;
  po_id?: string;
  label: string;
  balance: number;
}

function getWOBalance(wo: any): number { return Number(wo.order_value || 0); }
function getPhaseBalance(phase: any): number { return Number(phase.planned_amount || 0); }
function getPOBalance(po: any): number { return Number(po.vendor_bill_amount || po.total_value || po.order_value || 0); }

// ── NoObligationsState ────────────────────────────────────────────────────────

function NoObligationsState({ onSkip, onOpenWO, onOpenPO, txnType, payeeName, projectName }: {
  onSkip: () => void;
  onOpenWO: () => void;
  onOpenPO: () => void;
  txnType?: string | null;
  payeeName?: string | null;
  projectName?: string | null;
}) {
  const isW = txnType === 'worker';
  return (
    <div className="mt-3">
      <p style={{ fontSize: 12.5, lineHeight: 1.55, color: VOICE.system, margin: '0 0 12px', padding: '12px 14px', background: VOICE.field, borderRadius: 12 }}>
        No open {isW ? 'contracts' : 'bills'} with <b style={{ color: VOICE.userSoft }}>{payeeName || 'this party'}</b>{projectName ? <> at <b style={{ color: VOICE.userSoft }}>{projectName}</b></> : null} yet.
      </p>
      <button type="button" onClick={isW ? onOpenWO : onOpenPO}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12.5px] font-semibold transition-opacity hover:opacity-90"
        style={{ background: VOICE.cream2, border: `1.5px dashed ${VOICE.hairStrong}`, color: VOICE.accentDeep }}>
        <span className="material-symbols-outlined text-[16px]">add</span>
        {isW ? 'Create a new contract' : 'Add a new bill'}
      </button>
      <button type="button" onClick={onSkip}
        className="mt-2.5 text-[11px] font-semibold inline-flex items-center gap-1.5" style={{ color: VOICE.systemFaint }}>
        Record without linking <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
      </button>
    </div>
  );
}

// ── WOObligationRow ───────────────────────────────────────────────────────────

function WOObligationRow({ wo, index, selectedObligation, onSelect, onOpenPhases, woPaid }: {
  wo: any; index: number; selectedObligation: SelectedObligation | null;
  onSelect: (ob: SelectedObligation) => void;
  onOpenPhases: (wo: any) => void;
  woPaid: Record<string, number>;
}) {
  const phases = wo.wo_milestones || [];
  const multiPhase = phases.length > 1;   // 0 or 1 phase → one-tap select; >1 → a focused step
  const woBalance = getWOBalance(wo);
  const woNet = Math.max(0, woBalance - (woPaid[wo.wo_id] || 0));
  const woPct = woBalance > 0 ? Math.min(100, Math.round(((woPaid[wo.wo_id] || 0) / woBalance) * 100)) : 0;
  const isSelected = selectedObligation?.wo_id === wo.wo_id;

  const handleTap = () => {
    if (multiPhase) { onOpenPhases(wo); return; }
    if (phases.length === 1) {
      onSelect({ type: 'WO_PHASE', wo_id: wo.wo_id, phase_id: phases[0].milestone_id, label: wo.scope_of_work || wo.wo_id, balance: woNet });
    } else {
      onSelect({ type: 'WO', wo_id: wo.wo_id, label: `${wo.wo_id} · ${wo.stakeholders?.name || ''}`, balance: woNet });
    }
  };

  return (
    <button type="button" onClick={handleTap}
      className={`w-full text-left flex items-center gap-3 px-4 py-3.5 transition-colors ${isSelected ? '' : 'hover:bg-black/[0.025] active:bg-black/[0.04]'}`}
      style={{ background: isSelected ? VOICE.outWash : undefined, borderLeft: `3px solid ${isSelected ? VOICE.out : 'transparent'}` }}>
      <span className="shrink-0 text-right tabular-nums" style={{ width: 14, color: VOICE.systemFaint, fontSize: 11.5, fontWeight: 600 }}>{index}</span>
      {isSelected
        ? <span className="material-symbols-outlined shrink-0" style={{ fontSize: 21, color: VOICE.out, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        : <span className="material-symbols-outlined shrink-0" style={{ fontSize: 21, color: VOICE.hairStrong, fontVariationSettings: "'FILL' 0" }}>radio_button_unchecked</span>}
      <span className="flex-1 min-w-0">
        <span className="block text-[13.5px] font-semibold truncate" style={{ color: VOICE.user }}>{wo.scope_of_work || wo.stakeholders?.name || wo.wo_id}</span>
        <span className="block text-[11px] mt-0.5 truncate" style={{ color: VOICE.systemFaint, ...VNUMS }}>
          {woPct}% paid · {wo.stakeholders?.name || 'Unknown'}{multiPhase ? ` · ${phases.length} stages` : ''}
        </span>
      </span>
      <span className="text-right shrink-0" style={{ minWidth: 92 }}>
        <span className="block text-[13px] font-semibold" style={{ color: woNet > 0 ? VOICE.accentDeep : VOICE.systemFaint, ...VNUMS }}>
          {woNet > 0 ? `₹${woNet.toLocaleString('en-IN')}` : 'Settled'}{woNet > 0 && <span style={{ color: VOICE.systemFaint, fontWeight: 500, fontSize: 10, marginLeft: 2 }}>left</span>}
        </span>
        <span className="block h-1.5 rounded-full overflow-hidden mt-1.5" style={{ background: '#eee3d4' }}>
          <span className="block h-full rounded-full" style={{ width: `${woPct}%`, background: `linear-gradient(90deg, ${VOICE.out}, #dd7d52)` }} />
        </span>
      </span>
      {multiPhase
        ? <span className="material-symbols-outlined shrink-0" style={{ fontSize: 18, color: VOICE.systemFaint }}>chevron_right</span>
        : <span className="shrink-0 block" style={{ width: 8 }} />}
    </button>
  );
}

// ── POObligationRow ───────────────────────────────────────────────────────────

function POObligationRow({ po, index, selectedObligation, onSelect, poPaid }: {
  po: any; index: number; selectedObligation: SelectedObligation | null;
  onSelect: (ob: SelectedObligation) => void;
  poPaid: Record<string, number>;
}) {
  const isPaid = po.status === 'PAID';
  const isCancelled = po.status === 'CANCELLED';
  const hasBill = po.vendor_bill_amount && Number(po.vendor_bill_amount) > 0;

  // Bill amount if present, otherwise estimated PO value; minus payments already made.
  const rawBalance = getPOBalance(po);
  const poNet = Math.max(0, rawBalance - (poPaid[po.po_id] || 0));
  const poPct = rawBalance > 0 ? Math.min(100, Math.round(((poPaid[po.po_id] || 0) / rawBalance) * 100)) : 0;
  const fullyPaid = isPaid || (rawBalance > 0 && poNet <= 0);

  const isSelected = selectedObligation?.po_id === po.po_id;
  const isLinkable = !isPaid && !isCancelled;

  return (
    <div
      className={`flex items-center gap-3 px-4 py-3.5 transition-colors ${!isLinkable ? 'opacity-50 cursor-not-allowed' : isSelected ? '' : 'cursor-pointer hover:bg-black/[0.025] active:bg-black/[0.04]'}`}
      style={{ background: isSelected ? VOICE.innWash : undefined, borderLeft: `3px solid ${isSelected ? VOICE.inn : 'transparent'}` }}
      onClick={() => {
        if (!isLinkable) return;
        onSelect({ type: 'PO', po_id: po.po_id, label: `${po.po_id} · ${po.stakeholders?.name || ''}`, balance: poNet });
      }}
    >
      <span className="shrink-0 text-right tabular-nums" style={{ width: 14, color: VOICE.systemFaint, fontSize: 11.5, fontWeight: 600 }}>{index}</span>
      {isSelected
        ? <span className="material-symbols-outlined shrink-0" style={{ fontSize: 21, color: VOICE.inn, fontVariationSettings: "'FILL' 1" }}>check_circle</span>
        : <span className="material-symbols-outlined shrink-0" style={{ fontSize: 21, color: VOICE.hairStrong, fontVariationSettings: "'FILL' 0" }}>radio_button_unchecked</span>}
      <div className="flex-1 min-w-0">
        <p className="text-[13.5px] font-semibold truncate" style={{ color: VOICE.user }}>
          {po.po_line_items?.[0]?.item_name || po.po_line_items?.[0]?.description || po.po_line_items?.[0]?.name || po.stakeholders?.name || po.po_id}
        </p>
        <p className="text-[11px] mt-0.5 truncate" style={{ color: VOICE.systemFaint, ...VNUMS }}>
          {isCancelled ? 'Cancelled' : fullyPaid ? 'Settled' : `${poPct}% paid`} · {po.stakeholders?.name || 'Unknown'}{!hasBill && !isCancelled && !fullyPaid ? ' · est. advance' : ''}
        </p>
      </div>
      <div className="text-right shrink-0" style={{ minWidth: 104 }}>
        <p className="text-[13.5px] font-semibold" style={{ color: poNet > 0 ? VOICE.inn : VOICE.systemFaint, ...VNUMS }}>
          {fullyPaid ? 'Settled' : `₹${poNet.toLocaleString('en-IN')}`}{!fullyPaid && <span style={{ color: VOICE.systemFaint, fontWeight: 500, fontSize: 10, marginLeft: 2 }}>left</span>}
        </p>
        <span className="block h-1.5 rounded-full overflow-hidden mt-1.5" style={{ background: '#dfe9d8' }}>
          <span className="block h-full rounded-full" style={{ width: `${poPct}%`, background: `linear-gradient(90deg, ${VOICE.inn}, #7a9a6c)` }} />
        </span>
        <p className="text-[10px] mt-1" style={{ color: VOICE.systemFaint, ...VNUMS }}>of ₹{rawBalance.toLocaleString('en-IN')}</p>
      </div>
    </div>
  );
}

// ── LinkingPanel ──────────────────────────────────────────────────────────────

function LinkingPanel({ wos, pos, loading, selectedObligation, onSelect, onSkip, onOpenWO, onOpenPO, txnType, hideCreate, payeeName, projectName }: {
  wos: any[]; pos: any[]; loading: boolean;
  selectedObligation: SelectedObligation | null;
  onSelect: (ob: SelectedObligation) => void;
  onSkip: () => void;
  onOpenWO: () => void;
  onOpenPO: () => void;
  txnType?: string | null;
  hideCreate?: boolean;   // split rows: select existing orders only, no inline create
  payeeName?: string | null;
  projectName?: string | null;
}) {
  // When set, the picker shows a focused "Which stage?" step for this contract
  // (instead of an inline phase tree) — one question on screen at a time.
  const [phasingWoId, setPhasingWoId] = useState<string | null>(null);
  const [milestonePayments, setMilestonePayments] = useState<Record<string, number>>({});
  // Total paid (non-voided) per WO and per PO, so rows show the REMAINING balance
  // — not the gross order/bill value — once a payment has already been recorded.
  const [woPaid, setWoPaid] = useState<Record<string, number>>({});
  const [poPaid, setPoPaid] = useState<Record<string, number>>({});
  const hasData = wos.length > 0 || pos.length > 0;

  useEffect(() => {
    const woIds = wos.map((w: any) => w.wo_id);
    const poIds = pos.map((p: any) => p.po_id);
    if (woIds.length === 0 && poIds.length === 0) {
      setMilestonePayments({}); setWoPaid({}); setPoPaid({}); return;
    }
    let cancelled = false;
    supabase.from('txn_allocations')
      .select('order_ref, order_type, milestone_id, allocated_amount, transactions!inner(status)')
      .in('order_ref', [...woIds, ...poIds])
      .neq('transactions.status', 'Voided')
      .then(({ data }) => {
        if (cancelled) return;
        const ms: Record<string, number> = {};
        const wo: Record<string, number> = {};
        const po: Record<string, number> = {};
        for (const row of (data || []) as any[]) {
          const amt = Number(row.allocated_amount) || 0;
          if (row.order_type === 'WO') {
            wo[row.order_ref] = (wo[row.order_ref] || 0) + amt;
            if (row.milestone_id) ms[row.milestone_id] = (ms[row.milestone_id] || 0) + amt;
          } else if (row.order_type === 'PO') {
            po[row.order_ref] = (po[row.order_ref] || 0) + amt;
          }
        }
        setMilestonePayments(ms); setWoPaid(wo); setPoPaid(po);
      });
    return () => { cancelled = true; };
  }, [wos, pos]);

  if (loading) {
    return (
      <div className="mt-4 rounded-2xl border border-black/[0.05] p-5 space-y-4 bg-stone-50/20 shadow-sm animate-pulse">
        <div className="h-3 w-40 bg-black/[0.06] rounded-full" />
        <div className="h-12 bg-black/[0.04] rounded-xl" />
        <div className="h-12 bg-black/[0.04] rounded-xl" />
      </div>
    );
  }

  if (!hasData) {
    if (hideCreate) {
      return (
        <div className="mt-3 rounded-xl border border-black/[0.05] bg-stone-50/40 px-4 py-3 flex items-center justify-between gap-3">
          <span className="text-[12px] text-on-surface-variant/55">No {txnType === 'worker' ? 'contracts' : 'purchase orders'} for this project.</span>
          <button type="button" onClick={onSkip} className="text-[10px] font-bold uppercase tracking-wider text-on-surface-variant/40 hover:text-primary transition-colors whitespace-nowrap">Record unlinked</button>
        </div>
      );
    }
    return <NoObligationsState onSkip={onSkip} onOpenWO={onOpenWO} onOpenPO={onOpenPO} txnType={txnType} payeeName={payeeName} projectName={projectName} />;
  }

  // ── Step 2 — "Which stage?" for a multi-phase contract (replaces the list) ──
  const phasingWo = phasingWoId ? wos.find((w: any) => w.wo_id === phasingWoId) : null;
  if (phasingWo) {
    const phaseList = [...(phasingWo.wo_milestones || [])].sort((a: any, b: any) => (a.seq_no || 0) - (b.seq_no || 0));
    const dueOf = (m: any) => Math.max(0, getPhaseBalance(m) - (milestonePayments[m.milestone_id] || 0));
    const nextDueId = phaseList.find((m: any) => m.status !== 'PAID' && m.status !== 'Paid' && dueOf(m) > 0)?.milestone_id;
    return (
      <div className="mt-3 rounded-2xl overflow-hidden" style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}` }}>
        <div className="px-3 pt-3 pb-3 flex items-center gap-2.5" style={{ borderBottom: `1px solid ${VOICE.line}` }}>
          <button type="button" onClick={() => setPhasingWoId(null)} aria-label="Back to contracts"
            className="shrink-0 grid place-items-center rounded-lg transition-colors hover:bg-black/[0.03]" style={{ width: 32, height: 32, border: `1px solid ${VOICE.line}`, color: VOICE.user }}>
            <span className="material-symbols-outlined text-[18px]">arrow_back</span>
          </button>
          <div className="min-w-0">
            <p className="text-[13px] font-semibold truncate" style={{ color: VOICE.user }}>{phasingWo.scope_of_work || phasingWo.wo_id}</p>
            <p className="text-[11px]" style={{ color: VOICE.systemFaint }}>Which stage is this payment for?</p>
          </div>
        </div>
        <div className="divide-y divide-black/[0.04]">
          {phaseList.map((m: any) => {
            const planned = getPhaseBalance(m);
            const due = planned - (milestonePayments[m.milestone_id] || 0);
            const settled = m.status === 'PAID' || m.status === 'Paid' || due <= 0;
            const isSel = selectedObligation?.phase_id === m.milestone_id;
            const isNext = m.milestone_id === nextDueId;
            return (
              <button type="button" key={m.milestone_id} disabled={settled}
                onClick={() => onSelect({ type: 'WO_PHASE', wo_id: phasingWo.wo_id, phase_id: m.milestone_id, label: `${m.name} · ${phasingWo.wo_id}`, balance: Math.max(0, due) })}
                className={`w-full text-left flex items-center gap-3 px-4 py-3.5 transition-colors ${settled ? 'opacity-50 cursor-not-allowed' : isSel ? '' : 'cursor-pointer hover:bg-black/[0.025] active:bg-black/[0.04]'}`}
                style={{ background: isSel ? VOICE.outWash : isNext && !isSel ? VOICE.cream2 : undefined, borderLeft: `3px solid ${isSel ? VOICE.out : 'transparent'}` }}>
                <span className="shrink-0 grid place-items-center rounded-full" style={{ width: 18, height: 18, border: isSel ? 'none' : `1.5px solid ${VOICE.hairStrong}`, background: isSel ? VOICE.out : 'transparent' }}>
                  {isSel && <span className="material-symbols-outlined text-white" style={{ fontSize: 12, fontVariationSettings: "'FILL' 1" }}>check</span>}
                </span>
                <span className="flex-1 min-w-0">
                  <span className="flex items-center gap-1.5">
                    <span className="text-[13px] font-semibold truncate" style={{ color: VOICE.user }}>{m.name}</span>
                    {isNext && !isSel && <span className="text-[8.5px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full shrink-0" style={{ background: VOICE.accentTint, color: VOICE.accentDeep }}>next due</span>}
                  </span>
                  {(m.qty || m.unit_type) && <span className="block text-[10.5px] mt-0.5" style={{ color: VOICE.systemFaint, ...VNUMS }}>{m.qty} {m.unit_type}{m.rate ? ` × ₹${Number(m.rate).toLocaleString('en-IN')}` : ''}</span>}
                </span>
                <span className="text-right shrink-0" style={{ ...VNUMS }}>
                  {settled
                    ? <span className="text-[11px] font-semibold inline-flex items-center gap-1" style={{ color: VOICE.confirm }}><span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>paid</span>
                    : <span className="text-[13px] font-semibold" style={{ color: VOICE.accentDeep }}>₹{Math.max(0, due).toLocaleString('en-IN')}<span style={{ color: VOICE.systemFaint, fontWeight: 500, fontSize: 10, marginLeft: 2 }}>due</span></span>}
                </span>
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-2xl overflow-hidden" style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}` }}>
      <div className="px-4 pt-3.5 pb-1.5">
        <p className="text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color: VOICE.systemFaint }}>
          {txnType === 'worker' ? 'Add to an open contract' : 'Add to an open order'}
        </p>
      </div>

      <div className="divide-y divide-black/[0.04]">
        {wos.map((wo: any, i: number) => (
          <WOObligationRow key={wo.wo_id} wo={wo} index={i + 1} selectedObligation={selectedObligation}
            onSelect={onSelect} onOpenPhases={(w) => setPhasingWoId(w.wo_id)} woPaid={woPaid} />
        ))}
        {pos.map((po: any, i: number) => (
          <POObligationRow key={po.po_id} po={po} index={i + 1} selectedObligation={selectedObligation} onSelect={onSelect} poPaid={poPaid} />
        ))}
      </div>

      <div className="px-4 py-3.5" style={{ borderTop: `1px solid ${VOICE.line}` }}>
        {!hideCreate && (
          <button type="button" onClick={txnType === 'worker' ? onOpenWO : onOpenPO}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-xl text-[12.5px] font-semibold mb-2.5 transition-colors hover:opacity-90"
            style={{ background: VOICE.cream2, border: `1.5px dashed ${VOICE.hairStrong}`, color: VOICE.accentDeep }}>
            <span className="material-symbols-outlined text-[16px]">add</span>
            {txnType === 'worker' ? 'Create a new contract' : 'Create a new order'}
          </button>
        )}
        <button type="button" onClick={onSkip}
          className="text-[11px] font-semibold inline-flex items-center gap-1.5 transition-colors" style={{ color: VOICE.systemFaint }}>
          Record without linking <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
        </button>
      </div>
    </div>
  );
}

/** SelectedObligation → the link fields stored on a split row's allocation. */
function obligationToAllocLink(ob: SelectedObligation): Pick<AllocDraft, 'order_type' | 'order_ref' | 'milestone_id'> {
  if (ob.type === 'WO' || ob.type === 'WO_PHASE') return { order_type: 'WO', order_ref: ob.wo_id || '', milestone_id: ob.phase_id || '' };
  if (ob.type === 'PO') return { order_type: 'PO', order_ref: ob.po_id || '', milestone_id: '' };
  return { order_type: '', order_ref: '', milestone_id: '' };
}

/**
 * Per-split obligation linking. Loads THIS row's project WOs (worker) or POs
 * (vendor) for the shared payee and reuses LinkingPanel, so each split links its
 * own order + milestone — the split equivalent of the single-transaction linker.
 * Mounted per row (keyed by project) so changing the row's project reloads it.
 */
function RowObligationLink({ projectId, stkId, txnType, onSelect, onClear }: {
  projectId: string;
  stkId: string;
  txnType: string | null;
  onSelect: (ob: SelectedObligation) => void;
  onClear: () => void;
}) {
  const [wos, setWos] = useState<any[]>([]);
  const [pos, setPos] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [sel, setSel] = useState<SelectedObligation | null>(null);
  const [skipped, setSkipped] = useState(false);

  useEffect(() => {
    setSel(null); setSkipped(false);
    if (!projectId || !stkId || (txnType !== 'worker' && txnType !== 'material')) {
      setWos([]); setPos([]); return;
    }
    let cancelled = false;
    setLoading(true);
    if (txnType === 'worker') {
      supabase.from('work_orders')
        .select('wo_id, scope_of_work, order_value, status, stakeholders(name, category), wo_milestones(*)')
        .eq('project_id', projectId).eq('stakeholder_id', stkId)
        .not('status', 'in', '("Closed","Cancelled")')
        .order('created_at', { ascending: false })
        .then(({ data }) => { if (!cancelled) { setWos(data || []); setPos([]); setLoading(false); } });
    } else {
      supabase.from('purchase_orders')
        .select('po_id, status, vendor_bill_amount, total_value, order_value, stakeholders(name, category), po_line_items(*)')
        .eq('project_id', projectId).eq('stakeholder_id', stkId)
        .order('created_at', { ascending: false })
        .then(({ data }) => { if (!cancelled) { setPos(data || []); setWos([]); setLoading(false); } });
    }
    return () => { cancelled = true; };
  }, [projectId, stkId, txnType]);

  if (skipped) {
    return (
      <button type="button" onClick={() => setSkipped(false)}
        className="flex items-center gap-1.5 text-[12px] text-on-surface-variant/50 hover:text-primary transition-colors">
        <span className="material-symbols-outlined text-[14px]">link</span>
        Link to a Contract or PO
      </button>
    );
  }

  return (
    <LinkingPanel
      wos={wos} pos={pos} loading={loading}
      selectedObligation={sel}
      onSelect={(ob) => { setSel(ob); onSelect(ob); }}
      onSkip={() => { setSkipped(true); setSel(null); onClear(); }}
      onOpenWO={() => {}} onOpenPO={() => {}}
      txnType={txnType}
      hideCreate
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewTransaction({ session: _session }: { session: Session }) {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();

  const initialProjectId      = (location.state as any)?.projectId      || '';
  const initialStakeholderId  = (location.state as any)?.stakeholderId  || '';
  const initialTxnType        = (location.state as any)?.txnType        || null;
  const initialStkName        = (location.state as any)?.stakeholderName || '';

  // ── Type ──────────────────────────────────────────────────────────────────
  const [txnType, setTxnType] = useState<TxnType | null>(initialTxnType as TxnType | null);
  // The 2×2 type grid collapses to a compact chip once a type is chosen (frees space on mobile).
  const [pickingType, setPickingType] = useState(false);
  // Mobile keyboard: tuck the fixed footer away when the on-screen keyboard is up, so it
  // never overlaps the focused field or jumps (iOS doesn't reposition fixed elements). The
  // >150px viewport shrink only happens on a real keyboard, so desktop is unaffected.
  const [kbOpen, setKbOpen] = useState(false);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => setKbOpen(window.innerHeight - vv.height > 150);
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  // ── Core form ────────────────────────────────────────────────────────────
  const [txnId, setTxnId] = useState(genTxnId);
  const [txnIdCopied, setTxnIdCopied] = useState(false);
  const [stkId, setStkId]     = useState(initialStakeholderId);
  const [stkSearch, setStkSearch] = useState(initialStkName);
  const [showSug, setShowSug] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [newStkTrade, setNewStkTrade] = useState('');
  const [newStkTradeOther, setNewStkTradeOther] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [mode, setMode] = useState<PayMode>('NEFT');
  const [totalAmt, setTotalAmt] = useState<number>(0);
  const [category, setCategory] = useState('');
  const [remarks, setRemarks] = useState('');
  const [billFile, setBillFile] = useState<File | null>(null);
  const [proofFile, setProofFile] = useState<File | null>(null);
  const [allocs, setAllocs] = useState<AllocDraft[]>([
    { id: '1', project_id: initialProjectId, order_type: '', order_ref: '', milestone_id: '', allocated_amount: 0 },
  ]);
  const [splitMode, setSplitMode] = useState(false);

  // ── Budget warning state ─────────────────────────────────────────────────
  const [budgetWarning, setBudgetWarning] = useState<{
    code: string; codeName: string; planned: number; currentSpent: number; newTotal: number; overBy: number;
  } | null>(null);
  const [pendingSaveMode, setPendingSaveMode] = useState<'new' | 'exit' | null>(null);

  // ── Obligation linking state ─────────────────────────────────────────────
  const [selectedObligation, setSelectedObligation] = useState<SelectedObligation | null>(null);
  const [skipped, setSkipped] = useState(false);
  // Link hub gate: false = show the "Link to a contract/order vs one-time" choice;
  // true = the obligation picker is open. `skipped` means one-time (not linked).
  const [linkOpen, setLinkOpen] = useState(false);
  const [loadingObligations, setLoadingObligations] = useState(false);
  // ALL of the payee's open orders, prefetched the moment they're selected (across every
  // project) — so linking is instant once a project is chosen. projectWOs/POs filter these.
  const [stkWOs, setStkWOs] = useState<any[]>([]);
  const [stkPOs, setStkPOs] = useState<any[]>([]);
  const [amountTouched, setAmountTouched] = useState(false);

  // ── Inline WO/PO drawer state ────────────────────────────────────────────
  const [drawerOpen, setDrawerOpen] = useState<'WO' | 'PO' | null>(null);
  const [creatingOrder, setCreatingOrder] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);
  const [refetchTrigger, setRefetchTrigger] = useState(0);
  // WO form state
  const [woScope, setWoScope] = useState('');
  const [woValue, setWoValue] = useState(0);
  const [woDate, setWoDate] = useState(new Date().toISOString().split('T')[0]);
  // PO form state
  const [poDesc, setPoDesc] = useState('');
  const [poValue, setPoValue] = useState(0);
  const [poDate, setPoDate] = useState(new Date().toISOString().split('T')[0]);
  const [poGstRate, setPoGstRate] = useState(18);

  // ── Client receipt smart suggestion state ────────────────────────────────
  const [dismissedReceiptSuggestion, setDismissedReceiptSuggestion] = useState(false);
  const [dismissedMilestoneSuggestion, setDismissedMilestoneSuggestion] = useState(false);
  const [receiptDescription, setReceiptDescription] = useState('');
  const [receiptRef, setReceiptRef] = useState('');

  // ── AI cost-code suggestion state ────────────────────────────────────────
  const [aiCodeState, setAiCodeState] = useState<'idle' | 'loading' | 'suggested' | 'none'>('idle');
  const [aiSuggestedCode, setAiSuggestedCode] = useState<string | null>(null);
  const aiDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── High-volume state ────────────────────────────────────────────────────
  const [recentPayees, setRecentPayees] = useState<{ id: string; name: string; type: string }[]>([]);
  const [saveAttempted, setSaveAttempted] = useState(false);
  const { show: showSnackbar } = useSnackbar();
  const orgId = useOrgId();
  const payeeRef = useRef<HTMLInputElement>(null);
  const stkDropRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Focus the amount field when a type is selected (or pre-selected on mount) — amount first.
    if (txnType) setTimeout(() => document.getElementById('txn-amount-input')?.focus(), 60);
  }, [txnType]);

  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (stkDropRef.current && !stkDropRef.current.contains(e.target as Node)) setShowSug(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); handleSave('exit'); }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  });

  // ── Queries ──────────────────────────────────────────────────────────────
  const { data: stakeholders } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => { const { data } = await supabase.from('stakeholders').select('*'); return data as Stakeholder[]; },
  });
  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => { const { data } = await supabase.from('projects').select('*'); return data as Project[]; },
  });

  useEffect(() => {
    if (stakeholders && stakeholders.length > 0 && recentPayees.length === 0) {
      const initialRecents = stakeholders.slice(0, 10).map((s) => ({
        id: s.stakeholder_id,
        name: s.name,
        type: s.type,
      }));
      setRecentPayees(initialRecents);
    }
  }, [stakeholders, recentPayees.length]);
  // Fetch WOs for workers, POs for vendors — scoped to the selected project + stakeholder
  const selectedProjectId = !splitMode ? (allocs[0]?.project_id || '') : '';
  // Filtered from the payee's prefetched orders — no round-trip when the project changes.
  const projectWOs = selectedProjectId ? stkWOs.filter((w: any) => w.project_id === selectedProjectId) : [];
  const projectPOs = selectedProjectId ? stkPOs.filter((p: any) => p.project_id === selectedProjectId) : [];
  // Fresh link decision whenever the project, payee or type changes.
  useEffect(() => { setLinkOpen(false); setSkipped(false); setSelectedObligation(null); }, [selectedProjectId, stkId, txnType]);
  // Prefetch ALL of the payee's open orders the moment they're picked — keyed on the payee
  // (not the project), so the data is already in hand by the time a project is chosen and
  // linking is instant. projectWOs/POs filter this locally.
  useEffect(() => {
    if (!stkId || (txnType !== 'worker' && txnType !== 'material')) {
      setStkWOs([]); setStkPOs([]);
      return;
    }
    let cancelled = false;
    setLoadingObligations(true);

    if (txnType === 'worker') {
      supabase
        .from('work_orders')
        .select('wo_id, project_id, scope_of_work, order_value, status, stakeholders(name, category), wo_milestones(*)')
        .eq('stakeholder_id', stkId)
        .not('status', 'in', '("Closed","Cancelled")')
        .order('created_at', { ascending: false })
        .then(({ data: wos, error }) => {
          if (cancelled) return;
          if (error) console.error('[obligations] WO prefetch error:', error);
          setStkWOs(wos || []); setStkPOs([]); setLoadingObligations(false);
          if (createdOrderId && wos) {
            const match = wos.find((w: any) => w.wo_id === createdOrderId);
            if (match) {
              const bal = getWOBalance(match);
              setSelectedObligation({ type: 'WO', wo_id: match.wo_id, label: `${match.wo_id} · ${(match.stakeholders as any)?.name || ''}`, balance: bal });
              if (!amountTouched) setTotalAmt(bal);
              setCreatedOrderId(null);
            }
          }
        });
    } else {
      supabase
        .from('purchase_orders')
        .select('po_id, project_id, status, vendor_bill_amount, total_value, order_value, stakeholders(name, category), po_line_items(*)')
        .eq('stakeholder_id', stkId)
        .order('created_at', { ascending: false })
        .then(({ data: pos, error }) => {
          if (cancelled) return;
          if (error) console.error('[obligations] PO prefetch error:', error);
          setStkWOs([]); setStkPOs(pos || []); setLoadingObligations(false);
          if (createdOrderId && pos) {
            const match = pos.find((p: any) => p.po_id === createdOrderId);
            if (match) {
              const bal = getPOBalance(match);
              setSelectedObligation({ type: 'PO', po_id: match.po_id, label: `${match.po_id} · ${(match.stakeholders as any)?.name || ''}`, balance: bal });
              if (!amountTouched) setTotalAmt(bal);
              setCreatedOrderId(null);
            }
          }
        });
    }
    return () => { cancelled = true; };
  }, [stkId, txnType, refetchTrigger]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Derived ──────────────────────────────────────────────────────────────
  const tgtType = txnType === 'worker' ? 'Worker' : txnType === 'material' ? 'Vendor' : txnType === 'client_receipt' ? 'Client' : '';
  const filtStk = (stakeholders || []).filter(
    (s) => (tgtType ? s.type === tgtType : true) && s.name.toLowerCase().includes(stkSearch.toLowerCase())
  );
  const selName = stakeholders?.find((s) => s.stakeholder_id === stkId)?.name || '';
  const filteredRecents = recentPayees.filter((p) => !tgtType || p.type === tgtType);

  const effectiveAllocs = splitMode ? allocs : [{ ...allocs[0], allocated_amount: totalAmt }];
  const totalAlloc = effectiveAllocs.reduce((s, a) => s + (Number(a.allocated_amount) || 0), 0);
  const remaining = Number(totalAmt) - totalAlloc;
  const isOver = splitMode && remaining < 0;
  const isFullyAllocated = splitMode && remaining === 0 && totalAmt > 0;

  // ── Mutations ────────────────────────────────────────────────────────────
  const createStakeholder = useMutation({
    mutationFn: async (fd: FormData) => {
      const type = txnType === 'worker' ? 'Worker' : 'Vendor';
      const firstName = (fd.get('first_name') as string || '').trim();
      const lastName = (fd.get('last_name') as string || '').trim();
      const fullName = lastName ? `${firstName} ${lastName}` : firstName;
      const ns = {
        stakeholder_id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
        name: fullName,
        type,
        category: newStkTrade === OTHER_TRADE ? (newStkTradeOther.trim() || 'Other') : (newStkTrade || 'General'),
        contact: fd.get('contact') as string,
        org_id: orgId,
      };
      const { data, error } = await supabase.from('stakeholders').insert([ns]).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['stakeholders'] });
      setStkId(d.stakeholder_id); setStkSearch(d.name);
      setShowCreate(false); setShowSug(false);
      setNewStkTrade(''); setNewStkTradeOther('');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to save stakeholder', { type: 'error' }),
  });

  const createTxn = useMutation({
    mutationFn: async ({ saveMode }: { saveMode: 'new' | 'exit' }) => {
      const isClientReceipt = txnType === 'client_receipt';
      let bill_doc_url: string | null = null;
      if (billFile) {
        const ext = billFile.name.split('.').pop();
        const filename = `${txnId}-${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage.from('documents').upload(`bills/${filename}`, billFile);
        if (uploadError) throw uploadError;
        const { data: pubData } = supabase.storage.from('documents').getPublicUrl(`bills/${filename}`);
        bill_doc_url = pubData.publicUrl;
      }
      // Proof of payment is a SEPARATE document from the bill — its own upload + column.
      let proof_document_url: string | null = null;
      if (proofFile) {
        const ext = proofFile.name.split('.').pop();
        const filename = `${txnId}-proof-${Date.now()}.${ext}`;
        const { error: proofErr } = await supabase.storage.from('documents').upload(`proofs/${filename}`, proofFile);
        if (proofErr) throw proofErr;
        const { data: proofPub } = supabase.storage.from('documents').getPublicUrl(`proofs/${filename}`);
        proof_document_url = proofPub.publicUrl;
      }
      // A general expense always files under a head — default to GEN-99 if none chosen.
      let effectiveCategory = isClientReceipt ? 'CLIENT-RECEIPT' : (category || (txnType === 'expense' ? GEN_FALLBACK : category));
      let effectiveRemarks = '';

      if (isClientReceipt) {
        effectiveRemarks = receiptDescription.trim() || (receiptRef.trim() ? `Ref: ${receiptRef.trim()}` : '');
      } else {
        let prefix = '';
        if (selectedObligation) {
          if (selectedObligation.type === 'WO_PHASE') {
            const wo = projectWOs.find((w: any) => w.wo_id === selectedObligation.wo_id);
            const phase = wo?.wo_milestones?.find((m: any) => m.milestone_id === selectedObligation.phase_id);
            const phaseName = phase?.name || selectedObligation.phase_id;
            prefix = `[${selectedObligation.wo_id} - ${phaseName}]`;
          } else if (selectedObligation.type === 'WO') {
            prefix = `[${selectedObligation.wo_id}]`;
          } else if (selectedObligation.type === 'PO') {
            prefix = `[${selectedObligation.po_id}]`;
          }
        }

        const baseRemarks = (remarks || '').trim();
        if (baseRemarks) {
          effectiveRemarks = prefix ? `${prefix} - ${baseRemarks}` : baseRemarks;
        } else {
          effectiveRemarks = prefix ? prefix : '';
        }
      }

      if (selectedObligation?.type === 'PO') {
        const selPO = projectPOs.find((p: any) => p.po_id === selectedObligation.po_id);
        if (selPO && !Number(selPO.vendor_bill_amount)) {
          effectiveCategory = 'PO Advance';
          if (!effectiveRemarks.includes('[PO Advance]')) {
            effectiveRemarks = `[PO Advance] ${effectiveRemarks}`.trim();
          }
        }
      }
      // SPLIT MODE → each project becomes its OWN transaction (separate ledger
      // entries), created atomically via insert_split_transactions. Shared party/
      // date/mode/bill/remarks; the amount is divided per row, and each row carries
      // its own WO/PO + milestone link.
      if (splitMode && !isClientReceipt) {
        const base = {
          stakeholder_id: stkId || null, date, payment_mode: mode,
          category: effectiveCategory, remarks: effectiveRemarks, bill_doc_url, proof_document_url,
          ai_flag_status: 'Clean', ai_flag_data: {}, org_id: orgId,
        };
        const baseTs = Date.now();
        const rnd = Math.random().toString(36).slice(2, 5).toUpperCase();
        const splits = effectiveAllocs.map((a, i) => ({
          // distinct id per split (baseTs+i) + a shared random suffix → globally collision-proof
          txn_id: `TXN-${new Date().getFullYear()}-${String(baseTs + i).slice(-6)}-${rnd}`,
          total_amount: a.allocated_amount,
          project_id: a.project_id,
          order_type: a.order_type || null,
          order_ref: a.order_ref || null,
          milestone_id: a.milestone_id || null,
        }));
        const { error: splitErr } = await supabase.rpc('insert_split_transactions', { p_base: base, p_splits: splits });
        if (splitErr) throw splitErr;
        return { savedId: splits[0]?.txn_id ?? txnId, saveMode, autoCloseWoId: null as string | null };
      }

      const payload = {
        txn_id: txnId, stakeholder_id: stkId || null, date, total_amount: totalAmt,
        payment_mode: mode,
        category: effectiveCategory,
        remarks: effectiveRemarks, bill_doc_url, proof_document_url,
        ai_flag_status: 'Clean',
        ai_flag_data: {},
        org_id: orgId,
      };
      const mapped = effectiveAllocs.map((a) => {
        if (isClientReceipt) {
          return { project_id: a.project_id, order_type: null, order_ref: null, milestone_id: null, allocated_amount: a.allocated_amount };
        }
        let order_type: string | null = null, order_ref: string | null = null, milestone_id: string | null = null;
        if (selectedObligation?.type === 'WO' || selectedObligation?.type === 'WO_PHASE') {
          order_type = 'WO'; order_ref = selectedObligation.wo_id || null; milestone_id = selectedObligation.phase_id || null;
        } else if (selectedObligation?.type === 'PO') {
          order_type = 'PO'; order_ref = selectedObligation.po_id || null;
        }
        return { project_id: a.project_id, order_type, order_ref, milestone_id, allocated_amount: a.allocated_amount };
      });
      const { error } = await supabase.rpc('insert_transaction_with_allocations', { p_txn: payload, p_allocations: mapped });
      if (error) throw error;
      // Link hub: "one-time payment/purchase" → mark the txn so the ledger shows it as a
      // settled one-time (not the "link / one-time" nudge). The insert RPC doesn't carry
      // this column, so set it directly. Best-effort: a missing is_one_time column
      // (migration 20260623000000 not yet applied) must NOT fail the save.
      if (skipped && (txnType === 'worker' || txnType === 'material')) {
        await supabase.from('transactions').update({ is_one_time: true }).eq('txn_id', txnId);
      }
      const autoCloseWoId = (selectedObligation?.type === 'WO' || selectedObligation?.type === 'WO_PHASE')
        ? (selectedObligation.wo_id ?? null) : null;
      return { savedId: txnId, saveMode, autoCloseWoId };
    },
    onSuccess: ({ savedId, saveMode, autoCloseWoId }) => {
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['po_payment_totals'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      if (autoCloseWoId) autoCloseWOIfFullyPaid(autoCloseWoId, qc);
      const stk = stakeholders?.find((s) => s.stakeholder_id === stkId);
      if (stk) setRecentPayees((prev) => [{ id: stk.stakeholder_id, name: stk.name, type: stk.type }, ...prev.filter((p) => p.id !== stk.stakeholder_id)].slice(0, 5));
      if (saveMode === 'exit') {
        navigate(initialProjectId ? `/projects/${initialProjectId}/transactions` : '/ledger');
      } else {
        const keptProject = allocs[0]?.project_id || '';
        setTxnId(genTxnId()); setStkId(''); setStkSearch(''); setShowSug(false); setShowCreate(false);
        setNewStkTrade(''); setNewStkTradeOther('');
        setTotalAmt(0); setCategory(''); setRemarks(''); setBillFile(null); setProofFile(null);
        setSaveAttempted(false); setSplitMode(false);
        setDate(new Date().toISOString().split('T')[0]);
        setAllocs([{ id: Math.random().toString(), project_id: keptProject, order_type: '', order_ref: '', milestone_id: '', allocated_amount: 0 }]);
        setSelectedObligation(null); setSkipped(false); setAmountTouched(false);
        setRefetchTrigger((n) => n + 1); // re-prefetch the payee's orders with updated balances
        setAiCodeState('idle'); setAiSuggestedCode(null);
        setDismissedReceiptSuggestion(false);
        setDismissedMilestoneSuggestion(false);
        setReceiptDescription('');
        setReceiptRef('');
        showSnackbar(`${savedId} saved`, { action: { label: 'View', onClick: () => navigate(`/ledger/${savedId}`) } });
        setTimeout(() => document.getElementById('txn-amount-input')?.focus(), 80);
      }
    },
  });

  const addAlloc = () => setAllocs((prev) => [...prev, { id: Math.random().toString(), project_id: '', order_type: '', order_ref: '', milestone_id: '', allocated_amount: 0 }]);
  const rmAlloc = (id: string) => setAllocs((prev) => prev.filter((a) => a.id !== id));
  const upAlloc = (id: string, updates: Partial<AllocDraft>) => setAllocs((prev) => prev.map((a) => (a.id === id ? { ...a, ...updates } : a)));

  // ── Drawer helpers ────────────────────────────────────────────────────────
  const openDrawer = (type: 'WO' | 'PO') => {
    setDrawerOpen(type);
    setCelebrating(false);
    setCreatedOrderId(null);
    // Pre-populate values from parent transaction
    if (type === 'WO') {
      setWoScope('');
      setWoValue(totalAmt || 0);
      setWoDate(date);
    } else {
      setPoDesc('');
      setPoValue(totalAmt || 0);
      setPoDate(date);
      setPoGstRate(18);
    }
  };

  const closeDrawer = () => {
    setDrawerOpen(null);
    setCelebrating(false);
  };

  const handleCreateWO = async () => {
    if (!woScope.trim() || !woValue || woValue <= 0) {
      showSnackbar('Please fill in scope and order value', { type: 'error' }); return;
    }
    const pid = selectedProjectId;
    const sid = stkId;
    if (!pid || !sid) {
      showSnackbar('Select a project and worker first', { type: 'error' }); return;
    }
    setCreatingOrder(true);
    try {
      const { data, error } = await supabase.rpc('create_work_order', {
        p_org_id:         orgId,
        p_project_id:     pid,
        p_stakeholder_id: sid,
        p_scope:          woScope.trim(),
        p_order_value:    woValue,
        p_date_issued:    woDate,
        p_source:         'manual',
        p_milestones:     [{ seq_no: 1, name: 'Full Payment', unit_type: 'LS', quantity: 1, rate: null, planned_amount: woValue, ai_extracted: false }],
      });
      if (error) throw error;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to create contract');
      const newId = data.wo_id as string;
      setCelebrating(true);
      setCreatedOrderId(newId);
      setTimeout(() => {
        setDrawerOpen(null);
        setCelebrating(false);
        setRefetchTrigger(t => t + 1);
      }, 1900);
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to create contract', { type: 'error' });
    } finally {
      setCreatingOrder(false);
    }
  };

  const handleCreatePO = async () => {
    if (!poDesc.trim() || !poValue || poValue <= 0) {
      showSnackbar('Please fill in description and order value', { type: 'error' }); return;
    }
    const pid = selectedProjectId;
    const sid = stkId;
    if (!pid || !sid) {
      showSnackbar('Select a project and vendor first', { type: 'error' }); return;
    }
    setCreatingOrder(true);
    try {
      const taxable = poValue / (1 + poGstRate / 100);
      const totalGST = poValue - taxable;
      const cgst = totalGST / 2;
      const sgst = totalGST / 2;
      const poData = {
        org_id:             orgId,
        project_id:         pid,
        stakeholder_id:     sid,
        items:              [{ description: poDesc.trim(), qty: 1, unit: 'LS', rate: taxable, amount: taxable }],
        order_value:        taxable,
        total_value:        poValue,
        gst_value:          totalGST,
        status:             'ORDERED',
        date_issued:        poDate,
        expected_delivery:  null,
        delivery_location:  null,
        payment_terms_days: 30,
        ordered_by:         null,
        vendor_notes:       null,
        internal_notes:     null,
      };
      const lineItemRows = [{
        line_number:      1,
        category_id:      null,
        item_name:        poDesc.trim(),
        specification:    null,
        unit:             'LS',
        quantity_ordered: 1,
        unit_rate:        taxable,
        basic_amount:     taxable,
        discount_percent: 0,
        discount_amount:  0,
        gst_rate:         poGstRate,
        cgst:             cgst,
        sgst:             sgst,
        igst:             0,
        total_amount:     poValue,
      }];
      const { data, error: rpcError } = await supabase.rpc('create_purchase_order', { p_po_data: poData, p_line_items: lineItemRows });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to create purchase order');
      const newId = data.po_id as string;
      setCelebrating(true);
      setCreatedOrderId(newId);
      setTimeout(() => {
        setDrawerOpen(null);
        setCelebrating(false);
        setRefetchTrigger(t => t + 1);
      }, 1900);
    } catch (err: any) {
      showSnackbar(err.message || 'Failed to create purchase order', { type: 'error' });
    } finally {
      setCreatingOrder(false);
    }
  };

  const suggestCostCode = async (text: string) => {
    if (!text || text.trim().length < 5) { setAiCodeState('idle'); return; }
    // General expenses classify against the GEN heads only; everything else against
    // the full MAT/WRK chart of accounts.
    const isExpense = txnType === 'expense';
    setAiCodeState('loading');
    setAiSuggestedCode(null);
    try {
      const { data, error } = await supabase.functions.invoke('sku-matcher', {
        body: {
          action:     'suggestCostCode',
          remark:     text.trim(),
          cost_codes: (isExpense ? GEN_HEADS : ALL_COST_CODES).map(c => ({ code: c.code, name: c.name })),
        },
      });
      if (error) throw error;
      let result = String((data as any)?.code || 'NONE').toUpperCase();
      // a general expense always lands on a head — fall back to GEN-99 on a miss
      if (isExpense && (result === 'NONE' || !getCostCode(result))) result = GEN_FALLBACK;
      if (result === 'NONE' || !getCostCode(result)) {
        setAiSuggestedCode(null);
        setAiCodeState('none');
      } else {
        setCategory(result);
        setAiSuggestedCode(result);
        setAiCodeState('suggested');
      }
    } catch {
      setAiCodeState('idle');
    }
  };

  const handleSave = async (saveMode: 'new' | 'exit') => {
    setSaveAttempted(true);

    // Jump the owner to the first still-missing required field (visual order:
    // payee → amount → project → note) instead of a silent no-op on submit.
    const firstMissing: HTMLElement | null = (() => {
      if (txnType !== 'expense' && !stkId) return payeeRef.current;
      if (!totalAmt || totalAmt <= 0) return document.getElementById('txn-amount-input');
      if (effectiveAllocs.some((a) => !a.project_id)) return document.getElementById('txn-project-0');
      if (txnType !== 'client_receipt' && !remarks.trim()) return document.getElementById('txn-remarks');
      return null;
    })();
    if (firstMissing) {
      // Focus synchronously (within the click) so the cursor activates on mobile, then scroll
      // it to the top of the frame on mobile so it clears the keyboard.
      firstMissing.focus({ preventScroll: true });
      firstMissing.scrollIntoView({ behavior: 'smooth', block: window.innerWidth < 640 ? 'start' : 'center' });
      return;
    }

    if (txnType === 'client_receipt') {
      if (!stkId || !totalAmt || totalAmt <= 0) return;
      if (effectiveAllocs.some((a) => !a.project_id)) return;
      createTxn.mutate({ saveMode });
      return;
    }
    // General expenses carry no payee — only amount/remarks/project are mandatory.
    const payeeRequired = txnType !== 'expense';
    if ((payeeRequired && !stkId) || !totalAmt || totalAmt <= 0 || !remarks.trim() || isOver) return;
    if (effectiveAllocs.some((a) => !a.project_id)) return;
    if (splitMode && remaining !== 0) return;   // splits must sum EXACTLY to the total

    // Bug 6: WO linked at header level but has phases — user must select a specific phase
    if (selectedObligation?.type === 'WO') {
      const wo = projectWOs.find((w: any) => w.wo_id === selectedObligation.wo_id);
      if ((wo?.wo_milestones?.length || 0) > 0) return;
    }

    // Budget check — only for single-allocation with a cost code
    if (!splitMode && category && allocs[0]?.project_id) {
      const pid = allocs[0].project_id;
      const { data: budgetLine } = await supabase
        .from('project_budgets')
        .select('planned_amount')
        .eq('project_id', pid)
        .eq('cost_code', category)
        .maybeSingle();

      if (budgetLine?.planned_amount) {
        const { data: allocData } = await supabase
          .from('txn_allocations')
          .select('allocated_amount, transactions(status, category)')
          .eq('project_id', pid);
        const currentSpent = (allocData || [])
          .filter((a: any) => a.transactions?.status === 'Active' && a.transactions?.category === category)
          .reduce((s: number, a: any) => s + Number(a.allocated_amount), 0);
        const newTotal = currentSpent + totalAmt;
        if (newTotal > Number(budgetLine.planned_amount)) {
            const ccFound = getCostCode(category);
          setBudgetWarning({
            code: category,
            codeName: ccFound ? `${category} · ${ccFound.item.name}` : category,
            planned: Number(budgetLine.planned_amount),
            currentSpent,
            newTotal,
            overBy: newTotal - Number(budgetLine.planned_amount),
          });
          setPendingSaveMode(saveMode);
          return;
        }
      }
    }

    createTxn.mutate({ saveMode });
  };

  const missingPayee = saveAttempted && !stkId && txnType !== 'expense';
  const missingAmount = saveAttempted && totalAmt <= 0;
  const missingRemarks = saveAttempted && !remarks.trim() && txnType !== 'client_receipt';
  const missingProject = saveAttempted && effectiveAllocs.some((a) => !a.project_id);

  // Smart CTA: the next still-empty MANDATORY field, in form order. While a gap remains the
  // primary button names it ("Enter the amount" → jumps & focuses it); once none remain it
  // becomes "Save & exit". Optional fields (proof, and the note on receipts) never block.
  const nextGap: { label: string; el: () => HTMLElement | null } | null = !txnType ? null : (() => {
    if (!totalAmt || totalAmt <= 0) return { label: 'Enter the amount', el: () => document.getElementById('txn-amount-input') };
    if (txnType !== 'expense' && !stkId) return { label: txnType === 'client_receipt' ? 'Who is paying?' : 'Add the payee', el: () => payeeRef.current };
    if (txnType !== 'client_receipt' && !remarks.trim()) return { label: 'Add a remark', el: () => document.getElementById('txn-remarks') };
    if (effectiveAllocs.some((a) => !a.project_id)) return { label: 'Choose a project', el: () => document.getElementById('txn-project-0') };
    return null;
  })();
  // Focus SYNCHRONOUSLY inside the tap so the cursor/keyboard activates on mobile (a deferred
  // focus() loses the gesture). On mobile we DON'T preventScroll — that would disable the
  // browser's native "scroll the focused input above the keyboard" behaviour, which is the
  // most reliable mechanism. We then snap it to the top of the frame once the keyboard has
  // actually opened (visualViewport 'resize') plus timeout fallbacks, since smooth scrolls
  // get cancelled by that relayout. Desktop just centers.
  const bringIntoFrame = (el: HTMLElement | null) => {
    if (!el) return;
    if (window.innerWidth < 640) {
      // Mobile: let the browser's native focus-scroll place the field above the keyboard at
      // the right height. A manual scrollIntoView({block:'start'}) snap over-scrolled it to
      // the top (~15% too high), so we don't fight it.
      el.focus();
      return;
    }
    el.focus({ preventScroll: true });
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };
  const fieldEl = (k: 'amount' | 'payee' | 'remark' | 'project'): HTMLElement | null =>
    k === 'amount' ? document.getElementById('txn-amount-input')
      : k === 'payee' ? payeeRef.current
      : k === 'remark' ? document.getElementById('txn-remarks')
      : document.getElementById('txn-project-0');
  const goToGap = () => { setSaveAttempted(true); bringIntoFrame(nextGap?.el() ?? null); };

  // Called after a field is completed (esp. a dropdown pick) — jump to the first still-empty
  // mandatory field, cursor active, in the frame. Computed from CURRENT state synchronously
  // (treating `justFilled` as done, since its setState hasn't flushed yet) so the gesture
  // carries through and the keyboard opens on the next field.
  const advanceAfter = (justFilled: 'amount' | 'payee' | 'remark' | 'project') => {
    const empty: Record<string, boolean> = {
      amount: !totalAmt || totalAmt <= 0,
      payee: txnType !== 'expense' && !stkId,
      remark: txnType !== 'client_receipt' && !remarks.trim(),
      project: effectiveAllocs.some((a) => !a.project_id),
    };
    for (const k of ['amount', 'payee', 'remark', 'project'] as const) {
      if (k !== justFilled && empty[k]) { bringIntoFrame(fieldEl(k)); return; }
    }
  };

  const needsPhaseSelection = !!(
    selectedObligation?.type === 'WO' &&
    (projectWOs.find((w: any) => w.wo_id === selectedObligation.wo_id)?.wo_milestones?.length || 0) > 0
  );

  // ── Smart suggestion: completed phase linked ─────────────────────────────
  const completedMilestoneLinked = !dismissedMilestoneSuggestion &&
    (txnType === 'worker' || txnType === 'material') &&
    selectedObligation?.type === 'WO_PHASE' &&
    (() => {
      const wo = projectWOs.find(w => w.wo_id === selectedObligation?.wo_id);
      const phase = wo?.wo_milestones?.find((m: any) => m.milestone_id === selectedObligation?.phase_id);
      return phase?.status === 'Completed' || phase?.status === 'Approved';
    })();


  const handleRaiseBillFromReceiptNav = () => {
    navigate('/billing/new', {
      state: {
        clientId: stkId,
        amount: totalAmt,
        projectId: allocs[0]?.project_id || '',
        date,
      },
    });
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen txn-new-page" style={{ background: VOICE.page }}>
      {/* On mobile, < 16px inputs make iOS zoom-and-jump on focus — pin them to 16px here. */}
      <style>{`@media (max-width: 640px){ .txn-new-page input:not(#txn-amount-input), .txn-new-page select, .txn-new-page textarea{ font-size:16px } }
        .txn-new-page input, .txn-new-page textarea, .txn-new-page select, #txn-project-0, #txn-amount-input { scroll-margin-top: 84px; scroll-margin-bottom: 150px; }`}</style>
      <div className="mx-auto px-4 pt-8 pb-36" style={{ maxWidth: 720 }}>

        {/* ── Header — voice restyle (back + copy handlers unchanged) ──────── */}
        <div className="flex items-center gap-3 mb-8">
          <button
            onClick={() => navigate(initialProjectId ? `/projects/${initialProjectId}/transactions` : '/ledger')}
            className="p-2 -ml-2 rounded-xl transition-colors shrink-0"
            style={{ color: VOICE.user }}
            aria-label="Back"
          >
            <span className="material-symbols-outlined">arrow_back</span>
          </button>
          <h1 className="text-xl font-medium flex-1 tracking-tight" style={{ color: VOICE.user }}>New transaction</h1>
          <div className="flex flex-col items-end gap-1.5">
            <span className="text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1.5" style={{ background: VOICE.field, color: VOICE.system, ...VNUMS }}>
              {txnId}
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(txnId);
                  setTxnIdCopied(true);
                  setTimeout(() => setTxnIdCopied(false), 2000);
                }}
                className="flex items-center shrink-0"
                style={{ color: VOICE.systemFaint }}
                title="Copy Transaction ID"
                aria-label="Copy transaction number"
              >
                <span className="material-symbols-outlined text-[13px]">
                  {txnIdCopied ? 'check' : 'content_copy'}
                </span>
              </button>
              {txnIdCopied && (
                <span className="text-[9px] font-bold uppercase tracking-wider" style={{ color: VOICE.confirm }}>Copied</span>
              )}
            </span>
            {/* Date — moved here next to the ref; today by default, tap the pencil to change */}
            <label className="relative text-xs px-2.5 py-1 rounded-full inline-flex items-center gap-1.5 cursor-pointer" style={{ background: VOICE.field, color: VOICE.system }}>
              <span className="material-symbols-outlined text-[13px]" style={{ color: VOICE.systemFaint }}>calendar_today</span>
              <span style={{ ...VNUMS }}>{fmtDateShort(date)}</span>
              <span className="material-symbols-outlined text-[12px]" style={{ color: VOICE.systemFaint }}>edit</span>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className="absolute inset-0 opacity-0 cursor-pointer" aria-label="Transaction date" />
            </label>
          </div>
        </div>

        {/* ── Type selector — collapses to a compact chip once chosen (frees space on mobile) ── */}
        {txnType && !pickingType ? (() => {
          const sel = TXN_TYPES.find((t) => t.key === txnType)!;
          const acc = sel.dir === 'in' ? VOICE.innSoft : VOICE.accentSoft;
          return (
            <div className="flex items-center justify-between gap-2 mb-6 rounded-xl px-3.5 py-2.5" style={{ background: VOICE.walnut }}>
              <span className="inline-flex items-center gap-2 min-w-0">
                <span className="material-symbols-outlined text-[18px] shrink-0" style={{ color: acc, fontVariationSettings: "'FILL' 1" }}>{sel.icon}</span>
                <span className="text-sm font-medium truncate" style={{ color: VOICE.ivory }}>{sel.label}</span>
                <span className="text-[11px] inline-flex items-center gap-0.5 shrink-0" style={{ color: acc }}>
                  <span className="material-symbols-outlined text-[12px]">{sel.dir === 'in' ? 'south_west' : 'north_east'}</span>
                  {sel.dir === 'in' ? 'in' : 'out'}
                </span>
              </span>
              <button type="button" onClick={() => setPickingType(true)} className="text-xs font-semibold shrink-0 px-2.5 py-1 rounded-lg" style={{ color: VOICE.ivory, background: 'rgba(243,234,219,.12)' }}>Change</button>
            </div>
          );
        })() : (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-8">
            {TXN_TYPES.map((t) => {
              const isSelected = txnType === t.key;
              const accentSoft = t.dir === 'in' ? VOICE.innSoft : VOICE.accentSoft;
              return (
                <button
                  key={t.key}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => {
                    setPickingType(false);
                    if (txnType !== t.key) {
                      setTxnType(t.key); setStkId(''); setStkSearch('');
                      setCategory(''); setSaveAttempted(false);
                      setNewStkTrade(''); setNewStkTradeOther('');
                      setDismissedReceiptSuggestion(false);
                      setDismissedMilestoneSuggestion(false);
                    }
                  }}
                  className="rounded-xl px-3 py-2.5 sm:py-3 text-left transition-transform active:scale-[0.98] relative"
                  style={isSelected
                    ? { background: VOICE.walnut, border: `1.5px solid ${VOICE.walnut}`, boxShadow: '0 14px 30px -18px rgba(34,26,19,.6)' }
                    : { background: VOICE.surface, border: `1px solid ${VOICE.line}` }}
                >
                  {isSelected && <span className="absolute top-2.5 right-2.5 w-[7px] h-[7px] rounded-full" style={{ background: accentSoft }} />}
                  <span className="material-symbols-outlined text-[18px]" style={{ color: isSelected ? accentSoft : VOICE.systemFaint, fontVariationSettings: isSelected ? "'FILL' 1" : "'FILL' 0" }}>{t.icon}</span>
                  <p className="text-[13px] sm:text-sm font-medium mt-1 leading-tight" style={{ color: isSelected ? VOICE.ivory : VOICE.user }}>{t.label}</p>
                  <p className="text-[11px] mt-0.5 inline-flex items-center gap-1" style={{ color: isSelected ? accentSoft : VOICE.systemFaint }}>
                    <span className="material-symbols-outlined text-[12px]">{t.dir === 'in' ? 'south_west' : 'north_east'}</span>
                    money {t.dir === 'in' ? 'in' : 'out'}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* ── Empty state ─────────────────────────────────────────────────── */}
        {!txnType && (
          <div className="text-center py-20">
            <span className="material-symbols-outlined text-[64px] text-on-surface-variant/15 block mb-4">touch_app</span>
            <p className="text-body-md text-on-surface-variant/40">Select a type above to begin</p>
          </div>
        )}

        {/* ── Form ────────────────────────────────────────────────────────── */}
        {txnType && (
          <div className="space-y-8">

            {/* Hero Amount — dark walnut "ledger" card (signature element) */}
            <style>{`
              #txn-amount-input::placeholder{color:rgba(243,234,219,.26)}
              #txn-amount-input::-webkit-outer-spin-button,#txn-amount-input::-webkit-inner-spin-button{-webkit-appearance:none;margin:0}
              #txn-amount-input{-moz-appearance:textfield}
            `}</style>
            <div
              className="relative overflow-hidden mb-2"
              onClick={() => document.getElementById('txn-amount-input')?.focus()}
              style={{
                borderRadius: 24, padding: '28px 26px 24px', cursor: 'text',
                background: txnType === 'client_receipt'
                  ? 'radial-gradient(120% 120% at 85% 0%, rgba(156,187,145,.16) 0%, rgba(156,187,145,0) 42%), linear-gradient(158deg,#232619 0%,#1c2014 60%,#161a0f 100%)'
                  : 'radial-gradient(120% 120% at 85% 0%, rgba(224,138,92,.14) 0%, rgba(224,138,92,0) 42%), linear-gradient(158deg,#2D2118 0%,#221A13 60%,#1B140E 100%)',
                boxShadow: '0 26px 50px -28px rgba(34,26,19,.7), inset 0 0 0 1px rgba(243,234,219,.06)',
              }}
            >
              <span className="inline-flex items-center gap-1.5 mb-3.5" style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '1.6px', textTransform: 'uppercase', color: txnType === 'client_receipt' ? VOICE.innSoft : VOICE.accentSoft }}>
                <span className="material-symbols-outlined text-[13px]">{txnType === 'client_receipt' ? 'south_west' : 'north_east'}</span>
                {txnType === 'client_receipt' ? 'Money coming in' : 'Money going out'}
              </span>
              <div className="flex items-baseline gap-1.5 min-w-0">
                <span style={{ fontFamily: VOICE.serif, fontSize: 'clamp(24px, 7vw, 30px)', fontWeight: 600, color: txnType === 'client_receipt' ? VOICE.innSoft : VOICE.accentSoft, flex: '0 0 auto' }}>₹</span>
                <input
                  id="txn-amount-input"
                  type="number"
                  inputMode="decimal"
                  step="0.01"
                  min="0"
                  value={totalAmt || ''}
                  onChange={(e) => { setAmountTouched(true); setTotalAmt(parseFloat(e.target.value) || 0); }}
                  onFocus={(e) => e.target.select()}
                  onClick={(e) => e.stopPropagation()}
                  // Stop the mouse wheel from silently changing the amount while focused.
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="0"
                  aria-label="Amount"
                  // Smooth viewport-based size (NOT digit-count tiers) so it never jumps/shrinks as
                  // you type; a very long amount just scrolls within the input. Baseline-aligned with ₹.
                  style={{
                    fontFamily: VOICE.serif, fontWeight: 600, lineHeight: 1, letterSpacing: '-1.5px',
                    // Mobile floor raised so the figure is as large as desktop (was 15vw → ~54px
                    // on a 360px phone; now ~61px, matching the 64px desktop cap).
                    fontSize: 'clamp(58px, 17vw, 64px)',
                    background: 'transparent', border: 'none', outline: 'none', color: VOICE.ivory,
                    caretColor: txnType === 'client_receipt' ? VOICE.innSoft : VOICE.accentSoft,
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

            {/* ━━ 01 · Payment / Receipt Details ━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div>
              <SectionLabel n="01" title={txnType === 'client_receipt' ? 'Receipt Details' : 'Payment Details'} />
              <div className="bg-white rounded-2xl border border-black/[0.05] shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
                <div className="p-6 space-y-6">

                  {/* Payee / Client */}
                  <div className="relative" ref={stkDropRef}>
                    <h2 className="mb-3" style={{ fontFamily: VOICE.serif, fontSize: 19, fontWeight: 600, letterSpacing: '-0.2px', color: missingPayee ? VOICE.out : VOICE.user }}>
                      {txnType === 'client_receipt' ? "Who's this from?" : 'Who are you paying?'}
                      {txnType !== 'expense' && <span style={{ color: VOICE.out }}> *</span>}
                      {txnType === 'expense' && <span className="ml-1.5" style={{ fontFamily: 'inherit', fontSize: 12, fontWeight: 500, color: VOICE.systemFaint }}>· optional</span>}
                    </h2>

                    <div className="relative">
                      <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[18px] text-on-surface-variant/35 pointer-events-none">search</span>
                      <input
                        ref={payeeRef}
                        type="text"
                        value={stkId ? selName : stkSearch}
                        onChange={(e) => { setStkSearch(e.target.value); if (stkId) setStkId(''); setShowSug(true); setShowCreate(false); }}
                        onFocus={() => setShowSug(true)}
                        placeholder={`Search ${tgtType ? tgtType.toLowerCase() : 'payee'}…`}
                        className={`bk-input pl-10 pr-10 focus:ring-4 focus:ring-primary/5 transition-all duration-200 ${missingPayee ? 'border-error' : 'border-outline-variant/30'}`}
                        autoComplete="new-password"
                      />
                      {stkId && (
                        <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[20px] text-secondary" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                      )}
                    </div>

                    {/* Dropdown */}
                    {showSug && !stkId && (
                      <div className="absolute left-0 right-0 top-full bg-white border border-black/[0.08] rounded-xl mt-1 z-30 shadow-lg max-h-60 overflow-y-auto animate-peek-in">
                        {filteredRecents.length > 0 && !stkSearch && (
                          <>
                            <div className="px-4 pt-3 pb-1 text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest">Recent</div>
                            {filteredRecents.map((p) => (
                              <div key={p.id} onClick={() => { setStkId(p.id); setStkSearch(p.name); setShowSug(false); advanceAfter('payee'); }}
                                className="px-4 py-2.5 hover:bg-surface-container-low/60 cursor-pointer flex items-center gap-3">
                                <span className="material-symbols-outlined text-[14px] text-on-surface-variant/40">history</span>
                                <span className="text-[13px] font-medium text-on-surface">{p.name}</span>
                              </div>
                            ))}
                            <div className="mx-4 border-t border-outline-variant/15 my-1" />
                          </>
                        )}
                        {filtStk.map((s) => (
                          <div key={s.stakeholder_id} onClick={() => { setStkId(s.stakeholder_id); setStkSearch(s.name); setShowSug(false); advanceAfter('payee'); }}
                            className="px-4 py-3 hover:bg-surface-container-low/60 cursor-pointer border-b border-outline-variant/[0.08] last:border-0">
                            <p className="text-[13px] font-semibold text-on-surface">{s.name}</p>
                            <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{s.category}</p>
                          </div>
                        ))}
                        {filtStk.length === 0 && stkSearch ? (
                          /* Zero matches → create is the hero row (one tap to add a brand-new payee) */
                          <div onClick={() => { setShowCreate(true); setShowSug(false); }}
                            className="px-4 py-3 cursor-pointer flex items-center gap-3"
                            style={{ background: VOICE.accentTint }}>
                            <span className="w-9 h-9 rounded-full flex items-center justify-center shrink-0 text-[15px] font-bold" style={{ background: VOICE.out, color: '#fff' }}>
                              {stkSearch.trim()[0]?.toUpperCase() || '+'}
                            </span>
                            <span className="flex-1 min-w-0">
                              <span className="block text-[13px] font-semibold" style={{ color: VOICE.user }}>Create &ldquo;{stkSearch.trim()}&rdquo;</span>
                              <span className="block text-[11px]" style={{ color: VOICE.systemFaint }}>New {tgtType ? tgtType.toLowerCase() : 'payee'} · add trade &amp; phone</span>
                            </span>
                            <span className="material-symbols-outlined text-[18px]" style={{ color: VOICE.out }}>arrow_forward</span>
                          </div>
                        ) : (
                          /* Matches present → quiet add footer */
                          <div onClick={() => { setShowCreate(true); setShowSug(false); }}
                            className="px-4 py-3 cursor-pointer flex items-center gap-2.5 border-t hover:bg-black/[0.02]"
                            style={{ color: VOICE.out, borderColor: VOICE.line }}>
                            <span className="material-symbols-outlined text-[17px]">person_add</span>
                            <span className="text-[13px] font-semibold">Add new {tgtType ? tgtType.toLowerCase() : 'payee'}{stkSearch ? ` "${stkSearch}"` : ''}</span>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Inline quick-add */}
                    {showCreate && !stkId && (
                      <div className="mt-3 border border-black/[0.05] rounded-2xl p-5 bg-surface-container-lowest shadow-[0_4px_20px_rgba(0,0,0,0.01)] animate-peek-in">
                        <p className="text-[12px] font-semibold text-on-surface mb-4">Quick-add {tgtType || 'stakeholder'}</p>
                        <div className="grid grid-cols-2 gap-3 mb-4">
                          <div>
                            <label className="text-[10px] font-semibold text-on-surface-variant/60 block mb-1.5 uppercase tracking-wide">First name</label>
                            <input id="stk_fn" className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200" placeholder="First" defaultValue={stkSearch.split(' ')[0] || ''} autoFocus />
                          </div>
                          <div>
                            <label className="text-[10px] font-semibold text-on-surface-variant/60 block mb-1.5 uppercase tracking-wide">Last name</label>
                            <input id="stk_ln" className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200" placeholder="Last" defaultValue={stkSearch.split(' ').slice(1).join(' ') || ''} />
                          </div>
                        </div>
                        <div className="mb-4">
                          <label className="text-[10px] font-semibold text-on-surface-variant/60 block mb-1.5 uppercase tracking-wide">
                            Trade <span className="text-red-500">*</span>
                          </label>
                          <select className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200" value={newStkTrade} onChange={(e) => { setNewStkTrade(e.target.value); setNewStkTradeOther(''); }}>
                            <option value="" disabled>Select trade…</option>
                            {(txnType === 'worker' ? WORKER_TRADE_GROUPS : VENDOR_TRADE_GROUPS).map((g) => (
                              <optgroup key={g.group} label={g.group}>
                                {g.trades.map((t) => <option key={t} value={t}>{t}</option>)}
                              </optgroup>
                            ))}
                          </select>
                          {newStkTrade === OTHER_TRADE && (
                            <input className="bk-input mt-2 focus:ring-4 focus:ring-primary/5 transition-all duration-200" placeholder="Specify trade…" value={newStkTradeOther} onChange={(e) => setNewStkTradeOther(e.target.value)} autoFocus />
                          )}
                        </div>
                        <div className="mb-5">
                          <label className="text-[10px] font-semibold text-on-surface-variant/60 block mb-1.5 uppercase tracking-wide">Contact (optional)</label>
                          <input id="stk_contact" className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200" placeholder="Phone" />
                        </div>
                        <div className="flex gap-2 justify-end">
                          <button type="button" className="bk-btn-ghost px-4 py-2 rounded-xl text-[13px] border border-outline-variant/30" onClick={() => { setShowCreate(false); setNewStkTrade(''); setNewStkTradeOther(''); }}>Cancel</button>
                          <button
                            type="button"
                            className="bk-btn px-4 py-2 rounded-xl text-[13px] disabled:opacity-50"
                            disabled={
                              !newStkTrade ||
                              (newStkTrade === OTHER_TRADE && !newStkTradeOther.trim()) ||
                              createStakeholder.isPending
                            }
                            onClick={() => { const fd = new FormData(); fd.append('first_name', (document.getElementById('stk_fn') as HTMLInputElement).value); fd.append('last_name', (document.getElementById('stk_ln') as HTMLInputElement).value); fd.append('contact', (document.getElementById('stk_contact') as HTMLInputElement).value); createStakeholder.mutate(fd); }}
                          >
                            {createStakeholder.isPending ? 'Saving…' : 'Save & select'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Client Receipt: Reference + Description fields */}
                  {txnType === 'client_receipt' && (
                    <>
                      <div>
                        <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Reference / UTR <span className="text-on-surface-variant/35">(optional)</span></label>
                        <input
                          type="text"
                          value={receiptRef}
                          onChange={e => setReceiptRef(e.target.value)}
                          className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200"
                          placeholder="UTR / cheque / reference number"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Description <span className="text-on-surface-variant/35">(optional)</span></label>
                        <input
                          type="text"
                          value={receiptDescription}
                          onChange={e => setReceiptDescription(e.target.value)}
                          className="bk-input focus:ring-4 focus:ring-primary/5 transition-all duration-200"
                          placeholder="What this payment is for…"
                        />
                      </div>
                    </>
                  )}

                  {/* Payment mode (date moved to the header next to the txn ref) */}
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Paid via</label>
                    <div className="flex rounded-xl overflow-hidden border" style={{ borderColor: VOICE.line }}>
                      {(['NEFT', 'UPI', 'Cheque', 'Cash'] as PayMode[]).map((m, i) => (
                        <button key={m} type="button" onClick={() => setMode(m)}
                          className="flex-1 py-2.5 text-[12px] font-semibold transition-colors"
                          style={mode === m
                            ? { background: VOICE.walnut, color: VOICE.ivory, borderLeft: i > 0 ? `1px solid ${VOICE.walnut}` : undefined }
                            : { background: VOICE.surface, color: VOICE.system, borderLeft: i > 0 ? `1px solid ${VOICE.line}` : undefined }}>
                          {m}
                        </button>
                      ))}
                    </div>
                  </div>

                </div>
              </div>
            </div>

            {/* ━━ 02 · Categorise (hidden for client_receipt) ━━━━━━━━━━━━━ */}
            {txnType !== 'client_receipt' && <div>
              <SectionLabel n="02" title="Note" />
              <div className="bg-white rounded-2xl border border-black/[0.05] shadow-[0_8px_30px_rgb(0,0,0,0.02)]">
                <div className="p-5 space-y-4">

                  {/* ── COST CODE — removed from the UI per the redesign. The wiring is kept
                       for later: `category` state still saves, CostCodePicker/GenHeadPicker and
                       the AI auto-suggest effect are intact. Flip `false` → `true` to restore. ── */}
                  {false && (
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                      {txnType === 'expense' ? 'Expense Head' : 'Cost Code'} <span className="text-on-surface-variant/35">(optional)</span>
                    </label>
                    {txnType === 'expense' ? (
                      <GenHeadPicker
                        value={category}
                        onChange={(v) => { setCategory(v); setAiCodeState('idle'); setAiSuggestedCode(null); }}
                        error={false}
                      />
                    ) : (
                      <CostCodePicker
                        value={category}
                        onChange={(v) => { setCategory(v); setAiCodeState('idle'); setAiSuggestedCode(null); }}
                        defaultType={COA_DEFAULTS[txnType ?? '']?.type ?? 'MAT'}
                        defaultDivision={COA_DEFAULTS[txnType ?? '']?.division}
                        error={false}
                      />
                    )}

                    {/* AI suggestion chip (auto-applied with Undo) */}
                    {aiCodeState !== 'idle' && (
                      <div className="animate-fadeIn">
                        {aiCodeState === 'loading' && (
                          <div className="mt-2 text-[11px] text-on-surface-variant/40 pl-1 flex items-center gap-2">
                            <Loader2 className="animate-spin shrink-0" size={12} />
                            Analyzing remarks with AI…
                          </div>
                        )}
                        {aiCodeState === 'suggested' && aiSuggestedCode && category === aiSuggestedCode && (
                          <div className="mt-2.5 flex items-center gap-1.5 text-[11px] text-indigo-600 font-semibold pl-1 animate-fadeIn">
                            <span className="material-symbols-outlined text-[13px] animate-pulse" style={{ fontVariationSettings: "'FILL' 1" }}>auto_awesome</span>
                            <span>AI auto-selected cost code: <strong className="font-bold">{costCodeLabel(aiSuggestedCode ?? '')}</strong></span>
                            <button type="button"
                              onClick={() => { setCategory(''); setAiCodeState('idle'); setAiSuggestedCode(null); }}
                              className="ml-2 underline hover:text-indigo-800 transition-colors font-bold shrink-0">
                              Undo
                            </button>
                          </div>
                        )}
                        {aiCodeState === 'none' && (
                          <div className="mt-2 text-[11px] text-on-surface-variant/35 pl-1 flex items-center gap-1.5 animate-fadeIn">
                            <span className="material-symbols-outlined text-[13px]">help_outline</span>
                            No matching cost code found for this remark.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  {/* Remarks — required */}
                  <div>
                    <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">
                      Remarks
                      {missingRemarks
                        ? <span className="text-error ml-1.5">required</span>
                        : <span className="text-on-surface-variant/35 ml-1">(what is this payment for?)</span>}
                    </label>
                    <textarea
                      id="txn-remarks"
                      value={remarks}
                      onChange={(e) => {
                        setRemarks(e.target.value);
                        if (category) return; // already has a code
                        if (aiDebounceRef.current) clearTimeout(aiDebounceRef.current);
                        if (e.target.value.trim().length >= 5) {
                          setAiCodeState('idle');
                          aiDebounceRef.current = setTimeout(() => suggestCostCode(e.target.value), 1000);
                        } else {
                          setAiCodeState('idle');
                          setAiSuggestedCode(null);
                        }
                      }}
                      className={`bk-input w-full min-h-[72px] resize-none focus:ring-4 focus:ring-primary/5 transition-all duration-200 ${missingRemarks ? 'border-error' : 'border-outline-variant/30'}`}
                      placeholder="e.g. Payment for tile fixing in bathroom, 2nd floor…"
                      rows={2}
                    />
                  </div>

                </div>
              </div>
            </div>}

            {/* ━━ 03 · Project Allocation ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            <div>
              <div className="flex items-center gap-2.5 mb-3 ml-0.5">
                <span className="text-[10px] font-bold text-on-surface-variant/40 tabular-nums">03</span>
                <span className="h-px flex-1 bg-outline-variant/20" />
                <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-[0.1em]">Project Allocation</span>
                {splitMode && totalAmt > 0 && txnType !== 'client_receipt' && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ml-1 ${
                    isOver ? 'bg-error-container text-error' :
                    isFullyAllocated ? 'bg-secondary-container text-on-secondary-container' :
                    'bg-surface-container-highest text-on-surface-variant'
                  }`}>
                    {isOver ? `₹${Math.abs(remaining).toLocaleString()} over` : isFullyAllocated ? 'Balanced' : `₹${remaining.toLocaleString()} left`}
                  </span>
                )}
              </div>

              <h2 className="mb-3 ml-0.5" style={{ fontFamily: VOICE.serif, fontSize: 19, fontWeight: 600, letterSpacing: '-0.2px', color: VOICE.user }}>
                Which project is this for?<span style={{ color: VOICE.out }}> *</span>
              </h2>

              {/* Premium Slim Visual progress bar for split mode */}
              {splitMode && totalAmt > 0 && txnType !== 'client_receipt' && (
                <div className="mb-4 bg-white border border-black/[0.05] rounded-2xl p-4 shadow-[0_8px_30px_rgb(0,0,0,0.015)] space-y-2.5">
                  <div className="h-2 w-full bg-black/[0.04] rounded-full overflow-hidden flex shadow-inner">
                    {effectiveAllocs.map((a, i) => {
                      const amt = Number(a.allocated_amount) || 0;
                      const pct = totalAmt > 0 ? (amt / totalAmt) * 100 : 0;
                      const colors = [
                        'bg-[#C45B39]', // Terracotta / Worker
                        'bg-[#006C49]', // Sage / Vendor
                        'bg-[#6366F1]', // Indigo / General
                        'bg-[#0EA5E9]', // Aqua / Client
                        'bg-[#F59E0B]', // Amber
                      ];
                      const color = colors[i % colors.length];
                      return pct > 0 ? (
                        <div
                          key={a.id}
                          className={`h-full transition-all duration-300 ${color}`}
                          style={{ width: `${pct}%` }}
                          title={`Split ${i + 1}: ₹${amt.toLocaleString()}`}
                        />
                      ) : null;
                    })}
                    {remaining > 0 && (
                      <div
                        className="h-full bg-black/[0.06] transition-all duration-300"
                        style={{ width: `${(remaining / totalAmt) * 100}%` }}
                        title={`Unallocated: ₹${remaining.toLocaleString()}`}
                      />
                    )}
                  </div>
                  
                  <div className="flex items-center justify-between text-[11px] font-semibold">
                    <span className="text-on-surface-variant/40">Total: ₹{totalAmt.toLocaleString('en-IN')}</span>
                    <span className="font-bold">
                      {isOver ? (
                        <span className="text-error uppercase tracking-wider text-[9.5px]">Over-allocated by ₹{Math.abs(remaining).toLocaleString('en-IN')}</span>
                      ) : isFullyAllocated ? (
                        <span className="text-[#006C49] uppercase tracking-wider text-[9.5px] flex items-center gap-1">
                          <span className="material-symbols-outlined text-[13px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                          Balanced
                        </span>
                      ) : (
                        <span className="text-primary uppercase tracking-wider text-[9.5px]">₹{remaining.toLocaleString('en-IN')} left to allocate</span>
                      )}
                    </span>
                  </div>
                </div>
              )}

              {/* Client Receipt: simple project picker only */}
              {txnType === 'client_receipt' ? (
                <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5">
                  <div>
                    <label className={`block text-[11px] font-medium mb-1.5 ${missingProject && !allocs[0]?.project_id ? 'text-error' : 'text-on-surface-variant/60'}`}>
                      Project / Site{missingProject && !allocs[0]?.project_id && <span className="ml-1.5">required</span>}
                    </label>
                    <select
                      id="txn-project-0"
                      value={allocs[0]?.project_id || ''}
                      onChange={(e) => { setAllocs([{ ...allocs[0], project_id: e.target.value }]); if (e.target.value) advanceAfter('project'); }}
                      className={`bk-input ${missingProject && !allocs[0]?.project_id ? 'border-error' : ''}`}
                    >
                      <option value="">Select project…</option>
                      {projects?.map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                    </select>
                  </div>
                </div>
              ) : (
              <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">

                {effectiveAllocs.map((a, idx) => {

                  return (
                    <div key={a.id} className={`p-5 space-y-4 ${idx > 0 ? 'border-t border-black/[0.04]' : ''}`}>

                      {/* Split header */}
                      {splitMode && (
                        <div className="flex items-center justify-between -mb-1">
                          <span className="text-[11px] font-semibold text-on-surface-variant/50">Split {idx + 1}</span>
                          {allocs.length > 1 && (
                            <button type="button" onClick={() => rmAlloc(a.id)}
                              className="text-[12px] text-error/60 hover:text-error transition-colors flex items-center gap-1">
                              <span className="material-symbols-outlined text-[14px]">remove_circle</span>Remove
                            </button>
                          )}
                        </div>
                      )}

                      {/* Project picker */}
                      <div>
                        <label className={`block text-[11px] font-medium mb-1.5 ${missingProject && !a.project_id ? 'text-error' : 'text-on-surface-variant/60'}`}>
                          Project / Site{missingProject && !a.project_id && <span className="ml-1.5">required</span>}
                        </label>
                        <select
                          id={idx === 0 ? 'txn-project-0' : undefined}
                          value={a.project_id}
                          onChange={(e) => upAlloc(a.id, { project_id: e.target.value, order_type: '', order_ref: '', milestone_id: '' })}
                          className={`bk-input ${missingProject && !a.project_id ? 'border-error' : ''}`}
                        >
                          <option value="">Select project…</option>
                          {projects?.map((p) => <option key={p.project_id} value={p.project_id}>{p.name}</option>)}
                        </select>
                      </div>

                      {/* Per-split obligation linking — each split links its own WO/PO + milestone */}
                      {splitMode && (txnType === 'worker' || txnType === 'material') && a.project_id && stkId && (
                        <RowObligationLink
                          key={a.project_id}
                          projectId={a.project_id}
                          stkId={stkId}
                          txnType={txnType}
                          onSelect={(ob) => upAlloc(a.id, { ...obligationToAllocLink(ob), allocated_amount: a.allocated_amount || ob.balance })}
                          onClear={() => upAlloc(a.id, { order_type: '', order_ref: '', milestone_id: '' })}
                        />
                      )}

                      {/* ── Link hub — the ledger's "link vs one-time" gate, adapted to this page.
                           Worker → contract; Material → order. Reuses LinkingPanel + `skipped`
                           (= one-time / not linked). Shown once a project AND payee are chosen. ── */}
                      {!splitMode && txnType !== 'expense' && a.project_id && stkId && (() => {
                        const isWorker = txnType === 'worker';
                        // Worker not on a contract = a one-time labour payment; a material buy not
                        // raised against a PO = a "direct purchase" (the accounting-sound term).
                        const oneTimeLabel = isWorker ? 'One-time payment' : 'Direct purchase';

                        // (a) one-time chosen → settled, reversible chip
                        if (skipped) {
                          return (
                            <div className="flex items-center justify-between rounded-xl px-3.5 py-3" style={{ background: VOICE.field, border: `1px solid ${VOICE.line}` }}>
                              <span className="inline-flex items-center gap-2 text-[13px] font-medium" style={{ color: VOICE.userSoft }}>
                                <span className="material-symbols-outlined text-[16px]" style={{ color: VOICE.confirm }}>check_circle</span>
                                {oneTimeLabel} · not linked
                              </span>
                              <button type="button" onClick={() => { setSkipped(false); setSelectedObligation(null); setLinkOpen(false); }}
                                className="text-[12px] font-semibold" style={{ color: VOICE.out }}>Change</button>
                            </div>
                          );
                        }

                        // (b) chose to link → the obligation picker
                        if (linkOpen) {
                          return (
                            <>
                              <div className="flex items-start justify-between gap-3 mb-1">
                                <h3 style={{ fontFamily: VOICE.serif, fontSize: 18, fontWeight: 600, letterSpacing: '-0.01em', color: VOICE.user }}>
                                  {isWorker ? `Track this as a contract with ${selName}?` : `Track this as a purchase with ${selName}?`}
                                </h3>
                                <button type="button" onClick={() => { setLinkOpen(false); setSelectedObligation(null); }}
                                  className="shrink-0 mt-1 text-[12px] font-medium inline-flex items-center gap-1" style={{ color: VOICE.system }}>
                                  <span className="material-symbols-outlined text-[14px]">arrow_back</span>Back
                                </button>
                              </div>
                              <p className="mb-3.5" style={{ fontSize: 12.5, lineHeight: 1.55, color: VOICE.system }}>
                                {isWorker
                                  ? "A subcontract has a fixed value — we'll show the balance burn down as you pay. Daily labour doesn't need this."
                                  : "An open bill has an amount due — link this payment to it and its balance burns down as you pay. A direct purchase has no bill to clear."}
                              </p>
                              <LinkingPanel
                                wos={projectWOs}
                                pos={projectPOs}
                                loading={loadingObligations}
                                selectedObligation={selectedObligation}
                                onSelect={(ob) => { setSelectedObligation(ob); setSkipped(false); if (!amountTouched) setTotalAmt(ob.balance); }}
                                onSkip={() => { setSelectedObligation(null); setSkipped(true); setLinkOpen(false); }}
                                onOpenWO={() => openDrawer('WO')}
                                onOpenPO={() => openDrawer('PO')}
                                txnType={txnType}
                                payeeName={selName}
                                projectName={projects?.find((p: any) => p.project_id === a.project_id)?.name || null}
                              />
                              {needsPhaseSelection && (
                                <div className="mt-3 p-4 rounded-xl border border-amber-200/50 bg-amber-50/50 text-amber-800 animate-fadeIn">
                                  <div className="flex items-start gap-2.5">
                                    <span className="material-symbols-outlined text-[18px] text-amber-600 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                                    <div className="flex-1 text-[12px] leading-relaxed">
                                      <p className="font-semibold text-amber-900">Select a phase or milestone to continue.</p>
                                      <p className="mt-0.5 text-amber-800/80">This Contract has phases. Expand it above and select the specific phase to link this payment to.</p>
                                    </div>
                                  </div>
                                </div>
                              )}
                              {(() => {
                                if (selectedObligation?.type === 'PO') {
                                  const selPO = projectPOs.find((p: any) => p.po_id === selectedObligation.po_id);
                                  if (selPO && !Number(selPO.vendor_bill_amount)) {
                                    return (
                                      <div className="mt-3 p-4 rounded-xl border border-amber-200/50 bg-amber-50/50 text-amber-800 animate-fadeIn">
                                        <div className="flex items-start gap-2.5">
                                          <span className="material-symbols-outlined text-[18px] text-amber-600 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                                          <div className="flex-1 text-[12px] leading-relaxed">
                                            <p className="font-semibold text-amber-900">No bill copy or amount has been recorded for this Purchase Order yet.</p>
                                            <p className="mt-0.5 text-amber-800/80">This payment will be registered as a <strong>PO Advance</strong> in the ledger and PO details.</p>
                                          </div>
                                        </div>
                                      </div>
                                    );
                                  }
                                }
                                return null;
                              })()}
                            </>
                          );
                        }

                        // (c) the gate
                        return (
                          <div className="rounded-2xl p-4" style={{ background: VOICE.cream2, border: `1px solid ${VOICE.line}` }}>
                            <p className="mb-3" style={{ fontFamily: VOICE.serif, fontSize: 15.5, fontWeight: 600, color: VOICE.user }}>
                              {isWorker ? 'Is this transaction part of an existing contract?' : 'Is this transaction part of an existing order?'}
                            </p>
                            <div className="flex gap-2.5">
                              <button type="button" onClick={() => setLinkOpen(true)}
                                className="flex-1 inline-flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl text-[13px] font-semibold transition-opacity hover:opacity-90"
                                style={{ background: VOICE.accentTint, border: `1px solid ${VOICE.outLine}`, color: VOICE.accentDeep }}>
                                <span className="material-symbols-outlined text-[16px]">{isWorker ? 'engineering' : 'inventory_2'}</span>
                                {isWorker ? 'Link to a contract' : 'Link to an order'}
                                <span className="material-symbols-outlined text-[15px]">arrow_forward</span>
                              </button>
                              <button type="button" onClick={() => { setSkipped(true); setSelectedObligation(null); }}
                                className="inline-flex items-center justify-center px-3.5 py-2.5 rounded-xl text-[13px] font-medium transition-colors"
                                style={{ background: VOICE.surface, border: `1px solid ${VOICE.line}`, color: VOICE.system }}>
                                {oneTimeLabel}
                              </button>
                            </div>
                          </div>
                        );
                      })()}

                      {/* Split amount */}
                      {splitMode && (
                        <div>
                          <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-1.5">Amount for this split</label>
                          <div className="relative">
                            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-on-surface-variant/30 font-data-mono select-none">₹</span>
                            <input type="number" step="0.01" min="0"
                              value={a.allocated_amount || ''}
                              onChange={(e) => upAlloc(a.id, { allocated_amount: parseFloat(e.target.value) || 0 })}
                              onFocus={(e) => e.target.select()}
                              className={`bk-input pl-7 font-data-mono ${isOver ? 'border-error' : ''}`}
                              placeholder="0" />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

                {/* Split controls footer */}
                <div className="px-5 py-3.5 border-t border-black/[0.04] bg-surface-container-lowest/40">
                  {!splitMode ? (
                    <button type="button"
                      onClick={() => { setSplitMode(true); setAllocs((prev) => [{ ...prev[0], allocated_amount: 0 }]); }}
                      className="flex items-center gap-2 text-[12px] text-on-surface-variant/50 hover:text-primary transition-colors">
                      <span className="material-symbols-outlined text-[16px]">call_split</span>
                      Split across multiple projects
                    </button>
                  ) : (
                    <div className="flex items-center justify-between">
                      <button type="button" onClick={addAlloc}
                        className="flex items-center gap-1.5 text-[13px] font-medium text-primary/70 hover:text-primary transition-colors">
                        <span className="material-symbols-outlined text-[16px]">add_circle</span>
                        Add another project
                      </button>
                      <button type="button" onClick={() => { setSplitMode(false); setAllocs((prev) => [{ ...prev[0], allocated_amount: 0 }]); }}
                        className="flex items-center gap-1 text-[12px] text-on-surface-variant/40 hover:text-on-surface-variant transition-colors">
                        <span className="material-symbols-outlined text-[13px]">close</span>
                        Remove split
                      </button>
                    </div>
                  )}
                </div>
              </div>
              )}
            </div>

            {/* ━━ Smart Suggestions ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ */}
            {txnType === 'client_receipt' && !dismissedReceiptSuggestion && stkId && totalAmt > 0 && allocs[0]?.project_id && (
              <div className="p-4 rounded-xl border border-outline-variant/20 bg-surface-container-low/60">
                <div className="flex items-start gap-3">
                  <span className="text-[18px]">💡</span>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold text-on-surface">Raise a bill for this receipt?</p>
                    <p className="text-[12px] text-on-surface-variant/70 mt-1">
                      Client receipts are often linked to a billing milestone. Create a bill to maintain clean records.
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={handleRaiseBillFromReceiptNav} className="text-[12px] font-semibold text-primary hover:underline flex items-center gap-1">
                        Raise Bill <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </button>
                      <button onClick={() => setDismissedReceiptSuggestion(true)} className="text-[12px] text-on-surface-variant/50 hover:text-on-surface-variant transition-colors ml-2">
                        Skip, just record
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {(txnType === 'worker' || txnType === 'material') && !dismissedMilestoneSuggestion && completedMilestoneLinked && (
              <div className="p-4 rounded-xl border border-outline-variant/20 bg-surface-container-low/60">
                <div className="flex items-start gap-3">
                  <span className="text-[18px]">💡</span>
                  <div className="flex-1">
                    <p className="text-[13px] font-semibold text-on-surface">This milestone may be billable</p>
                    <p className="text-[12px] text-on-surface-variant/70 mt-1">
                      The linked milestone is marked complete. Raise a bill to your client for this work?
                    </p>
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => navigate('/billing/new')} className="text-[12px] font-semibold text-primary hover:underline flex items-center gap-1">
                        Raise Bill <span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                      </button>
                      <button onClick={() => setDismissedMilestoneSuggestion(true)} className="text-[12px] text-on-surface-variant/50 hover:text-on-surface-variant transition-colors ml-2">
                        Not now
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* ━━ 04 · Documents — two categories: the Bill and the Proof of payment ━━ */}
            <div>
              <SectionLabel n="04" title="Documents" />
              <div className="space-y-4">
                <div>
                  <p className="text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Bill</p>
                  <DocUpload id="bill-upload" file={billFile} onFile={setBillFile} cta="Upload bill / invoice" />
                </div>
                <div>
                  <p className="text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Proof of payment</p>
                  <DocUpload id="proof-upload" file={proofFile} onFile={setProofFile} cta="Upload payment proof" />
                </div>
              </div>
            </div>

            {/* Unlinked warning */}
            {saveAttempted && !selectedObligation && !skipped &&
              (txnType === 'worker' || txnType === 'material') &&
              allocs[0]?.project_id && (
              <div className="flex items-start gap-3 p-4 bg-amber-50/40 border border-amber-200/30 rounded-2xl animate-fadeIn">
                <span className="material-symbols-outlined text-amber-600 text-[18px] shrink-0 mt-0.5">warning</span>
                <div className="flex-1 text-[12px] leading-relaxed">
                  <p className="font-bold text-amber-900">Unlinked payment recorded</p>
                  <p className="text-amber-800/80 mt-0.5">This payment won't be linked to a specific Contract or Purchase Order balance. That's fine for general expenses.</p>
                </div>
              </div>
            )}

            {/* Error */}
            {createTxn.isError && (
              <div className="p-4 bg-error-container text-on-error-container rounded-xl text-[13px] font-medium">
                {(createTxn.error as any)?.message || 'Error saving transaction'}
              </div>
            )}

          </div>
        )}
      </div>

      {/* ── Budget over-limit confirmation dialog ──────────────────────────── */}
      {budgetWarning && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm px-4">
          <div className="bg-white rounded-2xl shadow-elevation-16 w-full max-w-sm p-6 space-y-4">
            <div className="flex items-start gap-3">
              <span className="material-symbols-outlined text-error text-[24px] shrink-0 mt-0.5">warning</span>
              <div>
                <p className="text-[15px] font-bold text-on-surface">Over budget</p>
                <p className="text-[12px] text-on-surface-variant/60 mt-0.5">{budgetWarning.codeName}</p>
              </div>
            </div>
            <div className="bg-error/[0.06] rounded-xl p-3 space-y-1.5 text-[12px]">
              <div className="flex justify-between">
                <span className="text-on-surface-variant/60">Budget target</span>
                <span className="font-data-mono font-semibold">₹{budgetWarning.planned.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant/60">Already spent</span>
                <span className="font-data-mono">₹{budgetWarning.currentSpent.toLocaleString('en-IN')}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-on-surface-variant/60">This transaction</span>
                <span className="font-data-mono">₹{totalAmt.toLocaleString('en-IN')}</span>
              </div>
              <div className="border-t border-error/20 pt-1.5 flex justify-between">
                <span className="font-semibold text-error">Over budget by</span>
                <span className="font-data-mono font-bold text-error">₹{budgetWarning.overBy.toLocaleString('en-IN')}</span>
              </div>
            </div>
            <div className="flex gap-2.5">
              <button type="button"
                onClick={() => { setBudgetWarning(null); setPendingSaveMode(null); }}
                className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-medium text-on-surface-variant hover:bg-surface-container transition-colors">
                Cancel
              </button>
              <button type="button"
                onClick={() => {
                  const mode = pendingSaveMode;
                  setBudgetWarning(null);
                  setPendingSaveMode(null);
                  if (mode) createTxn.mutate({ saveMode: mode });
                }}
                className="flex-1 px-4 py-2.5 rounded-xl bg-error text-on-error text-[13px] font-semibold hover:opacity-90 transition-opacity">
                Save anyway
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Inline WO / PO Slide-Over Drawer ─────────────────────────────────── */}
      <style>{`
        @keyframes slideInRight {
          from { transform: translateX(100%); opacity: 0; }
          to   { transform: translateX(0);    opacity: 1; }
        }
        @keyframes drawerFadeIn {
          from { opacity: 0; }
          to   { opacity: 1; }
        }
        @keyframes scaleUpCheck {
          0%   { transform: scale(0) rotate(-15deg); opacity: 0; }
          60%  { transform: scale(1.15) rotate(3deg); opacity: 1; }
          100% { transform: scale(1) rotate(0deg);  opacity: 1; }
        }
        @keyframes confettiRing {
          0%   { transform: scale(0.3); opacity: 0.9; }
          100% { transform: scale(2.2); opacity: 0; }
        }
        @keyframes confettiRingOuter {
          0%   { transform: scale(0.2); opacity: 0.6; }
          100% { transform: scale(2.8); opacity: 0; }
        }
        @keyframes fadeUpIn {
          from { transform: translateY(8px); opacity: 0; }
          to   { transform: translateY(0);   opacity: 1; }
        }
        .drawer-slide { animation: slideInRight 0.38s cubic-bezier(0.32,0,0.08,1) both; }
        .drawer-backdrop { animation: drawerFadeIn 0.25s ease both; }
        .celebrate-check { animation: scaleUpCheck 0.55s cubic-bezier(0.34,1.56,0.64,1) 0.1s both; }
        .celebrate-ring  { animation: confettiRing 0.9s cubic-bezier(0.22,1,0.36,1) 0.05s both; }
        .celebrate-ring-outer { animation: confettiRingOuter 1.1s cubic-bezier(0.22,1,0.36,1) 0.15s both; }
        .celebrate-text  { animation: fadeUpIn 0.4s ease 0.5s both; }
      `}</style>

      {drawerOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-[60] bg-black/30 backdrop-blur-[2px] drawer-backdrop"
            onClick={creatingOrder ? undefined : closeDrawer}
          />

          {/* Drawer panel */}
          <div className="fixed right-0 top-0 bottom-0 z-[61] w-full max-w-md bg-white shadow-[−24px_0_80px_rgba(0,0,0,0.12)] drawer-slide flex flex-col overflow-hidden">

            {/* Drawer header */}
            <div className={`px-6 pt-6 pb-4 border-b border-black/[0.05] flex items-center gap-3 shrink-0 ${
              drawerOpen === 'WO' ? 'bg-gradient-to-br from-[#C8603A]/[0.04] to-transparent' : 'bg-gradient-to-br from-[#006c49]/[0.04] to-transparent'
            }`}>
              <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${
                drawerOpen === 'WO' ? 'bg-[#C8603A]/10' : 'bg-[#006c49]/10'
              }`}>
                <span className={`material-symbols-outlined text-[20px] ${
                  drawerOpen === 'WO' ? 'text-[#C8603A]' : 'text-[#006c49]'
                }`} style={{ fontVariationSettings: "'FILL' 1" }}>
                  {drawerOpen === 'WO' ? 'engineering' : 'shopping_cart'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <h2 className="text-[15px] font-bold text-on-surface">
                  {drawerOpen === 'WO' ? 'New Contract' : 'New Purchase Order'}
                </h2>
                <p className="text-[11px] text-on-surface-variant/50 mt-0.5">
                  {drawerOpen === 'WO' ? 'Quick-create & link to this transaction' : 'Quick-create & link to this transaction'}
                </p>
              </div>
              <button
                type="button"
                onClick={closeDrawer}
                disabled={creatingOrder}
                className="w-8 h-8 rounded-xl hover:bg-black/[0.04] flex items-center justify-center text-on-surface-variant/40 hover:text-on-surface transition-colors disabled:opacity-30"
              >
                <span className="material-symbols-outlined text-[20px]">close</span>
              </button>
            </div>

            {/* Drawer body (scrollable) */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

              {/* Context badge — locked fields */}
              {(selectedProjectId || stkId) && (
                <div className="flex flex-wrap gap-2">
                  {selectedProjectId && projects?.find(p => p.project_id === selectedProjectId) && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/[0.03] border border-black/[0.06] text-[11px] font-semibold text-on-surface-variant/60">
                      <span className="material-symbols-outlined text-[13px] text-on-surface-variant/40">location_city</span>
                      {projects!.find(p => p.project_id === selectedProjectId)?.name}
                    </span>
                  )}
                  {stkId && stakeholders?.find(s => s.stakeholder_id === stkId) && (
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/[0.03] border border-black/[0.06] text-[11px] font-semibold text-on-surface-variant/60">
                      <span className="material-symbols-outlined text-[13px] text-on-surface-variant/40">
                        {drawerOpen === 'WO' ? 'engineering' : 'store'}
                      </span>
                      {stakeholders!.find(s => s.stakeholder_id === stkId)?.name}
                    </span>
                  )}
                </div>
              )}

              {drawerOpen === 'WO' ? (
                /* ── WO Form ── */
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                      Scope of Work <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={woScope}
                      onChange={e => setWoScope(e.target.value)}
                      rows={3}
                      className="bk-input w-full resize-none focus:ring-4 focus:ring-[#C8603A]/10 transition-all duration-200"
                      placeholder="e.g. Plastering work — 2nd floor walls and ceiling…"
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                        Order Value (₹) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-on-surface-variant/30 font-data-mono">₹</span>
                        <input
                          type="number" step="1" min="0"
                          value={woValue || ''}
                          onChange={e => setWoValue(parseFloat(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                          className="bk-input pl-7 font-data-mono focus:ring-4 focus:ring-[#C8603A]/10 transition-all duration-200"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Date Issued</label>
                      <input
                        type="date" value={woDate}
                        onChange={e => setWoDate(e.target.value)}
                        className="bk-input focus:ring-4 focus:ring-[#C8603A]/10 transition-all duration-200"
                      />
                    </div>
                  </div>
                  {/* Summary block */}
                  {woValue > 0 && (
                    <div className="rounded-xl border border-[#C8603A]/10 bg-[#C8603A]/[0.02] p-4">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#C8603A]/60 mb-2">Order Summary</p>
                      <div className="flex items-center justify-between">
                        <span className="text-[12px] text-on-surface-variant/60">Lump-sum · Full Payment</span>
                        <span className="text-[14px] font-bold font-data-mono text-[#C8603A]">₹{woValue.toLocaleString('en-IN')}</span>
                      </div>
                    </div>
                  )}
                </div>
              ) : (
                /* ── PO Form ── */
                <div className="space-y-4">
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                      Item / Description <span className="text-red-500">*</span>
                    </label>
                    <textarea
                      value={poDesc}
                      onChange={e => setPoDesc(e.target.value)}
                      rows={3}
                      className="bk-input w-full resize-none focus:ring-4 focus:ring-[#006c49]/10 transition-all duration-200"
                      placeholder="e.g. TMT Steel Bars 12mm Fe-500 grade…"
                      autoFocus
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">
                        Total Value (₹ incl. GST) <span className="text-red-500">*</span>
                      </label>
                      <div className="relative">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-bold text-on-surface-variant/30 font-data-mono">₹</span>
                        <input
                          type="number" step="1" min="0"
                          value={poValue || ''}
                          onChange={e => setPoValue(parseFloat(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                          className="bk-input pl-7 font-data-mono focus:ring-4 focus:ring-[#006c49]/10 transition-all duration-200"
                          placeholder="0"
                        />
                      </div>
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">GST Rate</label>
                      <div className="flex gap-1.5">
                        {[0, 5, 12, 18, 28].map(r => (
                          <button key={r} type="button"
                            onClick={() => setPoGstRate(r)}
                            className={`flex-1 py-2 rounded-lg text-[11px] font-bold transition-colors ${
                              poGstRate === r
                                ? 'bg-[#006c49] text-white'
                                : 'bg-black/[0.03] text-on-surface-variant/50 hover:bg-black/[0.06]'
                            }`}
                          >{r}%</button>
                        ))}
                      </div>
                    </div>
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-on-surface-variant/60 mb-2 uppercase tracking-wide">Date Issued</label>
                    <input
                      type="date" value={poDate}
                      onChange={e => setPoDate(e.target.value)}
                      className="bk-input focus:ring-4 focus:ring-[#006c49]/10 transition-all duration-200"
                    />
                  </div>
                  {/* Tax breakdown */}
                  {poValue > 0 && (
                    <div className="rounded-xl border border-[#006c49]/10 bg-[#006c49]/[0.02] p-4 space-y-1.5">
                      <p className="text-[10px] font-bold uppercase tracking-wider text-[#006c49]/60 mb-2">Tax Breakdown</p>
                      {(() => {
                        const taxable = poValue / (1 + poGstRate / 100);
                        const totalGST = poValue - taxable;
                        return (
                          <>
                            <div className="flex justify-between text-[11px]">
                              <span className="text-on-surface-variant/50">Taxable amount</span>
                              <span className="font-data-mono font-semibold">₹{taxable.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                            </div>
                            {poGstRate > 0 && (
                              <>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-on-surface-variant/50">CGST ({poGstRate / 2}%)</span>
                                  <span className="font-data-mono">₹{(totalGST / 2).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                </div>
                                <div className="flex justify-between text-[11px]">
                                  <span className="text-on-surface-variant/50">SGST ({poGstRate / 2}%)</span>
                                  <span className="font-data-mono">₹{(totalGST / 2).toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
                                </div>
                              </>
                            )}
                            <div className="border-t border-[#006c49]/10 pt-1.5 flex justify-between text-[12px] font-bold">
                              <span className="text-[#006c49]">Total</span>
                              <span className="font-data-mono text-[#006c49]">₹{poValue.toLocaleString('en-IN')}</span>
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Drawer footer */}
            <div className="px-6 py-4 border-t border-black/[0.05] bg-black/[0.005] shrink-0">
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={closeDrawer}
                  disabled={creatingOrder}
                  className="flex-1 py-2.5 rounded-xl border border-black/[0.08] text-[13px] font-semibold text-on-surface-variant hover:bg-black/[0.03] transition-colors disabled:opacity-40"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={drawerOpen === 'WO' ? handleCreateWO : handleCreatePO}
                  disabled={creatingOrder}
                  className={`flex-[2] py-2.5 rounded-xl text-[13px] font-bold text-white transition-all duration-200 active:scale-[0.98] flex items-center justify-center gap-2 disabled:opacity-50 shadow-sm ${
                    drawerOpen === 'WO'
                      ? 'bg-[#C8603A] hover:bg-[#B54E2A] shadow-[#C8603A]/20'
                      : 'bg-[#006c49] hover:bg-[#005438] shadow-[#006c49]/20'
                  }`}
                >
                  {creatingOrder ? (
                    <><Loader2 className="animate-spin" size={15} /> Creating…</>
                  ) : (
                    <><span className="material-symbols-outlined text-[17px]">check</span>Create {drawerOpen === 'WO' ? 'Contract' : 'Purchase Order'}</>
                  )}
                </button>
              </div>
            </div>

            {/* ── Celebration Overlay ── */}
            {celebrating && (
              <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center bg-white/80 backdrop-blur-sm">
                {/* Radial rings */}
                <div className="relative flex items-center justify-center">
                  <div className={`absolute w-32 h-32 rounded-full border-2 celebrate-ring ${
                    drawerOpen === 'WO' ? 'border-[#C8603A]/20' : 'border-[#006c49]/20'
                  }`} />
                  <div className={`absolute w-44 h-44 rounded-full border celebrate-ring-outer ${
                    drawerOpen === 'WO' ? 'border-[#C8603A]/10' : 'border-[#006c49]/10'
                  }`} />
                  {/* Check circle */}
                  <div className={`w-20 h-20 rounded-full flex items-center justify-center celebrate-check shadow-lg ${
                    drawerOpen === 'WO' ? 'bg-[#C8603A]' : 'bg-[#006c49]'
                  }`}>
                    <span className="material-symbols-outlined text-white text-[40px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                  </div>
                </div>
                {/* Text */}
                <div className="mt-6 text-center celebrate-text">
                  <p className="text-[16px] font-bold text-on-surface">
                    {drawerOpen === 'WO' ? 'Contract Created' : 'Purchase Order Created'}
                  </p>
                  {createdOrderId && (
                    <p className={`text-[12px] font-data-mono font-bold mt-1 ${
                      drawerOpen === 'WO' ? 'text-[#C8603A]' : 'text-[#006c49]'
                    }`}>{createdOrderId}</p>
                  )}
                  <p className="text-[11px] text-on-surface-variant/50 mt-1.5">Linking to your transaction…</p>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {/* ── Bottom Action Bar — voice restyle (handlers unchanged) ──────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40 backdrop-blur-xl" style={{ background: 'rgba(255,255,255,0.9)', borderTop: `1px solid ${VOICE.line}`, transform: kbOpen ? 'translateY(115%)' : 'translateY(0)', transition: 'transform .22s cubic-bezier(.4,0,.2,1)' }}>
        <div className="mx-auto px-5 py-4 flex items-center gap-3" style={{ maxWidth: 720 }}>
          {txnType && (
            <div className="mr-1">
              <p style={{ fontFamily: VOICE.serif, fontSize: 20, fontWeight: 600, color: VOICE.user, ...VNUMS }}>
                {txnType === 'client_receipt' ? '+' : '−'}{totalAmt > 0 ? `₹${totalAmt.toLocaleString('en-IN')}` : '₹0'}
              </p>
              <p className="uppercase" style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.7px', color: VOICE.faint }}>Draft</p>
            </div>
          )}
          <button type="button" onClick={() => navigate('/ledger')}
            className="hidden sm:block text-[13px] font-bold px-4 py-2.5 rounded-xl transition-all duration-200 active:scale-95"
            style={{ color: VOICE.system }}>
            Cancel
          </button>
          <div className="flex-1" />
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-2">
              {nextGap ? (
                /* Incomplete → one guiding button that names the next gap and jumps to it. */
                <button type="button" onClick={goToGap} disabled={!txnType}
                  className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 active:scale-95 disabled:opacity-35"
                  style={{ background: VOICE.walnut, color: VOICE.ivory, boxShadow: '0 8px 20px -10px rgba(34,26,19,.6)' }}>
                  {nextGap.label}
                  <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                </button>
              ) : (
                /* Complete → the real save actions. */
                <>
                  <button type="button" onClick={() => handleSave('new')} disabled={!txnType || createTxn.isPending}
                    aria-label="Save & new"
                    className="flex items-center gap-1.5 px-3.5 sm:px-4 py-2.5 rounded-xl border border-black/15 text-on-surface text-[13px] font-bold hover:bg-black/[0.02] transition-all duration-200 active:scale-95 disabled:opacity-35 disabled:pointer-events-none">
                    {createTxn.isPending && (createTxn.variables as any)?.saveMode === 'new'
                      ? <Loader2 className="animate-spin" size={14} />
                      : <span className="material-symbols-outlined text-[16px]">add</span>}
                    <span className="hidden sm:inline">Save &amp; new</span>
                  </button>
                  <button type="button" onClick={() => handleSave('exit')} disabled={!txnType || createTxn.isPending}
                    className="flex items-center gap-1.5 px-4 sm:px-5 py-2.5 rounded-xl text-[13px] font-bold transition-all duration-200 active:scale-95 disabled:opacity-35 disabled:pointer-events-none"
                    style={{ background: VOICE.walnut, color: VOICE.ivory, boxShadow: '0 8px 20px -10px rgba(34,26,19,.6)' }}>
                    {createTxn.isPending && (createTxn.variables as any)?.saveMode === 'exit'
                      ? <Loader2 className="animate-spin" size={14} />
                      : <span className="material-symbols-outlined text-[16px]">check</span>}
                    Save &amp; exit
                  </button>
                </>
              )}
            </div>
            <p className="hidden sm:block text-[9px] font-bold uppercase tracking-wider text-on-surface-variant/30 mr-1 select-none">⌘ Enter</p>
          </div>
        </div>
      </div>
    </div>
  );
}
