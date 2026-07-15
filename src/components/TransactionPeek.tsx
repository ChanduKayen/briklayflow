import { useQuery, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSignedDocUrl } from '../lib/storage';
import { PeekModal } from './PeekModal';
import { PeekHeroSkeleton } from './PeekSkeleton';
import { usePeek } from '../context/PeekContextCore';
import {
  WalnutHero, HeroFigure, DirectionEyebrow, HeroPill, GroupLabel,
  TERRA, SAGE, fmtRupee,
} from './PeekHero';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ── Primary query (kept DRY: the component's useQuery and prefetchTxn share these) ──
const txnPeekKey = (txnId: string) => ['txn_peek', txnId];
const txnPeekFn = async (txnId: string) => {
  const { data, error } = await supabase
    .from('transactions')
    .select('*, stakeholders(stakeholder_id, name, type, category)')
    .eq('txn_id', txnId)
    .single();
  if (error) throw error;
  return data as any;
};

/** Warm the transaction peek's primary query so the click paints instantly. */
export function prefetchTxn(qc: QueryClient, txnId: string) {
  if (!txnId) return;
  void qc.prefetchQuery({ queryKey: txnPeekKey(txnId), queryFn: () => txnPeekFn(txnId) });
}

/** Proof image/link — resolves the stored (private-bucket) URL to a signed URL. */
function ProofView({ stored }: { stored: string }) {
  const signed = useSignedDocUrl(stored);
  const isImg = /\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i.test(stored);
  if (!signed) return null;
  return (
    <div>
      <GroupLabel>Proof</GroupLabel>
      {isImg
        ? <img src={signed} alt="proof" className="h-24 rounded-xl object-cover cursor-pointer" onClick={() => window.open(signed, '_blank')} />
        : <a href={signed} target="_blank" rel="noopener noreferrer" className="text-[13px] text-primary hover:underline flex items-center gap-1">
            <span className="material-symbols-outlined text-[14px]">open_in_new</span> View Document
          </a>}
    </div>
  );
}

interface TransactionPeekProps { txnId: string; onClose: () => void; }

export function TransactionPeek({ txnId, onClose }: TransactionPeekProps) {
  const { openPeek } = usePeek();

  const { data: txn, isLoading } = useQuery({
    queryKey: txnPeekKey(txnId),
    queryFn: () => txnPeekFn(txnId),
  });

  const { data: allocs } = useQuery({
    queryKey: ['txn_peek_allocs', txnId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('*, projects(name)')
        .eq('txn_id', txnId);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!txn,
  });

  const amount = txn ? Number(txn.total_amount) : 0;
  const isIn = txn?.stakeholders?.type === 'Client';
  const accent = isIn ? SAGE : TERRA;
  const statusTone = txn?.status === 'Active' ? 'active' : txn?.status === 'Voided' ? 'error' : 'neutral';

  return (
    <PeekModal
      title={txnId}
      subtitle={txn ? `${fmtRupee(amount)} · ${txn.category || ''}` : undefined}
      fullPageHref={`/ledger/${txnId}`}
      onClose={onClose}
    >
      {isLoading ? (
        <PeekHeroSkeleton />
      ) : !txn ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Transaction not found.</p>
      ) : (
        <div className="flex flex-col gap-5">

          {/* ── HERO: walnut amount card ── */}
          <WalnutHero
            variant={isIn ? 'sage' : 'terra'}
            topLeft={
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: accent }}>Transaction Voucher</p>
                <p className="font-mono text-[11px] tracking-wide" style={{ color: 'rgba(243,234,219,.52)' }}>{txn.txn_id}</p>
              </>
            }
            topRight={<HeroPill label={txn.status || '—'} tone={statusTone} />}
            eyebrow={<DirectionEyebrow isIn={isIn} accent={accent} />}
          >
            <HeroFigure prefix={isIn ? '+ ₹' : '− ₹'} value={Math.abs(amount).toLocaleString('en-IN')} accent={accent} />
          </WalnutHero>

          {/* ── WHO & WHERE ── */}
          <div>
            <GroupLabel>Who &amp; Where</GroupLabel>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {txn.stakeholders?.stakeholder_id ? (
                  <button
                    onClick={() => openPeek('STAKEHOLDER', txn.stakeholders.stakeholder_id)}
                    className="text-[15px] font-semibold text-primary hover:underline text-left"
                  >
                    {txn.stakeholders?.name || '—'} ↗
                  </button>
                ) : (
                  <p className="text-[15px] font-semibold text-on-surface">{txn.stakeholders?.name || '—'}</p>
                )}
                {txn.stakeholders?.category && <p className="text-[12px] text-on-surface-variant mt-0.5">{txn.stakeholders.category}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 mt-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant mb-0.5">Date</p>
                <p className="text-[13px] text-on-surface">{fmtDate(txn.date)}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant mb-0.5">Mode</p>
                <p className="text-[13px] text-on-surface">{txn.payment_mode || '—'}</p>
              </div>
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant mb-0.5">Category</p>
                <p className="text-[13px] text-on-surface">{txn.category || '—'}</p>
              </div>
              {txn.ref_number && (
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wider text-on-surface-variant mb-0.5">Reference</p>
                  <p className="text-[13px] text-on-surface font-data-mono">{txn.ref_number}</p>
                </div>
              )}
            </div>
          </div>

          {/* ── WHERE IT WENT (allocations) ── */}
          {allocs && allocs.length > 0 && (
            <div>
              <GroupLabel>Where It Went</GroupLabel>
              <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
                {allocs.map((a: any, i: number) => (
                  <div key={a.allocation_id}
                    className={`flex items-center justify-between px-3 py-2.5 ${i > 0 ? 'border-t border-outline-variant/10' : ''}`}>
                    <div>
                      <p className="text-[13px] font-medium text-on-surface">{a.projects?.name || a.project_id}</p>
                      {a.order_type && a.order_ref ? (
                        <button
                          onClick={() => openPeek(a.order_type as 'WO' | 'PO', a.order_ref)}
                          className="text-[11px] font-data-mono text-primary hover:underline"
                        >
                          {a.order_type} · {a.order_ref} ↗
                        </button>
                      ) : <span className="text-[11px] text-tertiary italic">Unlinked</span>}
                    </div>
                    <span className="font-data-mono font-semibold text-[12px] text-on-surface">
                      {fmtRupee(Number(a.allocated_amount))}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── REMARKS ── */}
          {txn.remarks && (
            <div>
              <GroupLabel>Remarks</GroupLabel>
              <p className="text-[13px] text-on-surface whitespace-pre-wrap">{txn.remarks}</p>
            </div>
          )}

          {/* ── PROOF ── */}
          {(txn.proof_document_url || txn.bill_doc_url) && (
            <ProofView stored={(txn.proof_document_url || txn.bill_doc_url) as string} />
          )}
        </div>
      )}
    </PeekModal>
  );
}
