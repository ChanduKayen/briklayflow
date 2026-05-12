import { useState, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Breadcrumb from '../components/Breadcrumb';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2, ArrowLeft, Download, CheckCircle2 } from 'lucide-react';
import html2canvas from 'html2canvas';
import { jsPDF } from 'jspdf';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import type { StatusHistoryEntry, PaymentMode } from '../types';

type ConfirmAction = 'issue' | 'activate' | 'close' | 'cancel';
type MilestoneStatus = 'PENDING' | 'DUE' | 'PARTIALLY_PAID' | 'PAID';

// ─── Status badge helpers ────────────────────────────────────────────────────

export function statusBadgeClass(status: string) {
  switch (status) {
    case 'Draft':     return 'bg-surface-container-high text-on-surface-variant';
    case 'Issued':    return 'bg-blue-100 text-blue-800';
    case 'Active':    return 'bg-amber-100 text-amber-800';
    case 'Closed':    return 'bg-green-100 text-green-800';
    case 'Cancelled': return 'bg-error-container text-on-error-container';
    default:          return 'bg-surface-container-high text-on-surface-variant';
  }
}

function statusDotColor(status: string) {
  switch (status) {
    case 'Draft':     return 'bg-on-surface-variant/50';
    case 'Issued':    return 'bg-blue-500';
    case 'Active':    return 'bg-amber-500';
    case 'Closed':    return 'bg-green-500';
    case 'Cancelled': return 'bg-error';
    default:          return 'bg-on-surface-variant/30';
  }
}

function milestoneBadge(ms: MilestoneStatus) {
  switch (ms) {
    case 'PAID':          return 'bg-green-100 text-green-800';
    case 'PARTIALLY_PAID': return 'bg-blue-100 text-blue-800';
    case 'DUE':           return 'bg-amber-100 text-amber-800';
    default:              return 'bg-surface-container-high text-on-surface-variant';
  }
}

function getMilestoneStatus(milestone: any, paid: number): MilestoneStatus {
  const planned = Number(milestone.planned_amount) || 0;
  if (planned > 0 && paid >= planned) return 'PAID';
  if (paid > 0) return 'PARTIALLY_PAID';
  const d = milestone.trigger_condition ? new Date(milestone.trigger_condition) : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d && !isNaN(d.getTime()) && d < today) return 'DUE';
  return 'PENDING';
}

const ACTION_TO_STATUS: Record<ConfirmAction, string> = {
  issue: 'Issued', activate: 'Active', close: 'Closed', cancel: 'Cancelled',
};

const FLOW_STATES = ['Draft', 'Issued', 'Active', 'Closed'] as const;

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

// ─── Component ───────────────────────────────────────────────────────────────

export default function WorkOrderDetail({ session }: { session: Session }) {
  const { woId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const printRef = useRef<HTMLDivElement>(null);
  const navState = (location.state as { from?: string; projectId?: string; projectName?: string }) || {};

  const { data: profile } = useUserProfile(session.user.id);

  // Status transition state
  const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);

  // Status log toggle
  const [showLog, setShowLog] = useState(false);

  // Release payment state
  const [releaseModal, setReleaseModal] = useState<{ milestone: any; remaining: number } | null>(null);
  const [releaseAmount, setReleaseAmount] = useState('');
  const [releaseMode, setReleaseMode] = useState<PaymentMode>('NEFT');
  const [releaseDate, setReleaseDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [releaseRemarks, setReleaseRemarks] = useState('');
  const [releaseError, setReleaseError] = useState<string | null>(null);

  const canTransition = profile?.role === 'management' || profile?.role === 'accountant';

  // ─── Queries ───────────────────────────────────────────────────────────────

  const { data: wo, isLoading: loadingWo } = useQuery({
    queryKey: ['wo', woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, projects(name, site_location), stakeholders(name, category, contact)')
        .eq('wo_id', woId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!woId,
  });

  const { data: milestones, isLoading: loadingMilestones } = useQuery({
    queryKey: ['wo_milestones', woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wo_milestones')
        .select('*')
        .eq('wo_id', woId)
        .order('seq_no', { ascending: true });
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
        .select('*, transactions(txn_id, date, status, total_amount, payment_mode)')
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

  // ─── PDF export ────────────────────────────────────────────────────────────

  const handleDownloadPdf = async () => {
    if (!printRef.current) return;
    try {
      const canvas = await html2canvas(printRef.current, { scale: 2, useCORS: true });
      const imgData = canvas.toDataURL('image/png');
      const pdf = new jsPDF('p', 'mm', 'a4');
      const pdfWidth = pdf.internal.pageSize.getWidth();
      const pdfHeight = (canvas.height * pdfWidth) / canvas.width;
      pdf.addImage(imgData, 'PNG', 0, 0, pdfWidth, pdfHeight);
      pdf.save(`WorkOrder_${woId}.pdf`);
    } catch (err) {
      console.error('PDF error', err);
      alert('Failed to generate PDF.');
    }
  };

  // ─── Loading / not found ───────────────────────────────────────────────────

  if (loadingWo || loadingMilestones || loadingAllocs) {
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
  const balance = Math.max(0, orderValue - totalPaid);
  const progressPercentage = orderValue > 0 ? Math.min(100, Math.round((totalPaid / orderValue) * 100)) : 0;
  const totalMilestonesPlanned = (milestones || []).reduce((s, m: any) => s + (Number(m.planned_amount) || 0), 0);

  // Map milestone_id → first txn_id (for "View Payment" link)
  const milestoneFirstTxn: Record<string, string> = {};
  allocations?.forEach((a: any) => {
    if (a.milestone_id && a.transactions?.txn_id && !milestoneFirstTxn[a.milestone_id]) {
      milestoneFirstTxn[a.milestone_id] = a.transactions.txn_id;
    }
  });

  // ─── Audit trail data ──────────────────────────────────────────────────────

  const statusHistory: StatusHistoryEntry[] = (wo as any).status_history || [];
  const isCancelled = wo.status === 'Cancelled';
  const isFinal = wo.status === 'Closed' || wo.status === 'Cancelled';
  const currentFlowIdx = FLOW_STATES.indexOf(wo.status as any);
  const cancelledEntry = isCancelled ? statusHistory.find((e) => e.status === 'Cancelled') : null;

  const getHistoryEntry = (status: string) => {
    if (status === 'Draft') return { at: wo.created_at, by: wo.created_by || '—' };
    return statusHistory.find((e) => e.status === status) || null;
  };

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-12">
      {/* Breadcrumb */}
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

      {/* Header */}
      <div className="flex justify-between items-center mb-5">
        <button onClick={() => navigate(-1)} className="flex items-center gap-2 text-on-surface-variant hover:text-primary transition-colors font-semibold">
          <ArrowLeft size={20} /> Back
        </button>
        <button onClick={handleDownloadPdf} className="bk-btn flex items-center gap-2">
          <Download size={18} /> Export PDF
        </button>
      </div>

      {/* ── STATUS ACTION STRIP ───────────────────────────────────────── */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-card mb-6 overflow-hidden">
        {/* Single row */}
        <div className="flex items-center gap-3 px-5 py-3 flex-wrap">
          {/* Status dot + badge */}
          <div className="flex items-center gap-2 shrink-0">
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotColor(wo.status)}`} />
            <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full tracking-wide ${statusBadgeClass(wo.status)}`}>
              {wo.status?.toUpperCase()}
            </span>
          </div>

          {/* Action buttons or muted message */}
          {isFinal ? (
            <p className="text-body-sm text-on-surface-variant italic">
              This work order is {wo.status.toLowerCase()}.
            </p>
          ) : canTransition ? (
            <div className="flex items-center gap-2 flex-wrap">
              {wo.status === 'Draft' && (
                <button onClick={() => setConfirmAction('issue')} className="bk-btn flex items-center gap-1.5 py-1.5 px-3 text-[13px]">
                  <span className="material-symbols-outlined text-[16px]">send</span>
                  Issue Work Order
                </button>
              )}
              {wo.status === 'Issued' && (
                <button onClick={() => setConfirmAction('activate')} className="bk-btn flex items-center gap-1.5 py-1.5 px-3 text-[13px]">
                  <span className="material-symbols-outlined text-[16px]">play_circle</span>
                  Mark as Active
                </button>
              )}
              {wo.status === 'Active' && (
                <button onClick={() => setConfirmAction('close')} className="bk-btn flex items-center gap-1.5 py-1.5 px-3 text-[13px]">
                  <span className="material-symbols-outlined text-[16px]">check_circle</span>
                  Close Work Order
                </button>
              )}
              <button
                onClick={() => setConfirmAction('cancel')}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-error/30 text-error text-[13px] font-semibold hover:bg-error-container/30 transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">cancel</span>
                Cancel WO
              </button>
            </div>
          ) : null}

          {/* View log toggle — always far right */}
          <button
            onClick={() => setShowLog((v) => !v)}
            className="ml-auto flex items-center gap-1 text-[12px] text-on-surface-variant hover:text-primary transition-colors font-medium shrink-0"
          >
            {showLog ? 'Hide log' : 'View log'}
            <span className="material-symbols-outlined text-[14px]">
              {showLog ? 'expand_less' : 'chevron_right'}
            </span>
          </button>
        </div>

        {/* Collapsible audit trail */}
        {showLog && (
          <div className="border-t border-outline-variant/15 px-5 py-4">
            <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-3">Status History</p>
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
            </div>
          </div>
        )}
      </div>

      {/* ── PRINTABLE AREA ────────────────────────────────────────────── */}
      <div ref={printRef} className="bg-surface-container-lowest rounded-2xl shadow-card border border-outline-variant/30 overflow-hidden">
        <div className="h-2 w-full bg-primary" />
        <div className="p-8 md:p-12">

          {/* Header */}
          <div className="flex flex-col md:flex-row justify-between items-start mb-12 gap-8 border-b border-outline-variant/20 pb-8">
            <div>
              <h1 className="text-display-sm font-display-sm font-black text-primary mb-2">Work Order</h1>
              <div className="flex items-center gap-3">
                <span className="bg-surface-container-high px-3 py-1 rounded-md font-data-mono font-bold text-on-surface tracking-wider">{wo.wo_id}</span>
                <span className={`px-3 py-1 text-label-caps font-label-caps rounded-full ${statusBadgeClass(wo.status)}`}>{wo.status?.toUpperCase()}</span>
              </div>
            </div>
            <div className="text-left md:text-right">
              <p className="text-label-caps font-label-caps text-on-surface-variant mb-1">DATE ISSUED</p>
              <p className="font-bold text-body-lg text-on-surface">
                {new Date(wo.date_issued).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
              </p>
            </div>
          </div>

          {/* Details grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 mb-12">
            <div className="space-y-6">
              <div>
                <p className="text-label-caps font-label-caps text-on-surface-variant mb-2">PROJECT DETAILS</p>
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/20">
                  <h3 className="font-bold text-headline-sm mb-1">{wo.projects?.name}</h3>
                  <p className="text-body-sm text-on-surface-variant flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">location_on</span>
                    {wo.projects?.site_location}
                  </p>
                </div>
              </div>
              <div>
                <p className="text-label-caps font-label-caps text-on-surface-variant mb-2">ASSIGNED TO</p>
                <div className="bg-surface-container-low p-4 rounded-xl border border-outline-variant/20">
                  <h3 className="font-bold text-headline-sm mb-1">{wo.stakeholders?.name}</h3>
                  <p className="text-body-sm text-on-surface-variant flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">person</span>
                    {wo.stakeholders?.category}
                  </p>
                  {wo.stakeholders?.contact && (
                    <p className="text-body-sm text-on-surface-variant flex items-center gap-2 mt-1">
                      <span className="material-symbols-outlined text-[16px]">call</span>
                      {wo.stakeholders.contact}
                    </p>
                  )}
                </div>
              </div>
            </div>
            <div>
              <p className="text-label-caps font-label-caps text-on-surface-variant mb-2">SCOPE OF WORK</p>
              <div className="bg-surface-container-low p-5 rounded-xl border border-outline-variant/20 h-full flex items-start">
                <p className="text-body-md text-on-surface leading-relaxed whitespace-pre-wrap">{wo.scope_of_work}</p>
              </div>
            </div>
          </div>

          {/* ── Financial Summary ─────────────────────────────── */}
          <div className="mb-12">
            <h3 className="text-headline-md font-headline-md mb-4 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">account_balance_wallet</span>
              Financial Summary
            </h3>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Order Value',         value: `₹${orderValue.toLocaleString()}`,              color: 'text-primary',   border: 'border-primary/10',    bg: 'bg-primary/5' },
                { label: 'Milestones Planned',  value: `₹${totalMilestonesPlanned.toLocaleString()}`,  color: 'text-on-surface', border: 'border-outline-variant/20', bg: '' },
                { label: 'Total Paid',          value: `₹${totalPaid.toLocaleString()}`,               color: 'text-secondary', border: 'border-secondary/10',  bg: 'bg-secondary/5' },
                { label: 'Balance Due',         value: `₹${balance.toLocaleString()}`,                 color: 'text-error',     border: 'border-error/10',      bg: 'bg-error/5' },
              ].map((s) => (
                <div key={s.label} className={`${s.bg} p-5 rounded-2xl border-2 ${s.border} shadow-sm`}>
                  <p className="text-label-caps font-label-caps text-on-surface-variant mb-2">{s.label.toUpperCase()}</p>
                  <p className={`text-headline-md font-data-mono font-bold ${s.color}`}>{s.value}</p>
                </div>
              ))}
            </div>
            <div className="mt-6">
              <div className="flex justify-between items-end mb-2">
                <span className="text-label-caps font-label-caps text-on-surface-variant">PAYMENT PROGRESS</span>
                <span className="font-bold text-body-lg text-primary">{progressPercentage}%</span>
              </div>
              <div className="w-full h-3 bg-surface-container-high rounded-full overflow-hidden">
                <div className="h-full bg-gradient-to-r from-primary to-secondary transition-all duration-1000 ease-out" style={{ width: `${progressPercentage}%` }} />
              </div>
            </div>
          </div>

          {/* ── Phases & Payments ─────────────────────────────── */}
          <div className="mb-12">
            <h3 className="text-headline-md font-headline-md mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">view_timeline</span>
              Phases &amp; Payments
            </h3>

            {!milestones || milestones.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant italic p-4 bg-surface-container-low rounded-xl">
                No phases defined for this order.
              </p>
            ) : (
              <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-body-sm">
                    <thead className="bg-surface-container-low border-b border-outline-variant/20">
                      <tr>
                        <th className="px-5 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Phase</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide text-right">Planned</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Due Date</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide text-right">Paid</th>
                        <th className="px-4 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Status</th>
                        <th className="px-5 py-3 text-[10px] font-bold text-on-surface-variant uppercase tracking-wide">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-outline-variant/10">
                      {milestones.map((m: any) => {
                        const planned = Number(m.planned_amount) || 0;
                        const paid = milestonePayments[m.milestone_id] || 0;
                        const remaining = Math.max(0, planned - paid);
                        const ms = getMilestoneStatus(m, paid);
                        const firstTxnId = milestoneFirstTxn[m.milestone_id];
                        const dueDateStr = m.trigger_condition;
                        const showDueDate = dueDateStr && !isNaN(new Date(dueDateStr).getTime());

                        return (
                          <tr key={m.milestone_id} className="hover:bg-surface-container-low/50 transition-colors">
                            <td className="px-5 py-3.5">
                              <p className="font-semibold text-on-surface">{m.seq_no}. {m.name}</p>
                              {!showDueDate && dueDateStr && (
                                <p className="text-[11px] text-on-surface-variant mt-0.5 flex items-center gap-1">
                                  <span className="material-symbols-outlined text-[12px]">flag</span>
                                  {dueDateStr}
                                </p>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-right font-data-mono font-semibold text-on-surface">
                              ₹{planned.toLocaleString()}
                            </td>
                            <td className="px-4 py-3.5">
                              {showDueDate ? (
                                <span className={`text-[12px] ${isDueDate(dueDateStr) && ms !== 'PAID' ? 'text-amber-700 font-semibold' : 'text-on-surface-variant'}`}>
                                  {fmtDate(dueDateStr)}
                                </span>
                              ) : (
                                <span className="text-on-surface-variant/40">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3.5 text-right font-data-mono text-on-surface">
                              {paid > 0 ? `₹${paid.toLocaleString()}` : <span className="text-on-surface-variant/40">—</span>}
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${milestoneBadge(ms)}`}>
                                {ms === 'PARTIALLY_PAID' ? 'PARTIAL' : ms.replace('_', ' ')}
                              </span>
                            </td>
                            <td className="px-5 py-3.5">
                              {ms === 'PAID' ? (
                                firstTxnId ? (
                                  <button
                                    onClick={() => navigate(`/ledger/${firstTxnId}`)}
                                    className="text-primary text-[12px] font-semibold hover:underline flex items-center gap-0.5"
                                  >
                                    View Payment
                                    <span className="material-symbols-outlined text-[13px]">arrow_forward</span>
                                  </button>
                                ) : (
                                  <span className="text-on-surface-variant/40 text-[12px]">—</span>
                                )
                              ) : (
                                <button
                                  onClick={() => {
                                    setReleaseModal({ milestone: m, remaining });
                                    setReleaseAmount(String(remaining || planned));
                                    setReleaseDate(new Date().toISOString().split('T')[0]);
                                    setReleaseMode('NEFT');
                                    setReleaseRemarks('');
                                    setReleaseError(null);
                                  }}
                                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-primary/10 text-primary text-[12px] font-semibold hover:bg-primary/20 transition-colors"
                                >
                                  <span className="material-symbols-outlined text-[14px]">payments</span>
                                  Release Payment
                                </button>
                              )}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* ── Transaction History ───────────────────────────── */}
          <div>
            <h3 className="text-headline-md font-headline-md mb-6 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary">receipt_long</span>
              Transaction History
            </h3>
            {allocations?.length === 0 ? (
              <p className="text-body-sm text-on-surface-variant italic p-4 bg-surface-container-low rounded-xl">
                No payments have been recorded for this order yet.
              </p>
            ) : (
              <div className="bg-surface-container-lowest border border-outline-variant/30 rounded-xl overflow-hidden">
                <table className="w-full text-left">
                  <thead className="bg-surface-container-low border-b border-outline-variant/20">
                    <tr>
                      <th className="p-4 text-label-caps font-label-caps text-on-surface-variant">DATE</th>
                      <th className="p-4 text-label-caps font-label-caps text-on-surface-variant">TXN ID</th>
                      <th className="p-4 text-label-caps font-label-caps text-on-surface-variant">MODE</th>
                      <th className="p-4 text-label-caps font-label-caps text-on-surface-variant">PHASE</th>
                      <th className="p-4 text-label-caps font-label-caps text-on-surface-variant text-right">AMOUNT (₹)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-outline-variant/10">
                    {allocations?.map((alloc: any, idx: number) => {
                      const txn = alloc.transactions;
                      const phase = milestones?.find((m: any) => m.milestone_id === alloc.milestone_id);
                      if (!txn) return null;
                      return (
                        <tr key={`${alloc.allocation_id}-${idx}`}
                          onClick={() => navigate(`/ledger/${txn.txn_id}`)}
                          className="hover:bg-surface-container-low cursor-pointer transition-colors">
                          <td className="p-4 text-body-sm">{new Date(txn.date).toLocaleDateString()}</td>
                          <td className="p-4 font-data-mono text-primary text-body-sm">{txn.txn_id}</td>
                          <td className="p-4 text-body-sm">{txn.payment_mode}</td>
                          <td className="p-4 text-body-sm">
                            {phase ? (
                              <span className="bg-surface-container px-2 py-1 rounded text-xs">{phase.name}</span>
                            ) : (
                              <span className="text-on-surface-variant italic">Unlinked</span>
                            )}
                          </td>
                          <td className="p-4 text-right font-data-mono font-bold text-on-surface">
                            {Number(alloc.allocated_amount).toLocaleString()}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="mt-16 pt-8 border-t border-outline-variant/20 flex justify-between items-center opacity-50">
            <span className="text-headline-sm font-headline-sm font-black text-primary">Briklay</span>
            <span className="text-label-caps font-label-caps">Generated on {new Date().toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      {/* ── STATUS TRANSITION MODAL ───────────────────────────────────── */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setConfirmAction(null); setTransitionError(null); } }}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-card-lg border border-outline-variant/30 w-full max-w-md p-6">
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
