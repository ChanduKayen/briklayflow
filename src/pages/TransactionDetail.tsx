import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams, useLocation } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import Breadcrumb from '../components/Breadcrumb';
import { useUserProfile } from '../App';
import { ImageLightbox } from '../components/ImageLightbox';
import { WOPeek } from '../components/WOPeek';
import { POPeek } from '../components/POPeek';

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
      // ease-out quad
      const eased = 1 - (1 - progress) * (1 - progress);
      setValue(Math.round(eased * target));
      if (progress < 1) rafRef.current = requestAnimationFrame(animate);
    };
    rafRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);
  return value;
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

  // ─── Trail state ──────────────────────────────────────────────────────────────
  const [showTrail, setShowTrail] = useState(false);

  // ─── Lightbox state ────────────────────────────────────────────────────────────
  const [lightboxUrl, setLightboxUrl] = useState<string | null>(null);

  // ─── Peek state ────────────────────────────────────────────────────────────────
  const [peek, setPeek] = useState<{ type: 'WO' | 'PO'; id: string } | null>(null);

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
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['txn_allocations', txnId] });
      qc.invalidateQueries({ queryKey: ['transaction', txnId] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      qc.invalidateQueries({ queryKey: ['dashboard_metrics'] });
      // Invalidate WO or PO detail so the linked page reflects the new payment
      if (vars.order_type === 'PO' && vars.order_ref) {
        qc.invalidateQueries({ queryKey: ['po_linked_txns', vars.order_ref] });
        qc.invalidateQueries({ queryKey: ['po_detail', vars.order_ref] });
        qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
        qc.invalidateQueries({ queryKey: ['po_payment_totals'] });
      }
      if (vars.order_type === 'WO' && vars.order_ref) {
        qc.invalidateQueries({ queryKey: ['wo_allocations', vars.order_ref] });
      }
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

  const proofUrl = (txn as any).proof_document_url || txn.bill_doc_url || null;
  const isImage = proofUrl?.match(/\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i);

  // Needs-action: Worker/Vendor transactions with at least one unlinked allocation
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

  // Parse date/time for display
  const txnDate = effective.date ? new Date(effective.date) : null;
  const txnDateTime = txn.created_at ? new Date(txn.created_at) : null;
  const dateStr = txnDate
    ? txnDate.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '—';
  const timeStr = txnDateTime
    ? txnDateTime.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '';

  const isVoided = txn.status === 'Voided';

  // ─── Inner component for count-up (must be called at component level) ────────
  function AmountDisplay({ amount }: { amount: number }) {
    const displayed = useCountUp(amount);
    return <span className="count-up-amount">₹{displayed.toLocaleString('en-IN')}</span>;
  }

  const pageContent = (
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
      </div>

      {/* TOP STRIP */}
      <div className="detail-reveal mt-4" style={{ animationDelay: '40ms' }}>
        <p className="text-[12px] text-on-surface-variant">{dateStr}{timeStr ? ` · ${timeStr}` : ''}</p>
        <div className="mt-1">
          <p className="text-[14px] text-on-surface font-medium">{txn.stakeholders?.name || '—'}</p>
          <p className="text-[12px] text-on-surface-variant">{txn.stakeholders?.type}{txn.stakeholders?.category ? ` · ${txn.stakeholders.category}` : ''}</p>
        </div>
        {primaryAlloc && (
          <div className="mt-1">
            <p className="text-[14px] text-on-surface">{primaryAlloc.projects?.name || primaryAlloc.project_id}</p>
          </div>
        )}
        <div className="mt-1">
          <p className="text-[12px] text-on-surface-variant">{effective.payment_mode}{txn.ref_number ? ` · ${txn.ref_number}` : ''}</p>
        </div>
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          <p className="text-[18px] font-bold font-data-mono text-on-surface">
            <AmountDisplay amount={Number(effective.total_amount) || 0} />
          </p>
          {isAmended && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 text-blue-800">AMENDED</span>
          )}
          {txn.ai_flag_status === 'Flagged' && (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-error-container text-error">FLAGGED</span>
          )}
        </div>
        {needsActionType && (
          <div className="mt-2.5 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200/60 rounded-xl">
            <span className="material-symbols-outlined text-amber-500 text-[15px] shrink-0">link_off</span>
            <p className="text-[12px] text-amber-700 flex-1">
              {needsActionType === 'link_wo' ? 'Not linked to a Work Order' : 'Not linked to a Purchase Order'}
              {' · '}
              <button
                onClick={() => document.getElementById('alloc-table')?.scrollIntoView({ behavior: 'smooth' })}
                className="font-semibold underline"
              >
                Map below
              </button>
            </p>
          </div>
        )}
      </div>

      {/* ACTION ROW */}
      <div className="detail-reveal mt-3 flex items-center gap-2 flex-wrap" style={{ animationDelay: '80ms' }}>
        <span className={`flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold ${
          txn.status === 'Active'
            ? 'bg-secondary-container text-on-secondary-container'
            : txn.status === 'Voided'
              ? 'bg-error-container text-error'
              : 'bg-surface-container-high text-on-surface-variant'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${
            txn.status === 'Active' ? 'bg-secondary' : txn.status === 'Voided' ? 'bg-error' : 'bg-on-surface-variant/40'
          }`} />
          {txn.status?.toUpperCase()}
        </span>

        {txn.status !== 'Voided' && (
          <>
            {isManagement && (
              <button
                onClick={openAmendModal}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-outline-variant/40 text-[12px] font-semibold text-on-surface hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">edit_note</span>
                Amend
              </button>
            )}
            {canVoid && (
              <button
                onClick={() => setVoidConfirm(true)}
                className="flex items-center gap-1 px-3 py-1.5 rounded-lg border border-error/30 text-error text-[12px] font-semibold hover:bg-error-container/20 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">block</span>
                Void
              </button>
            )}
          </>
        )}

        <button
          onClick={() => setShowTrail((v) => !v)}
          className="ml-auto flex items-center gap-1 text-[12px] text-on-surface-variant hover:text-primary transition-colors"
        >
          View log
          <span className="material-symbols-outlined text-[14px]">chevron_right</span>
        </button>
      </div>

      {/* DIVIDER */}
      <hr className="border-outline-variant/15 my-5" />

      {/* ALLOCATED TO */}
      {allocs && allocs.length > 0 && (
        <div className="detail-reveal mb-6" style={{ animationDelay: '120ms' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">ALLOCATED TO</p>
          <div className="space-y-3">
            {(primaryAlloc ? [primaryAlloc, ...secondaryAllocs] : allocs).map((a) => {
              const isUnlinked = !a.order_type;
              const isMapping = mappingId === a.allocation_id;
              const stkType = txn.stakeholders?.type;
              const relMS = stkType === 'Worker' ? milestones?.filter((m) => m.work_orders?.stakeholder_id === txn.stakeholder_id && m.work_orders?.project_id === a.project_id) : [];
              const relPOs = stkType === 'Vendor' ? purchaseOrders?.filter((p) => p.stakeholder_id === txn.stakeholder_id && p.project_id === a.project_id) : [];
              const milestoneName = a.milestone_id
                ? (milestones?.find((m: any) => m.milestone_id === a.milestone_id)?.name ?? null)
                : null;
              return (
                <div key={a.allocation_id}>
                  <p className="text-[14px] text-on-surface font-medium">{a.projects?.name || a.project_id}</p>
                  <p className="text-[12px] text-on-surface-variant">
                    ₹{Number(a.allocated_amount).toLocaleString('en-IN')}
                    {a.order_type && a.order_ref ? (
                      <>
                        {' · '}
                        <button
                          onClick={() => setPeek({ type: a.order_type as 'WO' | 'PO', id: a.order_ref })}
                          className="text-primary hover:underline font-data-mono"
                        >
                          {a.order_ref} ↗
                        </button>
                        {milestoneName && (
                          <span className="ml-1 text-on-surface-variant">· {milestoneName}</span>
                        )}
                      </>
                    ) : (
                      <span className="ml-1 text-tertiary italic">Unlinked</span>
                    )}
                  </p>

                  {/* Inline Map UI */}
                  {isUnlinked && !isMapping && (
                    <button
                      onClick={() => setMappingId(a.allocation_id)}
                      className="mt-1 flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/15"
                    >
                      <span className="material-symbols-outlined text-[14px]">link</span> Map Now
                    </button>
                  )}
                  {isMapping && (
                    <div className="mt-2 flex flex-col gap-2">
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
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ANNOTATIONS */}
      {effective.remarks && (
        <div className="detail-reveal mb-6" style={{ animationDelay: '170ms' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">ANNOTATIONS</p>
          <p className="text-[14px] text-on-surface whitespace-pre-wrap">{effective.remarks}</p>
        </div>
      )}

      {/* PROOF DOCUMENT */}
      {proofUrl && (
        <div className="detail-reveal mb-6" style={{ animationDelay: '220ms' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">PROOF</p>
          {isImage ? (
            <div>
              <div
                className="relative inline-block cursor-pointer group"
                onClick={() => setLightboxUrl(proofUrl)}
              >
                <img
                  src={proofUrl}
                  alt="Payment proof"
                  className="h-28 w-auto rounded-xl object-cover border border-outline-variant/20 group-hover:opacity-90 transition-opacity"
                />
                <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity rounded-xl">
                  <span className="bg-black/50 text-white text-xs px-3 py-1 rounded-full">View</span>
                </div>
              </div>
              <p className="text-[11px] text-on-surface-variant mt-1.5">
                {(txn as any).proof_document_url ? '📱 From WhatsApp' : '📎 Uploaded document'}
              </p>
            </div>
          ) : (
            <a
              href={proofUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 text-[13px] text-primary font-semibold hover:underline"
            >
              <span className="material-symbols-outlined text-[14px]">open_in_new</span> View Document
            </a>
          )}
        </div>
      )}

      {/* AI FLAG */}
      {txn.ai_flag_status === 'Flagged' && txn.ai_flag_data && (
        <div className="detail-reveal mb-6" style={{ animationDelay: '270ms' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-error mb-2">FLAG REASON</p>
          <p className="text-[14px] text-error/80 font-medium">{txn.ai_flag_data.reason || 'Transaction flagged for manual review.'}</p>
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

      {/* PROJECT ALLOCATIONS TABLE */}
      <div id="alloc-table" className="detail-reveal mb-6" style={{ animationDelay: '320ms' }}>
        <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-3">PROJECT ALLOCATIONS</p>
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="border-b border-outline-variant/20">
              <tr>
                <th className="pb-2 text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-wide">PROJECT</th>
                <th className="pb-2 text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-wide">LINKED ORDER</th>
                <th className="pb-2 text-[10px] font-bold text-on-surface-variant/70 uppercase tracking-wide text-right">AMOUNT</th>
              </tr>
            </thead>
            <tbody>
              {allocs?.map((a) => {
                const isUnlinked = !a.order_type;
                const isMapping = mappingId === a.allocation_id;
                const stkType = txn.stakeholders?.type;
                const relMS = stkType === 'Worker' ? milestones?.filter((m) => m.work_orders?.stakeholder_id === txn.stakeholder_id && m.work_orders?.project_id === a.project_id) : [];
                const relPOs = stkType === 'Vendor' ? purchaseOrders?.filter((p) => p.stakeholder_id === txn.stakeholder_id && p.project_id === a.project_id) : [];
                const milestoneName = a.milestone_id
                  ? (milestones?.find((m: any) => m.milestone_id === a.milestone_id)?.name ?? null)
                  : null;
                return (
                  <tr key={a.allocation_id} className={`border-b border-outline-variant/10 transition-colors ${isUnlinked ? 'bg-tertiary-container/5' : 'hover:bg-surface-container-lowest'}`}>
                    <td className="py-3 pr-4">
                      <p className="font-semibold text-[13px] text-on-surface">{a.projects?.name || 'Unassigned'}</p>
                      <p className="text-[10px] text-on-surface-variant font-data-mono">{a.project_id}</p>
                    </td>
                    <td className="py-3 pr-4">
                      {a.order_type ? (
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-surface-container-high text-on-surface shrink-0">{a.order_type}</span>
                          <button onClick={() => setPeek({ type: a.order_type as 'WO' | 'PO', id: a.order_ref })}
                            className="text-[12px] font-data-mono text-primary hover:underline cursor-pointer">{a.order_ref} ↗</button>
                          {milestoneName && <span className="text-on-surface-variant text-[11px]">· {milestoneName}</span>}
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
                          <span className="text-[12px] text-tertiary italic flex items-center gap-1"><span className="material-symbols-outlined text-[14px]">link_off</span> Unlinked</span>
                          <button onClick={() => setMappingId(a.allocation_id)} className="flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-bold text-primary bg-primary/10 hover:bg-primary/15">
                            <span className="material-symbols-outlined text-[14px]">link</span> Map Now
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 text-right font-data-mono font-bold text-[13px]">₹{Number(a.allocated_amount).toLocaleString()}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-outline-variant/30">
              <tr>
                <td colSpan={2} className="pt-3 text-right text-[10px] font-bold uppercase text-on-surface-variant">ALLOCATED TOTAL</td>
                <td className="pt-3 text-right font-data-mono font-bold text-[14px] text-primary">
                  ₹{allocs?.reduce((s, a) => s + Number(a.allocated_amount), 0).toLocaleString()}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* AMENDMENT HISTORY */}
      {isAmended && (
        <div className="detail-reveal mb-6" style={{ animationDelay: '370ms' }}>
          <button
            onClick={() => setShowAmendHistory((v) => !v)}
            className="flex items-center gap-1.5 text-[13px] text-blue-700 font-semibold hover:underline"
          >
            <span className="material-symbols-outlined text-[16px]">edit_note</span>
            {existingAmendments.length} amendment{existingAmendments.length > 1 ? 's' : ''} · View history
            <span className="material-symbols-outlined text-[14px] text-on-surface-variant">
              {showAmendHistory ? 'expand_less' : 'chevron_right'}
            </span>
          </button>

          {showAmendHistory && (
            <div className="mt-3 border-t border-blue-100 divide-y divide-outline-variant/10">
              {[...existingAmendments].reverse().map((a: any, i) => {
                if (a.type === 'phase_move' || a.type === 'phase_move_undo') {
                  const isUndo = a.type === 'phase_move_undo';
                  return (
                    <div key={a.id} className="py-3">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="material-symbols-outlined text-[14px] text-on-surface-variant">swap_horiz</span>
                        <p className="text-[12px] font-semibold text-on-surface">
                          Phase {isUndo ? 'reassignment undone' : 'reassigned'} · {a.moved_by}
                        </p>
                        <span className="text-[11px] text-on-surface-variant">
                          · {new Date(a.moved_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {i === 0 && <span className="ml-auto px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-100 text-blue-700">LATEST</span>}
                      </div>
                      <p className="text-[12px] text-on-surface-variant pl-5">
                        <span className="line-through opacity-60">{a.from_milestone_name}</span>
                        {' → '}
                        <span className="font-medium text-on-surface">{a.to_milestone_name}</span>
                        {a.allocated_amount && (
                          <span className="ml-2 font-data-mono text-on-surface-variant/70">₹{Number(a.allocated_amount).toLocaleString('en-IN')}</span>
                        )}
                      </p>
                    </div>
                  );
                }

                return (
                  <div key={a.id} className="py-3">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-[12px] font-semibold text-on-surface">Amended by {a.amended_by}</p>
                      <span className="text-[11px] text-on-surface-variant">
                        · {new Date(a.amended_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {i === 0 && (
                        <span className="ml-auto px-1.5 py-0.5 text-[9px] font-bold rounded bg-blue-100 text-blue-700">LATEST</span>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {Object.entries(a.changes || {}).map(([label, vals]) => {
                        const [oldVal, newVal] = vals as [any, any];
                        return (
                          <p key={label} className="text-[12px] text-on-surface-variant">
                            <span className="font-semibold text-on-surface">{label}:</span>{' '}
                            <span className="line-through opacity-60">{fmtAmendVal(label, oldVal)}</span>
                            {' → '}
                            <span className="text-blue-700 font-medium">{fmtAmendVal(label, newVal)}</span>
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
      )}

      {/* TRAIL */}
      {showTrail && (
        <div className="detail-reveal mb-6" style={{ animationDelay: '0ms' }}>
          <p className="text-[11px] font-bold uppercase tracking-wider text-on-surface-variant mb-2">STATUS LOG</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-3">
              <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant/40 shrink-0" />
              <span className="text-[12px] text-on-surface-variant">{new Date(txn.created_at).toLocaleString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</span>
              <span className="text-[12px] text-on-surface">Transaction recorded</span>
            </div>
            {isVoided && (
              <div className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-error shrink-0" />
                <span className="text-[12px] text-on-surface-variant">{txn.voided_at ? new Date(txn.voided_at).toLocaleString('en-IN') : '—'}</span>
                <span className="text-[12px] text-error font-semibold">Voided</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-12 relative">
      {isVoided ? (
        <div className="opacity-60">
          {pageContent}
        </div>
      ) : pageContent}

      {/* VOID STAMP */}
      {isVoided && (
        <div
          className="pointer-events-none absolute top-24 right-8 text-red-500 font-bold text-[24px] border-2 border-red-500 px-3 py-1 rounded"
          style={{ transform: 'rotate(-15deg)', zIndex: 10 }}
        >
          VOID
        </div>
      )}

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

      {/* ── IMAGE LIGHTBOX ───────────────────────────────────────────── */}
      <ImageLightbox url={lightboxUrl} title="Payment Proof" onClose={() => setLightboxUrl(null)} />

      {/* ── WO / PO PEEK ─────────────────────────────────────────────── */}
      {peek?.type === 'WO' && <WOPeek woId={peek.id} onClose={() => setPeek(null)} session={session} />}
      {peek?.type === 'PO' && <POPeek poId={peek.id} onClose={() => setPeek(null)} />}

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
