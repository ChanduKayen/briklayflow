// T1 — SITEOPS OPEN-CONVO SWEEPER (constitution clause 2: "Unanswered → park reason='project',
// FULL payload"). Today the park fires ONLY when a NEXT message interrupts an open pick
// (commitInterruptedSiteops); a question nobody ever answers is a PERMANENT OPEN conversation that
// keeps intercepting that sender — the stale-OPEN bug, still live for SITEOPS because
// wa_commit_abandoned_conversations is TRANSACTION-gated (20260613000015:81).
//
// RED SEAM (this commit): the sweeper does not exist yet — this no-op is the honest current
// behavior, and the j1/j4 journeys land RED against it. The implementation commit fills it in:
// select aged OPEN SITEOPS convos (TTL SITEOPS_CONVO_TTL_HOURS, default 24, on opened_at) →
// park each via the SAME core commitInterruptedSiteops uses (ONE insert site — Hazard 5) →
// ABANDON the convo. Driven by the siteops-reanalyze hourly tick, wrapped so a failure can
// never abort the harvest.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

export interface SweepResult { checked: number; parked: number; abandoned: number; failures: number }

export async function sweepStaleSiteopsConvos(
  _supabase: SB, _opts: { now?: Date; ttlHours?: number } = {},
): Promise<SweepResult> {
  return { checked: 0, parked: 0, abandoned: 0, failures: 0 }
}
