import { useQuery } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import { PeekModal } from './PeekModal';
import { statusBadgeClass } from '../pages/WorkOrderDetail';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtRupee(n: number) {
  return '₹' + n.toLocaleString('en-IN', { maximumFractionDigits: 0 });
}

const MS_BADGE: Record<string, string> = {
  PAID:           'bg-green-100 text-green-800',
  OVERPAID:       'bg-purple-100 text-purple-800',
  PARTIALLY_PAID: 'bg-amber-100 text-amber-800',
  DUE:            'bg-red-100 text-red-800',
  PENDING:        'bg-surface-container-high text-on-surface-variant',
};

function getMilestoneStatus(milestone: any, paid: number): string {
  const planned = Number(milestone.planned_amount) || 0;
  if (planned > 0 && paid > planned + 100) return 'OVERPAID';
  if (planned > 0 && paid >= planned - 100) return 'PAID';
  if (paid > 0) return 'PARTIALLY_PAID';
  const d = milestone.trigger_condition ? new Date(milestone.trigger_condition) : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d && !isNaN(d.getTime()) && d < today) return 'DUE';
  return 'PENDING';
}

interface WOPeekProps {
  woId: string;
  onClose: () => void;
}

export function WOPeek({ woId, onClose }: WOPeekProps) {
  const { data: wo, isLoading: loadingWo } = useQuery({
    queryKey: ['wo_peek', woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('work_orders')
        .select('*, projects(name, site_location), stakeholders(name, category)')
        .eq('wo_id', woId)
        .single();
      if (error) throw error;
      return data;
    },
  });

  const { data: milestones } = useQuery({
    queryKey: ['wo_milestones_peek', woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wo_milestones')
        .select('*')
        .eq('wo_id', woId)
        .order('seq_no', { ascending: true });
      if (error) throw error;
      return data;
    },
    enabled: !!wo,
  });

  const { data: allocations } = useQuery({
    queryKey: ['wo_allocations_peek', woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('txn_allocations')
        .select('*, transactions(txn_id, date, total_amount, payment_mode, category, status)')
        .eq('order_type', 'WO')
        .eq('order_ref', woId);
      if (error) throw error;
      return data.filter((a: any) => a.transactions?.status !== 'Voided');
    },
    enabled: !!wo,
  });

  const orderValue  = Number(wo?.order_value) || 0;
  const msTotal     = (milestones || []).reduce((s: number, m: any) => s + (Number(m.planned_amount) || 0), 0);
  const totalPaid   = (allocations || []).reduce((s: number, a: any) => s + Number(a.allocated_amount || 0), 0);
  // Derive a display total even when order_value is not set on the WO
  const displayTotal  = orderValue > 0 ? orderValue : msTotal > 0 ? msTotal : totalPaid;
  const orderValueSet = orderValue > 0;
  const pctPaid       = displayTotal > 0 ? Math.min((totalPaid / displayTotal) * 100, 100) : 100;

  // Paid per milestone
  const paidByMilestone: Record<string, number> = {};
  (allocations || []).forEach((a: any) => {
    if (a.milestone_id) {
      paidByMilestone[a.milestone_id] = (paidByMilestone[a.milestone_id] || 0) + Number(a.allocated_amount || 0);
    }
  });

  return (
    <PeekModal
      title={woId}
      subtitle={wo ? `${wo.stakeholders?.name || '—'}  ·  ${wo.projects?.name || '—'}` : undefined}
      fullPageHref={`/work-orders/${woId}`}
      onClose={onClose}
    >
      {loadingWo ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 size={24} className="animate-spin text-on-surface-variant" />
        </div>
      ) : !wo ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Work order not found.</p>
      ) : (
        <div className="flex flex-col gap-5">

          {/* Identity row */}
          <div className="flex flex-wrap items-center gap-2">
            <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold ${statusBadgeClass(wo.status)}`}>
              {wo.status}
            </span>
            {wo.scope_of_work && (
              <span className="text-[12px] text-on-surface-variant">{wo.scope_of_work}</span>
            )}
          </div>

          {/* Key fields */}
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-[13px]">
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Contractor</p>
              <p className="text-on-surface font-medium">{wo.stakeholders?.name || '—'}</p>
              <p className="text-on-surface-variant text-[11px]">{wo.stakeholders?.category || ''}</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Project</p>
              <p className="text-on-surface font-medium">{wo.projects?.name || '—'}</p>
              {wo.projects?.site_location && <p className="text-on-surface-variant text-[11px]">{wo.projects.site_location}</p>}
            </div>
            {wo.start_date && (
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">Start Date</p>
                <p className="text-on-surface">{fmtDate(wo.start_date)}</p>
              </div>
            )}
            {wo.end_date && (
              <div>
                <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-0.5">End Date</p>
                <p className="text-on-surface">{fmtDate(wo.end_date)}</p>
              </div>
            )}
          </div>

          {/* Financial summary */}
          <div className="rounded-xl bg-surface-container-low p-4">
            <div className="flex justify-between items-baseline mb-1">
              <span className="text-[11px] font-semibold tracking-wider text-on-surface-variant uppercase">Order Value</span>
              {orderValueSet
                ? <span className="text-[16px] font-bold font-data-mono text-on-surface">{fmtRupee(orderValue)}</span>
                : <span className="text-[13px] font-medium text-on-surface-variant">—</span>
              }
            </div>
            {!orderValueSet && (
              <p className="text-[10px] text-amber-600 mb-1">Order value not set on this WO</p>
            )}
            <div className="h-1.5 rounded-full bg-surface-container-highest overflow-hidden mb-2 mt-2">
              <div
                className="h-full rounded-full bg-secondary transition-all duration-700"
                style={{ width: `${pctPaid}%` }}
              />
            </div>
            <div className="flex justify-between text-[11px] text-on-surface-variant">
              <span>Paid: <span className="font-data-mono text-on-surface font-medium">{fmtRupee(totalPaid)}</span></span>
              <span>Remaining: <span className="font-data-mono text-on-surface font-medium">
                {orderValueSet ? fmtRupee(Math.max(orderValue - totalPaid, 0)) : '—'}
              </span></span>
            </div>
          </div>

          {/* Milestones */}
          {milestones && milestones.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-2">Milestones</p>
              <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
                {milestones.map((m: any, i: number) => {
                  const paid   = paidByMilestone[m.milestone_id] || 0;
                  const status = getMilestoneStatus(m, paid);
                  return (
                    <div
                      key={m.milestone_id}
                      className={`flex items-center justify-between px-3 py-2.5 text-[12px] ${i > 0 ? 'border-t border-outline-variant/10' : ''}`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-on-surface-variant shrink-0 font-data-mono">{m.seq_no}.</span>
                        <span className="text-on-surface truncate">{m.name}</span>
                      </div>
                      <div className="flex items-center gap-2 ml-3 shrink-0">
                        <span className="font-data-mono text-on-surface">{fmtRupee(Number(m.planned_amount) || 0)}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${MS_BADGE[status] || MS_BADGE.PENDING}`}>
                          {status.replace('_', ' ')}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Payments */}
          {allocations && allocations.length > 0 && (
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-2">Payments</p>
              <div className="rounded-xl border border-outline-variant/20 overflow-hidden">
                {allocations.map((a: any, i: number) => (
                  <div
                    key={a.allocation_id}
                    className={`flex items-center justify-between px-3 py-2.5 text-[12px] ${i > 0 ? 'border-t border-outline-variant/10' : ''}`}
                  >
                    <div>
                      <p className="text-on-surface font-data-mono">{a.transactions?.txn_id || '—'}</p>
                      <p className="text-on-surface-variant text-[10px]">{fmtDate(a.transactions?.date)} · {a.transactions?.payment_mode || '—'}</p>
                    </div>
                    <span className="font-data-mono font-semibold text-on-surface">{fmtRupee(Number(a.allocated_amount) || 0)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {wo.terms_conditions && (
            <div>
              <p className="text-[10px] font-semibold tracking-wider text-on-surface-variant uppercase mb-1">Terms</p>
              <p className="text-[12px] text-on-surface-variant whitespace-pre-line leading-relaxed">{wo.terms_conditions}</p>
            </div>
          )}
        </div>
      )}
    </PeekModal>
  );
}
