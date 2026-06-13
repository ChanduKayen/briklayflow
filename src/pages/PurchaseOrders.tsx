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
import RecordBillSheet from '../components/RecordBillSheet';

// ─────────────────────────────────────────────────────────────────────────
//  Action-first redesign (matches BriklayPOPage handoff). Presentation only —
//  every data hook, route, and mutation below is the pre-existing one.
//
//  Mock → real entity mapping (per handoff notes):
//    po.code       → purchase_orders.po_id
//    po.vendor     → stakeholders.name
//    po.items      → line-item summary string (getItemsPreview)
//    po.amount     → vendor bill amount, else order/total value
//    po.rfq        → 'skipped' for all (no RFQ records joined here; the RFQ
//                    flow lives under /procurement/quotes). No badge is shown.
//    po.milestones → derived booleans:
//                      grn   = a goods-receival record exists (poHasReceival)
//                      bill  = vendor bill recorded            (poHasBill)
//                      photo = bill document attached          (poHasBillDoc)
//
//  Brand colour: the solid terracotta accent maps to the Tailwind theme token
//  `terracotta` (#C45B39 in tailwind.config.js) — used via bg-/text-terracotta.
//  The warm neutrals / washes (ink, paper, sage, amber) have no token
//  equivalent and remain local constants, applied inline.
// ─────────────────────────────────────────────────────────────────────────

const C = {
  ink:       '#1F1B16',
  inkSoft:   '#6E665C',
  inkFaint:  '#9C948A',
  paper:     '#FAF9F7',
  surface:   '#FFFFFF',
  line:      '#E9E5DF',
  lineDash:  '#CFC8BF',
  terraDeep: '#8F3318',
  terraWash: '#FBEFE9',
  terraEdge: '#F0D5C8',
  sage:      '#4A6741',
  sageWash:  '#EDF2E8',
  sageDeep:  '#33492C',
  amber:     '#8A5A0B',
};

const inr = (n: number) => '₹' + (Number(n) || 0).toLocaleString('en-IN', { maximumFractionDigits: 0 });

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

function poAmount(po: any): number {
  const bill = Number(po.vendor_bill_amount) || 0;
  if (bill > 0) return bill;
  return Number(po.total_value) || Number(po.order_value) || 0;
}

// ── Date preset helpers (advanced Filters sheet) ──────────────────────────────

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

// ── Milestone predicates (existing derived state) ─────────────────────────────

type ReceiptSummaryMap = Record<string, { receipt_pct?: number; last_receipt_date?: string } | undefined>;
type PaymentTotalsMap = Record<string, number>;

function poHasBill(po: any): boolean { return Number(po.vendor_bill_amount) > 0; }
function poHasBillDoc(po: any): boolean { return !!(po.vendor_bill_url || po.vendor_bill_doc_url); }
function poReceiptPct(po: any, summaries?: ReceiptSummaryMap): number {
  return Number(summaries?.[po.po_id]?.receipt_pct ?? 0);
}
function poFullyReceived(po: any, summaries?: ReceiptSummaryMap): boolean {
  return poReceiptPct(po, summaries) >= 100;
}
/** A goods-receival record exists (any GRN logged, or marked received at site). */
function poHasReceival(po: any, summaries?: ReceiptSummaryMap): boolean {
  return poReceiptPct(po, summaries) > 0 || !!po.received_at_site;
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

// ── Derived agency / status / next-action ─────────────────────────────────────
//  agency answers "whose move is it?" — drives both grouping and the filter
//  tabs. Each CTA maps 1:1 to an existing handler (receive drawer, detail
//  navigation, or the inline bill-photo upload).

type Agency = 'you' | 'them' | 'done';
type CtaKind = 'receive' | 'bill' | 'upload' | 'navigate' | null;

interface Derived {
  grn: boolean; bill: boolean; photo: boolean; done: number;
  agency: Agency; status: string;
  ctaLabel: string | null; ctaKind: CtaKind;
  overdue: boolean; pending: number | null;
}

function derive(po: any, summaries?: ReceiptSummaryMap, payments?: PaymentTotalsMap): Derived {
  const grn   = poHasReceival(po, summaries);
  const bill  = poHasBill(po);
  const photo = poHasBillDoc(po);
  const done  = [grn, bill, photo].filter(Boolean).length;
  const overdue = isOverdue(po) && !grn;
  const pending = poPendingPayment(po, summaries, payments);

  const base = { grn, bill, photo, done, overdue };

  if (po.status === 'CANCELLED')
    return { ...base, agency: 'done', status: 'Cancelled', ctaLabel: null, ctaKind: null, pending: null };

  if (done === 3) {
    if (pending && pending > 0)
      return { ...base, agency: 'you', status: 'Payment pending', ctaLabel: 'Record payment', ctaKind: 'navigate', pending };
    return { ...base, agency: 'done', status: 'Complete', ctaLabel: null, ctaKind: null, pending: null };
  }

  // Nothing landed yet → waiting on the vendor to deliver.
  if (!grn && !bill)
    return { ...base, agency: 'them', status: overdue ? 'Delivery overdue' : 'Awaiting delivery', ctaLabel: 'Record receival', ctaKind: 'receive', pending };

  // Goods not received yet (bill/photo already started) → your move.
  if (!grn)
    return { ...base, agency: 'you', status: `${done} of 3 done`, ctaLabel: 'Record receival', ctaKind: 'receive', pending };

  // Received, but no bill recorded.
  if (!bill)
    return { ...base, agency: 'you', status: `${done} of 3 done`, ctaLabel: 'Enter bill', ctaKind: 'bill', pending };

  // Received + bill, just missing the photo.
  return { ...base, agency: 'you', status: `${done} of 3 done — almost there`, ctaLabel: 'Upload bill photo', ctaKind: 'upload', pending };
}

// ── Milestone detail (for the chip-tap sheet) ─────────────────────────────────

const STEPS = [
  { key: 'grn',   label: 'Goods received', pendingLabel: 'Goods receival', icon: 'local_shipping', action: 'Record receival' },
  { key: 'bill',  label: 'Bill entered',   pendingLabel: 'Bill entry',     icon: 'receipt_long',   action: 'Enter bill' },
  { key: 'photo', label: 'Photo on file',  pendingLabel: 'Bill photo',     icon: 'photo_camera',   action: 'Upload photo' },
] as const;

type StepKey = (typeof STEPS)[number]['key'];

const STEP_BLURB: Record<StepKey, string> = {
  grn:   'Record when material lands on site — quantity, condition, and who received it.',
  bill:  'Enter the vendor bill against this PO so accounts can reconcile it.',
  photo: 'Attach a photo of the physical bill. Keeps the GST trail clean.',
};

function milestoneState(po: any, key: StepKey, summaries?: ReceiptSummaryMap) {
  if (key === 'grn') {
    const done = poHasReceival(po, summaries);
    return {
      done,
      at: done ? fmtShortDate(po.received_at_site || summaries?.[po.po_id]?.last_receipt_date) : '',
      by: po.received_by_name || '',
      ref: '',
    };
  }
  if (key === 'bill') {
    const done = poHasBill(po);
    return {
      done,
      at: done ? fmtShortDate(po.vendor_bill_date || po.bill_recorded_at) : '',
      by: po.bill_recorded_by_name || '',
      ref: po.vendor_bill_number || po.vendor_bill_no || '',
    };
  }
  const done = poHasBillDoc(po);
  return { done, at: '', by: '', ref: '' };
}

// ── Atoms ─────────────────────────────────────────────────────────────────────

function Rail({ done }: { done: number }) {
  return (
    <div className="flex gap-1 my-3" aria-label={`${done} of 3 steps complete`}>
      {[0, 1, 2].map((i) => (
        <div
          key={i}
          className="flex-1 rounded-full"
          style={{ height: 4, background: i < done ? C.sage : C.line }}
        />
      ))}
    </div>
  );
}

function Chip({ step, done, onTap }: { step: (typeof STEPS)[number]; done: boolean; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-full transition-transform active:scale-95"
      style={
        done
          ? { background: C.sageWash, color: C.sageDeep, border: '1px solid transparent' }
          : { background: 'transparent', color: C.inkSoft, border: `1px dashed ${C.lineDash}` }
      }
      aria-label={`${done ? step.label : step.pendingLabel}, ${done ? 'complete' : 'pending'} — tap for details`}
    >
      <span className="material-symbols-outlined text-[14px]" style={done ? { fontVariationSettings: "'FILL' 1" } : undefined}>
        {done ? 'check' : step.icon}
      </span>
      {done ? step.label : step.pendingLabel}
    </button>
  );
}

function Metric({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div
      className="rounded-2xl px-3.5 py-3"
      style={{
        background: accent ? C.terraWash : C.surface,
        border: `1px solid ${accent ? C.terraEdge : C.line}`,
      }}
    >
      <p className="text-xs mb-0.5 truncate" style={{ color: accent ? C.terraDeep : C.inkFaint }}>{label}</p>
      <p className="text-lg font-medium tabular-nums" style={{ color: accent ? C.terraDeep : C.ink }}>{value}</p>
    </div>
  );
}

// ── PO card ───────────────────────────────────────────────────────────────────

function POCard({
  po, d, canManage, showProject, onNavigate, onReceive, onEnterBill, onAttachBill, uploadingBill, onChipTap, prefetchProps,
}: {
  po: any;
  d: Derived;
  canManage: boolean;
  showProject: boolean;
  onNavigate: () => void;
  onReceive: () => void;
  onEnterBill: () => void;
  onAttachBill: (file: File) => void;
  uploadingBill: boolean;
  onChipTap: (step: (typeof STEPS)[number]) => void;
  prefetchProps: React.HTMLAttributes<HTMLDivElement>;
}) {
  const vendorName = po.stakeholders?.name ?? '—';
  const initials = vendorName.split(' ').filter(Boolean).slice(0, 2).map((w: string) => w[0]).join('').toUpperCase();
  const itemsPreview = getItemsPreview(po);
  const subtitle = [po.po_id, itemsPreview].filter(Boolean).join(' · ') || po.po_id;
  const showCta = canManage && d.ctaLabel && d.ctaKind;

  const statusColor =
    d.agency === 'done' ? C.sageDeep : (d.agency === 'them' || d.overdue) ? C.amber : C.inkSoft;

  return (
    <article
      onClick={onNavigate}
      {...prefetchProps}
      className="rounded-2xl p-4 sm:p-5 cursor-pointer transition-shadow hover:shadow-card active:scale-[0.995]"
      style={{
        background: C.surface,
        border: `1px solid ${C.line}`,
        borderLeft: d.overdue ? '3px solid #E0533A' : `1px solid ${C.line}`,
      }}
    >
      {/* Header: vendor · code · amount */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div
            className="w-10 h-10 rounded-full flex items-center justify-center shrink-0 text-sm font-medium"
            style={{ background: C.paper, color: C.inkSoft, border: `1px solid ${C.line}` }}
            aria-hidden="true"
          >
            {initials}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium truncate" style={{ color: C.ink }}>{vendorName}</p>
            <p className="text-xs truncate" style={{ color: C.inkSoft }}>{subtitle}</p>
            {showProject && po.projects?.name && (
              <p className="text-[11px] truncate mt-0.5" style={{ color: C.inkFaint }}>{po.projects.name}</p>
            )}
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-base font-medium tabular-nums" style={{ color: po.vendor_bill_amount > 0 ? C.sageDeep : C.ink }}>
            {inr(poAmount(po))}
          </p>
          {po.vendor_bill_amount > 0
            ? <p className="text-[10px] mt-0.5" style={{ color: C.inkFaint }}>billed</p>
            : <p className="text-[10px] mt-0.5" style={{ color: C.amber }}>no bill</p>}
        </div>
      </div>

      <Rail done={d.done} />

      {/* Milestone chips */}
      <div className="flex flex-wrap gap-2 mb-3.5">
        {STEPS.map((s) => (
          <Chip
            key={s.key}
            step={s}
            done={s.key === 'grn' ? d.grn : s.key === 'bill' ? d.bill : d.photo}
            onTap={() => onChipTap(s)}
          />
        ))}
      </div>

      {/* Pending-payment indicator (preserved from existing flow) */}
      {d.pending !== null && d.pending > 0 && (
        <div
          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg mb-3.5"
          style={{ background: C.terraWash, border: `1px solid ${C.terraEdge}` }}
        >
          <span className="material-symbols-outlined text-[14px]" style={{ color: C.terraDeep }}>schedule</span>
          <span className="text-xs font-medium" style={{ color: C.terraDeep }}>Pending payment</span>
          <span className="ml-auto text-[13px] font-semibold tabular-nums" style={{ color: C.terraDeep }}>{inr(d.pending)}</span>
        </div>
      )}

      {/* Footer: status line + single CTA */}
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs flex items-center gap-1.5" style={{ color: statusColor }}>
          {(d.agency === 'them' || d.overdue) && <span className="material-symbols-outlined text-[14px]">schedule</span>}
          {d.agency === 'done' && <span className="material-symbols-outlined text-[14px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>}
          {d.status}
        </span>

        {showCta && (
          d.ctaKind === 'upload' ? (
            <label
              onClick={(e) => e.stopPropagation()}
              className={`text-sm font-medium px-4 py-2 rounded-xl bg-terracotta text-white transition-transform active:scale-95 inline-flex items-center gap-1.5 ${uploadingBill ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
            >
              <span className={`material-symbols-outlined text-[16px] ${uploadingBill ? 'animate-spin' : ''}`}>
                {uploadingBill ? 'progress_activity' : 'photo_camera'}
              </span>
              {uploadingBill ? 'Uploading…' : d.ctaLabel}
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png"
                className="hidden"
                disabled={uploadingBill}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) onAttachBill(f);
                }}
              />
            </label>
          ) : d.agency === 'them' ? (
            <button
              onClick={(e) => { e.stopPropagation(); onReceive(); }}
              className="text-sm font-medium px-4 py-2 rounded-xl transition-transform active:scale-95"
              style={{ background: 'transparent', color: C.ink, border: `1px solid ${C.line}` }}
            >
              {d.ctaLabel}
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (d.ctaKind === 'receive') onReceive();
                else if (d.ctaKind === 'bill') onEnterBill();
                else onNavigate();
              }}
              className="text-sm font-medium px-4 py-2 rounded-xl bg-terracotta text-white transition-transform active:scale-95"
            >
              {d.ctaLabel}
            </button>
          )
        )}
      </div>
    </article>
  );
}

// ── Milestone detail sheet (chip tap) ─────────────────────────────────────────

function MilestoneSheet({
  open, onClose, po, step, summaries, canManage, onReceive, onEnterBill, onNavigate, onAttachBill, uploadingBill,
}: {
  open: boolean;
  onClose: () => void;
  po: any | null;
  step: (typeof STEPS)[number] | null;
  summaries?: ReceiptSummaryMap;
  canManage: boolean;
  onReceive: () => void;
  onEnterBill: () => void;
  onNavigate: () => void;
  onAttachBill: (file: File) => void;
  uploadingBill: boolean;
}) {
  const state = po && step ? milestoneState(po, step.key, summaries) : null;
  const docUrl = po?.vendor_bill_url || po?.vendor_bill_doc_url;

  return (
    <BottomSheet open={open} onClose={onClose} desktopAllowed>
      {po && step && state && (
        <div className="px-5 pb-6">
          <div className="flex items-center gap-2.5 mb-4">
            <div
              className="w-9 h-9 rounded-full flex items-center justify-center shrink-0"
              style={{ background: state.done ? C.sageWash : C.terraWash }}
            >
              <span className="material-symbols-outlined text-[18px]" style={{ color: state.done ? C.sageDeep : C.terraDeep }}>
                {state.done ? 'check' : step.icon}
              </span>
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium" style={{ color: C.ink }}>{state.done ? step.label : step.pendingLabel}</p>
              <p className="text-xs truncate" style={{ color: C.inkSoft }}>{po.po_id} · {po.stakeholders?.name ?? '—'}</p>
            </div>
          </div>

          <div className="rounded-2xl p-4" style={{ background: C.paper, border: `1px solid ${C.line}` }}>
            {state.done ? (
              <div className="space-y-2 text-sm" style={{ color: C.ink }}>
                {state.at && <Row label="Completed" value={state.at} />}
                {state.by && <Row label="By" value={state.by} />}
                {state.ref && <Row label="Reference" value={state.ref} />}
                {!state.at && !state.by && !state.ref && (
                  <p className="text-sm leading-relaxed" style={{ color: C.inkSoft }}>This step is complete.</p>
                )}
              </div>
            ) : (
              <p className="text-sm leading-relaxed" style={{ color: C.inkSoft }}>{STEP_BLURB[step.key]}</p>
            )}
          </div>

          {/* Action — same handlers as the card CTAs */}
          {!state.done && canManage && (
            step.key === 'photo' ? (
              <label
                className={`w-full mt-4 py-3 rounded-xl text-sm font-medium bg-terracotta text-white flex items-center justify-center gap-1.5 ${uploadingBill ? 'opacity-60 cursor-wait' : 'cursor-pointer'}`}
              >
                <span className={`material-symbols-outlined text-[18px] ${uploadingBill ? 'animate-spin' : ''}`}>
                  {uploadingBill ? 'progress_activity' : 'photo_camera'}
                </span>
                {uploadingBill ? 'Uploading…' : 'Upload photo'}
                <input
                  type="file"
                  accept=".pdf,.jpg,.jpeg,.png"
                  className="hidden"
                  disabled={uploadingBill}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    e.target.value = '';
                    if (f) { onAttachBill(f); }
                  }}
                />
              </label>
            ) : (
              <button
                className="w-full mt-4 py-3 rounded-xl text-sm font-medium bg-terracotta text-white transition-transform active:scale-[0.98]"
                onClick={() => { onClose(); step.key === 'grn' ? onReceive() : onEnterBill(); }}
              >
                {step.action}
              </button>
            )
          )}

          {state.done && (step.key === 'photo' && docUrl ? (
            <a
              href={docUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full mt-4 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5"
              style={{ background: 'transparent', color: C.ink, border: `1px solid ${C.line}` }}
            >
              View document <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </a>
          ) : (
            <button
              className="w-full mt-4 py-3 rounded-xl text-sm font-medium flex items-center justify-center gap-1.5"
              style={{ background: 'transparent', color: C.ink, border: `1px solid ${C.line}` }}
              onClick={() => { onClose(); onNavigate(); }}
            >
              View record <span className="material-symbols-outlined text-[16px]">chevron_right</span>
            </button>
          ))}
        </div>
      )}
    </BottomSheet>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span style={{ color: C.inkFaint }}>{label}</span>
      <span className="font-medium text-right" style={{ color: C.ink }}>{value}</span>
    </div>
  );
}

// ── Filter tabs (agency model) ────────────────────────────────────────────────

const FILTERS: { key: string; label: string }[] = [
  { key: 'all',  label: 'All' },
  { key: 'you',  label: 'Your move' },
  { key: 'them', label: 'Waiting' },
  { key: 'done', label: 'Done' },
];

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseOrders({ session }: { session: Session }) {
  const navigate    = useNavigate();
  const qc          = useQueryClient();
  const { data: profile } = useUserProfile(session.user.id);
  const { show: showSnackbar } = useSnackbar();

  // URL-synced active filter — ?status=you|them|done
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
  const [billPO, setBillPO] = useState<any | null>(null);
  const [sheet, setSheet] = useState<{ po: any | null; step: (typeof STEPS)[number] | null }>({ po: null, step: null });

  const canManage =
    profile?.role === 'management' ||
    profile?.role === 'principal' ||
    profile?.role === 'accountant';

  const currentUserName: string =
    (profile as any)?.display_name || (profile as any)?.name || session.user.email || 'Unknown';

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
  // Used to drive "Pending payment ₹X" indicator and the Complete state.
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
  // 2) derive agency/status for each PO
  // 3) search — client-side, instant
  // 4) agency tab — All / Your move / Waiting / Done

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

  // Derive once per PO (post advanced-filters). Metrics read from here so they
  // stay stable while the user types in the search box.
  const enrichedAll = useMemo(
    () => afterFilters.map(po => ({ po, d: derive(po, receiptSummaries, poPaymentTotals) })),
    [afterFilters, receiptSummaries, poPaymentTotals]
  );

  const enriched = useMemo(() => {
    if (!searchTerm.trim()) return enrichedAll;
    const q = searchTerm.toLowerCase();
    return enrichedAll.filter(({ po }) =>
      po.po_id?.toLowerCase().includes(q) ||
      po.stakeholders?.name?.toLowerCase().includes(q) ||
      po.stakeholders?.category?.toLowerCase().includes(q) ||
      po.projects?.name?.toLowerCase().includes(q) ||
      getItemsPreview(po).toLowerCase().includes(q)
    );
  }, [enrichedAll, searchTerm]);

  // Agency counts react to the current search/advanced-filter universe.
  const tabCounts = useMemo(() => {
    const counts: Record<string, number> = { all: enriched.length, you: 0, them: 0, done: 0 };
    for (const x of enriched) counts[x.d.agency]++;
    return counts;
  }, [enriched]);

  const visible = useMemo(
    () => activeTab === 'all' ? enriched : enriched.filter(x => x.d.agency === activeTab),
    [enriched, activeTab]
  );

  // Flat chronological list (newest first). The agency split lives in the
  // filter tabs above, so there are no in-list group headers.
  const visibleSorted = useMemo(
    () => visible.slice().sort((a, b) =>
      new Date(b.po.date_issued || b.po.created_at).getTime() - new Date(a.po.date_issued || a.po.created_at).getTime()
    ),
    [visible]
  );

  // Summary metrics (computed across the advanced-filtered universe).
  const openValue = enrichedAll.filter(x => x.d.agency !== 'done').reduce((s, x) => s + poAmount(x.po), 0);
  const yourCount = enrichedAll.filter(x => x.d.agency === 'you').length;
  const awaitingGrn = enrichedAll.filter(x => !x.d.grn && x.d.agency !== 'done').length;

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

  // ── Inline "Upload bill photo" upload ───────────────────────────────
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

  return (
    <div className="min-h-screen" style={{ background: C.paper }}>
      <div className="max-w-2xl lg:max-w-[1040px] xl:max-w-[1200px] min-[1700px]:max-w-[1640px] mx-auto px-4 sm:px-6 pb-28 min-[1700px]:grid min-[1700px]:grid-cols-[minmax(0,1fr)_340px] min-[1700px]:gap-12 min-[1700px]:items-start">

        {/* ── main column ── */}
        <div className="min-w-0">

        {/* Header */}
        <header className="pt-8 pb-5 flex items-end justify-between gap-3">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-medium" style={{ color: C.ink }}>Purchase orders</h1>
            <span className="text-xs px-2 py-0.5 rounded-full font-medium tabular-nums" style={{ background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}>
              {totalCount}
            </span>
          </div>
          {canManage && (
            <button
              onClick={() => navigate('/purchase-orders/new')}
              className="hidden sm:flex items-center gap-1.5 text-sm font-medium px-4 py-2.5 rounded-xl text-white"
              style={{ background: C.ink }}
            >
              <span className="material-symbols-outlined text-[16px]">add</span> New PO
            </button>
          )}
        </header>

        {/* Summary strip (relocates to the side rail on extra-wide screens) */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3 mb-5 min-[1700px]:hidden">
          <Metric label="Open value" value={inr(openValue)} />
          <Metric label="Your move" value={yourCount} accent={yourCount > 0} />
          <Metric label="Awaiting delivery" value={awaitingGrn} />
        </div>

        {/* Search + filters (sticky) */}
        <div className="sticky top-0 z-10 -mx-4 sm:-mx-6 px-4 sm:px-6 min-[1700px]:mx-0 min-[1700px]:px-0 py-3" style={{ background: C.paper }}>
          <div className="flex items-center gap-2 px-3.5 rounded-xl" style={{ background: C.surface, border: `1px solid ${C.line}`, height: 42 }}>
            <span className="material-symbols-outlined text-[18px]" style={{ color: C.inkFaint }}>search</span>
            <input
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              placeholder="Search vendor, PO, material"
              className="flex-1 bg-transparent text-sm outline-none"
              style={{ color: C.ink }}
            />
            {searchTerm && (
              <button onClick={() => setSearchTerm('')} aria-label="Clear search" className="shrink-0" style={{ color: C.inkFaint }}>
                <span className="material-symbols-outlined text-[18px]">close</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-2.5" role="tablist" aria-label="Filter purchase orders">
            {FILTERS.map((f) => {
              const active = activeTab === f.key;
              return (
                <button
                  key={f.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(f.key)}
                  className="text-xs font-medium px-3.5 py-2 rounded-full transition-transform active:scale-95 whitespace-nowrap"
                  style={active
                    ? { background: C.ink, color: '#fff' }
                    : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
                >
                  {f.label}
                  <span className="ml-1 tabular-nums" style={{ opacity: 0.6 }}>{tabCounts[f.key] ?? 0}</span>
                </button>
              );
            })}
            <button
              onClick={() => setShowFiltersSheet(true)}
              className="ml-auto inline-flex items-center gap-1 text-xs font-medium px-3 py-2 rounded-full shrink-0"
              style={{ background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
            >
              <span className="material-symbols-outlined text-[15px]">tune</span>
              Filters
              {advancedActiveCount > 0 && (
                <span className="ml-0.5 min-w-[16px] h-[16px] rounded-full text-white text-[10px] font-bold flex items-center justify-center px-1 bg-terracotta">
                  {advancedActiveCount}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Loading */}
        {isLoading && <div className="mt-4"><PageSkeleton /></div>}

        {/* Empty: zero POs ever */}
        {!isLoading && pos.length === 0 && (
          <div className="flex flex-col items-center text-center py-16">
            <span className="material-symbols-outlined text-[40px] mb-3" style={{ color: C.inkFaint }}>shopping_cart</span>
            <h3 className="text-base font-medium mb-1" style={{ color: C.ink }}>No purchase orders yet</h3>
            <p className="text-sm max-w-xs mb-6" style={{ color: C.inkSoft }}>
              Create your first purchase order to start tracking vendor orders and payments.
            </p>
            {canManage && (
              <button onClick={() => navigate('/purchase-orders/new')} className="px-5 py-2.5 rounded-xl text-white text-sm font-medium bg-terracotta">
                + New Purchase Order
              </button>
            )}
          </div>
        )}

        {/* Empty: search / tab returns nothing */}
        {!isLoading && pos.length > 0 && visibleSorted.length === 0 && (
          <div className="text-center py-16">
            <span className="material-symbols-outlined text-[28px] mb-3" style={{ color: C.inkFaint }}>receipt_long</span>
            <p className="text-sm" style={{ color: C.inkSoft }}>
              No purchase orders match {searchTerm ? <>&ldquo;{searchTerm}&rdquo;</> : <>this filter</>}. Clear the search or create one.
            </p>
            {hasAnyFilter && (
              <button onClick={clearAllFilters} className="text-sm mt-3 font-medium text-terracotta">Clear filters</button>
            )}
          </div>
        )}

        {/* Chronological list — newest first; filter via the tabs above.
            One card per row; each row widens with the container on larger screens. */}
        <div className="space-y-3 mt-2">
          {!isLoading && visibleSorted.map(({ po, d }, i) => (
            <div key={po.po_id} className="wo-row-animate" style={{ animationDelay: `${Math.min(i, 6) * 30}ms` }}>
              <POCard
                po={po}
                d={d}
                canManage={canManage}
                showProject
                onNavigate={() => navigate(`/purchase-orders/${po.po_id}`)}
                onReceive={() => openReceiveDrawerFor(po)}
                onEnterBill={() => setBillPO(po)}
                onAttachBill={(file) => handleAttachBill(po, file)}
                uploadingBill={!!uploadingBillIds[po.po_id]}
                onChipTap={(step) => setSheet({ po, step })}
                prefetchProps={prefetchPO(po.po_id)}
              />
            </div>
          ))}
        </div>
        </div>{/* /main column */}

        {/* ── summary rail: only on extra-wide (≥1700px) screens; below that the
              metrics sit up top and the cards widen into a multi-column grid ── */}
        <aside className="hidden min-[1700px]:block">
          <div className="sticky top-8 space-y-3">
            <Metric label="Open value" value={inr(openValue)} />
            <Metric label="Your move" value={yourCount} accent={yourCount > 0} />
            <Metric label="Awaiting delivery" value={awaitingGrn} />
          </div>
        </aside>
      </div>

      {/* Mobile FAB */}
      {canManage && (
        <button
          className="sm:hidden fixed bottom-6 right-5 w-14 h-14 rounded-full flex items-center justify-center shadow-lg transition-transform active:scale-95 text-white"
          style={{ background: C.ink }}
          onClick={() => navigate('/purchase-orders/new')}
          aria-label="New purchase order"
        >
          <span className="material-symbols-outlined text-[24px]">add</span>
        </button>
      )}

      {/* Milestone detail sheet */}
      <MilestoneSheet
        open={!!sheet.po && !!sheet.step}
        onClose={() => setSheet({ po: null, step: null })}
        po={sheet.po}
        step={sheet.step}
        summaries={receiptSummaries}
        canManage={canManage}
        onReceive={() => { if (sheet.po) openReceiveDrawerFor(sheet.po); setSheet({ po: null, step: null }); }}
        onEnterBill={() => { const p = sheet.po; setSheet({ po: null, step: null }); if (p) setBillPO(p); }}
        onNavigate={() => { if (sheet.po) navigate(`/purchase-orders/${sheet.po.po_id}`); }}
        onAttachBill={(file) => { if (sheet.po) handleAttachBill(sheet.po, file); }}
        uploadingBill={!!(sheet.po && uploadingBillIds[sheet.po.po_id])}
      />

      {/* Record bill sheet (inline "Enter bill" task) */}
      <RecordBillSheet
        open={!!billPO}
        onClose={() => setBillPO(null)}
        po={billPO}
        currentUserName={currentUserName}
        onSaved={({ billNo }) => showSnackbar(billNo ? `Bill ${billNo} recorded` : 'Vendor bill recorded')}
      />

      {/* Advanced filters sheet — date range / vendor / project */}
      <BottomSheet
        open={showFiltersSheet}
        onClose={() => setShowFiltersSheet(false)}
        title="Filters"
        desktopAllowed
      >
        <div className="space-y-5 pb-4 px-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: C.inkFaint }}>Date range</p>
            <div className="flex flex-wrap gap-2">
              {(['all','today','week','month','quarter'] as DatePreset[]).map(p => (
                <button
                  key={p}
                  onClick={() => setDatePreset(p)}
                  className="px-3 h-9 rounded-full text-[13px] font-medium"
                  style={datePreset === p
                    ? { background: C.terraWash, color: C.terraDeep }
                    : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
                >
                  {DATE_LABELS[p]}
                </button>
              ))}
            </div>
          </div>

          {vendors.length > 0 && (
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: C.inkFaint }}>
                Vendor
                {filterVendor.length > 0 && <span className="ml-2 tabular-nums" style={{ color: C.terraDeep }}>{filterVendor.length}</span>}
              </p>
              <div className="flex flex-wrap gap-2 max-h-[40vh] overflow-y-auto">
                {vendors.map(v => {
                  const on = filterVendor.includes(v);
                  return (
                    <button
                      key={v}
                      onClick={() => setFilterVendor(s => on ? s.filter(x => x !== v) : [...s, v])}
                      className="px-3 h-9 rounded-full text-[13px] font-medium truncate max-w-[200px]"
                      style={on
                        ? { background: C.terraWash, color: C.terraDeep }
                        : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
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
              <p className="text-[11px] font-semibold uppercase tracking-[0.08em] mb-2" style={{ color: C.inkFaint }}>
                Project
                {filterProject.length > 0 && <span className="ml-2 tabular-nums" style={{ color: C.terraDeep }}>{filterProject.length}</span>}
              </p>
              <div className="flex flex-wrap gap-2">
                {projects.map(p => {
                  const on = filterProject.includes(p);
                  return (
                    <button
                      key={p}
                      onClick={() => setFilterProject(s => on ? s.filter(x => x !== p) : [...s, p])}
                      className="px-3 h-9 rounded-full text-[13px] font-medium truncate max-w-[200px]"
                      style={on
                        ? { background: C.terraWash, color: C.terraDeep }
                        : { background: C.surface, color: C.inkSoft, border: `1px solid ${C.line}` }}
                    >
                      {p}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          <div className="flex gap-2 pt-2" style={{ borderTop: `1px solid ${C.line}` }}>
            <button
              onClick={() => { setDatePreset('all'); setFilterVendor([]); setFilterProject([]); }}
              className="flex-1 h-10 rounded-xl text-[13px] font-medium"
              style={{ border: `1px solid ${C.line}`, color: C.inkSoft }}
            >
              Reset
            </button>
            <button
              onClick={() => setShowFiltersSheet(false)}
              className="flex-1 h-10 rounded-xl text-[13px] font-medium text-white bg-terracotta"
            >
              Show {visible.length} result{visible.length === 1 ? '' : 's'}
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
