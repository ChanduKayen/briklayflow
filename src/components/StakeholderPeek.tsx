import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { PeekModal } from './PeekModal';
import { PeekSkeleton } from './PeekSkeleton';
import { usePeek } from '../context/PeekContext';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

interface StakeholderPeekProps { stakeholderId: string; onClose: () => void; }

export function StakeholderPeek({ stakeholderId, onClose }: StakeholderPeekProps) {
  const { openPeek } = usePeek();

  const { data: stk, isLoading } = useQuery({
    queryKey: ['stk_peek', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stakeholders').select('*')
        .eq('stakeholder_id', stakeholderId).single();
      if (error) throw error;
      return data as any;
    },
  });

  const { data: recentTxns } = useQuery({
    queryKey: ['stk_peek_txns', stakeholderId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('transactions')
        .select('txn_id, total_amount, date, category, status, payment_mode, remarks')
        .eq('stakeholder_id', stakeholderId)
        .neq('status', 'Voided')
        .order('date', { ascending: false })
        .limit(6);
      if (error) throw error;
      return data as any[];
    },
    enabled: !!stk,
  });

  const totalPaid = (recentTxns || []).reduce((s: number, t: any) => s + Number(t.total_amount || 0), 0);
  const initial = stk?.name?.charAt(0)?.toUpperCase() || '?';

  return (
    <PeekModal
      title={stk?.name || 'Stakeholder'}
      subtitle={stk ? `${stk.category || ''} · ${stk.type || ''}` : undefined}
      fullPageHref={`/stakeholders/${stakeholderId}`}
      onClose={onClose}
    >
      {isLoading ? (
        <PeekSkeleton />
      ) : !stk ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Stakeholder not found.</p>
      ) : (
        <div className="flex flex-col gap-5">

          {/* Identity */}
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <span className="text-[18px] font-bold text-primary">{initial}</span>
            </div>
            <div>
              <p className="text-[16px] font-semibold text-on-surface">{stk.name}</p>
              <p className="text-[13px] text-on-surface-variant">{stk.category}</p>
              {stk.phone && (
                <a href={`tel:${stk.phone}`} className="text-[12px] text-primary hover:underline">{stk.phone}</a>
              )}
            </div>
          </div>

          <hr className="border-outline-variant/20" />

          {/* Total */}
          <div className="rounded-xl bg-surface-container-low p-4">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant mb-1">
              Total Paid{recentTxns && recentTxns.length === 6 ? ' (recent 6)' : ''}
            </p>
            <p className="text-[22px] font-bold font-data-mono text-on-surface">
              ₹{totalPaid.toLocaleString('en-IN')}
            </p>
          </div>

          {/* Recent transactions */}
          {recentTxns && recentTxns.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-on-surface-variant mb-2">Recent Payments</p>
              <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
                {recentTxns.map((t: any, i: number) => (
                  <button
                    key={t.txn_id}
                    onClick={() => openPeek('TRANSACTION', t.txn_id)}
                    className={`w-full flex items-center justify-between px-3 py-2.5 text-left hover:bg-surface-container-low transition-colors group ${i > 0 ? 'border-t border-outline-variant/10' : ''}`}
                  >
                    <div>
                      <p className="text-[13px] font-medium text-on-surface">
                        {t.payment_mode || t.category || fmtDate(t.date)}
                      </p>
                      <p className="text-[11px] text-on-surface-variant">{fmtDate(t.date)}</p>
                      <p className="text-[10px] font-mono text-on-surface-variant/30 opacity-0 group-hover:opacity-100 transition-opacity">
                        {t.txn_id}
                      </p>
                    </div>
                    <span className="font-data-mono font-semibold text-[13px] text-on-surface">
                      ₹{Number(t.total_amount).toLocaleString('en-IN')}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </PeekModal>
  );
}
