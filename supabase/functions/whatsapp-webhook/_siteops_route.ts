// Block A — Stages 2-4 routing. Takes decomposed items (A2) for a RESOLVED project
// and turns them into living updates: task progress + answered QC, tracked problems,
// todos — plus the one-line confirm. Carry-through principle: hold inferences LOOSELY
// (map-or-park, cause-as-suggestion), lean on the confirm net.
//
// All DB access is via an injected supabase client (works against the real client or a
// test mock), mirroring the rest of the webhook.

import type { SiteItem } from './_siteops_extract.ts'
import { loadCadenceMap, computeBlockedTaskEnd, computeTiming, type CadenceMap } from './_siteops_timing.ts'
import { computeImpact, type ImpactResult } from './_siteops_impact.ts'
import { notifyOwnerAssignment, ownerPhone } from './_siteops_assign.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

export interface SiteTaskRow {
  task_id: string
  phase: string
  trade: string
  floor_label: string | null
  unit_label: string | null
  name: string
  status: string
  owner_id?: string | null
  owner_source?: string
}
export interface OrgMember { id: string; name: string }

// A NAMED owner: does the narration's owner_hint resolve to a specific member? (Used both
// for owner resolution and to tell a "named hand-off" apart from a default assignment.)
export function matchOwnerHint(ownerHint: string | null, members: OrgMember[]): string | null {
  if (!ownerHint || !ownerHint.trim()) return null
  const q = ownerHint.toLowerCase().trim()
  const hit = members.find((m) => {
    const n = (m.name ?? '').toLowerCase()
    return n === q || n.split(/\s+/)[0] === q.split(/\s+/)[0] || n.includes(q) || q.includes(n)
  })
  return hit?.id ?? null
}

// Owner resolution — named-in-narration (if it resolves to a member) → supervisor → principal.
// Returns null only if the org has no users at all (shouldn't happen).
export function resolveOwner(ownerHint: string | null, members: OrgMember[], supervisorId: string | null, principalId: string | null): string | null {
  return matchOwnerHint(ownerHint, members) ?? supervisorId ?? principalId ?? null
}

/**
 * Notify the ASSIGNEE at creation so they hear about a new item immediately, not only
 * when the first chase fires — for AUTO- or named assignment alike. Best-effort: never
 * blocks the write. The caller already excludes the PRINCIPAL (the terminal owner, raised
 * by visibility, not pinged); this also skips SELF (the owner IS the sender) and an owner
 * with no WhatsApp number.
 */
async function notifyAssigneeAtCreation(
  c: RouteCtx, a: { kind: 'issue' | 'todo'; itemId: string; ownerId: string; title: string; due: string | null; cause: string | null },
): Promise<void> {
  const phone = await ownerPhone(c.supabase, a.ownerId)
  if (!phone || phone === c.byLabel) return   // no number, or the owner IS the sender → nothing to do
  const { data: by } = await c.supabase.from('wa_registered_numbers').select('name').eq('phone_number', c.byLabel).limit(1).maybeSingle()
  await notifyOwnerAssignment(c.supabase, {
    orgId: c.orgId, ownerPhone: phone, ownerName: ownerName(c, a.ownerId), title: a.title, due: a.due, byName: by?.name ?? null,
    // open a reply-batch so the assignee's "done/sorted" resolves THIS item
    batchItem: { kind: a.kind, id: a.itemId, orgId: c.orgId, projectId: c.projectId, projectName: '', title: a.title, taskName: null, cause: a.cause },
  })
  await c.supabase.from('followup_events').insert({
    org_id: c.orgId, problem_id: a.kind === 'issue' ? a.itemId : null, todo_id: a.kind === 'todo' ? a.itemId : null,
    type: 'status_changed', body: `Assigned to ${ownerName(c, a.ownerId)} — notified`, actor_kind: 'system', actor_id: null,
  })
}
export interface QcRow { id: string; question: string; is_critical: boolean; seq: number; qc_status: string | null }

// ── floor / trade normalisation (for the pre-filter) ─────────────────────────
const ORD: Record<string, string> = {
  ground: 'Ground', gf: 'Ground', g: 'Ground', stilt: 'Stilt', cellar: 'Cellar', basement: 'Cellar',
  first: 'First', '1st': 'First', '1f': 'First', second: 'Second', '2nd': 'Second', '2f': 'Second',
  third: 'Third', '3rd': 'Third', '3f': 'Third', fourth: 'Fourth', '4th': 'Fourth', '4f': 'Fourth',
  fifth: 'Fifth', '5th': 'Fifth', '5f': 'Fifth',
}
/** Pull a floor_label from a free-text hint, or null. */
export function floorFromHint(hint: string | null): string | null {
  if (!hint) return null
  const h = hint.toLowerCase()
  for (const k of Object.keys(ORD)) {
    if (new RegExp(`\\b${k}\\b`).test(h)) return ORD[k]
  }
  return null
}
/** Unit ("Unit A") from a hint, or null. */
function unitFromHint(hint: string | null): string | null {
  if (!hint) return null
  const m = hint.toLowerCase().match(/\bunit\s*([a-z])\b/)
  return m ? `Unit ${m[1].toUpperCase()}` : null
}
/** Trade keywords present in the hint (matched against task name/trade). */
function tradeTokens(hint: string | null): string[] {
  if (!hint) return []
  const TRADES = ['slab', 'column', 'beam', 'plaster', 'block', 'brick', 'footing', 'plinth', 'excavat',
    'pcc', 'backfill', 'tile', 'tiling', 'paint', 'putty', 'wiring', 'conduit', 'plumb', 'waterproof',
    'ceiling', 'door', 'window', 'grill', 'flooring', 'curing', 'shutter', 'reinforc', 'pour', 'cast', 'pile', 'raft']
  const h = hint.toLowerCase()
  return TRADES.filter((t) => h.includes(t))
}

export type TaskResolution =
  | { kind: 'attached'; task: SiteTaskRow }
  | { kind: 'ambiguous'; candidates: SiteTaskRow[] }
  | { kind: 'parked' }

/**
 * Resolve ONE progress/issue item to a task. PURE: pre-filters by floor/unit/trade from the
 * hint (never scans all tasks blindly), then attaches on exactly one, signals ambiguous on
 * several, parks on none. Precision over coverage — a wrong map silently corrupts task state.
 */
export function resolveTask(tasks: SiteTaskRow[], item: SiteItem): TaskResolution {
  const floor = floorFromHint(item.task_hint)
  const unit = unitFromHint(item.task_hint)
  const trades = tradeTokens(item.task_hint)
  const hay = (t: SiteTaskRow) => `${t.name} ${t.trade}`.toLowerCase()
  const tradeOk = (t: SiteTaskRow) => trades.length === 0 || trades.some((tr) => hay(t).includes(tr))
  const floorOk = (t: SiteTaskRow) => !floor || t.floor_label === floor
  const unitOk = (t: SiteTaskRow) => !unit || t.unit_label === unit

  // tightest first: floor ∧ unit ∧ trade, then relax unit, then relax floor.
  const tiers = [
    tasks.filter((t) => floorOk(t) && unitOk(t) && tradeOk(t)),
    tasks.filter((t) => floorOk(t) && tradeOk(t)),
    tasks.filter((t) => tradeOk(t) && trades.length > 0),
  ]
  for (const tier of tiers) {
    if (tier.length === 1) return { kind: 'attached', task: tier[0] }
    if (tier.length > 1) {
      // genuine multi-candidate ambiguity — only if a trade was actually named (else it's noise)
      if (trades.length > 0 || floor) return { kind: 'ambiguous', candidates: tier.slice(0, 8) }
    }
  }
  return { kind: 'parked' }
}

/** Parse a loose date hint ("tomorrow", "friday", "next week") to a Date, else null. */
export function parseWhen(hint: string | null, base: Date): Date | null {
  if (!hint) return null
  const h = hint.toLowerCase().trim()
  const d = new Date(base)
  if (/\btoday\b/.test(h)) return d
  if (/\btomorrow\b/.test(h)) { d.setDate(d.getDate() + 1); return d }
  if (/\bnext week\b/.test(h)) { d.setDate(d.getDate() + 7); return d }
  const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']
  const idx = days.findIndex((w) => h.includes(w))
  if (idx >= 0) {
    let add = (idx - d.getDay() + 7) % 7
    if (add === 0) add = 7   // "friday" said on a friday → next friday
    d.setDate(d.getDate() + add)
    return d
  }
  const iso = h.match(/\d{4}-\d{2}-\d{2}/)
  if (iso) { const p = new Date(iso[0]); if (!isNaN(+p)) return p }
  return null
}

const DONE_RE = /\b(done|finished|completed|complete|cast|poured|laid|over|ayipoyindi|ayopoindi|aindi|ipoyindi)\b/i
const STARTED_RE = /\b(started|starting|ongoing|in progress|going on|begun|begin)\b/i
/** Map a progress statement to the status it implies. */
export function statusFromProgress(text: string, current: string): string {
  if (DONE_RE.test(text)) return 'done'
  if (STARTED_RE.test(text)) return 'active'
  return current === 'not_started' ? 'active' : current
}

// ── QC answering — the restraint, carried into writes (LLM matcher, conservative) ──
const QC_MATCH_SYSTEM = `You decide whether a supervisor's site statements EXPLICITLY answer specific QC checks.
You are STRICT. Mark a QC "confirmed" ONLY when a statement specifically states that QC's checkable fact.
HARD RULE: vague praise ("looks good", "done properly", "work is fine") NEVER confirms anything.
"slab looks good" does NOT answer "cast continuous, no cold joint". When unsure, DO NOT confirm — leaving a QC unanswered is safe; a false confirm is corrupt data.
Output STRICT JSON: {"answers":[{"id":"<qc id>","answer":"<the exact statement that confirms it>"}]}. Include ONLY confirmed QCs. Empty if none clearly match.`

/** Returns the QC rows to confirm (id + the answer text). Conservative; [] when no key/empty. */
export async function matchQc(qc: QcRow[], statements: string[], taskName: string): Promise<{ id: string; answer: string }[]> {
  if (!qc.length || !statements.length) return []
  const OPENAI = Deno.env.get('OPENAI_API_KEY')
  const ANTHROPIC = Deno.env.get('ANTHROPIC_API_KEY')
  const user = `TASK: ${taskName}\nQC CHECKS:\n${qc.map((q) => `- [${q.id}] ${q.question}`).join('\n')}\n\nSTATEMENTS STATED BY SUPERVISOR:\n${statements.map((s) => `- ${s}`).join('\n')}`
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), 12000)
  let raw = ''
  try {
    if (OPENAI) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        signal: ctrl.signal, method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: Deno.env.get('WA_SITEOPS_MODEL') ?? 'gpt-4.1', max_tokens: 400, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: QC_MATCH_SYSTEM }, { role: 'user', content: user }] }),
      })
      if (res.ok) raw = (await res.json()).choices?.[0]?.message?.content ?? ''
    } else if (ANTHROPIC) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        signal: ctrl.signal, method: 'POST',
        headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 400, temperature: 0, system: QC_MATCH_SYSTEM, messages: [{ role: 'user', content: user }] }),
      })
      if (res.ok) raw = (await res.json()).content?.[0]?.text ?? ''
    }
  } catch { /* fall through to [] */ } finally { clearTimeout(t) }
  try {
    const parsed = JSON.parse(raw.replace(/^```json\n?|\n?```$/g, '').trim())
    const ans = Array.isArray(parsed?.answers) ? parsed.answers : []
    const valid = new Set(qc.map((q) => q.id))
    const clean = ans.filter((a: { id?: string; answer?: string }) => a && valid.has(a.id!) && typeof a.answer === 'string' && a.answer.trim())
      .map((a: { id: string; answer: string }) => ({ id: a.id, answer: a.answer.trim() }))
    // dedupe by QC id — several statements can address one check; record it once (answers joined).
    const byId = new Map<string, string>()
    for (const a of clean) byId.set(a.id, byId.has(a.id) ? `${byId.get(a.id)}; ${a.answer}` : a.answer)
    return [...byId.entries()].map(([id, answer]) => ({ id, answer }))
  } catch { return [] }
}

// ── writes ───────────────────────────────────────────────────────────────────
export interface RouteCtx {
  supabase: SB; orgId: string; projectId: string; byLabel: string
  members: OrgMember[]; supervisorId: string | null; principalId: string | null
  narrationId: string | null; now: Date
}
/** Map a user id to a display name (for confirm lines). */
export function ownerName(c: RouteCtx, id: string | null): string {
  if (!id) return 'unassigned'
  return c.members.find((m) => m.id === id)?.name ?? 'owner'
}

export interface ProgressResult { taskId: string; taskName: string; statusFrom: string; statusTo: string; qcConfirmed: { question: string; answer: string }[] }

/** progress → update task status + status_history, answer QC only where explicit. */
export async function applyProgress(c: RouteCtx, task: SiteTaskRow, item: SiteItem): Promise<ProgressResult> {
  const statusFrom = task.status
  const statusTo = statusFromProgress(item.text, statusFrom)
  // QC answering (restraint)
  const { data: qcRows } = await c.supabase.from('site_task_qc').select('id, question, is_critical, seq, qc_status').eq('task_id', task.task_id)
  const qc = (qcRows ?? []) as QcRow[]
  const confirmed = await matchQc(qc, item.qc_statements, task.name)
  for (const a of confirmed) {
    // provenance: which narration answered it + when (the UI shows "✓ … — from narration, 2h ago")
    const { error } = await c.supabase.from('site_task_qc').update({
      answer: a.answer, qc_status: 'confirmed', source_narration_id: c.narrationId, answered_at: c.now.toISOString(),
    }).eq('id', a.id)
    if (error) console.error('[siteops] qc update failed:', error.message)
  }
  if (statusTo !== statusFrom) {
    const { data: cur } = await c.supabase.from('site_tasks').select('status_history').eq('task_id', task.task_id).maybeSingle()
    const history = Array.isArray(cur?.status_history) ? cur.status_history : []
    history.push({ status: statusTo, at: c.now.toISOString(), by: c.byLabel, source: 'narration', narration_id: c.narrationId })
    const { error } = await c.supabase.from('site_tasks').update({ status: statusTo, status_history: history }).eq('task_id', task.task_id)
    if (error) console.error('[siteops] task status update failed:', error.message)
  }
  // OWNERSHIP is SITE-LEVEL: a task INHERITS the project's supervisor (the site owner) by
  // default, so narration never stamps a per-task owner. owner_id is set ONLY when a human
  // overrides it at task level (owner_source='manual', via the UI picker) — and that override
  // is never touched here. (Issues, being discrete items, still carry their own owner.)
  const byId = new Map(qc.map((q) => [q.id, q.question]))
  return { taskId: task.task_id, taskName: task.name, statusFrom, statusTo, qcConfirmed: confirmed.map((a) => ({ question: byId.get(a.id) ?? '', answer: a.answer })) }
}

export interface ProblemResult { id: string | null; title: string; cause: string | null; ownerId: string | null; ownerName: string; followupAt: string | null; deadline: string | null; implication: string | null; taskId: string | null }

/** Insert capture-first: try the full row (deadline + impact), fall back to the base columns if a
 *  Phase-2 column isn't migrated yet — a missing column must never cost us the issue. */
async function insertProblem(supabase: SB, fullRow: Record<string, unknown>): Promise<string | null> {
  let res = await supabase.from('problems').insert(fullRow).select('id').single()
  if (res.error) {
    const { deadline: _d, impact: _i, ...base } = fullRow
    res = await supabase.from('problems').insert(base).select('id').single()
  }
  if (res.error) console.error('[siteops] problem insert failed:', res.error.message)
  return res.data?.id ?? null
}

/**
 * issue → create a problem row.
 * Phase 2.2 TIMING (computeTiming): L1 user date, L2 Follow-up Rules cadence (org override →
 * taxonomy default, keyed by the 2.1 cause), L3 temper by the blocked task's (soft, derived)
 * schedule. Writes next_followup_at (null = not chased) + deadline.
 * Phase 2.3 IMPACT (computeImpact) — GATED: runs ONLY for a real cause (not weather/auspicious) on
 * a scheduled task whose work is IMMINENT (timing.imminent). Far work / project-level issues / soft
 * causes never invoke the LLM. Output is a SUGGESTION ("may delay …"), stored as `impact`.
 */
export async function createProblem(c: RouteCtx, item: SiteItem, taskId: string | null, cadenceMap: CadenceMap): Promise<ProblemResult> {
  const cause = item.cause ?? 'other'                          // constrained (2.1): valid key or 'other'
  const userDate = parseWhen(item.date_hint, c.now)            // L1
  const blockedTaskEnd = await computeBlockedTaskEnd(c.supabase, taskId)   // L3 (soft/derived; null → pure L2)
  const t = computeTiming({ cause, userDate, blockedTaskEnd, now: c.now, cadenceMap }) // soft firmness (this codebase)
  const ownerId = resolveOwner(item.owner_hint, c.members, c.supervisorId, c.principalId)   // named → supervisor → principal
  const nextFollowupAt = t.nextFollowupAt ? t.nextFollowupAt.toISOString() : null
  const deadline = t.deadline ? t.deadline.toISOString().slice(0, 10) : null   // a target DAY

  // ── Phase 2.3 IMPACT GATE ── real cause + scheduled task + imminent work. Anything else: no LLM.
  const realCause = cause !== 'weather' && cause !== 'auspicious'
  let impact: ImpactResult | null = null
  if (realCause && taskId && t.imminent) {
    try { impact = await computeImpact(c.supabase, { text: item.text, cause }, taskId) } catch { impact = null }
  }

  const id = await insertProblem(c.supabase, {
    org_id: c.orgId, project_id: c.projectId, task_id: taskId, source_narration_id: c.narrationId,
    cause, title: item.text, owner_id: ownerId, owner_source: 'auto', status: 'OPEN',
    next_followup_at: nextFollowupAt, deadline, impact,
  })
  // Ping the assignee NOW (auto or named) — unless they're the sender or the principal.
  if (id && ownerId && ownerId !== c.principalId) {
    try { await notifyAssigneeAtCreation(c, { kind: 'issue', itemId: id, ownerId, title: item.text, due: deadline, cause }) }
    catch (e) { console.error('[siteops] assign notify failed:', (e as Error).message) }
  }
  return { id, title: item.text, cause, ownerId, ownerName: ownerName(c, ownerId), followupAt: nextFollowupAt, deadline, implication: impact?.implication ?? null, taskId }
}

export interface TodoResult { id: string | null; text: string; dueDate: string | null }
/** todo → lightweight action item (no cause, no follow-up engine). */
export async function createTodo(c: RouteCtx, item: SiteItem, taskId: string | null): Promise<TodoResult> {
  const due = parseWhen(item.date_hint, c.now)
  const owner = resolveOwner(item.owner_hint, c.members, c.supervisorId, c.principalId)
  const row = { org_id: c.orgId, project_id: c.projectId, task_id: taskId, text: item.text, owner_id: owner, due_date: due ? due.toISOString().slice(0, 10) : null, status: 'OPEN' }
  const { data, error } = await c.supabase.from('todos').insert(row).select('id').single()
  if (error) console.error('[siteops] todo insert failed:', error.message)
  const newId = data?.id ?? null
  if (newId && owner && owner !== c.principalId) {
    try { await notifyAssigneeAtCreation(c, { kind: 'todo', itemId: newId, ownerId: owner, title: item.text, due: row.due_date, cause: null }) }
    catch (e) { console.error('[siteops] assign notify failed:', (e as Error).message) }
  }
  return { id: newId, text: item.text, dueDate: row.due_date }
}

// ── orchestrate Stages 2-3 over all items (testable; the agent adds disambig + send) ──
export interface RouteOutcome {
  progress: ProgressResult[]
  problems: ProblemResult[]
  todos: TodoResult[]
  parked: { item: SiteItem }[]
  ambiguous: { item: SiteItem; candidates: SiteTaskRow[] }[]
}
/**
 * Route every item: progress → attach+QC (or ambiguous/park), issue → problem (task or
 * project level), todo → action item. Writes the unambiguous ones immediately (capture-first);
 * progress items that can't be confidently mapped surface as `ambiguous` (the agent asks) or
 * `parked` (project-level triage). Issues never block on a task — they park to project level.
 */
export async function routeItems(c: RouteCtx, tasks: SiteTaskRow[], items: SiteItem[]): Promise<RouteOutcome> {
  const out: RouteOutcome = { progress: [], problems: [], todos: [], parked: [], ambiguous: [] }
  // Load the org's follow-up cadence ONCE (taxonomy defaults + org overrides) for every issue's timing.
  const hasIssue = items.some((i) => i.type === 'issue')
  const cadenceMap: CadenceMap = hasIssue ? await loadCadenceMap(c.supabase, c.orgId) : new Map()
  for (const item of items) {
    if (item.type === 'todo') {
      const r = resolveTask(tasks, item)
      out.todos.push(await createTodo(c, item, r.kind === 'attached' ? r.task.task_id : null))
      continue
    }
    if (item.type === 'issue') {
      const r = resolveTask(tasks, item)
      out.problems.push(await createProblem(c, item, r.kind === 'attached' ? r.task.task_id : null, cadenceMap))
      continue
    }
    // progress — needs a definite task to update, so it's the only type that disambiguates
    const r = resolveTask(tasks, item)
    if (r.kind === 'attached') out.progress.push(await applyProgress(c, r.task, item))
    else if (r.kind === 'ambiguous') out.ambiguous.push({ item, candidates: r.candidates })
    else out.parked.push({ item })
  }
  return out
}

// ── Stage 4: the confirmation message ────────────────────────────────────────
// Leads with the SITE NAME — that doubles as resolution-confirmation (the sender sees the
// right project matched) — then type-labelled item lines, an HONEST follow-up line, and
// conditional view links. The follow-up line states PRESENT TRUTH (items are owned and carry
// a follow-up date — "tracked"), NOT a promise of active chasing (Block B, not shipped yet):
// "tracked for follow-up" stays true today and the day chasing ships. `md` wraps the headline/
// follow-up/links in WhatsApp markup (*bold*/_italic_); the platform UI passes md:false.
const fmtDay = (iso: string | null): string => {
  if (!iso) return ''
  const d = new Date(iso)
  if (isNaN(+d)) return ''
  const now = new Date()
  const days = Math.round((d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000)
  // near-term (this week) reads better as a weekday; further out needs the date to stay unambiguous.
  return days >= 0 && days <= 6
    ? d.toLocaleDateString('en-IN', { weekday: 'short' })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
}

/** The type-labelled item lines for one project's outcome (shared by single + multi confirm). */
function itemLines(progress: ProgressResult[], problems: ProblemResult[], todos: TodoResult[]): string[] {
  const lines: string[] = []
  for (const p of progress) {
    const qc = p.qcConfirmed.length ? ` (${p.qcConfirmed.map((q) => q.answer).join('; ')} noted)` : ''
    lines.push(`✅ Task update — ${p.taskName}${qc}`)
  }
  for (const pr of problems) {
    // Phase 2.3: the impact suggestion rides along at capture (the most useful moment), as a
    // heads-up — "⚠️ Issue — cement short — may delay 2F slab (Fri)".
    const impact = pr.implication ? ` — ${pr.implication}` : ''
    lines.push(`⚠️ Issue — ${pr.title}${impact}${pr.followupAt ? `, by ${fmtDay(pr.followupAt)}` : ''}`)
  }
  for (const td of todos) {
    lines.push(`📋 To-do — ${td.text}${td.dueDate ? `, ${fmtDay(td.dueDate)}` : ''}`)
  }
  return lines
}

export function buildConfirm(parts: {
  site?: string | null     // the resolved site/project — leads the message (resolution-confirmation)
  progress: ProgressResult[]; problems: ProblemResult[]; todos: TodoResult[]
  parked: number; pendingPick: number; ownerLabel: string
  md?: boolean             // WhatsApp markdown (default); the UI channel passes false (plain text)
  projectId?: string | null  // with appBase, turns the view-links into real tappable deep links
  appBase?: string | null    // web app ORIGIN (e.g. https://briklayflow.vercel.app)
}): string {
  const md = parts.md !== false
  const bold = (s: string) => (md ? `*${s}*` : s)
  const ital = (s: string) => (md ? `_${s}_` : s)

  // ITEM LINES — type-labelled, no owner shown, date if given.
  const lines = itemLines(parts.progress, parts.problems, parts.todos)
  // routing-engine status notes (not type-labelled items): unmapped progress + a pending floor pick.
  if (parts.parked) lines.push(`• ${parts.parked} item${parts.parked > 1 ? 's' : ''} parked for triage`)
  if (parts.pendingPick) lines.push(`• ${parts.pendingPick} need${parts.pendingPick > 1 ? '' : 's'} you to pick the floor`)

  // HEADLINE — site name first, then receipt. Terse + honest when nothing itemised.
  const name = parts.site?.trim()
  const lead = name ? `${name} — got your update, logged` : 'Got your update, logged'
  if (!lines.length) return bold(`${lead}.`)

  const out = [bold(`${lead}:`), '', ...lines]

  // ORIENTATION + LINKS — name WHERE each kind of update now lives so the sender knows where to
  // find and act on it: task progress in that project's TASK MANAGER, issues & to-dos on the
  // SITE DESK (the cross-site tracking hub). The named section IS the tappable destination, so
  // this one block replaces the old generic "View tasks" links AND the "tracked for follow-up"
  // line — orientation without extra length. Shown only for the kinds actually present.
  const hasProgress = parts.progress.length > 0
  const hasFollow = parts.problems.length + parts.todos.length > 0
  const pid = parts.projectId?.trim()
  const base = parts.appBase?.trim()

  // When this confirm is a preamble to a follow-up question (a pending floor pick), end on the
  // question — don't trail "go to your Site Desk" links above a "which one?" prompt.
  if (parts.pendingPick) return out.join('\n')

  if (md && base) {
    const orient = hasProgress && hasFollow
      ? 'Task updates are in your Task Manager; issues & to-dos are tracked on your Site Desk.'
      : hasProgress ? 'Logged in your Task Manager.'
      : 'Tracked on your Site Desk for follow-up.'
    const lns: string[] = []
    if (hasProgress && pid) lns.push(`${bold('Task Manager')} — ${base}/projects/${pid}/tasks`)
    if (hasFollow) lns.push(`${bold('Site Desk')} — ${base}/site-desk`)
    if (lns.length) out.push('', ital(orient), ...lns)
  } else {
    // platform UI channel — name the sections (the app has its own nav, no URLs needed).
    const note = hasProgress && hasFollow ? 'In your Task Manager · tracked on your Site Desk.'
      : hasProgress ? 'Updated in your Task Manager.'
      : hasFollow ? 'Tracked on your Site Desk for follow-up.' : ''
    if (note) out.push('', ital(note))
  }

  return out.join('\n')
}

// ── Stage 4 (multi-project): one confirmation, GROUPED BY PROJECT ─────────────
// Mirrors the transaction agent's multi-project receipt: ONE message, not one per site, with
// each project getting its OWN headline + its items so the sender can catch a mis-attribution
// at a glance. Reuses itemLines() so single + multi format identically. The deep link points at
// the cross-project Site Desk (the natural destination when the update spanned several sites).
export interface ConfirmSection {
  projectName: string | null
  projectId: string
  progress: ProgressResult[]
  problems: ProblemResult[]
  todos: TodoResult[]
  parked: number              // unmapped + (in multi) task-ambiguous progress, surfaced for triage
}
export function buildMultiConfirm(sections: ConfirmSection[], opts: {
  md?: boolean
  appBase?: string | null     // web app ORIGIN — turns the footer into a real Site Desk deep link
  pendingPickTexts?: string[] // leftover items awaiting a project pick (asked separately)
} = {}): string {
  const md = opts.md !== false
  const bold = (s: string) => (md ? `*${s}*` : s)
  const ital = (s: string) => (md ? `_${s}_` : s)

  const blocks: string[] = []
  let followCount = 0
  for (const s of sections) {
    const lines = itemLines(s.progress, s.problems, s.todos)
    if (s.parked) lines.push(`• ${s.parked} item${s.parked > 1 ? 's' : ''} parked for triage`)
    if (!lines.length) continue
    blocks.push([bold(`${s.projectName?.trim() || 'Site'} — logged:`), ...lines].join('\n'))
    followCount += s.problems.length + s.todos.length
  }

  const out: string[] = [blocks.join('\n\n')]

  // ORIENTATION + LINK — same naming as the single confirm: task progress lives in each site's
  // TASK MANAGER (per-project, so no single link — named, not linked), while issues & to-dos
  // across all the sites collect on ONE SITE DESK (the natural cross-site destination → linked).
  const hasProgress = sections.some((s) => s.progress.length > 0)
  const hasFollow = followCount > 0
  const base = opts.appBase?.trim()

  const orient = hasProgress && hasFollow
    ? 'Task updates are in each site’s Task Manager; issues & to-dos are tracked together on your Site Desk.'
    : hasProgress ? 'Task updates are in each site’s Task Manager.'
    : 'Issues & to-dos are tracked on your Site Desk.'
  out.push('', ital(orient))
  if (md && base && hasFollow) out.push(`${bold('Site Desk')} — ${base}/site-desk`)

  return out.join('\n')
}
