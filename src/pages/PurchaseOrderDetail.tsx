import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Breadcrumb from '../components/Breadcrumb';
import { BackLink } from '../components/BackLink';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import confetti from 'canvas-confetti';
import { supabase } from '../lib/supabase';
import { openDoc, resolveDocUrl } from '../lib/storage';
import { poGateState } from '../lib/poLifecycle';
import { useSnackbar } from '../components/Snackbar';
import { PageSkeleton } from '../components/SkeletonLoader';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { usePeek } from '../context/PeekContext';
import type { POLineItem, POApproval } from '../types';
import ReceiveAtSiteDrawer from '../components/ReceiveAtSiteDrawer';
import StakeholderLedgerDrawer from '../components/StakeholderLedgerDrawer';
import { downloadGRNChallan } from '../lib/grnChallan';
import {
  fmtDate as pdfFmtDate, fmtRupee, amountInWords,
  MARGIN, CONTENT, RIGHT, C,
  setColor, drawRule, sectionLabel, valueText, drawHeader, drawFooter, drawSignatures,
} from '../lib/pdfHelpers';
import { formatTxn } from '../lib/formatTxn';
import { parseAmount } from '../lib/money';

// ── Status helpers ────────────────────────────────────────────────────────────

const STATUS_BADGE: Record<string, string> = {
  'ORDERED':   'bg-[#EFF6FF] text-[#3B82F6]',
  'BILLED':    'bg-[#FFFBEB] text-[#D97706]',
  'PARTIAL':   'bg-[#FFF7ED] text-[#EA580C]',
  'PAID':      'bg-[#F0FDF4] text-[#16A34A]',
  'CANCELLED': 'bg-[#F9FAFB] text-[#6B7280]',
};

const STATUS_DOT: Record<string, string> = {
  'ORDERED':   'bg-[#3B82F6]',
  'BILLED':    'bg-[#D97706]',
  'PARTIAL':   'bg-[#EA580C]',
  'PAID':      'bg-[#16A34A]',
  'CANCELLED': 'bg-[#6B7280]',
};

const STATUS_LABEL: Record<string, string> = {
  'ORDERED':   'Ordered',
  'BILLED':    'Billed',
  'PARTIAL':   'Partially Paid',
  'PAID':      'Paid',
  'CANCELLED': 'Cancelled',
};

function isOverdue(po: any): boolean {
  if (!po.expected_delivery) return false;
  const d = new Date(po.expected_delivery);
  if (isNaN(d.getTime())) return false;
  if (['BILLED', 'PARTIAL', 'PAID', 'CANCELLED'].includes(po.status)) return false;
  return d < new Date();
}

// ── Reconciliation types ──────────────────────────────────────────────────────

interface ReconLineMatch {
  po_line:      string;
  bill_line:    string | null;
  matched:      boolean;
  flags:        string[];
  flag_details: string;
  po_qty:       number;
  bill_qty:     number | null;
  po_rate:      number;
  bill_rate:    number | null;
  po_amount:    number;
  bill_amount:  number | null;
}

interface ReconGhostItem {
  item:   string;
  amount: number;
}

interface ReconResult {
  summary:               string;
  risk_level:            'LOW' | 'MEDIUM' | 'HIGH';
  bill_total_extracted:  number | null;
  line_matches:          ReconLineMatch[];
  ghost_items:           ReconGhostItem[];
  overall_flags:         string[];
}

const FLAG_LABEL: Record<string, string> = {
  BRAND_STRIPPED:          'Brand Stripped',
  GRADE_DOWNGRADE:         'Grade Downgrade',
  QTY_INFLATION:           'Qty Inflation',
  RATE_INCREASE:           'Rate Increase',
  UNIT_MISMATCH:           'Unit Mismatch',
  GHOST_ITEM:              'Ghost Item',
  DUPLICATE_ITEM:          'Duplicate Item',
  AMOUNT_ARITHMETIC_ERROR: 'Arithmetic Error',
  HSN_MISMATCH:            'HSN Mismatch',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}


// ── Count-up hook ─────────────────────────────────────────────────────────────

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

function fireCelebration() {
  confetti({ particleCount: 60, spread: 50, origin: { y: 0.6 }, colors: ['#C8603A', '#16A34A', '#D97706', '#ffffff'] });
}

// ── BillEntryForm ─────────────────────────────────────────────────────────────

interface BillEntryFormProps {
  poId: string;
  currentUserName: string;
  onBillSaved: (data: { billAmount: number; billNo: string; billUrl: string | null }) => void;
}

function BillEntryForm({ poId, currentUserName, onBillSaved }: BillEntryFormProps) {
  const [billNo, setBillNo]         = useState('');
  const [billAmount, setBillAmount] = useState('');
  const [billDate, setBillDate]     = useState(new Date().toISOString().split('T')[0]);
  const [billFile, setBillFile]     = useState<File | null>(null);
  const [uploading, setUploading]   = useState(false);
  const [saving, setSaving]         = useState(false);
  const qc = useQueryClient();

  const bill    = parseAmount(billAmount);
  const canSave = bill > 0;

  const handleSave = async () => {
    if (!canSave) return;
    setSaving(true);
    let billUrl: string | null = null;
    if (billFile) {
      setUploading(true);
      const ext = billFile.type === 'application/pdf' ? 'pdf' : 'jpg';
      const { error: upErr } = await supabase.storage
        .from('documents')
        .upload(`po-bills/bill_${poId}_${Date.now()}.${ext}`, billFile, { contentType: billFile.type });
      if (!upErr) {
        const { data: pub } = supabase.storage.from('documents').getPublicUrl(`po-bills/bill_${poId}_${Date.now()}.${ext}`);
        billUrl = pub.publicUrl;
      }
      setUploading(false);
    }
    const { error } = await supabase.from('purchase_orders').update({
      vendor_bill_number:    billNo.trim() || null,
      vendor_bill_no:        billNo.trim() || null,
      vendor_bill_amount:    bill,
      vendor_bill_date:      billDate,
      vendor_bill_url:       billUrl,
      vendor_bill_doc_url:   billUrl,
      bill_recorded_at:      new Date().toISOString(),
      bill_recorded_by_name: currentUserName,
      status:                'BILLED',
    }).eq('po_id', poId);
    setSaving(false);
    if (!error) {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      onBillSaved({ billAmount: bill, billNo: billNo.trim(), billUrl });
    }
  };

  return (
    <div className="mt-4 space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1 block">Bill / Invoice No</label>
          <input type="text" placeholder="e.g. INV-2023-0445" value={billNo} onChange={e => setBillNo(e.target.value)}
            className="w-full text-[13px] px-3 py-2 border border-amber-300 rounded-lg bg-white focus:outline-none focus:border-amber-500" />
        </div>
        <div>
          <label className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1 block">Bill Date</label>
          <input type="date" value={billDate} onChange={e => setBillDate(e.target.value)}
            className="w-full text-[13px] px-3 py-2 border border-amber-300 rounded-lg bg-white focus:outline-none focus:border-amber-500" />
        </div>
      </div>
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1 block">
          Bill Amount *
        </label>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[14px] font-medium text-amber-700">₹</span>
          <input type="number" placeholder="0" value={billAmount} onChange={e => setBillAmount(e.target.value)} autoFocus
            className="w-full text-[16px] font-semibold pl-7 pr-4 py-3 border-2 border-amber-400 rounded-lg bg-white focus:outline-none focus:border-amber-600 focus:ring-2 focus:ring-amber-200" />
        </div>
      </div>
      <div>
        <label className="text-[11px] font-bold uppercase tracking-wide text-amber-700 mb-1 block">
          Bill Document <span className="text-[10px] font-normal normal-case">(PDF or image)</span>
        </label>
        {billFile ? (
          <div className="flex items-center gap-2 p-3 border border-amber-300 rounded-lg bg-white">
            <span className="material-symbols-outlined text-[16px] text-amber-500">attach_file</span>
            <p className="text-[13px] flex-1 truncate">{billFile.name}</p>
            <button onClick={() => setBillFile(null)} className="text-[11px] text-on-surface-variant hover:text-red-500">Remove</button>
          </div>
        ) : (
          <label className="flex items-center gap-2 p-3 border border-dashed border-amber-300 rounded-lg bg-white cursor-pointer hover:border-amber-500 transition-colors">
            <span className="material-symbols-outlined text-[16px] text-amber-500">upload_file</span>
            <span className="text-[13px] text-amber-700">Upload vendor bill</span>
            <input type="file" accept="image/jpeg,image/png,image/jpg,application/pdf"
              onChange={e => setBillFile(e.target.files?.[0] || null)} className="hidden" />
          </label>
        )}
      </div>
      <button onClick={handleSave} disabled={!canSave || saving}
        className={`w-full h-11 rounded-lg text-[14px] font-semibold transition-all ${canSave && !saving
          ? 'bg-amber-500 text-white hover:bg-amber-600 shadow-md shadow-amber-200'
          : 'bg-gray-100 text-gray-400 cursor-not-allowed'}`}>
        {saving ? (uploading ? 'Uploading…' : 'Saving…')
          : `Record Bill${billAmount ? ` — ₹${parseFloat(billAmount).toLocaleString('en-IN')}` : ''}`}
      </button>
    </div>
  );
}

// ── BillSummaryCard ───────────────────────────────────────────────────────────

function BillSummaryCard({ po, activeTxns, onNavigate }: { po: any; activeTxns: any[]; onNavigate: (p: string) => void }) {
  const totalPaid = activeTxns.reduce((s: number, t: any) => s + (Number(t.allocated_amount) || 0), 0);
  const billAmt   = Number(po.vendor_bill_amount) || 0;
  const balance   = billAmt - totalPaid;
  const billNo    = po.vendor_bill_number || po.vendor_bill_no || null;
  const billUrl   = po.vendor_bill_url || po.vendor_bill_doc_url || null;

  return (
    <div className="rounded-xl border border-outline-variant/20 bg-white p-4">
      <div className="flex items-center justify-between mb-4">
        <div>
          <p className="text-[10px] uppercase tracking-wide text-on-surface-variant/60 mb-0.5">Vendor Bill</p>
          <p className="text-[14px] font-medium text-on-surface">{billNo || 'No bill number'}</p>
          {po.vendor_bill_date && <p className="text-[11px] text-on-surface-variant/50">{fmtDate(po.vendor_bill_date)}</p>}
        </div>
        {billUrl && (
          <button type="button" onClick={() => openDoc(billUrl)}
            className="text-[12px] text-[#C8603A] hover:underline flex items-center gap-1">
            View bill <span className="material-symbols-outlined text-[13px]">open_in_new</span>
          </button>
        )}
      </div>
      <div className="space-y-2">
        <div className="flex justify-between text-[12px]">
          <span className="text-on-surface-variant/60">Bill Amount</span>
          <span className="font-data-mono font-medium text-[#16A34A]">₹{billAmt.toLocaleString('en-IN')}</span>
        </div>
        <div className="h-px bg-outline-variant/15 my-1" />
        <div className="flex justify-between text-[12px]">
          <span className="text-on-surface-variant/60">Total Paid</span>
          <span className="font-data-mono">₹{totalPaid.toLocaleString('en-IN')}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-[13px] font-semibold text-on-surface">
            {balance > 0 ? 'Balance Due' : balance < 0 ? 'Overpaid' : 'Settled'}
          </span>
          <span className={`text-[14px] font-bold font-data-mono ${balance > 0 ? 'text-[#DC2626]' : balance < 0 ? 'text-amber-600' : 'text-[#16A34A]'}`}>
            {balance === 0 ? '₹0 ✓' : `₹${Math.abs(balance).toLocaleString('en-IN')}`}
          </span>
        </div>
      </div>
      {activeTxns.length > 0 && (
        <div className="mt-4 pt-3 border-t border-outline-variant/10">
          <p className="text-[10px] uppercase tracking-wide text-on-surface-variant/60 mb-2">Payments</p>
          {activeTxns.map((t: any) => {
            const f = formatTxn({ ...t.transactions, total_amount: t.allocated_amount }, 'po');
            return (
              <div key={t.id} onClick={() => onNavigate(`/ledger/${t.transactions?.txn_id}`)}
                className="flex justify-between py-1.5 cursor-pointer hover:bg-surface-container-low/30 rounded px-1 group">
                <div className="min-w-0 flex-1 pr-2">
                  <p className="text-[11px] font-[500] text-on-surface flex items-center gap-1.5 truncate">
                    {f.primary}
                    {t.transactions?.category === 'PO Advance' && (
                      <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200/50 inline-flex items-center shrink-0">
                        Advance
                      </span>
                    )}
                  </p>
                  {f.secondary && <p className="text-[10px] text-on-surface-variant/60 truncate">{f.secondary}</p>}
                  <p className="text-[9px] font-mono text-on-surface-variant/25 opacity-0 group-hover:opacity-100 transition-opacity">{t.transactions?.txn_id}</p>
                </div>
                <p className="text-[12px] font-medium font-data-mono shrink-0">₹{Number(t.allocated_amount).toLocaleString('en-IN')}</p>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── SectionLabel ──────────────────────────────────────────────────────────────

function SectionLabel({ icon, label }: { icon: string; label: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="material-symbols-outlined text-[15px] text-on-surface-variant/40">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-on-surface-variant/50">{label}</span>
      <div className="flex-1 h-px bg-outline-variant/15" />
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseOrderDetail({ session }: { session: Session }) {
  const { poId }   = useParams<{ poId: string }>();
  const navigate   = useNavigate();
  const location   = useLocation();
  const navState   = (location.state as { from?: string; projectId?: string; projectName?: string }) || {};
  const qc         = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const { openPeek } = usePeek();
  const { data: profile } = useUserProfile(session.user.id);
  const orgId = useOrgId();

  const canManage =
    profile?.role === 'management' ||
    profile?.role === 'principal' ||
    profile?.role === 'accountant';
  // Only management / principal approve POs.
  const isApprover = profile?.role === 'management' || profile?.role === 'principal';
  const [noteAction, setNoteAction] = useState<'SEND_BACK' | 'REJECT' | null>(null);
  const [approvalRemark, setApprovalRemark] = useState('');

  const currentUserName: string = (profile as any)?.display_name || (profile as any)?.name || session.user.email || 'Unknown';

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showLog,              setShowLog]             = useState(false);
  const [showReceiveDrawer,    setShowReceiveDrawer]   = useState(false);
  const [showSettleModal,      setShowSettleModal]     = useState(false);
  const [showRecordPayment,    setShowRecordPayment]   = useState(false);
  const [showReceiveModal,     setShowReceiveModal]    = useState(false);
  const [billCelebration,      setBillCelebration]     = useState<{ billAmount: number; billNo: string; vendorName: string } | null>(null);
  const [showStakeholderDrawer, setShowStakeholderDrawer] = useState(false);

  // AI reconciliation state
  const [reconFile, setReconFile]     = useState<File | null>(null);
  const [reconciling, setReconciling] = useState(false);
  const [reconResult, setReconResult] = useState<ReconResult | null>(null);
  const [reconError, setReconError]   = useState<string | null>(null);

  // Record payment fields (Feature 3)
  const [payAmount,   setPayAmount]   = useState('');
  const [payMode,     setPayMode]     = useState<'NEFT' | 'UPI' | 'Cheque' | 'Cash'>('NEFT');
  const [payRef,      setPayRef]      = useState('');


  // Settle modal fields
  const [settleAmount,     setSettleAmount]     = useState('');
  const [settlePayMode,    setSettlePayMode]    = useState<'NEFT' | 'UPI' | 'Cheque' | 'Cash'>('NEFT');
  const [settleRef,        setSettleRef]        = useState('');

  // ── Queries ────────────────────────────────────────────────────────────────

  const { data: po, isLoading } = useQuery({
    queryKey: ['po_detail', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, projects(name, site_location), stakeholders(name, category, gstin, is_approved)')
        .eq('po_id', poId!)
        .single();
      if (error) throw error;
      return data as any;
    },
    enabled: !!poId,
  });

  const { data: lineItems } = useQuery({
    queryKey: ['po_line_items', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('po_line_items')
        .select('*')
        .eq('po_id', poId!)
        .order('line_number');
      if (error) throw error;
      return data as POLineItem[];
    },
    enabled: !!poId,
  });

  const { data: grns } = useQuery({
    queryKey: ['po_grn', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('po_grn')
        .select('grn_id, receipt_date, dc_number, vehicle_number, driver_name, remarks, received_by, created_at')
        .eq('po_id', poId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as any[];
    },
    enabled: !!poId,
  });

  const { data: grnItems } = useQuery({
    queryKey: ['po_grn_items', poId],
    queryFn: async () => {
      const grnIds = (grns ?? []).map((g: any) => g.grn_id);
      if (!grnIds.length) return [];
      const { data, error } = await supabase
        .from('po_grn_items')
        .select('grn_id, po_line_item_id, item_name, unit, qty_ordered, qty_received, unit_rate, condition, remarks')
        .in('grn_id', grnIds);
      if (error) throw error;
      return data as any[];
    },
    enabled: (grns?.length ?? 0) > 0,
  });

  const { data: approvals } = useQuery({
    queryKey: ['po_approvals', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('po_approvals')
        .select('*')
        .eq('po_id', poId!)
        .order('actioned_at', { ascending: false });
      if (error) throw error;
      return data as POApproval[];
    },
    enabled: !!poId,
  });

  // Feature 3 — linked transactions
  const { data: linkedTxns } = useQuery({
    queryKey: ['po_linked_txns', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('*, transactions(txn_id, date, total_amount, payment_mode, category, remarks, status)')
        .eq('order_ref', poId!)
        .eq('order_type', 'PO');
      if (error) throw error;
      return data as any[];
    },
    enabled: !!poId,
  });

  // ── Mutations ──────────────────────────────────────────────────────────────

  const updateStatus = useMutation({
    mutationFn: async (status: string) => {
      const { error } = await supabase.from('purchase_orders').update({ status }).eq('po_id', poId!);
      if (error) throw error;
    },
    onSuccess: (_, status) => {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      showSnackbar(`PO status updated to ${status}`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to update status', { type: 'error' }),
  });

  // ── Approval (draft → live), management/principal only ──────────────────────
  const inrShort = (n: number) => '₹' + Math.round(Number(n) || 0).toLocaleString('en-IN');
  const approve = useMutation({
    mutationFn: async ({ action, remarks }: { action: 'APPROVE' | 'SEND_BACK' | 'REJECT'; remarks?: string }) => {
      const { data, error } = await supabase.rpc('decide_purchase_order', {
        p_po_id: poId!, p_action: action, p_remarks: remarks ?? null,
      });
      if (error) throw error;
      const res = data as { success: boolean; error?: string; amount?: number; limit?: number; escalate_to?: string | null };
      if (!res?.success) {
        if (res?.error === 'above_limit') {
          throw new Error(`This ${inrShort(res.amount ?? 0)} order is above your approval limit${res.limit != null ? ` of ${inrShort(res.limit)}` : ''}${res.escalate_to ? ' — it goes to your approver to sign off.' : ' — a higher approver must sign off.'}`);
        }
        throw new Error(res?.error || 'Approval failed');
      }
      return res;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      qc.invalidateQueries({ queryKey: ['nav_po_draft'] });
      qc.invalidateQueries({ queryKey: ['nav_po_total'] });
      showSnackbar(vars.action === 'APPROVE' ? '✓ Purchase order approved' : vars.action === 'REJECT' ? 'Rejected' : 'Sent back to the creator');
    },
    onError: (err: any) => showSnackbar(err.message || 'Could not complete approval', { type: 'error' }),
  });


  const markReceived = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from('purchase_orders').update({
        received_at_site:    new Date().toISOString(),
        received_by_name:    currentUserName,
        received_by_user_id: session.user.id,
      }).eq('po_id', poId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setShowReceiveModal(false);
      fireCelebration();
      showSnackbar(`📦 Receipt confirmed! Now attach the vendor bill to proceed.`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to record receipt', { type: 'error' }),
  });

  const settlePO = useMutation({
    mutationFn: async () => {
      const amount = parseAmount(settleAmount) || Number(po?.total_value || po?.order_value) || 0;
      if (!amount) throw new Error('Amount is required');

      const txnId = `TXN-${Date.now()}`;
      const { error: rpcError } = await supabase.rpc('insert_transaction_with_allocations', {
        p_txn: {
          txn_id:         txnId,
          org_id:         orgId,
          stakeholder_id: po!.stakeholder_id,
          date:           new Date().toISOString().split('T')[0],
          total_amount:   amount,
          payment_mode:   settlePayMode,
          category:       'Purchase Payment',
          remarks:        `Settlement for PO ${poId}${settleRef ? ` · Ref: ${settleRef}` : ''}`,
          ai_flag_status: 'Clean',
          ai_flag_data:   {},
        },
        p_allocations: [{
          project_id:       po!.project_id,
          order_type:       'PO',
          order_ref:        poId!,
          allocated_amount: amount,
        }],
      });
      if (rpcError) throw rpcError;

      // Mark PO as fully paid
      await supabase.from('purchase_orders').update({ status: 'PAID' }).eq('po_id', poId!);

      return txnId;
    },
    onSuccess: (txnId) => {
      qc.invalidateQueries({ queryKey: ['po_linked_txns', poId] });
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setShowSettleModal(false);
      showSnackbar('PO settled — transaction created');
      navigate(`/ledger/${txnId}`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to settle PO', { type: 'error' }),
  });

  // Feature 3 — record payment against PO
  const recordPayment = useMutation({
    mutationFn: async () => {
      const amount = parseAmount(payAmount);
      if (!amount) throw new Error('Amount is required');
      const txnId = `TXN-${Date.now()}`;
      const hasBill = po?.vendor_bill_amount && Number(po.vendor_bill_amount) > 0;
      const category = hasBill ? 'Purchase Payment' : 'PO Advance';
      const rawRemarks = `Payment for PO ${poId}${payRef ? ` · Ref: ${payRef}` : ''}`;
      const remarks = hasBill ? rawRemarks : `[PO Advance] ${rawRemarks}`;

      const { error: rpcErr } = await supabase.rpc('insert_transaction_with_allocations', {
        p_txn: {
          txn_id:         txnId,
          org_id:         orgId,
          stakeholder_id: po!.stakeholder_id,
          date:           new Date().toISOString().split('T')[0],
          total_amount:   amount,
          payment_mode:   payMode,
          category,
          remarks,
          ai_flag_status: 'Clean',
          ai_flag_data:   {},
        },
        p_allocations: [{
          project_id:       po!.project_id,
          order_type:       'PO',
          order_ref:        poId!,
          allocated_amount: amount,
        }],
      });
      if (rpcErr) throw rpcErr;

      // Auto-advance PO status: compute total paid after this payment
      const prevPaid = (linkedTxns ?? [])
        .filter((t: any) => t.transactions?.status !== 'Voided')
        .reduce((s: number, t: any) => s + (Number(t.allocated_amount) || 0), 0);
      const newTotalPaid = prevPaid + amount;
      const billOrPoValue = Number(po?.vendor_bill_amount) || Number(po?.total_value || po?.order_value) || 0;
      const newStatus = newTotalPaid >= billOrPoValue ? 'PAID' : 'PARTIAL';
      await supabase.from('purchase_orders').update({ status: newStatus }).eq('po_id', poId!);
      return { txnId, newStatus };
    },
    onSuccess: ({ newStatus }) => {
      qc.invalidateQueries({ queryKey: ['po_linked_txns', poId] });
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['po_payment_totals'] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setShowRecordPayment(false);
      setPayAmount('');
      setPayRef('');
      if (newStatus === 'PAID') {
        fireCelebration();
        showSnackbar('🎉 Fully paid and settled!');
      } else {
        showSnackbar('Payment recorded');
      }
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to record payment', { type: 'error' }),
  });

  // ── AI Reconciliation ─────────────────────────────────────────────────────

  function fileToBase64Str(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve((reader.result as string).split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  async function runReconciliation(file: File | null) {
    if (!lineItems?.length) return;
    setReconciling(true);
    setReconError(null);
    try {
      const body: Record<string, any> = {
        po_id:         poId,
        po_line_items: lineItems.map(li => ({
          item_name:       li.item_name,
          specification:   li.specification,
          quantity_ordered: li.quantity_ordered,
          unit:            li.unit,
          unit_rate:       li.unit_rate,
          total_amount:    li.total_amount,
          gst_rate:        li.gst_rate,
        })),
        bill_total: totalValue,
      };

      if (file) {
        body.bill_base64   = await fileToBase64Str(file);
        body.bill_mime_type = file.type || 'image/jpeg';
      } else if (po?.vendor_bill_doc_url) {
        // documents bucket is private — send a short-lived signed URL the
        // reconcile function can fetch (it does a plain fetch(bill_url)).
        body.bill_url = await resolveDocUrl(po.vendor_bill_doc_url);
        if (!body.bill_url) throw new Error('Could not access the attached bill document');
      } else {
        throw new Error('No bill document available — upload the vendor bill image first');
      }

      const { data, error } = await supabase.functions.invoke('reconcile-po-bill', { body });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || 'Reconciliation failed');
      setReconResult(data as ReconResult);
    } catch (err: any) {
      setReconError(err.message || 'Reconciliation failed');
    } finally {
      setReconciling(false);
    }
  }

  // ── PDF Download ───────────────────────────────────────────────────────────

  const handleDownloadPDF = () => {
    if (!po) return;
    const doc = new jsPDF('p', 'mm', 'a4');

    // ── Header ────────────────────────────────────────────────────────────────
    let y = drawHeader(
      doc,
      'PURCHASE ORDER',
      `${po.po_id}  ·  ${pdfFmtDate(po.date_issued)}`,
    );

    // ── Vendor + Project block ────────────────────────────────────────────────
    const rx = MARGIN + CONTENT / 2;

    sectionLabel(doc, 'VENDOR', MARGIN, y);
    sectionLabel(doc, 'PROJECT', rx, y);
    y += 4;

    valueText(doc, vendor?.name ?? '—', MARGIN, y, { bold: true, size: 10 });
    valueText(doc, project?.name ?? '—', rx, y, { bold: true, size: 10 });
    y += 5;

    if (vendor?.category) {
      valueText(doc, vendor.category + (vendor.gstin ? ' · MSME' : ''), MARGIN, y, { color: C.muted, size: 8 });
    }
    if (project?.site_location) {
      valueText(doc, project.site_location, rx, y, { color: C.muted, size: 8 });
    }
    y += 4.5;

    if (vendor?.gstin) {
      valueText(doc, `GSTIN: ${vendor.gstin}`, MARGIN, y, { color: C.muted, size: 8 });
    }
    y += 4;

    if (po.expected_delivery) {
      valueText(doc, `Expected Delivery: ${pdfFmtDate(po.expected_delivery)}`, MARGIN, y, { size: 8, color: C.mid });
      y += 4;
    }
    if (po.ordered_by) {
      valueText(doc, `Ordered by: ${po.ordered_by}`, MARGIN, y, { size: 8, color: C.mid });
      y += 4;
    }
    y += 4;

    drawRule(doc, y);
    y += 7;

    // ── Line items table ──────────────────────────────────────────────────────
    sectionLabel(doc, 'ITEMS ORDERED', MARGIN, y);
    y += 4;

    // Column widths must sum to CONTENT (182mm):
    // #:8  Desc:84  Unit:18  Qty:14  Rate:29  Amount:29 = 182
    const itemRows = lineItems?.length
      ? lineItems.map((li, i) => [
          String(li.line_number ?? i + 1),
          li.item_name + (li.specification ? `\n${li.specification}` : ''),
          li.unit ?? '',
          String(li.quantity_ordered ?? ''),
          fmtRupee(Number(li.unit_rate) || 0),
          fmtRupee(Number(li.total_amount) || 0),
        ])
      : (po.items || []).map((it: any, i: number) => [
          String(i + 1),
          it.description ?? '',
          it.unit ?? 'LS',
          String(it.qty ?? ''),
          fmtRupee(Number(it.rate) || 0),
          fmtRupee(Number(it.amount) || 0),
        ]);

    const orderValueNum = Number(po.order_value) || 0;
    const gstValueNum   = Number(po.gst_value)   || 0;
    const totalValueNum = Number(po.total_value || po.order_value) || 0;

    autoTable(doc, {
      startY: y,
      head: [['#', 'Item Description', 'Unit', 'Qty', 'Rate (Rs.)', 'Amount (Rs.)']],
      body: itemRows,
      theme: 'plain',
      columnStyles: {
        0: { cellWidth: 8,  halign: 'center', font: 'courier', fontSize: 7.5 },
        1: { cellWidth: 84, font: 'helvetica' },
        2: { cellWidth: 18, halign: 'center', font: 'helvetica' },
        3: { cellWidth: 14, halign: 'right',  font: 'courier' },
        4: { cellWidth: 29, halign: 'right',  font: 'courier' },
        5: { cellWidth: 29, halign: 'right',  font: 'courier', fontStyle: 'bold' },
      },
      headStyles: {
        fillColor: C.bg, textColor: C.muted as any,
        fontStyle: 'bold', fontSize: 7,
        cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
      },
      bodyStyles: { fontSize: 8.5, cellPadding: { top: 2.5, bottom: 2.5, left: 2, right: 2 } },
      alternateRowStyles: { fillColor: C.bg },
      margin: { left: MARGIN, right: MARGIN },
    });

    y = (doc as any).lastAutoTable.finalY + 5;

    // Totals block — right-aligned, 80mm wide
    const totW = 90;
    const totX = RIGHT - totW;

    const totRows: [string, number, boolean][] = [
      ['Order Value', orderValueNum, false],
      ...(gstValueNum > 0 ? [['GST', gstValueNum, false] as [string, number, boolean]] : []),
      ['TOTAL', totalValueNum, true],
    ];

    totRows.forEach(([label, val, bold]) => {
      doc.setFontSize(bold ? 10 : 8.5);
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      setColor(doc, bold ? C.dark : C.muted);
      doc.text(label as string, totX, y);
      doc.setFont('courier', bold ? 'bold' : 'normal');
      doc.text(fmtRupee(val as number), RIGHT, y, { align: 'right' });
      if (bold) {
        drawRule(doc, y - 4);
      }
      y += bold ? 6 : 5;
    });

    // Amount in words
    y += 3;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    setColor(doc, C.mid);
    const words = `Rupees ${amountInWords(totalValueNum)}`;
    const wordLines = doc.splitTextToSize(words, CONTENT);
    doc.text(wordLines, MARGIN, y);
    y += wordLines.length * 4 + 6;

    // Notes / Terms
    const termsToShow = po.vendor_notes || [
      '1. Delivery as per approved specifications and schedule.',
      '2. Rejected or damaged materials to be returned at vendor cost.',
      '3. Payment within 30 days of GRN acceptance and bill submission.',
      '4. Any price variation requires written approval before supply.',
    ].join('\n');

    drawRule(doc, y);
    y += 6;
    sectionLabel(doc, 'TERMS', MARGIN, y);
    y += 5;
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    setColor(doc, C.mid);
    const termLines = doc.splitTextToSize(String(termsToShow).substring(0, 400), CONTENT);
    doc.text(termLines, MARGIN, y);
    y += termLines.length * 4 + 8;

    // Signatures
    drawRule(doc, y);
    y += 8;
    drawSignatures(doc, y, 'Vendor Acknowledgement', vendor?.name);

    drawFooter(doc);
    doc.save(`${po.po_id}.pdf`);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) return <div className="p-4 md:p-8"><PageSkeleton /></div>;

  if (!po) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <p className="text-on-surface-variant text-[14px]">Purchase Order not found.</p>
        <button className="mt-4 bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2 rounded-xl" onClick={() => navigate(navState.from === 'project' && navState.projectId ? `/projects/${navState.projectId}/purchase-orders` : '/purchase-orders')}>
          Back to list
        </button>
      </div>
    );
  }

  const vendor  = po.stakeholders;
  const project = po.projects;
  const totalValue = Number(po.total_value || po.order_value) || 0;

  const activeTxns = (linkedTxns ?? []).filter((t: any) => t.transactions?.status !== 'Voided');
  const paidTotal = activeTxns.reduce((s: number, t: any) => s + (Number(t.allocated_amount) || 0), 0);
  const billAmt   = Number(po.vendor_bill_amount) || 0;
  const balance   = billAmt - paidTotal;
  const pct       = billAmt > 0 ? Math.min(100, (paidTotal / billAmt) * 100) : 0;

  // Count-up component
  function AmountDisplay({ amount }: { amount: number }) {
    const displayed = useCountUp(amount);
    return <span className="count-up-amount">₹{displayed.toLocaleString('en-IN')}</span>;
  }

  return (
    <div className="min-h-screen bg-[#f7f6f4] px-4 sm:px-6 pt-6 pb-20">
      <div className="max-w-[720px] mx-auto">

        {/* BACK */}
        <div className="detail-reveal mb-3" style={{ animationDelay: '0ms' }}>
          <BackLink
            to={navState.from === 'project' && navState.projectId ? `/projects/${navState.projectId}/purchase-orders` : '/purchase-orders'}
            label="Purchase orders"
          />
        </div>

        {/* BREADCRUMB */}
        <div className="detail-reveal mb-6" style={{ animationDelay: '0ms' }}>
          <Breadcrumb
            items={
              navState.from === 'project' && navState.projectName
                ? [
                    { label: 'Projects', href: '/projects' },
                    { label: navState.projectName, href: `/projects/${navState.projectId}` },
                    { label: 'Purchase Orders', href: `/projects/${navState.projectId}/purchase-orders` },
                    { label: poId! },
                  ]
                : [
                    { label: 'Dashboard', href: '/' },
                    { label: 'Purchase Orders', href: '/purchase-orders' },
                    { label: poId! },
                  ]
            }
          />
        </div>

        {/* HERO CARD */}
        <div className="detail-reveal" style={{ animationDelay: '40ms' }}>
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden mb-4">
            {/* Accent top bar */}
            <div className={`h-1 w-full ${po.status === 'PAID' ? 'bg-gradient-to-r from-emerald-400 to-teal-400' : po.status === 'CANCELLED' ? 'bg-rose-300' : 'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400'}`} />
            
            <div className="p-6">
              {/* Row 1: PO ID + date + status */}
              <div className="flex items-start justify-between gap-3 mb-5">
                <div>
                  {/* An unapproved order IS the purchase request — one continuum, named by gate. */}
                  <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-on-surface-variant/45 mb-1">{po.approval_status === 'APPROVED' ? 'Purchase Order' : 'Purchase Request'}</p>
                  <p className="font-mono text-[11px] text-on-surface-variant/50 mb-1 tracking-wide">{po.po_id}</p>
                  <p className="text-[12px] text-on-surface-variant/60">Ordered {fmtDate(po.date_issued)}{po.ordered_by ? ` by ${po.ordered_by}` : ''}</p>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {isOverdue(po) && <span className="text-[10px] font-bold text-red-500 bg-red-50 px-2 py-0.5 rounded-full border border-red-200/60 animate-pulse">Overdue</span>}
                  {(() => {
                    // One derived status: the gate/price state wins until the PO is a
                    // live, priced order; then we show the fulfillment status.
                    const gate = poGateState(po);
                    if (gate) {
                      const c = gate.tone === 'pending'
                        ? { bg: '#FBF3E0', fg: '#8A5A0B', bd: '#E5C98F' }
                        : { bg: '#FBEEE6', fg: gate.tone === 'rejected' ? '#8F3318' : '#A8421F', bd: '#E9C3AD' };
                      return (
                        <span className="flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold" style={{ background: c.bg, color: c.fg, border: `1px solid ${c.bd}` }}>
                          <span className="w-1.5 h-1.5 rounded-full" style={{ background: c.fg }} /> {gate.label}
                        </span>
                      );
                    }
                    return (
                      <span className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold ${STATUS_BADGE[po.status] ?? 'bg-surface-container-highest text-on-surface-variant'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[po.status] ?? 'bg-on-surface-variant/30'}`} />
                        {STATUS_LABEL[po.status] ?? po.status}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {/* Approval gate — a draft waits for management/principal */}
              {po.approval_status === 'PENDING' && (
                <div className="mb-5 rounded-xl p-4" style={{ background: '#FBF7EC', border: '1px solid #E5C98F' }}>
                  <div className="flex items-start gap-2.5">
                    <span className="material-symbols-outlined text-[18px] mt-0.5" style={{ color: '#8A5A0B' }}>verified_user</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold" style={{ color: '#6b4a08' }}>Waiting for approval</p>
                      <p className="text-[12px] mt-0.5" style={{ color: '#8A5A0B' }}>
                        {isApprover ? 'This PO stays a draft until you approve it.' : 'A draft — management or principal must approve it before it goes live.'}
                      </p>

                      {isApprover && !noteAction && (
                        <div className="flex items-center gap-2 mt-3 flex-wrap">
                          <button onClick={() => approve.mutate({ action: 'APPROVE' })} disabled={approve.isPending}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold text-white transition-opacity disabled:opacity-50" style={{ background: '#2F5D34' }}>
                            <span className="material-symbols-outlined text-[16px]">check</span>{approve.isPending ? 'Approving…' : 'Approve'}
                          </button>
                          <button onClick={() => setNoteAction('SEND_BACK')} disabled={approve.isPending}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold" style={{ background: 'transparent', border: '1px solid #E5C98F', color: '#8A5A0B' }}>
                            <span className="material-symbols-outlined text-[16px]">undo</span>Send back
                          </button>
                          <button onClick={() => setNoteAction('REJECT')} disabled={approve.isPending}
                            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-[13px] font-semibold" style={{ background: 'transparent', border: '1px solid #E9C3AD', color: '#8F3318' }}>
                            <span className="material-symbols-outlined text-[16px]">block</span>Reject
                          </button>
                        </div>
                      )}

                      {isApprover && noteAction && (
                        <div className="mt-3">
                          <textarea autoFocus value={approvalRemark} onChange={e => setApprovalRemark(e.target.value)} rows={2}
                            placeholder={noteAction === 'REJECT' ? 'Why is this rejected? (optional note)' : 'What needs fixing? (optional note to the creator)'}
                            className="w-full text-[13px] px-3 py-2 rounded-lg outline-none" style={{ background: '#fff', border: '1px solid #E5C98F', color: '#3D3830' }} />
                          <div className="flex items-center gap-2 mt-2">
                            <button onClick={() => { approve.mutate({ action: noteAction, remarks: approvalRemark.trim() }); setNoteAction(null); setApprovalRemark(''); }} disabled={approve.isPending}
                              className="px-4 py-2 rounded-lg text-[13px] font-semibold text-white disabled:opacity-50" style={{ background: '#8F3318' }}>
                              {noteAction === 'REJECT' ? 'Reject this order' : 'Send back to creator'}
                            </button>
                            <button onClick={() => { setNoteAction(null); setApprovalRemark(''); }} className="px-3 py-2 rounded-lg text-[13px] font-medium" style={{ color: '#8A5A0B' }}>Cancel</button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Row 2: Amount */}
              {totalValue > 0 && (
                <div className="mb-5">
                  <p className="text-[11px] font-medium text-on-surface-variant/50 mb-1 uppercase tracking-wider">Order Value</p>
                  <p className="text-[38px] font-black text-on-surface tracking-tight leading-none font-data-mono"><AmountDisplay amount={totalValue} /></p>
                </div>
              )}

              {/* Row 3: Vendor + Project */}
              <div className="flex flex-wrap gap-3 mb-4">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wider mb-1">Vendor</p>
                  <button
                    onClick={() => setShowStakeholderDrawer(true)}
                    className="group inline-flex items-center gap-1 text-[15px] font-semibold text-primary text-left max-w-full"
                  >
                    <span className="border-b border-dashed border-primary/45 group-hover:border-solid group-hover:border-primary transition-all pb-[2px] truncate">
                      {vendor?.name || '—'}
                    </span>
                    <span className="material-symbols-outlined text-[13px] text-primary/50 group-hover:text-primary transition-colors shrink-0">
                      chevron_right
                    </span>
                  </button>
                  <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{vendor?.category || ''}{vendor?.gstin ? ' · GST Registered' : ''}</p>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wider mb-1">Project</p>
                  <p className="text-[15px] font-semibold text-on-surface">{project?.name || '—'}</p>
                  {project?.site_location && <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{project.site_location}</p>}
                </div>
              </div>

              {/* Status-driven primary action */}
              {po.status === 'ORDERED' && canManage && (
                <div className="mt-2 space-y-3">
                  {Number(po.vendor_bill_amount) > 0 ? (
                    /* Bill already entered — show summary */
                    <BillSummaryCard po={po} activeTxns={activeTxns} onNavigate={navigate} />
                  ) : billCelebration ? (
                    <div className="rounded-xl border-2 border-green-500 bg-[#F0FDF4] p-4">
                      <div className="flex items-start gap-3">
                        <span className="text-2xl">🎉</span>
                        <div className="flex-1">
                          <p className="text-[15px] font-bold text-green-800">Bill recorded!</p>
                          <p className="text-[22px] font-bold text-green-700 leading-tight mt-1">
                            ₹{billCelebration.billAmount.toLocaleString('en-IN')}
                          </p>
                          <p className="text-[12px] text-green-700 mt-0.5">credited to {billCelebration.vendorName}'s account</p>
                          {billCelebration.billNo && (
                            <p className="text-[11px] text-green-600 mt-0.5 font-data-mono">Bill No: {billCelebration.billNo}</p>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 p-4">
                      <div className="flex items-start gap-3 mb-1">
                        <span className="text-2xl">📄</span>
                        <div className="flex-1">
                          <p className="text-[14px] font-semibold text-amber-900">Enter vendor bill</p>
                          <p className="text-[12px] text-amber-700 mt-0.5">Record the vendor's invoice amount before marking as received.</p>
                        </div>
                      </div>
                      <BillEntryForm
                        poId={poId!}
                        currentUserName={currentUserName}
                        onBillSaved={(data) => {
                          fireCelebration();
                          setBillCelebration({ billAmount: data.billAmount, billNo: data.billNo, vendorName: vendor?.name || 'vendor' });
                          showSnackbar(`🎉 Bill recorded! ₹${data.billAmount.toLocaleString('en-IN')} credited to vendor account`);
                          setTimeout(() => setBillCelebration(null), 4000);
                        }}
                      />
                    </div>
                  )}
                  <div>
                    <button onClick={() => setShowReceiveModal(true)}
                      className="h-9 px-4 rounded-lg bg-[#7C3AED] text-white text-[13px] font-medium hover:opacity-90 flex items-center gap-2">
                      <span className="material-symbols-outlined text-[16px]">inventory_2</span>
                      Mark Received at Site
                    </button>
                    <p className="text-[11px] text-on-surface-variant/60 mt-1.5">Confirm material has arrived and been checked at site</p>
                  </div>
                </div>
              )}

              {(po.status === 'BILLED' || po.status === 'PARTIAL') && canManage && (
                <div className="mt-2 space-y-3">
                  <BillSummaryCard po={po} activeTxns={activeTxns} onNavigate={navigate} />
                  <button onClick={() => setShowRecordPayment(true)}
                    className="h-9 px-4 rounded-lg bg-[#C8603A] text-white text-[13px] font-medium hover:opacity-90 flex items-center gap-2">
                    <span className="material-symbols-outlined text-[16px]">add</span>
                    Record Payment
                  </button>
                </div>
              )}

              {po.status === 'PAID' && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 text-green-600 mb-3">
                    <span className="material-symbols-outlined text-[20px]" style={{ fontVariationSettings: "'FILL' 1" }}>check_circle</span>
                    <p className="text-[14px] font-medium">Fully paid and settled</p>
                  </div>
                  <BillSummaryCard po={po} activeTxns={activeTxns} onNavigate={navigate} />
                </div>
              )}

              {po.status === 'CANCELLED' && (
                <p className="text-[13px] text-on-surface-variant/60 mt-2">This PO has been cancelled.</p>
              )}
            </div>

            {/* Action bar */}
            <div className="flex items-center gap-2 px-6 py-3 border-t border-outline-variant/10 bg-surface-container-low/30 flex-wrap">
              <button onClick={handleDownloadPDF} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg bg-on-surface text-surface-container-lowest text-[12px] font-semibold hover:opacity-90 transition-opacity">
                <span className="material-symbols-outlined text-[14px]">download</span> Download PDF
              </button>
              {['ORDERED', 'BILLED', 'PARTIAL'].includes(po.status) && canManage && (
                <button onClick={() => { if (window.confirm('Cancel this PO?')) updateStatus.mutate('CANCELLED'); }} className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg border border-red-200 text-red-600 text-[12px] font-semibold hover:bg-red-50 transition-colors">
                  <span className="material-symbols-outlined text-[14px]">cancel</span> Cancel PO
                </button>
              )}
              <button onClick={() => setShowLog(v => !v)} className="ml-auto flex items-center gap-1 text-[11px] text-on-surface-variant/50 hover:text-primary transition-colors">
                <span className="material-symbols-outlined text-[13px]">history</span>
                {showLog ? 'Hide log' : 'Activity Log'}
              </button>
            </div>
          </div>
        </div>

        {/* ITEMS ORDERED */}
        <div className="detail-reveal" style={{ animationDelay: '80ms' }}>
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5 mb-4">
            <SectionLabel icon="inventory_2" label="Items Ordered" />
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-outline-variant/20">
                    <th className="pb-2 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">#</th>
                    <th className="pb-2 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Code</th>
                    <th className="pb-2 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Item</th>
                    <th className="pb-2 text-center text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Unit</th>
                    <th className="pb-2 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Qty</th>
                    {lineItems?.some(li => (li.quantity_delivered ?? 0) > 0) && (
                      <th className="pb-2 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Del.</th>
                    )}
                    <th className="pb-2 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Rate</th>
                    <th className="pb-2 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">GST</th>
                    <th className="pb-2 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {lineItems && lineItems.length > 0 ? (
                    lineItems.map((li, i) => (
                      <tr key={li.id ?? i} className="border-b border-outline-variant/[0.06] hover:bg-surface-container-low/20 transition-colors">
                        <td className="py-2.5 pr-2 text-on-surface-variant/40 font-bold">{li.line_number}</td>
                        <td className="py-2.5 pr-2">
                          {li.category_id ? (
                            <span className="font-data-mono text-[10px] text-on-surface-variant/60">{li.category_id}</span>
                          ) : (
                            <span className="text-on-surface-variant/20">—</span>
                          )}
                        </td>
                        <td className="py-2.5 pr-2">
                          <div className="flex items-center gap-1.5">
                            <div>
                              <p className="text-[13px] font-medium text-on-surface">{li.item_name}</p>
                              {li.specification && (
                                <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{li.specification}</p>
                              )}
                            </div>
                            {li.is_ai_extracted && (
                              <span className="text-[9px] font-bold px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 shrink-0">AI</span>
                            )}
                          </div>
                        </td>
                        <td className="py-2.5 text-center text-on-surface-variant/70">{li.unit}</td>
                        <td className="py-2.5 text-right font-data-mono">{li.quantity_ordered}</td>
                        {lineItems.some(l => (l.quantity_delivered ?? 0) > 0) && (
                          <td className="py-2.5 text-right font-data-mono text-teal-600">{li.quantity_delivered ?? 0}</td>
                        )}
                        <td className="py-2.5 text-right font-data-mono text-on-surface-variant/70">
                          ₹{Number(li.unit_rate).toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 text-right text-on-surface-variant/50">{li.gst_rate}%</td>
                        <td className="py-2.5 text-right font-data-mono font-semibold text-on-surface">
                          ₹{Number(li.total_amount).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))
                  ) : (
                    /* Legacy items fallback */
                    (po.items || []).map((it: any, i: number) => (
                      <tr key={i} className="border-b border-outline-variant/[0.06]">
                        <td className="py-2.5 pr-2 text-on-surface-variant/40 font-bold">{i + 1}</td>
                        <td className="py-2.5 pr-2" />
                        <td className="py-2.5 pr-2">
                          <p className="text-[13px] font-medium text-on-surface">{it.description}</p>
                        </td>
                        <td className="py-2.5 text-center text-on-surface-variant/70">{it.unit || 'LS'}</td>
                        <td className="py-2.5 text-right font-data-mono">{it.qty}</td>
                        <td className="py-2.5 text-right font-data-mono text-on-surface-variant/70">
                          ₹{Number(it.rate).toLocaleString('en-IN')}
                        </td>
                        <td className="py-2.5 text-right text-on-surface-variant/50">—</td>
                        <td className="py-2.5 text-right font-data-mono font-semibold text-on-surface">
                          ₹{Number(it.amount).toLocaleString('en-IN')}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            {/* Totals footer */}
            {totalValue > 0 && (
              <div className="flex justify-end mt-3 pt-2 border-t border-outline-variant/15">
                <div className="space-y-1 text-[13px] min-w-[200px]">
                  <div className="flex justify-between text-on-surface-variant/60">
                    <span>Order Value</span>
                    <span className="font-data-mono">₹{Number(po.order_value).toLocaleString('en-IN')}</span>
                  </div>
                  {po.gst_value && Number(po.gst_value) > 0 && (
                    <div className="flex justify-between text-on-surface-variant/60">
                      <span>GST</span>
                      <span className="font-data-mono">₹{Number(po.gst_value).toLocaleString('en-IN')}</span>
                    </div>
                  )}
                  <div className="flex justify-between font-bold text-[14px] border-t border-outline-variant/20 pt-1">
                    <span>Grand Total</span>
                    <span className="font-data-mono text-primary">₹{totalValue.toLocaleString('en-IN')}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Notes */}
            {(po.vendor_notes || po.internal_notes) && (
              <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
                {po.vendor_notes && (
                  <div>
                    <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1.5">Vendor Terms</p>
                    <p className="text-[12px] text-on-surface-variant/70 whitespace-pre-line">{po.vendor_notes}</p>
                  </div>
                )}
                {po.internal_notes && (
                  <div>
                    <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1.5">Internal Notes</p>
                    <p className="text-[12px] text-on-surface-variant/70 whitespace-pre-line">{po.internal_notes}</p>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* AI RECONCILIATION */}
        {lineItems && lineItems.length > 0 && (
          <div className="detail-reveal" style={{ animationDelay: '155ms' }}>
            <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5 mb-4">
              <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                <SectionLabel icon="smart_toy" label="AI Reconciliation" />
                {reconResult && (
                  <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${
                    reconResult.risk_level === 'HIGH'   ? 'bg-red-100 text-red-800' :
                    reconResult.risk_level === 'MEDIUM' ? 'bg-amber-100 text-amber-800' :
                    'bg-green-100 text-green-800'
                  }`}>{reconResult.risk_level} RISK</span>
                )}
              </div>

              {/* Upload / run panel */}
              {!reconResult && (
                <div className="rounded-xl border border-outline-variant/20 overflow-hidden">

                  {/* Quick-run from attached bill URL */}
                  {po.vendor_bill_doc_url && !reconFile && (
                    <div className="px-4 py-3 bg-surface-container-low/40 flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[12px] font-semibold text-on-surface">Use attached bill document</p>
                        <p className="text-[11px] text-on-surface-variant/50">AI compares the uploaded bill against PO line items</p>
                      </div>
                      <button
                        onClick={() => runReconciliation(null)}
                        disabled={reconciling}
                        className="shrink-0 flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-primary text-on-primary rounded-lg hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {reconciling ? (
                          <><span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>Analyzing…</>
                        ) : (
                          <><span className="material-symbols-outlined text-[14px]">smart_toy</span>Run AI Check</>
                        )}
                      </button>
                    </div>
                  )}

                  {/* Upload zone */}
                  <div className={`px-4 py-3 ${po.vendor_bill_doc_url && !reconFile ? 'border-t border-outline-variant/10' : ''}`}>
                    <label className="flex items-center gap-3 cursor-pointer group">
                      <span className="material-symbols-outlined text-[20px] text-on-surface-variant/40 group-hover:text-primary transition-colors">upload_file</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[12px] text-on-surface-variant group-hover:text-on-surface transition-colors truncate">
                          {reconFile
                            ? reconFile.name
                            : po.vendor_bill_doc_url
                              ? 'Or upload a different bill image'
                              : 'Upload vendor bill/invoice image'
                          }
                        </p>
                        {reconFile && <p className="text-[10px] text-on-surface-variant/50">{(reconFile.size / 1024).toFixed(0)} KB</p>}
                      </div>
                      {reconFile && (
                        <button
                          onClick={e => { e.preventDefault(); setReconFile(null); setReconError(null); }}
                          className="shrink-0 text-on-surface-variant/40 hover:text-red-500 transition-colors"
                        >
                          <span className="material-symbols-outlined text-[16px]">close</span>
                        </button>
                      )}
                      <input
                        type="file"
                        className="hidden"
                        accept=".jpg,.jpeg,.png,.webp"
                        onChange={e => { const f = e.target.files?.[0]; if (f) { setReconFile(f); setReconError(null); } e.target.value = ''; }}
                      />
                    </label>

                    {reconFile && (
                      <button
                        onClick={() => runReconciliation(reconFile)}
                        disabled={reconciling}
                        className="mt-2 w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg bg-primary text-on-primary text-[12px] font-semibold hover:bg-primary/90 disabled:opacity-50 transition-colors"
                      >
                        {reconciling ? (
                          <><span className="material-symbols-outlined text-[14px] animate-spin">progress_activity</span>Analyzing document…</>
                        ) : (
                          <><span className="material-symbols-outlined text-[14px]">smart_toy</span>Run AI Reconciliation</>
                        )}
                      </button>
                    )}
                  </div>

                  {reconError && (
                    <div className="px-4 py-2.5 bg-red-50 border-t border-red-100">
                      <p className="text-[12px] text-red-700">{reconError}</p>
                    </div>
                  )}

                  <div className="px-4 py-2.5 border-t border-outline-variant/[0.06] bg-surface-container-low/20">
                    <p className="text-[10px] text-on-surface-variant/40">
                      Checks for grade downgrades, qty inflation, rate increases, ghost items &amp; arithmetic errors · JPG / PNG
                    </p>
                  </div>
                </div>
              )}

              {/* Results panel */}
              {reconResult && (
                <div className="space-y-3">

                  {/* Summary banner */}
                  <div className={`px-4 py-3 rounded-xl border ${
                    reconResult.risk_level === 'HIGH'   ? 'bg-red-50 border-red-200/60' :
                    reconResult.risk_level === 'MEDIUM' ? 'bg-amber-50 border-amber-200/60' :
                    'bg-green-50 border-green-200/60'
                  }`}>
                    <p className={`text-[13px] font-semibold ${
                      reconResult.risk_level === 'HIGH'   ? 'text-red-800' :
                      reconResult.risk_level === 'MEDIUM' ? 'text-amber-800' :
                      'text-green-800'
                    }`}>{reconResult.summary}</p>
                    {reconResult.bill_total_extracted != null && (
                      <p className="text-[11px] mt-1 text-on-surface-variant/60">
                        Bill total: <span className="font-data-mono font-semibold text-on-surface">₹{reconResult.bill_total_extracted.toLocaleString('en-IN')}</span>
                      </p>
                    )}
                    {reconResult.overall_flags.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {reconResult.overall_flags.map(f => (
                          <span key={f} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${
                            reconResult.risk_level === 'HIGH' ? 'bg-red-200/60 text-red-900' : 'bg-amber-200/60 text-amber-900'
                          }`}>{FLAG_LABEL[f] ?? f}</span>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Line-by-line breakdown */}
                  {reconResult.line_matches.length > 0 && (
                    <div className="rounded-xl border border-outline-variant/20 overflow-hidden divide-y divide-outline-variant/[0.08]">
                      {reconResult.line_matches.map((m, i) => (
                        <div key={i} className={`px-3 py-2.5 ${m.flags.length > 0 ? 'bg-amber-50/40' : ''}`}>
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {m.matched
                                  ? <span className="text-[9px] font-bold text-green-600">✓</span>
                                  : <span className="text-[9px] font-bold text-red-500">✕</span>
                                }
                                <p className="text-[12px] font-semibold text-on-surface">{m.po_line}</p>
                                {m.flags.map(f => (
                                  <span key={f} className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800">
                                    {FLAG_LABEL[f] ?? f}
                                  </span>
                                ))}
                              </div>
                              {m.flag_details && m.flags.length > 0 && (
                                <p className="text-[11px] text-amber-700 mt-0.5 leading-snug">{m.flag_details}</p>
                              )}
                              {m.bill_line && m.bill_line !== m.po_line && (
                                <p className="text-[10px] text-on-surface-variant/50 mt-0.5">Bill: "{m.bill_line}"</p>
                              )}
                              {!m.matched && (
                                <p className="text-[10px] text-red-500 font-semibold mt-0.5">Not found in bill</p>
                              )}
                            </div>
                            <div className="text-right shrink-0 text-[11px] space-y-0.5">
                              <p className="font-data-mono text-on-surface-variant/60">PO ₹{(m.po_amount ?? 0).toLocaleString('en-IN')}</p>
                              {m.bill_amount != null && (
                                <p className={`font-data-mono font-semibold ${
                                  m.bill_amount > m.po_amount * 1.02 ? 'text-red-600' :
                                  m.bill_amount < m.po_amount * 0.98 ? 'text-green-600' :
                                  'text-on-surface'
                                }`}>Bill ₹{m.bill_amount.toLocaleString('en-IN')}</p>
                              )}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Ghost items */}
                  {reconResult.ghost_items.length > 0 && (
                    <div className="rounded-xl border border-red-200/60 bg-red-50 px-3 py-3">
                      <p className="text-[10px] font-bold text-red-700 uppercase tracking-wider mb-2">
                        Ghost Items — billed but not in PO
                      </p>
                      <div className="space-y-1">
                        {reconResult.ghost_items.map((g, i) => (
                          <div key={i} className="flex items-center justify-between text-[12px]">
                            <span className="text-red-800 font-medium">{g.item}</span>
                            <span className="font-data-mono font-bold text-red-800">₹{(g.amount ?? 0).toLocaleString('en-IN')}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Re-run link */}
                  <button
                    onClick={() => { setReconResult(null); setReconFile(null); setReconError(null); }}
                    className="flex items-center gap-1 text-[11px] text-on-surface-variant hover:text-primary transition-colors"
                  >
                    <span className="material-symbols-outlined text-[13px]">refresh</span>
                    Run again with a different document
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

        {/* FINANCIAL */}
        <div className="detail-reveal" style={{ animationDelay: '180ms' }}>
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5 mb-4">
            <SectionLabel icon="account_balance_wallet" label="Financial Summary" />
            <div className="rounded-xl border border-outline-variant/20 overflow-hidden mt-3">
              {/* Credit row — vendor gave material */}
              {billAmt > 0 ? (
                <div className="flex items-center justify-between px-4 py-3 bg-[rgba(22,163,74,0.03)] border-b border-outline-variant/10">
                  <div>
                    <p className="text-[12px] font-medium text-[#16A34A]">Credit — By Purchase</p>
                    <p className="text-[11px] text-on-surface-variant/60 mt-0.5">Vendor bill recorded</p>
                  </div>
                  <span className="font-data-mono font-semibold text-[14px] text-[#16A34A]">
                    ₹{billAmt.toLocaleString('en-IN')}
                  </span>
                </div>
              ) : (
                <div className="flex items-center justify-between px-4 py-3 bg-amber-50/10 border-b border-outline-variant/10">
                  <div>
                    <p className="text-[12px] font-medium text-amber-700">Credit — Pending Bill</p>
                    <p className="text-[11px] text-on-surface-variant/60 mt-0.5">
                      No vendor bill recorded yet (Est. value: ₹{totalValue.toLocaleString('en-IN')})
                    </p>
                  </div>
                  <span className="font-data-mono font-semibold text-[14px] text-on-surface-variant/40">
                    —
                  </span>
                </div>
              )}
              {/* Debit row — payment made */}
              {paidTotal > 0 && (
                <div className="flex items-center justify-between px-4 py-3 border-b border-outline-variant/10">
                  <div>
                    <p className="text-[12px] font-medium text-on-surface">Debit — To Bank / Cash</p>
                    <p className="text-[11px] text-on-surface-variant/60 mt-0.5">
                      {billAmt === 0 ? 'PO Advance payment recorded' : 'Payment made'}
                    </p>
                  </div>
                  <span className="font-data-mono font-semibold text-[14px] text-on-surface">
                    ₹{paidTotal.toLocaleString('en-IN')}
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

            {/* Progress bar — only when bill amount is known */}
            {billAmt > 0 && (
              <div className="mt-4">
                <div className="flex justify-between items-center mb-1.5">
                  <span className="text-[11px] text-on-surface-variant">Payment progress</span>
                  <span className="text-[11px] font-semibold text-on-surface">{pct.toFixed(0)}%</span>
                </div>
                <div className="h-2 rounded-full bg-surface-container overflow-hidden">
                  <div
                    className={`h-full rounded-full progress-bar-animate ${pct >= 100 ? 'bg-secondary' : 'bg-primary'}`}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            )}

            {canManage && (
              <button
                onClick={() => setShowRecordPayment(true)}
                className="mt-4 flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-primary/10 text-primary rounded-lg hover:bg-primary/20 transition-colors"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                Record Payment
              </button>
            )}
          </div>
        </div>

        {/* PAYMENTS */}
        {activeTxns.length > 0 && (
          <div className="detail-reveal" style={{ animationDelay: '230ms' }}>
            <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5 mb-4">
              <SectionLabel icon="payments" label="Payments Made" />
              <div className="space-y-1.5 mt-3">
                {activeTxns.map((t: any) => (
                  <button
                    key={t.id}
                    className="w-full flex items-center gap-3 py-2 text-left hover:bg-surface-container-low/30 transition-colors rounded-lg px-1 group"
                    onClick={() => openPeek('TRANSACTION', t.transactions?.txn_id)}
                  >
                    {(() => {
                      const f = formatTxn({ ...t.transactions, total_amount: t.allocated_amount }, 'po');
                      return (
                        <>
                          <div className="min-w-0 flex-1">
                            <p className="text-[12px] font-[500] text-on-surface flex items-center gap-1.5 truncate">
                              {f.primary}
                              {t.transactions?.category === 'PO Advance' && (
                                <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold bg-amber-50 text-amber-700 border border-amber-200/50 inline-flex items-center shrink-0">
                                  Advance
                                </span>
                              )}
                            </p>
                            {f.secondary && <p className="text-[10px] text-on-surface-variant/60 truncate">{f.secondary}</p>}
                            <p className="text-[9px] font-mono text-on-surface-variant/25 opacity-0 group-hover:opacity-100 transition-opacity">{t.transactions?.txn_id}</p>
                          </div>
                          <p className="font-data-mono font-semibold text-[12px] text-on-surface shrink-0">₹{Number(t.allocated_amount).toLocaleString('en-IN')}</p>
                        </>
                      );
                    })()}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Receipts section */}
        <div className="detail-reveal" style={{ animationDelay: '280ms' }}>
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5 mb-4">
            <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
              <SectionLabel icon="local_shipping" label="Receipts" />
              {canManage && (
                <button
                  onClick={() => setShowReceiveDrawer(true)}
                  className="flex items-center gap-1 text-[11px] text-primary font-semibold hover:underline"
                >
                  <span className="material-symbols-outlined text-[13px]">local_shipping</span>
                  Receive at site
                </button>
              )}
            </div>

            {(!grns || grns.length === 0) ? (
              <p className="text-[12px] text-on-surface-variant/35 py-2">No receipts yet.</p>
            ) : (
              <div className="space-y-3 mt-3">
                {grns.map((grn: any) => {
                  const items = (grnItems ?? []).filter((i: any) => i.grn_id === grn.grn_id);
                  const hasDamaged = items.some((i: any) => i.condition !== 'good');
                  return (
                    <div key={grn.grn_id} className="rounded-xl border border-outline-variant/[0.10] bg-surface-container-low/30 p-3">
                      <div className="flex items-start justify-between gap-2 mb-1.5">
                        <p className="font-mono text-[12px] font-bold text-on-surface">{grn.grn_id}</p>
                        <div className="flex items-center gap-1.5">
                          {hasDamaged && (
                            <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded">
                              Discrepancy
                            </span>
                          )}
                          <span className="text-[11px] text-on-surface-variant/50">{fmtDate(grn.receipt_date)}</span>
                          <button
                            title="Download challan"
                            onClick={() => downloadGRNChallan({
                              grn_id:        grn.grn_id,
                              po_id:         po.po_id,
                              vendor_name:   vendor?.name ?? '—',
                              project_name:  project?.name ?? '—',
                              receipt_date:  grn.receipt_date,
                              dc_number:     grn.dc_number,
                              vehicle_number: grn.vehicle_number,
                              driver_name:   grn.driver_name,
                              remarks:       grn.remarks,
                              items: items.map((i: any) => ({
                                item_name:    i.item_name,
                                unit:         i.unit,
                                qty_ordered:  Number(i.qty_ordered),
                                qty_received: Number(i.qty_received),
                                unit_rate:    i.unit_rate != null ? Number(i.unit_rate) : null,
                                condition:    i.condition,
                                remarks:      i.remarks ?? null,
                              })),
                            })}
                            style={{
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                              width: 26, height: 26, borderRadius: 8, border: 'none',
                              background: 'rgba(11,28,48,0.06)', cursor: 'pointer',
                              transition: 'background 0.15s',
                            }}
                            onMouseEnter={e => (e.currentTarget.style.background = 'rgba(11,28,48,0.12)')}
                            onMouseLeave={e => (e.currentTarget.style.background = 'rgba(11,28,48,0.06)')}
                          >
                            <span className="material-symbols-outlined text-[14px] text-on-surface/50">download</span>
                          </button>
                        </div>
                      </div>
                      <p className="text-[11px] text-on-surface-variant/50">
                        {[grn.dc_number && `DC: ${grn.dc_number}`, grn.vehicle_number].filter(Boolean).join(' · ')}
                      </p>
                      {items.length > 0 && (
                        <div className="mt-2 space-y-1">
                          {items.map((item: any) => (
                            <div key={item.po_line_item_id ?? item.item_name} className="flex items-center justify-between text-[11px]">
                              <span className="text-on-surface/70">{item.item_name}</span>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-on-surface font-medium">{item.qty_received} {item.unit}</span>
                                {item.condition !== 'good' && (
                                  <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded capitalize ${
                                    item.condition === 'damaged' ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                                  }`}>{item.condition}</span>
                                )}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                      {grn.remarks && <p className="text-[11px] text-on-surface-variant/50 mt-1.5 italic">{grn.remarks}</p>}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* TRAIL / ACTIVITY LOG */}
        <div className="detail-reveal" style={{ animationDelay: '330ms' }}>
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5 mb-4">
            <SectionLabel icon="history" label="Activity Log" />
            
            <button
              onClick={() => setShowLog(v => !v)}
              className="mt-3 flex items-center gap-1.5 text-[12px] text-on-surface-variant hover:text-primary transition-colors"
            >
              GRN record · Status history · View log
              <span className="material-symbols-outlined text-[14px]">{showLog ? 'expand_less' : 'chevron_right'}</span>
            </button>

            {showLog && (
              <div className="mt-4 space-y-3 pl-1 border-l-2 border-outline-variant/10 ml-1">
                <div className="flex items-center gap-3">
                  <span className="w-2 h-2 rounded-full bg-on-surface-variant/30 shrink-0 -ml-[5px]" />
                  <span className="text-[12px] text-on-surface-variant/60 w-24 shrink-0">{fmtDate(po.created_at)}</span>
                  <span className="text-[12px] text-on-surface">Draft created</span>
                </div>
                {po.status !== 'Draft' && (
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-blue-400 shrink-0 -ml-[5px]" />
                    <span className="text-[12px] text-on-surface-variant/60 w-24 shrink-0">{fmtDate(po.date_issued)}</span>
                    <span className="text-[12px] text-on-surface font-medium">Order placed</span>
                  </div>
                )}
                {grns?.map((grn: any) => (
                  <div key={grn.grn_id} className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-teal-400 shrink-0 -ml-[5px]" />
                    <span className="text-[12px] text-on-surface-variant/60 w-24 shrink-0">{fmtDate(grn.receipt_date)}</span>
                    <span className="text-[12px] text-on-surface">GRN {grn.grn_id} recorded</span>
                  </div>
                ))}
                {(po.vendor_bill_number || po.vendor_bill_no) && (
                  <div className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-purple-400 shrink-0 -ml-[5px]" />
                    <span className="text-[12px] text-on-surface-variant/60 w-24 shrink-0">{fmtDate(po.vendor_bill_date)}</span>
                    <span className="text-[12px] text-on-surface">Vendor bill {po.vendor_bill_number || po.vendor_bill_no} recorded{po.bill_recorded_by_name ? ` by ${po.bill_recorded_by_name}` : ''}</span>
                  </div>
                )}
                {approvals?.map(ap => (
                  <div key={ap.id} className="flex items-center gap-3">
                    <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0 -ml-[5px]" />
                    <span className="text-[12px] w-24 shrink-0 text-on-surface-variant/60">{fmtDate(ap.actioned_at)}</span>
                    <span className="text-[12px] text-on-surface">{ap.action} {ap.remarks ? `· ${ap.remarks}` : ''}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

      </div>{/* end max-w container */}

      {/* ── Receive at site drawer ──────────────────────────────────────── */}
      {showReceiveDrawer && po && (
        <ReceiveAtSiteDrawer
          isOpen={showReceiveDrawer}
          po={{
            po_id:           po.po_id,
            org_id:          po.org_id,
            project_id:      po.project_id,
            stakeholder_id:  po.stakeholder_id,
            stakeholder_name: po.stakeholders?.name ?? '',
            line_items:      (lineItems ?? []).map((li: any) => ({
              id:                  li.id,
              item_name:           li.item_name,
              unit:                li.unit ?? 'Nos',
              quantity_ordered:    Number(li.quantity_ordered ?? 0),
              unit_rate:           Number(li.unit_rate ?? 0),
              qty_received_so_far: Number(li.quantity_delivered ?? 0),
            })),
          }}
          session={session}
          onClose={() => setShowReceiveDrawer(false)}
          onSuccess={(grnId) => {
            setShowReceiveDrawer(false);
            qc.invalidateQueries({ queryKey: ['po_grn', poId] });
            qc.invalidateQueries({ queryKey: ['po_grn_items', poId] });
            qc.invalidateQueries({ queryKey: ['po_detail', poId] });
            qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
            qc.invalidateQueries({ queryKey: ['po_receipt_summary'] });
            showSnackbar(`GRN ${grnId} recorded`);
          }}
        />
      )}

      {/* ── Mark Received Confirmation Modal ──────────────────────────── */}
      {showReceiveModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
          onClick={e => { if (e.target === e.currentTarget) setShowReceiveModal(false); }}>
          <div className="bg-white w-full max-w-sm rounded-2xl shadow-xl overflow-hidden">
            <div className="px-6 pt-6 pb-5">
              <p className="text-[16px] font-bold text-on-surface mb-1">Confirm Site Receipt</p>
              <div className="text-[12px] text-on-surface-variant space-y-1 mt-3 mb-4">
                <p className="font-data-mono font-semibold text-on-surface">{po.po_id} · {vendor?.name}</p>
                {lineItems && lineItems.length > 0 && (
                  <p className="text-on-surface-variant/70 line-clamp-2">
                    {lineItems.slice(0, 2).map((li: any) => li.item_name).join(', ')}
                    {lineItems.length > 2 ? ` +${lineItems.length - 2} more` : ''}
                  </p>
                )}
              </div>
              <div className="space-y-2 text-[12px] bg-surface-container-low/50 rounded-xl px-4 py-3 mb-4">
                <div className="flex justify-between">
                  <span className="text-on-surface-variant/60">Received by</span>
                  <span className="font-medium text-on-surface">{currentUserName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-on-surface-variant/60">Date</span>
                  <span className="font-medium text-on-surface">{new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                </div>
              </div>
              <div className="flex items-start gap-2 text-[11px] text-blue-700 bg-blue-50 rounded-lg px-3 py-2 mb-5">
                <span className="material-symbols-outlined text-[14px] mt-0.5">info</span>
                <span>After confirming, you must attach the vendor bill before payment can be processed.</span>
              </div>
              <div className="flex gap-3">
                <button onClick={() => setShowReceiveModal(false)}
                  className="flex-1 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] text-on-surface-variant font-medium hover:bg-surface-container-low transition-colors">
                  Cancel
                </button>
                <button onClick={() => markReceived.mutate()} disabled={markReceived.isPending}
                  className="flex-1 py-2.5 rounded-xl bg-[#7C3AED] text-white text-[13px] font-semibold hover:opacity-90 transition-opacity disabled:opacity-50 flex items-center justify-center gap-1.5">
                  <span className="material-symbols-outlined text-[16px]">check</span>
                  {markReceived.isPending ? 'Confirming…' : 'Confirm Receipt'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Record Payment Modal (Feature 3) ──────────────────────────── */}
      {showRecordPayment && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <p className="text-[15px] font-bold text-on-surface">Record Payment</p>
              <button onClick={() => setShowRecordPayment(false)} className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="p-3 bg-surface-container-low/60 rounded-xl text-[12px] space-y-1">
                <p><span className="text-on-surface-variant/60">PO:</span> <span className="font-data-mono font-bold">{po.po_id}</span></p>
                <p><span className="text-on-surface-variant/60">Vendor:</span> <span className="font-semibold">{vendor?.name}</span></p>
                {po.vendor_bill_amount && (
                  <p>
                    <span className="text-on-surface-variant/60">Bill Amount:</span>
                    <span className="font-data-mono font-semibold ml-1">₹{Number(po.vendor_bill_amount).toLocaleString('en-IN')}</span>
                  </p>
                )}
              </div>
              {(!po.vendor_bill_amount || Number(po.vendor_bill_amount) === 0) && (
                <div className="p-3.5 rounded-xl border border-amber-200/50 bg-amber-50/50 text-amber-800 animate-fadeIn">
                  <div className="flex items-start gap-2.5">
                    <span className="material-symbols-outlined text-[18px] text-amber-600 mt-0.5" style={{ fontVariationSettings: "'FILL' 1" }}>warning</span>
                    <div className="flex-1 text-[12px] leading-relaxed">
                      <p className="font-semibold text-amber-900">No vendor bill recorded yet.</p>
                      <p className="text-amber-800/80 mt-0.5">This transaction will be recorded as a <strong>PO Advance</strong> in the ledger and PO details.</p>
                    </div>
                  </div>
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Amount (₹) *</label>
                <input
                  type="number"
                  autoFocus
                  className="bk-input font-data-mono"
                  placeholder={String(po.vendor_bill_amount || totalValue)}
                  value={payAmount}
                  onChange={e => setPayAmount(e.target.value)}
                  step="any"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-2">Payment Mode</label>
                <div className="flex gap-2 flex-wrap">
                  {(['NEFT', 'UPI', 'Cheque', 'Cash'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setPayMode(m)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                        payMode === m
                          ? 'bg-primary text-on-primary border-primary'
                          : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Reference</label>
                <input className="bk-input" placeholder="UTR / Cheque no. / Reference" value={payRef} onChange={e => setPayRef(e.target.value)} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-outline-variant/10 flex gap-3 justify-end">
              <button onClick={() => setShowRecordPayment(false)} className="bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2 rounded-xl">
                Cancel
              </button>
              <button
                onClick={() => recordPayment.mutate()}
                disabled={recordPayment.isPending || !payAmount}
                className="bk-btn text-[13px] px-5 py-2 rounded-xl flex items-center gap-2 disabled:opacity-50"
              >
                {recordPayment.isPending ? 'Saving…' : 'Record Payment'}
                <span className="material-symbols-outlined text-[16px]">payments</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Settle PO Modal ────────────────────────────────────────────── */}
      {showSettleModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <p className="text-[15px] font-bold text-on-surface">Settle Purchase Order</p>
              <button onClick={() => setShowSettleModal(false)} className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div className="p-3 bg-surface-container-low/60 rounded-xl text-[12px] space-y-1">
                <p><span className="text-on-surface-variant/60">Settling PO:</span> <span className="font-data-mono font-bold">{po.po_id}</span></p>
                <p><span className="text-on-surface-variant/60">Vendor:</span> <span className="font-semibold">{vendor?.name}</span></p>
              </div>
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Amount (₹) *</label>
                <input
                  type="number"
                  className="bk-input font-data-mono"
                  value={settleAmount}
                  onChange={e => setSettleAmount(e.target.value)}
                  step="any"
                />
              </div>
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-2">Payment Mode</label>
                <div className="flex gap-2 flex-wrap">
                  {(['NEFT', 'UPI', 'Cheque', 'Cash'] as const).map(m => (
                    <button
                      key={m}
                      onClick={() => setSettlePayMode(m)}
                      className={`px-3 py-1.5 rounded-lg text-[12px] font-semibold border transition-colors ${
                        settlePayMode === m
                          ? 'bg-primary text-on-primary border-primary'
                          : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Reference</label>
                <input className="bk-input" placeholder="UTR / Cheque no. / Reference" value={settleRef} onChange={e => setSettleRef(e.target.value)} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-outline-variant/10 flex gap-3 justify-end">
              <button onClick={() => setShowSettleModal(false)} className="bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2 rounded-xl">
                Cancel
              </button>
              <button
                onClick={() => settlePO.mutate()}
                disabled={settlePO.isPending}
                className="bk-btn text-[13px] px-5 py-2 rounded-xl flex items-center gap-2"
              >
                {settlePO.isPending ? 'Processing…' : 'Create Transaction & Mark Settled'}
                <span className="material-symbols-outlined text-[16px]">check</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Stakeholder Ledger Drawer ─────────────────────────────────── */}
      {po && (
        <StakeholderLedgerDrawer
          isOpen={showStakeholderDrawer}
          onClose={() => setShowStakeholderDrawer(false)}
          stakeholderId={po.stakeholder_id}
        />
      )}
    </div>
  );
}
