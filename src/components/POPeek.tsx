import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PeekModal } from './PeekModal';
import { PeekHeroSkeleton } from './PeekSkeleton';
import type { POLineItem } from '../types';
import { usePeek } from '../context/PeekContext';
import { TxnRow } from './TxnRow';
import { OtherOpenWithParty } from './OtherOpenWithParty';
import {
  WalnutHero, HeroFigure, HeroPill, BurnDown, SAGE, TERRA, fmtRupee,
  DocPaper, DocMarker, Watermark, SERIF, INK, INK_SOFT,
} from './PeekHero';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Map a PO status to the dark-hero pill tone.
function poPillTone(status: string): 'active' | 'error' | 'neutral' {
  if (status === 'Disputed' || status === 'Cancelled') return 'error';
  if (status === 'Draft' || status === 'Pending Approval') return 'neutral';
  return 'active';
}

// Name the leading line item(s) that fit in ~52 chars as a human eyebrow.
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
    lead.push(n);
    used += add;
  }
  const rest = names.length - lead.length;
  return rest > 0 ? `${lead.join(', ')} +${rest} other${rest === 1 ? '' : 's'}` : lead.join(', ');
}

/** One right-aligned line in the invoice totals stack. */
function TotalLine({
  label, value, ink, sub, bold,
}: {
  label: string; value: number; ink: string; sub: string; bold?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span
        className={`text-[11px] ${bold ? 'font-bold uppercase tracking-wider' : ''}`}
        style={{ color: bold ? ink : sub, fontFamily: SERIF }}
      >
        {label}
      </span>
      <span
        className="tabular-nums"
        style={{ fontFamily: SERIF, color: ink, fontVariantNumeric: 'tabular-nums', fontWeight: bold ? 700 : 500, fontSize: bold ? 14 : 12.5 }}
      >
        {value < 0 ? '−' : ''}{fmtRupee(Math.abs(value))}
      </span>
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

interface POPeekProps {
  poId: string;
  onClose: () => void;
}

export function POPeek({ poId, onClose }: POPeekProps) {
  const { openPeek } = usePeek();
  const { data: po, isLoading } = useQuery({
    queryKey: poPeekKey(poId),
    queryFn: () => poPeekFn(poId),
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

  const totalPaid  = (linkedTxns || []).reduce((s: number, a: any) => s + Number(a.allocated_amount || 0), 0);
  const items      = lineItems || [];
  const subtotal   = items.reduce((s: number, li: POLineItem) => s + Number(li.basic_amount || 0), 0);
  const discount   = items.reduce((s: number, li: POLineItem) => s + Number(li.discount_amount || 0), 0);
  // Sum any GST present on the line items (cgst/sgst/igst columns).
  const gstTotal   = items.reduce(
    (s: number, li: POLineItem) => s + Number(li.cgst || 0) + Number(li.sgst || 0) + Number(li.igst || 0),
    0,
  );
  const hasGst     = gstTotal > 0;
  // Prefer total_value, then order_value, then the computed (subtotal − disc + gst).
  const grandTotal = Number(po?.total_value) || Number(po?.order_value) || (subtotal - discount + gstTotal);
  const balance    = Math.max(grandTotal - totalPaid, 0);
  const isPaid     = balance <= 0 && grandTotal > 0;
  const heroTitle  = summarizeItems(lineItems);

  return (
    <PeekModal
      title={poId}
      subtitle={po ? `${po.stakeholders?.name || '—'}  ·  ${po.projects?.name || '—'}` : undefined}
      fullPageHref={`/purchase-orders/${poId}`}
      onClose={onClose}
    >
      {isLoading ? (
        <PeekHeroSkeleton />
      ) : !po ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Purchase order not found.</p>
      ) : (
        <div className="flex flex-col gap-5">

          {/* ── HERO: bill burn-down ── */}
          <WalnutHero
            variant="sage"
            topLeft={
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: SAGE }}>Purchase Bill</p>
                <p className="text-[13px] leading-snug" style={{ color: '#F3EADB' }}>{heroTitle}</p>
              </>
            }
            topRight={<HeroPill label={po.status} tone={poPillTone(po.status)} />}
            eyebrow={
              <span className="inline-flex items-center gap-1.5" style={{ color: SAGE, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em' }}>
                <span className="material-symbols-outlined text-[13px]">savings</span>
                BALANCE DUE
              </span>
            }
          >
            <HeroFigure prefix="₹" value={balance.toLocaleString('en-IN')} accent={SAGE} />
            <BurnDown total={grandTotal} paid={totalPaid} accent={SAGE} totalKnown={grandTotal > 0} />
          </WalnutHero>

          {/* ── TAX INVOICE PAPER — perforated top edge, cream surface ── */}
          <DocPaper
            accent={isPaid ? SAGE : TERRA}
            topEdge="perforated"
            watermark={<Watermark text={isPaid ? 'PAID' : 'DUE'} accent={isPaid ? SAGE : TERRA} variant="stamp" />}
          >
            <div className="flex flex-col gap-7">

              {/* Invoice header — no. + date */}
              <div className="flex items-baseline justify-between gap-3">
                <span style={{ fontFamily: SERIF, color: INK }} className="text-[12px] font-bold uppercase tracking-[0.18em]">Tax Invoice</span>
                <span className="text-[11px]" style={{ color: INK_SOFT, fontFamily: SERIF }}>
                  <span style={{ fontVariantNumeric: 'tabular-nums' }}>{poId}</span>
                  {po.order_date && <> · {fmtDate(po.order_date)}</>}
                </span>
              </div>

              {/* BILLED BY / FOR */}
              <section className="grid grid-cols-2 gap-x-6">
                <div>
                  <DocMarker label="Billed by" accent={isPaid ? SAGE : TERRA} />
                  {po.stakeholder_id ? (
                    <button
                      onClick={() => openPeek('STAKEHOLDER', po.stakeholder_id)}
                      className="font-semibold hover:underline text-left"
                      style={{ color: INK, fontFamily: SERIF, fontSize: 14 }}
                    >
                      {po.stakeholders?.name || '—'} ↗
                    </button>
                  ) : (
                    <p className="font-semibold" style={{ color: INK, fontFamily: SERIF, fontSize: 14 }}>{po.stakeholders?.name || '—'}</p>
                  )}
                  {po.stakeholders?.gstin && (
                    <p className="text-[10.5px] mt-0.5 font-data-mono" style={{ color: INK_SOFT }}>GSTIN {po.stakeholders.gstin}</p>
                  )}
                </div>
                <div>
                  <DocMarker label="Billed for" accent={isPaid ? SAGE : TERRA} />
                  <p className="font-semibold" style={{ color: INK, fontFamily: SERIF, fontSize: 14 }}>{po.projects?.name || '—'}</p>
                  {po.projects?.site_location && <p className="text-[10.5px] mt-0.5" style={{ color: INK_SOFT }}>{po.projects.site_location}</p>}
                  {po.delivery_date && (
                    <p className="text-[10.5px] mt-0.5" style={{ color: INK_SOFT }}>Delivery {fmtDate(po.delivery_date)}</p>
                  )}
                </div>
              </section>

              {/* LINE ITEMS — invoice table + totals stack */}
              <section>
                <DocMarker label="Line Items" accent={isPaid ? SAGE : TERRA} />
                {items.length > 0 ? (
                  <>
                    {/* column header */}
                    <div
                      className="grid items-baseline gap-2 pb-1.5 text-[9.5px] font-semibold uppercase tracking-wider"
                      style={{ gridTemplateColumns: '18px 1fr auto auto', color: INK_SOFT, borderBottom: '1.5px solid rgba(0,0,0,.18)' }}
                    >
                      <span>#</span>
                      <span>Item</span>
                      <span className="text-right pr-4">Qty · Rate</span>
                      <span className="text-right">Amount</span>
                    </div>
                    {items.map((li: POLineItem, i: number) => (
                      <div
                        key={li.id ?? li.line_number}
                        className="grid items-baseline gap-2 py-2 text-[12px]"
                        style={{ gridTemplateColumns: '18px 1fr auto auto', borderTop: i > 0 ? '1px solid rgba(0,0,0,.07)' : undefined }}
                      >
                        <span style={{ color: INK_SOFT, fontVariantNumeric: 'tabular-nums' }} className="text-[11px]">{li.line_number || i + 1}</span>
                        <span style={{ color: INK }} className="truncate">{li.item_name || li.specification || '—'}</span>
                        <span className="text-right pr-4 text-[10.5px] tabular-nums whitespace-nowrap" style={{ color: INK_SOFT, fontVariantNumeric: 'tabular-nums' }}>
                          {Number(li.quantity_ordered) || 0} {li.unit} · {fmtRupee(Number(li.unit_rate) || 0)}
                        </span>
                        <span className="text-right tabular-nums whitespace-nowrap" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(Number(li.basic_amount) || 0)}</span>
                      </div>
                    ))}

                    {/* TOTALS STACK — right-aligned under a double rule */}
                    <div className="mt-3 flex justify-end">
                      <div className="w-full max-w-[260px]">
                        <TotalLine label="Subtotal" value={subtotal} ink={INK} sub={INK_SOFT} />
                        {discount > 0 && <TotalLine label="Discount" value={-discount} ink={INK} sub={INK_SOFT} />}
                        {hasGst && <TotalLine label="GST / Tax" value={gstTotal} ink={INK} sub={INK_SOFT} />}
                        <div style={{ borderTop: `3px double ${INK_SOFT}` }} className="mt-1.5 pt-1.5">
                          <TotalLine label="Total" value={grandTotal} ink={INK} sub={INK_SOFT} bold />
                        </div>
                        <TotalLine label="Paid" value={totalPaid} ink={INK} sub={INK_SOFT} />
                        <div className="mt-1 pt-1.5" style={{ borderTop: '1px solid rgba(0,0,0,.1)' }}>
                          <div className="flex items-baseline justify-between">
                            <span className="text-[11px] font-bold uppercase tracking-wider" style={{ color: isPaid ? '#5C7A52' : '#A85A3C' }}>Balance Due</span>
                            <span className="text-[15px] font-bold tabular-nums" style={{ fontFamily: SERIF, color: isPaid ? '#5C7A52' : '#A85A3C', fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(balance)}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </>
                ) : (
                  <p className="text-[12px]" style={{ color: INK_SOFT, fontFamily: SERIF }}>No itemised lines on this bill.</p>
                )}
              </section>

              {/* PAYMENT HISTORY */}
              {linkedTxns && linkedTxns.length > 0 && (
                <section>
                  <DocMarker label="Payment History" accent={isPaid ? SAGE : TERRA} />
                  <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(0,0,0,.07)', background: 'rgba(255,255,255,.5)' }}>
                    {linkedTxns.map((a: any) => (
                      <TxnRow
                        key={a.allocation_id}
                        txn={{ ...a.transactions, total_amount: a.allocated_amount }}
                        context="po"
                        onClick={() => a.transactions?.txn_id && openPeek('TRANSACTION', a.transactions.txn_id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* this vendor's OTHER open bills */}
              <OtherOpenWithParty
                kind="PO"
                stakeholderId={po.stakeholder_id}
                currentOrderId={poId}
                partyName={po.stakeholders?.name}
                projectId={po.project_id}
                siteName={po.projects?.name}
              />

              {po.terms_conditions && (
                <section>
                  <DocMarker label="Terms & Conditions" accent={isPaid ? SAGE : TERRA} />
                  <p className="whitespace-pre-line" style={{ fontFamily: SERIF, color: INK_SOFT, fontSize: 12.5, lineHeight: 1.7 }}>
                    {po.terms_conditions}
                  </p>
                </section>
              )}
            </div>
          </DocPaper>
        </div>
      )}
    </PeekModal>
  );
}
