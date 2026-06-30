import { useState, type ReactNode } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { PeekModal } from './PeekModal';
import { PeekDocSkeleton } from './PeekSkeleton';
import { useUserProfile } from '../App';
import { usePeek } from '../context/PeekContext';
import { TxnRow } from './TxnRow';
import { OtherOpenWithParty } from './OtherOpenWithParty';
import { fmtRupee, hexA, DocPaper, SERIF, INK, INK_SOFT, PAPER_EDGE, TERRA_INK } from './PeekHero';

const SAGE_INK = '#5E8157';

function fmtDate(d: string | null | undefined) {
  if (!d) return null;
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function woTone(status: string): { c: string; label: string } {
  if (status === 'Cancelled') return { c: '#B0473A', label: status };
  if (status === 'Completed' || status === 'Closed') return { c: SAGE_INK, label: status };
  if (status === 'Draft') return { c: hexA(INK, 0.5), label: status };
  return { c: TERRA_INK, label: status };
}

function getMilestoneStatus(milestone: any, paid: number): string {
  const planned = Number(milestone.planned_amount) || 0;
  if (planned > 0 && paid > planned + 100) return 'paid';
  if (planned > 0 && paid >= planned - 100) return 'paid';
  if (paid > 0) return 'part';
  const d = milestone.due_date ? new Date(milestone.due_date) : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d && !isNaN(d.getTime()) && d < today) return 'due';
  return '';
}

function summarizeScope(s: string | null | undefined): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Contract';
  return t.length > 60 ? t.slice(0, 60).trimEnd() + '…' : t;
}

// ── small, consistent primitives ──
function Label({ children }: { children: ReactNode }) {
  return (
    <p className="text-[10px] font-semibold uppercase tracking-[0.13em] mb-2.5" style={{ color: hexA(INK, 0.38) }}>
      {children}
    </p>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section className="pt-6 mt-6" style={{ borderTop: `1px solid ${PAPER_EDGE}` }}>
      <Label>{label}</Label>
      {children}
    </section>
  );
}

// ── Primary query (shared by useQuery + prefetchWo) ──
const woPeekKey = (woId: string) => ['wo_peek', woId];
const woPeekFn = async (woId: string) => {
  const { data, error } = await supabase
    .from('work_orders')
    .select('*, projects(name, site_location), stakeholders(name, category)')
    .eq('wo_id', woId)
    .single();
  if (error) throw error;
  return data;
};

/** Warm the WO peek's primary query so the click paints instantly. */
export function prefetchWo(qc: QueryClient, woId: string) {
  if (!woId) return;
  void qc.prefetchQuery({ queryKey: woPeekKey(woId), queryFn: () => woPeekFn(woId) });
}

interface WOPeekProps {
  woId: string;
  onClose: () => void;
  session?: Session;
}

export function WOPeek({ woId, onClose, session }: WOPeekProps) {
  const qc = useQueryClient();
  const { openPeek } = usePeek();
  const { data: profile } = useUserProfile(session?.user.id ?? '');
  const canApprove = profile?.role === 'management' || profile?.role === 'principal';
  const [approving, setApproving] = useState(false);

  const { data: wo, isLoading: loadingWo } = useQuery({
    queryKey: woPeekKey(woId),
    queryFn: () => woPeekFn(woId),
  });

  const { data: milestones } = useQuery({
    queryKey: ['wo_milestones_peek', woId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('wo_milestones').select('*').eq('wo_id', woId).order('seq_no', { ascending: true });
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
        .select('*, transactions(txn_id, date, total_amount, payment_mode, category, remarks, status)')
        .eq('order_type', 'WO').eq('order_ref', woId);
      if (error) throw error;
      return data.filter((a: any) => a.transactions?.status !== 'Voided');
    },
    enabled: !!wo,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!wo || !session) throw new Error('Not ready');
      const { error } = await supabase.from('work_orders').update({ status: 'Assigned' }).eq('wo_id', woId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['wo_peek', woId] });
      qc.invalidateQueries({ queryKey: ['work_orders'] });
      qc.invalidateQueries({ queryKey: ['nav_wo_pending'] });
      setApproving(false);
    },
  });

  const orderValue  = Number(wo?.order_value) || 0;
  const msTotal     = (milestones || []).reduce((s: number, m: any) => s + (Number(m.amount) || 0), 0);
  const totalPaid   = (allocations || []).reduce((s: number, a: any) => s + Number(a.allocated_amount || 0), 0);
  const displayTotal  = orderValue > 0 ? orderValue : msTotal > 0 ? msTotal : totalPaid;
  const orderValueSet = orderValue > 0;
  const balance       = Math.max(displayTotal - totalPaid, 0);
  const pct           = displayTotal > 0 ? Math.min(100, Math.round((totalPaid / displayTotal) * 100)) : 0;

  const paidByMilestone: Record<string, number> = {};
  (allocations || []).forEach((a: any) => {
    if (a.milestone_id) paidByMilestone[a.milestone_id] = (paidByMilestone[a.milestone_id] || 0) + Number(a.allocated_amount || 0);
  });

  const title = (wo as any)?.title?.trim?.() || summarizeScope(wo?.scope_of_work);
  const fullScope = wo?.scope_of_work?.trim?.() || '';
  // Only show "The work" when the scope adds detail beyond the title (no duplication).
  const showWork = !!fullScope && fullScope !== title && fullScope.length > title.length + 12;

  const tone = wo ? woTone(wo.status) : { c: TERRA_INK, label: '' };
  const dates = wo ? [fmtDate(wo.start_date), fmtDate(wo.end_date)].filter(Boolean).join('–') : '';

  return (
    <PeekModal
      title={woId}
      subtitle={wo ? `${wo.stakeholders?.name || '—'}  ·  ${wo.projects?.name || '—'}` : undefined}
      fullPageHref={`/work-orders/${woId}`}
      onClose={onClose}
    >
      {loadingWo ? (
        <PeekDocSkeleton />
      ) : !wo ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Contract not found.</p>
      ) : (
        <DocPaper accent={TERRA_INK}>

          {/* ── MASTHEAD — identity, then the one focal figure ── */}
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: hexA(INK, 0.42) }}>Contract</span>
            <span className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: tone.c }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: tone.c }} />{tone.label}
            </span>
          </div>

          <h2 style={{ fontFamily: SERIF, color: INK, fontSize: 'clamp(1.05rem, 0.9rem + 0.9vw, 1.25rem)', lineHeight: 1.25, letterSpacing: '-0.01em' }}>
            {title}
          </h2>
          <p className="mt-1 text-[11.5px]" style={{ color: INK_SOFT }}>
            {wo.stakeholder_id ? (
              <button onClick={() => openPeek('STAKEHOLDER', wo.stakeholder_id!)} className="font-medium hover:underline" style={{ color: INK_SOFT }}>
                {wo.stakeholders?.name || '—'}
              </button>
            ) : <span className="font-medium">{wo.stakeholders?.name || '—'}</span>}
            <span className="mx-1.5" style={{ color: hexA(INK, 0.22) }}>·</span>{wo.projects?.name || '—'}
            {dates && <><span className="mx-1.5" style={{ color: hexA(INK, 0.22) }}>·</span>{dates}</>}
          </p>

          {/* the figure — biggest thing on the card */}
          <div className="mt-6">
            <p style={{ fontFamily: SERIF, color: INK, fontSize: 'clamp(2.1rem, 1.5rem + 2.6vw, 2.7rem)', lineHeight: 1, letterSpacing: '-0.02em', fontVariantNumeric: 'tabular-nums' }}>
              <span style={{ color: TERRA_INK, fontSize: '0.46em', fontWeight: 600, marginRight: '0.08em' }}>₹</span>{balance.toLocaleString('en-IN')}
            </p>
            <p className="mt-2 text-[11.5px]" style={{ color: INK_SOFT }}>
              balance left<span className="mx-1.5" style={{ color: hexA(INK, 0.22) }}>·</span><span style={{ color: tone.c, fontWeight: 600 }}>{pct}% paid</span>
            </p>
            <div className="mt-3 h-1 rounded-full overflow-hidden" style={{ background: hexA(INK, 0.08) }}>
              <div className="h-full rounded-full transition-all duration-700" style={{ width: `${pct}%`, background: TERRA_INK }} />
            </div>
            <p className="mt-2 text-[11px]" style={{ color: hexA(INK, 0.45), fontVariantNumeric: 'tabular-nums' }}>
              {fmtRupee(totalPaid)} of {displayTotal > 0 ? fmtRupee(displayTotal) : '—'}
              {!orderValueSet && <span className="italic"> · est. from stages</span>}
            </p>
          </div>

          {/* ── Approve — Draft only ── */}
          {wo.status === 'Draft' && canApprove && (
            <div className="mt-6 rounded-xl p-3" style={{ background: hexA(TERRA_INK, 0.06), border: `1px solid ${hexA(TERRA_INK, 0.2)}` }}>
              {!approving ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] font-medium" style={{ color: INK }}>Awaiting approval</p>
                  <button onClick={() => setApproving(true)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold transition-opacity hover:opacity-90 shrink-0" style={{ background: TERRA_INK }}>
                    <span className="material-symbols-outlined text-[14px]">verified</span>Approve &amp; Assign
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-[12px] font-semibold mb-2" style={{ color: INK }}>Confirm approval of {woId}?</p>
                  <div className="flex gap-2">
                    <button onClick={() => approveMutation.mutate()} disabled={approveMutation.isPending} className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-white text-[12px] font-semibold transition-opacity hover:opacity-90 disabled:opacity-50" style={{ background: TERRA_INK }}>
                      {approveMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <span className="material-symbols-outlined text-[14px]">verified</span>}Confirm
                    </button>
                    <button onClick={() => setApproving(false)} className="px-3 py-1.5 rounded-lg text-[12px] transition-colors hover:bg-black/5" style={{ color: INK_SOFT }}>Cancel</button>
                  </div>
                  {approveMutation.isError && <p className="text-[11px] mt-1" style={{ color: '#B0473A' }}>{(approveMutation.error as any)?.message}</p>}
                </div>
              )}
            </div>
          )}

          {/* ── The work (only when the scope adds detail) ── */}
          {showWork && (
            <Section label="The work">
              <p className="whitespace-pre-line" style={{ fontFamily: SERIF, color: INK, fontSize: 13.5, lineHeight: 1.65 }}>{fullScope}</p>
            </Section>
          )}

          {/* ── Schedule ── */}
          <Section label="Schedule">
            {(milestones && milestones.length > 0
              ? milestones.map((m: any, i: number) => ({ key: m.milestone_id, n: i + 1, name: m.name, amount: Number(m.planned_amount) || 0, note: getMilestoneStatus(m, paidByMilestone[m.milestone_id] || 0), first: i === 0 }))
              : [{ key: 'lump', n: 1, name: 'Lump sum', amount: displayTotal, note: totalPaid >= displayTotal && displayTotal > 0 ? 'paid' : totalPaid > 0 ? 'part' : '', first: true }]
            ).map((r) => (
              <div key={r.key} className="flex items-baseline justify-between gap-3 py-2" style={r.first ? undefined : { borderTop: `1px solid ${hexA(INK, 0.06)}` }}>
                <div className="flex items-baseline gap-2.5 min-w-0">
                  <span className="text-[11px] shrink-0" style={{ color: hexA(INK, 0.35), fontVariantNumeric: 'tabular-nums' }}>{r.n}</span>
                  <span className="text-[13px] truncate" style={{ fontFamily: SERIF, color: INK }}>{r.name}</span>
                </div>
                <div className="flex items-baseline gap-3 shrink-0">
                  {r.note && <span className="text-[10px] uppercase tracking-wide" style={{ color: r.note === 'paid' ? SAGE_INK : hexA(INK, 0.4) }}>{r.note}</span>}
                  <span className="text-[12.5px]" style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(r.amount)}</span>
                </div>
              </div>
            ))}
            <div className="flex items-baseline justify-between pt-2.5 mt-1" style={{ borderTop: `1px solid ${hexA(INK, 0.18)}` }}>
              <span className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: hexA(INK, 0.5) }}>Contract value</span>
              <span className="text-[14px] font-semibold" style={{ fontFamily: SERIF, color: INK, fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(displayTotal)}</span>
            </div>
          </Section>

          {/* ── Payments ── */}
          {allocations && allocations.length > 0 && (
            <Section label="Payments">
              <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${hexA(INK, 0.07)}`, background: 'rgba(255,255,255,.45)' }}>
                {allocations.map((a: any) => (
                  <TxnRow key={a.allocation_id} txn={{ ...a.transactions, total_amount: a.allocated_amount }} context="wo" onClick={() => a.transactions?.txn_id && openPeek('TRANSACTION', a.transactions.txn_id)} />
                ))}
              </div>
            </Section>
          )}

          {/* ── This worker's other open contracts (renders nothing when none) ── */}
          <div className="mt-6 empty:mt-0">
            <OtherOpenWithParty kind="WO" stakeholderId={wo.stakeholder_id} currentOrderId={woId} partyName={wo.stakeholders?.name} projectId={wo.project_id} siteName={wo.projects?.name} />
          </div>

          {/* ── Terms ── */}
          {wo.terms_conditions && (
            <Section label="Terms">
              <p className="whitespace-pre-line" style={{ color: INK_SOFT, fontSize: 12, lineHeight: 1.65 }}>{wo.terms_conditions}</p>
            </Section>
          )}
        </DocPaper>
      )}
    </PeekModal>
  );
}
