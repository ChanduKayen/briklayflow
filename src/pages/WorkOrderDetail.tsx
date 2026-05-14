import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Breadcrumb from '../components/Breadcrumb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2, ArrowLeft, Download } from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { usePeek } from '../context/PeekContext';
import type { StatusHistoryEntry, PaymentMode } from '../types';
import {
  fmtDate as pdfFmtDate, fmtRupee,
  MARGIN, CONTENT, RIGHT, C,
  setColor, setFill, drawRule,
  sectionLabel, valueText, drawHeader, drawFooter, drawSignatures,
} from '../lib/pdfHelpers';

type ConfirmAction = 'approve' | 'issue' | 'activate' | 'close' | 'cancel';
type MilestoneStatus = 'PENDING' | 'DUE' | 'PARTIALLY_PAID' | 'PAID' | 'OVERPAID';

// ─── Status badge helpers ────────────────────────────────────────────────────

export function statusBadgeClass(status: string) {
  switch (status) {
    case 'Draft':     return 'bg-surface-container-high text-on-surface-variant';
    case 'Assigned':  return 'bg-blue-50 text-blue-700';
    case 'Issued':    return 'bg-violet-100 text-violet-800';
    case 'Active':    return 'bg-amber-100 text-amber-800';
    case 'Closed':    return 'bg-green-100 text-green-800';
    case 'Cancelled': return 'bg-rose-50 text-rose-700';
    default:          return 'bg-surface-container-high text-on-surface-variant';
  }
}

function statusDotColor(status: string) {
  switch (status) {
    case 'Draft':     return 'bg-on-surface-variant/50';
    case 'Assigned':  return 'bg-blue-500';
    case 'Issued':    return 'bg-violet-600';
    case 'Active':    return 'bg-amber-500';
    case 'Closed':    return 'bg-green-500';
    case 'Cancelled': return 'bg-rose-600';
    default:          return 'bg-on-surface-variant/30';
  }
}

const OVERPAID_TOLERANCE = 100; // within ₹100 is treated as fully paid

function getMilestoneStatus(milestone: any, paid: number): MilestoneStatus {
  const planned = Number(milestone.planned_amount) || 0;
  if (planned > 0 && paid > planned + OVERPAID_TOLERANCE) return 'OVERPAID';
  if (planned > 0 && paid >= planned - OVERPAID_TOLERANCE) return 'PAID';
  if (paid > 0) return 'PARTIALLY_PAID';
  const d = milestone.due_date ? new Date(milestone.due_date) : null; // due_date is optional; may be null
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d && !isNaN(d.getTime()) && d < today) return 'DUE';
  return 'PENDING';
}

const ACTION_TO_STATUS: Record<ConfirmAction, string> = {
  approve: 'Assigned', issue: 'Issued', activate: 'Active', close: 'Closed', cancel: 'Cancelled',
};

const FLOW_STATES = ['Draft', 'Assigned', 'Issued', 'Active', 'Closed'] as const;

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d; // return raw if not a date
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function isDueDate(s: string | null | undefined): boolean {
  if (!s) return false;
  const d = new Date(s);
  if (isNaN(d.getTime())) return false;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return d < today;
}

// ─── Count-up hook ────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 500): number {
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

// ─── Component ───────────────────────────────────────────────────────────────

export default function WorkOrderDetail({ session }: { session: Session }) {
  const { woId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { openPeek } = usePeek();
  const navState = (location.state as { from?: string; projectId?: string; projectName?: string }) || {};

  const { data: profile } = useUserProfile(session.user.id);

  // Status transition state
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Status log toggle
  const [showLog, setShowLog] = useState(false);

  // Expanded milestone (one at a time)
  const [expandedMilestone, setExpandedMilestone] = useState<string | null>(null);

  // Phase-shift popover
  const [shiftPopover, setShiftPopover] = useState<{
    allocId: string; txnId: string; amount: number; currentMilestoneId: string | null;
  } | null>(null);
  const [shiftTarget, setShiftTarget] = useState<string>('');
  const [exitingAllocIds, setExitingAllocIds] = useState<Set<string>>(new Set());

  // Snackbar
  const snackbarTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [snackbar, setSnackbar] = useState<{
    msg: string;
    undoData: {
      allocId: string; originalMilestoneId: string | null; originalMilestoneName: string;
      targetMilestoneName: string; txnId: string; amount: number;
    } | null;
  } | null>(null);

  // Release payment state
  const [releaseModal, setReleaseModal] = useState<{ milestone: any; remaining: number } | null>(null);
  const [releaseAmount, setReleaseAmount] = useState('');
  const [releaseMode, setReleaseMode] = useState<PaymentMode>('NEFT');
  const [releaseDate, setReleaseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [releaseRemarks, setReleaseRemarks] = useState('');
  const [releaseError, setReleaseError] = useState<string | null>(null);

  // Closed celebration state
  const [showClosedMsg, setShowClosedMsg] = useState(true);

  const canApprove    = profile?.role === 'management' || profile?.role === 'principal';
  const canTransition = profile?.role === 'management' || profile?.role === 'accountant';

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: wo, isLoading: loadingWo } = useQuery({
    queryKey: ['wo', woId],
    queryFn: async () => {
      if (!woId) throw new Error('No WO ID');
      const { data, error } = await supabase
        .from('work_orders')
        .select(`
          *,
          projects(name, site_location),
          stakeholders(name, category, contact),
          wo_milestones(*)
        `)
        .eq('wo_id', woId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!woId,
  });

  const { data: allocations, isLoading: loadingAllocs } = useQuery({
    queryKey: ['wo_allocations', woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('*, transactions(txn_id, date, status, total_amount, payment_mode, category, remarks)')
        .eq('order_type', 'WO')
        .eq('order_ref', woId);
      if (error) throw error;
      return data.filter((a: any) => a.transactions?.status !== 'Voided');
    },
    enabled: !!woId,
  });

  // ─── Status transition mutation ────────────────────────────────────────────

  const transitionMutation = useMutation({
    mutationFn: async (newStatus: string) => {
      const userName = profile?.name || session.user.email || 'Unknown';
      const newEntry: StatusHistoryEntry = { status: newStatus, at: new Date().toISOString(), by: userName };
      const updatePayload: Record<string, any> = { status: newStatus };
      if (wo && 'status_history' in wo) {
        updatePayload.status_history = [...((wo as any).status_history || []), newEntry];
      }
      const { data, error } = await supabase
        .from('work_orders').update(updatePayload).eq('wo_id', woId).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wo', woId] });
      queryClient.invalidateQueries({ queryKey: ['work_orders'] });
      queryClient.invalidateQueries({ queryKey: ['stakeholder_wos'] });
      setConfirmAction(null);
      setTransitionError(null);
    },
    onError: (err: any) => setTransitionError(err.message || 'Transition failed.'),
  });

  // ─── Approve mutation ─────────────────────────────────────────────────────

  const approveMutation = useMutation({
    mutationFn: async () => {
      const updatePayload: Record<string, any> = {
        status: 'Assigned',
      };
      const { data, error } = await supabase
        .from('work_orders').update(updatePayload).eq('wo_id', woId).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wo', woId] });
      queryClient.invalidateQueries({ queryKey: ['work_orders'] });
      queryClient.invalidateQueries({ queryKey: ['nav_wo_pending'] });
      setConfirmAction(null);
      setTransitionError(null);
    },
    onError: (err: any) => setTransitionError(err.message || 'Approval failed.'),
  });

  // ─── Release payment mutation ──────────────────────────────────────────────

  const releaseMutation = useMutation({
    mutationFn: async () => {
      if (!releaseModal || !wo) throw new Error('No milestone selected.');
      const amount = parseFloat(releaseAmount);
      if (!amount || amount <= 0) throw new Error('Enter a valid amount.');
      if (!releaseDate) throw new Error('Select a payment date.');

      const txnId = `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;

      // 1. Create transaction
      const { error: txnError } = await supabase.from('transactions').insert([{
        txn_id: txnId,
        stakeholder_id: wo.stakeholder_id,
        date: releaseDate,
        total_amount: amount,
        payment_mode: releaseMode,
        category: 'Running Bill',
        remarks: releaseRemarks || `Payment for ${releaseModal.milestone.name}`,
        status: 'Active',
        ai_flag_status: 'Clean',
        ai_flag_data: null,
        entered_by: session.user.id,
      }]);
      if (txnError) throw txnError;

      // 2. Create allocation linked to this WO + milestone
      const { error: allocError } = await supabase.from('txn_allocations').insert([{
        txn_id: txnId,
        project_id: wo.project_id,
        order_type: 'WO',
        order_ref: wo.wo_id,
        milestone_id: releaseModal.milestone.milestone_id,
        allocated_amount: amount,
      }]);
      if (allocError) throw allocError;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wo_allocations', woId] });
      queryClient.invalidateQueries({ queryKey: ['transactions'] });
      queryClient.invalidateQueries({ queryKey: ['stakeholder_txns', wo?.stakeholder_id] });
      setReleaseModal(null);
      setReleaseAmount('');
      setReleaseRemarks('');
      setReleaseError(null);
    },
    onError: (err: any) => setReleaseError(err.message || 'Failed to release payment.'),
  });

  // ─── Phase-shift mutation ──────────────────────────────────────────────────

  const shiftPhaseMutation = useMutation({
    mutationFn: async (vars: {
      allocId: string; newMilestoneId: string | null; txnId: string; amount: number;
      fromName: string; toName: string; fromId: string | null;
    }) => {
      const userName = profile?.name || session.user.email || 'Unknown';

      const { error: allocErr } = await supabase
        .from('txn_allocations')
        .update({ milestone_id: vars.newMilestoneId })
        .eq('allocation_id', vars.allocId);
      if (allocErr) throw allocErr;

      const { data: txnRow } = await supabase
        .from('transactions').select('amendments').eq('txn_id', vars.txnId).single();
      const existing = (txnRow?.amendments as any[]) || [];
      await supabase.from('transactions').update({
        amendments: [...existing, {
          id: String(Date.now()), type: 'phase_move', moved_by: userName,
          moved_at: new Date().toISOString(), from_milestone_id: vars.fromId,
          to_milestone_id: vars.newMilestoneId, from_milestone_name: vars.fromName,
          to_milestone_name: vars.toName, allocated_amount: vars.amount,
        }],
      }).eq('txn_id', vars.txnId);

    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ['wo_allocations', woId] });
      queryClient.invalidateQueries({ queryKey: ['wo', woId] });
      setExitingAllocIds(new Set());
      if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
      setSnackbar({
        msg: `${vars.txnId} moved to ${vars.toName}`,
        undoData: {
          allocId: vars.allocId, originalMilestoneId: vars.fromId,
          originalMilestoneName: vars.fromName, targetMilestoneName: vars.toName,
          txnId: vars.txnId, amount: vars.amount,
        },
      });
      snackbarTimerRef.current = setTimeout(() => setSnackbar(null), 5000);
    },
    onError: () => setExitingAllocIds(new Set()),
  });

  const undoShiftMutation = useMutation({
    mutationFn: async (ud: NonNullable<typeof snackbar>['undoData']) => {
      if (!ud) return;
      const userName = profile?.name || session.user.email || 'Unknown';

      const { error: allocErr } = await supabase
        .from('txn_allocations')
        .update({ milestone_id: ud.originalMilestoneId })
        .eq('allocation_id', ud.allocId);
      if (allocErr) throw allocErr;

      const { data: txnRow } = await supabase
        .from('transactions').select('amendments').eq('txn_id', ud.txnId).single();
      const existing = (txnRow?.amendments as any[]) || [];
      await supabase.from('transactions').update({
        amendments: [...existing, {
          id: String(Date.now()), type: 'phase_move_undo', moved_by: userName,
          moved_at: new Date().toISOString(), from_milestone_name: ud.targetMilestoneName,
          to_milestone_name: ud.originalMilestoneName, allocated_amount: ud.amount,
        }],
      }).eq('txn_id', ud.txnId);

    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wo_allocations', woId] });
      queryClient.invalidateQueries({ queryKey: ['wo', woId] });
      if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
      setSnackbar({ msg: 'Move undone', undoData: null });
      snackbarTimerRef.current = setTimeout(() => setSnackbar(null), 2000);
    },
  });

  // ─── PDF export ────────────────────────────────────────────────────────────

  const handleDownloadPdf = () => {
    if (!wo) return;
    const doc = new jsPDF('p', 'mm', 'a4');

    // ── Header ────────────────────────────────────────────────────────────────
    let y = drawHeader(doc, 'WORK ORDER', wo.wo_id);

    // ── Identity block ────────────────────────────────────────────────────────
    const rx = MARGIN + CONTENT / 2;

    // Left: ISSUED TO
    sectionLabel(doc, 'ISSUED TO', MARGIN, y);
    y += 4;
    valueText(doc, wo.stakeholders?.name ?? '—', MARGIN, y, { bold: true, size: 11 });
    y += 5;
    valueText(doc, wo.stakeholders?.category ?? '', MARGIN, y, { color: C.muted, size: 8 });
    y += 4;

    // Right: PROJECT (same y block)
    let ry = y - 13;
    sectionLabel(doc, 'PROJECT', rx, ry);
    ry += 4;
    valueText(doc, wo.projects?.name ?? '—', rx, ry, { bold: true, size: 11 });
    ry += 5;
    if (wo.projects?.site_location) {
      valueText(doc, wo.projects.site_location, rx, ry, { color: C.muted, size: 8 });
    }

    y += 2;

    // Issued + Status row
    sectionLabel(doc, 'ISSUED', MARGIN, y);
    sectionLabel(doc, 'STATUS', rx, y);
    y += 4;
    valueText(doc, pdfFmtDate(wo.date_issued), MARGIN, y, { size: 9 });
    valueText(doc, wo.status?.toUpperCase() ?? '—', rx, y, { size: 9, bold: true, color: wo.status === 'Active' ? C.warning : wo.status === 'Closed' ? C.success : C.muted });
    y += 8;

    drawRule(doc, y);
    y += 7;

    // ── Scope of work ─────────────────────────────────────────────────────────
    if (wo.scope_of_work) {
      sectionLabel(doc, 'SCOPE OF WORK', MARGIN, y);
      y += 4;
      doc.setFontSize(9);
      doc.setFont('helvetica', 'normal');
      setColor(doc, C.dark);
      const lines = doc.splitTextToSize(wo.scope_of_work, CONTENT);
      doc.text(lines, MARGIN, y);
      y += lines.length * 4.5 + 6;
      drawRule(doc, y);
      y += 7;
    }

    // ── Financial summary ─────────────────────────────────────────────────────
    sectionLabel(doc, 'FINANCIAL SUMMARY', MARGIN, y);
    y += 6;

    const rows: [string, number][] = [
      ['Order Value',  orderValue],
      ['Total Paid',   totalPaid],
      ['Balance Due',  balance],
    ];

    rows.forEach(([label, val], i) => {
      const isLast = i === rows.length - 1;
      doc.setFontSize(9);
      doc.setFont('helvetica', isLast ? 'bold' : 'normal');
      setColor(doc, isLast && balance > 0 ? C.warning : C.dark);
      doc.text(label, MARGIN, y);
      doc.setFont('courier', isLast ? 'bold' : 'normal');
      doc.text(fmtRupee(val), RIGHT, y, { align: 'right' });
      y += 5.5;
    });

    // Payment progress bar
    y += 2;
    const barW = CONTENT;
    const barH = 2.5;
    setFill(doc, C.border);
    doc.roundedRect(MARGIN, y, barW, barH, 1, 1, 'F');
    if (progressPercentage > 0) {
      setFill(doc, progressPercentage >= 100 ? C.success : C.accent);
      doc.roundedRect(MARGIN, y, barW * (progressPercentage / 100), barH, 1, 1, 'F');
    }
    y += barH + 3;
    doc.setFontSize(7);
    doc.setFont('helvetica', 'normal');
    setColor(doc, C.muted);
    doc.text(`Payment: ${progressPercentage}%`, MARGIN, y);
    y += 6;

    drawRule(doc, y);
    y += 7;

    // ── Milestones table ──────────────────────────────────────────────────────
    if (milestones && milestones.length > 0) {
      sectionLabel(doc, 'PAYMENT MILESTONES', MARGIN, y);
      y += 4;

      const msHead = [['#', 'Milestone', 'Amount', 'Status']];
      const msBody = ((wo as any).wo_milestones ?? []).map((m: any, msIdx: number) => {
        const paid = milestonePayments[m.milestone_id] || 0;
        const status = getMilestoneStatus(m, paid);
        const statusStr = status === 'PAID' ? 'PAID ✓' : status === 'PARTIALLY_PAID' ? 'PARTIAL' : status === 'DUE' ? 'DUE' : 'PENDING';
        return [
          String(msIdx + 1),
          m.name ?? '',
          fmtRupee(Number(m.planned_amount) || 0),
          statusStr,
        ];
      });

      autoTable(doc, {
        startY: y,
        head: msHead,
        body: msBody,
        theme: 'plain',
        columnStyles: {
          0: { cellWidth: 10,  halign: 'center', font: 'courier', fontSize: 8 },
          1: { cellWidth: 98,  font: 'helvetica' },
          2: { cellWidth: 40,  halign: 'right',  font: 'courier' },
          3: { cellWidth: 34,  halign: 'center', font: 'helvetica' },
        },
        headStyles: {
          fillColor: C.bg, textColor: C.muted as any,
          fontStyle: 'bold', fontSize: 7, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
        },
        bodyStyles: { fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } },
        alternateRowStyles: { fillColor: C.bg },
        footStyles: {
          fillColor: C.white, textColor: C.dark as any,
          fontStyle: 'bold', fontSize: 9,
        },
        foot: [['', 'Total', fmtRupee(orderValue), '']],
        showFoot: 'lastPage',
        margin: { left: MARGIN, right: MARGIN },
        didParseCell: (data: any) => {
          if (data.section === 'body' && data.column.index === 3) {
            const val = String(data.cell.raw);
            if (val.includes('✓')) data.cell.styles.textColor = C.success;
            else if (val === 'DUE') data.cell.styles.textColor = C.warning;
          }
        },
      });

      y = (doc as any).lastAutoTable.finalY + 8;
      drawRule(doc, y);
      y += 7;
    }

    // ── Payments made ─────────────────────────────────────────────────────────
    if (allocations && allocations.length > 0) {
      sectionLabel(doc, 'PAYMENTS MADE', MARGIN, y);
      y += 4;

      const paymentsBody = allocations.map((a: any) => {
        const t = a.transactions;
        return [
          t ? pdfFmtDate(t.date) : '—',
          t?.txn_id ?? '—',
          t?.category ?? '—',
          t?.payment_mode ?? '—',
          fmtRupee(Number(a.allocated_amount) || 0),
        ];
      });

      autoTable(doc, {
        startY: y,
        head: [['Date', 'TXN ID', 'Category', 'Mode', 'Amount']],
        body: paymentsBody,
        theme: 'plain',
        columnStyles: {
          0: { cellWidth: 28, font: 'helvetica' },
          1: { cellWidth: 42, font: 'courier', fontSize: 7.5 },
          2: { cellWidth: 48, font: 'helvetica' },
          3: { cellWidth: 24, halign: 'center', font: 'helvetica' },
          4: { cellWidth: 40, halign: 'right', font: 'courier' },
        },
        headStyles: {
          fillColor: C.bg, textColor: C.muted as any,
          fontStyle: 'bold', fontSize: 7, cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
        },
        bodyStyles: { fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } },
        margin: { left: MARGIN, right: MARGIN },
      });

      y = (doc as any).lastAutoTable.finalY + 8;
    }

    // ── Terms ─────────────────────────────────────────────────────────────────
    if (y < 220) {
      drawRule(doc, y);
      y += 7;
      sectionLabel(doc, 'TERMS & CONDITIONS', MARGIN, y);
      y += 5;
      const terms = [
        '1. Work to be executed as per approved drawings and specifications.',
        '2. Payment shall be released upon milestone completion and site verification.',
        '3. Defects liability period: 12 months from date of completion.',
        '4. Any variations must be approved in writing before execution.',
      ];
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      setColor(doc, C.mid);
      terms.forEach((t) => {
        const wrapped = doc.splitTextToSize(t, CONTENT);
        doc.text(wrapped, MARGIN, y);
        y += wrapped.length * 4 + 1.5;
      });
      y += 4;
    }

    // ── Signatures ────────────────────────────────────────────────────────────
    drawRule(doc, y);
    y += 8;
    drawSignatures(doc, y, 'Contractor Signature', wo.stakeholders?.name);

    // ── Footer ────────────────────────────────────────────────────────────────
    drawFooter(doc);

    doc.save(`WorkOrder_${wo.wo_id}.pdf`);
  };

  // ─── Closed celebration effect ─────────────────────────────────────────────

  useEffect(() => {
    if (wo?.status === 'Closed') {
      setShowClosedMsg(true);
      const t = setTimeout(() => setShowClosedMsg(false), 3000);
      return () => clearTimeout(t);
    }
  }, [wo?.status]);

  // ─── Loading / not found ───────────────────────────────────────────────────

  if (loadingWo || loadingAllocs) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="animate-spin text-secondary" size={48} />
      </div>
    );
  }

  if (!wo) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <div className="bg-error-container text-on-error-container p-6 rounded-xl">
          <h3 className="text-headline-md font-headline-md">Work Order Not Found</h3>
          <button onClick={() => navigate('/work-orders')} className="mt-4 flex items-center gap-2 hover:underline">
            <ArrowLeft size={16} /> Back to Work Orders
          </button>
        </div>
      </div>
    );
  }

  // ─── Calculations ──────────────────────────────────────────────────────────

  const milestones: any[] = (wo as any).wo_milestones ?? [];
  const orderValue = Number(wo.order_value) || 0;
  const milestonePayments: Record<string, number> = {};
  let totalPaid = 0;
  allocations?.forEach((alloc: any) => {
    const amount = Number(alloc.allocated_amount) || 0;
    totalPaid += amount;
    if (alloc.milestone_id) {
      milestonePayments[alloc.milestone_id] = (milestonePayments[alloc.milestone_id] || 0) + amount;
    }
  });
  const balance = orderValue - totalPaid; // Cr positive = payable, Dr negative = advance/overpaid
  const progressPercentage = orderValue > 0 ? Math.min(100, Math.round((totalPaid / orderValue) * 100)) : 0;

  // Overpaid phases (for warning in FINANCIAL section)
  const overpaidPhases = (milestones || []).filter((m: any) => {
    const planned = Number(m.planned_amount) || 0;
    const paid = milestonePayments[m.milestone_id] || 0;
    return planned > 0 && paid > planned + OVERPAID_TOLERANCE;
  });

  // Group allocations by milestone_id
  const milestoneTxns: Record<string, any[]> = {};
  const unallocatedPayments: any[] = [];
  allocations?.forEach((a: any) => {
    if (a.milestone_id) {
      if (!milestoneTxns[a.milestone_id]) milestoneTxns[a.milestone_id] = [];
      milestoneTxns[a.milestone_id].push(a);
    } else {
      unallocatedPayments.push(a);
    }
  });

  // ─── Audit trail data ──────────────────────────────────────────────────────

  const statusHistory: StatusHistoryEntry[] = (wo as any).status_history || [];
  const isCancelled = wo.status === 'Cancelled';
  const currentFlowIdx = FLOW_STATES.indexOf(wo.status as any);
  const cancelledEntry = isCancelled ? statusHistory.find((e) => e.status === 'Cancelled') : null;

  const getHistoryEntry = (status: string) => {
    if (status === 'Draft') return { at: wo.created_at, by: wo.created_by || '—' };
    return statusHistory.find((e) => e.status === status) || null;
  };

  // Count-up inner component
  function AmountDisplay({ amount }: { amount: number }) {
    const displayed = useCountUp(amount);
    return <span className="count-up-amount">₹{displayed.toLocaleString('en-IN')}</span>;
  }

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-12">
      <div className="max-w-[680px] mx-auto">

        {/* BREADCRUMB */}
        <div className="detail-reveal" style={{ animationDelay: '0ms' }}>
          <Breadcrumb
            items={
              navState.from === 'project' && navState.projectName
                ? [
                    { label: 'Dashboard', href: '/' },
                    { label: 'Projects', href: '/projects' },
                    { label: navState.projectName, href: `/projects/${navState.projectId}` },
                    { label: 'Work Orders', href: `/projects/${navState.projectId}` },
                    { label: woId! },
                  ]
                : [
                    { label: 'Dashboard', href: '/' },
                    { label: 'Work Orders', href: '/work-orders' },
                    { label: woId! },
                  ]
            }
          />
        </div>

        {/* TOP STRIP */}
        <div className="detail-reveal mt-4" style={{ animationDelay: '40ms' }}>
          <p className="text-[14px] font-bold font-data-mono text-on-surface">{wo.wo_id}</p>
          <p className="text-[14px] text-on-surface mt-0.5">{wo.projects?.name}</p>
          {wo.projects?.site_location && (
            <p className="text-[12px] text-on-surface-variant">{wo.projects.site_location}</p>
          )}
          <p className="text-[14px] text-on-surface mt-0.5">
            {wo.stakeholders?.name}{wo.stakeholders?.category ? ` · ${wo.stakeholders.category}` : ''}
          </p>
          <p className="text-[12px] text-on-surface-variant">
            Issued {fmtDate(wo.date_issued)}
          </p>
          <p className="text-[18px] font-bold font-data-mono text-on-surface mt-2">
            <AmountDisplay amount={orderValue} />
          </p>
        </div>

        {/* ACTION ROW */}
        <div className="detail-reveal mt-3 flex items-center gap-2 flex-wrap" style={{ animationDelay: '80ms' }}>
          <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${statusBadgeClass(wo.status)}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${statusDotColor(wo.status)}`} />
            {wo.status?.toUpperCase()}
          </span>

          {wo.status === 'Closed' && showClosedMsg && (
            <span className="text-[12px] text-green-600 font-medium transition-opacity duration-1000">
              Work Order Complete
            </span>
          )}

          {/* DRAFT — approve (management/principal) or awaiting message */}
          {wo.status === 'Draft' && (
            canApprove ? (
              <>
                <button onClick={() => setConfirmAction('approve')} className="bk-btn flex items-center gap-1.5 py-1.5 px-3 text-[13px]">
                  <span className="material-symbols-outlined text-[16px]">verified</span>
                  Approve &amp; Assign
                </button>
                <button onClick={() => setConfirmAction('cancel')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error/30 text-error text-[13px] font-semibold hover:bg-error-container/30 transition-colors">
                  <span className="material-symbols-outlined text-[15px]">cancel</span> Cancel WO
                </button>
              </>
            ) : (
              <span className="text-[12px] text-amber-600 flex items-center gap-1">
                <span className="material-symbols-outlined text-[15px]">schedule</span>
                Pending management approval
              </span>
            )
          )}

          {/* ASSIGNED → ISSUED */}
          {wo.status === 'Assigned' && canTransition && (
            <>
              <button onClick={() => setConfirmAction('issue')} className="bk-btn flex items-center gap-1.5 py-1.5 px-3 text-[13px]">
                <span className="material-symbols-outlined text-[16px]">send</span>
                Issue Work Order
              </button>
              <button onClick={() => setConfirmAction('cancel')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error/30 text-error text-[13px] font-semibold hover:bg-error-container/30 transition-colors">
                <span className="material-symbols-outlined text-[15px]">cancel</span> Cancel WO
              </button>
            </>
          )}

          {/* ISSUED → ACTIVE */}
          {wo.status === 'Issued' && canTransition && (
            <>
              <button onClick={() => setConfirmAction('activate')} className="bk-btn flex items-center gap-1.5 py-1.5 px-3 text-[13px]">
                <span className="material-symbols-outlined text-[16px]">play_circle</span>
                Mark as Active
              </button>
              <button onClick={() => setConfirmAction('cancel')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error/30 text-error text-[13px] font-semibold hover:bg-error-container/30 transition-colors">
                <span className="material-symbols-outlined text-[15px]">cancel</span> Cancel WO
              </button>
            </>
          )}

          {/* ACTIVE → CLOSED */}
          {wo.status === 'Active' && canTransition && (
            <>
              <button onClick={() => setConfirmAction('close')} className="bk-btn flex items-center gap-1.5 py-1.5 px-3 text-[13px]">
                <span className="material-symbols-outlined text-[16px]">check_circle</span>
                Close Work Order
              </button>
              <button onClick={() => setConfirmAction('cancel')} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error/30 text-error text-[13px] font-semibold hover:bg-error-container/30 transition-colors">
                <span className="material-symbols-outlined text-[15px]">cancel</span> Cancel WO
              </button>
            </>
          )}

          <button
            onClick={handleDownloadPdf}
            className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline-variant/40 text-[12px] text-on-surface-variant hover:text-on-surface transition-colors"
          >
            <Download size={14} /> Export PDF
          </button>

          <button
            onClick={() => setShowLog((v) => !v)}
            className="ml-auto flex items-center gap-1 text-[12px] text-on-surface-variant hover:text-primary transition-colors"
          >
            View log
            <span className="material-symbols-outlined text-[14px]">
              {showLog ? 'expand_less' : 'chevron_right'}
            </span>
          </button>
        </div>

        {/* DIVIDER */}
        <hr className="border-outline-variant/15 my-5" />

        {/* SCOPE OF WORK */}
        {wo.scope_of_work && (
          <div className="detail-reveal mb-6" style={{ animationDelay: '120ms' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">SCOPE</p>
            <p className="text-[14px] text-on-surface whitespace-pre-wrap leading-relaxed">{wo.scope_of_work}</p>
          </div>
        )}

        {/* FINANCIAL */}
        <div className="detail-reveal mb-6" style={{ animationDelay: '170ms' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">FINANCIAL</p>
          <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
            {/* Credit — worker gave labour (certified milestones) */}
            {orderValue > 0 && (
              <div className="flex items-center justify-between px-4 py-3 bg-[rgba(22,163,74,0.03)] border-b border-outline-variant/10">
                <div>
                  <p className="text-[12px] font-medium text-[#16A34A]">Credit — By Work Done</p>
                  <p className="text-[11px] text-on-surface-variant/60 mt-0.5">Work order value</p>
                </div>
                <span className="font-data-mono font-semibold text-[14px] text-[#16A34A]">
                  ₹{orderValue.toLocaleString('en-IN')}
                </span>
              </div>
            )}
            {/* Debit — payments made */}
            {totalPaid > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10">
                <div>
                  <p className="text-[12px] font-medium text-on-surface">Debit — To Bank / Cash</p>
                  <p className="text-[11px] text-on-surface-variant/60 mt-0.5">
                    Payments made · as of {new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                  </p>
                </div>
                <span className="font-data-mono font-semibold text-[14px] text-on-surface">
                  <AmountDisplay amount={totalPaid} />
                </span>
              </div>
            )}
            {/* Balance */}
            <div className="flex items-center justify-between px-4 py-3">
              <p className="text-[13px] font-bold text-on-surface">Balance</p>
              <span className={`font-data-mono font-bold text-[15px] ${balance > 0 ? 'text-[#DC2626]' : balance < 0 ? 'text-[#D97706]' : 'text-[#16A34A]'}`}>
                {balance === 0
                  ? 'Nil — Settled ✓'
                  : balance > 0
                  ? `₹${balance.toLocaleString('en-IN')} Cr`
                  : `₹${Math.abs(balance).toLocaleString('en-IN')} Dr`}
              </span>
            </div>
          </div>

          {/* Overpaid phase warnings */}
          {overpaidPhases.length > 0 && (
            <div className="mt-2 space-y-1">
              {overpaidPhases.map((m: any) => {
                const planned = Number(m.planned_amount) || 0;
                const paid = milestonePayments[m.milestone_id] || 0;
                return (
                  <p key={m.milestone_id} className="text-[12px] text-amber-700 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">warning</span>
                    {m.name} overpaid by ₹{(paid - planned).toLocaleString('en-IN')}
                  </p>
                );
              })}
            </div>
          )}

          {/* Payment progress bar */}
          <div className="mt-4">
            <div className="flex justify-between items-center mb-1.5">
              <span className="text-[11px] text-on-surface-variant">Payment</span>
              <span className="text-[11px] font-semibold text-on-surface">{progressPercentage}%</span>
            </div>
            <div className="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
              <div
                className="h-full bg-primary rounded-full progress-bar-animate"
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>

          {/* Physical progress if available */}
          {(wo as any).physical_progress != null && (
            <div className="mt-3">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[11px] text-on-surface-variant">Physical</span>
                <span className="text-[11px] font-semibold text-on-surface">{(wo as any).physical_progress}%</span>
              </div>
              <div className="w-full h-2 bg-surface-container-high rounded-full overflow-hidden">
                <div
                  className="h-full bg-secondary rounded-full progress-bar-animate"
                  style={{ width: `${(wo as any).physical_progress}%` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* WORK STAGES */}
        <div className="detail-reveal mb-6" style={{ animationDelay: '220ms' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">WORK STAGES</p>
          {milestones.length === 0 && (
            <p className="text-[13px] text-on-surface-variant italic">No work stages added to this order.</p>
          )}
          <div>
            {(() => {
                let cumPlanned = 0;
                let cumPaid = 0;
                return milestones.map((m: any, idx: number) => {
                  cumPlanned += Number(m.planned_amount) || 0;
                  cumPaid += milestonePayments[m.milestone_id] || 0;
                  const thisCumPlanned = cumPlanned;
                  const thisCumPaid = cumPaid;

                  const planned = Number(m.planned_amount) || 0;
                  const paid = milestonePayments[m.milestone_id] || 0;
                  const remaining = Math.max(0, planned - paid);
                  const overpay = Math.max(0, paid - planned);
                  const ms = getMilestoneStatus(m, paid);
                  const isOverpaid = ms === 'OVERPAID';
                  const isExpanded = expandedMilestone === m.milestone_id;
                  const txns = milestoneTxns[m.milestone_id] || [];
                  const dueDateStr = m.due_date;
                  const showDueDate = dueDateStr && !isNaN(new Date(dueDateStr).getTime());
                  const phaseRatio = planned > 0 ? Math.min(1, paid / planned) : 0;
                  const overpayRatio = planned > 0 ? Math.min(0.2, overpay / planned) : 0; // cap overflow at 20% visual
                  const barColor = isOverpaid ? '#16a34a' : ms === 'PAID' ? '#16a34a' : ms === 'PARTIALLY_PAID' ? '#d97706' : '#e2e8f0';

                  return (
                    <div
                      key={m.milestone_id}
                      className="border-b border-outline-variant/10 last:border-0"
                      style={isOverpaid ? { backgroundColor: 'rgba(220,38,38,0.03)', borderRadius: 8 } : undefined}
                    >
                      {/* Clickable milestone header */}
                      <button
                        className="w-full flex items-start gap-3 py-3 text-left hover:bg-surface-container-low/40 transition-colors rounded-lg px-1"
                        onClick={() => setExpandedMilestone(isExpanded ? null : m.milestone_id)}
                      >
                        {/* Status icon */}
                        <div className="shrink-0 mt-1">
                          {isOverpaid ? (
                            <span className="material-symbols-outlined text-[16px] text-red-500">warning</span>
                          ) : ms === 'PAID' ? (
                            <svg width="16" height="16" viewBox="0 0 16 16" className="text-green-600">
                              <polyline points="3,8 7,12 13,4" fill="none" stroke="currentColor"
                                strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="check-draw" />
                            </svg>
                          ) : ms === 'PARTIALLY_PAID' ? (
                            <span className="w-4 h-4 rounded-full border-2 border-amber-400 flex items-center justify-center">
                              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                            </span>
                          ) : ms === 'DUE' ? (
                            <span className="w-4 h-4 rounded-full border-2 border-amber-400 block" />
                          ) : (
                            <span className="w-4 h-4 rounded-full border-2 border-outline-variant/40 block" />
                          )}
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0">
                          {/* Name + status + due date */}
                          <div className="flex items-center gap-2 flex-wrap">
                            <p className="text-[13px] font-semibold text-on-surface">{idx + 1}. {m.name}</p>
                            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                              isOverpaid ? 'bg-red-100 text-red-700' :
                              ms === 'PAID' ? 'bg-green-100 text-green-800' :
                              ms === 'DUE'  ? 'bg-amber-100 text-amber-800' :
                              ms === 'PARTIALLY_PAID' ? 'bg-blue-100 text-blue-800' :
                              'bg-surface-container-high text-on-surface-variant'
                            }`}>
                              {isOverpaid ? '⚠ OVERPAID' : ms === 'PARTIALLY_PAID' ? 'PARTIAL' : ms === 'PAID' ? 'PAID ✓' : ms === 'DUE' ? '◐ DUE' : '○ PENDING'}
                            </span>
                            {isOverpaid && (
                              <span className="text-[11px] font-semibold text-red-600">
                                +₹{overpay.toLocaleString('en-IN')}
                              </span>
                            )}
                            {showDueDate && !isOverpaid && (
                              <span className={`text-[11px] ${isDueDate(dueDateStr) && ms !== 'PAID' ? 'text-amber-700 font-semibold' : 'text-on-surface-variant'}`}>
                                {fmtDate(dueDateStr)}
                              </span>
                            )}
                          </div>

                          {/* BOQ rate line */}
                          {m.unit_type && m.rate ? (
                            <p className="text-[11px] text-on-surface-variant mt-0.5">
                              {m.unit_type === 'LS' ? (
                                <span>Lump Sum</span>
                              ) : (
                                <>
                                  <span className="font-data-mono">{Number(m.quantity ?? 0).toLocaleString('en-IN')}</span>
                                  {' '}{m.unit_type}{' × '}
                                  <span className="font-data-mono">₹{Number(m.rate).toLocaleString('en-IN')}</span>
                                  <span>/{m.unit_type.toLowerCase()}</span>
                                </>
                              )}
                            </p>
                          ) : null}

                          {/* Phase financials */}
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-[12px] text-on-surface-variant">
                              Phase{' '}
                              {isOverpaid ? (
                                <>
                                  <span className="font-data-mono text-on-surface-variant/50 line-through">₹{planned.toLocaleString('en-IN')}</span>
                                  {' '}
                                  <span className="font-data-mono text-red-600 font-semibold">₹{paid.toLocaleString('en-IN')}</span>
                                </>
                              ) : (
                                <span className="font-data-mono text-on-surface font-semibold">₹{planned.toLocaleString('en-IN')}</span>
                              )}
                            </span>
                            <span className="text-on-surface-variant/40 text-[11px]">·</span>
                            <span className="text-[12px] text-on-surface-variant">
                              Cumulative{' '}
                              <span className={`font-data-mono font-semibold ${
                                isOverpaid ? 'text-red-600' :
                                thisCumPaid >= thisCumPlanned && thisCumPlanned > 0 ? 'text-green-600' :
                                thisCumPaid > 0 ? 'text-amber-700' : 'text-on-surface'
                              }`}>₹{thisCumPaid.toLocaleString('en-IN')}</span>
                              <span className="text-on-surface-variant"> / ₹{thisCumPlanned.toLocaleString('en-IN')}</span>
                            </span>
                          </div>

                          {/* Mini phase progress bar */}
                          {isOverpaid ? (
                            <div className="mt-2 relative h-1.5 rounded-full" style={{ backgroundColor: '#f1f5f9' }}>
                              {/* Green fill: 100% */}
                              <div className="absolute inset-y-0 left-0 right-0 rounded-l-full progress-bar-animate" style={{ backgroundColor: barColor, transitionDelay: `${idx * 100}ms` }} />
                              {/* Red overflow: extends right of track */}
                              <div
                                className="absolute inset-y-0 right-0 rounded-r-full progress-bar-animate"
                                style={{
                                  backgroundColor: '#ef4444',
                                  width: `${Math.round(overpayRatio * 100)}%`,
                                  transform: 'translateX(100%)',
                                  transitionDelay: `${idx * 100 + 300}ms`,
                                }}
                              />
                            </div>
                          ) : (
                            <div className="mt-2 w-full h-1.5 bg-surface-container-high rounded-full overflow-hidden">
                              <div
                                className="h-full rounded-full progress-bar-animate"
                                style={{ width: `${Math.round(phaseRatio * 100)}%`, backgroundColor: barColor, transitionDelay: `${idx * 100}ms` }}
                              />
                            </div>
                          )}
                        </div>

                        {/* Chevron */}
                        <span
                          className="material-symbols-outlined text-[18px] text-on-surface-variant/50 shrink-0 mt-0.5 transition-transform duration-[180ms]"
                          style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }}
                        >
                          expand_more
                        </span>
                      </button>

                      {/* Inline transaction list */}
                      <div style={{
                        maxHeight: isExpanded ? '800px' : '0',
                        overflow: 'hidden',
                        transition: isExpanded
                          ? 'max-height 220ms ease-out, opacity 150ms ease-out 70ms'
                          : 'max-height 200ms ease-out, opacity 150ms ease-out',
                        opacity: isExpanded ? 1 : 0,
                      }}>
                        <div className="pb-3 pl-7 pr-1">
                          <div className="border-t border-outline-variant/15 pt-2">
                            {txns.length === 0 ? (
                              <div className="flex items-center justify-between py-1.5">
                                <p className="text-[12px] text-on-surface-variant">No payments recorded for this phase</p>
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setReleaseModal({ milestone: m, remaining });
                                    setReleaseAmount(String(remaining || planned));
                                    setReleaseDate(new Date().toISOString().split('T')[0]);
                                    setReleaseMode('NEFT');
                                    setReleaseRemarks('');
                                    setReleaseError(null);
                                  }}
                                  className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-[12px] font-semibold hover:bg-primary/20 transition-colors shrink-0 ml-3"
                                >
                                  <span className="material-symbols-outlined text-[14px]">payments</span>
                                  Release →
                                </button>
                              </div>
                            ) : (
                              <div className="space-y-0">
                                {txns.map((alloc: any) => {
                                  const txn = alloc.transactions;
                                  if (!txn) return null;
                                  const isExiting = exitingAllocIds.has(alloc.allocation_id);
                                  const isThisPopoverOpen = shiftPopover?.allocId === alloc.allocation_id;

                                  return (
                                    <div
                                      key={alloc.allocation_id}
                                      className={`group rounded-lg ${isExiting ? 'phase-shift-exit' : ''}`}
                                    >
                                      {/* TXN row */}
                                      <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-surface-container-low rounded-lg transition-colors">
                                        <button
                                          onClick={(e) => { e.stopPropagation(); openPeek('TRANSACTION', txn.txn_id); }}
                                          className="min-w-0 flex-1 text-left"
                                        >
                                          <p className="text-[11px] font-[500] text-on-surface truncate">
                                            {[wo?.stakeholders?.name, wo?.stakeholders?.category].filter(Boolean).join(' · ') || 'Payment'}
                                          </p>
                                          {(txn.remarks || txn.category) && (
                                            <p className="text-[10px] text-on-surface-variant/60 truncate">{txn.remarks?.slice(0, 60) || txn.category}</p>
                                          )}
                                          <p className="text-[9px] font-mono text-on-surface-variant/25 opacity-0 group-hover:opacity-100 transition-opacity">{txn.txn_id}</p>
                                        </button>
                                        <span className="font-data-mono text-[12px] text-on-surface ml-auto shrink-0">₹{Number(alloc.allocated_amount).toLocaleString('en-IN')}</span>
                                        <span className="text-[10px] text-on-surface-variant shrink-0">
                                          {new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}{txn.payment_mode ? ` · ${txn.payment_mode}` : ''}
                                        </span>
                                        <span className="text-green-600 text-[11px] shrink-0">✓</span>
                                        {/* ··· shift button */}
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            if (isThisPopoverOpen) {
                                              setShiftPopover(null);
                                            } else {
                                              setShiftPopover({ allocId: alloc.allocation_id, txnId: txn.txn_id, amount: Number(alloc.allocated_amount), currentMilestoneId: m.milestone_id });
                                              setShiftTarget(m.milestone_id);
                                            }
                                          }}
                                          className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded hover:bg-surface-container-high shrink-0 ml-0.5"
                                          title="Move to another phase"
                                        >
                                          <span className="material-symbols-outlined text-[13px] text-on-surface-variant">more_horiz</span>
                                        </button>
                                      </div>

                                      {/* Hover hint */}
                                      <p className="opacity-0 group-hover:opacity-100 transition-opacity text-[10px] text-on-surface-variant/40 pl-2 -mt-0.5 mb-0.5 select-none">
                                        ↳ move to another phase
                                      </p>

                                      {/* Shift popover */}
                                      {isThisPopoverOpen && (
                                        <div
                                          className="mx-2 mb-2 p-3 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-sm popover-animate"
                                          style={{ width: 240 }}
                                          onClick={(e) => e.stopPropagation()}
                                        >
                                          <p className="text-[11px] font-bold text-on-surface-variant mb-2">Move to a different phase</p>
                                          <div className="space-y-0.5 mb-3 max-h-48 overflow-y-auto">
                                            {milestones.map((ph: any) => {
                                              const isCurrent = ph.milestone_id === m.milestone_id;
                                              return (
                                                <label
                                                  key={ph.milestone_id}
                                                  className={`flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer ${isCurrent ? 'opacity-40 cursor-not-allowed' : 'hover:bg-surface-container-low'}`}
                                                >
                                                  <input
                                                    type="radio"
                                                    name={`shift-${alloc.allocation_id}`}
                                                    value={ph.milestone_id}
                                                    checked={shiftTarget === ph.milestone_id}
                                                    disabled={isCurrent}
                                                    onChange={() => setShiftTarget(ph.milestone_id)}
                                                    className="accent-primary shrink-0"
                                                  />
                                                  <span className="text-[12px] text-on-surface flex-1 leading-tight">{ph.name}</span>
                                                  {isCurrent && <span className="text-[10px] text-on-surface-variant/50 shrink-0">← current</span>}
                                                </label>
                                              );
                                            })}
                                            {/* Unallocated option */}
                                            <label className="flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-surface-container-low">
                                              <input
                                                type="radio"
                                                name={`shift-${alloc.allocation_id}`}
                                                value="unallocated"
                                                checked={shiftTarget === 'unallocated'}
                                                onChange={() => setShiftTarget('unallocated')}
                                                className="accent-primary shrink-0"
                                              />
                                              <span className="text-[12px] text-on-surface-variant italic">Unallocated</span>
                                            </label>
                                          </div>
                                          <div className="flex gap-2">
                                            <button
                                              disabled={!shiftTarget || shiftTarget === m.milestone_id || shiftPhaseMutation.isPending}
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                if (!shiftTarget || shiftTarget === m.milestone_id) return;
                                                const targetMs = shiftTarget === 'unallocated' ? null : milestones.find((ph: any) => ph.milestone_id === shiftTarget);
                                                const toName = shiftTarget === 'unallocated' ? 'Unallocated' : (targetMs?.name || shiftTarget);
                                                setExitingAllocIds(prev => new Set([...prev, alloc.allocation_id]));
                                                setTimeout(() => {
                                                  shiftPhaseMutation.mutate({
                                                    allocId: alloc.allocation_id,
                                                    newMilestoneId: shiftTarget === 'unallocated' ? null : shiftTarget,
                                                    txnId: txn.txn_id,
                                                    amount: Number(alloc.allocated_amount),
                                                    fromName: m.name,
                                                    toName,
                                                    fromId: m.milestone_id,
                                                  });
                                                }, 200);
                                                setShiftPopover(null);
                                              }}
                                              className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-semibold disabled:opacity-40 hover:opacity-90 transition-opacity"
                                            >
                                              Move
                                            </button>
                                            <button
                                              onClick={(e) => { e.stopPropagation(); setShiftPopover(null); }}
                                              className="px-3 py-1.5 rounded-lg border border-outline-variant/30 text-[12px] text-on-surface-variant hover:bg-surface-container transition-colors"
                                            >
                                              Cancel
                                            </button>
                                          </div>
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                                {ms !== 'PAID' && ms !== 'OVERPAID' && (
                                  <button
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      setReleaseModal({ milestone: m, remaining });
                                      setReleaseAmount(String(remaining || planned));
                                      setReleaseDate(new Date().toISOString().split('T')[0]);
                                      setReleaseMode('NEFT');
                                      setReleaseRemarks('');
                                      setReleaseError(null);
                                    }}
                                    className="flex items-center gap-1 mt-1.5 px-2.5 py-1.5 rounded-lg bg-primary/10 text-primary text-[12px] font-semibold hover:bg-primary/20 transition-colors"
                                  >
                                    <span className="material-symbols-outlined text-[14px]">payments</span>
                                    Release more →
                                  </button>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                });
              })()}
            </div>

            {/* Unallocated payments */}
            {unallocatedPayments.length > 0 && (
              <div className="mt-4 pt-3 border-t border-outline-variant/20">
                <p className="text-[11px] font-semibold text-on-surface-variant mb-2">Unallocated Payments</p>
                <div className="space-y-0.5">
                  {unallocatedPayments.map((alloc: any) => {
                    const txn = alloc.transactions;
                    if (!txn) return null;
                    const isThisPopoverOpen = shiftPopover?.allocId === alloc.allocation_id;
                    return (
                      <div key={alloc.allocation_id} className="group rounded-lg">
                        <div className="flex items-center gap-2 py-1.5 px-2 hover:bg-surface-container-low rounded-lg transition-colors">
                          <button
                            onClick={() => openPeek('TRANSACTION', txn.txn_id)}
                            className="min-w-0 flex-1 text-left"
                          >
                            <p className="text-[11px] font-[500] text-on-surface truncate">
                              {[wo?.stakeholders?.name, wo?.stakeholders?.category].filter(Boolean).join(' · ') || 'Payment'}
                            </p>
                            {(txn.remarks || txn.category) && (
                              <p className="text-[10px] text-on-surface-variant/60 truncate">{txn.remarks?.slice(0, 60) || txn.category}</p>
                            )}
                            <p className="text-[9px] font-mono text-on-surface-variant/25 opacity-0 group-hover:opacity-100 transition-opacity">{txn.txn_id}</p>
                          </button>
                          <span className="font-data-mono text-[12px] text-on-surface ml-auto shrink-0">₹{Number(alloc.allocated_amount).toLocaleString('en-IN')}</span>
                          <span className="text-[10px] text-on-surface-variant shrink-0">
                            {new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}{txn.payment_mode ? ` · ${txn.payment_mode}` : ''}
                          </span>
                          <span className="text-green-600 text-[11px] shrink-0">✓</span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              if (isThisPopoverOpen) {
                                setShiftPopover(null);
                              } else {
                                setShiftPopover({ allocId: alloc.allocation_id, txnId: txn.txn_id, amount: Number(alloc.allocated_amount), currentMilestoneId: null });
                                setShiftTarget('unallocated');
                              }
                            }}
                            className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center w-5 h-5 rounded hover:bg-surface-container-high shrink-0 ml-0.5"
                            title="Move to a phase"
                          >
                            <span className="material-symbols-outlined text-[13px] text-on-surface-variant">more_horiz</span>
                          </button>
                        </div>
                        {/* Shift popover for unallocated */}
                        {isThisPopoverOpen && (
                          <div
                            className="mx-2 mb-2 p-3 bg-surface-container-lowest border border-outline-variant/30 rounded-xl shadow-sm popover-animate"
                            style={{ width: 240 }}
                          >
                            <p className="text-[11px] font-bold text-on-surface-variant mb-2">Assign to a phase</p>
                            <div className="space-y-0.5 mb-3 max-h-48 overflow-y-auto">
                              {milestones.map((ph: any) => (
                                <label key={ph.milestone_id} className="flex items-center gap-2 py-1.5 px-2 rounded-lg cursor-pointer hover:bg-surface-container-low">
                                  <input
                                    type="radio"
                                    name={`shift-unalloc-${alloc.allocation_id}`}
                                    value={ph.milestone_id}
                                    checked={shiftTarget === ph.milestone_id}
                                    onChange={() => setShiftTarget(ph.milestone_id)}
                                    className="accent-primary shrink-0"
                                  />
                                  <span className="text-[12px] text-on-surface leading-tight">{ph.name}</span>
                                </label>
                              ))}
                            </div>
                            <div className="flex gap-2">
                              <button
                                disabled={!shiftTarget || shiftTarget === 'unallocated' || shiftPhaseMutation.isPending}
                                onClick={() => {
                                  if (!shiftTarget || shiftTarget === 'unallocated') return;
                                  const targetMs = milestones.find((ph: any) => ph.milestone_id === shiftTarget);
                                  const toName = targetMs?.name || shiftTarget;
                                  setExitingAllocIds(prev => new Set([...prev, alloc.allocation_id]));
                                  setTimeout(() => {
                                    shiftPhaseMutation.mutate({
                                      allocId: alloc.allocation_id,
                                      newMilestoneId: shiftTarget,
                                      txnId: txn.txn_id,
                                      amount: Number(alloc.allocated_amount),
                                      fromName: 'Unallocated',
                                      toName,
                                      fromId: null,
                                    });
                                  }, 200);
                                  setShiftPopover(null);
                                }}
                                className="flex-1 px-3 py-1.5 rounded-lg bg-primary text-on-primary text-[12px] font-semibold disabled:opacity-40 hover:opacity-90"
                              >
                                Assign
                              </button>
                              <button
                                onClick={() => setShiftPopover(null)}
                                className="px-3 py-1.5 rounded-lg border border-outline-variant/30 text-[12px] text-on-surface-variant hover:bg-surface-container"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

        {/* PAYMENTS MADE */}
        {allocations && allocations.length > 0 && (
          <div className="detail-reveal mb-6" style={{ animationDelay: '270ms' }}>
            <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">PAYMENTS</p>
            <div className="space-y-1.5">
              {allocations.map((alloc: any) => {
                const txn = alloc.transactions;
                if (!txn) return null;
                return (
                  <button
                    key={alloc.allocation_id}
                    onClick={() => openPeek('TRANSACTION', txn.txn_id)}
                    className="w-full flex items-center gap-3 py-2 text-left hover:bg-surface-container-low/50 transition-colors rounded-lg px-1 group"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] font-[500] text-on-surface truncate">
                        {[wo?.stakeholders?.name, wo?.stakeholders?.category].filter(Boolean).join(' · ') || 'Payment'}
                      </p>
                      {(txn.remarks || txn.category) && (
                        <p className="text-[10px] text-on-surface-variant/60 truncate">{txn.remarks?.slice(0, 60) || txn.category}</p>
                      )}
                      <p className="text-[9px] font-mono text-on-surface-variant/25 opacity-0 group-hover:opacity-100 transition-opacity">{txn.txn_id}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="font-data-mono text-[12px] text-on-surface">₹{Number(alloc.allocated_amount).toLocaleString('en-IN')}</p>
                      <p className="text-[10px] text-on-surface-variant">
                        {new Date(txn.date).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}{txn.payment_mode ? ` · ${txn.payment_mode}` : ''}
                      </p>
                    </div>
                    <span className="text-green-600 text-[12px] shrink-0">✓</span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* TRAIL / STATUS HISTORY */}
        <div className="detail-reveal" style={{ animationDelay: '320ms' }}>
          <button
            onClick={() => setShowLog((v) => !v)}
            className="flex items-center gap-1.5 text-[12px] text-on-surface-variant hover:text-primary transition-colors"
          >
            Status history · View log
            <span className="material-symbols-outlined text-[14px]">
              {showLog ? 'expand_less' : 'chevron_right'}
            </span>
          </button>

          {showLog && (
            <div className="mt-3 pl-1">
              <div className="flex flex-col gap-0">
                {FLOW_STATES.map((state, idx) => {
                  const entry = getHistoryEntry(state);
                  const reached = isCancelled
                    ? (state === 'Draft' || statusHistory.some((e) => e.status === state))
                    : currentFlowIdx >= idx;
                  return (
                    <div key={state} className="flex items-start gap-3 relative">
                      {idx < FLOW_STATES.length - 1 && (
                        <div className={`absolute left-[7px] top-4 w-px h-full ${
                          (!isCancelled && currentFlowIdx > idx) ? 'bg-primary/30' : 'bg-outline-variant/30'
                        }`} />
                      )}
                      <div className={`w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 border-2 ${
                        reached ? `${statusDotColor(state)} border-transparent` : 'bg-background border-outline-variant/40'
                      }`} />
                      <div className="pb-3 min-w-0">
                        <p className={`text-[12px] font-semibold ${reached ? 'text-on-surface' : 'text-on-surface-variant/50'}`}>
                          {state}
                          {state === 'Assigned' && (wo as any).approved_by_name && (
                            <span className="ml-1 text-[10px] font-normal text-blue-600">· Approved by {(wo as any).approved_by_name}</span>
                          )}
                        </p>
                        {entry && (
                          <p className="text-[11px] text-on-surface-variant">
                            {fmtDate(entry.at)}
                            {entry.by && entry.by !== '—' && <span className="ml-1 opacity-70">· {entry.by}</span>}
                          </p>
                        )}
                      </div>
                    </div>
                  );
                })}
                {isCancelled && (
                  <div className="flex items-start gap-3">
                    <div className="w-3.5 h-3.5 rounded-full shrink-0 mt-0.5 bg-error border-2 border-transparent" />
                    <div>
                      <p className="text-[12px] font-semibold text-error">Cancelled</p>
                      {cancelledEntry && (
                        <p className="text-[11px] text-on-surface-variant">
                          {fmtDate(cancelledEntry.at)}
                          {cancelledEntry.by && <span className="ml-1 opacity-70">· {cancelledEntry.by}</span>}
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Phase-move entries */}
                {statusHistory
                  .filter((e: any) => e.status === 'phase_move' || e.status === 'phase_move_undo')
                  .map((e: any) => (
                    <div key={`${e.at}-${e.txn_id}`} className="flex items-start gap-3">
                      <div className="w-3.5 h-3.5 rounded shrink-0 mt-0.5 bg-primary/15 flex items-center justify-center">
                        <span className="material-symbols-outlined text-[9px] text-primary">swap_horiz</span>
                      </div>
                      <div className="pb-1 min-w-0">
                        <p className="text-[12px] font-semibold text-on-surface">
                          {e.status === 'phase_move_undo' ? 'Move undone' : 'Phase reassigned'}
                          {' · '}
                          <span className="font-data-mono text-primary">{e.txn_id}</span>
                          {' '}₹{Number(e.amount).toLocaleString('en-IN')}
                        </p>
                        <p className="text-[11px] text-on-surface-variant">
                          <span className="line-through opacity-60">{e.from}</span>
                          {' → '}
                          <span className="font-medium">{e.to}</span>
                        </p>
                        <p className="text-[11px] text-on-surface-variant opacity-70">{fmtDate(e.at)} · {e.by}</p>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>

      </div>{/* end printRef div */}

      {/* ── SNACKBAR ─────────────────────────────────────────────────── */}
      {snackbar && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-on-surface text-surface rounded-xl shadow-elevation-6 success-toast">
          <span className="text-[13px] font-medium">{snackbar.msg}</span>
          {snackbar.undoData && (
            <button
              onClick={() => {
                if (snackbarTimerRef.current) clearTimeout(snackbarTimerRef.current);
                undoShiftMutation.mutate(snackbar.undoData!);
              }}
              className="text-[13px] font-bold text-primary-container hover:underline shrink-0"
            >
              Undo
            </button>
          )}
        </div>
      )}

      {/* ── STATUS TRANSITION MODAL ───────────────────────────────────── */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setConfirmAction(null); setTransitionError(null); } }}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-card-lg border border-outline-variant/30 w-full max-w-md p-6">

            {confirmAction === 'approve' && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-blue-700">verified</span>
                  </div>
                  <div>
                    <h3 className="text-headline-sm font-headline-sm">Approve Work Order</h3>
                    <p className="text-[11px] text-on-surface-variant font-data-mono mt-0.5">{wo.wo_id}</p>
                  </div>
                </div>
                <div className="rounded-xl bg-surface-container-low p-4 mb-4 space-y-1.5">
                  <p className="text-[13px] text-on-surface"><span className="font-semibold">{wo.stakeholders?.name}</span> · {wo.projects?.name}</p>
                  {orderValue > 0 && (
                    <p className="text-[13px] font-data-mono text-on-surface">Value: ₹{orderValue.toLocaleString('en-IN')}</p>
                  )}
                </div>
                <p className="text-body-sm text-on-surface-variant mb-1">Approving will:</p>
                <ul className="text-body-sm text-on-surface-variant mb-5 list-disc pl-5 space-y-1">
                  <li>Assign this WO to <strong>{wo.stakeholders?.name}</strong></li>
                  {orderValue > 0 && <li>Create a financial commitment of ₹{orderValue.toLocaleString('en-IN')} against {wo.projects?.name}</li>}
                  <li>Allow milestone payments to be released</li>
                </ul>
                {transitionError && <p className="text-error text-body-sm mb-4 p-3 bg-error-container/30 rounded-lg">{transitionError}</p>}
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setConfirmAction(null); setTransitionError(null); }} className="bk-btn-ghost px-5 py-2 text-body-sm border border-outline-variant/30">Cancel</button>
                  <button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} className="bk-btn flex items-center gap-2">
                    {approveMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <span className="material-symbols-outlined text-[16px]">verified</span>}
                    Approve &amp; Assign
                  </button>
                </div>
              </>
            )}

            {confirmAction === 'issue' && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-blue-700">send</span>
                  </div>
                  <h3 className="text-headline-sm font-headline-sm">Issue Work Order</h3>
                </div>
                <p className="text-body-sm text-on-surface-variant mb-5">
                  This will formally issue <strong className="font-data-mono">{wo.wo_id}</strong> to{' '}
                  <strong>{wo.stakeholders?.name}</strong> for{' '}
                  <strong className="font-data-mono">₹{orderValue.toLocaleString()}</strong>.
                  The work order becomes read-only after issuing.
                </p>
                {transitionError && <p className="text-error text-body-sm mb-4 p-3 bg-error-container/30 rounded-lg">{transitionError}</p>}
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setConfirmAction(null); setTransitionError(null); }} className="bk-btn-ghost px-5 py-2 text-body-sm border border-outline-variant/30">Cancel</button>
                  <button onClick={() => transitionMutation.mutate(ACTION_TO_STATUS.issue)} disabled={transitionMutation.isPending} className="bk-btn flex items-center gap-2">
                    {transitionMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <span className="material-symbols-outlined text-[16px]">send</span>}
                    Issue
                  </button>
                </div>
              </>
            )}
            {confirmAction === 'activate' && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-amber-700">play_circle</span>
                  </div>
                  <h3 className="text-headline-sm font-headline-sm">Mark as Active</h3>
                </div>
                <p className="text-body-sm text-on-surface-variant mb-5">
                  Confirm that work has commenced on <strong className="font-data-mono">{wo.wo_id}</strong>.
                </p>
                {transitionError && <p className="text-error text-body-sm mb-4 p-3 bg-error-container/30 rounded-lg">{transitionError}</p>}
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setConfirmAction(null); setTransitionError(null); }} className="bk-btn-ghost px-5 py-2 text-body-sm border border-outline-variant/30">Cancel</button>
                  <button onClick={() => transitionMutation.mutate(ACTION_TO_STATUS.activate)} disabled={transitionMutation.isPending} className="bk-btn flex items-center gap-2">
                    {transitionMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <span className="material-symbols-outlined text-[16px]">play_circle</span>}
                    Continue
                  </button>
                </div>
              </>
            )}
            {confirmAction === 'close' && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-green-100 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-green-700">check_circle</span>
                  </div>
                  <h3 className="text-headline-sm font-headline-sm">Close Work Order</h3>
                </div>
                <p className="text-body-sm text-on-surface-variant mb-4">Ensure all payments are settled before closing.</p>
                <div className="grid grid-cols-3 gap-3 mb-4">
                  {[
                    { label: 'Order Value', value: `₹${orderValue.toLocaleString()}` },
                    { label: 'Total Paid',  value: `₹${totalPaid.toLocaleString()}` },
                    { label: 'Balance Due', value: `₹${balance.toLocaleString()}` },
                  ].map((s) => (
                    <div key={s.label} className="bg-surface-container-low rounded-lg p-3 text-center">
                      <p className="text-[10px] font-bold text-on-surface-variant uppercase">{s.label}</p>
                      <p className="text-body-sm font-bold font-data-mono mt-1">{s.value}</p>
                    </div>
                  ))}
                </div>
                {balance > 0 && (
                  <div className="flex items-center gap-2 p-3 bg-error-container/30 border border-error/20 rounded-lg mb-4">
                    <span className="material-symbols-outlined text-[18px] text-error shrink-0">warning</span>
                    <p className="text-body-sm text-error font-semibold">₹{balance.toLocaleString()} is still outstanding.</p>
                  </div>
                )}
                {transitionError && <p className="text-error text-body-sm mb-4 p-3 bg-error-container/30 rounded-lg">{transitionError}</p>}
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setConfirmAction(null); setTransitionError(null); }} className="bk-btn-ghost px-5 py-2 text-body-sm border border-outline-variant/30">Cancel</button>
                  <button onClick={() => transitionMutation.mutate(ACTION_TO_STATUS.close)} disabled={transitionMutation.isPending} className="bk-btn flex items-center gap-2">
                    {transitionMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <span className="material-symbols-outlined text-[16px]">check_circle</span>}
                    Close Anyway
                  </button>
                </div>
              </>
            )}
            {confirmAction === 'cancel' && (
              <>
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-error">cancel</span>
                  </div>
                  <h3 className="text-headline-sm font-headline-sm text-error">Cancel Work Order</h3>
                </div>
                <p className="text-body-sm text-on-surface-variant mb-5">
                  Cancel <strong className="font-data-mono">{wo.wo_id}</strong>? This cannot be undone.
                </p>
                {transitionError && <p className="text-error text-body-sm mb-4 p-3 bg-error-container/30 rounded-lg">{transitionError}</p>}
                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setConfirmAction(null); setTransitionError(null); }} className="bk-btn flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span> Go Back
                  </button>
                  <button onClick={() => transitionMutation.mutate(ACTION_TO_STATUS.cancel)} disabled={transitionMutation.isPending}
                    className="flex items-center gap-2 px-5 py-2 rounded-lg bg-error text-on-error font-semibold text-body-sm hover:bg-error/90 transition-colors disabled:opacity-50">
                    {transitionMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <span className="material-symbols-outlined text-[16px]">cancel</span>}
                    Cancel WO
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── RELEASE PAYMENT MODAL ─────────────────────────────────────── */}
      {releaseModal && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setReleaseModal(null); setReleaseError(null); } }}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-card-lg border border-outline-variant/30 w-full max-w-md p-6">
            <div className="flex items-center gap-3 mb-1">
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px] text-primary">payments</span>
              </div>
              <div>
                <h3 className="text-headline-sm font-headline-sm">Release Payment</h3>
                <p className="text-body-sm text-on-surface-variant">{releaseModal.milestone.name}</p>
              </div>
            </div>

            {/* Milestone summary */}
            <div className="grid grid-cols-2 gap-3 my-4">
              <div className="bg-surface-container-low rounded-lg p-3">
                <p className="text-[10px] font-bold text-on-surface-variant uppercase">Planned</p>
                <p className="font-data-mono font-bold text-body-sm mt-0.5">₹{Number(releaseModal.milestone.planned_amount).toLocaleString()}</p>
              </div>
              <div className="bg-surface-container-low rounded-lg p-3">
                <p className="text-[10px] font-bold text-on-surface-variant uppercase">Remaining</p>
                <p className="font-data-mono font-bold text-body-sm mt-0.5 text-primary">₹{releaseModal.remaining.toLocaleString()}</p>
              </div>
            </div>

            <div className="space-y-3.5">
              {/* Amount */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Amount (₹)</label>
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 font-data-mono font-bold text-on-surface">₹</span>
                  <input
                    type="number" min="0" step="0.01"
                    value={releaseAmount}
                    onChange={(e) => setReleaseAmount(e.target.value)}
                    className="bk-input pl-8 font-data-mono font-bold"
                    placeholder="0"
                  />
                </div>
              </div>

              {/* Payment Mode */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Payment Mode</label>
                <select value={releaseMode} onChange={(e) => setReleaseMode(e.target.value as PaymentMode)} className="bk-input">
                  <option value="NEFT">NEFT</option>
                  <option value="UPI">UPI</option>
                  <option value="Cheque">Cheque</option>
                  <option value="Cash">Cash</option>
                </select>
              </div>

              {/* Date */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Date</label>
                <input type="date" value={releaseDate} onChange={(e) => setReleaseDate(e.target.value)} className="bk-input" />
              </div>

              {/* Remarks */}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">
                  Reference / Annotation <span className="font-normal opacity-60">(optional)</span>
                </label>
                <input
                  type="text"
                  value={releaseRemarks}
                  onChange={(e) => setReleaseRemarks(e.target.value)}
                  className="bk-input"
                  placeholder={`Payment for ${releaseModal.milestone.name}`}
                />
              </div>
            </div>

            {releaseError && (
              <p className="mt-3 text-error text-body-sm p-3 bg-error-container/30 rounded-lg">{releaseError}</p>
            )}

            <div className="flex gap-3 justify-end mt-5">
              <button onClick={() => { setReleaseModal(null); setReleaseError(null); }} className="bk-btn-ghost px-5 py-2 text-body-sm border border-outline-variant/30">
                Cancel
              </button>
              <button
                onClick={() => releaseMutation.mutate()}
                disabled={releaseMutation.isPending || !releaseAmount || !releaseDate}
                className="bk-btn flex items-center gap-2"
              >
                {releaseMutation.isPending
                  ? <><Loader2 size={16} className="animate-spin" /> Creating…</>
                  : <><span className="material-symbols-outlined text-[16px]">send_money</span> Confirm &amp; Create Transaction</>}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
