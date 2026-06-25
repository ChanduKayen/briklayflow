import { useState } from 'react';
import { useQuery, useMutation, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { Loader2 } from 'lucide-react';
import type { Session } from '@supabase/supabase-js';
import { PeekModal } from './PeekModal';
import { PeekHeroSkeleton } from './PeekSkeleton';
import { useUserProfile } from '../App';
import { usePeek } from '../context/PeekContext';
import { TxnRow } from './TxnRow';
import { OtherOpenWithParty } from './OtherOpenWithParty';
import {
  WalnutHero, HeroFigure, HeroPill, BurnDown, TERRA, fmtRupee,
  DocPaper, DocMarker, Watermark, ExecutedSeal, SERIF, INK, INK_SOFT,
} from './PeekHero';

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const p = new Date(d);
  if (isNaN(p.getTime())) return d;
  return p.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

// Map a WO status to the dark-hero pill tone.
function woPillTone(status: string): 'active' | 'error' | 'neutral' {
  if (status === 'Cancelled') return 'error';
  if (status === 'Draft') return 'neutral';
  return 'active';
}

// Map a payment status to a quiet contract-voice schedule note.
function scheduleNote(status: string): string {
  switch (status) {
    case 'PAID':           return 'paid';
    case 'OVERPAID':       return 'paid';
    case 'PARTIALLY_PAID': return 'part';
    case 'DUE':            return 'due';
    default:               return '';
  }
}

function getMilestoneStatus(milestone: any, paid: number): string {
  const planned = Number(milestone.amount) || 0;
  if (planned > 0 && paid > planned + 100) return 'OVERPAID';
  if (planned > 0 && paid >= planned - 100) return 'PAID';
  if (paid > 0) return 'PARTIALLY_PAID';
  const d = milestone.due_date ? new Date(milestone.due_date) : null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  if (d && !isNaN(d.getTime()) && d < today) return 'DUE';
  return 'PENDING';
}

// A WO's scope is a paragraph; show the opening ~48 chars as a human eyebrow.
function summarizeScope(s: string | null | undefined): string {
  const t = (s ?? '').replace(/\s+/g, ' ').trim();
  if (!t) return 'Contract';
  return t.length > 48 ? t.slice(0, 48).trimEnd() + '…' : t;
}

/** One ruled row in the contract's payment schedule (annexure style). */
function ScheduleRow({
  stage, name, amount, note, first,
}: {
  stage: number; name: string; amount: number; note: string; first?: boolean;
}) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-2"
      style={first ? undefined : { borderTop: '1px solid rgba(0,0,0,.08)' }}
    >
      <div className="flex items-baseline gap-2.5 min-w-0">
        <span style={{ fontFamily: SERIF, color: INK_SOFT, fontVariantNumeric: 'tabular-nums' }} className="text-[12px] shrink-0">{stage}.</span>
        <span style={{ fontFamily: SERIF, color: INK }} className="text-[13px] truncate">{name}</span>
      </div>
      <div className="flex items-baseline gap-2.5 shrink-0">
        {note && <span className="text-[9.5px] font-semibold uppercase tracking-wider" style={{ color: INK_SOFT }}>{note}</span>}
        <span style={{ fontFamily: SERIF, color: INK, fontVariantNumeric: 'tabular-nums' }} className="text-[13px] tabular-nums">{fmtRupee(amount)}</span>
      </div>
    </div>
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
        .from('wo_milestones')
        .select('*')
        .eq('wo_id', woId)
        .order('created_at', { ascending: true });
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
        .eq('order_type', 'WO')
        .eq('order_ref', woId);
      if (error) throw error;
      return data.filter((a: any) => a.transactions?.status !== 'Voided');
    },
    enabled: !!wo,
  });

  const approveMutation = useMutation({
    mutationFn: async () => {
      if (!wo || !session) throw new Error('Not ready');
      const { error } = await supabase.from('work_orders').update({
        status: 'Assigned',
      }).eq('wo_id', woId);
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
  // Derive a display total even when order_value is not set on the WO
  const displayTotal  = orderValue > 0 ? orderValue : msTotal > 0 ? msTotal : totalPaid;
  const orderValueSet = orderValue > 0;
  const balance       = Math.max(displayTotal - totalPaid, 0);

  // Paid per milestone
  const paidByMilestone: Record<string, number> = {};
  (allocations || []).forEach((a: any) => {
    if (a.milestone_id) {
      paidByMilestone[a.milestone_id] = (paidByMilestone[a.milestone_id] || 0) + Number(a.allocated_amount || 0);
    }
  });

  const heroTitle = (wo as any)?.title?.trim?.() || summarizeScope(wo?.scope_of_work);
  // The formal recital paragraph: the full scope of work, else the title.
  const recital = (wo?.scope_of_work?.trim?.() || (wo as any)?.title?.trim?.() || 'Contract for works as agreed between the parties.');

  return (
    <PeekModal
      title={woId}
      subtitle={wo ? `${wo.stakeholders?.name || '—'}  ·  ${wo.projects?.name || '—'}` : undefined}
      fullPageHref={`/work-orders/${woId}`}
      onClose={onClose}
    >
      {loadingWo ? (
        <PeekHeroSkeleton />
      ) : !wo ? (
        <p className="text-center text-on-surface-variant py-12 text-body-sm">Contract not found.</p>
      ) : (
        <div className="flex flex-col gap-5">

          {/* ── HERO: contract burn-down ── */}
          <WalnutHero
            variant="terra"
            topLeft={
              <>
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] mb-1" style={{ color: TERRA }}>Contract</p>
                <p className="text-[13px] leading-snug" style={{ color: '#F3EADB' }}>{heroTitle}</p>
              </>
            }
            topRight={<HeroPill label={wo.status} tone={woPillTone(wo.status)} />}
            eyebrow={
              <span className="inline-flex items-center gap-1.5" style={{ color: TERRA, fontSize: 10.5, fontWeight: 700, letterSpacing: '0.14em' }}>
                <span className="material-symbols-outlined text-[13px]">savings</span>
                BALANCE LEFT
              </span>
            }
          >
            <HeroFigure prefix="₹" value={balance.toLocaleString('en-IN')} accent={TERRA} />
            {!orderValueSet && (
              <p className="mt-2 text-[10px]" style={{ color: 'rgba(243,234,219,.42)' }}>Order value not set — estimated from milestones</p>
            )}
            <BurnDown total={displayTotal} paid={totalPaid} accent={TERRA} totalKnown={displayTotal > 0} />
          </WalnutHero>

          {/* ── Approve banner — Draft WO, management/principal only ── */}
          {wo.status === 'Draft' && canApprove && (
            <div className="rounded-xl bg-blue-50 border border-blue-200/60 p-3">
              {!approving ? (
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[12px] text-blue-700 font-medium">Awaiting approval</p>
                  <button
                    onClick={() => setApproving(true)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-semibold hover:bg-blue-700 transition-colors shrink-0"
                  >
                    <span className="material-symbols-outlined text-[14px]">verified</span>
                    Approve &amp; Assign
                  </button>
                </div>
              ) : (
                <div>
                  <p className="text-[12px] text-blue-800 font-semibold mb-2">Confirm approval of {woId}?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveMutation.mutate()}
                      disabled={approveMutation.isPending}
                      className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-[12px] font-semibold hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {approveMutation.isPending ? <Loader2 size={12} className="animate-spin" /> : <span className="material-symbols-outlined text-[14px]">verified</span>}
                      Confirm
                    </button>
                    <button onClick={() => setApproving(false)} className="px-3 py-1.5 rounded-lg text-[12px] text-blue-700 hover:bg-blue-100 transition-colors">Cancel</button>
                  </div>
                  {approveMutation.isError && <p className="text-[11px] text-red-600 mt-1">{(approveMutation.error as any)?.message}</p>}
                </div>
              )}
            </div>
          )}

          {/* ── CONTRACT PAPER ── the body reads like a legacy agreement ── */}
          <DocPaper accent={TERRA} watermark={<Watermark text={woId} accent={INK} variant="id" />}>
            <div className="flex flex-col gap-7">

              {/* § THE WORK — formal recital of the scope */}
              <section>
                <DocMarker label="The Work" glyph="§" accent={TERRA} />
                <p
                  style={{ fontFamily: SERIF, color: INK, fontSize: 14.5, lineHeight: 1.7 }}
                  className="whitespace-pre-line"
                >
                  {recital}
                </p>
              </section>

              {/* THE PARTIES */}
              <section>
                <DocMarker label="The Parties" accent={TERRA} />
                <p style={{ fontFamily: SERIF, color: INK, fontSize: 14, lineHeight: 1.7 }}>
                  Made between <span className="italic">the Owner</span> and{' '}
                  {wo.stakeholder_id ? (
                    <button
                      onClick={() => openPeek('STAKEHOLDER', wo.stakeholder_id!)}
                      className="font-semibold hover:underline"
                      style={{ color: INK, fontFamily: SERIF }}
                    >
                      {wo.stakeholders?.name || '—'} ↗
                    </button>
                  ) : (
                    <span className="font-semibold">{wo.stakeholders?.name || '—'}</span>
                  )}
                  {wo.stakeholders?.category && (
                    <span style={{ color: INK_SOFT }}> ({wo.stakeholders.category})</span>
                  )}
                  .
                </p>
                <p className="mt-1.5 text-[11.5px]" style={{ color: INK_SOFT }}>
                  for {wo.projects?.name || '—'}
                  {wo.projects?.site_location ? `, ${wo.projects.site_location}` : ''}
                  {(wo.start_date || wo.end_date) && (
                    <>  ·  {fmtDate(wo.start_date)}–{fmtDate(wo.end_date)}</>
                  )}
                </p>
              </section>

              {/* SCHEDULE OF PAYMENTS — ruled annexure */}
              <section className="relative">
                <DocMarker label="Schedule of Payments" accent={TERRA} />
                <div>
                  {milestones && milestones.length > 0 ? (
                    milestones.map((m: any, i: number) => {
                      const paid = paidByMilestone[m.id] || 0;
                      return (
                        <ScheduleRow
                          key={m.id}
                          stage={i + 1}
                          name={m.name}
                          amount={Number(m.amount) || 0}
                          note={scheduleNote(getMilestoneStatus(m, paid))}
                          first={i === 0}
                        />
                      );
                    })
                  ) : (
                    <ScheduleRow stage={1} name="Lump sum" amount={displayTotal} note={scheduleNote(totalPaid >= displayTotal && displayTotal > 0 ? 'PAID' : totalPaid > 0 ? 'PARTIALLY_PAID' : 'PENDING')} first />
                  )}

                  {/* TOTAL row — double hairline above */}
                  <div
                    className="flex items-baseline justify-between pt-2.5 mt-1"
                    style={{ borderTop: `3px double ${INK_SOFT}` }}
                  >
                    <span style={{ fontFamily: SERIF, color: INK }} className="text-[12.5px] font-semibold uppercase tracking-wide">Contract Value</span>
                    <span style={{ fontFamily: SERIF, color: INK, fontVariantNumeric: 'tabular-nums' }} className="text-[15px] font-bold">{fmtRupee(displayTotal)}</span>
                  </div>
                  <div className="flex items-center justify-between mt-1.5">
                    <p className="text-[11px]" style={{ color: INK_SOFT }}>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(totalPaid)}</span> received
                      <span className="mx-1.5" style={{ color: 'rgba(0,0,0,.2)' }}>·</span>
                      <span style={{ fontVariantNumeric: 'tabular-nums' }}>{fmtRupee(balance)}</span> balance
                    </p>
                    {(wo.status === 'Assigned' || wo.status === 'Active') && <ExecutedSeal accent={TERRA} />}
                  </div>
                </div>
              </section>

              {/* RECENT PAYMENTS — document voice header */}
              {allocations && allocations.length > 0 && (
                <section>
                  <DocMarker label="Recent Payments" accent={TERRA} />
                  <div className="rounded-lg overflow-hidden" style={{ border: '1px solid rgba(0,0,0,.07)', background: 'rgba(255,255,255,.5)' }}>
                    {allocations.map((a: any) => (
                      <TxnRow
                        key={a.allocation_id}
                        txn={{ ...a.transactions, total_amount: a.allocated_amount }}
                        context="wo"
                        onClick={() => a.transactions?.txn_id && openPeek('TRANSACTION', a.transactions.txn_id)}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* this worker's OTHER open contracts */}
              <OtherOpenWithParty
                kind="WO"
                stakeholderId={wo.stakeholder_id}
                currentOrderId={woId}
                partyName={wo.stakeholders?.name}
                projectId={wo.project_id}
                siteName={wo.projects?.name}
              />

              {wo.terms_conditions && (
                <section>
                  <DocMarker label="Terms & Conditions" accent={TERRA} />
                  <p
                    className="whitespace-pre-line"
                    style={{ fontFamily: SERIF, color: INK_SOFT, fontSize: 12.5, lineHeight: 1.7 }}
                  >
                    {wo.terms_conditions}
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
