import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PeekModal } from './PeekModal';
import { PeekHeroSkeleton } from './PeekSkeleton';
import type { POLineItem } from '../types';
import { usePeek } from '../context/PeekContext';
import { TxnRow } from './TxnRow';
import { OtherOpenWithParty } from './OtherOpenWithParty';
import {
  WalnutHero, HeroFigure, HeroPill, BurnDown, GroupLabel, SAGE, fmtRupee,
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
  const calcTotal  = (lineItems || []).reduce((s: number, li: POLineItem) => s + Number(li.basic_amount || 0), 0);
  // Prefer total_value, then order_value, then the computed line-item total.
  const grandTotal = Number(po?.total_value) || Number(po?.order_value) || calcTotal;
  const balance    = Math.max(grandTotal - totalPaid, 0);
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

          {/* ── VENDOR & WHERE ── */}
          <div>
            <GroupLabel>Vendor &amp; Where</GroupLabel>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Vendor</p>
                {po.stakeholder_id ? (
                  <button
                    onClick={() => openPeek('STAKEHOLDER', po.stakeholder_id)}
                    className="text-on-surface font-medium text-primary hover:underline text-left"
                  >
                    {po.stakeholders?.name || '—'} ↗
                  </button>
                ) : (
                  <p className="text-on-surface font-medium">{po.stakeholders?.name || '—'}</p>
                )}
                {po.stakeholders?.gstin && <p className="text-on-surface-variant text-[11px] font-data-mono">{po.stakeholders.gstin}</p>}
              </div>
              <div>
                <p className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Project</p>
                <p className="text-on-surface font-medium">{po.projects?.name || '—'}</p>
                {po.projects?.site_location && <p className="text-on-surface-variant text-[11px]">{po.projects.site_location}</p>}
              </div>
              {po.order_date && (
                <div>
                  <p className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Order Date</p>
                  <p className="text-on-surface">{fmtDate(po.order_date)}</p>
                </div>
              )}
              {po.delivery_date && (
                <div>
                  <p className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Delivery Date</p>
                  <p className="text-on-surface">{fmtDate(po.delivery_date)}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── LINE ITEMS ── */}
          {lineItems && lineItems.length > 0 && (
            <div>
              <GroupLabel>Line Items</GroupLabel>
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

          {/* ── LINKED PAYMENTS ── */}
          {linkedTxns && linkedTxns.length > 0 && (
            <div>
              <GroupLabel>Linked Payments</GroupLabel>
              <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
                {linkedTxns.map((a: any) => (
                  <TxnRow
                    key={a.allocation_id}
                    txn={{ ...a.transactions, total_amount: a.allocated_amount }}
                    context="po"
                    onClick={() => a.transactions?.txn_id && openPeek('TRANSACTION', a.transactions.txn_id)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Silent "more here" follow-through: this vendor's OTHER open bills */}
          <OtherOpenWithParty
            kind="PO"
            stakeholderId={po.stakeholder_id}
            currentOrderId={poId}
            partyName={po.stakeholders?.name}
            projectId={po.project_id}
            siteName={po.projects?.name}
          />

          {po.terms_conditions && (
            <div>
              <GroupLabel>Terms</GroupLabel>
              <p className="text-[12px] text-on-surface-variant whitespace-pre-line leading-relaxed">{po.terms_conditions}</p>
            </div>
          )}
        </div>
      )}
    </PeekModal>
  );
}
