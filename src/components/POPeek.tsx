import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PeekModal } from './PeekModal';
import { PeekDocSkeleton } from './PeekSkeleton';
import type { POLineItem } from '../types';
import { usePeek } from '../context/PeekContextCore';
import { TxnRow } from './TxnRow';
import { OtherOpenWithParty } from './OtherOpenWithParty';
import { fmtRupee, hexA, DocPaper, SERIF, INK, INK_SOFT, PAPER_EDGE, TERRA_INK } from './PeekHero';
import type { ReactNode } from 'react';

const SAGE_INK = '#5E8157';

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function poTone(status: string, isPaid: boolean): { c: string; label: string } {
  if (isPaid) return { c: SAGE_INK, label: 'Paid' };
  if (status === 'Disputed' || status === 'Cancelled') return { c: '#B0473A', label: status };
  if (status === 'Draft' || status === 'Pending Approval') return { c: hexA(INK, 0.5), label: status };
  return { c: TERRA_INK, label: status };
}

function summarizeItems(items: Array<{ item_name?: string | null; description?: string | null }> | null | undefined): string {
  const names = (items ?? [])
    .map((it) => (it?.item_name || it?.description || '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (names.length === 0) return 'Purchase';
  const lead: string[] = [];
  let used = 0;
  for (const n of names) {
    const add = (lead.length ? 2 : 0) + n.length;
    if (lead.length > 0 && used + add > 52) break;
    lead.push(n); used += add;
  }
  const rest = names.length - lead.length;
  return rest > 0 ? `${lead.join(', ')} +${rest} more` : lead.join(', ');
}

// ── small, consistent primitives ──
function Label({ children }: { children: ReactNode }) {
  return <p className="text-[10px] font-semibold uppercase tracking-[0.13em] mb-2.5" style={{ color: hexA(INK, 0.38) }}>{children}</p>;
}
function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pt-6 mt-6" style={{ borderTop: `1px solid ${PAPER_EDGE}` }}>
      <Label>{label}</Label>
      {children}
    </section>
  );
}
function TotalLine({ label, value, bold }: { label: string; value: number; bold?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span className="text-[11.5px]" style={{ color: bold ? INK : INK_SOFT, fontWeight: bold ? 600 : 400 }}>{label}</span>
      <span className={bold ? 'text-[14px] font-semibold' : 'text-[12px]'} style={{ color: INK, fontFamily: bold ? SERIF : undefined, fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(value)}</span>
    </div>
  );
}

// ── Primary query (shared by useQuery + prefetchPo) ──
const poPeekKey = (poId: string) => ['po_peek', poId];
const poPeekFn = async (poId: string) => {
  const { data, error } = await supabase
    .from('purchase_orders')
    .select('*, projects(name, site_location), stakeholders(name, category, gstin)')
    .eq('po_id', poId)
    .single();
  if (error) throw error;
  return data as any;
};

/** Warm the PO peek's primary query so the click paints instantly. */
export function prefetchPo(qc: QueryClient, poId: string) {
  if (!poId) return;
  void qc.prefetchQuery({ queryKey: poPeekKey(poId), queryFn: () => poPeekFn(poId) });
}

interface POPeekProps { poId: string; onClose: () => void; }

export function POPeek({ poId, onClose }: POPeekProps) {
  const { openPeek } = usePeek();
  const { data: po, isLoading } = useQuery({ queryKey: poPeekKey(poId), queryFn: () => poPeekFn(poId) });

  const { data: lineItems } = useQuery({
    queryKey: ['po_line_items_peek', poId],
    queryFn: async () => {
      const { data, error } = await supabase.from('po_line_items').select('*').eq('po_id', poId).order('line_number');
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
        .eq('order_ref', poId).order('created_at', { ascending: false });
      if (error) throw error;
      return (data as any[]).filter(a => a.transactions?.status !== 'Voided');
    },
    enabled: !!po,
  });

  const totalPaid  = (linkedTxns || []).reduce((s: number, a: any) => s + Number(a.allocated_amount || 0), 0);
  const items      = lineItems || [];
  const subtotal   = items.reduce((s: number, li: POLineItem) => s + Number(li.basic_amount || 0), 0);
  const discount   = items.reduce((s: number, li: POLineItem) => s + Number(li.discount_amount || 0), 0);
  const gstTotal   = items.reduce((s: number, li: POLineItem) => s + Number(li.cgst || 0) + Number(li.sgst || 0) + Number(li.igst || 0), 0);
  const hasGst     = gstTotal > 0;
  const grandTotal = Number(po?.total_value) || Number(po?.order_value) || (subtotal - discount + gstTotal);
  const balance    = Math.max(grandTotal - totalPaid, 0);
  const isPaid     = balance <= 0 && grandTotal > 0;
  const pct        = grandTotal > 0 ? Math.min(100, Math.round((totalPaid / grandTotal) * 100)) : 0;
  const accent     = isPaid ? SAGE_INK : TERRA_INK;
  const tone       = po ? poTone(po.status, isPaid) : { c: TERRA_INK, label: '' };
  const heroItems  = summarizeItems(items);

  return (
    <PeekModal
      title={poId}
      subtitle={po ? `${po.stakeholders?.name || '—'}  ·  ${po.projects?.name || '—'}` : undefined}
      fullPageHref={`/purchase-orders/${poId}`}
      onClose={onClose}
    >
      {isLoading ? (
        <PeekDocSkeleton />
      ) : !po ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Purchase order not found.</p>
      ) : (
        <DocPaper accent={accent}>

          {/* ── MASTHEAD — identity, then the one focal figure ── */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: hexA(INK, 0.42) }}>Bill</span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: tone.c }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.c }} />{tone.label}
            </span>
          </div>

          <h2 style={{ fontFamily: SERIF, color: INK, fontSize: 'clamp(1.05rem, 0.9rem + 0.9vw, 1.25rem)', lineHeight: 1.25, letterSpacing: '-0.01em' }}>
            {heroItems}
          </h2>
          <p className="mt-1 text-[11.5px]" style={{ color: INK_SOFT }}>
            {po.stakeholder_id ? (
              <button onClick={() => openPeek('STAKEHOLDER', po.stakeholder_id)} className="font-medium hover:underline" style={{ color: INK_SOFT }}>
                {po.stakeholders?.name || '—'}
              </button>
            ) : <span className="font-medium">{po.stakeholders?.name || '—'}</span>}
            <span className="mx-1.5" style={{ color: hexA(INK, 0.22) }}>·</span>{po.projects?.name || '—'}
            {po.order_date && <><span className="mx-1.5" style={{ color: hexA(INK, 0.22) }}>·</span>{fmtDate(po.order_date)}</>}
          </p>
          {po.stakeholders?.gstin && (
            <p className="mt-0.5 text-[10.5px] font-data-mono" style={{ color: hexA(INK, 0.4) }}>GSTIN {po.stakeholders.gstin}</p>
          )}

          {/* the figure — biggest thing on the card */}
          <div className="mt-6">
            <p style={{ fontFamily: SERIF, color: INK, fontSize: 'clamp(2.1rem, 1.5rem + 2.6vw, 2.7rem)', lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: accent, fontSize: '0.46em', fontWeight: 600, marginRight: '0.08em' }}>₹</span>{balance.toLocaleString('en-IN')}
            </p>
            <p className="mt-2 text-[11.5px]" style={{ color: INK_SOFT }}>
              {isPaid ? 'paid in full' : <>balance due<span className="mx-1.5" style={{ color: hexA(INK, 0.22) }}>·</span><span style={{ color: tone.c, fontWeight: 600 }}>{pct}% paid</span></>}
            </p>
            <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: hexA(INK, 0.08) }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: accent }} />
            </div>
            {totalPaid > 0 && (
              <p className="mt-2 text-[11px]" style={{ color: hexA(INK, 0.45), fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(totalPaid)} received</p>
            )}
          </div>

          {/* ── Items ── */}
          <Section label="Items">
            {items.length > 0 ? (
              <>
                <div className="grid items-baseline gap-2 pb-1.5 text-[9.5px] font-semibold uppercase tracking-wider" style={{ gridTemplateColumns: '16px 1fr auto auto', color: hexA(INK, 0.4), borderBottom: `1px solid ${hexA(INK, 0.16)}` }}>
                  <span>#</span><span>Item</span><span className="text-right pr-4">Qty · Rate</span><span className="text-right">Amount</span>
                </div>
                {items.map((li: POLineItem, i: number) => (
                  <div key={li.id ?? li.line_number} className="grid items-baseline gap-2 py-2 text-[12px]" style={{ gridTemplateColumns: '16px 1fr auto auto', borderTop: i > 0 ? `1px solid ${hexA(INK, 0.06)}` : undefined }}>
                    <span className="text-[11px]" style={{ color: hexA(INK, 0.35), fontVariantNumeric: 'tabular-nums' }}>{li.line_number || i + 1}</span>
                    <span className="truncate" style={{ color: INK }}>{li.item_name || li.specification || '—'}</span>
                    <span className="text-right pr-4 text-[10.5px] whitespace-nowrap" style={{ color: INK_SOFT, fontVariantNumeric: 'tabular-nums' }}>
                      {Number(li.quantity_ordered) || 0} {li.unit} · {fmtRupee(Number(li.unit_rate) || 0)}
                    </span>
                    <span className="text-right whitespace-nowrap" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(Number(li.basic_amount) || 0)}</span>
                  </div>
                ))}
                <div className="mt-3 flex justify-end">
                  <div className="w-full max-w-[240px]">
                    <TotalLine label="Subtotal" value={subtotal} />
                    {discount > 0 && <TotalLine label="Discount" value={-discount} />}
                    {hasGst && <TotalLine label="GST" value={gstTotal} />}
                    <div className="mt-1.5 pt-1.5" style={{ borderTop: `1px solid ${hexA(INK, 0.18)}` }}>
                      <TotalLine label="Total" value={grandTotal} bold />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-[12px]" style={{ color: INK_SOFT, fontFamily: SERIF }}>No itemised lines on this bill.</p>
            )}
          </Section>

          {/* ── Payments ── */}
          {linkedTxns && linkedTxns.length > 0 && (
            <Section label="Payments">
              <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${hexA(INK, 0.07)}`, background: 'rgba(255,255,255,.45)' }}>
                {linkedTxns.map((a: any) => (
                  <TxnRow key={a.allocation_id} txn={{ ...a.transactions, total_amount: a.allocated_amount }} context="po" onClick={() => a.transactions?.txn_id && openPeek('TRANSACTION', a.transactions.txn_id)} />
                ))}
              </div>
            </Section>
          )}

          {/* ── This vendor's other open bills (renders nothing when none) ── */}
          <div className="mt-6 empty:mt-0">
            <OtherOpenWithParty kind="PO" stakeholderId={po.stakeholder_id} currentOrderId={poId} partyName={po.stakeholders?.name} projectId={po.project_id} siteName={po.projects?.name} />
          </div>

          {/* ── Terms ── */}
          {po.terms_conditions && (
            <Section label="Terms">
              <p className="whitespace-pre-line" style={{ color: INK_SOFT, fontSize: 12, lineHeight: 1.65 }}>{po.terms_conditions}</p>
            </Section>
          )}
        </DocPaper>
      )}
    </PeekModal>
  );
}
