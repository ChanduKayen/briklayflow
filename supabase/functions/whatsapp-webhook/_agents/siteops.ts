// Block A — the real SITEOPS agent. A3 wires the full pipeline onto the A1 capture shell:
//   decompose (Stage 1) → resolveProject + resolveTask (Stage 2) → route to progress/
//   issue/todo + answer QC (Stage 3) → one-line confirm (Stage 4).
// Carry-through: hold inferences LOOSELY, lean on the confirm net. map-or-park (never
// force-map), disambiguate ONLY on genuine progress ambiguity (a need-to-ask), cause as a
// surfaced suggestion. Disambiguation reuses the AWAIT_PROJECT mechanism (openConversation +
// the dispatcher's ANSWERS_PENDING → answer()), not a new interaction.

import { send } from '../_format.ts'
import { resolveProject, planItemProjects, type ProjectRef, type ItemPlan } from '../_resolve.ts'
import { openConversation, closeConversation, type ConvoRow } from '../_conversation.ts'
import { decompose, callLLM, safeParse, type SiteItem } from '../_siteops_extract.ts'
import { decomposeImage } from '../_siteops_vision.ts'
import { loadCandidates, prefilterCandidates, groundingLabels, type Candidate } from '../_siteops_candidates.ts'
import { planPhotoItems, resolveTypedPick, type PickCandidate } from '../_siteops_attach.ts'
import type { CaptureRef } from '../_wa_message_map.ts'
import { distillSignal } from '../_siteops_reanalyze.ts'
import { planCorrection } from '../_siteops_correct.ts'
import { classifyReaction, isRetraction } from '../_siteops_verbs.ts'
import { reconstructParkedSlots, type ParkedRow } from '../_siteops_lateanswer.ts'
import { decideAssociation, isBareAffirmation, photoRelatedness, type AssocVerdict } from '../_siteops_assoc.ts'
import {
  routeItems, applyProgress, buildConfirm, buildMultiConfirm, parseWhen,
  type RouteCtx, type RouteOutcome, type SiteTaskRow, type OrgMember,
  type ConfirmSection, type ProgressResult, type ProblemResult, type TodoResult,
} from '../_siteops_route.ts'
import { loadCadenceMap, type CadenceMap } from '../_siteops_timing.ts'
import {
  getOpenBatch, dropBatchItems, classifyReplyFragment, scopeBatchToProject, interpretStatus,
  isBareAck,
  type OpenBatch, type BatchItem,
} from '../_siteops_batch.ts'
import {
  composeReadback, assertAllApplied,
  type Terminal, type TerminalOutcome,
} from '../_siteops_resolution.ts'
import { resolveInbound } from '../_siteops_resolution_llm.ts'
// The engine, bundled for Deno — used to materialise a project's full task set on first WhatsApp touch.
import { buildProjectVM } from '../../_shared/siteops-engine.js'

export type SiteopsCtx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  from: string
  orgId: string
  wamid: string
  lang: 'en' | 'te' | 'te-en' | 'hi'
  // Present when the inbound message is an image the router sent to SITEOPS. `storagePath` is the
  // ALREADY-uploaded object (rough-entry-media) from _normalize's storeMedia — we link it, never re-upload.
  image?: { base64: string; mime: string; caption: string; storagePath?: string | null }
}

const TASK_COLS = 'task_id, phase, trade, floor_label, unit_label, name, status, node_key, task_type_id, owner_id, owner_source'

/** STEP 5b — the capture a pick send carries so the drainer maps its outbound wamid to THIS convo. At
 *  park time (commitInterrupted) we look the wamid up by convo_id and store it as the parked row's
 *  question_wamid, so a later quoted-reply to the question can recover the parked pick. */
const pickCapture = (convoId: string | null, projectId: string | null): CaptureRef | undefined =>
  convoId ? { ref_kind: 'pick', convo_id: convoId, project_id: projectId } : undefined

/** Prefer engine rows (with node_key) over legacy flat rows and dedup by node_key — so the agent
 *  matches/updates exactly the rows the UI's engine Sequence view reads, with no duplicate candidates
 *  and no updates landing on a no-node_key row the UI ignores. Falls back to all rows for stack-less
 *  projects that have no engine tasks. */
function engineTasks(rows: SiteTaskRow[]): SiteTaskRow[] {
  const engine = [...new Map(rows.filter((t) => t.node_key).map((t) => [t.node_key as string, t])).values()]
  return engine.length > 0 ? engine : rows
}

/**
 * Ensure a project's full engine task set exists as site_tasks rows, so a WhatsApp message can reach
 * a task that was never opened in the UI (rows are otherwise lazily materialised only on drawer-open).
 * Idempotent — inserts ONLY the node_keys that don't exist yet, mirroring the UI's materialise shape.
 * Best-effort: a failure never blocks the message (matching falls back to whatever rows are present).
 */
async function materializeProjectTasks(ctx: SiteopsCtx, projectId: string): Promise<Set<string>> {
  // Returns the project's CURRENT VM fold-id set (every node_key the UI overlay can render). The
  // write path uses it for the `visibleInVM` check (Step-1 diagnostic / Step-3 guardrail).
  const vmKeys = new Set<string>()
  try {
    let pr = await ctx.supabase.from('projects')
      .select('org_id, name, construction_stack, has_common_areas, common_systems, suppressed_tasks').eq('project_id', projectId).maybeSingle()
    if (pr.error) pr = await ctx.supabase.from('projects')
      .select('org_id, name, construction_stack, has_common_areas').eq('project_id', projectId).maybeSingle()
    const project = pr.data
    const stack = project?.construction_stack
    if (!stack) { console.log(`[siteops:materialize] project=${projectId} HAS NO construction_stack — cannot generate tasks`); return vmKeys }
    const { data: existing } = await ctx.supabase.from('site_tasks').select('node_key, status').eq('project_id', projectId)
    const completion = new Map<string, 'active' | 'done'>()
    const seen = new Set<string>()
    for (const r of (existing ?? [])) {
      if (r.node_key) { seen.add(r.node_key); if (r.status === 'active' || r.status === 'done') completion.set(r.node_key, r.status) }
    }
    const vm = buildProjectVM(projectId, stack, completion, {
      name: project?.name ?? projectId, dryRun: true,
      hasCommonAreas: !!project?.has_common_areas, hasExternalWorks: !!project?.has_common_areas,
      commonSystems: project?.common_systems ?? [], suppressedTasks: project?.suppressed_tasks ?? [],
    })
    const rows: Record<string, unknown>[] = []
    for (const f of vm.floors) for (const b of f.blocks) for (const t of b.tasks) {
      vmKeys.add(t.nodeKey)
      if (seen.has(t.nodeKey)) continue
      seen.add(t.nodeKey)
      rows.push({
        org_id: project.org_id, project_id: projectId, node_key: t.nodeKey, task_type_id: t.taskType,
        name: t.label, trade: t.trade, phase: t.layer,
        floor_label: f.name, unit_label: t.nodeKey.includes('/') ? (b.name === 'Whole floor' ? null : b.name) : null,
        seq_no: t.seqNo, status: 'not_started', source: 'generated', placement_source: 'authored',
      })
    }
    if (rows.length) {
      const { error } = await ctx.supabase.from('site_tasks').insert(rows)
      if (error) console.error('[siteops:materialize] insert FAILED:', error.message)
    }
    console.log(`[siteops:materialize] project=${projectId} existingRows=${(existing ?? []).length} vmNodeKeys=${vmKeys.size} inserted=${rows.length}`)
  } catch (e) {
    console.error('[siteops:materialize] ENGINE/BUILD ERROR:', (e as Error).message, (e as Error).stack)
  }
  return vmKeys
}

// Web app ORIGIN for the deep links in the confirm. Same env the transaction agent uses
// (WA_APP_LINK); we take its origin and append the project route in buildConfirm.
const APP_BASE = (() => {
  const b = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app'
  try { return new URL(b).origin } catch { return 'https://briklayflow.vercel.app' }
})()

/**
 * Send the site-update confirmation. For a SINGLE task update (no issues/to-dos), attach a tappable
 * "View task" button that deep-links straight to THAT task in the Task Manager — the app opens the
 * task's drawer focused (mirrors the Day Book "View →" focus). Anything richer (issues/to-dos/multi)
 * keeps the plain text confirm with its section links.
 */
async function sendTaskConfirm(
  ctx: SiteopsCtx,
  meta: { org_id: string; wamid: string },
  site: string | null,
  projectId: string,
  outc: { progress: ProgressResult[]; problems: ProblemResult[]; todos: TodoResult[]; parked: number },
  // STEP 4a — capture the readback's outbound wamid against the objects it confirms (Step 4b/5 resolve
  // a later reaction / quoted-reply back to them). Undefined → send unchanged.
  capture?: CaptureRef,
): Promise<void> {
  const single = outc.progress.length === 1 && outc.problems.length === 0 && outc.todos.length === 0 ? outc.progress[0] : null
  const base = { site, progress: outc.progress, problems: outc.problems, todos: outc.todos, parked: outc.parked, pendingPick: 0, ownerLabel: 'you', projectId, appBase: APP_BASE }
  if (single?.nodeKey && APP_BASE) {
    const url = `${APP_BASE}/projects/${projectId}/tasks?task=${encodeURIComponent(single.nodeKey)}`
    await send(ctx.supabase, ctx.from, { kind: 'cta', body: buildConfirm({ ...base, ctaMode: true }), cta: { text: 'View task', url } }, { ...meta, capture })
    return
  }
  await send(ctx.supabase, ctx.from, { kind: 'text', body: buildConfirm(base) }, { ...meta, capture })
}

async function findPrincipal(supabase: SiteopsCtx['supabase'], orgId: string): Promise<string | null> {
  const { data } = await supabase.from('user_profiles').select('id').eq('org_id', orgId).eq('role', 'principal').limit(1).maybeSingle()
  return data?.id ?? null
}
async function loadMembers(supabase: SiteopsCtx['supabase'], orgId: string): Promise<OrgMember[]> {
  const { data } = await supabase.from('user_profiles').select('id, name').eq('org_id', orgId)
  return (data ?? []) as OrgMember[]
}
async function loadSupervisor(supabase: SiteopsCtx['supabase'], projectId: string): Promise<string | null> {
  const { data } = await supabase.from('projects').select('supervisor_id').eq('project_id', projectId).maybeSingle()
  return data?.supervisor_id ?? null
}
/** Build the owner-resolution context once (members + supervisor + principal). */
async function ownerCtx(supabase: SiteopsCtx['supabase'], orgId: string, projectId: string) {
  const [members, supervisorId, principalId] = await Promise.all([
    loadMembers(supabase, orgId), loadSupervisor(supabase, projectId), findPrincipal(supabase, orgId),
  ])
  return { members, supervisorId, principalId }
}

/** Link a stored photo (rough-entry-media, NOT re-uploaded — bucket/object_path, signed URL minted at
 *  read time) to a SiteOps object as one row in the shared attachments table. Best-effort: never blocks
 *  the route. role='creation' (fresh capture) or 'answer' (evidence replying to a chase). */
async function attachImage(
  ctx: SiteopsCtx, parentType: 'problem' | 'todo' | 'site_task', parentId: string,
  storagePath: string, caption: string | null, role: 'creation' | 'answer',
): Promise<void> {
  const { error } = await ctx.supabase.from('attachments').insert({
    org_id: ctx.orgId, parent_type: parentType, parent_id: parentId, role,
    bucket: 'rough-entry-media', object_path: storagePath, caption: caption?.trim() || null, created_by: null,
  })
  if (error) console.error('[siteops:attach] insert failed:', error.message)
}

/** A chase-reply PHOTO → attach it as ANSWER evidence to the chased issue/snag AND write the
 *  "replied with a photo" line to its followup_events — the SAME stream the task-feed chip reads
 *  (useTrailStates), so the loop closes VISIBLY. Never spawns a fresh object (decision (a)). */
async function answerWithPhoto(ctx: SiteopsCtx, item: { kind: 'issue' | 'todo'; id: string; orgId: string }, storagePath: string, caption: string | null): Promise<void> {
  await attachImage(ctx, item.kind === 'issue' ? 'problem' : 'todo', item.id, storagePath, caption, 'answer')
  await trailEvent(ctx, item, 'reply_received', `Replied with a photo${caption?.trim() ? ` — "${caption.trim()}"` : ''}`, await senderUserId(ctx))
}

/** STEP 3 ATTACH axis — a fresh photo item matched an EXISTING open item: attach the photo as evidence
 *  to it (no twin). issue/todo get role='answer' + a reply_received trail (answerWithPhoto); a task gets
 *  role='creation' evidence (photos never CREATE tasks, but can document one). Best-effort. */
async function attachExistingEvidence(ctx: SiteopsCtx, target: { kind: string; id: string }, storagePath: string, caption: string | null): Promise<void> {
  if (target.kind === 'issue' || target.kind === 'todo') {
    await answerWithPhoto(ctx, { kind: target.kind, id: target.id, orgId: ctx.orgId }, storagePath, caption)
  } else if (target.kind === 'task') {
    await attachImage(ctx, 'site_task', target.id, storagePath, caption, 'creation')
  }
}

/** Interrupt (registry contract — mirrors TRANSACTION/PROCUREMENT commitInterrupted): a new message
 *  interrupted an OPEN SITEOPS pick. The pick exists BECAUSE classification was ambiguous, so we must
 *  NOT auto-commit a probably-wrong guess (that chases the wrong person) AND must NOT silently drop the
 *  observation. PARK it: write the raw observation and/or photo evidence + the candidate shortlist into
 *  siteops_unplaced (the "to place" store), close the conversation CLEANLY (CLOSED = handled, not the
 *  raw ABANDONED that dropped the item before), and return a one-line ack the dispatcher folds into the
 *  interrupting message's reply. The item survives; the interpretation was best-effort. */
export async function commitInterruptedSiteops(ctx: SiteopsCtx, convo: ConvoRow): Promise<string> {
  const slots = (convo.slots_so_far ?? {}) as Record<string, unknown>
  const kind = typeof slots.kind === 'string' ? slots.kind : null
  const image = (slots.image ?? null) as { storagePath?: string; caption?: string | null } | null
  // Fresh-observation picks carry the item(s); answer-evidence picks carry only the photo. The typed
  // pick (Step 3) carries BOTH — a held SiteItem to create-if-new AND the photo — so it must preserve
  // the observation, not just the photo (else the interpretation half is silently dropped on interrupt).
  const observation =
    kind === 'siteops_disambig' ? (slots.item ?? null)
    : kind === 'siteops_typed_pick' ? (slots.item ?? null)
    : kind === 'siteops_project' ? (Array.isArray(slots.items) && slots.items.length ? { items: slots.items } : null)
    : null
  const objectPath = image?.storagePath ?? null
  const closeClean = () => closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'parked to place' })

  // STEP 2 — a siteops_photo ENRICHMENT WINDOW carries NO unresolved work: its objects already exist and
  // were read back; the window is pure enrich-opportunity. Interrupting it (a SECOND photo, or an
  // unrelated message routed fresh) must NOT fabricate a phantom siteops_unplaced row for an
  // already-placed thing — that would pollute the "to place" queue with non-actionable cards. Close CLEAN
  // (handled), no park. (It carries no observation and no photo path, so it would reach the clean close
  // below anyway; explicit here so a future slots change can't accidentally route it into a park.)
  if (kind === 'siteops_photo') { await closeClean(); return '' }

  // Nothing recoverable to preserve (e.g. an answer-evidence pick with no photo carried) → close cleanly, no phantom row.
  if (observation == null && !objectPath) { await closeClean(); return '' }

  const reason = kind === 'siteops_disambig' ? 'disambig'
    : kind === 'siteops_typed_pick' ? 'typed_pick'
    : kind === 'siteops_project' ? 'project'
    : kind === 'siteops_photo_pick' ? 'photo_pick'
    : kind === 'siteops_batch_collision' ? 'batch_collision'
    : 'floor'
  const { data: ins, error } = await ctx.supabase.from('siteops_unplaced').insert({
    org_id: ctx.orgId,
    project_id: (slots.project_id as string | null) ?? null,
    reason,
    observation,
    candidates: slots.candidates ?? slots.shortlist ?? null,   // typed pick stores the shortlist — keep it to rank the later placement
    bucket: objectPath ? 'rough-entry-media' : null,
    object_path: objectPath,
    caption: image?.caption ?? (typeof slots.piece_text === 'string' ? slots.piece_text : null),
    narration_id: (slots.narration_id as string | null) ?? null,
    sender_number: ctx.from,
    created_by: null,
  }).select('id').single()
  if (error) console.error('[siteops:park] siteops_unplaced insert failed:', error.message)
  // STEP 5b — stamp the PARKED row with the pick question's OUTBOUND wamid (learned via the Step 4a map,
  // keyed on this convo), so a later quoted-reply to that question recovers the park. Best-effort: the
  // map row may not exist yet (fast interrupt before the drainer ran) and question_wamid may be
  // unmigrated — neither can be allowed to fail the park (the observation must survive regardless).
  if (ins?.id) {
    try {
      const { data: m } = await ctx.supabase.from('wa_message_map').select('outbound_wamid').eq('convo_id', convo.id).maybeSingle()
      if (m?.outbound_wamid) await ctx.supabase.from('siteops_unplaced').update({ question_wamid: m.outbound_wamid }).eq('id', ins.id)
    } catch (e) { console.warn('[siteops:park] question_wamid stamp skipped:', (e as Error).message) }
  }
  await closeClean()
  return objectPath ? `Kept that photo to place later.` : `Kept your earlier note to place later.`
}

const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
/** First few words of an item's title — the short label for the readback line. */
const shortLabel = (title: string) => title.trim().split(/\s+/).slice(0, 3).join(' ')

/** Append one trail event (B1) for a batch item. actorId present → a human reply. */
// Returns the inserted followup_events id (or null on failure) — the v2 executor binds a resolve's undo to
// this id (active_resolve_event). Additive: every other caller ignores the return.
async function trailEvent(ctx: SiteopsCtx, item: { kind: 'issue' | 'todo'; id: string; orgId: string }, type: string, body: string, actorId: string | null, pendingReanalysis = false): Promise<string | null> {
  const row = {
    org_id: item.orgId,
    problem_id: item.kind === 'issue' ? item.id : null,
    todo_id: item.kind === 'todo' ? item.id : null,
    type, body, actor_kind: actorId ? 'user' : 'system', actor_id: actorId ?? null,
  }
  // pending_reanalysis marks a pre-Step-3 enrichment so rich re-analyze can harvest it later. Degrade if
  // the column isn't applied yet (capture-first: a trail write must never fail the flow).
  let ins = await ctx.supabase.from('followup_events').insert(pendingReanalysis ? { ...row, pending_reanalysis: true } : row).select('id').single()
  if (ins.error && pendingReanalysis) ins = await ctx.supabase.from('followup_events').insert(row).select('id').single()
  if (ins.error) { console.error('[siteops:trail] insert failed:', ins.error.message); return null }
  return ins.data?.id ?? null
}
/** The replying supervisor's user_id (for trail attribution), or null. */
async function senderUserId(ctx: SiteopsCtx): Promise<string | null> {
  const { data } = await ctx.supabase.from('wa_registered_numbers')
    .select('user_id').eq('phone_number', ctx.from).eq('is_active', true).limit(1).maybeSingle()
  return data?.user_id ?? null
}
/** The sender's display name (registered team member), stamped on the narration so the task feed
 *  shows WHO sent each WhatsApp update — not a faceless "WhatsApp". Null when the number is unknown. */
async function senderName(ctx: SiteopsCtx): Promise<string | null> {
  const uid = await senderUserId(ctx)
  if (!uid) return null
  const { data } = await ctx.supabase.from('user_profiles').select('name').eq('id', uid).maybeSingle()
  return data?.name ?? null
}

// Deeper per-message JUDGE — given the issue + the assignee's reply, decide whether it's
// truly RESOLVED or still alive, with a one-line REASON shown in the UI as the why. Reuses
// the same LLM client as decompose; conservative (keep-open when unsure); understands
// non-English replies the keyword layer can't.
const JUDGE_SYSTEM = `You decide whether a construction-site ISSUE is now RESOLVED, based on the assignee's reply.
RULES:
- RESOLVED only if the reply clearly says the problem is fixed / cleared / done / delivered / arrived / settled.
- KEEP OPEN if the reply is progress-but-not-done, a promise or ETA, a blocker, a question, or unclear.
- Be conservative: when in doubt, KEEP OPEN — never wrongly close an issue.
- Replies may be in English, Telugu, Hindi, or a mix — understand the meaning, not just keywords.
Reply ONLY with JSON: {"resolved": true|false, "reason": "<one short sentence a site manager would read, grounded in the reply>"}.`

async function judgeResolution(issue: { title: string; cause: string | null }, reply: string): Promise<{ resolved: boolean; reason: string } | null> {
  try {
    const user = `Issue: "${issue.title}" (cause: ${issue.cause ?? 'other'}).\nAssignee's reply: "${reply.slice(0, 400)}".\nIs the issue resolved?`
    const parsed = safeParse(await callLLM(JUDGE_SYSTEM, user)) as { resolved?: unknown; reason?: unknown } | null
    if (!parsed || typeof parsed.resolved !== 'boolean') return null
    return { resolved: parsed.resolved, reason: typeof parsed.reason === 'string' ? parsed.reason.trim().slice(0, 200) : '' }
  } catch { return null }
}

/**
 * Apply a reply to ONE batch item: log the reply, then either RESOLVE it, or keep
 * it open and RE-TIME the next chase (to a stated date, else the cause cadence).
 * For ISSUES the resolve/keep-open call is an LLM judgment whose REASON is recorded
 * (the UI's "why"); to-dos keep the simple keyword strike-off. Always appends to the
 * item's trail (B1). Returns the resolved/open verdict.
 */
async function applyBatchResolution(
  ctx: SiteopsCtx, item: BatchItem, status: 'resolved' | 'still_open' | 'unknown',
  replyText: string, cadenceMap: CadenceMap, actorId: string | null, now: Date,
  opts: { bareAck?: boolean; force?: 'resolve' | 'addressing'; reason?: string; out?: { resolveEvent?: string } } = {},
): Promise<'resolved' | 'open'> {
  // The bare-ack fast path (cardinality, no LLM): trail it as `bare_ack` so the feed shows WHY the chase
  // advanced, and NEVER consult the judge — an ack is engagement, never closure, so it can only ADDRESS.
  await trailEvent(ctx, item, opts.bareAck ? 'bare_ack' : 'reply_received', replyText.slice(0, 180), actorId)

  // ISSUES → LLM judgment (with reason); fall back to the keyword status if the model is
  // unavailable. TO-DOS → keyword strike-off. A bare ack skips the judge (deterministic ADDRESSING).
  // opts.force — the v2 EXECUTOR applies a decision the LADDER already made; it must NOT re-judge (a second
  // LLM call that could contradict the terminal), so force honors resolve/addressing verbatim.
  let resolved: boolean
  let reason = opts.reason ?? ''
  if (opts.force) {
    resolved = opts.force === 'resolve'
  } else if (opts.bareAck) {
    resolved = false                       // an ack advances, never closes — RESOLVE stays behind the model
  } else if (item.kind === 'issue') {
    const judged = await judgeResolution({ title: item.title, cause: item.cause }, replyText)
    resolved = judged ? judged.resolved : status === 'resolved'
    reason = judged?.reason ?? ''
  } else {
    resolved = status === 'resolved'
  }

  if (resolved) {
    const note = reason || replyText.trim().slice(0, 140)
    if (item.kind === 'issue') {
      // Trail FIRST so its id exists as the FK target, then stamp it as the ACTIVE resolve — the undo binds
      // to this exact event, so a later re-resolve (new event) makes a stale old undo no-op.
      const eid = await trailEvent(ctx, item, 'status_changed', note ? `Resolved — ${note}` : 'Resolved — confirmed by reply', actorId)
      await ctx.supabase.from('problems').update({ status: 'RESOLVED', next_followup_at: null, active_resolve_event: eid }).eq('id', item.id)
      if (opts.out) opts.out.resolveEvent = eid ?? undefined
    } else {
      await ctx.supabase.from('todos').update({ status: 'DONE' }).eq('id', item.id)
      await trailEvent(ctx, item, 'status_changed', note ? `Done — “${note}”` : 'Done — confirmed by reply', actorId)
    }
    return 'resolved'
  }

  // kept alive — re-time the next chase (to a stated date, else the cause cadence)
  const when = parseWhen(replyText, now)
  if (item.kind === 'issue') {
    let next: Date
    if (when && when.getTime() > now.getTime()) next = when
    else {
      const row = cadenceMap.get(item.cause ?? 'other') ?? cadenceMap.get('other') ?? { clock: 2, cadence: 3 }
      const days = row.cadence ?? row.clock ?? 2
      next = new Date(now.getTime() + days * 86_400_000)
    }
    // a reply = engagement → advance OPEN → ADDRESSING, and re-time. The judgment REASON
    // (the why we kept it alive) rides the status entry shown in the UI.
    const { data: cur } = await ctx.supabase.from('problems').select('status').eq('id', item.id).maybeSingle()
    const advancing = cur?.status === 'OPEN'
    await ctx.supabase.from('problems').update({ next_followup_at: next.toISOString(), ...(advancing ? { status: 'ADDRESSING' } : {}) }).eq('id', item.id)
    const why = reason || (when ? `expected ${fmtDay(next)}` : 'will check back')
    await trailEvent(ctx, item, 'status_changed', advancing ? `Now addressing — ${why}` : `Kept open — ${why}`, actorId)
  } else if (when) {
    await ctx.supabase.from('todos').update({ due_date: when.toISOString().slice(0, 10) }).eq('id', item.id)
  }
  return 'open'
}

// ── v2 EXECUTOR (Layer 2a) — apply the AUTHORITATIVE terminals, capture REAL outcomes, one honest reply ──
// executeResolution decided; this applies. Each terminal → its effect via the EXISTING machinery, wrapped
// to capture ok/failed, then ONE combined readback (composeReadback). NO effect is ever dropped: a failed
// object_created (and any not-yet-wired kind) PARKS to siteops_unplaced so "saved for review" in the reply
// is TRUE — honest-reply AND actually-preserved, never the eat wearing an apology. The ladder already
// judged, so object_updated applies with `force` (no re-judge). assertAllApplied backs the no-drop.
// (The undo button on a resolve readback is Layer 2b; here the readback is plain text.)
export interface ExecCtx {
  itemsById: Map<string, BatchItem>       // candidate/batch items by id, to resolve an update's target
  labelById: Map<string, string>          // human title for EVERY offered candidate (not just batch items) —
                                          // a FAILED outcome's readback label resolves here, NEVER from the uuid
  cadenceMap: CadenceMap
  actorId: string | null
  now: Date
  narrationId: string | null
  projectId?: string | null               // THE project (singular unit) — object_created defaults here when
                                          // the item carries no resolvable project_hint (spec: no match → CREATE)
  readbackSuffix?: string                 // appended to the combined readback (e.g. the interim
                                          // pending_stage2 truth: "· 1 more saved for review")
}

function toSiteItem(it: { kind: 'issue' | 'snag'; detail: string; location: string | null; project_hint: string | null }): SiteItem {
  return { type: 'issue', text: it.detail, task_hint: it.location, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: it.project_hint }
}
// The human label for a terminal's readback line. RULE: a terminal outcome may NEVER surface a raw id to a
// human — for an update we look the target up in the candidate-title map (all offered candidates, not just the
// open batch) and fall back to a generic phrase, but NEVER to `target_id`. terminalObservation (the durable
// park record, machine-facing) keeps the id; this (human-facing) one must not.
function terminalLabel(t: Terminal, labelById?: Map<string, string>): string {
  if (t.kind === 'object_created') return shortLabel(t.item.detail)
  if (t.kind === 'object_updated') {
    const l = labelById?.get(t.update.target_id)
    return l && l.trim() ? l : 'that item'
  }
  if (t.kind === 'queued_as_evidence') return 'photo'
  if (t.kind === 'question_asked') return 'question'
  return ''
}
function terminalObservation(t: Terminal): string {
  if (t.kind === 'object_created') return t.item.detail
  if (t.kind === 'object_updated') return `update ${t.update.target_id}: ${t.update.reason}`
  return t.kind
}
// `replay` (→ the jsonb `candidates` column) carries the structured payload a distinguished park needs so a
// later phase can act on the row mechanically — e.g. a non_batch_target park stores the update + its label so
// Phase 3's fresh path can re-apply it. Null for the plain "couldn't place" parks.
// AUDIT #4/#7 — a park must carry every piece of context the flow already holds: THE resolved project
// (else the replay re-asks what we knew) and the inbound photo's bucket/object_path (else "photo saved"
// names an unfindable photo — the eat wearing a receipt).
async function parkObservation(ctx: SiteopsCtx, observation: string, reason: string, narrationId: string | null, replay: unknown = null, opts: { projectId?: string | null } = {}): Promise<void> {
  await ctx.supabase.from('siteops_unplaced').insert({
    org_id: ctx.orgId, project_id: opts.projectId ?? null, reason, observation,
    candidates: replay,
    bucket: ctx.image?.storagePath ? 'rough-entry-media' : null,
    object_path: ctx.image?.storagePath ?? null,
    caption: ctx.image?.caption?.trim() || null,
    narration_id: narrationId, sender_number: ctx.from, created_by: null,
  })
}

// ── UNDO (Layer 2b) — the one-tap safety mechanism that EARNS the auto-resolve rung ──────────────────
// A supervisor taps "Not resolved" on a resolve readback → the reply-to's context.id (quotedWamid) resolves
// back through the 4a wa_message_map to the SPECIFIC issue + resolve event this readback was for. Reopen
// ONLY if that resolve is still the active one (problems.active_resolve_event === the bound event id):
//   • idempotent — already-open (active null) → no-op.
//   • BOUNDED to its event — a later legitimate re-resolve overwrote active_resolve_event (E1→E2), so the
//     stale old button no-ops and can't clobber the correct re-resolution. Never a blind "reopen issue X".
export async function handleUndoResolve(ctx: SiteopsCtx, quotedWamid: string): Promise<boolean> {
  const { data: map } = await ctx.supabase.from('wa_message_map').select('object_refs').eq('outbound_wamid', quotedWamid).maybeSingle()
  const refs = ((map?.object_refs ?? []) as { kind: string; id: string; event?: string }[]).filter((r) => r.kind === 'issue' && r.event)
  if (!refs.length) return false   // not an undo-able readback → let the dispatcher fall through

  const actorId = await senderUserId(ctx)
  const now = new Date()
  let reopened = 0
  for (const r of refs) {
    const { data: prob } = await ctx.supabase.from('problems').select('status, active_resolve_event').eq('id', r.id).maybeSingle()
    // BOUNDED + stale-safe: reopen ONLY if THIS resolve is still the active one. A later re-resolve
    // overwrote active_resolve_event (E1→E2), a prior reopen nulled it, or the row is gone → no-op. Never
    // a blind "reopen issue X" — that would clobber a since-correct re-resolution.
    if (!prob || prob.active_resolve_event !== r.event) continue
    const next = new Date(now.getTime() + 86_400_000).toISOString()   // back on the chase tomorrow
    await ctx.supabase.from('problems').update({ status: 'ADDRESSING', active_resolve_event: null, next_followup_at: next }).eq('id', r.id)
    await trailEvent(ctx, { kind: 'issue', id: r.id, orgId: ctx.orgId }, 'reopened', 'Reopened — you tapped “Not resolved”', actorId)
    reopened++
  }
  if (reopened) await send(ctx.supabase, ctx.from, { kind: 'text', body: 'Reopened — back on the chase.' }, { org_id: ctx.orgId, wamid: ctx.wamid })
  return true   // we handled the undo tap (a stale/idempotent no-op is still "handled")
}

// question_asked → open the pick through an EXISTING proven resume, storing exactly the offered set in the
// conversation slots (same-set-in / same-set-validated-out — the conversation twin of the planner's
// candidate-membership guard). which_item confirms a LOW/un-offered update (→ ADDRESSING on confirm; RESOLVE
// stays behind the model); which_project sites a new item. Both carry the "None — it's new" / project-pick
// escapes the resumes already implement.
async function askResolutionQuestion(ctx: SiteopsCtx, t: Extract<Terminal, { kind: 'question_asked' }>, ex: ExecCtx): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  if (t.about === 'which_item' && t.update) {
    const item = ex.itemsById.get(t.update.target_id)
    if (!item) return
    const cand = { id: item.id, kind: item.kind, orgId: item.orgId, projectId: item.projectId, projectName: item.projectName, title: item.title, cause: item.cause }
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: `confirm ${shortLabel(item.title)}`,
      slots: { kind: 'siteops_batch_collision', status: 'still_open', piece_text: t.update.reason, candidates: [cand], project_id: item.projectId ?? null, narration_id: ex.narrationId, image: null },
      lastMessageId: ctx.wamid,
    })
    // ladder context in the prompt — the question IS a pre-consequence readback (what confirm does).
    await send(ctx.supabase, ctx.from, {
      kind: 'list',
      body: `Is this about *${shortLabel(item.title)}*? Confirming marks it addressed — or is it new?`,
      button: 'Pick',
      rows: [{ id: 'pick:1', title: shortLabel(item.title).slice(0, 24) }, { id: 'pick:2', title: "None — it's new" }],
    }, meta)
    return
  }
  if (t.about === 'which_project' && t.item) {
    const { data: projRows } = await ctx.supabase.from('projects').select('project_id, name').eq('org_id', ctx.orgId).eq('status', 'Active')
    const cands = ((projRows ?? []) as { project_id: string; name: string }[]).map((p) => ({ id: p.project_id, name: p.name }))
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: 'which project?',
      slots: { kind: 'siteops_project', items: [toSiteItem(t.item)], candidates: cands, narration_id: ex.narrationId, image: null },
      lastMessageId: ctx.wamid,
    })
    await send(ctx.supabase, ctx.from, {
      kind: 'list', body: `Which project is *${shortLabel(t.item.detail)}* for?`, button: 'Pick project',
      rows: cands.slice(0, 10).map((c, i) => ({ id: `pick:${i + 1}`, title: c.name.slice(0, 24) })),
    }, meta)
  }
}

export async function applyTerminals(ctx: SiteopsCtx, terminals: Terminal[], ex: ExecCtx): Promise<TerminalOutcome[]> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const outcomes: TerminalOutcome[] = []
  const resolvedRefs: { kind: string; id: string; event: string }[] = []   // resolved ISSUES → the undo binding
  for (const t of terminals) {
    try {
      if (t.kind === 'object_updated') {
        const item = ex.itemsById.get(t.update.target_id)
        if (!item) {
          // NON-BATCH TARGET — the model correctly matched a valid offered candidate that isn't in THIS open
          // batch (it belongs to the fresh path, which isn't adopted yet — Phase 3). This is not a failure of
          // anything: the executor is correctly detecting "not mine to apply." Park it as a DISTINGUISHED,
          // mechanically-replayable row (the update + its label ride in `candidates`) and read it back as
          // UNDERSTOOD-BUT-HELD, never as failed. When Phase 3 lands, these rows re-apply.
          await parkObservation(ctx, terminalObservation(t), 'non_batch_target', ex.narrationId, {
            target_id: t.update.target_id, target_kind: t.update.target_kind, label: terminalLabel(t, ex.labelById), update: t.update,
          }, { projectId: ex.projectId ?? null })
          outcomes.push({ terminal: t, status: 'held', label: terminalLabel(t, ex.labelById) })
          continue
        }
        const out: { resolveEvent?: string } = {}
        await applyBatchResolution(ctx, item, t.applied === 'resolve' ? 'resolved' : 'still_open', t.update.reason, ex.cadenceMap, ex.actorId, ex.now, { force: t.applied, reason: t.update.reason, out })
        // A photo riding an update is ANSWER EVIDENCE for the item it updates (decision (a): a chase-reply
        // photo never spawns a fresh object) — attach + trail, the role='answer' path the flip had dropped.
        if (ctx.image?.storagePath) await answerWithPhoto(ctx, { kind: item.kind, id: item.id, orgId: item.orgId }, ctx.image.storagePath, ctx.image.caption ?? null)
        if (t.applied === 'resolve' && item.kind === 'issue' && out.resolveEvent) resolvedRefs.push({ kind: 'issue', id: item.id, event: out.resolveEvent })
        outcomes.push({ terminal: t, status: 'ok', label: shortLabel(item.title) })
      } else if (t.kind === 'object_created') {
        // the item's own named project wins (cross-script hint the string-match missed); else THE project
        // the unit resolved — "no match → CREATE" must land on the message's site, never nowhere.
        const proj = await resolveProject(ctx.supabase, ctx.orgId, { nameHint: t.item.project_hint })
        const pid = proj.projectId ?? ex.projectId ?? null
        if (!pid) throw new Error('project unresolved')
        const out = await routeGroup(ctx, pid, [toSiteItem(t.item)], ex.narrationId)
        if (out.progress.length + out.problems.length + out.todos.length === 0) throw new Error('nothing created')
        // Image evidence rides the create (finishRoute's twin): link the ALREADY-stored photo to each
        // object this terminal created — after create, so a failed create leaves no orphan attachment.
        if (ctx.image?.storagePath) {
          const sp = ctx.image.storagePath, cap = ctx.image.caption ?? null
          for (const p of out.problems) if (p.id) await attachImage(ctx, 'problem', p.id, sp, cap, 'creation')
          for (const td of out.todos) if (td.id) await attachImage(ctx, 'todo', td.id, sp, cap, 'creation')
          for (const pr of out.progress) if (pr.taskId) await attachImage(ctx, 'site_task', pr.taskId, sp, cap, 'creation')
        }
        outcomes.push({ terminal: t, status: 'ok', label: shortLabel(t.item.detail) })
      } else if (t.kind === 'acked_didnt_catch') {
        outcomes.push({ terminal: t, status: 'ok', label: '' })   // no state effect; the readback IS the ack
      } else if (t.kind === 'question_asked') {
        // Open the pick through the PROVEN resume, storing exactly the offered set in slots (so the answer
        // validates against what was asked, never a re-load). Sends its own interactive message.
        await askResolutionQuestion(ctx, t, ex)
        outcomes.push({ terminal: t, status: 'ok', label: terminalLabel(t, ex.labelById) })
      } else if (t.kind === 'queued_as_evidence') {
        // Honest STRUCTURAL park (five-part): durable row + a DISTINCT parked_reason so Step 6 can tell an
        // image awaiting placement from a text obs that couldn't be sited. The row carries the photo's
        // bucket/object_path (parkObservation reads ctx.image) so the evidence is FINDABLE (audit #7).
        await parkObservation(ctx, 'photo evidence', 'evidence_await_placement', ex.narrationId, null, { projectId: ex.projectId ?? null })
        outcomes.push({ terminal: t, status: 'ok', label: 'photo' })
      } else {
        await parkObservation(ctx, terminalObservation(t), 'v2_unhandled_terminal', ex.narrationId, null, { projectId: ex.projectId ?? null })
        outcomes.push({ terminal: t, status: 'failed', label: terminalLabel(t, ex.labelById) })
      }
    } catch (e) {
      console.error('[siteops:exec] terminal failed:', t.kind, (e as Error).message)
      // A FAILED effect must land somewhere recoverable — park it, so "saved for review" in the readback is
      // true and the observation isn't an eat wearing an apology. Best-effort; the outcome is still recorded.
      await parkObservation(ctx, terminalObservation(t), 'v2_effect_failed', ex.narrationId, null, { projectId: ex.projectId ?? null }).catch(() => {})
      outcomes.push({ terminal: t, status: 'failed', label: terminalLabel(t, ex.labelById) })
    }
  }
  assertAllApplied(terminals, outcomes)   // effect-side no-drop: N terminals → N outcomes (ok|failed), or throw

  // ONE combined readback for the NON-question terminals (questions already sent their own pick). When a
  // resolve landed it goes as a BUTTONS message with the one-tap "Not resolved" undo, capturing the resolved
  // issues + their event ids — 4a maps the outbound wamid to those refs (handleUndoResolve). No resolve →
  // text. If every terminal was a question, the picks ARE the reply — no combined readback.
  if (outcomes.some((o) => o.terminal.kind !== 'question_asked')) {
    const body = composeReadback(outcomes) + (ex.readbackSuffix ?? '')
    if (resolvedRefs.length) {
      await send(ctx.supabase, ctx.from, { kind: 'buttons', body, buttons: [{ id: 'siteops_undo', title: 'Not resolved' }] }, { ...meta, capture: { ref_kind: 'readback', object_refs: resolvedRefs } })
    } else {
      await send(ctx.supabase, ctx.from, { kind: 'text', body }, meta)
    }
  }
  return outcomes
}

/** "cement ✓ resolved" / "masons still open (will check back)" — one readback part. */
function readbackPart(item: BatchItem, verdict: 'resolved' | 'open'): string {
  if (verdict === 'resolved') return `${shortLabel(item.title)} ✓ ${item.kind === 'todo' ? 'done' : 'resolved'}`
  return `${shortLabel(item.title)} still open (will check back)`
}

/**
 * B3 — REPLY HANDLING. The open batch is a patient context; this sorts each
 * decomposed piece of the supervisor's message into "answers an open chase"
 * (resolve/re-time + trail) vs "new narration" (route normally), handles a
 * genuine same-cause collision with ONE targeted site question, and confirms
 * per item. Returns TRUE if it consumed the message; FALSE if NOTHING matched
 * the batch (then runSiteops routes it fresh, leaving the batch open).
 */
// ── v2 ADOPTION shell — UNREACHABLE since the image path joined the unit (audit #1) ──────────────────
// handleBatchReply was the adoption-era chase-reply engine (ONE resolveInbound over the LEGACY all-projects
// candidate set → terminals → applyTerminals). The text path left it at the singular-first restructure; the
// image path left it when it went project-first — so, like its match+judge twin below, it is PHYSICALLY
// PRESENT but UNREACHABLE, kept for one bisectable revert. PHASE 4 is the executioner for BOTH (plus
// matchPieceToBatch + ASCII tokens + standalone judgeResolution + buildCandidateSet's projectId-null mode).
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- UNREACHABLE (Phase 4 executioner); kept for one bisectable revert.
async function handleBatchReply(
  ctx: SiteopsCtx, text: string, _pieces: SiteItem[], _topProjectHint: string | null,
  batch: OpenBatch, _projects: ProjectRef[], narrationId: string | null,
  callModel: (system: string, user: string) => Promise<string> = callLLM,
): Promise<boolean> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const now = new Date()
  const cadenceMap = await loadCadenceMap(ctx.supabase, ctx.orgId)
  const actorId = await senderUserId(ctx)

  // FAST PATH (cardinality, not meaning) — a recognised bare ack + exactly ONE open chase → that chase,
  // ADDRESSING, no LLM. One referent + zero content = nothing to interpret.
  if (isBareAck(text) && batch.items.length === 1) {
    const v = await applyBatchResolution(ctx, batch.items[0], 'still_open', text, cadenceMap, actorId, now, { bareAck: true })
    await send(ctx.supabase, ctx.from, { kind: 'text', body: `Got it — ${readbackPart(batch.items[0], v)}` }, meta)
    return true
  }

  // UNIFIED RESOLUTION — one call, then apply the terminals. A park (model down / unreadable) is honest +
  // leaves the batch untouched; otherwise the executor auto-resolves (+undo), creates, asks, or acks.
  const rc = { supabase: ctx.supabase, orgId: ctx.orgId, from: ctx.from }
  const say = (body: string) => send(ctx.supabase, ctx.from, { kind: 'text', body }, meta)
  const image = ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null
  const res = await resolveInbound(rc, { message: text, image, narrationId }, batch, say, callModel)
  if (res.kind === 'parked') return true   // parked + honest reply; the chase batch is UNTOUCHED (no eat, no half-mutation)
  const itemsById = new Map(batch.items.map((i) => [i.id, i]))
  // Human labels for EVERY offered candidate (not just the open batch) — so a FAILED readback names the item
  // even when the target was a candidate outside this batch. Never a uuid reaches a human. (See terminalLabel.)
  const labelById = new Map(res.candidates.map((c) => [c.id, shortLabel(c.title ?? '')]))
  const outcomes = await applyTerminals(ctx, res.terminals, { itemsById, labelById, cadenceMap, actorId, now, narrationId })
  // batch bookkeeping the executor doesn't own: drop RESOLVED chased items, close the batch when empty.
  const resolvedIds = outcomes
    .filter((o): o is TerminalOutcome & { terminal: Extract<Terminal, { kind: 'object_updated' }> } => o.terminal.kind === 'object_updated' && o.terminal.applied === 'resolve' && o.status === 'ok')
    .map((o) => o.terminal.update.target_id)
  if (resolvedIds.length) await dropBatchItems(ctx.supabase, batch, resolvedIds)
  return true
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars -- UNREACHABLE (Phase 4 executioner); kept for one bisectable revert of the adoption flip.
async function handleBatchReplyLegacy(
  ctx: SiteopsCtx, text: string, pieces: SiteItem[], topProjectHint: string | null,
  batch: OpenBatch, projects: ProjectRef[], narrationId: string | null,
): Promise<boolean> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const now = new Date()

  // a terse "sorted"/"done" decomposes to nothing — treat the whole line as one piece
  const frags = pieces.length ? pieces : [{ text, task_hint: null, project_hint: null } as unknown as SiteItem]

  // ALL-clear shortcut: "all done", "everything sorted" → resolve the whole batch
  const allClear = /\b(all|everything|sab)\b/i.test(text) && /\b(done|sorted|sortd|resolved|cleared|finished|complete)\b/i.test(text)

  const resolutions: { item: BatchItem; verdict: 'resolved' | 'open' }[] = []
  const leftovers: SiteItem[] = []
  let collision: { piece: SiteItem; items: BatchItem[]; status: 'resolved' | 'still_open' | 'unknown' } | null = null
  const matchedIdx = new Set<number>()

  const cadenceMap = await loadCadenceMap(ctx.supabase, ctx.orgId)
  const actorId = await senderUserId(ctx)

  // FIX 2 — PROJECT-SCOPE the batch (extends Fix X from the photo branch to all types). Resolve the
  // message's project (caption for images, named site / hint for text) and match only within it; a
  // message resolving to a CHASE-FREE project isn't a chase reply → route it fresh.
  const pre = await resolveProject(ctx.supabase, ctx.orgId, { narration: ctx.image?.caption ?? text, nameHint: topProjectHint })
  const { scoped, routeFresh } = scopeBatchToProject(batch.items, pre.projectId)
  if (routeFresh) return false

  if (isBareAck(text) && scoped.length === 1) {
    // THE FAST PATH (cardinality, not meaning) — a recognised bare ack + exactly ONE open chase → that
    // chase, ADDRESSING, deterministically, no LLM. One referent + zero content = nothing to interpret.
    const v = await applyBatchResolution(ctx, scoped[0], 'still_open', text, cadenceMap, actorId, now, { bareAck: true })
    resolutions.push({ item: scoped[0], verdict: v }); matchedIdx.add(0)
  } else if (allClear) {
    for (let i = 0; i < scoped.length; i++) {
      const v = await applyBatchResolution(ctx, scoped[i], 'resolved', text, cadenceMap, actorId, now)
      resolutions.push({ item: scoped[i], verdict: v }); matchedIdx.add(i)
    }
  } else {
    // Sort each fragment into "answers a chase" vs "new observation" via the PURE classifier (see
    // _siteops_batch). singleFragment/hasObservation carry the pipeline's own signal about whether this
    // reply is a bare ack or a substantive observation.
    const signals = { singleFragment: frags.length === 1, hasObservation: pieces.length > 0 }
    for (const piece of frags) {
      const m = classifyReplyFragment(piece, scoped, signals)
      if (m.kind === 'match') {
        if (matchedIdx.has(m.index)) continue
        matchedIdx.add(m.index)
        const status = interpretStatus(piece.text)
        const v = await applyBatchResolution(ctx, scoped[m.index], status, piece.text, cadenceMap, actorId, now)
        resolutions.push({ item: scoped[m.index], verdict: v })
      } else if (m.kind === 'collision' && !collision) {
        collision = { piece, items: m.indexes.map((i) => scoped[i]), status: interpretStatus(piece.text) }
      } else if (m.kind === 'collision') {
        // a second collision in one message is rare — leave it in the batch for next cycle
      } else {
        leftovers.push(piece)
      }
    }
  }

  // STEP 3 — a chase-reply PHOTO is evidence for the item(s) it resolved. Attach + trail, never fresh.
  const photo = ctx.image?.storagePath ? { sp: ctx.image.storagePath, cap: ctx.image.caption ?? null } : null
  if (photo) for (const r of resolutions) await answerWithPhoto(ctx, r.item, photo.sp, photo.cap)

  // nothing touched the batch → normally route fresh. But a chase-reply PHOTO must NEVER spawn a fresh
  // object (decision (a)): single-item batch → it's about that item; multi-item → ask which, carrying the
  // photo so the pick attaches it. Text is unchanged (returns false → runSiteops routes fresh).
  if (!resolutions.length && !collision) {
    if (!photo) return false
    // Chase-photo interaction over the PROJECT-SCOPED set (scoping already done at the top; a captioned
    // photo for a chase-free project already returned false via routeFresh). Single scoped chase → attach;
    // no project signal → the whole batch (the honest ambiguous case) → ask which.
    if (scoped.length === 1) {
      await answerWithPhoto(ctx, scoped[0], photo.sp, photo.cap)
      await send(ctx.supabase, ctx.from, { kind: 'text', body: `Added your photo to *${shortLabel(scoped[0].title)}*.` }, meta)
      return true
    }
    const cands = scoped.map((it) => ({ id: it.id, kind: it.kind, orgId: it.orgId, projectName: it.projectName, title: it.title, cause: it.cause }))
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: 'which item is this photo about',
      slots: { kind: 'siteops_photo_pick', candidates: cands, image: { storagePath: photo.sp, caption: photo.cap } },
      lastMessageId: ctx.wamid,
    })
    await send(ctx.supabase, ctx.from, { kind: 'list', body: `Which is this photo about?`, button: 'Pick', rows: cands.slice(0, 10).map((c, i) => ({ id: `pick:${i + 1}`, title: shortLabel(c.title).slice(0, 24) })) }, meta)
    return true
  }

  // route the genuinely-new pieces (interruption "…also 3rd floor slab done"). Site = a named
  // site, else the batch's site when it's single-project; ambiguous progress parks (no nested pick).
  // A PHOTO never routes leftovers fresh (decision (a)) — its evidence attaches to the resolved item(s).
  let leftoverLine = ''
  if (leftovers.length && !photo) leftoverLine = await routeLeftovers(ctx, text, leftovers, topProjectHint, batch, projects, narrationId)

  const parts = resolutions.map((r) => readbackPart(r.item, r.verdict))
  const head = parts.length ? `Got it — ${parts.join(' · ')}` : 'Got it'
  const extra = leftoverLine ? `\n${leftoverLine}` : ''

  // Drop RESOLVED items from the batch (in BOTH paths — a collision must not strand them).
  // A still-open re-timed item stays in the batch; a collider stays for the pending ask below.
  const resolvedIds = resolutions.filter((r) => r.verdict === 'resolved').map((r) => r.item.id)
  let closed = false
  if (resolvedIds.length) ({ closed } = await dropBatchItems(ctx.supabase, batch, resolvedIds))

  // GENUINE COLLISION → the fragment matched several same-subject chases (now within one project, post
  // Fix-2 scoping). Ask which — WITH a "None — it's new" exit so a genuinely-new observation isn't
  // trapped onto a chase (the residual the Fix X review flagged: don't rebuild the trap one level down).
  if (collision) {
    const cands = collision.items.map((it) => ({ id: it.id, kind: it.kind, orgId: it.orgId, projectId: it.projectId, projectName: it.projectName, title: it.title, cause: it.cause }))
    const projectId = pre.projectId ?? cands[0]?.projectId ?? null
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: `which item: ${collision.piece.text}`,
      slots: { kind: 'siteops_batch_collision', status: collision.status, piece_text: collision.piece.text, candidates: cands, project_id: projectId, narration_id: narrationId, image: photo ? { storagePath: photo.sp, caption: photo.cap } : null },
      lastMessageId: ctx.wamid,
    })
    await send(ctx.supabase, ctx.from, {
      kind: 'list',
      body: `${head}${extra}\n\n"${shortLabel(collision.piece.text)}" — which of these, or is it new?`,
      button: 'Pick',
      rows: [
        ...cands.slice(0, 9).map((c, i) => ({ id: `pick:${i + 1}`, title: shortLabel(c.title).slice(0, 24), description: c.projectName.slice(0, 24) })),
        { id: `pick:${Math.min(cands.length, 9) + 1}`, title: "None — it's new" },
      ],
    }, meta)
    return true
  }

  const tail = closed ? `\n\nAll caught up 👍` : ''
  await send(ctx.supabase, ctx.from, { kind: 'text', body: `${head}${extra}${tail}` }, meta)
  return true
}

/** Route new-narration pieces surfaced inside a batch reply. Returns a one-line summary. */
async function routeLeftovers(
  ctx: SiteopsCtx, text: string, items: SiteItem[], topProjectHint: string | null,
  batch: OpenBatch, projects: ProjectRef[], narrationId: string | null,
): Promise<string> {
  // determine a site: a named one wins; else the batch's site if it's all one project
  const proj = await resolveProject(ctx.supabase, ctx.orgId, { narration: text, nameHint: topProjectHint })
  let projectId = proj.projectId
  const batchPids = [...new Set(batch.items.map((b) => b.projectId).filter(Boolean))] as string[]
  if (!projectId && batchPids.length === 1) projectId = batchPids[0]
  if (!projectId) return `· ${items.length} new note${items.length > 1 ? 's' : ''} couldn't be sited — resend with the site`

  const out = await routeGroup(ctx, projectId, items, narrationId)
  const n = out.progress.length + out.problems.length + out.todos.length
  const parked = out.parked.length + out.ambiguous.length
  const bits: string[] = []
  if (n) bits.push(`logged ${n} new update${n > 1 ? 's' : ''}`)
  if (parked) bits.push(`${parked} parked`)
  return bits.length ? `· also ${bits.join(', ')}` : ''
}

/**
 * THE SINGULAR UNIT — core (owner's design, Stage 1). Given THE resolved project and ONE fragment's text:
 * candidates = THAT project only (an open batch contributes only same-project items, as a ⭐ ranking
 * PRIOR) → ONE resolveInbound → apply per the existing ladder (updates land first-class on ANY offered
 * issue/todo — chased or not) / create via routeGroup / didn't-catch. The enforcement floor is untouched:
 * model failure PARKS (resolveInbound's five-part safety net), effects that fail park, readbacks are
 * labeled. INTERIM COMPOUND RULE: `rest` (fragments beyond the first) is parked pending_stage2 BEFORE the
 * model runs — replayable payload, its truth appended to the one readback. Stage 2 replaces the park with
 * the loop. Called by runSiteops (fresh text) and the siteops_project resume (ask-first remainder).
 */
async function runSingularUnit(ctx: SiteopsCtx, u: {
  projectId: string
  text: string
  rest: SiteItem[]
  batch: OpenBatch | null
  narrationId: string | null
  callModel: (system: string, user: string) => Promise<string>
}): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const now = new Date()
  const cadenceMap = await loadCadenceMap(ctx.supabase, ctx.orgId)
  const actorId = await senderUserId(ctx)

  // interim pending_stage2 park FIRST — no-drop holds even if the unit itself parks below.
  // AUDIT #3 — the row carries THE resolved project (the narration's shared site) so Stage 2's replay
  // inherits sited fragments; a per-item project_hint inside the observation still overrides at replay
  // for a genuinely multi-site narration (the decompose contract's carry-forward shape).
  let restLine = ''
  if (u.rest.length) {
    await ctx.supabase.from('siteops_unplaced').insert({
      org_id: ctx.orgId, project_id: u.projectId, reason: 'pending_stage2',
      observation: { items: u.rest }, candidates: null, bucket: null, object_path: null, caption: null,
      narration_id: u.narrationId, sender_number: ctx.from, created_by: null,
    })
    restLine = ` · ${u.rest.length} more saved for review`
  }

  // the batch as a PRIOR: only its same-project items reach the set (⭐); a batch on another project is
  // invisible — by construction, not by guard (journeys a/b/e assert the prompt's contents).
  const scopedBatchItems = (u.batch?.items ?? []).filter((b) => b.projectId === u.projectId)
  const rankBatch = scopedBatchItems.length ? { items: scopedBatchItems } : null

  const rc = { supabase: ctx.supabase, orgId: ctx.orgId, from: ctx.from, projectId: u.projectId }
  const say = (body: string) => send(ctx.supabase, ctx.from, { kind: 'text', body }, meta)
  const image = ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null
  const res = await resolveInbound(rc, { message: u.text, image, narrationId: u.narrationId }, rankBatch, say, u.callModel)
  if (res.kind === 'parked') return   // honest five-part park; nothing touched

  // itemsById spans EVERY offered issue/todo candidate — an update onto THE project's open work applies
  // first-class, chased or not. Chased items keep their full batch shape (cause → cadence); non-chased
  // candidates get a minimal shape (default cadence). The held-park in applyTerminals remains the safety
  // net for a target outside the offered set (stale/foreign — should be impossible post-validation).
  const batchById = new Map((u.batch?.items ?? []).map((i) => [i.id, i]))
  const itemsById = new Map<string, BatchItem>()
  for (const c of res.candidates) {
    if (c.kind !== 'issue' && c.kind !== 'todo') continue
    itemsById.set(c.id, batchById.get(c.id) ?? {
      kind: c.kind, id: c.id, orgId: ctx.orgId, projectId: c.project_id ?? u.projectId,
      projectName: c.project_name ?? null, title: c.title, taskName: null, cause: 'other',
    } as BatchItem)
  }
  const labelById = new Map(res.candidates.map((c) => [c.id, shortLabel(c.title ?? '')]))
  const outcomes = await applyTerminals(ctx, res.terminals, {
    itemsById, labelById, cadenceMap, actorId, now,
    narrationId: u.narrationId, projectId: u.projectId, readbackSuffix: restLine,
  })
  // batch bookkeeping: only CHASED items ride the batch — drop the resolved ∩ batch, close when empty.
  const resolvedIds = outcomes
    .filter((o): o is TerminalOutcome & { terminal: Extract<Terminal, { kind: 'object_updated' }> } => o.terminal.kind === 'object_updated' && o.terminal.applied === 'resolve' && o.status === 'ok')
    .map((o) => o.terminal.update.target_id)
    .filter((id) => batchById.has(id))
  if (resolvedIds.length && u.batch) await dropBatchItems(ctx.supabase, u.batch, resolvedIds)
}

export async function runSiteops(ctx: SiteopsCtx, text: string, opts: { prefix?: string; callModel?: (system: string, user: string) => Promise<string> } = {}): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const say = (body: string) => send(ctx.supabase, ctx.from, { kind: 'text', body: opts.prefix ? `${opts.prefix}\n\n${body}` : body }, meta)

  // The open chase batch is loaded as CONTEXT — a prior for the fast path, for project resolution, and
  // for candidate ranking. It is NEVER a router: the gate that force-routed any message into batch-only
  // execution died with the singular-first restructure (D5 batch-captures-fresh, Phase-0 E1).
  const batch = await getOpenBatch(ctx.supabase, ctx.orgId, ctx.from)

  // Capture-first: persist the raw narration immediately so nothing is ever lost. Stamp the sender's
  // name so the task feed shows who sent it; fall back without the column if the migration isn't applied
  // yet (capture-first must never fail on a missing column).
  const base = { org_id: ctx.orgId, raw_text: text, resolved_project_via: 'unresolved' }
  let ins = await ctx.supabase.from('site_narrations').insert({ ...base, sender_name: await senderName(ctx) }).select('id').single()
  if (ins.error) ins = await ctx.supabase.from('site_narrations').insert(base).select('id').single()
  const narrationId: string | null = ins.data?.id ?? null

  // FAST PATH (cardinality, not meaning) — BEFORE any model call, decompose included (journey (d): "sari"
  // must cost ZERO model calls, or the fast path quietly defeats its own reason for existing — the
  // ratified E1 ordering refinement). A recognised bare ack + exactly ONE open chase → that chase,
  // ADDRESSING, deterministically, trailed bare_ack. RESOLVE stays behind the model (ack ≠ closure).
  if (!ctx.image?.base64 && isBareAck(text) && batch && batch.items.length === 1) {
    const cadenceMap = await loadCadenceMap(ctx.supabase, ctx.orgId)
    const actorId = await senderUserId(ctx)
    const v = await applyBatchResolution(ctx, batch.items[0], 'still_open', text, cadenceMap, actorId, new Date(), { bareAck: true })
    await say(`Got it — ${readbackPart(batch.items[0], v)}`)
    return
  }

  // Roster for project resolution: hand the extractor the org's active project NAMES so it
  // returns the CANONICAL project (semantic match), mirroring the transaction agent. Then
  // resolveProject's string match is just a safety net, not the primary resolver. We load ids
  // too so the multi-project planner can resolve each item's site without a second round-trip.
  const { data: projRows } = await ctx.supabase.from('projects').select('project_id, name').eq('org_id', ctx.orgId).eq('status', 'Active')
  const projects: ProjectRef[] = ((projRows ?? []) as { project_id: string; name: string }[]).map((p) => ({ id: p.project_id, name: p.name }))
  const projectNames = projects.map((p) => p.name)

  // ── IMAGE PATH — PROJECT-FIRST (audit #1). The adoption flip left the old shape gated on the batch:
  // handleBatchReply (which never returns false) consumed EVERY image from a chased sender with the legacy
  // all-projects candidate set — the Fix-X image-hijack, re-broken. The image path now mirrors the text
  // ladder: resolve THE project FIRST → multi-project files per-site → chases ON that project run the
  // SINGULAR UNIT (batch a ⭐ prior; the photo rides the terminals) → a chase-free project routes FRESH
  // through the proven image machinery (attach axis, evidence links, enrichment window) with the batch
  // INVISIBLE. The batch is never a gate, never a router.
  if (ctx.image?.base64) {
    // STEP 1 GROUNDING — resolve the site from the CAPTION up-front so the vision pass reads the photo
    // against THIS project's OPEN work + pending chases; failure just yields no hints (bonus, not blocker).
    let groundingHints: string[] = []
    try {
      const pre = await resolveProject(ctx.supabase, ctx.orgId, { narration: ctx.image.caption ?? '', nameHint: null })
      if (pre.projectId) {
        const cands = await loadCandidates(ctx.supabase, ctx.orgId, pre.projectId, batch?.items ?? [])
        groundingHints = groundingLabels(prefilterCandidates(cands, ctx.image.caption ?? ''))
        console.log(`[siteops:ground] project=${pre.projectId} candidates=${cands.length} shortlist=${groundingHints.length}`)
      }
    } catch (e) { console.error('[siteops:ground] skipped:', (e as Error).message) }

    let decomposed: { items: SiteItem[]; project_hint: string | null } | null = null
    try {
      decomposed = await decomposeImage(ctx.image.base64, ctx.image.mime, ctx.image.caption, projectNames, groundingHints, opts.callModel)
    } catch {
      decomposed = null
    }
    const items = decomposed?.items ?? []
    const first = items[0] ?? null

    // MULTI-project image narration files per-site (journey precedent: the txn agent's shape). Reached
    // BEFORE any batch consult — a message naming several sites was never a single chase's reply.
    const plan = planItemProjects(items.map((it) => it.project_hint), projects)
    if (plan.isMulti) {
      await runMulti(ctx, items, plan, projects, narrationId)
      return
    }

    // RESOLVE THE PROJECT (ask-first ladder, the text path's twin): the item's/vision's named project →
    // caption string-match safety net → the open batch as a PRIOR (single-site batches only) → ASK FIRST.
    const nameHint = first?.project_hint ?? decomposed?.project_hint ?? null
    const proj = await resolveProject(ctx.supabase, ctx.orgId, { narration: ctx.image.caption || text, nameHint })
    let projectId: string | null = proj.projectId
    let via: string = proj.via
    if (!projectId && batch && batch.items.length) {
      const pids = [...new Set(batch.items.map((b) => b.projectId).filter(Boolean))] as string[]
      if (pids.length === 1) { projectId = pids[0]; via = 'auto' }
    }
    await ctx.supabase.from('site_narrations').update({
      project_id: projectId, decomposed: items, resolved_project_via: projectId ? via : 'unresolved',
    }).eq('id', narrationId)

    if (!projectId) {
      if (!items.length) {
        // FLOOR (mapped nothing, observed nothing, no site): the photo is EVIDENCE and must survive —
        // park it WITH its object_path (never the text path's "didn't catch", which would drop it).
        if (ctx.image.storagePath) {
          await ctx.supabase.from('siteops_unplaced').insert({
            org_id: ctx.orgId, project_id: null, reason: 'floor', observation: null,
            candidates: null, bucket: 'rough-entry-media', object_path: ctx.image.storagePath,
            caption: ctx.image.caption?.trim() || null, narration_id: narrationId, sender_number: ctx.from, created_by: null,
          })
          await say(`Couldn't read that photo — kept it on your to-place list so it isn't lost.`)
          return
        }
        await say(`Didn't catch a site update in that — try again if you meant to send one.`)
        return
      }
      await askProjectFirst(ctx, meta, proj, items, null, narrationId)   // legacy slots (no text) → finishRoute resume, photo carried
      return
    }

    // THE project resolved. Chases ON it → the unit (same-project batch items rank ⭐; cross-project
    // invisibility by construction). Chase-free → the proven fresh flow; the batch never routes.
    const chasesHere = (batch?.items ?? []).some((b) => b.projectId === projectId)
    if (chasesHere && batch) {
      await runSingularUnit(ctx, {
        projectId,
        text: items.length >= 2 ? first!.text : text,   // compound → the FIRST fragment (interim rule, text-path twin)
        rest: items.slice(1),
        batch, narrationId,
        callModel: opts.callModel ?? callLLM,
      })
      return
    }
    const projectName = proj.projectName ?? projects.find((p) => p.id === projectId)?.name ?? null
    await finishRoute(ctx, projectId, projectName, items, narrationId)
    return
  }

  // ── TEXT: THE SINGULAR UNIT (owner's design, Stage 1) ─────────────────────────────────────────────
  // decompose = normalizer/splitter/project-hint source (interim, E5 — dies in Phase 4), flowing through
  // the SAME injected caller as the resolution call: one counted model door.
  let decomposed: { items: SiteItem[]; project_hint: string | null } | null = null
  try {
    decomposed = await decompose(text, projectNames, opts.callModel ?? callLLM)
  } catch {
    decomposed = null
  }
  const items = decomposed?.items ?? []
  const first = items[0] ?? null
  const rest = items.slice(1)   // INTERIM COMPOUND RULE: the unit takes the first; these park pending_stage2

  // RESOLVE THE PROJECT (ask-first ladder): the item's/narration's named project → string-match safety
  // net → the open batch as a PRIOR (an unnamed message from a sender we're actively chasing is
  // presumptively about that thread's site — single-site batches only, a mixed batch can't say which)
  // → ASK FIRST. Never guess across projects; never load multi-project candidates as a fallback.
  const nameHint = first?.project_hint ?? decomposed?.project_hint ?? null
  const proj = await resolveProject(ctx.supabase, ctx.orgId, { narration: text, nameHint })
  let projectId: string | null = proj.projectId
  let via: string = proj.via
  if (!projectId && batch && batch.items.length) {
    const pids = [...new Set(batch.items.map((b) => b.projectId).filter(Boolean))] as string[]
    if (pids.length === 1) { projectId = pids[0]; via = 'auto' }
  }
  await ctx.supabase.from('site_narrations').update({
    project_id: projectId, decomposed: items, resolved_project_via: projectId ? via : 'unresolved',
  }).eq('id', narrationId)

  if (!projectId) {
    if (!decomposed) {
      // TRUE contentless cell: nothing extracted, no name, no chase context → the honest didn't-catch.
      await say(`Didn't catch a site update in that — try again if you meant to send one.`)
      return
    }
    // ASK-FIRST (E2): the question CARRIES the observation AND the raw text, so the resume runs the
    // REMAINDER of the unit from slots — no re-extraction, validated against the OFFERED list.
    await askProjectFirst(ctx, meta, proj, items, text, narrationId)
    return
  }

  await runSingularUnit(ctx, {
    projectId,
    text: items.length >= 2 ? first!.text : text,   // compound → the FIRST fragment's text (never let the model re-find the parked rest)
    rest, batch, narrationId,
    callModel: opts.callModel ?? callLLM,
  })
}

/** The ask-first project question (shared by the unit and the legacy image path). The list we SHOW is the
 *  list we STORE (pickList) so the reply maps to the same row in answerSiteops. `text` non-null marks
 *  unit-style slots (E2): the resume runs the singular unit's remainder; null = legacy finishRoute resume. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function askProjectFirst(ctx: SiteopsCtx, meta: Record<string, unknown>, proj: any, items: SiteItem[], text: string | null, narrationId: string | null): Promise<void> {
  const ambiguous = proj.nameTried && proj.matches.length > 1
  const pickList = ambiguous ? proj.matches : proj.candidates
  // AUDIT #2 — the question CARRIES the observation in its TEXT (not just the slots): the supervisor must
  // see WHAT is being sited before picking, or a stale question reads as a context-free "which project?".
  const obs = items[0]?.text ? `"${items[0].text}"${items.length > 1 ? ` (+${items.length - 1} more)` : ''}` : 'your site note'
  const body = ambiguous
    ? `You said "${proj.nameTried}" — a few projects match. Which one is ${obs} for?`
    : proj.nameTried
      ? `I couldn't find a project called "${proj.nameTried}". Which project is ${obs} for?`
      : `Got ${obs} — which project is it for?`
  await openConversation(ctx.supabase, {
    orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
    pendingQuestion: 'which project?',
    slots: { kind: 'siteops_project', items, ...(text !== null ? { text } : {}), candidates: pickList, narration_id: narrationId, image: ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null },
    lastMessageId: ctx.wamid,
  })
  await send(ctx.supabase, ctx.from, {
    kind: 'list',
    body,
    button: 'Pick project',
    rows: pickList.slice(0, 10).map((c: { name: string }, i: number) => ({ id: `pick:${i + 1}`, title: c.name.slice(0, 24) })),
  }, meta)
}

/**
 * Route a resolved project's items → write + confirm, OR open a task-disambiguation pick if a
 * progress item is ambiguous. Shared by the fresh path and the project-followup resume (so a
 * project pick chains naturally into a floor pick). Returns what it left OPEN for the sender's next
 * message: 'pick' (a task disambiguation), 'window' (a siteops_photo enrichment window), or null (clean
 * completion — nothing open; the caller may close). Callers gating on `!result` to close still work:
 * null is falsy, 'pick'/'window' are truthy — never close the window we just opened.
 */
async function finishRoute(ctx: SiteopsCtx, projectId: string, projectName: string | null, items: SiteItem[], narrationId: string | null): Promise<'pick' | 'window' | null> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const vmNodeKeys = await materializeProjectTasks(ctx, projectId)
  const { data: taskRows } = await ctx.supabase.from('site_tasks').select(TASK_COLS).eq('project_id', projectId)
  const rawRows = (taskRows ?? []) as SiteTaskRow[]
  const tasks = engineTasks(rawRows)
  console.log(`[siteops:dbg:load] project=${projectId} rawRows=${rawRows.length} engineRows=${rawRows.filter((t) => t.node_key).length} flatRows=${rawRows.filter((t) => !t.node_key).length} usedForMatch=${tasks.length} vmNodeKeys=${vmNodeKeys.size}`)
  const oc = await ownerCtx(ctx.supabase, ctx.orgId, projectId)
  const rc: RouteCtx = { supabase: ctx.supabase, orgId: ctx.orgId, projectId, byLabel: ctx.from, ...oc, narrationId, now: new Date(), vmNodeKeys }

  // STEP 3 — ATTACH axis (images only). Before ROUTE creates fresh objects, test each issue/todo item
  // against the project's OPEN items: a re-photo of a known item ATTACHES evidence (no twin); a new one
  // OBSERVES (falls through to ROUTE → create fresh); an ambiguous one opens the grounded TYPED pick
  // below. Lexical + pure (planPhotoItems), ask-on-any-doubt. progress items stay on the task axis
  // untouched. Candidates are project-scoped (loadCandidates, no chase set needed here).
  let items2 = items
  let candsForPick: Candidate[] = []
  const attachAcks: string[] = []
  let typedPick: { item: SiteItem; shortlist: Candidate[] } | null = null
  if (ctx.image?.storagePath) {
    candsForPick = await loadCandidates(ctx.supabase, ctx.orgId, projectId, [])
    const plan = planPhotoItems(candsForPick, items)
    for (const a of plan.attaches) {
      await attachExistingEvidence(ctx, a.target, ctx.image.storagePath, ctx.image.caption ?? null)
      attachAcks.push(shortLabel(a.target.label))
    }
    typedPick = plan.asks[0] ?? null
    items2 = plan.rest
    console.log(`[siteops:attach] project=${projectId} attach=${plan.attaches.length} ask=${plan.asks.length} observe/route=${plan.rest.length}`)
  }

  const out = await routeItems(rc, tasks, items2)

  // Image evidence: when this route came from an image, link the ALREADY-stored photo (rough-entry-media,
  // never re-uploaded) to each object the route CREATED — AFTER create so a failed create leaves no orphan
  // attachment (each id/taskId is guarded). role='creation' (Step 3's answer path sets 'answer').
  if (ctx.image?.storagePath) {
    const sp = ctx.image.storagePath, cap = ctx.image.caption ?? null
    for (const p of out.problems) if (p.id) await attachImage(ctx, 'problem', p.id, sp, cap, 'creation')
    for (const t of out.todos) if (t.id) await attachImage(ctx, 'todo', t.id, sp, cap, 'creation')
    for (const pr of out.progress) if (pr.taskId) await attachImage(ctx, 'site_task', pr.taskId, sp, cap, 'creation')
  }

  // STEP 3 — evidence attached to EXISTING item(s): a terse ack, independent of the ROUTE confirm below.
  if (attachAcks.length) {
    await send(ctx.supabase, ctx.from, { kind: 'text', body: `Added your photo to *${attachAcks.join('*, *')}*.` }, meta)
  }

  // STEP 3 — the grounded TYPED pick: an ambiguous photo item — is it one of these open items, or new?
  // Reuses the AWAIT_PROJECT mechanism (openConversation → answerSiteops). Rows are the typed shortlist
  // (kind-tagged) + a trailing "None — it's new". Resolved in answerSiteops (attach vs observe-create).
  // Takes precedence over the task disambig below — one pick at a time (both are rare together).
  if (typedPick) {
    const shortlist: PickCandidate[] = typedPick.shortlist.map((c) => ({ kind: c.kind, id: c.id, label: c.label }))
    const full: PickCandidate[] = candsForPick.map((c) => ({ kind: c.kind, id: c.id, label: c.label }))
    const confirm = buildConfirm({
      site: projectName, progress: out.progress, problems: out.problems, todos: out.todos,
      parked: out.parked.length, pendingPick: 1, ownerLabel: 'you', projectId, appBase: APP_BASE,
    })
    const convoId = await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: `which item: ${typedPick.item.text}`,
      slots: {
        kind: 'siteops_typed_pick', project_id: projectId, project_name: projectName,
        item: typedPick.item, shortlist, full, narration_id: narrationId,
        image: ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null,
      },
      lastMessageId: ctx.wamid,
    })
    await send(ctx.supabase, ctx.from, {
      kind: 'list',
      body: `${confirm}\n\nIs this photo about one of these open items, or something new?`,
      button: 'Pick',
      rows: [
        ...shortlist.map((c, i) => ({ id: `pick:${i + 1}`, title: shortLabel(c.label).slice(0, 24), description: `[${c.kind}]` })),
        { id: `pick:${shortlist.length + 1}`, title: "None — it's new" },
      ],
    }, { ...meta, capture: pickCapture(convoId, projectId) })
    return 'pick'
  }

  // STAGE 2c — disambiguation (need-to-ask): one pending question, mirroring AWAIT_PROJECT.
  if (out.ambiguous.length) {
    const first = out.ambiguous[0]
    const extraParked = out.ambiguous.length - 1   // ask about the first; the rare extras park
    // store node_key with each candidate (engine identity) so the resume writes the overlay-visible row.
    const candidates = first.candidates.map((t) => ({
      task_id: t.task_id, node_key: t.node_key ?? null, name: t.name, floor: t.floor_label, unit: t.unit_label,
    }))
    const ask = first.question ?? `Which task is "${first.item.text}"?`   // the resolver's exact ask, naming the real choices
    const confirm = buildConfirm({
      site: projectName,
      progress: out.progress, problems: out.problems, todos: out.todos,
      parked: out.parked.length + extraParked, pendingPick: 1, ownerLabel: 'you',
      projectId, appBase: APP_BASE,
    })
    const convoId = await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: `which task: ${first.item.text}`,
      slots: { kind: 'siteops_disambig', project_id: projectId, project_name: projectName, item: first.item, candidates, narration_id: narrationId, image: ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null },
      lastMessageId: ctx.wamid,
    })
    await send(ctx.supabase, ctx.from, {
      kind: 'list',
      body: `${confirm}\n\n${ask}`,
      button: 'Pick task',
      rows: candidates.slice(0, 10).map((c, i) => ({
        id: `pick:${i + 1}`,
        title: c.name.slice(0, 24),
        description: [c.floor ? (`${c.floor}`) : 'Site-wide', c.unit].filter(Boolean).join(' · '),
      })),
    }, { ...meta, capture: pickCapture(convoId, projectId) })
    return 'pick'   // left a task pick open
  }

  // STEP 3 — PURE-ATTACH terminal: every photo item attached to an existing item and nothing was left to
  // route. The attach ack already went out; a "got your update, logged" confirm here would be redundant
  // (and there are no created objects for an enrichment window). Done.
  if (ctx.image?.storagePath && attachAcks.length && !items2.length) return null

  // confirm (names the site so the sender can catch a mis-attribution). A single task update gets a
  // tappable "View task" button straight to that task. STEP 4a — carry a `readback` capture so the
  // drainer maps this confirm's outbound wamid to the objects it names.
  const readbackRefs = [
    ...out.problems.filter((p) => p.id).map((p) => ({ kind: 'problem', id: p.id as string })),
    ...out.todos.filter((t) => t.id).map((t) => ({ kind: 'todo', id: t.id as string })),
    ...out.progress.filter((pr) => pr.taskId).map((pr) => ({ kind: 'site_task', id: pr.taskId as string })),
  ]
  const readbackCapture: CaptureRef | undefined = readbackRefs.length
    ? { ref_kind: 'readback', project_id: projectId, object_refs: readbackRefs } : undefined
  await sendTaskConfirm(ctx, meta, projectName, projectId, {
    progress: out.progress, problems: out.problems, todos: out.todos, parked: out.parked.length,
  }, readbackCapture)

  // STEP 2 — ENRICHMENT WINDOW (images only). The photo is floored + read back above; now hold an OPEN
  // siteops_photo convo (~90s) so a follow-up TEXT (or a quoted-reply) ENRICHES these SAME objects rather
  // than creating a twin. Event-driven: the next message resumes via dispatch → classifyPhotoFollowup; no
  // timer/cron. photo→text ONLY here — text→photo is the known one-directional gap (see the dispatch
  // predicate). Opens only when the photo actually created object(s) to enrich.
  if (ctx.image?.storagePath) {
    const object_refs = [
      ...out.problems.filter((p) => p.id).map((p) => ({ kind: 'problem', id: p.id as string })),
      ...out.todos.filter((t) => t.id).map((t) => ({ kind: 'todo', id: t.id as string })),
      ...out.progress.filter((pr) => pr.taskId).map((pr) => ({ kind: 'site_task', id: pr.taskId })),
    ]
    if (object_refs.length) {
      const holdMs = Number(Deno.env.get('WA_SITEOPS_PHOTO_HOLD_MS') ?? '90000')
      const extract = [...out.problems.map((p) => p.title), ...out.todos.map((t) => t.text), ...out.progress.map((pr) => pr.taskName)].filter(Boolean).join(' · ')
      await openConversation(ctx.supabase, {
        orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
        pendingQuestion: 'photo enrichment window',
        slots: {
          kind: 'siteops_photo', object_refs, project_id: projectId, photo_wamid: ctx.wamid,
          hold_until: new Date(Date.now() + holdMs).toISOString(),
          label: shortLabel(extract || 'the photo'), extract, narration_id: narrationId,
        },
        lastMessageId: ctx.wamid,
      })
      return 'window'
    }
  }
  return null
}

/** Route ONE project's items → write + return its outcome (no send; the multi confirm composes). */
async function routeGroup(ctx: SiteopsCtx, projectId: string, items: SiteItem[], narrationId: string | null): Promise<RouteOutcome> {
  const vmNodeKeys = await materializeProjectTasks(ctx, projectId)
  const { data: taskRows } = await ctx.supabase.from('site_tasks').select(TASK_COLS).eq('project_id', projectId)
  const rawRows = (taskRows ?? []) as SiteTaskRow[]
  const tasks = engineTasks(rawRows)
  console.log(`[siteops:dbg:load] (multi) project=${projectId} rawRows=${rawRows.length} engineRows=${rawRows.filter((t) => t.node_key).length} flatRows=${rawRows.filter((t) => !t.node_key).length} usedForMatch=${tasks.length} vmNodeKeys=${vmNodeKeys.size}`)
  const oc = await ownerCtx(ctx.supabase, ctx.orgId, projectId)
  const rc: RouteCtx = { supabase: ctx.supabase, orgId: ctx.orgId, projectId, byLabel: ctx.from, ...oc, narrationId, now: new Date(), vmNodeKeys }
  return await routeItems(rc, tasks, items)
}

/**
 * MULTI-PROJECT narration — file each item against its OWN site, then confirm grouped by project.
 * Mirrors the transaction agent's multi-project handling (per-item project, one grouped receipt).
 * Capture-first: every confidently-sited item is written immediately; the ONE follow-up we ask is
 * the project pick for leftover items whose site couldn't be determined (the mis-file guard the
 * user called out — never silently attach an unprojected item to the first site).
 *
 * Task-level floor disambiguation is NOT chained across sites here (that would stack picks): a
 * task-ambiguous progress item parks (surfaced in the confirm, recoverable from the stored
 * narration). The single-project path keeps its task pick — only the multi path trades it away.
 */
async function runMulti(ctx: SiteopsCtx, items: SiteItem[], plan: ItemPlan, projects: ProjectRef[], narrationId: string | null): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  // The narration spans several sites, so the audit row carries no single project_id.
  await ctx.supabase.from('site_narrations').update({ project_id: null, decomposed: items, resolved_project_via: 'multi' }).eq('id', narrationId)

  // Group items by resolved project, preserving first-appearance order (carry-forward order).
  const groups = new Map<string, { project: ProjectRef; items: SiteItem[] }>()
  for (let i = 0; i < items.length; i++) {
    const pid = plan.assignment[i]
    if (!pid) continue
    const project = plan.projectsById.get(pid)
    if (!project) continue
    const g = groups.get(pid) ?? { project, items: [] }
    g.items.push(items[i])
    groups.set(pid, g)
  }

  // File each group (capture-first). ambiguous progress folds into the parked count (surfaced).
  const sections: ConfirmSection[] = []
  for (const { project, items: gItems } of groups.values()) {
    const out = await routeGroup(ctx, project.id, gItems, narrationId)
    sections.push({
      projectName: project.name, projectId: project.id,
      progress: out.progress, problems: out.problems, todos: out.todos,
      parked: out.parked.length + out.ambiguous.length,
    })
  }

  const pendingItems = plan.pendingIdxs.map((i) => items[i])
  if (pendingItems.length) {
    // Leftover items (ambiguous mention, or none-named-before-them) → ONE project pick, reusing the
    // AWAIT_PROJECT mechanism. The reply resumes in answerSiteops (siteops_project) → finishRoute.
    const candidates = projects.map((p) => ({ id: p.id, name: p.name }))
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: 'which project?',
      slots: { kind: 'siteops_project', items: pendingItems, candidates, narration_id: narrationId, image: ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null },
      lastMessageId: ctx.wamid,
    })
    const confirm = buildMultiConfirm(sections, { appBase: APP_BASE })
    const texts = pendingItems.map((it) => `"${it.text}"`).join(', ')
    const body = sections.length
      ? `${confirm}\n\nOne more — which project for ${texts}?`
      : `Which project for ${texts}?`
    await send(ctx.supabase, ctx.from, {
      kind: 'list', body, button: 'Pick project',
      rows: candidates.slice(0, 10).map((c, i) => ({ id: `pick:${i + 1}`, title: c.name.slice(0, 24) })),
    }, meta)
    return
  }

  // No leftovers — send the one grouped, per-project confirmation.
  await send(ctx.supabase, ctx.from, { kind: 'text', body: buildMultiConfirm(sections, { appBase: APP_BASE }) }, meta)
}

// "answer-or-let-go" — given the question the assistant asked and the user's reply, judge (LLM,
// language-agnostic, by MEANING) whether they're trying to ANSWER it or want to LET IT GO. Only
// consulted AFTER a real pick fails to match, so an honest misroute never traps the user.
async function judgePending(question: string, reply: string): Promise<'answer' | 'letgo'> {
  try {
    const sys = `You decide whether a user's WhatsApp reply is TRYING TO ANSWER a specific question the assistant asked, or wants to LET IT GO — i.e. they decline, dismiss it, say it isn't relevant, or change the subject. Replies may be English, Telugu, Hindi, or a code-mix; judge by MEANING, not keywords.
Return ONLY JSON: {"answering": true|false}. true = an attempt to answer it (even vague / misspelled / partial); false = declining / not-for-this / off-topic.`
    const user = `The assistant asked: "${question}"\nThe user replied: "${reply.slice(0, 300)}"\nAre they trying to answer that question?`
    const parsed = safeParse(await callLLM(sys, user)) as { answering?: unknown } | null
    if (!parsed || typeof parsed.answering !== 'boolean') return 'answer'   // unsure → keep helping (never wrongly drop a real answer)
    return parsed.answering ? 'answer' : 'letgo'
  } catch { return 'answer' }
}

/** STEP 2 — the PURE steering decision for a text arriving while a siteops_photo window is OPEN. related →
 *  enrich (dispatch routes ANSWERS_PENDING → the branch in answerSiteops); unrelated → route fresh
 *  (dispatch reclassifies; the interruption block closes the window clean); noop → bare affirmation, close
 *  clean. No DB, no LLM — relatedness is conservative lexical overlap (see _siteops_assoc). */
export function classifyPhotoFollowup(convo: ConvoRow, text: string, quotedWamid: string | null, nowMs: number): AssocVerdict {
  const slots = (convo.slots_so_far ?? {}) as Record<string, unknown>
  const holdUntil = typeof slots.hold_until === 'string' ? Date.parse(slots.hold_until) : 0
  const extract = `${slots.label ?? ''} ${slots.extract ?? ''}`
  return decideAssociation({
    withinHold: Number.isFinite(holdUntil) && holdUntil > nowMs,
    bareAffirmation: isBareAffirmation(text),
    quotedMatchesHeld: !!quotedWamid && quotedWamid === slots.photo_wamid,
    relatedness: photoRelatedness(extract, text),
  })
}

/** STEP 2 — on the UNCERTAIN→unrelated fail-safe, stamp the held photo objects with a
 *  possible_photo_followup note (pending_reanalysis) so Step 3's dedup can reunite the pair. Best-effort;
 *  never blocks the fresh re-route. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function stampPossibleFollowup(supabase: any, orgId: string, convo: ConvoRow, text: string): Promise<void> {
  const refs = ((convo.slots_so_far as Record<string, unknown>)?.object_refs ?? []) as { kind: string; id: string }[]
  for (const r of refs) {
    if (r.kind !== 'problem' && r.kind !== 'todo') continue
    const row = { org_id: orgId, problem_id: r.kind === 'problem' ? r.id : null, todo_id: r.kind === 'todo' ? r.id : null, type: 'possible_photo_followup', body: text.slice(0, 500), actor_kind: 'system', actor_id: null }
    let ins = await supabase.from('followup_events').insert({ ...row, pending_reanalysis: true })
    if (ins.error) ins = await supabase.from('followup_events').insert(row)
    if (ins.error) console.error('[siteops:followup-stamp] insert failed:', ins.error.message)
  }
}

/** STEP 4b — a QUOTED-REPLY to one of our SENT messages, resolved via wa_message_map (Step 4a). Today
 *  the only mapped consumer is a task READBACK: the reply is an authoritative CORRECTION of what we
 *  logged. Returns TRUE if it handled the message (dispatch then stops); FALSE if the wamid isn't ours
 *  / isn't a readback (normal routing continues). The map keys OUTBOUND wamids, so this can't fire on a
 *  reply to the user's own photo (the enrichment window matches the INBOUND photo wamid). */
export async function handleQuotedReply(ctx: SiteopsCtx, text: string, quotedWamid: string): Promise<boolean> {
  // STEP 5b — LATE ANSWER: a quoted-reply to a PARKED pick's original question (context.id ===
  // siteops_unplaced.question_wamid). Recover the park and place it before anything else. The select
  // tolerates an unmigrated question_wamid column (error → skip → fall through).
  const parkedRes = await ctx.supabase.from('siteops_unplaced')
    .select('id, reason, observation, candidates, project_id, object_path, caption, narration_id')
    .eq('question_wamid', quotedWamid).eq('status', 'unplaced').maybeSingle()
  if (!parkedRes.error && parkedRes.data) { await placeLateAnswer(ctx, text, parkedRes.data as ParkedRow & { id: string }); return true }

  const { data } = await ctx.supabase.from('wa_message_map')
    .select('ref_kind, project_id, object_refs').eq('outbound_wamid', quotedWamid).maybeSingle()
  if (!data || data.ref_kind !== 'readback') return false
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const refs = (data.object_refs ?? []) as { kind: string; id: string }[]
  // STEP 5 — RETRACTION ("ignore that" / "wrong photo") wins over a field correction: the user is
  // undoing the log, not editing it. Dismiss (never hard-delete — the evidence stays).
  if (isRetraction(text)) {
    const n = await dismissRefs(ctx.supabase, ctx.orgId, refs)
    await send(ctx.supabase, ctx.from, { kind: 'text', body: n ? `Dismissed — pulled ${n} item${n > 1 ? 's' : ''} back out (the photo/record stays). 👍` : `Noted 👍` }, meta)
    return true
  }
  await correctReadback(ctx, text, refs)
  return true
}

/** STEP 5 — an inbound REACTION on one of our sent messages (resolved via wa_message_map). A positive
 *  reaction on a task READBACK confirms it (a trail touch, no state change — resolution stays explicit);
 *  a 👎 retracts (dismiss). Unmapped / unclassified → silently ignored (a reaction is never an error). */
export async function handleReaction(supabase: SiteopsCtx['supabase'], p: { orgId: string; from: string; reaction: { message_id: string; emoji: string } }): Promise<void> {
  const intent = classifyReaction(p.reaction.emoji)
  if (intent === 'neutral' || !p.reaction.message_id) return
  const { data } = await supabase.from('wa_message_map')
    .select('ref_kind, object_refs').eq('outbound_wamid', p.reaction.message_id).maybeSingle()
  if (!data || data.ref_kind !== 'readback') return
  const refs = (data.object_refs ?? []) as { kind: string; id: string }[]
  if (intent === 'retract') {
    const n = await dismissRefs(supabase, p.orgId, refs)
    if (n) await send(supabase, p.from, { kind: 'text', body: `Dismissed — pulled ${n} item${n > 1 ? 's' : ''} back out (the record stays). 👍` }, { org_id: p.orgId })
    return
  }
  await confirmRefs(supabase, p.orgId, refs)   // positive → a quiet confirmation touch on the trail
}

/** Flip mapped issue/todo refs to the terminal DISMISSED state + trail it. Evidence (attachments) is
 *  untouched. site_task refs are skipped — a task is structural, not a per-item log to retract. Returns
 *  how many were dismissed. */
async function dismissRefs(supabase: SiteopsCtx['supabase'], orgId: string, refs: { kind: string; id: string }[]): Promise<number> {
  let n = 0
  for (const r of refs) {
    let err: { message: string } | null = null
    if (r.kind === 'problem') ({ error: err } = await supabase.from('problems').update({ status: 'DISMISSED' }).eq('id', r.id))
    else if (r.kind === 'todo') ({ error: err } = await supabase.from('todos').update({ status: 'DISMISSED' }).eq('id', r.id))
    else continue
    // Don't claim a dismissal we didn't land (e.g. the DISMISSED status isn't migrated yet, or the row
    // is gone) — the ack degrades to a plain "Noted" rather than a false "Dismissed".
    if (err) { console.error('[siteops:dismiss] failed:', err.message); continue }
    await supabase.from('followup_events').insert({
      org_id: orgId, problem_id: r.kind === 'problem' ? r.id : null, todo_id: r.kind === 'todo' ? r.id : null,
      type: 'status_changed', body: 'Dismissed by user (retraction) — evidence kept', actor_kind: 'user', actor_id: null,
    })
    n++
  }
  return n
}

/** A positive reaction on a readback → a quiet 'comment' confirmation on each mapped issue/todo. No
 *  state change: a 👍 means "logged right", not "resolved" (resolution stays an explicit action). */
async function confirmRefs(supabase: SiteopsCtx['supabase'], orgId: string, refs: { kind: string; id: string }[]): Promise<void> {
  for (const r of refs) {
    if (r.kind !== 'problem' && r.kind !== 'todo') continue
    await supabase.from('followup_events').insert({
      org_id: orgId, problem_id: r.kind === 'problem' ? r.id : null, todo_id: r.kind === 'todo' ? r.id : null,
      type: 'comment', body: 'Confirmed by sender 👍', actor_kind: 'user', actor_id: null,
    })
  }
}

/** STEP 5b — place a recovered parked pick: rebuild the resume slots, RE-OPEN the convo with them, and
 *  route the late answer through the SAME answerSiteops branch it would have hit live; then mark the
 *  parked row placed. Delegating (not re-implementing) keeps the placement logic single-sourced. */
async function placeLateAnswer(ctx: SiteopsCtx, text: string, parked: ParkedRow & { id: string }): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const slots = reconstructParkedSlots(parked)
  if (!slots) {   // an evidence-only park (no pending choice) — nothing to re-answer; leave it queued.
    await send(ctx.supabase, ctx.from, { kind: 'text', body: `That one's on your to-place list — open it in the app to sort it.` }, meta)
    return
  }
  // Re-open the pick as a live convo so answerSiteops drives AND closes it through the normal lifecycle.
  await openConversation(ctx.supabase, {
    orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS', pendingQuestion: 'late answer', slots, lastMessageId: ctx.wamid,
  })
  const convo = {
    id: '', org_id: ctx.orgId, sender_number: ctx.from, owning_agent: 'SITEOPS', status: 'OPEN',
    pending_question: 'late answer', slots_so_far: slots, staged_entry_id: null,
    last_action_summary: null, opened_at: '', closed_at: null, purge_at: null, last_message_id: ctx.wamid,
  } as ConvoRow
  await answerSiteops(ctx, text, convo)
  await ctx.supabase.from('siteops_unplaced').update({ status: 'placed', resolved_at: new Date().toISOString() }).eq('id', parked.id)
}

/** Apply an authoritative field CORRECTION (cause / deadline) to the objects a readback named. Reuses
 *  the text extractor (decompose) + distillSignal; planCorrection OVERWRITES (the user is fixing THIS).
 *  A bare "ok" quoting the readback is a confirmation, not a correction. site_task refs are skipped — a
 *  progress correction is re-association / QC (heavier; not 4b). */
async function correctReadback(ctx: SiteopsCtx, text: string, refs: { kind: string; id: string }[]): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  if (isBareAffirmation(text)) { await send(ctx.supabase, ctx.from, { kind: 'text', body: 'Got it 👍' }, meta); return }

  let items: SiteItem[] = []
  try { items = (await decompose(text)).items } catch { items = [] }
  const sig = distillSignal(items)
  const now = new Date()
  const changed = new Set<string>()
  let sawEditable = false
  for (const r of refs) {
    if (r.kind !== 'problem' && r.kind !== 'todo') continue   // site_task = progress axis; not 4b
    sawEditable = true
    const kind: 'issue' | 'todo' = r.kind === 'problem' ? 'issue' : 'todo'
    const res = kind === 'issue'
      ? await ctx.supabase.from('problems').select('cause, deadline').eq('id', r.id).maybeSingle()
      : await ctx.supabase.from('todos').select('due_date').eq('id', r.id).maybeSingle()
    const row = res.data as Record<string, string | null> | null
    if (!row) continue
    const plan = planCorrection(
      { kind, cause: kind === 'issue' ? (row.cause ?? null) : null, deadline: kind === 'issue' ? (row.deadline ?? null) : (row.due_date ?? null) },
      sig, now,
    )
    if (!plan.changed) continue
    if (kind === 'issue') {
      const upd: Record<string, string> = {}
      if (plan.updates.cause) upd.cause = plan.updates.cause
      if (plan.updates.deadline) upd.deadline = plan.updates.deadline
      await ctx.supabase.from('problems').update(upd).eq('id', r.id)
    } else if (plan.updates.deadline) {
      await ctx.supabase.from('todos').update({ due_date: plan.updates.deadline }).eq('id', r.id)
    }
    await ctx.supabase.from('followup_events').insert({
      org_id: ctx.orgId, problem_id: kind === 'issue' ? r.id : null, todo_id: kind === 'todo' ? r.id : null,
      type: 'status_changed', body: `Corrected — ${Object.entries(plan.updates).map(([k, v]) => `${k} → ${v}`).join(', ')}`,
      actor_kind: 'user', actor_id: await senderUserId(ctx),
    })
    for (const k of Object.keys(plan.updates)) changed.add(k === 'deadline' ? (kind === 'todo' ? 'due date' : 'deadline') : 'cause')
  }
  const body = changed.size
    ? `Fixed — updated the ${[...changed].join(' & ')}. 👍`
    : sawEditable
      ? `Noted — I couldn't spot a change to make from that. Tell me the cause or the due date and I'll correct it.`
      : `Noted 👍`
  await send(ctx.supabase, ctx.from, { kind: 'text', body }, meta)
}

/** Resume a pending SITEOPS follow-up — a project pick OR a task disambiguation. */
export async function answerSiteops(ctx: SiteopsCtx, text: string, convo: ConvoRow, opts: { callModel?: (system: string, user: string) => Promise<string> } = {}): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = (convo.slots_so_far ?? {}) as any

  // ── STEP 2: enrichment-window resume. We only reach here (ANSWERS_PENDING) when dispatch judged the
  //    follow-up RELATED to the just-logged photo (classifyPhotoFollowup); unrelated/noop are handled at
  //    the dispatch layer, never here. CONSERVATIVE merge: trail the text as a description on each held
  //    issue/todo (the activity feed shows "description added"), stamped pending_reanalysis so Step 3 can
  //    harvest it — NO re-typing / no new observations (that needs Step 3 dedup). One ack, then close. ──
  if (slots.kind === 'siteops_photo') {
    const refs = (slots.object_refs ?? []) as { kind: 'problem' | 'todo' | 'site_task'; id: string }[]
    const actorId = await senderUserId(ctx)
    let trailed = 0
    for (const r of refs) {
      if (r.kind === 'problem' || r.kind === 'todo') {
        await trailEvent(ctx, { kind: r.kind === 'problem' ? 'issue' : 'todo', id: r.id, orgId: ctx.orgId }, 'description_added', text.slice(0, 500), actorId, true)
        trailed++
      }
    }
    await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'photo + note' })
    await send(ctx.supabase, ctx.from, { kind: 'text', body: trailed ? `Added your note to what I logged from the photo. 👍` : `Noted with the photo. 👍` }, meta)
    return
  }

  // ── B3 same-cause collision → the supervisor named the site for the held item ──
  if (slots.kind === 'siteops_batch_collision') {
    const cands = (slots.candidates ?? []) as { id: string; kind: 'issue' | 'todo'; orgId: string; projectId?: string | null; projectName: string; title: string; cause: string | null }[]
    const t = text.trim().toLowerCase()
    const m = text.match(/(\d+)/)
    const num = m ? parseInt(m[1], 10) : null
    // FIX 2 — the "None — it's new" row (past the candidate count) or a typed new/none → route the piece
    // FRESH to the project; never force a genuinely-new observation onto a chase.
    if ((num !== null && num > cands.length) || (num === null && /\b(new|none|different|separate|fresh)\b/i.test(text))) {
      const pid = (slots.project_id as string | null) ?? cands[0]?.projectId ?? null
      const pieceText = (slots.piece_text as string | null) ?? text
      await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
      if (!pid) {
        await send(ctx.supabase, ctx.from, { kind: 'text', body: `Got it — send that as a new update with the site and I'll log it.` }, meta)
        return
      }
      const dec = await decompose(pieceText).catch(() => ({ items: [] as SiteItem[], project_hint: null }))
      const items = dec.items.length ? dec.items
        : [{ type: 'issue', text: pieceText, task_hint: null, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: null } as SiteItem]
      const out = await routeGroup(ctx, pid, items, (slots.narration_id as string | null) ?? null)
      const cimg = slots.image as { storagePath?: string; caption?: string | null } | null
      if (cimg?.storagePath) {
        for (const p of out.problems) if (p.id) await attachImage(ctx, 'problem', p.id, cimg.storagePath, cimg.caption ?? null, 'creation')
        for (const td of out.todos) if (td.id) await attachImage(ctx, 'todo', td.id, cimg.storagePath, cimg.caption ?? null, 'creation')
      }
      const n = out.problems.length + out.todos.length + out.progress.length
      await send(ctx.supabase, ctx.from, { kind: 'text', body: n ? `Logged as new — *${shortLabel(pieceText)}*. 👍` : `Noted 👍` }, meta)
      return
    }
    const idx = num !== null ? num - 1
      : cands.findIndex((c) => shortLabel(c.title).toLowerCase().includes(t) && t.length >= 3)
    const chosen = idx >= 0 && idx < cands.length ? cands[idx] : null
    if (!chosen) {
      if (await judgePending(`which of these is "${slots.piece_text ?? 'this'}" about, or is it new?`, text) === 'letgo') {
        // bail — the item stays in the batch and gets re-asked next cycle
        await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
        await send(ctx.supabase, ctx.from, { kind: 'text', body: `No problem — I'll check back on it next time.` }, meta)
        return
      }
      await send(ctx.supabase, ctx.from, { kind: 'text', body: `Reply with the number, or say *new* if it's a separate thing.` }, meta)
      return
    }
    const now = new Date()
    const cadenceMap = await loadCadenceMap(ctx.supabase, ctx.orgId)
    const actorId = await senderUserId(ctx)
    const item: BatchItem = { kind: chosen.kind, id: chosen.id, orgId: chosen.orgId, projectId: null, projectName: chosen.projectName, title: chosen.title, taskName: null, cause: chosen.cause }
    const verdict = await applyBatchResolution(ctx, item, slots.status ?? 'still_open', slots.piece_text ?? text, cadenceMap, actorId, now)
    // STEP 3: if the colliding message was a PHOTO (carried in slots), attach it to the chosen item now.
    const cimg = slots.image as { storagePath?: string; caption?: string | null } | null
    if (cimg?.storagePath) await answerWithPhoto(ctx, { kind: item.kind, id: item.id, orgId: item.orgId }, cimg.storagePath, cimg.caption ?? null)
    const batch = await getOpenBatch(ctx.supabase, ctx.orgId, ctx.from)
    if (batch) await dropBatchItems(ctx.supabase, batch, [chosen.id])
    await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
    await send(ctx.supabase, ctx.from, { kind: 'text', body: `${readbackPart(item, verdict)} — ${chosen.projectName}` }, meta)
    return
  }

  // ── STEP 3: multi-item chase reply was a PHOTO with no clear match → supervisor picks which item
  //    it's about; attach the carried photo to that item (never fresh). ──
  if (slots.kind === 'siteops_photo_pick') {
    const cands = (slots.candidates ?? []) as { id: string; kind: 'issue' | 'todo'; orgId: string; title: string }[]
    const img = (slots.image ?? {}) as { storagePath?: string; caption?: string | null }
    const t = text.trim().toLowerCase()
    const m = text.match(/(\d+)/)
    const idx = m ? parseInt(m[1], 10) - 1 : cands.findIndex((c) => shortLabel(c.title).toLowerCase().includes(t) && t.length >= 3)
    const chosen = idx >= 0 && idx < cands.length ? cands[idx] : null
    if (!chosen || !img.storagePath) {
      await send(ctx.supabase, ctx.from, { kind: 'text', body: `Reply with the number of the item this photo is about.` }, meta)
      return
    }
    await answerWithPhoto(ctx, { kind: chosen.kind, id: chosen.id, orgId: chosen.orgId }, img.storagePath, img.caption ?? null)
    await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'photo attached' })
    await send(ctx.supabase, ctx.from, { kind: 'text', body: `Added your photo to *${shortLabel(chosen.title)}*.` }, meta)
    return
  }

  // ── STEP 3: grounded TYPED pick resume — attach the photo to a chosen existing item, or (None/new)
  //    create the held item fresh (observe). Typed-answer full-set fallback lives in resolveTypedPick. ──
  if (slots.kind === 'siteops_typed_pick') {
    const shortlist = (slots.shortlist ?? []) as PickCandidate[]
    const full = (slots.full ?? []) as PickCandidate[]
    const img = (slots.image ?? {}) as { storagePath?: string; caption?: string | null }
    const storedItem = slots.item as SiteItem
    const d = resolveTypedPick(shortlist, full, text)
    if (d.kind === 'none') {
      if (await judgePending('is this photo about one of those open items, or something new?', text) === 'letgo') {
        await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'photo' })
        await send(ctx.supabase, ctx.from, { kind: 'text', body: `Left it for now — send it again if you'd like it logged.` }, meta)
        return
      }
      await send(ctx.supabase, ctx.from, { kind: 'text', body: `Reply with the number, or *new* if it's not one of those.` }, meta)
      return
    }
    if (d.kind === 'attach') {
      if (img.storagePath) await attachExistingEvidence(ctx, { kind: d.target.kind, id: d.target.id }, img.storagePath, img.caption ?? null)
      await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'photo attached' })
      await send(ctx.supabase, ctx.from, { kind: 'text', body: `Added your photo to *${shortLabel(d.target.label)}*.` }, meta)
      return
    }
    // observe — create the held item fresh, attach the photo as creation evidence, confirm.
    const out = await routeGroup(ctx, slots.project_id, [storedItem], slots.narration_id ?? null)
    if (img.storagePath) {
      for (const p of out.problems) if (p.id) await attachImage(ctx, 'problem', p.id, img.storagePath, img.caption ?? null, 'creation')
      for (const t of out.todos) if (t.id) await attachImage(ctx, 'todo', t.id, img.storagePath, img.caption ?? null, 'creation')
      for (const pr of out.progress) if (pr.taskId) await attachImage(ctx, 'site_task', pr.taskId, img.storagePath, img.caption ?? null, 'creation')
    }
    await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
    await sendTaskConfirm(ctx, meta, slots.project_name ?? null, slots.project_id, {
      progress: out.progress, problems: out.problems, todos: out.todos, parked: out.parked.length,
    })
    return
  }

  // ── project pick → route the STORED decomposition against the chosen project ──
  if (slots.kind === 'siteops_project') {
    const candidates = (slots.candidates ?? []) as { id: string; name: string }[]
    const t = text.trim().toLowerCase()
    const m = text.match(/(\d+)/)
    const idx = m ? parseInt(m[1], 10) - 1
      : candidates.findIndex((c) => { const n = c.name.toLowerCase(); return n === t || (n.includes(t) && t.length >= 3) || (t.includes(n) && n.length >= 3) })
    const chosen = idx >= 0 && idx < candidates.length ? candidates[idx] : null
    if (!chosen) {
      // Not a project pick — judge whether they're answering or want out; never trap a misroute.
      if (await judgePending('which project is this site note for?', text) === 'letgo') {
        await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'note dropped' })
        await send(ctx.supabase, ctx.from, { kind: 'text', body: `No worries — I've left that out. If it's a site note, just send it again with the site name. 👍` }, meta)
        return
      }
      await send(ctx.supabase, ctx.from, { kind: 'text', body: `I didn't catch the project — reply with its number or name, or *skip* if it's not a site note.` }, meta)
      return
    }
    if (slots.narration_id) {
      await ctx.supabase.from('site_narrations').update({ project_id: chosen.id, resolved_project_via: 'selected' }).eq('id', slots.narration_id)
    }
    // UNIT-STYLE slots (they carry the raw `text` — E2): run the REMAINDER of the singular unit against
    // the PICKED project — its candidates, one resolveInbound, apply/create under the enforcement floor.
    // No re-extraction (the stored decomposition IS the extraction; journey (c) counts the calls).
    // Legacy slots (no text: parked-row reconstructions, runMulti holds, executor which_project picks)
    // keep the proven finishRoute create path.
    if (typeof slots.text === 'string') {
      const storedItems = (slots.items ?? []) as SiteItem[]
      const storedFirst = storedItems[0] ?? null
      const batch = await getOpenBatch(ctx.supabase, ctx.orgId, ctx.from)
      await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
      await runSingularUnit(ctx, {
        projectId: chosen.id,
        text: storedItems.length >= 2 ? storedFirst!.text : slots.text,
        rest: storedItems.slice(1),
        batch,
        narrationId: slots.narration_id ?? null,
        callModel: opts.callModel ?? callLLM,
      })
      return
    }
    const awaiting = await finishRoute(ctx, chosen.id, chosen.name, (slots.items ?? []) as SiteItem[], slots.narration_id ?? null)
    // finishRoute reuses the OPEN convo when it opens a task pick; otherwise we're done.
    if (!awaiting) await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
    return
  }

  if (slots.kind !== 'siteops_disambig') {
    await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site note' })
    await send(ctx.supabase, ctx.from, { kind: 'text', body: 'Okay.' }, meta)
    return
  }
  const candidates = (slots.candidates ?? []) as { task_id: string; node_key?: string | null; name: string; floor: string | null; unit: string | null }[]
  const m = text.match(/(\d+)/)
  const pickIdx = m ? parseInt(m[1], 10) - 1 : candidates.findIndex((c) => c.name.toLowerCase() === text.trim().toLowerCase())
  const chosen = pickIdx >= 0 ? candidates[pickIdx] : null
  if (!chosen) {
    if (await judgePending('which task is this update about?', text) === 'letgo') {
      await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
      await send(ctx.supabase, ctx.from, { kind: 'text', body: `Left that one for now — send it again with the floor/task if you'd like it logged.` }, meta)
      return
    }
    await send(ctx.supabase, ctx.from, { kind: 'text', body: `Reply with the number of the task, or *skip* to leave it.` }, meta)
    return
  }

  const vmNodeKeys = await materializeProjectTasks(ctx, slots.project_id)
  const { data: taskRows } = await ctx.supabase.from('site_tasks').select(TASK_COLS).eq('task_id', chosen.task_id)
  const task = (taskRows ?? [])[0] as SiteTaskRow | undefined
  console.log(`[siteops:dbg:resume-pick] task_id=${chosen.task_id} node_key=${task?.node_key ?? 'NULL'} visibleInVM=${!!(task?.node_key && vmNodeKeys.has(task.node_key))}`)
  const oc = await ownerCtx(ctx.supabase, ctx.orgId, slots.project_id)
  const rc: RouteCtx = { supabase: ctx.supabase, orgId: ctx.orgId, projectId: slots.project_id, byLabel: ctx.from, ...oc, narrationId: slots.narration_id ?? null, now: new Date(), vmNodeKeys }

  await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
  if (!task) {
    await send(ctx.supabase, ctx.from, { kind: 'text', body: `I couldn't find that task anymore — send the update again and I'll re-place it.` }, meta)
    return
  }
  const res = await applyProgress(rc, task, slots.item)
  // GUARDRAIL (Step 3): a pick that resolved to a row the UI can't render must NEVER read back as
  // "✓ logged" — that's the silent-loss bug. Be honest and let the supervisor re-place it.
  if (!res.visibleInVM) {
    await send(ctx.supabase, ctx.from, { kind: 'text', body: `I couldn't attach that to a task on your screen — send it again with the floor/task and I'll place it.` }, meta)
    return
  }
  await sendTaskConfirm(ctx, meta, slots.project_name ?? null, slots.project_id, { progress: [res], problems: [], todos: [], parked: 0 })
}
