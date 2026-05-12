import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { useSnackbar } from '../components/Snackbar';
import { LinearProgress } from '../components/LinearProgress';
import { getBillingMode } from '../lib/billingMode';
import type { Session } from '@supabase/supabase-js';
import type { ClientInvoice, ClientPayment, InvoiceStatus, Stakeholder, Project } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<string, string> = {
  Draft:     'bg-surface-container-highest text-on-surface-variant',
  Sent:      'bg-blue-50 text-blue-700',
  Partial:   'bg-amber-50 text-amber-700',
  Paid:      'bg-secondary-container text-on-secondary-container',
  Overdue:   'bg-error-container text-error',
  Void:      'bg-surface-container text-on-surface-variant/40',
  Cancelled: 'bg-surface-container text-on-surface-variant/40',
};

const STATUS_LABEL: Record<string, string> = {
  Draft:     'Draft',
  Sent:      'Sent',
  Partial:   'Partially Paid',
  Paid:      'Paid',
  Overdue:   'Overdue',
  Void:      'Cancelled',
  Cancelled: 'Cancelled',
};

const TYPE_LABEL: Record<string, string> = {
  progress:    'Progress Bill',
  final:       'Final Bill',
  advance:     'Advance Bill',
  invoice:     'Tax Invoice',
  proforma:    'Proforma Invoice',
  advance_old: 'Advance Receipt',
  credit_note: 'Credit Note',
  receipt:     'Receipt',
};

const PAY_MODES = ['NEFT', 'UPI', 'Cheque', 'Cash'] as const;

function fmt(n: number) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

function genTxnId() {
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

function numberToWords(n: number): string {
  const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
    'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
  const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

  function inWords(num: number): string {
    if (num === 0) return '';
    if (num < 20) return a[num] + ' ';
    if (num < 100) return b[Math.floor(num / 10)] + (num % 10 ? ' ' + a[num % 10] : '') + ' ';
    if (num < 1000) return a[Math.floor(num / 100)] + ' Hundred ' + inWords(num % 100);
    if (num < 100000) return inWords(Math.floor(num / 1000)) + 'Thousand ' + inWords(num % 1000);
    if (num < 10000000) return inWords(Math.floor(num / 100000)) + 'Lakh ' + inWords(num % 100000);
    return inWords(Math.floor(num / 10000000)) + 'Crore ' + inWords(num % 10000000);
  }

  const rounded = Math.round(n);
  if (rounded === 0) return 'Zero';
  return inWords(rounded).trim();
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function BillDetail({ session }: { session: Session }) {
  const { billId } = useParams<{ billId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();

  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0]);
  const [receiptMode, setReceiptMode] = useState<'NEFT' | 'UPI' | 'Cheque' | 'Cash'>('NEFT');
  const [receiptRef, setReceiptRef] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: bill, isLoading } = useQuery({
    queryKey: ['client_invoice', billId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*')
        .eq('invoice_id', billId)
        .single();
      if (error) throw error;
      return data as ClientInvoice;
    },
    enabled: !!billId,
  });

  const { data: payments } = useQuery({
    queryKey: ['client_payments', billId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_payments')
        .select('*')
        .eq('invoice_id', billId)
        .order('payment_date', { ascending: false });
      if (error) throw error;
      return data as ClientPayment[];
    },
    enabled: !!billId,
  });

  const { data: stakeholders } = useQuery({
    queryKey: ['stakeholders'],
    queryFn: async () => {
      const { data } = await supabase.from('stakeholders').select('stakeholder_id, name, gstin');
      return data as Pick<Stakeholder, 'stakeholder_id' | 'name' | 'gstin'>[];
    },
  });

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name');
      return data as Pick<Project, 'project_id' | 'name'>[];
    },
  });

  const client = stakeholders?.find(s => s.stakeholder_id === bill?.client_id);
  const project = projects?.find(p => p.project_id === bill?.project_id);
  const outstanding = bill ? Math.max(0, Number(bill.total_amount) - Number(bill.paid_amount)) : 0;

  // ── Mutations ─────────────────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: async (status: InvoiceStatus) => {
      const { error } = await supabase
        .from('client_invoices')
        .update({ status })
        .eq('invoice_id', billId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_invoice', billId] });
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
      showSnackbar('Status updated');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to update status', { type: 'error' }),
  });

  const recordReceipt = useMutation({
    mutationFn: async () => {
      if (!bill) throw new Error('Bill not loaded');
      const amount = parseFloat(receiptAmount);
      if (!amount || amount <= 0) throw new Error('Invalid amount');

      const newPaid = Number(bill.paid_amount) + amount;
      const newStatus: InvoiceStatus = newPaid >= Number(bill.total_amount) ? 'Paid' : 'Partial';

      const { error: payErr } = await supabase.from('client_payments').insert([{
        invoice_id: billId,
        amount,
        payment_date: receiptDate,
        payment_mode: receiptMode,
        reference: receiptRef.trim() || null,
        notes: receiptNotes.trim() || null,
        created_by: session.user.id,
      }]);
      if (payErr) throw payErr;

      const { error: invErr } = await supabase
        .from('client_invoices')
        .update({ paid_amount: newPaid, status: newStatus })
        .eq('invoice_id', billId);
      if (invErr) throw invErr;

      // Integrated mode: create Transaction
      const billingMode = getBillingMode();
      if (billingMode === 'integrated' && bill.client_id && bill.project_id) {
        const txnId = genTxnId();
        const txnPayload = {
          txn_id: txnId,
          stakeholder_id: bill.client_id,
          date: receiptDate,
          total_amount: amount,
          payment_mode: receiptMode,
          category: 'CLIENT-RECEIPT',
          remarks: `Receipt for ${billId}${receiptRef ? ` · Ref: ${receiptRef}` : ''}`,
          ai_flag_status: 'Clean',
          ai_flag_data: { type: 'client_receipt', invoice_id: billId },
          entered_by: session.user.id,
        };
        const { error: txnErr } = await supabase.from('transactions').insert([txnPayload]);
        if (!txnErr) {
          await supabase.from('txn_allocations').insert([{
            txn_id: txnId,
            project_id: bill.project_id,
            order_type: null,
            order_ref: null,
            allocated_amount: amount,
          }]);
          await supabase
            .from('client_payments')
            .update({ txn_id: txnId })
            .eq('invoice_id', billId)
            .is('txn_id', null)
            .order('created_at', { ascending: false })
            .limit(1);
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_invoice', billId] });
      qc.invalidateQueries({ queryKey: ['client_payments', billId] });
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
      qc.invalidateQueries({ queryKey: ['ledger'] });
      setShowReceiptModal(false);
      setReceiptAmount('');
      setReceiptRef('');
      setReceiptNotes('');
      showSnackbar('Payment recorded');
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to record payment', { type: 'error' }),
  });

  const openReceiptModal = () => {
    setReceiptAmount(outstanding > 0 ? String(outstanding) : '');
    setReceiptDate(new Date().toISOString().split('T')[0]);
    setShowReceiptModal(true);
  };

  // ── PDF Download ─────────────────────────────────────────────────────────
  const handleDownloadPDF = () => {
    if (!bill) return;
    const doc = new jsPDF();
    const pageW = doc.internal.pageSize.getWidth();
    const margin = 14;

    // Watermark for draft/void
    if (bill.status === 'Draft' || bill.status === 'Void' || bill.status === 'Cancelled') {
      doc.setFontSize(60);
      doc.setTextColor(230, 230, 230);
      doc.setFont('helvetica', 'bold');
      doc.text(bill.status.toUpperCase(), pageW / 2, 160, { angle: 45, align: 'center' });
      doc.setTextColor(0, 0, 0);
    }

    // Header left
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('BRIKLAY ENGINEERING', margin, 18);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(100);
    doc.text('Kakinada, East Godavari, AP', margin, 24);
    doc.text('GSTIN: —', margin, 30);

    // Header right
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    const typeLabel = TYPE_LABEL[bill.invoice_type] ?? bill.invoice_type.toUpperCase();
    doc.text('TAX INVOICE', pageW - margin, 18, { align: 'right' });
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    doc.text(`Bill No: ${bill.invoice_id}`, pageW - margin, 24, { align: 'right' });
    doc.text(`Date: ${fmtDate(bill.invoice_date)}`, pageW - margin, 30, { align: 'right' });
    if (bill.due_date) doc.text(`Due: ${fmtDate(bill.due_date)}`, pageW - margin, 36, { align: 'right' });

    // Divider
    doc.setDrawColor(200, 200, 200);
    doc.line(margin, 42, pageW - margin, 42);

    // Bill to
    let y = 50;
    doc.setFontSize(8);
    doc.setTextColor(130);
    doc.text('BILL TO', margin, y);
    y += 5;
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text(client?.name || '—', margin, y);
    if (client?.gstin) {
      y += 5;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'normal');
      doc.setTextColor(100);
      doc.text(`GSTIN: ${client.gstin}`, margin, y);
    }

    // Project info on right
    doc.setFontSize(8);
    doc.setTextColor(80);
    doc.text(`PROJECT: ${project?.name || '—'}`, pageW - margin, 55, { align: 'right' });

    y += 10;

    // Milestone
    if (bill.milestone_name) {
      doc.setFontSize(10);
      doc.setFont('helvetica', 'italic');
      doc.setTextColor(80);
      doc.text(bill.milestone_name, margin, y);
      y += 5;
    }

    // Bill type label
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(60);
    doc.text(`${typeLabel.toUpperCase()} BILL`, margin, y);
    y += 8;

    // Abstract of Cost table
    const tableRows: any[] = [];
    const g  = Number(bill.gross_amount ?? 0);
    const pb = Number(bill.previous_bills_amount ?? 0);
    const nb = Number(bill.net_bill_amount ?? 0);
    const rr = Number(bill.retention_rate ?? 0);
    const ra = Number(bill.retention_amount ?? 0);
    const np = Number(bill.net_payable_pretax ?? 0);
    const ca = Number(bill.cgst_amount ?? 0);
    const sa = Number(bill.sgst_amount ?? 0);

    tableRows.push(['Gross Value of Work Done', `₹ ${g.toLocaleString('en-IN')}`]);
    tableRows.push([`Less: Value of Previous Bills`, `(₹ ${pb.toLocaleString('en-IN')})`]);
    tableRows.push([{ content: 'Net Value This Bill', styles: { fontStyle: 'bold' } }, { content: `₹ ${nb.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold' } }]);
    if (rr > 0) {
      tableRows.push([`Less: Retention @ ${rr}%`, `(₹ ${ra.toLocaleString('en-IN')})`]);
    }
    tableRows.push([{ content: 'Net Payable (before tax)', styles: { fontStyle: 'bold' } }, { content: `₹ ${np.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold' } }]);

    if (bill.gst_applicable !== false) {
      const cr = Number(bill.cgst_rate ?? 0);
      tableRows.push([`Add: CGST @ ${cr}%`, `₹ ${ca.toLocaleString('en-IN')}`]);
      tableRows.push([`Add: SGST @ ${cr}%`, `₹ ${sa.toLocaleString('en-IN')}`]);
    }

    const grandTotal = Number(bill.total_amount);
    tableRows.push([
      { content: 'GRAND TOTAL', styles: { fontStyle: 'bold', fontSize: 11 } },
      { content: `₹ ${grandTotal.toLocaleString('en-IN')}`, styles: { fontStyle: 'bold', fontSize: 11 } },
    ]);

    autoTable(doc, {
      startY: y,
      head: [['Description', 'Amount (₹)']],
      body: tableRows,
      theme: 'grid',
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { cellWidth: 60, halign: 'right', font: 'courier' },
      },
      headStyles: { fillColor: [41, 65, 128], textColor: 255, fontStyle: 'bold', fontSize: 9 },
      styles: { fontSize: 9, cellPadding: 3 },
      margin: { left: margin, right: margin },
    });

    const finalY = (doc as any).lastAutoTable.finalY + 8;

    // Amount in words
    doc.setFontSize(9);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(60);
    doc.text(`Amount in Words: Rupees ${numberToWords(grandTotal)} Only`, margin, finalY);

    // Payment details
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(0);
    doc.text('PAYMENT DETAILS', margin, finalY + 10);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(80);
    doc.text('Bank: SBI  |  A/C: XXXXXX  |  IFSC: SBIN0001234', margin, finalY + 16);

    // Certification
    doc.setFontSize(8);
    doc.setFont('helvetica', 'italic');
    doc.setTextColor(100);
    doc.text(
      'Certified that the above work has been executed as per contract terms.',
      margin,
      finalY + 26,
    );

    // Signatures
    const sigY = finalY + 44;
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(0);
    doc.line(margin, sigY, margin + 60, sigY);
    doc.line(pageW - margin - 60, sigY, pageW - margin, sigY);
    doc.setFontSize(8);
    doc.text('Client Acknowledgement', margin, sigY + 5);
    doc.text('Authorized Signatory', pageW - margin - 60, sigY + 5);
    doc.setTextColor(80);
    doc.text('Briklay Engineering', pageW - margin - 60, sigY + 10);

    doc.save(`${bill.invoice_id}.pdf`);
  };

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) return <LinearProgress />;
  if (!bill) return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6">
      <p className="text-error">Bill not found.</p>
    </div>
  );

  const isConstructionBill = ['progress', 'final', 'advance'].includes(bill.invoice_type);
  const grossN = Number(bill.gross_amount ?? 0);
  const prevN  = Number(bill.previous_bills_amount ?? 0);
  const nbN    = Number(bill.net_bill_amount ?? 0);
  const retRN  = Number(bill.retention_rate ?? 0);
  const retAN  = Number(bill.retention_amount ?? 0);
  const npN    = Number(bill.net_payable_pretax ?? 0);
  const cgstR  = Number(bill.cgst_rate ?? 0);
  const cgstA  = Number(bill.cgst_amount ?? 0);
  const sgstA  = Number(bill.sgst_amount ?? 0);

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-20 max-w-3xl">

      {/* Back */}
      <button
        onClick={() => navigate('/billing')}
        className="flex items-center gap-1.5 text-[13px] text-on-surface-variant/60 hover:text-primary mb-6 transition-colors"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Billing
      </button>

      {/* ── Header card ──────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6 mb-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-data-mono text-[18px] font-bold text-on-surface">{bill.invoice_id}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant uppercase tracking-wide">
                {TYPE_LABEL[bill.invoice_type] ?? bill.invoice_type}
              </span>
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_STYLE[bill.status] ?? STATUS_STYLE.Draft}`}>
                {STATUS_LABEL[bill.status] ?? bill.status}
              </span>
            </div>
            {bill.milestone_name && (
              <p className="text-[14px] text-on-surface-variant mt-1">{bill.milestone_name}</p>
            )}
          </div>

          {/* Actions */}
          <div className="flex gap-2 flex-wrap shrink-0">
            {bill.status === 'Draft' && (
              <button
                onClick={() => updateStatus.mutate('Sent')}
                disabled={updateStatus.isPending}
                className="bk-btn-ghost flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                Mark as Sent
              </button>
            )}
            {!['Paid', 'Void', 'Cancelled'].includes(bill.status) && outstanding > 0 && (
              <button
                onClick={openReceiptModal}
                className="bk-btn flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold"
              >
                <span className="material-symbols-outlined text-[16px]">payments</span>
                Record Receipt
              </button>
            )}
            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl border border-outline-variant/25 text-[13px] text-on-surface-variant hover:border-primary/40 hover:text-primary transition-colors"
              title="Download PDF"
            >
              <span className="material-symbols-outlined text-[16px]">download</span>
              PDF
            </button>
            {!['Void', 'Cancelled'].includes(bill.status) && (
              <button
                onClick={() => { if (confirm('Void this bill?')) updateStatus.mutate('Void'); }}
                className="p-2.5 rounded-xl border border-outline-variant/25 text-on-surface-variant/50 hover:border-error/40 hover:text-error transition-colors"
                title="Void bill"
              >
                <span className="material-symbols-outlined text-[18px]">block</span>
              </button>
            )}
          </div>
        </div>

        {/* Client + Project + Dates */}
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-4 text-[12px]">
          <div>
            <p className="text-on-surface-variant/50 mb-0.5">Client</p>
            <p className="font-semibold text-on-surface">{client?.name ?? '—'}</p>
            {client?.gstin && <p className="font-data-mono text-on-surface-variant/50 text-[10px]">{client.gstin}</p>}
          </div>
          <div>
            <p className="text-on-surface-variant/50 mb-0.5">Project</p>
            <p className="font-semibold text-on-surface">{project?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-on-surface-variant/50 mb-0.5">Bill Date</p>
            <p className="font-semibold text-on-surface">{fmtDate(bill.invoice_date)}</p>
          </div>
          <div>
            <p className="text-on-surface-variant/50 mb-0.5">Due Date</p>
            <p className={`font-semibold ${!bill.due_date ? 'text-on-surface-variant/30' : 'text-on-surface'}`}>
              {bill.due_date ? fmtDate(bill.due_date) : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* ── Abstract of Cost (construction bills) ─────────────────────────────── */}
      {isConstructionBill && (
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden mb-5">
          <div className="px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10">
            <p className="text-[11px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Abstract of Cost</p>
          </div>
          <div className="p-5">
            <table className="w-full text-[13px]">
              <tbody className="divide-y divide-outline-variant/[0.05]">
                <tr>
                  <td className="py-2.5 text-on-surface-variant/70">Gross Value of Work Done</td>
                  <td className="py-2.5 text-right font-data-mono font-semibold text-on-surface">{fmt(grossN)}</td>
                </tr>
                <tr>
                  <td className="py-2.5 text-on-surface-variant/70">Less: Value of Previous Bills</td>
                  <td className="py-2.5 text-right font-data-mono text-on-surface-variant/70">({fmt(prevN)})</td>
                </tr>
                <tr className="bg-primary/[0.03]">
                  <td className="py-2.5 font-bold text-on-surface">Net Value This Bill</td>
                  <td className="py-2.5 text-right font-data-mono font-bold text-on-surface">{fmt(nbN)}</td>
                </tr>
                {retRN > 0 && (
                  <tr>
                    <td className="py-2.5 text-on-surface-variant/70">Less: Retention @ {retRN}%</td>
                    <td className="py-2.5 text-right font-data-mono text-on-surface-variant/70">({fmt(retAN)})</td>
                  </tr>
                )}
                <tr className="bg-secondary/[0.03]">
                  <td className="py-2.5 font-bold text-on-surface">Net Payable (before tax)</td>
                  <td className="py-2.5 text-right font-data-mono font-bold text-on-surface">{fmt(npN)}</td>
                </tr>
                {bill.gst_applicable !== false && (
                  <>
                    <tr>
                      <td className="py-2.5 text-on-surface-variant/70">Add: CGST @ {cgstR}%</td>
                      <td className="py-2.5 text-right font-data-mono text-on-surface">{fmt(cgstA)}</td>
                    </tr>
                    <tr>
                      <td className="py-2.5 text-on-surface-variant/70">Add: SGST @ {cgstR}%</td>
                      <td className="py-2.5 text-right font-data-mono text-on-surface">{fmt(sgstA)}</td>
                    </tr>
                  </>
                )}
                <tr className="border-t-2 border-outline-variant/20">
                  <td className="py-3 text-[15px] font-black text-on-surface">GRAND TOTAL</td>
                  <td className="py-3 text-right font-data-mono text-[16px] font-black text-primary">{fmt(Number(bill.total_amount))}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Line items (legacy / non-construction) ───────────────────────────── */}
      {(bill.line_items?.length > 0) && (
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden mb-5">
          <div className="px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10">
            <p className="text-[11px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Line Items</p>
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="text-[10px] font-bold text-on-surface-variant/40 uppercase tracking-wide border-b border-outline-variant/[0.07]">
                <th className="px-5 py-2.5 text-left">Description</th>
                <th className="px-3 py-2.5 text-center">Qty</th>
                <th className="px-3 py-2.5 text-center">Unit</th>
                <th className="px-3 py-2.5 text-right">Rate</th>
                <th className="px-5 py-2.5 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/[0.06]">
              {bill.line_items.map((li, i) => (
                <tr key={i}>
                  <td className="px-5 py-3 text-on-surface">{li.description}</td>
                  <td className="px-3 py-3 text-center font-data-mono text-on-surface-variant">{li.qty}</td>
                  <td className="px-3 py-3 text-center text-on-surface-variant">{li.unit}</td>
                  <td className="px-3 py-3 text-right font-data-mono">{fmt(li.rate)}</td>
                  <td className="px-5 py-3 text-right font-data-mono font-semibold">{fmt(li.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {/* Totals for legacy */}
          {!isConstructionBill && (
            <div className="border-t border-outline-variant/10 px-5 py-4">
              <div className="max-w-xs ml-auto space-y-2 text-[13px]">
                <div className="flex justify-between text-on-surface-variant/60">
                  <span>Subtotal</span>
                  <span className="font-data-mono">{fmt(Number(bill.subtotal))}</span>
                </div>
                {Number(bill.tax_rate) > 0 && (
                  <div className="flex justify-between text-on-surface-variant/60">
                    <span>GST {bill.tax_rate}%</span>
                    <span className="font-data-mono">{fmt(Number(bill.tax_amount))}</span>
                  </div>
                )}
                <div className="flex justify-between font-bold text-[15px] border-t border-outline-variant/20 pt-2">
                  <span>Total</span>
                  <span className="font-data-mono text-primary">{fmt(Number(bill.total_amount))}</span>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Payment summary (paid amount row) */}
      {Number(bill.paid_amount) > 0 && (
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-5 mb-5">
          <div className="space-y-2 text-[13px] max-w-xs ml-auto">
            <div className="flex justify-between text-secondary">
              <span>Paid</span>
              <span className="font-data-mono font-semibold">{fmt(Number(bill.paid_amount))}</span>
            </div>
            <div className={`flex justify-between font-bold ${outstanding > 0 ? 'text-amber-600' : 'text-secondary'}`}>
              <span>{outstanding > 0 ? 'Outstanding' : 'Fully paid'}</span>
              <span className="font-data-mono">{outstanding > 0 ? fmt(outstanding) : '✓'}</span>
            </div>
          </div>
        </div>
      )}

      {/* Notes */}
      {bill.notes && (
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6 mb-5">
          <p className="text-[11px] font-bold text-on-surface-variant/40 uppercase tracking-wider mb-2">Notes</p>
          <p className="text-[13px] text-on-surface-variant whitespace-pre-wrap">{bill.notes}</p>
        </div>
      )}

      {/* Payment History */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
        <div className="px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10 flex items-center justify-between">
          <p className="text-[11px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Payment History</p>
          {!['Paid', 'Void', 'Cancelled'].includes(bill.status) && outstanding > 0 && (
            <button
              onClick={openReceiptModal}
              className="flex items-center gap-1 text-[12px] text-primary font-semibold hover:underline"
            >
              <span className="material-symbols-outlined text-[15px]">add</span>
              Record Receipt
            </button>
          )}
        </div>
        {(!payments || payments.length === 0) ? (
          <p className="px-6 py-5 text-[13px] text-on-surface-variant/40">No payments recorded yet.</p>
        ) : (
          <div className="divide-y divide-outline-variant/[0.06]">
            {payments.map(p => (
              <div key={p.payment_id} className="px-6 py-4 flex items-center justify-between">
                <div>
                  <p className="text-[13px] font-semibold text-on-surface font-data-mono">{fmt(p.amount)}</p>
                  <p className="text-[11px] text-on-surface-variant/50 mt-0.5">
                    {fmtDate(p.payment_date)}
                    {' · '}{p.payment_mode}
                    {p.reference && ` · ${p.reference}`}
                  </p>
                  {p.notes && <p className="text-[11px] text-on-surface-variant/40 mt-0.5">{p.notes}</p>}
                </div>
                {p.txn_id && (
                  <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-secondary-container/40 text-on-secondary-container font-data-mono">
                    {p.txn_id}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ── Record Receipt Modal ──────────────────────────────────────────────── */}
      {showReceiptModal && (
        <div className="fixed inset-0 z-50 flex items-end md:items-center justify-center bg-black/30 backdrop-blur-sm px-4 pb-safe">
          <div className="bg-white rounded-2xl shadow-elevation-16 w-full max-w-sm p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-[16px] font-bold text-on-surface">Record Receipt</h3>
              <button onClick={() => setShowReceiptModal(false)} className="p-1.5 hover:bg-surface-container rounded-lg transition-colors">
                <span className="material-symbols-outlined text-[20px] text-on-surface-variant">close</span>
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Amount received</label>
                <div className="relative">
                  <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[24px] font-bold text-on-surface-variant/25 font-data-mono select-none">₹</span>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={receiptAmount}
                    onChange={e => setReceiptAmount(e.target.value)}
                    onFocus={e => e.target.select()}
                    autoFocus
                    className="w-full pl-7 pr-2 py-2 text-[28px] font-bold font-data-mono bg-transparent border-b-2 border-outline-variant/30 focus:border-primary outline-none transition-colors placeholder:text-on-surface-variant/20"
                    placeholder="0"
                  />
                </div>
                {outstanding > 0 && (
                  <p className="text-[11px] text-on-surface-variant/40 mt-1">Outstanding: {fmt(outstanding)}</p>
                )}
              </div>
              <div>
                <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Date received</label>
                <input type="date" className="bk-input" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Payment mode</label>
                <div className="flex rounded-xl overflow-hidden border border-outline-variant/25">
                  {PAY_MODES.map((m, i) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setReceiptMode(m)}
                      className={`flex-1 py-2 text-[12px] font-semibold transition-colors ${
                        receiptMode === m ? 'bg-primary text-on-primary' : 'bg-white text-on-surface-variant/60 hover:bg-surface-container-low/60'
                      } ${i > 0 ? 'border-l border-outline-variant/25' : ''}`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Reference <span className="text-on-surface-variant/35">(UTR / cheque no.)</span></label>
                <input type="text" className="bk-input" value={receiptRef} onChange={e => setReceiptRef(e.target.value)} placeholder="Optional" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Notes <span className="text-on-surface-variant/35">(optional)</span></label>
                <input type="text" className="bk-input" value={receiptNotes} onChange={e => setReceiptNotes(e.target.value)} placeholder="Remarks…" />
              </div>

              {getBillingMode() === 'integrated' && (
                <div className="flex items-center gap-2 p-3 bg-secondary-container/20 rounded-xl text-[11px] text-on-secondary-container">
                  <span className="material-symbols-outlined text-[15px] shrink-0">sync</span>
                  Integrated mode — a Transaction entry will also be created in the ledger.
                </div>
              )}

              {recordReceipt.isError && (
                <p className="text-[12px] text-error">{(recordReceipt.error as any)?.message || 'Failed'}</p>
              )}

              <div className="flex gap-2.5 pt-1">
                <button
                  type="button"
                  onClick={() => setShowReceiptModal(false)}
                  className="flex-1 px-4 py-2.5 rounded-xl border border-outline-variant/30 text-[13px] font-medium text-on-surface-variant hover:bg-surface-container transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => recordReceipt.mutate()}
                  disabled={recordReceipt.isPending || !receiptAmount || parseFloat(receiptAmount) <= 0}
                  className="flex-1 bk-btn flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold disabled:opacity-35"
                >
                  {recordReceipt.isPending
                    ? <Loader2 size={14} className="animate-spin" />
                    : <span className="material-symbols-outlined text-[16px]">payments</span>}
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
