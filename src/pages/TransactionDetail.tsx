import { useState } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2, ArrowLeft, Download, ExternalLink } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import Breadcrumb from '../components/Breadcrumb';
import { useUserProfile } from '../App';

// ─── Amendment types ──────────────────────────────────────────────────────────
// Requires: ALTER TABLE transactions ADD COLUMN amendments jsonb DEFAULT '[]'::jsonb;

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
  changes: Record<string, [any, any]>; // label → [old, new]
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function TransactionDetail({ session }: { session: Session }) {
  const { txnId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const focusProjectId = searchParams.get('project');
  const navState = (location.state as { from?: string; projectId?: string; projectName?: string }) || {};
  const qc = useQueryClient();

  const { data: profile } = useUserProfile(session.user.id);

  // ─── Allocation mapping state ───────────────────────────────────────────────
  const [mappingId, setMappingId] = useState<string | null>(null);
  const [mapType, setMapType] = useState<'WO' | 'PO' | ''>('');
  const [mapRef, setMapRef] = useState('');
  const [showMapPanel, setShowMapPanel] = useState(false);

  // ─── Void state ─────────────────────────────────────────────────────────────
  const [voidConfirm, setVoidConfirm] = useState(false);

  // ─── Amendment state ─────────────────────────────────────────────────────────
  const [amendStep, setAmendStep] = useState<'idle' | 'edit' | 'diff'>('idle');
  const [amendForm, setAmendForm] = useState({
    total_amount: '',
    date: '',
    payment_mode: '',
    category: '',
    remarks: '',
  });
  const [amendError, setAmendError] = useState<string | null>(null);
  const [showAmendHistory, setShowAmendHistory] = useState(false);

  const isManagement = profile?.role === 'management';
  const canVoid = profile?.role === 'management' || profile?.role === 'accountant';

  // ─── Queries ─────────────────────────────────────────────────────────────────

  const { data: txn, isLoading: txnLoading } = useQuery({
    queryKey: ['transaction', txnId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, stakeholders(*)')
        .eq('txn_id', txnId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: allocs, isLoading: allocsLoading } = useQuery({
    queryKey: ['txn_allocations', txnId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('*, projects(name)')
        .eq('txn_id', txnId);
      if (error) throw error;
      return data;
    },
  });

  const { data: milestones } = useQuery({
    queryKey: ['milestones'],
    queryFn: async () => {
      const { data } = await supabase
        .from('wo_milestones')
        .select('*, work_orders(project_id, stakeholder_id, scope_of_work)');
      return data as any[];
    },
  });

  const { data: purchaseOrders } = useQuery({
    queryKey: ['purchase_orders'],
    queryFn: async () => {
      const { data } = await supabase.from('purchase_orders').select('*');
      return data as any[];
    },
  });

  // ─── Mutations ────────────────────────────────────────────────────────────────

  const updateAlloc = useMutation({
    mutationFn: async ({ allocId, order_type, order_ref, milestone_id }: { allocId: string; order_type: string; order_ref: string; milestone_id?: string }) => {
      const { error } = await supabase
        .from('txn_allocations')
        .update({ order_type, order_ref, milestone_id: milestone_id || null })
        .eq('allocation_id', allocId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['txn_allocations', txnId] });
      qc.invalidateQueries({ queryKey: ['transaction', txnId] });
      setMappingId(null);
      setMapType('');
      setMapRef('');
    },
  });

  const voidMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from('transactions')
        .update({ status: 'Voided', voided_by: session.user.id, voided_at: new Date().toISOString() })
        .eq('txn_id', txnId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction', txnId] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setVoidConfirm(false);
    },
  });

  const amendMutation = useMutation({
    mutationFn: async () => {
      if (!txn) throw new Error('Transaction not loaded.');
      if (!('amendments' in txn)) {
        throw new Error(
          "Amendment column missing. Run in Supabase SQL Editor:\n" +
          "ALTER TABLE transactions ADD COLUMN amendments jsonb DEFAULT '[]'::jsonb;"
        );
      }
      const userName = profile?.name || session.user.email || 'Unknown';
      const newAmendment: AmendmentRecord = {
        id: String(Date.now()),
        amended_by: userName,
        amended_at: new Date().toISOString(),
        changes: amendDiff,
        snapshot: {
          total_amount: Number(amendForm.total_amount),
          date: amendForm.date,
          payment_mode: amendForm.payment_mode,
          category: amendForm.category,
          remarks: amendForm.remarks,
        },
      };
      const existing: AmendmentRecord[] = (txn as any).amendments || [];
      const { error } = await supabase
        .from('transactions')
        .update({ amendments: [...existing, newAmendment] })
        .eq('txn_id', txnId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['transaction', txnId] });
      qc.invalidateQueries({ queryKey: ['transactions'] });
      setAmendStep('idle');
      setAmendError(null);
      setShowAmendHistory(true); // auto-expand history on success
    },
    onError: (err: any) => setAmendError(err.message || 'Amendment failed.'),
  });

  // ─── Derived values ────────────────────────────────────────────────────────────

  const isLoading = txnLoading || allocsLoading;

  if (isLoading) {
    return <div className="flex justify-center py-16"><Loader2 className="animate-spin text-secondary" size={32} /></div>;
  }

  if (!txn) {
    return <div className="p-8 text-center text-on-surface-variant">Transaction not found.</div>;
  }

  // Amendment effective values — latest snapshot overrides original fields
  const existingAmendments: AmendmentRecord[] = (txn as any).amendments || [];
  const latestSnapshot = existingAmendments.length > 0
    ? existingAmendments[existingAmendments.length - 1].snapshot
    : null;
  const effective: AmendmentSnapshot = latestSnapshot ?? {
    total_amount: txn.total_amount,
    date: txn.date,
    payment_mode: txn.payment_mode,
    category: txn.category,
    remarks: txn.remarks,
  };
  const isAmended = existingAmendments.length > 0;

  // Diff — computed inline when in 'diff' step
  const amendDiff: Record<string, [any, any]> = {};
  if (amendStep === 'diff') {
    const LABELS: Record<string, [keyof AmendmentSnapshot, string]> = {
      Amount:        ['total_amount', 'Amount'],
      Date:          ['date', 'Date'],
      'Payment Mode': ['payment_mode', 'Payment Mode'],
      Category:      ['category', 'Category'],
      Remarks:       ['remarks', 'Remarks'],
    };
    for (const [label, [key]] of Object.entries(LABELS)) {
      const oldVal = String((effective as any)[key] ?? '');
      const newVal = String((amendForm as any)[key] ?? '');
      if (oldVal !== newVal) {
        amendDiff[label] = [(effective as any)[key], (amendForm as any)[key]];
      }
    }
  }

  const hasDiff = Object.keys(amendDiff).length > 0;

  const openAmendModal = () => {
    setAmendForm({
      total_amount: String(effective.total_amount ?? ''),
      date: effective.date ?? '',
      payment_mode: effective.payment_mode ?? '',
      category: effective.category ?? '',
      remarks: effective.remarks ?? '',
    });
    setAmendError(null);
    setAmendStep('edit');
  };

  const isImage = txn.bill_doc_url?.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i);
  const isPDF = txn.bill_doc_url?.match(/\.(pdf)(\?.*)?$/i);

  const primaryAlloc = focusProjectId
    ? (allocs?.find((a) => a.project_id === focusProjectId) ?? allocs?.[0])
    : allocs?.[0];
  const secondaryAllocs = allocs?.filter((a) => a !== primaryAlloc) ?? [];
  const isSplit = (allocs?.length ?? 0) > 1;

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-12">
      <Breadcrumb
        items={
          navState.from === 'project' && navState.projectName
            ? [
                { label: 'Dashboard', href: '/' },
                { label: 'Projects', href: '/projects' },
                { label: navState.projectName, href: `/projects/${navState.projectId}` },
                { label: 'Transactions', href: `/projects/${navState.projectId}` },
                { label: txnId! },
              ]
            : [
                { label: 'Dashboard', href: '/' },
                { label: 'Transactions', href: '/ledger' },
                { label: txnId! },
              ]
        }
      />
      <button
        onClick={() => navigate(-1)}
        className="mb-4 text-on-surface-variant hover:text-primary flex items-center gap-1 text-label-caps font-label-caps transition-colors"
      >
        <ArrowLeft size={16} /> BACK
      </button>

      <div className="flex flex-col lg:flex-row gap-8 items-start">
        {/* ── Left Column ──────────────────────────────────────────── */}
        <div className="flex-1 w-full space-y-stack-lg">

          {/* Header */}
          <div className="flex justify-between items-start flex-wrap gap-4">
            <div>
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <h1 className="text-headline-lg font-headline-lg text-on-surface">{txn.txn_id}</h1>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  txn.status === 'Active'
                    ? 'bg-secondary-container text-on-secondary-container'
                    : 'bg-surface-container-high text-on-surface-variant'
                }`}>
                  {txn.status?.toUpperCase()}
                </span>
                {isAmended && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[12px]">edit_note</span> AMENDED
                  </span>
                )}
                {txn.ai_flag_status === 'Flagged' && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-error-container text-error flex items-center gap-1">
                    <span className="material-symbols-outlined text-[14px]">flag</span> FLAGGED
                  </span>
                )}
              </div>
              <p className="text-body-lg text-on-surface-variant">
                {effective.category} · {new Date(effective.date).toLocaleDateString()}
              </p>
            </div>

            <div className="flex items-start gap-3 flex-wrap">
              {/* Amount */}
              <div className="text-right">
                <p className="text-[10px] font-bold text-on-surface-variant mb-1">TOTAL AMOUNT</p>
                <p className="text-headline-lg font-data-mono font-bold text-on-background">
                  ₹{Number(effective.total_amount).toLocaleString()}
                </p>
              </div>

              {/* Action buttons */}
              {txn.status !== 'Voided' && (
                <div className="flex gap-2 mt-1">
                  {isManagement && (
                    <button
                      onClick={openAmendModal}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-outline-variant/40 text-body-sm font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">edit_note</span>
                      Amend
                    </button>
                  )}
                  {canVoid && (
                    <button
                      onClick={() => setVoidConfirm(true)}
                      className="flex items-center gap-1.5 px-3 py-2 rounded-lg border border-error/30 text-error text-body-sm font-semibold hover:bg-error-container/20 transition-colors"
                    >
                      <span className="material-symbols-outlined text-[16px]">block</span>
                      Void
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Cards Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-gutter">
            {/* Stakeholder */}
            <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/30 shadow-card hover:shadow-card-md transition-shadow">
              <h3 className="text-label-caps font-label-caps text-on-surface-variant mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">person</span> PAID TO
              </h3>
              {txn.stakeholders ? (
                <div>
                  <p className="text-headline-sm font-bold text-on-surface mb-1">{txn.stakeholders.name}</p>
                  <p className="text-body-sm text-on-surface-variant">{txn.stakeholders.type} · {txn.stakeholders.category}</p>
                  <p className="text-body-sm text-on-surface-variant mt-2 font-data-mono">{txn.stakeholders.stakeholder_id}</p>
                  {txn.stakeholders.contact && (
                    <p className="text-body-sm text-on-surface-variant mt-1 flex items-center gap-1">
                      <span className="material-symbols-outlined text-[16px]">call</span> {txn.stakeholders.contact}
                    </p>
                  )}
                </div>
              ) : (
                <p className="text-on-surface-variant italic">Unknown Stakeholder</p>
              )}
            </div>

            {/* Payment Info */}
            <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/30 shadow-card hover:shadow-card-md transition-shadow">
              <h3 className="text-label-caps font-label-caps text-on-surface-variant mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">payments</span> PAYMENT INFO
              </h3>
              <div className="space-y-4">
                <div>
                  <p className="text-[10px] font-bold text-on-surface-variant">MODE</p>
                  <p className="text-body-lg font-medium">{effective.payment_mode}</p>
                </div>
                <div>
                  <p className="text-[10px] font-bold text-on-surface-variant">DATE RECORDED</p>
                  <p className="text-body-lg font-medium">{new Date(txn.created_at).toLocaleString()}</p>
                </div>
                {primaryAlloc && (
                  <div>
                    <p className="text-[10px] font-bold text-on-surface-variant">PROJECT</p>
                    <p className="text-body-lg font-bold text-on-surface">
                      {primaryAlloc.projects?.name || primaryAlloc.project_id}
                      {isSplit && (
                        <span className="ml-2 font-data-mono font-normal text-body-sm text-secondary">
                          · ₹{Number(primaryAlloc.allocated_amount).toLocaleString()} allocated
                        </span>
                      )}
                    </p>
                    {isSplit && secondaryAllocs.length > 0 && (
                      <div className="mt-1.5">
                        <p className="text-[11px] text-on-surface-variant mb-1">Also allocated to:</p>
                        {secondaryAllocs.map((a) => (
                          <p key={a.allocation_id} className="text-[12px] text-on-surface-variant">
                            {a.projects?.name || a.project_id}
                            <span className="font-data-mono ml-1">— ₹{Number(a.allocated_amount).toLocaleString()}</span>
                          </p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* AI Flag */}
          {txn.ai_flag_status === 'Flagged' && txn.ai_flag_data && (
            <div className="bg-error-container/10 p-6 rounded-2xl border border-error-container/30 shadow-card">
              <h3 className="text-label-caps font-label-caps text-error mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">warning</span> FLAG REASON
              </h3>
              <p className="text-body-sm text-error/80 font-medium">{txn.ai_flag_data.reason || 'Transaction flagged for manual review.'}</p>
              {txn.ai_flag_data.details && (
                <pre className="mt-2 text-[10px] text-error/60 overflow-x-auto p-2 bg-error-container/20 rounded whitespace-pre-wrap">
                  {JSON.stringify(txn.ai_flag_data.details, null, 2)}
                </pre>
              )}
              {String(txn.ai_flag_data.reason || '').toLowerCase().includes('unmapped') && allocs && allocs.length > 0 && (() => {
                const stkType = txn.stakeholders?.type;
                const unlinkedAllocs = allocs.filter((a) => !a.order_type);
                const allRelMS = stkType === 'Worker' ? milestones?.filter((m) => m.work_orders?.stakeholder_id === txn.stakeholder_id) || [] : [];
                const allRelPOs = stkType === 'Vendor' ? purchaseOrders?.filter((p) => p.stakeholder_id === txn.stakeholder_id) || [] : [];
                return (
                  <div className="mt-4 pt-4 border-t border-error-container/30">
                    <p className="text-[11px] text-on-surface-variant mb-3">Resolve this flag by mapping to an existing order or creating a new one:</p>
                    <div className="flex flex-wrap gap-2 mb-3">
                      <button
                        onClick={() => setShowMapPanel(!showMapPanel)}
                        className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold transition-colors border ${showMapPanel ? 'bg-primary text-on-primary border-primary' : 'bg-primary/10 text-primary border-primary/20 hover:bg-primary/20'}`}
                      >
                        <span className="material-symbols-outlined text-[16px]">{showMapPanel ? 'expand_less' : 'link'}</span>
                        {showMapPanel ? 'Close' : `Map to Existing ${stkType === 'Worker' ? 'Work Order' : 'Purchase Order'}`}
                      </button>
                      <button
                        onClick={() => navigate(stkType === 'Worker' ? '/work-orders/new' : '/purchase-orders', { state: { projectId: allocs[0]?.project_id, stakeholderId: txn.stakeholder_id } })}
                        className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-[12px] font-bold bg-surface-container-lowest text-error border border-error/20 hover:bg-error/10 transition-colors"
                      >
                        <span className="material-symbols-outlined text-[16px]">add</span> Create New {stkType === 'Worker' ? 'Work Order' : 'Purchase Order'}
                      </button>
                    </div>
                    {showMapPanel && (
                      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 overflow-hidden">
                        <div className="px-4 py-3 bg-surface-container-low border-b border-outline-variant/20">
                          <p className="text-[11px] font-bold text-on-surface-variant">Select a {stkType === 'Worker' ? 'work order phase' : 'purchase order'} to map this transaction to:</p>
                        </div>
                        <div className="divide-y divide-outline-variant/10 max-h-64 overflow-y-auto">
                          {stkType === 'Worker' && allRelMS.map((m: any) => (
                            <button key={m.milestone_id}
                              onClick={() => { const unlinked = unlinkedAllocs[0]; if (unlinked) updateAlloc.mutate({ allocId: unlinked.allocation_id, order_type: 'WO', order_ref: m.wo_id, milestone_id: m.milestone_id }); setShowMapPanel(false); }}
                              className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-primary/5 transition-colors group">
                              <div className="w-9 h-9 rounded-full bg-secondary-container/30 flex items-center justify-center shrink-0 group-hover:bg-secondary-container/60 transition-colors">
                                <span className="material-symbols-outlined text-[18px] text-secondary">assignment</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-body-sm font-semibold text-on-surface truncate">{m.name}</p>
                                <p className="text-[10px] text-on-surface-variant font-data-mono">{m.wo_id} · {m.work_orders?.scope_of_work?.substring(0, 40) || 'No scope'}</p>
                              </div>
                              <div className="text-right shrink-0">
                                <p className="font-data-mono font-bold text-body-sm text-on-surface">₹{Number(m.planned_amount).toLocaleString()}</p>
                                <p className={`text-[10px] font-bold ${m.status === 'Completed' ? 'text-secondary' : 'text-on-surface-variant'}`}>{m.status}</p>
                              </div>
                              <span className="material-symbols-outlined text-[18px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">arrow_forward</span>
                            </button>
                          ))}
                          {stkType === 'Vendor' && allRelPOs.map((p: any) => (
                            <button key={p.po_id}
                              onClick={() => { const unlinked = unlinkedAllocs[0]; if (unlinked) updateAlloc.mutate({ allocId: unlinked.allocation_id, order_type: 'PO', order_ref: p.po_id }); setShowMapPanel(false); }}
                              className="w-full flex items-center gap-4 px-4 py-3 text-left hover:bg-primary/5 transition-colors group">
                              <div className="w-9 h-9 rounded-full bg-tertiary-container/30 flex items-center justify-center shrink-0">
                                <span className="material-symbols-outlined text-[18px] text-tertiary">shopping_cart</span>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className="text-body-sm font-semibold text-on-surface truncate">{p.po_id}</p>
                                <p className="text-[10px] text-on-surface-variant">₹{Number(p.order_value).toLocaleString()}</p>
                              </div>
                              <span className="material-symbols-outlined text-[18px] text-primary opacity-0 group-hover:opacity-100 transition-opacity">arrow_forward</span>
                            </button>
                          ))}
                          {((stkType === 'Worker' && allRelMS.length === 0) || (stkType === 'Vendor' && allRelPOs.length === 0)) && (
                            <div className="px-4 py-6 text-center text-on-surface-variant">
                              <span className="material-symbols-outlined text-[32px] opacity-20 mb-2 block">inbox</span>
                              <p className="text-body-sm">No {stkType === 'Worker' ? 'work orders' : 'purchase orders'} found for this stakeholder.</p>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          )}

          {/* Remarks */}
          {effective.remarks && (
            <div className="bg-surface-container-lowest p-6 rounded-2xl border border-outline-variant/30 shadow-card hover:shadow-card-md transition-shadow">
              <h3 className="text-label-caps font-label-caps text-on-surface-variant mb-4 flex items-center gap-2">
                <span className="material-symbols-outlined text-[18px]">notes</span> ANNOTATIONS / REMARKS
              </h3>
              <p className="text-body-md text-on-surface whitespace-pre-wrap">{effective.remarks}</p>
            </div>
          )}

          {/* ── Amendment History ─────────────────────────────────────── */}
          {isAmended && (
            <div className="bg-surface-container-lowest rounded-2xl border border-blue-100 shadow-card overflow-hidden">
              <button
                onClick={() => setShowAmendHistory((v) => !v)}
                className="w-full flex items-center justify-between px-6 py-4 hover:bg-surface-container-low transition-colors"
              >
                <span className="flex items-center gap-2 text-blue-700 font-semibold text-body-sm">
                  <span className="material-symbols-outlined text-[18px]">edit_note</span>
                  {existingAmendments.length} amendment{existingAmendments.length > 1 ? 's' : ''} · View history
                </span>
                <span className="material-symbols-outlined text-[18px] text-on-surface-variant">
                  {showAmendHistory ? 'expand_less' : 'chevron_right'}
                </span>
              </button>

              {showAmendHistory && (
                <div className="border-t border-blue-100 divide-y divide-outline-variant/10">
                  {[...existingAmendments].reverse().map((a, i) => (
                    <div key={a.id} className="px-6 py-4">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="material-symbols-outlined text-[14px] text-blue-600">edit_note</span>
                        <p className="text-body-sm font-semibold text-on-surface">
                          Amended by {a.amended_by}
                        </p>
                        <span className="text-[11px] text-on-surface-variant ml-1">
                          · {new Date(a.amended_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {i === 0 && (
                          <span className="ml-auto px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-100 text-blue-700">LATEST</span>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-x-4 gap-y-1">
                        {Object.entries(a.changes).map(([label, [oldVal, newVal]]) => (
                          <p key={label} className="text-[12px] text-on-surface-variant">
                            <span className="font-semibold text-on-surface">{label}:</span>{' '}
                            <span className="line-through opacity-60">{fmtAmendVal(label, oldVal)}</span>
                            {' → '}
                            <span className="text-blue-700 font-medium">{fmtAmendVal(label, newVal)}</span>
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Project Allocations */}
          <div id="alloc-table" className="bg-surface-container-lowest rounded-2xl border border-outline-variant/30 shadow-sm overflow-hidden">
            <div className="px-6 py-4 bg-surface-container-low border-b border-outline-variant/30 flex justify-between items-center">
              <h3 className="text-headline-md font-headline-md flex items-center gap-2">
                <span className="material-symbols-outlined">account_tree</span> Project Allocations
              </h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead className="bg-surface-container-lowest border-b border-outline-variant/20">
                  <tr>
                    <th className="p-4 text-label-caps font-label-caps text-on-surface-variant">PROJECT</th>
                    <th className="p-4 text-label-caps font-label-caps text-on-surface-variant">LINKED ORDER</th>
                    <th className="p-4 text-label-caps font-label-caps text-on-surface-variant text-right">AMOUNT</th>
                  </tr>
                </thead>
                <tbody>
                  {allocs?.length === 0 && (
                    <tr><td colSpan={3} className="p-6 text-center text-on-surface-variant italic">No allocations mapped.</td></tr>
                  )}
                  {allocs?.map((a) => {
                    const isUnlinked = !a.order_type;
                    const isMapping = mappingId === a.allocation_id;
                    const stkType = txn.stakeholders?.type;
                    const relMS = stkType === 'Worker' ? milestones?.filter((m) => m.work_orders?.stakeholder_id === txn.stakeholder_id && m.work_orders?.project_id === a.project_id) : [];
                    const relPOs = stkType === 'Vendor' ? purchaseOrders?.filter((p) => p.stakeholder_id === txn.stakeholder_id && p.project_id === a.project_id) : [];
                    return (
                      <tr key={a.allocation_id} className={`border-b border-outline-variant/10 transition-colors ${isUnlinked ? 'bg-tertiary-container/5' : 'hover:bg-surface-container-lowest'}`}>
                        <td className="p-4">
                          <p className="font-semibold text-body-md text-on-surface">{a.projects?.name || 'Unassigned'}</p>
                          <p className="text-[10px] text-on-surface-variant font-data-mono">{a.project_id}</p>
                        </td>
                        <td className="p-4">
                          {a.order_type ? (
                            <div className="flex items-center gap-2">
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-on-surface shrink-0">{a.order_type}</span>
                              <button onClick={() => navigate(a.order_type === 'WO' ? `/work-orders/${a.order_ref}` : '/purchase-orders')}
                                className="text-body-sm font-data-mono text-primary hover:underline cursor-pointer">{a.order_ref}</button>
                              {a.milestone_id && <span className="text-on-surface-variant text-[12px]">(Phase: {a.milestone_id})</span>}
                            </div>
                          ) : isMapping ? (
                            <div className="flex flex-col gap-2">
                              <div className="flex items-center gap-2">
                                <select value={mapType} onChange={(e) => { setMapType(e.target.value as any); setMapRef(''); }} className="bk-input py-1.5 text-body-sm w-28">
                                  <option value="">Type...</option>
                                  {stkType === 'Worker' && <option value="WO">Work Order</option>}
                                  {stkType === 'Vendor' && <option value="PO">Purchase Order</option>}
                                </select>
                                {mapType === 'WO' && (
                                  <select value={mapRef} onChange={(e) => setMapRef(e.target.value)} className="bk-input py-1.5 text-body-sm flex-1">
                                    <option value="">Select phase...</option>
                                    {relMS?.map((m: any) => <option key={m.milestone_id} value={m.milestone_id}>{m.wo_id} - {m.name} (₹{m.planned_amount})</option>)}
                                  </select>
                                )}
                                {mapType === 'PO' && (
                                  <select value={mapRef} onChange={(e) => setMapRef(e.target.value)} className="bk-input py-1.5 text-body-sm flex-1">
                                    <option value="">Select PO...</option>
                                    {relPOs?.map((p: any) => <option key={p.po_id} value={p.po_id}>{p.po_id} (₹{p.order_value})</option>)}
                                  </select>
                                )}
                              </div>
                              <div className="flex items-center gap-2">
                                <button
                                  onClick={() => {
                                    if (!mapType || !mapRef) return;
                                    const ms = mapType === 'WO' ? milestones?.find((m) => m.milestone_id === mapRef) : null;
                                    updateAlloc.mutate({ allocId: a.allocation_id, order_type: mapType, order_ref: ms?.wo_id || mapRef, milestone_id: mapType === 'WO' ? mapRef : undefined });
                                  }}
                                  disabled={!mapType || !mapRef || updateAlloc.isPending}
                                  className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-[11px] font-bold bg-secondary text-on-primary hover:opacity-80 disabled:opacity-40"
                                >
                                  <span className="material-symbols-outlined text-[14px]">link</span> {updateAlloc.isPending ? 'Saving...' : 'Map'}
                                </button>
                                <button onClick={() => { setMappingId(null); setMapType(''); setMapRef(''); }} className="text-[11px] font-bold text-on-surface-variant hover:text-on-surface">Cancel</button>
                              </div>
                            </div>
                          ) : (
                            <div className="flex items-center gap-2">
                              <span className="text-body-sm text-tertiary italic flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">link_off</span> Unlinked</span>
                              <button onClick={() => setMappingId(a.allocation_id)} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/15">
                                <span className="material-symbols-outlined text-[14px]">link</span> Map Now
                              </button>
                            </div>
                          )}
                        </td>
                        <td className="p-4 text-right font-data-mono font-bold text-body-lg">₹{Number(a.allocated_amount).toLocaleString()}</td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot className="bg-surface-container-low border-t border-outline-variant/30">
                  <tr>
                    <td colSpan={2} className="p-4 text-right text-label-caps font-label-caps text-on-surface-variant">ALLOCATED TOTAL</td>
                    <td className="p-4 text-right font-data-mono font-bold text-headline-sm text-primary">
                      ₹{allocs?.reduce((s, a) => s + Number(a.allocated_amount), 0).toLocaleString()}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>
        </div>

        {/* ── Right Column: Document ──────────────────────────────── */}
        {txn.bill_doc_url && (
          <div className="w-full lg:w-[400px] xl:w-[500px] shrink-0 lg:sticky lg:top-8 animate-in fade-in slide-in-from-right-8 duration-500">
            <div className="bg-surface-container-lowest rounded-3xl border border-outline-variant/30 shadow-card-lg overflow-hidden flex flex-col h-auto lg:h-[calc(100vh-120px)] lg:max-h-[850px]">
              <div className="px-5 py-4 bg-surface-container-low border-b border-outline-variant/30 flex justify-between items-center shrink-0">
                <h3 className="text-label-caps font-label-caps text-on-surface-variant flex items-center gap-2">
                  <span className="material-symbols-outlined text-[18px]">attachment</span> PROOF DOCUMENT
                </h3>
                <div className="flex gap-2">
                  <a href={txn.bill_doc_url} target="_blank" rel="noopener noreferrer" className="p-2 hover:bg-surface-container rounded-lg text-on-surface-variant hover:text-primary transition-colors bg-surface-container-highest" title="Open in new tab">
                    <ExternalLink size={16} />
                  </a>
                  <a href={txn.bill_doc_url} download className="p-2 hover:bg-surface-container rounded-lg text-on-surface-variant hover:text-secondary transition-colors bg-surface-container-highest" title="Download">
                    <Download size={16} />
                  </a>
                </div>
              </div>
              <div className="flex-1 bg-surface-container-highest/20 relative flex items-center justify-center min-h-[300px]">
                {isImage ? (
                  <div className="w-full h-full flex items-center justify-center p-4">
                    <img src={txn.bill_doc_url} alt="Proof" className="max-w-full max-h-full object-contain rounded-xl shadow-sm border border-outline-variant/20 hover:scale-[1.02] transition-transform duration-300" />
                  </div>
                ) : isPDF ? (
                  <iframe src={`${txn.bill_doc_url}#toolbar=0`} className="w-full h-full min-h-[500px] lg:min-h-full border-0" title="Proof PDF" />
                ) : (
                  <div className="text-center p-8">
                    <span className="material-symbols-outlined text-[64px] text-on-surface-variant mb-4 block opacity-30">description</span>
                    <p className="text-body-sm text-on-surface-variant mb-6">Preview unavailable for this file type.</p>
                    <a href={txn.bill_doc_url} target="_blank" rel="noopener noreferrer" className="bk-btn inline-flex items-center gap-2">
                      <ExternalLink size={16} /> View Document
                    </a>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* ── VOID CONFIRM MODAL ────────────────────────────────────────── */}
      {voidConfirm && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setVoidConfirm(false); }}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-card-lg border border-outline-variant/30 w-full max-w-sm p-6">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-full bg-error-container flex items-center justify-center shrink-0">
                <span className="material-symbols-outlined text-[20px] text-error">block</span>
              </div>
              <h3 className="text-headline-sm font-headline-sm text-error">Void Transaction</h3>
            </div>
            <p className="text-body-sm text-on-surface-variant mb-5">
              Void <strong className="font-data-mono text-on-surface">{txn.txn_id}</strong> for{' '}
              <strong className="font-data-mono">₹{Number(effective.total_amount).toLocaleString()}</strong>?
              This transaction will be permanently marked as voided and excluded from reports.
            </p>
            {voidMutation.isError && (
              <p className="text-error text-body-sm mb-4 p-3 bg-error-container/30 rounded-lg">
                {(voidMutation.error as any)?.message || 'Failed to void transaction.'}
              </p>
            )}
            <div className="flex gap-3 justify-end">
              <button onClick={() => setVoidConfirm(false)} className="bk-btn px-5 py-2 text-body-sm">Go Back</button>
              <button
                onClick={() => voidMutation.mutate()}
                disabled={voidMutation.isPending}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-error text-on-error font-semibold text-body-sm hover:bg-error/90 disabled:opacity-50"
              >
                {voidMutation.isPending ? <Loader2 size={16} className="animate-spin" /> : <span className="material-symbols-outlined text-[16px]">block</span>}
                Void Transaction
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── AMEND MODAL ───────────────────────────────────────────────── */}
      {amendStep !== 'idle' && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) { setAmendStep('idle'); setAmendError(null); } }}>
          <div className="bg-surface-container-lowest rounded-2xl shadow-card-lg border border-outline-variant/30 w-full max-w-lg p-6 max-h-[90vh] overflow-y-auto">

            {/* ── Step 1: Edit form ── */}
            {amendStep === 'edit' && (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-blue-700">edit_note</span>
                  </div>
                  <div>
                    <h3 className="text-headline-sm font-headline-sm">Amend Transaction</h3>
                    <p className="text-body-sm text-on-surface-variant font-data-mono">{txn.txn_id}</p>
                  </div>
                </div>

                {/* Locked fields */}
                <div className="mb-5 p-4 bg-surface-container-low rounded-xl border border-outline-variant/20 space-y-3">
                  <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-3">Non-amendable fields</p>
                  {[
                    { label: 'TXN ID', value: txn.txn_id },
                    { label: 'Payee', value: `${txn.stakeholders?.name || 'Unknown'} · ${txn.stakeholders?.type || ''}` },
                  ].map((f) => (
                    <div key={f.label} className="flex items-center gap-2">
                      <span className="material-symbols-outlined text-[14px] text-on-surface-variant/60 shrink-0">lock</span>
                      <div>
                        <p className="text-[10px] font-bold text-on-surface-variant">{f.label}</p>
                        <p className="text-body-sm text-on-surface-variant">{f.value}</p>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Amendable fields */}
                <div className="space-y-4">
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Amount (₹)</label>
                    <div className="relative">
                      <span className="absolute left-4 top-1/2 -translate-y-1/2 font-data-mono font-bold text-on-surface">₹</span>
                      <input
                        type="number" min="0" step="0.01"
                        value={amendForm.total_amount}
                        onChange={(e) => setAmendForm((f) => ({ ...f, total_amount: e.target.value }))}
                        className="bk-input pl-8 font-data-mono font-bold"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Date</label>
                    <input type="date" value={amendForm.date} onChange={(e) => setAmendForm((f) => ({ ...f, date: e.target.value }))} className="bk-input" />
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Payment Mode</label>
                    <select value={amendForm.payment_mode} onChange={(e) => setAmendForm((f) => ({ ...f, payment_mode: e.target.value }))} className="bk-input">
                      {['NEFT', 'UPI', 'Cheque', 'Cash'].map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">Category</label>
                    <select value={amendForm.category} onChange={(e) => setAmendForm((f) => ({ ...f, category: e.target.value }))} className="bk-input">
                      {CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
                      {!CATEGORIES.includes(amendForm.category) && amendForm.category && (
                        <option value={amendForm.category}>{amendForm.category}</option>
                      )}
                    </select>
                  </div>
                  <div>
                    <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide block mb-1.5">
                      Remarks <span className="font-normal opacity-60">(optional)</span>
                    </label>
                    <textarea
                      value={amendForm.remarks}
                      onChange={(e) => setAmendForm((f) => ({ ...f, remarks: e.target.value }))}
                      rows={3}
                      className="bk-input resize-none w-full"
                      placeholder="Reason for amendment or corrected details…"
                    />
                  </div>
                </div>

                <div className="flex gap-3 justify-end mt-6">
                  <button onClick={() => { setAmendStep('idle'); setAmendError(null); }} className="bk-btn-ghost px-5 py-2 text-body-sm border border-outline-variant/30">Cancel</button>
                  <button
                    onClick={() => {
                      // Compute diff before showing
                      const LABELS: Record<string, keyof AmendmentSnapshot> = {
                        Amount: 'total_amount', Date: 'date', 'Payment Mode': 'payment_mode', Category: 'category', Remarks: 'remarks',
                      };
                      const hasDifference = Object.entries(LABELS).some(([, key]) =>
                        String((effective as any)[key] ?? '') !== String((amendForm as any)[key] ?? '')
                      );
                      if (!hasDifference) { setAmendError('No changes detected.'); return; }
                      setAmendError(null);
                      setAmendStep('diff');
                    }}
                    className="bk-btn flex items-center gap-2"
                  >
                    <span className="material-symbols-outlined text-[16px]">arrow_forward</span>
                    Review Changes
                  </button>
                </div>
                {amendError && <p className="mt-3 text-error text-body-sm">{amendError}</p>}
              </>
            )}

            {/* ── Step 2: Diff confirmation ── */}
            {amendStep === 'diff' && (
              <>
                <div className="flex items-center gap-3 mb-5">
                  <div className="w-10 h-10 rounded-full bg-blue-100 flex items-center justify-center shrink-0">
                    <span className="material-symbols-outlined text-[20px] text-blue-700">compare_arrows</span>
                  </div>
                  <h3 className="text-headline-sm font-headline-sm">Confirm Amendment</h3>
                </div>

                <p className="text-body-sm text-on-surface-variant mb-4">You are changing the following:</p>

                {!hasDiff ? (
                  <p className="text-on-surface-variant italic text-body-sm mb-4">No changes detected.</p>
                ) : (
                  <div className="space-y-2 mb-5">
                    {Object.entries(amendDiff).map(([label, [oldVal, newVal]]) => (
                      <div key={label} className="flex items-start gap-3 p-3 bg-surface-container-low rounded-xl">
                        <span className="material-symbols-outlined text-[16px] text-on-surface-variant mt-0.5 shrink-0">swap_horiz</span>
                        <div>
                          <p className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wide mb-0.5">{label}</p>
                          <p className="text-body-sm">
                            <span className="line-through text-on-surface-variant mr-2">{fmtAmendVal(label, oldVal)}</span>
                            <span className="text-blue-700 font-semibold">{fmtAmendVal(label, newVal)}</span>
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {amendError && (
                  <p className="text-error text-body-sm mb-4 p-3 bg-error-container/30 rounded-lg whitespace-pre-wrap">{amendError}</p>
                )}

                <div className="flex gap-3 justify-end">
                  <button onClick={() => { setAmendStep('edit'); setAmendError(null); }} className="bk-btn-ghost px-5 py-2 text-body-sm border border-outline-variant/30 flex items-center gap-1">
                    <span className="material-symbols-outlined text-[16px]">arrow_back</span> Go Back
                  </button>
                  <button
                    onClick={() => amendMutation.mutate()}
                    disabled={amendMutation.isPending || !hasDiff}
                    className="bk-btn flex items-center gap-2 disabled:opacity-50"
                  >
                    {amendMutation.isPending
                      ? <><Loader2 size={16} className="animate-spin" /> Saving…</>
                      : <><span className="material-symbols-outlined text-[16px]">check_circle</span> Confirm Amendment</>}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
