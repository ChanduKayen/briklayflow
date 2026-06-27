// Block B — Phase 2.2 ISSUE FOLLOW-UP TIMING. The three-layer engine that replaces the interim
// mapCause. Reads the 2.1 `cause` (now reliable) + the Phase-1 Follow-up Rules + the blocked
// task's schedule, and produces an issue's next_followup_at (chase clock) and deadline.
//
//   L1 USER DATE   — a date the narration gave ("by Friday") sets the DEADLINE. User intent wins.
//   L2 CADENCE     — the cause's clock/cadence: org override (follow_up_rules) ELSE taxonomy
//                    default. Sets the base first-follow-up. cause null/'other' → safe default.
//                    cause with null clock (weather/auspicious) → recorded, NOT chased.
//   L3 TEMPER      — DEADLINE = min(user date, blocked-task date). Cadence RAMPS toward it:
//                    relaxed when far, intensifying to the L2 base as it nears. Never chase past
//                    the deadline. Applied per the schedule's firmness.
//
// SCHEDULE FIRMNESS (this codebase): a task has no FIRM per-task planned date — its date is
// DERIVED (project.start_date + cumulative duration_days down the seq_no order, durations default
// to 1). So L3 from a blocked task is SOFT → temper GENTLY (smaller relax cap), and a user date is
// FIRM → temper confidently. No project start_date → no schedule → pure L2 (graceful degrade).

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

export type Cadence = { clock: number | null; cadence: number | null }
export type CadenceMap = Map<string, Cadence>

// Taxonomy default cadence — mirrors the cause_taxonomy seed. Defaults are a static contract (only
// TIMING is user-tunable, via follow_up_rules), so this also lets the engine run BEFORE the Phase-1
// tables are applied. null clock/cadence = recorded, not chased.
export const TAXONOMY_CADENCE: Record<string, Cadence> = {
  material:   { clock: 1, cadence: 1 },
  labour:     { clock: 1, cadence: 1 },
  rework:     { clock: 1, cadence: 1 },
  design:     { clock: 2, cadence: 2 },
  client:     { clock: 3, cadence: 3 },
  payment:    { clock: 2, cadence: 2 },
  equipment:  { clock: 1, cadence: 2 },
  weather:    { clock: null, cadence: null },
  statutory:  { clock: 3, cadence: 3 },
  access:     { clock: 2, cadence: 2 },
  auspicious: { clock: null, cadence: null },
  other:      { clock: 2, cadence: 3 },
}

const DAY_MS = 86_400_000
function addDays(d: Date, n: number): Date { const r = new Date(d); r.setDate(r.getDate() + n); return r }
function daysBetween(from: Date, to: Date): number { return Math.round((to.getTime() - from.getTime()) / DAY_MS) }

/**
 * L2 source: build the org's cadence map. Base = taxonomy defaults (DB if applied, else the
 * hardcoded mirror), overlaid with the org's follow_up_rules overrides. A missing table (Phase-1
 * not yet applied) degrades silently to the base — timing never fails for want of a table.
 */
export async function loadCadenceMap(supabase: SB, orgId: string): Promise<CadenceMap> {
  const map: CadenceMap = new Map(Object.entries(TAXONOMY_CADENCE))
  // taxonomy defaults from DB (respect any service-role tuning of a definition's default)
  const tax = await supabase.from('cause_taxonomy').select('cause_key, default_clock_days, default_cadence_days')
  if (!tax.error && Array.isArray(tax.data)) {
    for (const r of tax.data) map.set(r.cause_key, { clock: r.default_clock_days, cadence: r.default_cadence_days })
  }
  // org overrides win
  const ov = await supabase.from('follow_up_rules').select('cause_key, clock_days, cadence_days').eq('org_id', orgId)
  if (!ov.error && Array.isArray(ov.data)) {
    for (const r of ov.data) map.set(r.cause_key, { clock: r.clock_days, cadence: r.cadence_days })
  }
  return map
}

/**
 * L3 input: the DERIVED scheduled END date of the blocked task, or null when it can't be trusted
 * (task gone, or the project has no start_date anchor → no schedule). end = start_date + (sum of
 * duration_days for tasks sequenced at-or-before this one) - 1, mirroring the Task Manager roll-up.
 */
export async function computeBlockedTaskEnd(supabase: SB, taskId: string | null): Promise<Date | null> {
  if (!taskId) return null
  const { data: task } = await supabase.from('site_tasks').select('project_id, seq_no, duration_days').eq('task_id', taskId).maybeSingle()
  if (!task?.project_id) return null
  const { data: proj } = await supabase.from('projects').select('start_date').eq('project_id', task.project_id).maybeSingle()
  if (!proj?.start_date) return null   // no anchor → no schedule → L3 doesn't apply
  const { data: rows } = await supabase.from('site_tasks').select('seq_no, duration_days').eq('project_id', task.project_id)
  const seq = task.seq_no ?? 0
  const before = (rows ?? [])
    .filter((t: { seq_no: number | null }) => (t.seq_no ?? 0) < seq)
    .reduce((s: number, t: { duration_days: number | null }) => s + Math.max(1, t.duration_days ?? 1), 0)
  const total = before + Math.max(1, task.duration_days ?? 1)
  return addDays(new Date(proj.start_date), total - 1)
}

export interface TimingInput {
  cause: string | null
  userDate: Date | null              // L1 (parsed date_hint) — firm
  blockedTaskEnd: Date | null        // L3 (derived task schedule) — soft here
  now: Date
  cadenceMap: CadenceMap
  scheduleFirmness?: 'firm' | 'soft' // firmness of blockedTaskEnd; default 'soft' (this codebase)
}
export interface TimingResult {
  nextFollowupAt: Date | null        // the chase clock B wakes on (null = not chased)
  deadline: Date | null              // the real deadline (min of L1 / L3), if derivable
  cadenceDays: number | null         // the recurring interval for subsequent chases (L2/ramped)
  imminent: boolean                  // is the BLOCKED WORK near? (Phase 2.3 impact gate — L3 "near")
  layers: string[]                   // which layers applied — for the test + debug trail
}

// Ramp shape per firmness: how aggressively the FIRST follow-up relaxes as the deadline recedes.
// Firm (a user date) → relax more, further out. Soft (a derived task date) → relax GENTLY, capped
// short, so an untrustworthy far date can't lull a real problem into a 2-week silence.
const RAMP = {
  firm: { fraction: 0.25, max: 14 },
  soft: { fraction: 0.20, max: 7 },
}

/**
 * The engine. Pure + synchronous (DB I/O is done by the loaders above) so it's unit-testable.
 * Degrades gracefully: no user date → L2+L3; no schedule → pure L2; cause null/'other' → safe
 * default; weather/auspicious → recorded, not chased.
 */
export function computeTiming(input: TimingInput): TimingResult {
  const { cause, userDate, blockedTaskEnd, now, cadenceMap } = input
  const softFirm = input.scheduleFirmness ?? 'soft'
  const row = cadenceMap.get(cause ?? 'other') ?? cadenceMap.get('other') ?? { clock: 2, cadence: 3 }
  const layers: string[] = []

  // DEADLINE = min(L1 user date, L3 blocked-task date). Track which source BINDS (its firmness
  // drives the ramp). The work can't proceed until the issue clears, so the blocked task's due
  // date is a real deadline, capped tighter by any user date.
  const cands: { date: Date; firm: 'firm' | 'soft'; layer: string }[] = []
  if (userDate) cands.push({ date: userDate, firm: 'firm', layer: 'L1 user-date' })
  if (blockedTaskEnd) cands.push({ date: blockedTaskEnd, firm: softFirm, layer: 'L3 blocked-task' })
  cands.sort((a, b) => a.date.getTime() - b.date.getTime())
  const binding = cands[0] ?? null
  const deadline = binding?.date ?? null

  // Phase 2.3 GATE: is the BLOCKED WORK imminent? Reuse L3's near/far on the TASK schedule (not the
  // binding deadline — a near user-date on far work is still far work). Overdue / within the near
  // window → imminent. weather/auspicious (clock null) are never imminent (not work-blockers here).
  const imminent = !!blockedTaskEnd && row.clock != null &&
    Math.round(Math.max(0, daysBetween(now, blockedTaskEnd)) * RAMP.soft.fraction) <= row.clock

  // L2: weather/auspicious (null clock) → recorded, NOT chased. Deadline still recorded if known.
  if (row.clock == null) {
    layers.push(`L2 ${cause ?? 'other'}: not chased`)
    if (binding) layers.push(`${binding.layer} → deadline`)
    return { nextFollowupAt: null, deadline, cadenceDays: null, imminent: false, layers }
  }

  layers.push(`L2 ${cause ?? 'other'}: clock ${row.clock}d / cadence ${row.cadence ?? row.clock}d`)
  let interval = row.clock                       // base first-follow-up (the intense/near end)
  let cadenceDays = row.cadence ?? row.clock     // recurring interval (ramped alongside)

  if (deadline) {
    const D = daysBetween(now, deadline)
    const p = RAMP[binding!.firm]
    const relaxed = Math.round(D * p.fraction)   // the ramped interval a far deadline would earn
    if (relaxed > row.clock) {
      // FAR deadline → RELAX the chase (NOT default daily), bounded; gentler cap when soft.
      interval = Math.min(p.max, relaxed)
      cadenceDays = Math.min(p.max, Math.max(row.cadence ?? row.clock, relaxed))
      layers.push(`L3 ${binding!.firm}: deadline in ${D}d (far) → relax to ${interval}d`)
    } else {
      // NEAR deadline → intensify to the L2 base cadence (or tighter, below).
      layers.push(`L3 ${binding!.firm}: deadline in ${D}d (near) → base cadence`)
    }
    // never schedule the chase AFTER the deadline; tighten as it nears (D days at most, ≥ now).
    interval = Math.min(interval, Math.max(0, D))
  } else {
    layers.push('L3: no schedule → pure L2')
  }

  return { nextFollowupAt: addDays(now, interval), deadline, cadenceDays, imminent, layers }
}
