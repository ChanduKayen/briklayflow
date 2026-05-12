import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSnackbar } from '../components/Snackbar';
import { LinearProgress } from '../components/LinearProgress';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import type { POLineItem, POGRN, POApproval } from '../types';

// ── Status helpers ────────────────────────────────────────────────────────────

function statusDotColor(status: string): string {
  switch (status) {
    case 'Draft':               return 'bg-on-surface-variant/40';
    case 'Pending Approval':    return 'bg-amber-400';
    case 'Approved':            return 'bg-blue-300';
    case 'Ordered':             return 'bg-blue-500';
    case 'Partially Delivered': return 'bg-teal-300';
    case 'Delivered':           return 'bg-teal-500';
    case 'Tallied':             return 'bg-green-500';
    case 'Disputed':            return 'bg-red-500';
    case 'Cancelled':           return 'bg-on-surface-variant/30';
    // Legacy
    case 'Issued':              return 'bg-blue-500';
    case 'Received':            return 'bg-teal-500';
    case 'Closed':              return 'bg-green-500';
    default:                    return 'bg-on-surface-variant/30';
  }
}

const STATUS_BADGE: Record<string, string> = {
  'Draft':               'bg-surface-container-highest text-on-surface-variant',
  'Pending Approval':    'bg-amber-100 text-amber-800',
  'Approved':            'bg-blue-100 text-blue-700',
  'Ordered':             'bg-blue-100 text-blue-800',
  'Partially Delivered': 'bg-teal-100 text-teal-700',
  'Delivered':           'bg-teal-100 text-teal-800',
  'Tallied':             'bg-green-100 text-green-800',
  'Disputed':            'bg-red-100 text-red-800',
  'Cancelled':           'bg-surface-container text-on-surface-variant/50',
  'Issued':              'bg-blue-100 text-blue-800',
  'Received':            'bg-teal-100 text-teal-800',
  'Closed':              'bg-green-100 text-green-800',
};

function matchStatusBadge(match?: string | null): string {
  switch (match) {
    case 'MATCHED':    return 'bg-green-100 text-green-800';
    case 'MISMATCHED': return 'bg-red-100 text-red-800';
    case 'PARTIAL':    return 'bg-amber-100 text-amber-800';
    default:           return 'bg-surface-container-highest text-on-surface-variant';
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

async function genGRNNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `GRN-${year}-`;
  const { data } = await supabase
    .from('po_grn')
    .select('grn_number')
    .like('grn_number', `${prefix}%`)
    .order('grn_number', { ascending: false })
    .limit(1);
  let seq = 1;
  if (data?.length) {
    const num = parseInt(data[0].grn_number.replace(prefix, ''), 10);
    if (!isNaN(num)) seq = num + 1;
  }
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PurchaseOrderDetail({ session }: { session: Session }) {
  const { poId }   = useParams<{ poId: string }>();
  const navigate   = useNavigate();
  const qc         = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);

  const canManage =
    profile?.role === 'management' ||
    profile?.role === 'principal' ||
    profile?.role === 'accountant';

  // ── UI state ───────────────────────────────────────────────────────────────
  const [showLog,              setShowLog]             = useState(false);
  const [showGRNForm,          setShowGRNForm]         = useState(false);
  const [showVendorBillForm,   setShowVendorBillForm]  = useState(false);
  const [showSettleModal,      setShowSettleModal]     = useState(false);
  const [showRecordPayment,    setShowRecordPayment]   = useState(false);

  // Vendor bill inline-edit state (Feature 4)
  const [editingBillField, setEditingBillField] = useState<'bill_no' | 'bill_date' | 'bill_amount' | null>(null);
  const [billNoEdit,       setBillNoEdit]       = useState('');
  const [billDateEdit,     setBillDateEdit]     = useState('');
  const [billAmountEdit,   setBillAmountEdit]   = useState('');

  // Record payment fields (Feature 3)
  const [payAmount,   setPayAmount]   = useState('');
  const [payMode,     setPayMode]     = useState<'NEFT' | 'UPI' | 'Cheque' | 'Cash'>('NEFT');
  const [payRef,      setPayRef]      = useState('');

  // GRN form fields
  const [grnNumber,         setGrnNumber]         = useState('');
  const [grnDate,           setGrnDate]           = useState(new Date().toISOString().split('T')[0]);
  const [grnReceivedBy,     setGrnReceivedBy]     = useState('');
  const [grnChallanNo,      setGrnChallanNo]      = useState('');
  const [grnVehicleNo,      setGrnVehicleNo]      = useState('');
  const [grnEwaybill,       setGrnEwaybill]       = useState('');
  const [grnCondition,      setGrnCondition]      = useState<'GOOD' | 'PARTIAL' | 'DAMAGED'>('GOOD');
  const [grnNotes,          setGrnNotes]          = useState('');

  // Vendor bill form fields
  const [billNo,    setBillNo]    = useState('');
  const [billDate,  setBillDate]  = useState(new Date().toISOString().split('T')[0]);
  const [billAmount, setBillAmount] = useState('');

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
        .select('*')
        .eq('po_id', poId!)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return data as POGRN[];
    },
    enabled: !!poId,
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
        .order('created_at', { ascending: false });
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

  const saveGRN = useMutation({
    mutationFn: async () => {
      const num = grnNumber.trim() || await genGRNNumber();
      const { error } = await supabase.from('po_grn').insert({
        po_id:               poId!,
        grn_number:          num,
        receipt_date:        grnDate,
        received_by_name:    grnReceivedBy || null,
        delivery_challan_no: grnChallanNo || null,
        ewaybill_number:     grnEwaybill || null,
        vehicle_number:      grnVehicleNo || null,
        condition:           grnCondition,
        notes:               grnNotes || null,
        created_by:          session.user.id,
      });
      if (error) throw error;

      // Update PO status
      const newStatus = grnCondition === 'GOOD' ? 'Delivered' : 'Partially Delivered';
      await supabase.from('purchase_orders').update({ status: newStatus }).eq('po_id', poId!);

      return num;
    },
    onSuccess: (num) => {
      qc.invalidateQueries({ queryKey: ['po_grn', poId] });
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setShowGRNForm(false);
      setGrnNumber('');
      setGrnReceivedBy('');
      setGrnChallanNo('');
      setGrnVehicleNo('');
      setGrnEwaybill('');
      setGrnNotes('');
      setGrnCondition('GOOD');
      showSnackbar(`GRN ${num} recorded`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to save GRN', { type: 'error' }),
  });

  const saveVendorBill = useMutation({
    mutationFn: async () => {
      if (!billNo.trim()) throw new Error('Bill number is required');
      const poValue = Number(po?.total_value || po?.order_value) || 0;
      const bAmt    = parseFloat(billAmount) || poValue;
      const ratio   = poValue > 0 ? Math.abs(bAmt - poValue) / poValue : 0;
      const match   = ratio < 0.02 ? 'MATCHED' : 'MISMATCHED';

      const { error } = await supabase.from('purchase_orders').update({
        vendor_bill_no:     billNo.trim(),
        vendor_bill_date:   billDate || null,
        vendor_bill_amount: bAmt,
        three_way_match:    match,
        status:             match === 'MATCHED' ? 'Tallied' : 'Disputed',
      }).eq('po_id', poId!);
      if (error) throw error;
      return match;
    },
    onSuccess: (match) => {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setShowVendorBillForm(false);
      showSnackbar(match === 'MATCHED' ? 'Bill matched — PO tallied' : 'Mismatch detected — PO marked Disputed');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to attach bill', { type: 'error' }),
  });

  const settlePO = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(settleAmount) || Number(po?.total_value || po?.order_value) || 0;
      if (!amount) throw new Error('Amount is required');

      // Create transaction
      const txnId = `TXN-${Date.now()}`;
      const { error: txnError } = await supabase.from('transactions').insert({
        txn_id:        txnId,
        stakeholder_id: po!.stakeholder_id,
        date:          new Date().toISOString().split('T')[0],
        total_amount:  amount,
        payment_mode:  settlePayMode,
        category:      'Purchase Payment',
        remarks:       `Settlement for PO ${poId}${settleRef ? ` · Ref: ${settleRef}` : ''}`,
        status:        'Active',
        ai_flag_status: 'Clean',
        ai_flag_data:  null,
        entered_by:    session.user.id,
      });
      if (txnError) throw txnError;

      // Create allocation
      const { error: allocError } = await supabase.from('txn_allocations').insert({
        txn_id:            txnId,
        project_id:        po!.project_id,
        order_type:        'PO',
        order_ref:         poId!,
        allocated_amount:  amount,
      });
      if (allocError) throw allocError;

      // Mark PO tallied
      await supabase.from('purchase_orders').update({ status: 'Tallied' }).eq('po_id', poId!);

      return txnId;
    },
    onSuccess: (txnId) => {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setShowSettleModal(false);
      showSnackbar('PO settled — transaction created');
      navigate(`/ledger/${txnId}`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to settle PO', { type: 'error' }),
  });

  // Feature 4 — save individual bill fields inline
  const saveBillField = useMutation({
    mutationFn: async (patch: Record<string, any>) => {
      // Recalculate match whenever bill_amount changes
      if ('vendor_bill_amount' in patch) {
        const tv = Number(po?.total_value || po?.order_value) || 0;
        const bAmt = Number(patch.vendor_bill_amount) || tv;
        const ratio = tv > 0 ? Math.abs(bAmt - tv) / tv : 0;
        const match = ratio < 0.02 ? 'MATCHED' : 'MISMATCHED';
        patch.three_way_match = match;
        if (po?.vendor_bill_no) {
          patch.status = match === 'MATCHED' ? 'Tallied' : 'Disputed';
        }
      }
      const { error } = await supabase.from('purchase_orders').update(patch).eq('po_id', poId!);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      setEditingBillField(null);
      showSnackbar('Bill updated');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to save', { type: 'error' }),
  });

  // Feature 3 — record payment against PO
  const recordPayment = useMutation({
    mutationFn: async () => {
      const amount = parseFloat(payAmount) || 0;
      if (!amount) throw new Error('Amount is required');
      const txnId = `TXN-${Date.now()}`;
      const { error: txnErr } = await supabase.from('transactions').insert({
        txn_id:         txnId,
        stakeholder_id: po!.stakeholder_id,
        date:           new Date().toISOString().split('T')[0],
        total_amount:   amount,
        payment_mode:   payMode,
        category:       'Purchase Payment',
        remarks:        `Payment for PO ${poId}${payRef ? ` · Ref: ${payRef}` : ''}`,
        status:         'Active',
        ai_flag_status: 'Clean',
        ai_flag_data:   null,
        entered_by:     session.user.id,
      });
      if (txnErr) throw txnErr;
      const { error: allocErr } = await supabase.from('txn_allocations').insert({
        txn_id:           txnId,
        project_id:       po!.project_id,
        order_type:       'PO',
        order_ref:        poId!,
        allocated_amount: amount,
      });
      if (allocErr) throw allocErr;
      return txnId;
    },
    onSuccess: (txnId) => {
      qc.invalidateQueries({ queryKey: ['po_linked_txns', poId] });
      qc.invalidateQueries({ queryKey: ['po_detail', poId] });
      setShowRecordPayment(false);
      setPayAmount('');
      setPayRef('');
      showSnackbar('Payment recorded');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to record payment', { type: 'error' }),
  });

  // ── PDF Download ───────────────────────────────────────────────────────────

  const handleDownloadPDF = () => {
    if (!po) return;
    const doc = new jsPDF();
    const pageW  = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Header
    doc.setFontSize(14); doc.setFont('helvetica', 'bold');
    doc.text('BRIKLAY ENGINEERING', margin, 18);
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
    doc.text('Kakinada, East Godavari, AP', margin, 24);

    // PO info right
    doc.setFontSize(12); doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
    doc.text('PURCHASE ORDER', pageW - margin, 18, { align: 'right' });
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(80);
    doc.text(`PO No: ${po.po_id}`, pageW - margin, 24, { align: 'right' });
    doc.text(`Date: ${fmtDate(po.date_issued)}`, pageW - margin, 30, { align: 'right' });
    if (po.expected_delivery) {
      doc.text(`Delivery by: ${fmtDate(po.expected_delivery)}`, pageW - margin, 36, { align: 'right' });
    }

    // Divider
    doc.setDrawColor(200); doc.line(margin, 42, pageW - margin, 42);

    // Vendor
    let y = 50;
    doc.setFontSize(8); doc.setTextColor(130); doc.text('VENDOR', margin, y);
    y += 5;
    doc.setFontSize(10); doc.setFont('helvetica', 'bold'); doc.setTextColor(0);
    doc.text(po.stakeholders?.name || '—', margin, y);
    if (po.stakeholders?.gstin) {
      y += 5;
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(100);
      doc.text(`GSTIN: ${po.stakeholders.gstin}`, margin, y);
    }

    // Project right
    doc.setFontSize(8); doc.setTextColor(80);
    doc.text(`PROJECT: ${po.projects?.name || '—'}`, pageW - margin, 55, { align: 'right' });
    if (po.delivery_location) {
      doc.text(`DELIVERY: ${po.delivery_location}`, pageW - margin, 62, { align: 'right' });
    }

    y += 12;

    // Line items table
    const itemsToRender = lineItems?.length
      ? lineItems.map((li, i) => [
          String(i + 1),
          li.category_id || '',
          li.item_name + (li.specification ? `\n${li.specification}` : ''),
          li.unit,
          String(li.quantity_ordered),
          `${Number(li.unit_rate).toLocaleString('en-IN')}`,
          `${Number(li.total_amount).toLocaleString('en-IN')}`,
        ])
      : (po.items || []).map((it: any, i: number) => [
          String(i + 1), '', it.description, it.unit || 'LS', String(it.qty),
          `${Number(it.rate).toLocaleString('en-IN')}`,
          `${Number(it.amount).toLocaleString('en-IN')}`,
        ]);

    autoTable(doc, {
      startY: y,
      head: [['#', 'Code', 'Item Description', 'Unit', 'Qty', 'Rate (₹)', 'Amount (₹)']],
      body: itemsToRender,
      theme: 'grid',
      headStyles: { fillColor: [41, 65, 128], textColor: 255, fontStyle: 'bold', fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 2 },
      columnStyles: {
        0: { cellWidth: 8,  halign: 'center' },
        1: { cellWidth: 20 },
        3: { cellWidth: 15, halign: 'center' },
        4: { cellWidth: 12, halign: 'center' },
        5: { cellWidth: 25, halign: 'right'  },
        6: { cellWidth: 30, halign: 'right'  },
      },
      margin: { left: margin, right: margin },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 8;

    // Totals
    doc.setFontSize(9); doc.setFont('helvetica', 'normal'); doc.setTextColor(80);
    doc.text(`GST: ₹${Number(po.gst_value || 0).toLocaleString('en-IN')}`, pageW - margin, finalY, { align: 'right' });
    doc.setFont('helvetica', 'bold'); doc.setTextColor(0); doc.setFontSize(11);
    doc.text(`Grand Total: ₹${Number(po.total_value || po.order_value).toLocaleString('en-IN')}`, pageW - margin, finalY + 8, { align: 'right' });

    // Terms
    if (po.vendor_notes) {
      doc.setFontSize(8); doc.setFont('helvetica', 'normal'); doc.setTextColor(80);
      doc.text('Terms:', margin, finalY + 20);
      doc.text(po.vendor_notes.substring(0, 200), margin, finalY + 27, { maxWidth: pageW - margin * 2 });
    }

    // Signatures
    const sigY = finalY + 55;
    doc.setTextColor(0); doc.setFont('helvetica', 'normal');
    doc.line(margin, sigY, margin + 60, sigY);
    doc.line(pageW - margin - 60, sigY, pageW - margin, sigY);
    doc.setFontSize(8);
    doc.text('Vendor Acknowledgement', margin, sigY + 5);
    doc.text('Authorised Signatory', pageW - margin - 60, sigY + 5);
    doc.text('Briklay Engineering', pageW - margin - 60, sigY + 10);

    doc.save(`${po.po_id}.pdf`);
  };

  // ── Render ────────────────────────────────────────────────────────────────

  if (isLoading) return <LinearProgress />;

  if (!po) {
    return (
      <div className="px-margin-mobile md:px-margin-desktop pt-6">
        <p className="text-on-surface-variant text-[14px]">Purchase Order not found.</p>
        <button className="mt-4 bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2 rounded-xl" onClick={() => navigate('/purchase-orders')}>
          Back to list
        </button>
      </div>
    );
  }

  const vendor  = po.stakeholders;
  const project = po.projects;
  const totalValue = Number(po.total_value || po.order_value) || 0;

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-16">

      {/* Page header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/purchase-orders')}
          className="p-2 rounded-xl hover:bg-surface-container-low transition-colors text-on-surface-variant"
        >
          <span className="material-symbols-outlined text-[22px]">arrow_back</span>
        </button>
        <div className="flex-1">
          <h2 className="text-[20px] font-bold text-on-surface tracking-tight font-data-mono">{po.po_id}</h2>
          <p className="text-[12px] text-on-surface-variant/60 mt-0.5">
            {fmtDate(po.date_issued)}
            {po.ordered_by ? ` · ${po.ordered_by}` : ''}
          </p>
        </div>
        <button
          onClick={handleDownloadPDF}
          className="hidden md:flex items-center gap-2 bk-btn-ghost border border-outline-variant/30 text-[12px] px-3 py-2 rounded-xl"
        >
          <span className="material-symbols-outlined text-[16px]">download</span>
          Download PDF
        </button>
      </div>

      {/* Status action strip */}
      <div className="bg-surface-container-lowest rounded-xl border border-outline-variant/30 shadow-sm mb-6 overflow-hidden">
        <div className="flex items-center gap-3 px-5 py-3 flex-wrap">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${statusDotColor(po.status)}`} />
          <span className={`px-2.5 py-0.5 text-[11px] font-bold rounded-full ${STATUS_BADGE[po.status] ?? STATUS_BADGE['Draft']}`}>
            {po.status?.toUpperCase()}
          </span>

          {/* Action buttons */}
          {po.status === 'Draft' && canManage && (
            <button
              onClick={() => updateStatus.mutate('Ordered')}
              disabled={updateStatus.isPending}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-primary text-on-primary rounded-lg hover:bg-primary/90 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">send</span>
              Place Order
            </button>
          )}

          {['Ordered', 'Partially Delivered'].includes(po.status) && canManage && (
            <button
              onClick={async () => { const n = await genGRNNumber(); setGrnNumber(n); setShowGRNForm(true); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-secondary text-on-secondary rounded-lg hover:bg-secondary/90 transition-colors"
            >
              <span className="material-symbols-outlined text-[16px]">inventory_2</span>
              Record GRN
            </button>
          )}

          {po.status === 'Delivered' && canManage && !po.vendor_bill_no && (
            <button
              onClick={() => setShowVendorBillForm(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-outline-variant/40 rounded-lg hover:bg-surface-container-low transition-colors text-on-surface"
            >
              <span className="material-symbols-outlined text-[16px]">receipt</span>
              Attach Vendor Bill
            </button>
          )}

          {['Ordered', 'Partially Delivered', 'Delivered'].includes(po.status) && canManage && (
            <button
              onClick={() => { if (window.confirm('Cancel this PO?')) updateStatus.mutate('Cancelled'); }}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
            >
              <span className="material-symbols-outlined text-[15px]">cancel</span>
              Cancel PO
            </button>
          )}

          <button
            onClick={() => setShowLog(v => !v)}
            className="ml-auto flex items-center gap-1 text-[12px] text-on-surface-variant hover:text-on-surface transition-colors"
          >
            {showLog ? 'Hide log' : 'View log'}
            <span className="material-symbols-outlined text-[14px]">{showLog ? 'expand_less' : 'chevron_right'}</span>
          </button>
        </div>

        {/* Collapsible log */}
        {showLog && (
          <div className="border-t border-outline-variant/15 px-5 py-4">
            <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-3">Status History</p>
            <div className="space-y-2">
              <div className="flex items-center gap-3">
                <span className="w-1.5 h-1.5 rounded-full bg-on-surface-variant/30" />
                <span className="text-[12px] text-on-surface-variant/60">{fmtDate(po.created_at)}</span>
                <span className="text-[12px] text-on-surface">Draft created</span>
              </div>
              {po.status !== 'Draft' && (
                <div className="flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-blue-400" />
                  <span className="text-[12px] text-on-surface-variant/60">{fmtDate(po.date_issued)}</span>
                  <span className="text-[12px] text-on-surface">Order placed</span>
                </div>
              )}
              {grns?.map(grn => (
                <div key={grn.id} className="flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-teal-400" />
                  <span className="text-[12px] text-on-surface-variant/60">{fmtDate(grn.receipt_date)}</span>
                  <span className="text-[12px] text-on-surface">GRN {grn.grn_number} recorded · {grn.condition}</span>
                </div>
              ))}
              {po.vendor_bill_no && (
                <div className="flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                  <span className="text-[12px] text-on-surface-variant/60">{fmtDate(po.vendor_bill_date)}</span>
                  <span className="text-[12px] text-on-surface">Vendor bill {po.vendor_bill_no} attached · {po.three_way_match}</span>
                </div>
              )}
              {approvals?.map(ap => (
                <div key={ap.id} className="flex items-center gap-3">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                  <span className="text-[12px] text-on-surface-variant/60">{fmtDate(ap.actioned_at)}</span>
                  <span className="text-[12px] text-on-surface">{ap.action} {ap.remarks ? `· ${ap.remarks}` : ''}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* PO Document Card */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm mb-6 overflow-hidden">
        {/* PO header info */}
        <div className="px-6 py-5 border-b border-outline-variant/10">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Vendor */}
            <div>
              <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1.5">Vendor</p>
              <p className="text-[14px] font-bold text-on-surface">{vendor?.name ?? '—'}</p>
              {vendor?.category && <p className="text-[12px] text-on-surface-variant/60 mt-0.5">{vendor.category}</p>}
              {vendor?.gstin && <p className="text-[11px] text-on-surface-variant/40 mt-0.5 font-data-mono">{vendor.gstin}</p>}
              {vendor?.is_approved && (
                <span className="inline-block mt-1.5 text-[10px] font-bold px-2 py-0.5 rounded bg-secondary-container text-on-secondary-container">✓ Approved</span>
              )}
            </div>

            {/* Project + Delivery */}
            <div>
              <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1.5">Project</p>
              <p className="text-[14px] font-bold text-on-surface">{project?.name ?? '—'}</p>
              {project?.site_location && <p className="text-[12px] text-on-surface-variant/60 mt-0.5">{project.site_location}</p>}
              {po.delivery_location && po.delivery_location !== project?.site_location && (
                <p className="text-[11px] text-on-surface-variant/50 mt-1">Delivery: {po.delivery_location}</p>
              )}
            </div>

            {/* Dates & Value */}
            <div>
              <div className="flex justify-between mb-3">
                <div>
                  <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1">Order Date</p>
                  <p className="text-[13px] text-on-surface">{fmtDate(po.date_issued)}</p>
                </div>
                {po.expected_delivery && (
                  <div className="text-right">
                    <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1">Delivery By</p>
                    <p className="text-[13px] text-on-surface">{fmtDate(po.expected_delivery)}</p>
                  </div>
                )}
              </div>
              <div className="mt-2 p-3 bg-surface-container-low/50 rounded-xl">
                <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1">Order Value</p>
                <p className="font-data-mono text-[18px] font-bold text-on-surface">
                  ₹{totalValue.toLocaleString('en-IN')}
                </p>
                {po.gst_value && Number(po.gst_value) > 0 && (
                  <p className="text-[11px] text-on-surface-variant/50 font-data-mono mt-0.5">
                    incl. GST ₹{Number(po.gst_value).toLocaleString('en-IN')}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Line Items Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface-container-low/40 border-b border-outline-variant/10">
                <th className="px-4 py-3 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">#</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Code</th>
                <th className="px-4 py-3 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Item</th>
                <th className="px-4 py-3 text-center text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Unit</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Qty Ordered</th>
                {lineItems?.some(li => (li.quantity_delivered ?? 0) > 0) && (
                  <th className="px-4 py-3 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Delivered</th>
                )}
                <th className="px-4 py-3 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Rate</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">GST</th>
                <th className="px-4 py-3 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wide">Total</th>
              </tr>
            </thead>
            <tbody>
              {lineItems && lineItems.length > 0 ? (
                lineItems.map((li, i) => (
                  <tr key={li.id ?? i} className="border-b border-outline-variant/[0.06] hover:bg-surface-container-low/20 transition-colors">
                    <td className="px-4 py-3 text-on-surface-variant/40 font-bold">{li.line_number}</td>
                    <td className="px-4 py-3">
                      {li.category_id ? (
                        <span className="font-data-mono text-[10px] text-on-surface-variant/60">{li.category_id}</span>
                      ) : (
                        <span className="text-on-surface-variant/20">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
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
                    <td className="px-4 py-3 text-center text-on-surface-variant/70">{li.unit}</td>
                    <td className="px-4 py-3 text-right font-data-mono">{li.quantity_ordered}</td>
                    {lineItems.some(l => (l.quantity_delivered ?? 0) > 0) && (
                      <td className="px-4 py-3 text-right font-data-mono text-teal-600">{li.quantity_delivered ?? 0}</td>
                    )}
                    <td className="px-4 py-3 text-right font-data-mono text-on-surface-variant/70">
                      ₹{Number(li.unit_rate).toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right text-on-surface-variant/50">{li.gst_rate}%</td>
                    <td className="px-4 py-3 text-right font-data-mono font-semibold text-on-surface">
                      ₹{Number(li.total_amount).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))
              ) : (
                /* Legacy items fallback */
                (po.items || []).map((it: any, i: number) => (
                  <tr key={i} className="border-b border-outline-variant/[0.06]">
                    <td className="px-4 py-3 text-on-surface-variant/40 font-bold">{i + 1}</td>
                    <td className="px-4 py-3" />
                    <td className="px-4 py-3">
                      <p className="text-[13px] font-medium text-on-surface">{it.description}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-on-surface-variant/70">{it.unit || 'LS'}</td>
                    <td className="px-4 py-3 text-right font-data-mono">{it.qty}</td>
                    <td className="px-4 py-3 text-right font-data-mono text-on-surface-variant/70">
                      ₹{Number(it.rate).toLocaleString('en-IN')}
                    </td>
                    <td className="px-4 py-3 text-right text-on-surface-variant/50">—</td>
                    <td className="px-4 py-3 text-right font-data-mono font-semibold text-on-surface">
                      ₹{Number(it.amount).toLocaleString('en-IN')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Totals footer */}
        <div className="px-6 py-4 bg-surface-container-low/20 border-t border-outline-variant/10 flex justify-end">
          <div className="w-64 space-y-1.5 text-[13px]">
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
            <div className="flex justify-between font-bold text-[15px] border-t border-outline-variant/20 pt-2">
              <span>Grand Total</span>
              <span className="font-data-mono text-primary">₹{totalValue.toLocaleString('en-IN')}</span>
            </div>
          </div>
        </div>

        {/* Notes */}
        {(po.vendor_notes || po.internal_notes) && (
          <div className="px-6 py-4 border-t border-outline-variant/10 grid grid-cols-1 md:grid-cols-2 gap-4">
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

      {/* GRN Section */}
      {['Ordered', 'Partially Delivered', 'Delivered', 'Tallied', 'Issued', 'Received', 'Closed'].includes(po.status) && (
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm mb-6 overflow-hidden">
          <div className="flex items-center justify-between px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10">
            <p className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Goods Receipt Notes</p>
            {canManage && ['Ordered', 'Partially Delivered', 'Issued'].includes(po.status) && (
              <button
                onClick={async () => { const n = await genGRNNumber(); setGrnNumber(n); setShowGRNForm(true); }}
                className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline"
              >
                <span className="material-symbols-outlined text-[14px]">add</span>
                Record GRN
              </button>
            )}
          </div>

          {grns?.map(grn => (
            <div key={grn.id} className="px-6 py-4 border-b border-outline-variant/[0.06] last:border-0">
              <div className="flex items-center justify-between">
                <p className="font-data-mono font-bold text-[13px] text-on-surface">{grn.grn_number}</p>
                <span className={`text-[10px] font-bold px-2 py-0.5 rounded ${
                  grn.condition === 'GOOD'    ? 'bg-secondary-container text-on-secondary-container' :
                  grn.condition === 'DAMAGED' ? 'bg-red-100 text-red-800' :
                  'bg-amber-100 text-amber-800'
                }`}>
                  {grn.condition}
                </span>
              </div>
              <p className="text-[12px] text-on-surface-variant/60 mt-1">
                {fmtDate(grn.receipt_date)}
                {grn.received_by_name && ` · ${grn.received_by_name}`}
                {grn.delivery_challan_no && ` · DC: ${grn.delivery_challan_no}`}
                {grn.vehicle_number && ` · ${grn.vehicle_number}`}
              </p>
              {grn.notes && <p className="text-[12px] text-on-surface-variant/50 mt-1">{grn.notes}</p>}
            </div>
          ))}

          {!grns?.length && (
            <p className="px-6 py-5 text-[13px] text-on-surface-variant/40">No GRNs recorded yet.</p>
          )}
        </div>
      )}

      {/* ── Feature 4: Vendor Bill Card (always visible) ─────────────────── */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm mb-6 overflow-hidden">
        <div className="flex items-center justify-between px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10">
          <div className="flex items-center gap-3">
            <p className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Vendor Bill</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${matchStatusBadge(po.three_way_match)}`}>
              {po.vendor_bill_no ? (po.three_way_match ?? 'PENDING') : 'NOT ATTACHED'}
            </span>
          </div>
          {!po.vendor_bill_no && canManage && (
            <button
              onClick={() => setShowVendorBillForm(true)}
              className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline"
            >
              <span className="material-symbols-outlined text-[14px]">add</span>
              Attach Bill
            </button>
          )}
        </div>

        <div className="px-6 py-4 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Bill Number */}
          <div>
            <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1.5">Bill Number</p>
            {editingBillField === 'bill_no' ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className="bk-input text-[13px] font-data-mono py-1.5 px-2 h-8"
                  value={billNoEdit}
                  onChange={e => setBillNoEdit(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') saveBillField.mutate({ vendor_bill_no: billNoEdit.trim() });
                    if (e.key === 'Escape') setEditingBillField(null);
                  }}
                  onBlur={() => { if (billNoEdit.trim()) saveBillField.mutate({ vendor_bill_no: billNoEdit.trim() }); else setEditingBillField(null); }}
                />
              </div>
            ) : (
              <button
                onClick={() => { setBillNoEdit(po.vendor_bill_no || ''); setEditingBillField('bill_no'); }}
                className="group flex items-center gap-1.5 text-left"
              >
                <p className="font-data-mono text-[14px] font-semibold text-on-surface">
                  {po.vendor_bill_no || <span className="text-on-surface-variant/30 text-[13px] font-normal">Click to add</span>}
                </p>
                <span className="material-symbols-outlined text-[14px] text-on-surface-variant/25 group-hover:text-primary transition-colors">edit</span>
              </button>
            )}
          </div>

          {/* Bill Date */}
          <div>
            <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1.5">Bill Date</p>
            {editingBillField === 'bill_date' ? (
              <input
                autoFocus
                type="date"
                className="bk-input text-[13px] py-1.5 px-2 h-8"
                value={billDateEdit}
                onChange={e => setBillDateEdit(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') saveBillField.mutate({ vendor_bill_date: billDateEdit });
                  if (e.key === 'Escape') setEditingBillField(null);
                }}
                onBlur={() => { if (billDateEdit) saveBillField.mutate({ vendor_bill_date: billDateEdit }); else setEditingBillField(null); }}
              />
            ) : (
              <button
                onClick={() => { setBillDateEdit(po.vendor_bill_date || new Date().toISOString().split('T')[0]); setEditingBillField('bill_date'); }}
                className="group flex items-center gap-1.5 text-left"
              >
                <p className="text-[14px] text-on-surface">
                  {po.vendor_bill_date ? fmtDate(po.vendor_bill_date) : <span className="text-on-surface-variant/30 text-[13px]">Click to add</span>}
                </p>
                <span className="material-symbols-outlined text-[14px] text-on-surface-variant/25 group-hover:text-primary transition-colors">edit</span>
              </button>
            )}
          </div>

          {/* Bill Amount */}
          <div>
            <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1.5">Bill Amount</p>
            {editingBillField === 'bill_amount' ? (
              <input
                autoFocus
                type="number"
                className="bk-input font-data-mono text-[13px] py-1.5 px-2 h-8"
                value={billAmountEdit}
                onChange={e => setBillAmountEdit(e.target.value)}
                step="any"
                onKeyDown={e => {
                  if (e.key === 'Enter') saveBillField.mutate({ vendor_bill_amount: parseFloat(billAmountEdit) || 0 });
                  if (e.key === 'Escape') setEditingBillField(null);
                }}
                onBlur={() => { if (billAmountEdit) saveBillField.mutate({ vendor_bill_amount: parseFloat(billAmountEdit) || 0 }); else setEditingBillField(null); }}
              />
            ) : (
              <button
                onClick={() => { setBillAmountEdit(po.vendor_bill_amount ? String(po.vendor_bill_amount) : ''); setEditingBillField('bill_amount'); }}
                className="group flex items-center gap-1.5 text-left"
              >
                <p className="font-data-mono text-[14px] font-bold text-on-surface">
                  {po.vendor_bill_amount
                    ? `₹${Number(po.vendor_bill_amount).toLocaleString('en-IN')}`
                    : <span className="text-on-surface-variant/30 text-[13px] font-normal">Click to add</span>
                  }
                </p>
                <span className="material-symbols-outlined text-[14px] text-on-surface-variant/25 group-hover:text-primary transition-colors">edit</span>
              </button>
            )}
            {po.vendor_bill_amount && Number(po.vendor_bill_amount) !== totalValue && (
              <p className={`text-[11px] mt-1 font-semibold ${
                Math.abs(Number(po.vendor_bill_amount) - totalValue) / totalValue > 0.02
                  ? 'text-red-500'
                  : 'text-amber-600'
              }`}>
                {Number(po.vendor_bill_amount) > totalValue ? '▲' : '▼'} ₹{Math.abs(Number(po.vendor_bill_amount) - totalValue).toLocaleString('en-IN')} variance
              </p>
            )}
            {po.vendor_bill_amount && Math.abs(Number(po.vendor_bill_amount) - totalValue) / totalValue <= 0.02 && (
              <p className="text-[11px] mt-1 text-green-600 font-semibold">✓ Within tolerance</p>
            )}
          </div>
        </div>

        {/* Match result banner */}
        {po.three_way_match === 'MATCHED' && (
          <div className="mx-6 mb-4 px-4 py-3 bg-green-50 rounded-xl flex items-center gap-3">
            <span className="material-symbols-outlined text-green-600 text-[20px]">check_circle</span>
            <div className="flex-1">
              <p className="text-[13px] font-semibold text-on-surface">PO ↔ GRN ↔ Bill matched</p>
              <p className="text-[12px] text-on-surface-variant/60">Safe to proceed to payment</p>
            </div>
            {canManage && (
              <button
                onClick={() => setShowRecordPayment(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-primary text-on-primary rounded-lg hover:bg-primary/90 transition-colors"
              >
                <span className="material-symbols-outlined text-[16px]">payments</span>
                Record Payment
              </button>
            )}
          </div>
        )}
        {po.three_way_match === 'MISMATCHED' && (
          <div className="mx-6 mb-4 px-4 py-3 bg-red-50 rounded-xl flex items-center gap-3">
            <span className="material-symbols-outlined text-red-500 text-[20px]">warning</span>
            <div>
              <p className="text-[13px] font-semibold text-red-700">Mismatch — variance exceeds 2%</p>
              <p className="text-[12px] text-on-surface-variant/60">Update the bill amount or dispute before payment.</p>
            </div>
          </div>
        )}
      </div>

      {/* ── Feature 3: Financial Summary + Linked Transactions ─────────── */}
      {(() => {
        const paidTotal = (linkedTxns ?? []).reduce((s: number, t: any) => s + (Number(t.allocated_amount) || 0), 0);
        const billAmt   = Number(po.vendor_bill_amount) || totalValue;
        const balance   = billAmt - paidTotal;
        const pct       = billAmt > 0 ? Math.min(100, (paidTotal / billAmt) * 100) : 0;
        return (
          <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm mb-6 overflow-hidden">
            <div className="flex items-center justify-between px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10">
              <p className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Financial Summary</p>
              {canManage && (
                <button
                  onClick={() => setShowRecordPayment(true)}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-primary hover:underline"
                >
                  <span className="material-symbols-outlined text-[14px]">add</span>
                  Record Payment
                </button>
              )}
            </div>

            {/* KPI row */}
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-outline-variant/10 border-b border-outline-variant/10">
              {[
                { label: 'PO Value',    val: `₹${totalValue.toLocaleString('en-IN')}`,   sub: 'Committed' },
                { label: 'Bill Amount', val: po.vendor_bill_amount ? `₹${Number(po.vendor_bill_amount).toLocaleString('en-IN')}` : '—', sub: 'From vendor' },
                { label: 'Paid',        val: `₹${paidTotal.toLocaleString('en-IN')}`,   sub: `${(linkedTxns ?? []).length} payment${(linkedTxns ?? []).length !== 1 ? 's' : ''}` },
                { label: 'Balance Due', val: balance > 0 ? `₹${balance.toLocaleString('en-IN')}` : '₹0', sub: balance <= 0 ? 'Fully paid' : 'Outstanding', err: balance > 0 },
              ].map(k => (
                <div key={k.label} className="px-5 py-4">
                  <p className="text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider mb-1">{k.label}</p>
                  <p className={`font-data-mono text-[17px] font-bold ${k.err ? 'text-red-600' : 'text-on-surface'}`}>{k.val}</p>
                  <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{k.sub}</p>
                </div>
              ))}
            </div>

            {/* Progress bar */}
            <div className="px-6 py-3 border-b border-outline-variant/10">
              <div className="flex justify-between items-center mb-1.5">
                <span className="text-[11px] text-on-surface-variant/50">Payment progress</span>
                <span className="text-[11px] font-semibold text-on-surface">{pct.toFixed(0)}%</span>
              </div>
              <div className="h-2 rounded-full bg-surface-container overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all duration-700 ${pct >= 100 ? 'bg-secondary' : 'bg-primary'}`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </div>

            {/* Linked transactions */}
            {(linkedTxns ?? []).length === 0 ? (
              <p className="px-6 py-5 text-[13px] text-on-surface-variant/40">No payments recorded yet.</p>
            ) : (
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-outline-variant/10">
                    <th className="px-5 py-2.5 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Txn ID</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Date</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Mode</th>
                    <th className="px-5 py-2.5 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Amount</th>
                    <th className="px-5 py-2.5 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Remarks</th>
                  </tr>
                </thead>
                <tbody>
                  {(linkedTxns ?? []).map((t: any) => (
                    <tr
                      key={t.id}
                      className="border-b border-outline-variant/[0.06] hover:bg-surface-container-low/30 cursor-pointer transition-colors"
                      onClick={() => navigate(`/ledger/${t.transactions?.txn_id}`)}
                    >
                      <td className="px-5 py-3 font-data-mono font-bold text-primary">{t.transactions?.txn_id}</td>
                      <td className="px-5 py-3 text-on-surface-variant">{fmtDate(t.transactions?.date)}</td>
                      <td className="px-5 py-3 text-on-surface-variant">{t.transactions?.payment_mode ?? '—'}</td>
                      <td className="px-5 py-3 text-right font-data-mono font-semibold text-on-surface">
                        ₹{Number(t.allocated_amount).toLocaleString('en-IN')}
                      </td>
                      <td className="px-5 py-3 text-on-surface-variant/60 max-w-[200px] truncate">{t.transactions?.remarks ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        );
      })()}

      {/* ── Feature 2: Bill ↔ PO Reconciliation ───────────────────────── */}
      {(po.vendor_bill_no || po.status === 'Delivered') && lineItems && lineItems.length > 0 && (
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm mb-6 overflow-hidden">
          <div className="flex items-center gap-3 px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10">
            <p className="text-[11px] font-bold text-on-surface-variant/60 uppercase tracking-wider">Line-Item Reconciliation</p>
            <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${matchStatusBadge(po.three_way_match)}`}>
              {po.three_way_match ?? 'PENDING'}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-outline-variant/10 bg-surface-container-low/30">
                  <th className="px-4 py-2.5 text-left text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Item</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">PO Qty</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Delivered</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">PO Rate</th>
                  <th className="px-4 py-2.5 text-right text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider">PO Total</th>
                  <th className="px-4 py-2.5 text-center text-[10px] font-bold text-on-surface-variant/50 uppercase tracking-wider w-[60px]">Match</th>
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li: any, i: number) => {
                  const qtyOrdered   = Number(li.quantity_ordered) || 0;
                  const qtyDelivered = Number(li.quantity_delivered) || 0;
                  const lineTotal    = Number(li.total_amount) || 0;
                  const fullyDelivered = qtyDelivered >= qtyOrdered;
                  const noDelivery     = qtyDelivered === 0;
                  const matchIcon = !po.vendor_bill_no ? null
                    : fullyDelivered ? '✓'
                    : noDelivery     ? '—'
                    : '⚠';
                  const matchColor = !po.vendor_bill_no ? 'text-on-surface-variant/20'
                    : fullyDelivered ? 'text-green-600'
                    : noDelivery     ? 'text-on-surface-variant/30'
                    : 'text-amber-500';
                  return (
                    <tr key={li.id ?? i} className="border-b border-outline-variant/[0.06] hover:bg-surface-container-low/20 transition-colors">
                      <td className="px-4 py-3">
                        <p className="font-medium text-on-surface">{li.item_name}</p>
                        {li.specification && <p className="text-[11px] text-on-surface-variant/50 mt-0.5">{li.specification}</p>}
                      </td>
                      <td className="px-4 py-3 text-right font-data-mono text-on-surface">{qtyOrdered} {li.unit}</td>
                      <td className="px-4 py-3 text-right font-data-mono">
                        <span className={qtyDelivered === 0 ? 'text-on-surface-variant/30' : qtyDelivered >= qtyOrdered ? 'text-secondary font-semibold' : 'text-amber-600 font-semibold'}>
                          {qtyDelivered} {li.unit}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-data-mono text-on-surface-variant">
                        ₹{Number(li.unit_rate).toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-right font-data-mono font-semibold text-on-surface">
                        ₹{lineTotal.toLocaleString('en-IN')}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-[15px] font-bold ${matchColor}`}>{matchIcon ?? '·'}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t border-outline-variant/20 bg-surface-container-low/20">
                  <td className="px-4 py-3 font-bold text-[12px] text-on-surface-variant/60 uppercase">Total</td>
                  <td className="px-4 py-3 text-right font-data-mono font-bold text-on-surface">
                    {lineItems.reduce((s: number, l: any) => s + (Number(l.quantity_ordered) || 0), 0)}
                  </td>
                  <td className="px-4 py-3 text-right font-data-mono font-bold text-secondary">
                    {lineItems.reduce((s: number, l: any) => s + (Number(l.quantity_delivered) || 0), 0)}
                  </td>
                  <td />
                  <td className="px-4 py-3 text-right font-data-mono font-bold text-on-surface">
                    ₹{lineItems.reduce((s: number, l: any) => s + (Number(l.total_amount) || 0), 0).toLocaleString('en-IN')}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* Actions row */}
          {canManage && po.vendor_bill_no && (
            <div className="px-6 py-3 border-t border-outline-variant/10 flex gap-3 flex-wrap">
              {po.status !== 'Tallied' && po.three_way_match === 'MATCHED' && (
                <button
                  onClick={() => updateStatus.mutate('Tallied')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold bg-secondary text-on-secondary rounded-lg hover:bg-secondary/90 transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">done_all</span>
                  Mark Tallied
                </button>
              )}
              {po.status !== 'Disputed' && po.three_way_match === 'MISMATCHED' && (
                <button
                  onClick={() => updateStatus.mutate('Disputed')}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors"
                >
                  <span className="material-symbols-outlined text-[15px]">flag</span>
                  Raise Dispute
                </button>
              )}
              <button
                onClick={() => setShowRecordPayment(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 text-[12px] font-semibold border border-outline-variant/30 text-on-surface rounded-lg hover:bg-surface-container-low transition-colors"
              >
                <span className="material-symbols-outlined text-[15px]">payments</span>
                Record Payment
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── GRN Form Modal ──────────────────────────────────────────────── */}
      {showGRNForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white w-full md:max-w-lg rounded-t-2xl md:rounded-2xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <p className="text-[15px] font-bold text-on-surface">Record Goods Receipt Note</p>
              <button onClick={() => setShowGRNForm(false)} className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4 overflow-y-auto max-h-[70vh]">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">GRN Number</label>
                  <input className="bk-input font-data-mono" value={grnNumber} onChange={e => setGrnNumber(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Receipt Date</label>
                  <input type="date" className="bk-input" value={grnDate} onChange={e => setGrnDate(e.target.value)} />
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Received By</label>
                <input className="bk-input" placeholder="Name of person receiving" value={grnReceivedBy} onChange={e => setGrnReceivedBy(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Delivery Challan No</label>
                  <input className="bk-input" placeholder="Optional" value={grnChallanNo} onChange={e => setGrnChallanNo(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Vehicle Number</label>
                  <input className="bk-input" placeholder="Optional" value={grnVehicleNo} onChange={e => setGrnVehicleNo(e.target.value)} />
                </div>
              </div>
              {totalValue > 50000 && (
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">E-Way Bill No</label>
                  <input className="bk-input" placeholder="Required for value > ₹50,000" value={grnEwaybill} onChange={e => setGrnEwaybill(e.target.value)} />
                </div>
              )}
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-2">Condition</label>
                <div className="flex gap-2">
                  {(['GOOD', 'PARTIAL', 'DAMAGED'] as const).map(c => (
                    <button
                      key={c}
                      onClick={() => setGrnCondition(c)}
                      className={`flex-1 py-2 text-[12px] font-semibold rounded-lg border transition-colors ${
                        grnCondition === c
                          ? c === 'GOOD'    ? 'bg-green-500 text-white border-green-500' :
                            c === 'PARTIAL' ? 'bg-amber-500 text-white border-amber-500' :
                                              'bg-red-500 text-white border-red-500'
                          : 'border-outline-variant/30 text-on-surface-variant hover:bg-surface-container-low'
                      }`}
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Notes</label>
                <textarea className="bk-input resize-none" rows={2} placeholder="Inspection notes, remarks…" value={grnNotes} onChange={e => setGrnNotes(e.target.value)} />
              </div>
            </div>
            <div className="px-6 py-4 border-t border-outline-variant/10 flex gap-3 justify-end">
              <button onClick={() => setShowGRNForm(false)} className="bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2 rounded-xl">
                Cancel
              </button>
              <button
                onClick={() => saveGRN.mutate()}
                disabled={saveGRN.isPending}
                className="bk-btn text-[13px] px-5 py-2 rounded-xl"
              >
                {saveGRN.isPending ? 'Saving…' : 'Save GRN'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Vendor Bill Form Modal ─────────────────────────────────────── */}
      {showVendorBillForm && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-end md:items-center justify-center p-0 md:p-4">
          <div className="bg-white w-full md:max-w-md rounded-t-2xl md:rounded-2xl shadow-xl overflow-hidden">
            <div className="flex items-center justify-between px-6 py-4 border-b border-outline-variant/10">
              <p className="text-[15px] font-bold text-on-surface">Attach Vendor Bill</p>
              <button onClick={() => setShowVendorBillForm(false)} className="text-on-surface-variant hover:text-on-surface p-1 rounded-lg">
                <span className="material-symbols-outlined">close</span>
              </button>
            </div>
            <div className="px-6 py-5 space-y-4">
              <div>
                <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Vendor Bill No *</label>
                <input className="bk-input font-data-mono" placeholder="e.g. INV/2026/001" value={billNo} onChange={e => setBillNo(e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Bill Date</label>
                  <input type="date" className="bk-input" value={billDate} onChange={e => setBillDate(e.target.value)} />
                </div>
                <div>
                  <label className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider block mb-1.5">Bill Amount (₹)</label>
                  <input
                    type="number"
                    className="bk-input font-data-mono"
                    placeholder={String(totalValue)}
                    value={billAmount}
                    onChange={e => setBillAmount(e.target.value)}
                    step="any"
                  />
                </div>
              </div>
              <p className="text-[11px] text-on-surface-variant/50">
                If bill amount matches PO value (within 2%), the PO will be automatically tallied.
              </p>
            </div>
            <div className="px-6 py-4 border-t border-outline-variant/10 flex gap-3 justify-end">
              <button onClick={() => setShowVendorBillForm(false)} className="bk-btn-ghost border border-outline-variant/30 text-[13px] px-4 py-2 rounded-xl">
                Cancel
              </button>
              <button
                onClick={() => saveVendorBill.mutate()}
                disabled={saveVendorBill.isPending}
                className="bk-btn text-[13px] px-5 py-2 rounded-xl flex items-center gap-2"
              >
                {saveVendorBill.isPending ? 'Saving…' : 'Save & Run Match'}
                <span className="material-symbols-outlined text-[16px]">rule</span>
              </button>
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
    </div>
  );
}
