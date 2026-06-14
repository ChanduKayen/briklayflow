import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSignedDocUrl } from '../lib/storage';
import { PeekModal } from './PeekModal';
import { PeekSkeleton, DataField } from './PeekSkeleton';
import { usePeek } from '../context/PeekContext';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

/** Proof image/link — resolves the stored (private-bucket) URL to a signed URL. */
function ProofView({ stored }: { stored: string }) {
  const signed = useSignedDocUrl(stored);
  const isImg = /\.(jpeg|jpg|gif|png|webp)(\?.*)?$/i.test(stored);
  if (!signed) return null;
  return (
    <div>
      <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant mb-2">Proof</p>
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
    queryKey: ['txn_peek', txnId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('*, stakeholders(stakeholder_id, name, type, category)')
        .eq('txn_id', txnId)
        .single();
      if (error) throw error;
      return data as any;
    },
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

  return (
    <PeekModal
      title={txnId}
      subtitle={txn ? `₹${amount.toLocaleString('en-IN')} · ${txn.category || ''}` : undefined}
      fullPageHref={`/ledger/${txnId}`}
      onClose={onClose}
    >
      {isLoading ? (
        <PeekSkeleton />
      ) : !txn ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Transaction not found.</p>
      ) : (
        <div className="flex flex-col gap-5">

          {/* Amount + status + stakeholder */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[28px] font-bold font-data-mono tracking-tight text-on-surface leading-none">
                ₹{amount.toLocaleString('en-IN')}
              </p>
              <button
                onClick={() => txn.stakeholders?.stakeholder_id && openPeek('STAKEHOLDER', txn.stakeholders.stakeholder_id)}
                className="text-[14px] font-medium text-primary hover:underline mt-1 text-left"
              >
                {txn.stakeholders?.name || '—'} ↗
              </button>
              <p className="text-[12px] text-on-surface-variant">{txn.stakeholders?.category}</p>
            </div>
            <span className={`px-2.5 py-1 rounded-full text-[11px] font-bold shrink-0 mt-1 ${
              txn.status === 'Active'  ? 'bg-secondary-container text-on-secondary-container'
              : txn.status === 'Voided' ? 'bg-error-container text-error'
              : 'bg-surface-container-high text-on-surface-variant'
            }`}>{txn.status}</span>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-3">
            <DataField label="Date"     value={fmtDate(txn.date)} />
            <DataField label="Mode"     value={txn.payment_mode} />
            <DataField label="Category" value={txn.category} />
            {txn.ref_number && <DataField label="Reference" value={txn.ref_number} mono />}
          </div>

          {/* Allocations */}
          {allocs && allocs.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant mb-2">Linked To</p>
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
                      ₹{Number(a.allocated_amount).toLocaleString('en-IN')}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Remarks */}
          {txn.remarks && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant mb-1">Remarks</p>
              <p className="text-[13px] text-on-surface whitespace-pre-wrap">{txn.remarks}</p>
            </div>
          )}

          {/* Proof */}
          {(txn.proof_document_url || txn.bill_doc_url) && (
            <ProofView stored={(txn.proof_document_url || txn.bill_doc_url) as string} />
          )}
        </div>
      )}
    </PeekModal>
  );
}
