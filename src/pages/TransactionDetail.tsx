import { useState, useEffect, useRef, Fragment } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSignedDocUrl } from '../lib/storage';
import { Loader2, Wallet } from 'lucide-react';
import { isGeneralExpense } from '../lib/transactions';
import type { Session } from '@supabase/supabase-js';
import Breadcrumb from '../components/Breadcrumb';
import { BackLink } from '../components/BackLink';
import { useUserProfile } from '../App';
import { usePeek } from '../context/PeekContext';
import { ImageLightbox } from '../components/ImageLightbox';
import { autoCloseWOIfFullyPaid } from '../lib/woAutoClose';
import jsPDF from 'jspdf';
import StakeholderLedgerDrawer from '../components/StakeholderLedgerDrawer';

// ─── Amendment types ──────────────────────────────────────────────────────────

type AmendmentSnapshot = {
  total_amount: number;
  date: string;
  payment_mode: string;
  category: string;
  remarks: string;
};

type AmendmentRecord = {
  id: string;
  amended_by: string;
  amended_at: string;
  changes: Record<string, [any, any]>;
  snapshot: AmendmentSnapshot;
};

const CATEGORIES = [
  'Running Bill', 'Advance', 'PO Advance', 'PO Settlement',
  'Material Supply', 'Transport & Handling', 'Site Expenses',
  'Equipment Hire', 'Labour Charge', 'Other',
];

function fmtAmendVal(label: string, val: any): string {
  if (label === 'Amount') return `₹${Number(val || 0).toLocaleString()}`;
  if (label === 'Date') return val ? new Date(val).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  return String(val ?? '—');
}

// ─── Count-up hook ────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 700): number {
  const [value, setValue] = useState(0);
  const rafRef = useRef<number>(0);
  useEffect(() => {
    let start: number | null = null;
    const animate = (ts: number) => {
      if (!start) start = ts;
      const elapsed = ts - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return value;
}

// ─── Obligation linking sub-components ───────────────────────────────────────

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
function getPOBalance(po: any): number { return Number(po.vendor_bill_amount || po.total_value || 0); }

function WOObligationRow({ wo, selectedObligation, expanded, onToggleExpand, onSelect, milestonePayments }: {
  wo: any; selectedObligation: SelectedObligation | null;
  expanded: boolean; onToggleExpand: () => void;
  onSelect: (ob: SelectedObligation) => void;
  milestonePayments: Record<string, number>;
}) {
  const hasPhases = (wo.wo_milestones?.length || 0) > 0;
  const woBalance = getWOBalance(wo);
  const isSelected = selectedObligation?.wo_id === wo.wo_id && !selectedObligation?.phase_id;
  return (
    <div className={isSelected ? 'bg-[rgba(200,96,58,0.04)]' : ''}>
      <div
        className="px-4 py-3 flex items-center gap-3 cursor-pointer hover:bg-black/[0.02] transition-colors"
        onClick={hasPhases ? onToggleExpand : () => onSelect({ type: 'WO', wo_id: wo.wo_id, label: `${wo.wo_id} · ${wo.stakeholders?.name || ''}`, balance: woBalance })}
      >
        <div className="w-5 shrink-0 flex items-center justify-center">
          {hasPhases ? (
            <span className="material-symbols-outlined text-[16px] text-on-surface-variant/40">{expanded ? 'expand_more' : 'chevron_right'}</span>
          ) : isSelected ? (
            <div className="w-4 h-4 rounded-full bg-[#C8603A] flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
            </div>
          ) : (
            <div className="w-4 h-4 rounded-full border-2 border-outline-variant/40" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-[13px] font-medium text-on-surface truncate">{wo.stakeholders?.name || 'Unknown'}</p>
            <span className="font-data-mono text-[10px] text-on-surface-variant/40 shrink-0">{wo.wo_id}</span>
          </div>
          {wo.scope_of_work && <p className="text-[11px] text-on-surface-variant/50 truncate mt-0.5">{(wo.scope_of_work as string).slice(0, 60)}</p>}
        </div>
        <div className="text-right shrink-0">
          <p className={`text-[13px] font-medium font-data-mono ${woBalance > 0 ? 'text-on-surface' : 'text-on-surface-variant/40'}`}>
            {woBalance > 0 ? `₹${woBalance.toLocaleString('en-IN')}` : 'Settled'}
          </p>
          {hasPhases && <p className="text-[10px] text-on-surface-variant/40">{wo.wo_milestones.length} phases</p>}
        </div>
      </div>
      {hasPhases && expanded && (
        <div className="border-t border-black/[0.04] bg-black/[0.01]">
          {wo.wo_milestones.map((phase: any) => {
            const balance = getPhaseBalance(phase);
            const isPhaseSelected = selectedObligation?.phase_id === phase.milestone_id;
            const settled = phase.status === 'PAID' || phase.status === 'Paid';
            const paid = milestonePayments[phase.milestone_id] || 0;
            const due = balance - paid;
            return (
              <div key={phase.milestone_id}
                className={`pl-9 pr-4 py-3 flex items-center gap-3 border-b border-black/[0.03] last:border-0 transition-colors
                  ${settled ? 'opacity-50 cursor-not-allowed' : isPhaseSelected ? 'bg-[rgba(200,96,58,0.06)] cursor-pointer' : 'cursor-pointer hover:bg-black/[0.02]'}`}
                onClick={() => { if (settled) return; onSelect({ type: 'WO_PHASE', wo_id: wo.wo_id, phase_id: phase.milestone_id, label: `${phase.name} · ${wo.wo_id}`, balance }); }}
              >
                <div className="w-4 shrink-0 flex items-center justify-center">
                  {isPhaseSelected ? (
                    <div className="w-4 h-4 rounded-full bg-[#C8603A] flex items-center justify-center">
                      <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
                    </div>
                  ) : <div className="w-4 h-4 rounded-full border-2 border-outline-variant/40" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-on-surface">{phase.name}</p>
                  {phase.qty && phase.unit_type && (
                    <p className="text-[10px] text-on-surface-variant/40 mt-0.5">{phase.qty} {phase.unit_type}{phase.rate ? ` × ₹${Number(phase.rate).toLocaleString('en-IN')}` : ''}</p>
                  )}
                </div>
                <div className="text-right shrink-0 ml-3">
                  <p className="text-[13px] font-medium font-data-mono text-on-surface">₹{balance.toLocaleString('en-IN')}</p>
                  {settled
                    ? <p className="text-[10px] text-[#16A34A] font-medium">Settled ✓</p>
                    : due < 0
                      ? <p className="text-[10px] text-rose-600 font-medium">Overpaid</p>
                      : due === 0
                        ? <p className="text-[10px] text-[#16A34A] font-medium">Fully Paid</p>
                        : <p className="text-[10px] text-[#C8603A] font-medium">₹{due.toLocaleString('en-IN')} due</p>}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function POObligationRow({ po, selectedObligation, onSelect }: {
  po: any; selectedObligation: SelectedObligation | null;
  onSelect: (ob: SelectedObligation) => void;
}) {
  const balance = getPOBalance(po);
  const isSelected = selectedObligation?.po_id === po.po_id;
  return (
    <div
      className={`px-4 py-3 flex items-center gap-3 transition-colors
        ${balance <= 0 ? 'opacity-50 cursor-not-allowed' : isSelected ? 'bg-[rgba(200,96,58,0.06)] cursor-pointer' : 'cursor-pointer hover:bg-black/[0.02]'}`}
      onClick={() => { if (balance <= 0) return; onSelect({ type: 'PO', po_id: po.po_id, label: `${po.po_id} · ${po.stakeholders?.name || ''}`, balance }); }}
    >
      <div className="w-5 shrink-0 flex items-center justify-center">
        {isSelected ? (
          <div className="w-4 h-4 rounded-full bg-[#C8603A] flex items-center justify-center">
            <span className="material-symbols-outlined text-white text-[10px]" style={{ fontVariationSettings: "'FILL' 1" }}>check</span>
          </div>
        ) : <div className="w-4 h-4 rounded-full border-2 border-outline-variant/40" />}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <p className="text-[13px] font-medium text-on-surface">{po.stakeholders?.name || 'Unknown'}</p>
          <span className="font-data-mono text-[10px] text-on-surface-variant/40 shrink-0">{po.po_id}</span>
        </div>
        {po.po_line_items?.[0] && (
          <p className="text-[11px] text-on-surface-variant/50 truncate mt-0.5">
            {po.po_line_items[0].item_name || po.po_line_items[0].description || po.po_line_items[0].name || ''}
            {po.po_line_items.length > 1 && ` +${po.po_line_items.length - 1} more`}
          </p>
        )}
      </div>
      <div className="text-right shrink-0 ml-3">
        {balance > 0
          ? <><p className="text-[13px] font-medium font-data-mono text-on-surface">₹{balance.toLocaleString('en-IN')}</p><p className="text-[10px] text-[#C8603A] font-medium">due</p></>
          : <p className="text-[12px] text-[#16A34A] font-medium">Settled ✓</p>}
      </div>
    </div>
  );
}

function DetailLinkingPanel({ wos, pos, loading, selectedObligation, onSelect, onSkip, onConfirm, isPending, projectId, stkType }: {
  wos: any[]; pos: any[]; loading: boolean;
  selectedObligation: SelectedObligation | null;
  onSelect: (ob: SelectedObligation) => void;
  onSkip: () => void;
  onConfirm: (ob: SelectedObligation) => void;
  isPending: boolean;
  projectId: string;
  stkType: string;
}) {
  const nav = useNavigate();
  const [expandedWOs, setExpandedWOs] = useState<string[]>([]);
  const [milestonePayments, setMilestonePayments] = useState<Record<string, number>>({});

  useEffect(() => {
    if (wos.length === 0) { setMilestonePayments({}); return; }
    const woIds = wos.map((w: any) => w.wo_id);
    supabase.from('txn_allocations')
      .select('milestone_id, allocated_amount')
      .in('order_ref', woIds)
      .eq('order_type', 'WO')
      .not('milestone_id', 'is', null)
      .then(({ data }) => {
        const map: Record<string, number> = {};
        for (const row of (data || [])) {
          map[row.milestone_id] = (map[row.milestone_id] || 0) + Number(row.allocated_amount);
        }
        setMilestonePayments(map);
      });
  }, [wos]);
  const isWorker = stkType === 'Worker';
  const isVendor = stkType === 'Vendor';

  if (loading) {
    return (
      <div className="rounded-xl border border-outline-variant/20 p-4 space-y-3">
        <div className="h-3 w-36 bg-surface-container-highest rounded animate-pulse" />
        <div className="h-12 bg-surface-container-highest rounded-lg animate-pulse" />
        <div className="h-12 bg-surface-container-highest rounded-lg animate-pulse" />
      </div>
    );
  }

  if (wos.length === 0 && pos.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-outline-variant/30 p-5 text-center">
        <span className="material-symbols-outlined text-[28px] text-on-surface-variant/20 mb-2 block">link_off</span>
        <p className="text-[13px] font-medium text-on-surface mb-1">No open {isWorker ? 'Work Orders' : isVendor ? 'Purchase Orders' : 'WOs or POs'} found</p>
        <p className="text-[11px] text-on-surface-variant/50 mb-4">Create one to link this payment, or keep unlinked.</p>
        <div className="flex gap-2 justify-center flex-wrap">
          {isWorker && (
            <button type="button"
              onClick={() => nav(`/work-orders/new?project=${projectId}`)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-outline-variant/30 text-[12px] font-medium text-on-surface hover:bg-surface-container transition-colors">
              <span className="material-symbols-outlined text-[15px]">assignment_add</span> New Work Order
            </button>
          )}
          {isVendor && (
            <button type="button"
              onClick={() => nav(`/purchase-orders/new?project=${projectId}`)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-outline-variant/30 text-[12px] font-medium text-on-surface hover:bg-surface-container transition-colors">
              <span className="material-symbols-outlined text-[15px]">receipt_long</span> New Purchase Order
            </button>
          )}
          <button type="button" onClick={onSkip} className="px-4 py-2 rounded-lg text-[12px] text-on-surface-variant/50 hover:text-on-surface transition-colors">
            Keep unlinked
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
      <div className="px-4 py-2.5 bg-black/[0.02] border-b border-outline-variant/[0.08]">
        <p className="text-[10px] font-bold uppercase tracking-widest text-on-surface-variant/50">Link to Work Order or Purchase Order</p>
        <p className="text-[11px] text-on-surface-variant/40 mt-0.5">Select what this payment is for</p>
      </div>
      <div className="divide-y divide-outline-variant/[0.06]">
        {wos.length > 0 && (
          <div>
            <div className="px-4 py-1.5 bg-black/[0.01]">
              <p className="text-[9px] font-bold uppercase tracking-wide text-on-surface-variant/40">Work Orders ({wos.length})</p>
            </div>
            {wos.map((wo: any) => (
              <WOObligationRow key={wo.wo_id} wo={wo} selectedObligation={selectedObligation}
                expanded={expandedWOs.includes(wo.wo_id)}
                onToggleExpand={() => setExpandedWOs(prev => prev.includes(wo.wo_id) ? prev.filter(id => id !== wo.wo_id) : [...prev, wo.wo_id])}
                onSelect={onSelect} milestonePayments={milestonePayments} />
            ))}
          </div>
        )}
        {pos.length > 0 && (
          <div>
            <div className="px-4 py-1.5 bg-black/[0.01]">
              <p className="text-[9px] font-bold uppercase tracking-wide text-on-surface-variant/40">Purchase Orders ({pos.length})</p>
            </div>
            {pos.map((po: any) => (
              <POObligationRow key={po.po_id} po={po} selectedObligation={selectedObligation} onSelect={onSelect} />
            ))}
          </div>
        )}
      </div>
      <div className="px-4 py-2.5 border-t border-outline-variant/[0.08] bg-black/[0.01] flex items-center gap-2 flex-wrap">
        {selectedObligation ? (
          <>
            <div className="flex-1 min-w-0">
              <p className="text-[11px] text-on-surface-variant/50">Selected</p>
              <p className="text-[12px] font-semibold text-on-surface truncate">{selectedObligation.label}</p>
            </div>
            <button type="button" onClick={onSkip} className="text-[12px] text-on-surface-variant/40 hover:text-on-surface transition-colors">Cancel</button>
            <button type="button" onClick={() => onConfirm(selectedObligation)} disabled={isPending}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-[#C8603A] text-white text-[12px] font-semibold hover:opacity-90 disabled:opacity-50 shrink-0">
              {isPending ? <><Loader2 size={13} className="animate-spin" /> Linking…</> : <><span className="material-symbols-outlined text-[14px]">link</span> Link</>}
            </button>
          </>
        ) : (
          <>
            {isWorker && (
              <button type="button"
                onClick={() => nav(`/work-orders/new?project=${projectId}`)}
                className="flex items-center gap-1 text-[11px] font-medium text-on-surface-variant/50 hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-[13px]">add</span> New WO
              </button>
            )}
            {isVendor && (
              <button type="button"
                onClick={() => nav(`/purchase-orders/new?project=${projectId}`)}
                className="flex items-center gap-1 text-[11px] font-medium text-on-surface-variant/50 hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-[13px]">add</span> New PO
              </button>
            )}
            <button type="button" onClick={onSkip} className="ml-auto text-[12px] text-on-surface-variant/40 hover:text-on-surface transition-colors hover:underline underline-offset-2">
              Skip — keep unlinked
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Section heading ──────────────────────────────────────────────────────────
function SectionLabel({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="material-symbols-outlined text-[15px] text-on-surface-variant/40">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant/50">{label}</span>
      <div className="flex-1 h-px bg-outline-variant/15" />
    </div>
  );
}

// ─── Pill badge ───────────────────────────────────────────────────────────────
function PayModePill({ mode }: { mode: string }) {
  const icons: Record<string, string> = { NEFT: 'account_balance', UPI: 'qr_code_2', Cheque: 'article', Cash: 'payments' };
  return (
    <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-[11px] font-semibold text-on-surface-variant">
      <span className="material-symbols-outlined text-[13px]">{icons[mode] || 'payments'}</span>
      {mode}
    </span>
  );
}

// ─── PDF Generator ────────────────────────────────────────────────────────────
function generatePDF(txn: any, allocs: any[], effective: AmendmentSnapshot, isAmended: boolean) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const W = 210;
  const M = 18; // margin

  const dateStr = effective.date
    ? new Date(effective.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' })
    : '—';
  const amountStr = `INR ${Number(effective.total_amount || 0).toLocaleString('en-IN')}`;

  // ── Header band
  doc.setFillColor(26, 26, 26);
  doc.rect(0, 0, W, 36, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(16);
  doc.setTextColor(255, 255, 255);
  doc.text('BRIKLAY', M, 16);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(170, 170, 170);
  doc.text('Payment Voucher', M, 23);

  // TXN ID right side
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(200, 200, 200);
  doc.text(txn.txn_id, W - M, 16, { align: 'right' });

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8);
  doc.setTextColor(140, 140, 140);
  doc.text(dateStr, W - M, 23, { align: 'right' });

  // ── Amount hero
  doc.setFillColor(249, 248, 246);
  doc.rect(0, 36, W, 28, 'F');

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(28);
  doc.setTextColor(26, 26, 26);
  doc.text(amountStr, M, 57);

  if (isAmended) {
    doc.setFillColor(219, 234, 254);
    doc.roundedRect(W - M - 26, 46, 26, 8, 2, 2, 'F');
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(7);
    doc.setTextColor(29, 78, 216);
    doc.text('AMENDED', W - M - 13, 51.5, { align: 'center' });
  }

  if (txn.status === 'Voided') {
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(36);
    doc.setTextColor(200, 30, 30);
    doc.setGState(doc.GState({ opacity: 0.2 }));
    doc.text('VOID', W / 2, 80, { align: 'center', angle: 25 });
    doc.setGState(doc.GState({ opacity: 1 }));
  }

  // ── Divider
  let y = 72;
  doc.setDrawColor(230, 228, 225);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 10;

  // ── Two-column metadata
  const col1 = M;
  const col2 = W / 2 + 4;

  function labelVal(lx: number, ly: number, label: string, value: string, mono = false) {
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    doc.setTextColor(130, 125, 120);
    doc.text(label.toUpperCase(), lx, ly);
    doc.setFont(mono ? 'courier' : 'helvetica', 'bold');
    doc.setFontSize(10);
    doc.setTextColor(26, 26, 26);
    const lines = doc.splitTextToSize(value || '—', 80);
    doc.text(lines[0] ?? '—', lx, ly + 5.5);
    return ly + 5.5 + (lines.length > 1 ? 4 : 0);
  }

  labelVal(col1, y, 'Payee', txn.stakeholders?.name || '—');
  labelVal(col2, y, 'Payee Type', `${txn.stakeholders?.type || '—'}${txn.stakeholders?.category ? ` · ${txn.stakeholders.category}` : ''}`);
  y += 16;

  labelVal(col1, y, 'Payment Mode', effective.payment_mode || '—');
  labelVal(col2, y, 'Category', effective.category || '—');
  y += 16;

  if (effective.remarks) {
    labelVal(col1, y, 'Remarks', effective.remarks);
    y += 14;
  }

  // ── Divider
  y += 2;
  doc.setDrawColor(230, 228, 225);
  doc.line(M, y, W - M, y);
  y += 10;

  // ── Allocations table
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(130, 125, 120);
  doc.text('PROJECT ALLOCATIONS', M, y);
  y += 6;

  // Table header
  doc.setFillColor(245, 244, 242);
  doc.rect(M, y, W - M * 2, 7, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(7.5);
  doc.setTextColor(100, 95, 90);
  doc.text('PROJECT', M + 3, y + 4.8);
  doc.text('LINKED ORDER', M + 75, y + 4.8);
  doc.text('AMOUNT', W - M - 3, y + 4.8, { align: 'right' });
  y += 8;

  // Table rows
  for (const a of (allocs || [])) {
    const projName = a.projects?.name || a.project_id || '—';
    const linked = a.order_type && a.order_ref ? `${a.order_type}: ${a.order_ref}${a.wo_milestones?.name ? ` · ${a.wo_milestones.name}` : ''}` : 'Unlinked';
    const amt = `₹${Number(a.allocated_amount).toLocaleString('en-IN')}`;

    doc.setFont('helvetica', 'normal');
    doc.setFontSize(9);
    doc.setTextColor(26, 26, 26);
    const pLines = doc.splitTextToSize(projName, 68);
    doc.text(pLines[0], M + 3, y + 4.5);

    doc.setFont(a.order_type ? 'courier' : 'helvetica', a.order_type ? 'normal' : 'italic');
    doc.setFontSize(8.5);
    doc.setTextColor(a.order_type ? 29 : 120, a.order_type ? 78 : 115, a.order_type ? 216 : 110);
    doc.text(linked, M + 75, y + 4.5);

    doc.setFont('courier', 'bold');
    doc.setFontSize(9);
    doc.setTextColor(26, 26, 26);
    doc.text(amt, W - M - 3, y + 4.5, { align: 'right' });

    y += 8;
    doc.setDrawColor(235, 232, 228);
    doc.setLineWidth(0.2);
    doc.line(M, y, W - M, y);
    y += 1;
  }

  // Total row
  y += 2;
  const totalAmt = `₹${(allocs || []).reduce((s, a) => s + Number(a.allocated_amount), 0).toLocaleString('en-IN')}`;
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(130, 125, 120);
  doc.text('TOTAL', W - M - 40, y + 4);
  doc.setFont('courier', 'bold');
  doc.setFontSize(10);
  doc.setTextColor(26, 26, 26);
  doc.text(totalAmt, W - M - 3, y + 4, { align: 'right' });
  y += 14;

  // ── Footer
  doc.setDrawColor(230, 228, 225);
  doc.setLineWidth(0.3);
  doc.line(M, y, W - M, y);
  y += 6;

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setTextColor(160, 155, 150);
  doc.text(`Generated by Briklay · ${new Date().toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' } as Intl.DateTimeFormatOptions)}`, M, y);
  doc.text('This is a system-generated document.', W - M, y, { align: 'right' });

  doc.save(`${txn.txn_id}.pdf`);
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function TransactionDetail({ session }: { session: Session }) {
  const { txnId } = useParams();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const focusProjectId = searchParams.get('project');
  const navState = (location.state as { from?: string; projectId?: string; projectName?: string; backTo?: string; backLabel?: string }) || {};
  const qc = useQueryClient();

  const { data: profile } = useUserProfile(session.user.id);

  const [mappingAllocId, setMappingAllocId] = useState<string | null>(null);
  const [selectedObligation, setSelectedObligation] = useState<SelectedObligation | null>(null);
  const [projectWOs, setProjectWOs] = useState<any[]>([]);
  const [projectPOs, setProjectPOs] = useState<any[]>([]);
  const [loadingObligations, setLoadingObligations] = useState(false);
  const [voidConfirm, setVoidConfirm] = useState(false);
  const [amendStep, setAmendStep] = useState<'idle' | 'edit' | 'diff'>('idle');
  const [amendForm, setAmendForm] = useState({ total_amount: '', date: '', payment_mode: '', category: '', remarks: '' });
  const [amendError, setAmendError] = useState<string | null>(null);
  const [showAmendHistory, setShowAmendHistory] = useState(false);
  const [showTrail, setShowTrail] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);
  const [showStakeholderDrawer, setShowStakeholderDrawer] = useState(false);

  const { openPeek } = usePeek();

  const isManagement = profile?.role === 'management' || profile?.role === 'principal';
  const canVoid = profile?.role === 'management' || profile?.role === 'accountant' || profile?.role === 'principal';

  const { data: txn, isLoading: txnLoading } = useQuery({
    queryKey: ['transaction', txnId],
    queryFn: async () => {
      const { data, error } = await supabase.from('transactions').select('*, stakeholders(*)').eq('txn_id', txnId).single();
      if (error) throw error;
      return data;
    },
  });

  const { data: allocs, isLoading: allocsLoading } = useQuery({
    queryKey: ['txn_allocations', txnId],
    queryFn: async () => {
      const { data, error } = await supabase.from('txn_allocations').select('*, projects(name), wo_milestones(name)').eq('txn_id', txnId);
      if (error) throw error;
      return data;
    },
  });

  useEffect(() => {
    if (!mappingAllocId || !txn?.stakeholder_id || !allocs) {
      setProjectWOs([]); setProjectPOs([]); setSelectedObligation(null); return;
    }
    const alloc = (allocs as any[]).find((a: any) => a.allocation_id === mappingAllocId);
    if (!alloc) return;
    let cancelled = false;
    setLoadingObligations(true);
    setSelectedObligation(null);
    Promise.all([
      supabase.from('work_orders')
        .select('wo_id, scope_of_work, order_value, status, stakeholders(name, category), wo_milestones(*)')
        .eq('project_id', alloc.project_id).eq('stakeholder_id', txn.stakeholder_id)
        .not('status', 'in', '("Closed","Cancelled")').order('date_issued', { ascending: false }),
      supabase.from('purchase_orders')
        .select('po_id, status, vendor_bill_amount, total_value, stakeholders(name, category), po_line_items(*)')
        .eq('project_id', alloc.project_id).eq('stakeholder_id', txn.stakeholder_id)
        .in('status', ['ORDERED', 'BILLED', 'PARTIAL']).order('created_at', { ascending: false }),
    ]).then(([{ data: wos, error: woErr }, { data: pos, error: poErr }]) => {
      if (woErr) console.error(woErr);
      if (poErr) console.error(poErr);
      if (!cancelled) { setProjectWOs(wos || []); setProjectPOs(pos || []); setLoadingObligations(false); }
    });
    return () => { cancelled = true; };
  }, [mappingAllocId, txn?.stakeholder_id, allocs]);

  const updateAlloc = useMutation({
    mutationFn: async ({ allocId, order_type, order_ref, milestone_id }: { allocId: string; order_type: string; order_ref: string; milestone_id?: string }) => {
      const { error } = await supabase.from('txn_allocations').update({ order_type, order_ref, milestone_id: milestone_id || null }).eq('allocation_id', allocId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['txn_allocations', txnId] });
      qc.invalidateQueries({ queryKey: ['transaction', txnId] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] });
      if (vars.order_type === 'PO' && vars.order_ref) {
        qc.invalidateQueries({ queryKey: ['po_linked_txns', vars.order_ref] });
        qc.invalidateQueries({ queryKey: ['po_detail', vars.order_ref] });
        qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
        qc.invalidateQueries({ queryKey: ['po_payment_totals'] });
      }
      if (vars.order_type === 'WO' && vars.order_ref) {
        qc.invalidateQueries({ queryKey: ['wo_allocations', vars.order_ref] });
        autoCloseWOIfFullyPaid(vars.order_ref, qc);
      }
      setMappingAllocId(null); setSelectedObligation(null); setProjectWOs([]); setProjectPOs([]);
    },
  });

  const voidMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('transactions').update({ status: 'Voided', voided_by: session.user.id, voided_at: new Date().toISOString() }).eq('txn_id', txnId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transaction', txnId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); setVoidConfirm(false); },
  });

  const amendMutation = useMutation({
    mutationFn: async () => {
      if (!txn) throw new Error('Transaction not loaded.');
      if (!('amendments' in txn)) throw new Error("Amendment column missing. Run: ALTER TABLE transactions ADD COLUMN amendments jsonb DEFAULT '[]'::jsonb;");
      const userName = profile?.name || session.user.email || 'Unknown';
      const newAmendment: AmendmentRecord = {
        id: String(Date.now()), amended_by: userName, amended_at: new Date().toISOString(),
        changes: amendDiff,
        snapshot: { total_amount: Number(amendForm.total_amount), date: amendForm.date, payment_mode: amendForm.payment_mode, category: amendForm.category, remarks: amendForm.remarks },
      };
      const existing: AmendmentRecord[] = (txn as any).amendments || [];
      const { error } = await supabase.from('transactions').update({ amendments: [...existing, newAmendment] }).eq('txn_id', txnId);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['transaction', txnId] }); qc.invalidateQueries({ queryKey: ['transactions'] }); setAmendStep('idle'); setAmendError(null); setShowAmendHistory(true); },
    onError: (err: any) => setAmendError(err.message || 'Amendment failed.'),
  });

  const isLoading = txnLoading || allocsLoading;
  // documents bucket is private — resolve the stored URL to a signed URL for display.
  // This hook MUST run before the early returns below (Rules of Hooks): otherwise a cold
  // open renders the loading branch first (hook not called) then the loaded branch (hook
  // called) -> "rendered more hooks than previous render" -> blank screen. Compute the URL
  // defensively since txn may be undefined while loading.
  const proofUrl = txn ? ((txn as any).proof_document_url || txn.bill_doc_url || null) : null;
  const proofSigned = useSignedDocUrl(proofUrl);
  if (isLoading) return <div className="flex justify-center py-20"><Loader2 className="animate-spin text-primary/40" size={28} /></div>;
  if (!txn) return <div className="p-8 text-center text-on-surface-variant/50 text-[14px]">Transaction not found.</div>;

  const existingAmendments: AmendmentRecord[] = (txn as any).amendments || [];
  const latestSnapshot = existingAmendments.length > 0 ? existingAmendments[existingAmendments.length - 1].snapshot : null;
  const effective: AmendmentSnapshot = latestSnapshot ?? { total_amount: txn.total_amount, date: txn.date, payment_mode: txn.payment_mode, category: txn.category, remarks: txn.remarks };
  const isAmended = existingAmendments.length > 0;

  const amendDiff: Record<string, [any, any]> = {};
  if (amendStep === 'diff') {
    const LABELS: Record<string, [keyof AmendmentSnapshot, string]> = {
      Amount: ['total_amount', 'Amount'], Date: ['date', 'Date'], 'Payment Mode': ['payment_mode', 'Payment Mode'], Category: ['category', 'Category'], Remarks: ['remarks', 'Remarks'],
    };
    for (const [label, [key]] of Object.entries(LABELS)) {
      const oldVal = String((effective as any)[key] ?? '');
      const newVal = String((amendForm as any)[key] ?? '');
      if (oldVal !== newVal) amendDiff[label] = [(effective as any)[key], (amendForm as any)[key]];
    }
  }
  const hasDiff = Object.keys(amendDiff).length > 0;

  const openAmendModal = () => {
    setAmendForm({ total_amount: String(effective.total_amount ?? ''), date: effective.date ?? '', payment_mode: effective.payment_mode ?? '', category: effective.category ?? '', remarks: effective.remarks ?? '' });
    setAmendError(null); setAmendStep('edit');
  };

  const isImage = proofUrl?.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i);

  const needsActionType = (() => {
    if (txn.status === 'Voided') return false;
    const stkType = txn.stakeholders?.type;
    if (stkType !== 'Worker' && stkType !== 'Vendor') return false;
    const hasUnlinked = allocs?.some(a => !a.order_type);
    if (!hasUnlinked) return false;
    return stkType === 'Worker' ? 'link_wo' as const : 'link_po' as const;
  })();

  const primaryAlloc = focusProjectId
    ? (allocs?.find((a) => a.project_id === focusProjectId) ?? allocs?.[0])
    : allocs?.[0];
  const secondaryAllocs = allocs?.filter((a) => a !== primaryAlloc) ?? [];

  const txnDate = effective.date ? new Date(effective.date) : null;
  const txnDateTime = txn.created_at ? new Date(txn.created_at) : null;
  const dateStr = txnDate ? txnDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'long', year: 'numeric' }) : '—';
  const timeStr = txnDateTime ? txnDateTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }) : '';
  const isVoided = txn.status === 'Voided';

  function AmountDisplay({ amount }: { amount: number }) {
    const displayed = useCountUp(amount);
    return <span>₹{displayed.toLocaleString('en-IN')}</span>;
  }

  return (
    <div className="min-h-screen bg-[#f7f6f4]">
      <div className={`max-w-[720px] mx-auto px-4 sm:px-6 pt-6 pb-20 ${isVoided ? 'opacity-60' : ''}`}>

        {/* ── Back ───────────────────────────────────────────────── */}
        <div className="detail-reveal mb-3" style={{ animationDelay: '0ms' }}>
          <BackLink
            to={navState.backTo || (navState.from === 'project' && navState.projectId ? `/projects/${navState.projectId}/transactions` : '/ledger')}
            label={navState.backLabel || 'Transactions'}
          />
        </div>

        {/* ── Breadcrumb ─────────────────────────────────────────── */}
        <div className="detail-reveal mb-6" style={{ animationDelay: '0ms' }}>
          <Breadcrumb
            items={
              navState.from === 'project' && navState.projectName
                ? [
                    { label: 'Projects', href: '/projects' },
                    { label: navState.projectName, href: `/projects/${navState.projectId}` },
                    { label: 'Transactions', href: `/projects/${navState.projectId}/transactions` },
                    { label: txnId! },
                  ]
                : [
                    { label: 'Ledger', href: '/ledger' },
                    { label: txnId! },
                  ]
            }
          />
        </div>

        {/* ── Hero Card ──────────────────────────────────────────── */}
        <div className="detail-reveal" style={{ animationDelay: '40ms' }}>
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden mb-4">

            {/* Top color accent bar */}
            <div className={`h-1 w-full ${isVoided ? 'bg-error' : 'bg-gradient-to-r from-primary via-secondary to-tertiary'}`} />

            <div className="p-6">
              {/* Row 1: TXN ID + Status */}
              <div className="flex items-start justify-between gap-3 mb-5">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant/45 mb-1">Transaction Voucher</p>
                  <p className="font-mono text-[11px] text-on-surface-variant/50 mb-1 tracking-wide">{txn.txn_id}</p>
                  <p className="text-[12px] text-on-surface-variant/60">{dateStr}{timeStr ? ` · ${timeStr}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {isAmended && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-blue-50 text-blue-700 border border-blue-200/60">AMENDED</span>
                  )}
                  {txn.ai_flag_status === 'Flagged' && (
                    <span className="px-2.5 py-1 rounded-full text-[10px] font-bold bg-error-container text-error">FLAGGED</span>
                  )}
                  <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${
                    txn.status === 'Active'
                      ? 'bg-emerald-50 text-emerald-700 border border-emerald-200/60'
                      : txn.status === 'Voided'
                        ? 'bg-error-container text-error border border-error/20'
                        : 'bg-surface-container-high text-on-surface-variant'
                  }`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${txn.status === 'Active' ? 'bg-emerald-500' : txn.status === 'Voided' ? 'bg-error' : 'bg-on-surface-variant/40'}`} />
                    {txn.status?.toUpperCase()}
                  </span>
                </div>
              </div>

              {/* Row 2: Amount hero */}
              <div className="mb-5">
                <p className="text-[11px] font-medium text-on-surface-variant/50 mb-1 uppercase tracking-wider">Total Amount</p>
                <p className="text-[38px] font-black text-on-surface tracking-tight leading-none font-data-mono">
                  <AmountDisplay amount={Number(effective.total_amount) || 0} />
                </p>
              </div>

              {/* Row 3: Payee + Project pills */}
              <div className="flex flex-wrap gap-3 mb-5">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wider mb-1">Payee</p>
                  {txn.stakeholder_id ? (
                    <button
                      onClick={() => setShowStakeholderDrawer(true)}
                      className="group inline-flex items-center gap-1 text-[15px] font-semibold text-primary text-left max-w-full"
                    >
                      <span className="border-b border-dashed border-primary/45 group-hover:border-solid group-hover:border-primary transition-all pb-[2px] truncate">
                        {txn.stakeholders?.name || '—'}
                      </span>
                      <span className="material-symbols-outlined text-[13px] text-primary/50 group-hover:text-primary transition-colors shrink-0">
                        chevron_right
                      </span>
                    </button>
                  ) : isGeneralExpense(txn) ? (
                    <p className="inline-flex items-center gap-1.5 text-[15px] font-semibold text-on-surface">
                      <Wallet size={15} className="text-on-surface-variant/55" /> {(txn as any).ai_flag_data?.general_payee || 'General expense'}
                    </p>
                  ) : (
                    <p className="text-[15px] font-semibold text-on-surface">{txn.stakeholders?.name || '—'}</p>
                  )}
                  <p className="text-[11px] text-on-surface-variant/50 mt-0.5">
                    {isGeneralExpense(txn)
                      ? ((txn as any).ai_flag_data?.general_payee ? 'General expense · no linked party' : 'no linked party')
                      : `${txn.stakeholders?.type || ''}${txn.stakeholders?.category ? ` · ${txn.stakeholders.category}` : ''}`}
                  </p>
                </div>

                {primaryAlloc && (
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wider mb-1">Project</p>
                    <p className="text-[15px] font-semibold text-on-surface truncate">{primaryAlloc.projects?.name || primaryAlloc.project_id}</p>
                    {secondaryAllocs.length > 0 && (
                      <p className="text-[11px] text-on-surface-variant/50 mt-0.5">+{secondaryAllocs.length} more project{secondaryAllocs.length > 1 ? 's' : ''}</p>
                    )}
                  </div>
                )}
              </div>

              {/* Row 4: Meta pills */}
              <div className="flex flex-wrap gap-2">
                <PayModePill mode={effective.payment_mode || '—'} />
                {effective.category && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-[11px] font-semibold text-on-surface-variant">
                    <span className="material-symbols-outlined text-[13px]">label</span>
                    {effective.category}
                  </span>
                )}
                {txn.ref_number && (
                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-surface-container-high text-[11px] font-mono text-on-surface-variant">
                    Ref: {txn.ref_number}
                  </span>
                )}
              </div>
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-2 px-6 py-3 border-t border-outline-variant/10 bg-surface-container-low/30 flex-wrap">
              {txn.status !== 'Voided' && (
                <>
                  {isManagement && (
                    <button onClick={openAmendModal}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-outline-variant/30 text-[12px] font-semibold text-on-surface hover:bg-surface-container transition-colors">
                      <span className="material-symbols-outlined text-[14px]">edit_note</span> Amend
                    </button>
                  )}
                  {canVoid && (
                    <button onClick={() => setVoidConfirm(true)}
                      className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-error/20 text-error text-[12px] font-semibold hover:bg-error-container/20 transition-colors">
                      <span className="material-symbols-outlined text-[14px]">block</span> Void
                    </button>
                  )}
                </>
              )}

              {/* PDF Download */}
              <button
                onClick={() => generatePDF(txn, allocs || [], effective, isAmended)}
                className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-on-surface text-surface-container-lowest text-[12px] font-semibold hover:opacity-90 transition-opacity"
              >
                <span className="material-symbols-outlined text-[14px]">download</span>
                Download PDF
              </button>

              <button onClick={() => setShowTrail(v => !v)}
                className="ml-auto flex items-center gap-1 text-[11px] text-on-surface-variant/50 hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-[13px]">history</span>
                {showTrail ? 'Hide' : 'Activity Log'}
              </button>
            </div>
          </div>
        </div>

        {/* ── Needs-action banner ────────────────────────────────── */}
        {needsActionType && (
          <div className="detail-reveal mb-4" style={{ animationDelay: '60ms' }}>
            <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200/70 rounded-xl">
              <span className="material-symbols-outlined text-amber-500 text-[18px] shrink-0">link_off</span>
              <p className="text-[12px] text-amber-800 flex-1 font-medium">
                {needsActionType === 'link_wo' ? 'Payment not linked to a Work Order' : 'Payment not linked to a Purchase Order'} —{' '}
                <button onClick={() => document.getElementById('alloc-table')?.scrollIntoView({ behavior: 'smooth' })}
                  className="font-bold underline underline-offset-2">Map below</button>
              </p>
            </div>
          </div>
        )}

        {/* ── Remarks ────────────────────────────────────────────── */}
        {effective.remarks && (
          <div className="detail-reveal mb-4" style={{ animationDelay: '80ms' }}>
            <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5">
              <SectionLabel icon="notes" label="Remarks" />
              <p className="text-[14px] text-on-surface leading-relaxed whitespace-pre-wrap">{effective.remarks}</p>
            </div>
          </div>
        )}

        {/* ── AI Flag ────────────────────────────────────────────── */}
        {txn.ai_flag_status === 'Flagged' && txn.ai_flag_data && (
          <div className="detail-reveal mb-4" style={{ animationDelay: '90ms' }}>
            <div className="bg-error-container/10 rounded-2xl border border-error/15 p-5">
              <SectionLabel icon="flag" label="Flag Reason" />
              <p className="text-[13px] text-error/80 font-medium">{txn.ai_flag_data.reason || 'Transaction flagged for manual review.'}</p>
              {txn.ai_flag_data.details && (
                <pre className="mt-2 text-[10px] text-error/60 overflow-x-auto p-2 bg-error-container/20 rounded whitespace-pre-wrap">
                  {JSON.stringify(txn.ai_flag_data.details, null, 2)}
                </pre>
              )}
            </div>
          </div>
        )}

        {/* ── Proof Document ─────────────────────────────────────── */}
        {proofUrl && (
          <div className="detail-reveal mb-4" style={{ animationDelay: '100ms' }}>
            <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5">
              <SectionLabel icon="attach_file" label="Proof of Payment" />
              {isImage ? (
                <div>
                  <div
                    className="relative inline-block cursor-pointer group"
                    onClick={() => proofSigned && setLightboxUrl(proofSigned)}
                  >
                    <img
                      src={proofSigned ?? undefined}
                      alt="Payment proof"
                      className="h-32 w-auto rounded-xl object-cover border border-outline-variant/20 group-hover:opacity-90 transition-opacity"
                    />
                    <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl bg-black/20">
                      <span className="bg-black/60 text-white text-[11px] font-semibold px-3 py-1.5 rounded-full flex items-center gap-1">
                        <span className="material-symbols-outlined text-[14px]">open_in_full</span> Expand
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-on-surface-variant/50 mt-2">
                    {(txn as any).proof_document_url ? '📱 Received via WhatsApp' : '📎 Uploaded document'}
                  </p>
                </div>
              ) : (
                <a href={proofSigned ?? undefined} target="_blank" rel="noopener noreferrer"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-surface-container-low border border-outline-variant/20 text-[13px] text-primary font-semibold hover:bg-surface-container transition-colors">
                  <span className="material-symbols-outlined text-[16px]">open_in_new</span> View Document
                </a>
              )}
            </div>
          </div>
        )}

        {/* ── Project Allocations ────────────────────────────────── */}
        <div id="alloc-table" className="detail-reveal mb-4" style={{ animationDelay: '120ms' }}>
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
            <div className="p-5 pb-3">
              <SectionLabel icon="account_tree" label="Project Allocations" />
            </div>

            {/* Table */}
            <div className="overflow-x-auto">
              <table className="w-full text-left border-separate border-spacing-0">
                <thead>
                  <tr>
                    <th className="px-5 pb-3 text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest">Project</th>
                    <th className="px-4 pb-3 text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest">Linked Order</th>
                    <th className="px-5 pb-3 text-right text-[9px] font-bold text-on-surface-variant/40 uppercase tracking-widest">Amount</th>
                  </tr>
                </thead>
                <tbody>
                  {(primaryAlloc ? [primaryAlloc, ...secondaryAllocs] : (allocs || [])).map((a) => {
                    const isUnlinked = !a.order_type;
                    const isMapping = mappingAllocId === a.allocation_id;
                    const milestoneName = (a as any).wo_milestones?.name ?? null;
                    return (
                      <Fragment key={a.allocation_id}>
                        <tr className={`border-t border-outline-variant/[0.08] transition-colors ${isUnlinked && !isMapping ? 'bg-amber-50/40' : 'hover:bg-surface-container-low/30'}`}>
                          <td className="px-5 py-3.5">
                            <p className="text-[13px] font-semibold text-on-surface">{a.projects?.name || 'Unassigned'}</p>
                            <p className="text-[10px] text-on-surface-variant/40 font-mono mt-0.5">{a.project_id}</p>
                          </td>
                          <td className="px-4 py-3.5">
                            {a.order_type ? (
                              <div className="flex items-center gap-2 flex-wrap">
                                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${a.order_type === 'WO' ? 'bg-primary/10 text-primary' : 'bg-tertiary/10 text-tertiary'}`}>
                                  {a.order_type}
                                </span>
                                <button onClick={() => openPeek(a.order_type as 'WO' | 'PO', a.order_ref)}
                                  className="text-[12px] font-mono text-primary hover:underline underline-offset-2 cursor-pointer">
                                  {a.order_ref} ↗
                                </button>
                                {milestoneName && <span className="text-on-surface-variant text-[11px]">· {milestoneName}</span>}
                              </div>
                            ) : (
                              <div className="flex items-center gap-2">
                                <span className="text-[11px] text-amber-600 italic flex items-center gap-1 font-medium">
                                  <span className="material-symbols-outlined text-[13px]">link_off</span> Unlinked
                                </span>
                                <button onClick={() => setMappingAllocId(a.allocation_id)}
                                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold text-primary bg-primary/8 hover:bg-primary/15 border border-primary/15 transition-colors">
                                  <span className="material-symbols-outlined text-[12px]">link</span> Map
                                </button>
                              </div>
                            )}
                          </td>
                          <td className="px-5 py-3.5 text-right font-mono font-bold text-[13px] text-on-surface">
                            ₹{Number(a.allocated_amount).toLocaleString('en-IN')}
                          </td>
                        </tr>
                        {isMapping && (
                          <tr>
                            <td colSpan={3} className="px-5 pb-5 pt-1">
                              <DetailLinkingPanel
                                wos={projectWOs} pos={projectPOs} loading={loadingObligations}
                                selectedObligation={selectedObligation} onSelect={setSelectedObligation}
                                onSkip={() => { setMappingAllocId(null); setSelectedObligation(null); }}
                                onConfirm={(ob) => updateAlloc.mutate({
                                  allocId: a.allocation_id,
                                  order_type: ob.type === 'PO' ? 'PO' : 'WO',
                                  order_ref: ob.type === 'PO' ? ob.po_id! : ob.wo_id!,
                                  milestone_id: ob.type === 'WO_PHASE' ? ob.phase_id : undefined,
                                })}
                                isPending={updateAlloc.isPending} projectId={a.project_id} stkType={txn.stakeholders?.type || ''} />
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="border-t border-outline-variant/20">
                    <td colSpan={2} className="px-5 py-3 text-right text-[9px] font-bold uppercase tracking-widest text-on-surface-variant/50">
                      Total Allocated
                    </td>
                    <td className="px-5 py-3 text-right font-mono font-black text-[14px] text-primary">
                      ₹{(allocs || []).reduce((s, a) => s + Number(a.allocated_amount), 0).toLocaleString('en-IN')}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* ── Amendment History ──────────────────────────────────── */}
        {isAmended && (
          <div className="detail-reveal mb-4" style={{ animationDelay: '140ms' }}>
            <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
              <button
                onClick={() => setShowAmendHistory(v => !v)}
                className="w-full flex items-center gap-3 px-5 py-4 hover:bg-surface-container-low/40 transition-colors"
              >
                <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                  <span className="material-symbols-outlined text-[16px] text-blue-600">edit_note</span>
                </div>
                <div className="flex-1 text-left">
                  <p className="text-[13px] font-semibold text-on-surface">{existingAmendments.length} Amendment{existingAmendments.length > 1 ? 's' : ''}</p>
                  <p className="text-[11px] text-on-surface-variant/50">View change history</p>
                </div>
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant/40 transition-transform" style={{ transform: showAmendHistory ? 'rotate(180deg)' : '' }}>expand_more</span>
              </button>

              {showAmendHistory && (
                <div className="border-t border-outline-variant/10 divide-y divide-outline-variant/[0.07]">
                  {[...existingAmendments].reverse().map((a: any, i) => {
                    if (a.type === 'phase_move' || a.type === 'phase_move_undo') {
                      const isUndo = a.type === 'phase_move_undo';
                      return (
                        <div key={a.id} className="px-5 py-4">
                          <div className="flex items-center gap-2 mb-2">
                            <span className="material-symbols-outlined text-[14px] text-on-surface-variant/50">swap_horiz</span>
                            <p className="text-[12px] font-semibold text-on-surface">Phase {isUndo ? 'reassignment undone' : 'reassigned'} · {a.moved_by}</p>
                            <span className="text-[11px] text-on-surface-variant/50">· {new Date(a.moved_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                            {i === 0 && <span className="ml-auto px-2 py-0.5 text-[9px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200/60">LATEST</span>}
                          </div>
                          <p className="text-[12px] text-on-surface-variant pl-5">
                            <span className="line-through opacity-50">{a.from_milestone_name}</span>
                            {' → '}
                            <span className="font-semibold text-on-surface">{a.to_milestone_name}</span>
                            {a.allocated_amount && <span className="ml-2 font-mono text-on-surface-variant/60">₹{Number(a.allocated_amount).toLocaleString('en-IN')}</span>}
                          </p>
                        </div>
                      );
                    }
                    return (
                      <div key={a.id} className="px-5 py-4">
                        <div className="flex items-center gap-2 mb-2">
                          <p className="text-[12px] font-semibold text-on-surface">Amended by {a.amended_by}</p>
                          <span className="text-[11px] text-on-surface-variant/50">· {new Date(a.amended_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
                          {i === 0 && <span className="ml-auto px-2 py-0.5 text-[9px] font-bold rounded-full bg-blue-50 text-blue-700 border border-blue-200/60">LATEST</span>}
                        </div>
                        <div className="flex flex-wrap gap-x-6 gap-y-1.5">
                          {Object.entries(a.changes || {}).map(([label, vals]) => {
                            const [oldVal, newVal] = vals as [any, any];
                            return (
                              <p key={label} className="text-[12px] text-on-surface-variant">
                                <span className="font-semibold text-on-surface">{label}:</span>{' '}
                                <span className="line-through opacity-50">{fmtAmendVal(label, oldVal)}</span>
                                {' → '}
                                <span className="text-blue-700 font-semibold">{fmtAmendVal(label, newVal)}</span>
                              </p>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Activity Log ───────────────────────────────────────── */}
        {showTrail && (
          <div className="detail-reveal mb-4" style={{ animationDelay: '0ms' }}>
            <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5">
              <SectionLabel icon="history" label="Activity Log" />
              <div className="space-y-3">
                <div className="flex items-start gap-3">
                  <div className="mt-1 w-5 h-5 rounded-full bg-emerald-100 flex items-center justify-center shrink-0">
                    <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  </div>
                  <div>
                    <p className="text-[12px] font-semibold text-on-surface">Transaction recorded</p>
                    <p className="text-[11px] text-on-surface-variant/50">{new Date(txn.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</p>
                  </div>
                </div>
                {isVoided && (
                  <div className="flex items-start gap-3">
                    <div className="mt-1 w-5 h-5 rounded-full bg-error-container flex items-center justify-center shrink-0">
                      <span className="material-symbols-outlined text-[12px] text-error">block</span>
                    </div>
                    <div>
                      <p className="text-[12px] font-semibold text-error">Voided</p>
                      <p className="text-[11px] text-on-surface-variant/50">{txn.voided_at ? new Date(txn.voided_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── VOID STAMP ─────────────────────────────────────────────── */}
      {isVoided && (
        <div className="pointer-events-none fixed top-32 right-10 z-10"
          style={{ transform: 'rotate(-18deg)' }}>
          <div className="border-[3px] border-red-500 text-red-500 font-black text-[28px] px-4 py-2 rounded-lg tracking-widest opacity-30">
            VOID
          </div>
        </div>
      )}

      {/* ── VOID CONFIRM MODAL ──────────────────────────────────────── */}
      {voidConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setVoidConfirm(false); }}>
          <div className="bg-white rounded-2xl shadow-2xl border border-outline-variant/20 w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px] text-error">block</span>
              </div>
              <h3 className="text-[17px] font-bold text-error">Void Transaction</h3>
            </div>
            <p className="text-[13px] text-on-surface-variant mb-5 leading-relaxed">
              Void <strong className="font-mono text-on-surface">{txn.txn_id}</strong> for{' '}
              <strong className="font-mono">₹{Number(effective.total_amount).toLocaleString('en-IN')}</strong>?
              This will be permanently excluded from all reports.
            </p>
            {voidMutation.isError && (
              <p className="text-error text-[13px] mb-4 p-3 bg-error-container/30 rounded-xl">
                {(voidMutation.error as any)?.message || 'Failed to void transaction.'}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setVoidConfirm(false)}
                className="px-5 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-semibold text-on-surface hover:bg-surface-container-low transition-colors">
                Go Back
              </button>
              <button onClick={() => voidMutation.mutate()} disabled={voidMutation.isPending}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-error text-white font-semibold text-[13px] hover:bg-error/90 disabled:opacity-50 transition-opacity">
                {voidMutation.isPending ? <Loader2 size={15} className="animate-spin" /> : <span className="material-symbols-outlined text-[15px]">block</span>}
                Void Transaction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── IMAGE LIGHTBOX ───────────────────────────────────────────── */}
      <ImageLightbox url={lightboxUrl} title="Payment Proof" onClose={() => setLightboxUrl(null)} />

      {/* ── AMEND MODAL ─────────────────────────────────────────────── */}
      {amendStep !== 'idle' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setAmendStep('idle'); setAmendError(null); } }}>
          <div className="bg-white rounded-2xl shadow-2xl border border-outline-variant/20 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">

            {amendStep === 'edit' && (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-blue-700">edit_note</span>
                  </div>
                  <div>
                    <h3 className="text-[17px] font-bold text-on-surface">Amend Transaction</h3>
                    <p className="text-[11px] text-on-surface-variant/50 font-mono">{txn.txn_id}</p>
                  </div>
                </div>

                <div className="mb-5 p-4 bg-surface-container-low rounded-xl border border-outline-variant/20 space-y-2">
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-2">Non-amendable fields</p>
                  {[{ label: 'TXN ID', value: txn.txn_id }, { label: 'Payee', value: `${txn.stakeholders?.name || 'Unknown'} · ${txn.stakeholders?.type || ''}` }].map((f) => (
                    <div key={f.label} className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[14px] text-on-surface-variant/40 shrink-0">lock</span>
                      <div>
                        <p className="text-[10px] font-bold text-on-surface-variant">{f.label}</p>
                        <p className="text-[13px] text-on-surface-variant">{f.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Amount (₹)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-mono font-bold text-on-surface">₹</span>
                      <input type="number" min="0" step="0.01" value={amendForm.total_amount}
                        onChange={(e) => setAmendForm(f => ({ ...f, total_amount: e.target.value }))}
                        className="bk-input pl-8 font-mono font-bold" />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Date</label>
                    <input type="date" value={amendForm.date} onChange={(e) => setAmendForm(f => ({ ...f, date: e.target.value }))} className="bk-input" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Payment Mode</label>
                    <select value={amendForm.payment_mode} onChange={(e) => setAmendForm(f => ({ ...f, payment_mode: e.target.value }))} className="bk-input">
                      {['NEFT', 'UPI', 'Cheque', 'Cash'].map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Category</label>
                    <select value={amendForm.category} onChange={(e) => setAmendForm(f => ({ ...f, category: e.target.value }))} className="bk-input">
                      {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                      {!CATEGORIES.includes(amendForm.category) && amendForm.category && <option value={amendForm.category}>{amendForm.category}</option>}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Remarks</label>
                    <textarea value={amendForm.remarks} onChange={(e) => setAmendForm(f => ({ ...f, remarks: e.target.value }))} rows={3} className="bk-input resize-none w-full" placeholder="Reason for amendment…" />
                  </div>
                </div>

                {amendError && <p className="mt-3 text-error text-[13px]">{amendError}</p>}

                <div className="flex gap-3 justify-end mt-6">
                  <button onClick={() => { setAmendStep('idle'); setAmendError(null); }}
                    className="px-5 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-semibold text-on-surface hover:bg-surface-container-low transition-colors">Cancel</button>
                  <button onClick={() => {
                    const LABELS: Record<string, keyof AmendmentSnapshot> = { Amount: 'total_amount', Date: 'date', 'Payment Mode': 'payment_mode', Category: 'category', Remarks: 'remarks' };
                    const hasDifference = Object.entries(LABELS).some(([, key]) => String((effective as any)[key] ?? '') !== String((amendForm as any)[key] ?? ''));
                    if (!hasDifference) { setAmendError('No changes detected.'); return; }
                    setAmendError(null); setAmendStep('diff');
                  }} className="bk-btn flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span> Review Changes
                  </button>
                </div>
              </>
            )}

            {amendStep === 'diff' && (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-full bg-blue-50 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-blue-700">compare_arrows</span>
                  </div>
                  <h3 className="text-[17px] font-bold text-on-surface">Confirm Amendment</h3>
                </div>
                <p className="text-[13px] text-on-surface-variant mb-4">You are making the following changes:</p>
                {!hasDiff ? (
                  <p className="text-on-surface-variant italic text-[13px] mb-4">No changes detected.</p>
                ) : (
                  <div className="space-y-2 mb-5">
                    {Object.entries(amendDiff).map(([label, [oldVal, newVal]]) => (
                      <div key={label} className="flex items-start gap-3 p-3.5 bg-blue-50/60 rounded-xl border border-blue-100/80">
                        <span className="material-symbols-outlined text-[16px] text-blue-400 mt-0.5 shrink-0">swap_horiz</span>
                        <div>
                          <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wide mb-1">{label}</p>
                          <p className="text-[13px]">
                            <span className="line-through text-on-surface-variant/50 mr-2">{fmtAmendVal(label, oldVal)}</span>
                            <span className="text-blue-700 font-semibold">{fmtAmendVal(label, newVal)}</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {amendError && <p className="text-error text-[13px] mb-4 p-3 bg-error-container/30 rounded-xl whitespace-pre-wrap">{amendError}</p>}
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setAmendStep('edit'); setAmendError(null); }}
                    className="flex items-center gap-1.5 px-5 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-semibold text-on-surface hover:bg-surface-container-low transition-colors">
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span> Go Back
                  </button>
                  <button onClick={() => amendMutation.mutate()} disabled={amendMutation.isPending || !hasDiff} className="bk-btn flex items-center gap-2 disabled:opacity-50">
                    {amendMutation.isPending
                      ? <><Loader2 size={15} className="animate-spin" /> Saving…</>
                      : <><span className="material-symbols-outlined text-[16px]">check_circle</span> Confirm Amendment</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Stakeholder Ledger Drawer */}
      {txn && txn.stakeholder_id && (
        <StakeholderLedgerDrawer
          isOpen={showStakeholderDrawer}
          onClose={() => setShowStakeholderDrawer(false)}
          stakeholderId={txn.stakeholder_id}
        />
      )}
    </div>
  );
}
