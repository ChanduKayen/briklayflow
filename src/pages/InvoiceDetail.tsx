import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { openDoc } from '../lib/storage';
import { useSnackbar } from '../components/Snackbar';
import { useOrgId } from '../lib/auth/AuthProvider';
import { PageSkeleton } from '../components/SkeletonLoader';
import { getBillingMode } from '../lib/billingMode';
import type { Session } from '@supabase/supabase-js';
import type { ClientInvoice, ClientPayment, InvoiceStatus, Stakeholder, Project } from '../types';
import { parseAmount } from '../lib/money';

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<InvoiceStatus, string> = {
  Draft:   'bg-surface-container-highest text-on-surface-variant',
  Sent:    'bg-blue-50 text-blue-700',
  Partial: 'bg-amber-50 text-amber-700',
  Paid:    'bg-secondary-container text-on-secondary-container',
  Overdue: 'bg-error-container text-error',
  Void:      'bg-surface-container text-on-surface-variant/40',
  Cancelled: 'bg-gray-100 text-gray-500',
};

const TYPE_LABEL: Record<string, string> = {
  invoice:     'Tax Invoice',
  proforma:    'Proforma Invoice',
  advance:     'Advance Receipt',
  credit_note: 'Credit Note',
  receipt:     'Receipt',
};

const PAY_MODES = ['NEFT', 'UPI', 'Cheque', 'Cash'] as const;

function fmt(n: number) {
  return `₹${Number(n).toLocaleString('en-IN')}`;
}

function genTxnId() {
  return `TXN-${new Date().getFullYear()}-${String(Date.now()).slice(-6)}`;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function InvoiceDetail({ session: _session }: { session: Session }) {
  const { invoiceId } = useParams<{ invoiceId: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const orgId = useOrgId();

  // ── Record Receipt modal state ────────────────────────────────────────────
  const [showReceiptModal, setShowReceiptModal] = useState(false);
  const [receiptAmount, setReceiptAmount] = useState('');
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().split('T')[0]);
  const [receiptMode, setReceiptMode] = useState<'NEFT' | 'UPI' | 'Cheque' | 'Cash'>('NEFT');
  const [receiptRef, setReceiptRef] = useState('');
  const [receiptNotes, setReceiptNotes] = useState('');

  // ── Queries ───────────────────────────────────────────────────────────────
  const { data: invoice, isLoading } = useQuery({
    queryKey: ['client_invoice', invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_invoices')
        .select('*')
        .eq('invoice_id', invoiceId)
        .single();
      if (error) throw error;
      return data as ClientInvoice;
    },
    enabled: !!invoiceId,
  });

  const { data: payments } = useQuery({
    queryKey: ['client_payments', invoiceId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('client_payments')
        .select('*')
        .eq('invoice_id', invoiceId)
        .order('payment_date', { ascending: false });
      if (error) throw error;
      return data as ClientPayment[];
    },
    enabled: !!invoiceId,
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

  const client = stakeholders?.find(s => s.stakeholder_id === invoice?.client_id);
  const project = projects?.find(p => p.project_id === invoice?.project_id);
  const outstanding = invoice ? Math.max(0, invoice.total_amount - invoice.paid_amount) : 0;

  // ── Status update mutation ────────────────────────────────────────────────
  const updateStatus = useMutation({
    mutationFn: async (status: InvoiceStatus) => {
      const { error } = await supabase
        .from('client_invoices')
        .update({ status })
        .eq('invoice_id', invoiceId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_invoice', invoiceId] });
      qc.invalidateQueries({ queryKey: ['client_invoices'] });
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to update status', { type: 'error' }),
  });

  // ── Record Receipt mutation ───────────────────────────────────────────────
  const recordReceipt = useMutation({
    mutationFn: async () => {
      if (!invoice) throw new Error('Invoice not loaded');
      const amount = parseAmount(receiptAmount);
      if (!amount || amount <= 0) throw new Error('Invalid amount');

      const newPaid = Number(invoice.paid_amount) + amount;
      const newStatus: InvoiceStatus =
        newPaid >= Number(invoice.total_amount) ? 'Paid' : 'Partial';
      const billingMode = getBillingMode();
      const isIntegrated = billingMode === 'integrated' && !!invoice.client_id && !!invoice.project_id;

      const { data, error: rpcError } = await supabase.rpc('record_invoice_receipt', {
        p_invoice_id:    invoiceId,
        p_org_id:        orgId,
        p_amount:        amount,
        p_payment_date:  receiptDate,
        p_payment_mode:  receiptMode,
        p_reference:     receiptRef.trim() || null,
        p_notes:         receiptNotes.trim() || null,
        p_new_paid:      newPaid,
        p_new_status:    newStatus,
        p_is_integrated: isIntegrated,
        p_txn_id:        genTxnId(),
        p_client_id:     invoice.client_id || null,
        p_project_id:    invoice.project_id || null,
        p_remarks:       `Receipt for ${invoiceId}${receiptRef ? ` · Ref: ${receiptRef}` : ''}`,
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to record payment');
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['client_invoice', invoiceId] });
      qc.invalidateQueries({ queryKey: ['client_payments', invoiceId] });
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

  // ── Render ────────────────────────────────────────────────────────────────
  if (isLoading) return <div className="p-4 md:p-8"><PageSkeleton /></div>;
  if (!invoice) return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6">
      <p className="text-error">Invoice not found.</p>
    </div>
  );

  return (
    <div className="px-margin-mobile md:px-margin-desktop pt-6 pb-20 max-w-3xl">

      {/* Back */}
      <button
        onClick={() => navigate('/invoices')}
        className="flex items-center gap-1.5 text-[13px] text-on-surface-variant/60 hover:text-primary mb-6 transition-colors"
      >
        <span className="material-symbols-outlined text-[18px]">arrow_back</span>
        Invoices
      </button>

      {/* Invoice header card */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6 mb-5">
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <span className="font-data-mono text-[18px] font-bold text-on-surface">{invoice.invoice_id}</span>
              <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-surface-container-high text-on-surface-variant uppercase tracking-wide">
                {TYPE_LABEL[invoice.invoice_type] ?? invoice.invoice_type}
              </span>
              <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-full ${STATUS_STYLE[invoice.status]}`}>
                {invoice.status}
              </span>
            </div>
            {invoice.subject && (
              <p className="text-[14px] text-on-surface-variant mt-1">{invoice.subject}</p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex gap-2 flex-wrap shrink-0">
            {invoice.status === 'Draft' && (
              <button
                onClick={() => updateStatus.mutate('Sent')}
                disabled={updateStatus.isPending}
                className="bk-btn-ghost flex items-center gap-1.5 px-4 py-2 rounded-xl text-[13px] border border-outline-variant/30"
              >
                <span className="material-symbols-outlined text-[16px]">send</span>
                Mark as Sent
              </button>
            )}
            {!['Paid', 'Void'].includes(invoice.status) && outstanding > 0 && (
              <button
                onClick={openReceiptModal}
                className="bk-btn flex items-center gap-1.5 px-4 py-2.5 rounded-xl text-[13px] font-semibold"
              >
                <span className="material-symbols-outlined text-[16px]">payments</span>
                Record Receipt
              </button>
            )}
            {invoice.status !== 'Void' && (
              <button
                onClick={() => { if (confirm('Void this invoice?')) updateStatus.mutate('Void'); }}
                className="p-2.5 rounded-xl border border-outline-variant/25 text-on-surface-variant/50 hover:border-error/40 hover:text-error transition-colors"
                title="Void invoice"
              >
                <span className="material-symbols-outlined text-[18px]">block</span>
              </button>
            )}
            {invoice.doc_url && (
              <button
                type="button"
                onClick={() => openDoc(invoice.doc_url)}
                className="p-2.5 rounded-xl border border-outline-variant/25 text-on-surface-variant/50 hover:text-primary transition-colors"
                title="View document"
              >
                <span className="material-symbols-outlined text-[18px]">attach_file</span>
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
            <p className="text-on-surface-variant/50 mb-0.5">Invoice Date</p>
            <p className="font-semibold text-on-surface">
              {new Date(invoice.invoice_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
            </p>
          </div>
          <div>
            <p className="text-on-surface-variant/50 mb-0.5">Due Date</p>
            <p className={`font-semibold ${!invoice.due_date ? 'text-on-surface-variant/30' : 'text-on-surface'}`}>
              {invoice.due_date
                ? new Date(invoice.due_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
                : '—'}
            </p>
          </div>
        </div>
      </div>

      {/* Line items */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden mb-5">
        <div className="px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10">
          <p className="text-[11px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Line Items</p>
        </div>
        {invoice.line_items.length === 0 ? (
          <p className="px-6 py-5 text-[13px] text-on-surface-variant/40">No line items</p>
        ) : (
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
              {invoice.line_items.map((li, i) => (
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
        )}

        {/* Totals */}
        <div className="border-t border-outline-variant/10 px-5 py-4">
          <div className="max-w-xs ml-auto space-y-2 text-[13px]">
            <div className="flex justify-between text-on-surface-variant/60">
              <span>Subtotal</span>
              <span className="font-data-mono">{fmt(invoice.subtotal)}</span>
            </div>
            {invoice.tax_rate > 0 && (
              <div className="flex justify-between text-on-surface-variant/60">
                <span>GST {invoice.tax_rate}%</span>
                <span className="font-data-mono">{fmt(invoice.tax_amount)}</span>
              </div>
            )}
            <div className="flex justify-between font-bold text-[15px] border-t border-outline-variant/20 pt-2">
              <span>Total</span>
              <span className="font-data-mono text-primary">{fmt(invoice.total_amount)}</span>
            </div>
            {invoice.paid_amount > 0 && (
              <>
                <div className="flex justify-between text-secondary text-[12px]">
                  <span>Paid</span>
                  <span className="font-data-mono">{fmt(invoice.paid_amount)}</span>
                </div>
                <div className={`flex justify-between font-bold text-[13px] ${outstanding > 0 ? 'text-amber-600' : 'text-secondary'}`}>
                  <span>{outstanding > 0 ? 'Outstanding' : 'Fully paid'}</span>
                  <span className="font-data-mono">{outstanding > 0 ? fmt(outstanding) : '✓'}</span>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Notes */}
      {invoice.notes && (
        <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm p-6 mb-5">
          <p className="text-[11px] font-bold text-on-surface-variant/40 uppercase tracking-wider mb-2">Notes</p>
          <p className="text-[13px] text-on-surface-variant whitespace-pre-wrap">{invoice.notes}</p>
        </div>
      )}

      {/* Payment history */}
      <div className="bg-white rounded-2xl border border-black/[0.06] shadow-sm overflow-hidden">
        <div className="px-6 py-3 bg-surface-container-low/40 border-b border-outline-variant/10 flex items-center justify-between">
          <p className="text-[11px] font-bold text-on-surface-variant/50 uppercase tracking-wider">Payment History</p>
          {!['Paid', 'Void'].includes(invoice.status) && outstanding > 0 && (
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
                    {new Date(p.payment_date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
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

      {/* ── Record Receipt modal ──────────────────────────────────────────────── */}
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
              {/* Amount */}
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

              {/* Date */}
              <div>
                <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Date received</label>
                <input type="date" className="bk-input" value={receiptDate} onChange={e => setReceiptDate(e.target.value)} />
              </div>

              {/* Payment mode */}
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

              {/* Reference */}
              <div>
                <label className="block text-[11px] font-medium text-on-surface-variant/60 mb-2">Reference <span className="text-on-surface-variant/35">(UTR / cheque no.)</span></label>
                <input type="text" className="bk-input" value={receiptRef} onChange={e => setReceiptRef(e.target.value)} placeholder="Optional" />
              </div>

              {/* Notes */}
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
                <p className="text-[12px] text-error">{(recordReceipt.error as any)?.message || 'Failed to record payment'}</p>
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
