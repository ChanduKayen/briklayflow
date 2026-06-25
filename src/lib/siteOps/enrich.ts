// Site-ops Pass-2 enrichment (F) — turn each generated task into a described task with
// 3 QC points, exactly one critical. Mirrors the _extract.ts house pattern: a strict-JSON
// system prompt, validated structured output, Anthropic-then-OpenAI (injected here so the
// module is headless-testable and runnable from a script or edge function).
//
// F NEVER adds / removes / reorders / re-counts tasks — it only writes description + QC onto
// tasks the expander already made.
//
// BATCH UNIT: one LLM call per PHASE, enriching the phase's DISTINCT (phase, trade) pairs
// (not the per-instance tasks). "blockwork" is enriched once; the result FANS OUT onto every
// blockwork task instance. Config 4 = 8 phase-calls describing ~40 trades, not 161 calls.
// The description + QC wording is per-trade; the QC ROWS are per task instance (each its own
// answer-slot — the per-instance critical row is the per-task progress ruler the loop reads).

import type { Sequence, SeqPhase, SeqTrade } from './expander'

export interface QcPoint { question: string; is_critical: boolean }
export interface TradeEnrichment { trade: string; description: string; qc: QcPoint[] }

export interface ProjectCtx {
  project_id: string
  org_id: string
  project_type: string | null
  construction_stack: { levels: { label: string; kind: string }[] } | null
}

/** Raw-text LLM caller (system, user) → model text. Injected; the script/edge wires the key. */
export type LlmCaller = (system: string, user: string) => Promise<string>

// ── The prompt — the quality bar lives here ────────────────────────────────────
export const ENRICH_SYSTEM = `You are a senior site engineer and QC inspector for RCC residential
construction in coastal Andhra Pradesh (Kakinada). You write the field checklist a supervisor
actually uses on site — not a textbook.

You are given ONE construction phase and the TRADES in it, each with a short grounding note.
For EVERY trade you return:
  - description: what the work actually involves for THIS trade in THIS project type. Concrete
    and recognizable — a supervisor reads it and says "yes, that's the job". Grounded in the
    note. NOT generic ("do the work properly"), NOT textbook prose.
  - qc: EXACTLY 3 quality-control checks, EXACTLY ONE with is_critical:true.

THE BAR FOR EVERY QC QUESTION — non-negotiable:
A QC question MUST be a specific, on-site OBSERVABLE FACT that a person standing in front of
the work can check and answer concretely. NOT a judgment, NOT vague quality-language.
  GOOD: "Is the shuttering plumb and the cover-block spacing maintained before the pour?"
  BAD:  "Is the slab good?" / "Is the plastering done properly?"
If a question can be answered "yes, looks fine" without inspecting something specific, it
FAILS. Name the physical thing checked — plumb, line, level, cover, lap length, anchorage,
ponding, gradient, curing days, key/raking, thickness, hollowness, joint.

THE CRITICAL QUESTION — hold this hardest:
The single is_critical:true question must be a CHECKABLE PHYSICAL FACT AT A SPECIFIC MOMENT
that is simultaneously:
  (a) a STAGE-GATE — answerable only once the work has reached/passed this stage, so the
      answer reveals progress; AND
  (b) the trade's QUALITY DETERMINANT — the one check that most decides whether this trade
      was done right.
ONE question, BOTH signals — progress and quality together. Example for slab_pour:
  "Was the reinforcement, cover and shuttering checked and the slab cast in one continuous
   operation with no cold joint?" — answerable only at the pour (progress) and the thing that
   decides slab integrity (quality). A vague critical collapses the whole design.

Coastal AP: where a note flags monsoon / water table / curing, let it shape the check
(terrace ponding test before covering; curing days before loading; dewatering in deep digs).

You are describing tasks that ALREADY EXIST. NEVER invent, add, remove, reorder, rename, or
re-count trades. Return one element per trade given, using its EXACT trade key.

Return STRICT JSON only — no markdown, no commentary:
{"trades":[{"trade":"<key>","description":"...","qc":[{"question":"...","is_critical":false},{"question":"...","is_critical":false},{"question":"...","is_critical":true}]}]}`

/** One-line stack summary for project tailoring (villa vs apartment etc.). */
function stackSummary(ctx: ProjectCtx): string {
  const lv = ctx.construction_stack?.levels ?? []
  if (!lv.length) return ctx.project_type ?? 'residential'
  return `${ctx.project_type ?? 'residential'}: ${lv.map((l) => `${l.label}(${l.kind})`).join(' → ')}`
}

/** Build the per-phase user message: the phase + its trades + notes + project context. */
export function buildEnrichUserPrompt(phase: SeqPhase, trades: SeqTrade[], ctx: ProjectCtx): string {
  const lines = trades.map((t, i) => `${i + 1}. ${t.label} [${t.key}] — note: ${t.note ?? '(none)'}`)
  return (
    `PROJECT: ${stackSummary(ctx)}\n` +
    `PHASE: ${phase.label} (${phase.key})\n\n` +
    `TRADES — describe every one, in this order, using its exact trade key:\n${lines.join('\n')}\n\n` +
    `Return the JSON contract for exactly these ${trades.length} trade(s).`
  )
}

/** Strip a ```json fence and parse. Returns null on any failure (mirrors _extract). */
export function safeParseJSON(raw: string): Record<string, unknown> | null {
  try { return JSON.parse(raw.replace(/^```json\n?|\n?```$/g, '').trim()) } catch { return null }
}

/** Validate a phase's output: every expected trade present, exactly 3 qc, exactly 1 critical. */
export function validatePhaseEnrichment(expected: string[], out: unknown): string | null {
  if (!Array.isArray(out)) return 'output is not an array'
  const got = new Map<string, TradeEnrichment>()
  for (const e of out as TradeEnrichment[]) {
    if (!e || typeof e !== 'object' || typeof e.trade !== 'string') return 'malformed trade element'
    got.set(e.trade, e)
  }
  for (const k of expected) {
    const t = got.get(k)
    if (!t) return `missing trade "${k}"`
    if (typeof t.description !== 'string' || !t.description.trim()) return `empty description for "${k}"`
    if (!Array.isArray(t.qc) || t.qc.length !== 3) return `trade "${k}": need exactly 3 qc (got ${t.qc?.length ?? 0})`
    const crit = t.qc.filter((q) => q?.is_critical === true).length
    if (crit !== 1) return `trade "${k}": need exactly 1 critical (got ${crit})`
    for (const q of t.qc) if (typeof q.question !== 'string' || !q.question.trim()) return `trade "${k}": empty qc question`
  }
  for (const k of got.keys()) if (!expected.includes(k)) return `unexpected trade "${k}"`
  return null
}

export interface TaskRow { task_id: string; phase: string; trade: string }
export interface QcInsert { task_id: string; org_id: string; question: string; is_critical: boolean; seq: number }

/**
 * Fan per-(phase,trade) enrichment onto every task instance: one description per instance,
 * 3 QC rows per instance (each with its own answer-slot). enrich keyed by `${phase}::${trade}`.
 */
export function planFanOut(
  tasks: TaskRow[], orgId: string, enrich: Map<string, TradeEnrichment>,
): { qcRows: QcInsert[]; enrichedTaskIds: string[]; descByKey: Map<string, string> } {
  const qcRows: QcInsert[] = []
  const enrichedTaskIds: string[] = []
  const descByKey = new Map<string, string>()
  for (const t of tasks) {
    const key = `${t.phase}::${t.trade}`
    const e = enrich.get(key)
    if (!e) continue
    descByKey.set(key, e.description)
    enrichedTaskIds.push(t.task_id)
    e.qc.forEach((q, i) => qcRows.push({
      task_id: t.task_id, org_id: orgId, question: q.question, is_critical: q.is_critical, seq: i + 1,
    }))
  }
  return { qcRows, enrichedTaskIds, descByKey }
}

export interface EnrichReport { calls: number; tradesEnriched: number; instances: number; qcRows: number }

/**
 * Enrich a project's generated tasks. One LLM call per phase (with at least one task),
 * validated + retried once on a contract violation; then fan-out write with replace
 * discipline (per task: overwrite description, delete-and-replace its 3 QC rows). Re-runnable
 * — never touches task structure, only description + QC. source='manual' tasks are not touched.
 */
export async function enrichProject(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- browser or service-role client
  supabase: any,
  llm: LlmCaller,
  projectId: string,
  sequence: Sequence,
): Promise<EnrichReport> {
  const { data: project, error: pErr } = await supabase
    .from('projects').select('project_id, org_id, project_type, construction_stack')
    .eq('project_id', projectId).single()
  if (pErr || !project) throw new Error(`project not found: ${projectId}${pErr ? ` (${pErr.message})` : ''}`)

  const { data: tasks, error: tErr } = await supabase
    .from('site_tasks').select('task_id, phase, trade')
    .eq('project_id', projectId).eq('source', 'generated')
  if (tErr) throw new Error(`load tasks: ${tErr.message}`)
  if (!tasks?.length) throw new Error(`project ${projectId} has no generated tasks to enrich`)

  // distinct trades present, per phase
  const present = new Map<string, Set<string>>()
  for (const t of tasks as TaskRow[]) {
    if (!present.has(t.phase)) present.set(t.phase, new Set())
    present.get(t.phase)!.add(t.trade)
  }

  // one call per phase (sequence order), enriching its distinct trades
  const enrich = new Map<string, TradeEnrichment>()
  let calls = 0
  for (const phase of sequence.phases) {
    const set = present.get(phase.key)
    if (!set || set.size === 0) continue
    const trades = phase.trades.filter((t) => set.has(t.key))
    const user = buildEnrichUserPrompt(phase, trades, project as ProjectCtx)
    let parsed: TradeEnrichment[] | null = null
    let lastErr = ''
    for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
      calls++
      const obj = safeParseJSON(await llm(ENRICH_SYSTEM, user))
      const out = (obj as { trades?: unknown })?.trades
      const err = validatePhaseEnrichment(trades.map((t) => t.key), out)
      if (!err) parsed = out as TradeEnrichment[]
      else lastErr = err
    }
    if (!parsed) throw new Error(`phase "${phase.key}" enrichment invalid after retry: ${lastErr}`)
    for (const e of parsed) enrich.set(`${phase.key}::${e.trade}`, e)
  }

  const { qcRows, enrichedTaskIds, descByKey } = planFanOut(tasks as TaskRow[], project.org_id, enrich)

  // WRITE (replace discipline): replace QC for the enriched tasks, then set descriptions.
  // Delete-then-insert is the clean replace — no duplicate, no orphan, no second critical
  // (the site_task_qc_one_critical partial unique index is the hard backstop on the insert).
  if (enrichedTaskIds.length) {
    const { error } = await supabase.from('site_task_qc').delete().in('task_id', enrichedTaskIds)
    if (error) throw new Error(`replace QC (delete): ${error.message}`)
  }
  if (qcRows.length) {
    const { error } = await supabase.from('site_task_qc').insert(qcRows)
    if (error) throw new Error(`insert QC: ${error.message}`)
  }
  // descriptions: one update per (phase,trade), not per instance
  for (const [key, description] of descByKey) {
    const [phase, trade] = key.split('::')
    const { error } = await supabase.from('site_tasks').update({ description })
      .eq('project_id', projectId).eq('phase', phase).eq('trade', trade).eq('source', 'generated')
    if (error) throw new Error(`set description for ${key}: ${error.message}`)
  }

  return { calls, tradesEnriched: enrich.size, instances: enrichedTaskIds.length, qcRows: qcRows.length }
}
