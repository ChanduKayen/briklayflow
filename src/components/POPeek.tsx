import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import { PeekModal } from './PeekModal';
import type { POLineItem } from '../types';
import { usePeek } from '../context/PeekContext';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtRupee(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
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

interface POPeekProps {
  poId: string;
  onClose: () => void;
}

export function POPeek({ poId, onClose }: POPeekProps) {
  const { openPeek } = usePeek();
  const { data: po, isLoading } = useQuery({
    queryKey: ['po_peek', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('purchase_orders')
        .select('*, projects(name, site_location), stakeholders(name, category, gstin)')
        .eq('po_id', poId)
        .single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: lineItems } = useQuery({
    queryKey: ['po_line_items_peek', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('po_line_items')
        .select('*')
        .eq('po_id', poId)
        .order('line_number');
      if (error) throw error;
      return data as POLineItem[];
    },
    enabled: !!po,
  });

  const { data: linkedTxns } = useQuery({
    queryKey: ['po_linked_txns_peek', poId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('*, transactions(txn_id, date, total_amount, payment_mode, category, remarks, status)')
        .eq('order_ref', poId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as any[]).filter(a => a.transactions?.status !== 'Voided');
    },
    enabled: !!po,
  });

  const orderValue    = Number(po?.order_value) || 0;
  const totalPaid     = (linkedTxns || []).reduce((s: number, a: any) => s + Number(a.allocated_amount || 0), 0);
  const pctPaid       = orderValue > 0 ? Math.min((totalPaid / orderValue) * 100, 100) : 0;

  const calcTotal = (lineItems || []).reduce(
    (s: number, li: POLineItem) => s + Number(li.basic_amount || 0), 0
  );

  return (
    <PeekModal
      title={poId}
      subtitle={po ? `${po.stakeholders?.name || '—'}  ·  ${po.projects?.name || '—'}` : undefined}
      fullPageHref={`/purchase-orders/${poId}`}
      onClose={onClose}
    >
      {isLoading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-on-surface-variant" />
        </div>
      ) : !po ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Purchase order not found.</p>
      ) : (
        <div className="flex flex-col gap-5">

          {/* Status */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${STATUS_BADGE[po.status] || STATUS_BADGE['Draft']}`}>
              {po.status}
            </span>
            {po.description && (
              <span className="text-[12px] text-on-surface-variant">{po.description}</span>
            )}
          </div>

          {/* Key fields */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Vendor</p>
              <p className="text-on-surface font-medium">{po.stakeholders?.name || '—'}</p>
              {po.stakeholders?.gstin && <p className="text-on-surface-variant text-[11px] font-data-mono">{po.stakeholders.gstin}</p>}
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Project</p>
              <p className="text-on-surface font-medium">{po.projects?.name || '—'}</p>
              {po.projects?.site_location && <p className="text-on-surface-variant text-[11px]">{po.projects.site_location}</p>}
            </div>
            {po.order_date && (
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Order Date</p>
                <p className="text-on-surface">{fmtDate(po.order_date)}</p>
              </div>
            )}
            {po.delivery_date && (
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Delivery Date</p>
                <p className="text-on-surface">{fmtDate(po.delivery_date)}</p>
              </div>
            )}
          </div>

          {/* Financial summary */}
          <div className="rounded-xl bg-surface-container-low p-4">
            <div className="flex justify-between items-baseline mb-2">
              <span className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase">Order Value</span>
              <span className="text-[16px] font-bold font-data-mono text-on-surface">{fmtRupee(orderValue)}</span>
            </div>
            <div className="h-1.5 rounded-full bg-surface-container-highest overflow-hidden mb-2">
              <div
                className="h-full rounded-full bg-secondary transition-all duration-700"
                style={{ width: `${pctPaid}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-on-surface-variant">
              <span>Paid: <span className="font-data-mono text-on-surface font-medium">{fmtRupee(totalPaid)}</span></span>
              <span>Outstanding: <span className="font-data-mono text-on-surface font-medium">{fmtRupee(Math.max(orderValue - totalPaid, 0))}</span></span>
            </div>
          </div>

          {/* Line items */}
          {lineItems && lineItems.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-2">Line Items</p>
              <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
                {lineItems.map((li: POLineItem, i: number) => (
                  <div
                    key={li.id ?? li.line_number}
                    className={`flex items-start justify-between px-3 py-2.5 text-[12px] ${i > 0 ? 'border-t border-outline-variant/10' : ''}`}
                  >
                    <div className="min-w-0 flex-1 pr-4">
                      <p className="text-on-surface">{li.item_name}</p>
                      <p className="text-on-surface-variant text-[10px] mt-0.5">
                        {li.quantity_ordered} {li.unit} × {fmtRupee(Number(li.unit_rate) || 0)}
                      </p>
                    </div>
                    <span className="font-data-mono text-on-surface shrink-0">{fmtRupee(Number(li.basic_amount) || 0)}</span>
                  </div>
                ))}
                {/* Total row */}
                <div className="flex justify-between px-3 py-2.5 border-t border-outline-variant/20 bg-surface-container-low">
                  <span className="text-[11px] font-semibold text-on-surface-variant uppercase tracking-wide">Total</span>
                  <span className="font-data-mono font-bold text-on-surface text-[13px]">{fmtRupee(calcTotal)}</span>
                </div>
              </div>
            </div>
          )}

          {/* Payments */}
          {linkedTxns && linkedTxns.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-2">Payments</p>
              <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
                {linkedTxns.map((a: any, i: number) => {
                  const isCostCode = (s: string) => /^[A-Z]{2,4}-\d{2}(-\d{2})?$/.test(s);
                  const line1 = [po?.stakeholders?.name, po?.stakeholders?.category].filter(Boolean).join(' · ') || 'Payment';
                  const annotation = a.transactions?.remarks?.slice(0, 60) || (!isCostCode(a.transactions?.category || '') ? a.transactions?.category : '') || '';
                  const line2 = [po?.projects?.name, annotation].filter(Boolean).join(' · ');
                  const line3 = [a.transactions?.payment_mode, a.transactions?.date ? new Date(a.transactions.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : ''].filter(Boolean).join(' · ');
                  return (
                    <button
                      key={a.allocation_id}
                      onClick={() => a.transactions?.txn_id && openPeek('TRANSACTION', a.transactions.txn_id)}
                      className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-surface-container-low transition-colors group ${i > 0 ? 'border-t border-outline-variant/10' : ''}`}
                    >
                      <div className="min-w-0 flex-1 pr-3">
                        <p className="text-[13px] font-[500] text-on-surface truncate">{line1}</p>
                        {line2 && <p className="text-[11px] text-on-surface-variant/70 mt-0.5 truncate">{line2}</p>}
                        {line3 && <p className="text-[11px] text-on-surface-variant/40 mt-0.5 truncate">{line3}</p>}
                        <p className="text-[10px] font-mono text-on-surface-variant/25 opacity-0 group-hover:opacity-100 transition-opacity">
                          {a.transactions?.txn_id}
                        </p>
                      </div>
                      <span className="font-data-mono font-semibold text-on-surface shrink-0">{fmtRupee(Number(a.allocated_amount) || 0)}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {po.terms_conditions && (
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-1">Terms</p>
              <p className="text-[12px] text-on-surface-variant whitespace-pre-line leading-relaxed">{po.terms_conditions}</p>
            </div>
          )}
        </div>
      )}
    </PeekModal>
  );
}
