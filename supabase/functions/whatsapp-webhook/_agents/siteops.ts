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
import { loadCandidates, prefilterCandidates, groundingLabels } from '../_siteops_candidates.ts'
import {
  routeItems, applyProgress, buildConfirm, buildMultiConfirm, parseWhen,
  type RouteCtx, type RouteOutcome, type SiteTaskRow, type OrgMember,
  type ConfirmSection, type ProgressResult, type ProblemResult, type TodoResult,
} from '../_siteops_route.ts'
import { loadCadenceMap, type CadenceMap } from '../_siteops_timing.ts'
import {
  getOpenBatch, dropBatchItems, matchPieceToBatch, interpretStatus,
  type OpenBatch, type BatchItem,
} from '../_siteops_batch.ts'
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
): Promise<void> {
  const single = outc.progress.length === 1 && outc.problems.length === 0 && outc.todos.length === 0 ? outc.progress[0] : null
  const base = { site, progress: outc.progress, problems: outc.problems, todos: outc.todos, parked: outc.parked, pendingPick: 0, ownerLabel: 'you', projectId, appBase: APP_BASE }
  if (single?.nodeKey && APP_BASE) {
    const url = `${APP_BASE}/projects/${projectId}/tasks?task=${encodeURIComponent(single.nodeKey)}`
    await send(ctx.supabase, ctx.from, { kind: 'cta', body: buildConfirm({ ...base, ctaMode: true }), cta: { text: 'View task', url } }, meta)
    return
  }
  await send(ctx.supabase, ctx.from, { kind: 'text', body: buildConfirm(base) }, meta)
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
  // Fresh-observation picks carry the item(s); answer-evidence picks carry only the photo.
  const observation =
    kind === 'siteops_disambig' ? (slots.item ?? null)
    : kind === 'siteops_project' ? (Array.isArray(slots.items) && slots.items.length ? { items: slots.items } : null)
    : null
  const objectPath = image?.storagePath ?? null
  const closeClean = () => closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'parked to place' })

  // Nothing recoverable to preserve (e.g. an answer-evidence pick with no photo carried) → close cleanly, no phantom row.
  if (observation == null && !objectPath) { await closeClean(); return '' }

  const reason = kind === 'siteops_disambig' ? 'disambig'
    : kind === 'siteops_project' ? 'project'
    : kind === 'siteops_photo_pick' ? 'photo_pick'
    : kind === 'siteops_batch_collision' ? 'batch_collision'
    : 'floor'
  const { error } = await ctx.supabase.from('siteops_unplaced').insert({
    org_id: ctx.orgId,
    project_id: (slots.project_id as string | null) ?? null,
    reason,
    observation,
    candidates: slots.candidates ?? null,
    bucket: objectPath ? 'rough-entry-media' : null,
    object_path: objectPath,
    caption: image?.caption ?? (typeof slots.piece_text === 'string' ? slots.piece_text : null),
    narration_id: (slots.narration_id as string | null) ?? null,
    sender_number: ctx.from,
    created_by: null,
  })
  if (error) console.error('[siteops:park] siteops_unplaced insert failed:', error.message)
  await closeClean()
  return objectPath ? `Kept that photo to place later.` : `Kept your earlier note to place later.`
}

const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
/** First few words of an item's title — the short label for the readback line. */
const shortLabel = (title: string) => title.trim().split(/\s+/).slice(0, 3).join(' ')

/** Append one trail event (B1) for a batch item. actorId present → a human reply. */
async function trailEvent(ctx: SiteopsCtx, item: { kind: 'issue' | 'todo'; id: string; orgId: string }, type: string, body: string, actorId: string | null): Promise<void> {
  await ctx.supabase.from('followup_events').insert({
    org_id: item.orgId,
    problem_id: item.kind === 'issue' ? item.id : null,
    todo_id: item.kind === 'todo' ? item.id : null,
    type, body, actor_kind: actorId ? 'user' : 'system', actor_id: actorId ?? null,
  })
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
): Promise<'resolved' | 'open'> {
  await trailEvent(ctx, item, 'reply_received', replyText.slice(0, 180), actorId)

  // ISSUES → LLM judgment (with reason); fall back to the keyword status if the model is
  // unavailable. TO-DOS → keyword strike-off.
  let resolved: boolean
  let reason = ''
  if (item.kind === 'issue') {
    const judged = await judgeResolution({ title: item.title, cause: item.cause }, replyText)
    resolved = judged ? judged.resolved : status === 'resolved'
    reason = judged?.reason ?? ''
  } else {
    resolved = status === 'resolved'
  }

  if (resolved) {
    const note = reason || replyText.trim().slice(0, 140)
    if (item.kind === 'issue') {
      await ctx.supabase.from('problems').update({ status: 'RESOLVED', next_followup_at: null }).eq('id', item.id)
      await trailEvent(ctx, item, 'status_changed', note ? `Resolved — ${note}` : 'Resolved — confirmed by reply', actorId)
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
async function handleBatchReply(
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

  if (allClear) {
    for (let i = 0; i < batch.items.length; i++) {
      const v = await applyBatchResolution(ctx, batch.items[i], 'resolved', text, cadenceMap, actorId, now)
      resolutions.push({ item: batch.items[i], verdict: v }); matchedIdx.add(i)
    }
  } else {
    // ONE pending item + a SINGLE-fragment reply → it's about that item, attach it even if
    // we can't classify the status word (terse / non-English replies). The reply is recorded
    // (interpretStatus then decides resolve vs keep-open). Multi-fragment → match per piece.
    const singleAnswer = batch.items.length === 1 && frags.length === 1
    for (const piece of frags) {
      const m = (singleAnswer || (batch.items.length === 1 && interpretStatus(piece.text) !== 'unknown'))
        ? { kind: 'unique' as const, index: 0 }
        : matchPieceToBatch(piece, batch.items)

      if (m.kind === 'unique') {
        if (matchedIdx.has(m.index)) continue
        matchedIdx.add(m.index)
        const status = interpretStatus(piece.text)
        const v = await applyBatchResolution(ctx, batch.items[m.index], status, piece.text, cadenceMap, actorId, now)
        resolutions.push({ item: batch.items[m.index], verdict: v })
      } else if (m.kind === 'collision' && !collision) {
        collision = { piece, items: m.indexes.map((i) => batch.items[i]), status: interpretStatus(piece.text) }
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
    if (batch.items.length === 1) {
      await answerWithPhoto(ctx, batch.items[0], photo.sp, photo.cap)
      await send(ctx.supabase, ctx.from, { kind: 'text', body: `Added your photo to *${shortLabel(batch.items[0].title)}*.` }, meta)
      return true
    }
    const cands = batch.items.map((it) => ({ id: it.id, kind: it.kind, orgId: it.orgId, projectName: it.projectName, title: it.title, cause: it.cause }))
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

  // GENUINE COLLISION → everything else is already resolved/dropped; ask ONLY about the collider.
  if (collision) {
    const cands = collision.items.map((it) => ({ id: it.id, kind: it.kind, orgId: it.orgId, projectName: it.projectName, title: it.title, cause: it.cause }))
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: `which site: ${collision.piece.text}`,
      slots: { kind: 'siteops_batch_collision', status: collision.status, piece_text: collision.piece.text, candidates: cands, image: photo ? { storagePath: photo.sp, caption: photo.cap } : null },
      lastMessageId: ctx.wamid,
    })
    const sites = collision.items.map((it) => it.projectName)
    await send(ctx.supabase, ctx.from, {
      kind: 'list',
      body: `${head}${extra}\n\n"${shortLabel(collision.piece.text)}" — which site? ${sites.join(' or ')}?`,
      button: 'Pick site',
      rows: cands.slice(0, 10).map((c, i) => ({ id: `pick:${i + 1}`, title: c.projectName.slice(0, 24) })),
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

export async function runSiteops(ctx: SiteopsCtx, text: string, opts: { prefix?: string } = {}): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const say = (body: string) => send(ctx.supabase, ctx.from, { kind: 'text', body: opts.prefix ? `${opts.prefix}\n\n${body}` : body }, meta)

  // B3 — an open chase batch for this sender? (sorted against AFTER we decompose.)
  const batch = await getOpenBatch(ctx.supabase, ctx.orgId, ctx.from)

  // Capture-first: persist the raw narration immediately so nothing is ever lost. Stamp the sender's
  // name so the task feed shows who sent it; fall back without the column if the migration isn't applied
  // yet (capture-first must never fail on a missing column).
  const base = { org_id: ctx.orgId, raw_text: text, resolved_project_via: 'unresolved' }
  let ins = await ctx.supabase.from('site_narrations').insert({ ...base, sender_name: await senderName(ctx) }).select('id').single()
  if (ins.error) ins = await ctx.supabase.from('site_narrations').insert(base).select('id').single()
  const narrationId: string | null = ins.data?.id ?? null

  // Roster for project resolution: hand the extractor the org's active project NAMES so it
  // returns the CANONICAL project (semantic match), mirroring the transaction agent. Then
  // resolveProject's string match is just a safety net, not the primary resolver. We load ids
  // too so the multi-project planner can resolve each item's site without a second round-trip.
  const { data: projRows } = await ctx.supabase.from('projects').select('project_id, name').eq('org_id', ctx.orgId).eq('status', 'Active')
  const projects: ProjectRef[] = ((projRows ?? []) as { project_id: string; name: string }[]).map((p) => ({ id: p.project_id, name: p.name }))
  const projectNames = projects.map((p) => p.name)

  // STAGE 1 — decompose. From an IMAGE, run the strong vision pass on the actual bytes (mirrors
  // decompose, same shape) instead of the thin routing description; from text, the usual decompose.
  // Everything downstream (routeItems → create*) is identical either way.
  // STEP 1 GROUNDING (images only) — resolve the site from the CAPTION up-front so the vision pass reads
  // the photo against THIS project's OPEN work + pending chases (loadCandidates → prefilter), not blind
  // (spec: the caption is the strongest signal). HONEST LIMIT: an uncaptioned / unknown-site photo can't
  // be grounded — nothing to resolve on — so the pass then runs ungrounded and the post-vision
  // resolveProject below still asks "which site?" exactly as today. Grounding sharpens the read; it is a
  // bonus, never a blocker (any failure here just yields no hints).
  let groundingHints: string[] = []
  if (ctx.image?.base64) {
    try {
      const pre = await resolveProject(ctx.supabase, ctx.orgId, { narration: ctx.image.caption ?? '', nameHint: null })
      if (pre.projectId) {
        const cands = await loadCandidates(ctx.supabase, ctx.orgId, pre.projectId, batch?.items ?? [])
        groundingHints = groundingLabels(prefilterCandidates(cands, ctx.image.caption ?? ''))
        console.log(`[siteops:ground] project=${pre.projectId} candidates=${cands.length} shortlist=${groundingHints.length}`)
      }
    } catch (e) { console.error('[siteops:ground] skipped:', (e as Error).message) }
  }

  let decomposed
  try {
    decomposed = ctx.image?.base64
      ? await decomposeImage(ctx.image.base64, ctx.image.mime, ctx.image.caption, projectNames, groundingHints)
      : await decompose(text, projectNames)
  } catch {
    await say(`Didn't catch a site update in that — try again if you meant to send one.`)
    return
  }

  // B3 — if a chase batch is open, sort this message's pieces into batch answers vs new narration.
  // Consumes the message when something matched; otherwise falls through to fresh routing (the
  // batch stays open in the background — an interruption is never a mode error).
  if (batch && batch.items.length) {
    const consumed = await handleBatchReply(ctx, text, decomposed.items, decomposed.project_hint, batch, projects, narrationId)
    if (consumed) return
  }

  // STAGE 2a — project. Plan each item's site from its per-item hint (mirrors the transaction
  // agent's per-entry project). A narration that names TWO-plus sites takes the multi path so
  // each item files against its OWN project; the single-project norm keeps the proven path below
  // untouched (zero regression).
  const plan = planItemProjects(decomposed.items.map((it) => it.project_hint), projects)
  if (plan.isMulti) {
    await runMulti(ctx, decomposed.items, plan, projects, narrationId)
    return
  }

  // STAGE 2a (single) — Named-match (project_hint) → selected → park. Never auto-assume (6 active).
  const proj = await resolveProject(ctx.supabase, ctx.orgId, { narration: text, nameHint: decomposed.project_hint })
  await ctx.supabase.from('site_narrations').update({
    project_id: proj.projectId, decomposed: decomposed.items, resolved_project_via: proj.via,
  }).eq('id', narrationId)

  if (!proj.projectId) {
    // PROJECT FOLLOW-UP (need-to-ask) — open a pending pick mirroring AWAIT_PROJECT; the reply
    // resumes in answerSiteops, which routes the STORED decomposition against the chosen project.
    // (Previously this only parked + asked, with no pending convo — so the reply was orphaned.)
    //
    // The question tells the sender whether their name was HEARD-but-unmatched vs never given,
    // so a real name isn't met with a blank "which project?". The list we SHOW is the list we
    // STORE (pickList) so the numeric reply maps to the same row in answerSiteops.
    const ambiguous = proj.nameTried && proj.matches.length > 1
    const pickList = ambiguous ? proj.matches : proj.candidates
    const body = ambiguous
      ? `You said "${proj.nameTried}" — a few projects match. Which one?`
      : proj.nameTried
        ? `I couldn't find a project called "${proj.nameTried}". Which one is it?`
        : `Got your site note — which project is it for?`
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: 'which project?',
      slots: { kind: 'siteops_project', items: decomposed.items, candidates: pickList, narration_id: narrationId, image: ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null },
      lastMessageId: ctx.wamid,
    })
    await send(ctx.supabase, ctx.from, {
      kind: 'list',
      body,
      button: 'Pick project',
      rows: pickList.slice(0, 10).map((c, i) => ({ id: `pick:${i + 1}`, title: c.name.slice(0, 24) })),
    }, meta)
    return
  }

  await finishRoute(ctx, proj.projectId, proj.projectName, decomposed.items, narrationId)
}

/**
 * Route a resolved project's items → write + confirm, OR open a task-disambiguation pick if a
 * progress item is ambiguous. Shared by the fresh path and the project-followup resume (so a
 * project pick chains naturally into a floor pick). Returns true if it left a pending pick open.
 */
async function finishRoute(ctx: SiteopsCtx, projectId: string, projectName: string | null, items: SiteItem[], narrationId: string | null): Promise<boolean> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const vmNodeKeys = await materializeProjectTasks(ctx, projectId)
  const { data: taskRows } = await ctx.supabase.from('site_tasks').select(TASK_COLS).eq('project_id', projectId)
  const rawRows = (taskRows ?? []) as SiteTaskRow[]
  const tasks = engineTasks(rawRows)
  console.log(`[siteops:dbg:load] project=${projectId} rawRows=${rawRows.length} engineRows=${rawRows.filter((t) => t.node_key).length} flatRows=${rawRows.filter((t) => !t.node_key).length} usedForMatch=${tasks.length} vmNodeKeys=${vmNodeKeys.size}`)
  const oc = await ownerCtx(ctx.supabase, ctx.orgId, projectId)
  const rc: RouteCtx = { supabase: ctx.supabase, orgId: ctx.orgId, projectId, byLabel: ctx.from, ...oc, narrationId, now: new Date(), vmNodeKeys }

  const out = await routeItems(rc, tasks, items)

  // Image evidence: when this route came from an image, link the ALREADY-stored photo (rough-entry-media,
  // never re-uploaded) to each object the route CREATED — AFTER create so a failed create leaves no orphan
  // attachment (each id/taskId is guarded). role='creation' (Step 3's answer path sets 'answer').
  if (ctx.image?.storagePath) {
    const sp = ctx.image.storagePath, cap = ctx.image.caption ?? null
    for (const p of out.problems) if (p.id) await attachImage(ctx, 'problem', p.id, sp, cap, 'creation')
    for (const t of out.todos) if (t.id) await attachImage(ctx, 'todo', t.id, sp, cap, 'creation')
    for (const pr of out.progress) if (pr.taskId) await attachImage(ctx, 'site_task', pr.taskId, sp, cap, 'creation')
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
    await openConversation(ctx.supabase, {
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
    }, meta)
    return true   // left a task pick open
  }

  // confirm (names the site so the sender can catch a mis-attribution). A single task update gets a
  // tappable "View task" button straight to that task.
  await sendTaskConfirm(ctx, meta, projectName, projectId, {
    progress: out.progress, problems: out.problems, todos: out.todos, parked: out.parked.length,
  })
  return false
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

/** Resume a pending SITEOPS follow-up — a project pick OR a task disambiguation. */
export async function answerSiteops(ctx: SiteopsCtx, text: string, convo: ConvoRow): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const slots = (convo.slots_so_far ?? {}) as any

  // ── B3 same-cause collision → the supervisor named the site for the held item ──
  if (slots.kind === 'siteops_batch_collision') {
    const cands = (slots.candidates ?? []) as { id: string; kind: 'issue' | 'todo'; orgId: string; projectName: string; title: string; cause: string | null }[]
    const t = text.trim().toLowerCase()
    const m = text.match(/(\d+)/)
    const idx = m ? parseInt(m[1], 10) - 1
      : cands.findIndex((c) => { const n = c.projectName.toLowerCase(); return n === t || (n.includes(t) && t.length >= 3) || (t.includes(n.split(/\s+/)[0]) && n.length >= 3) })
    const chosen = idx >= 0 && idx < cands.length ? cands[idx] : null
    if (!chosen) {
      const sites = cands.map((c) => c.projectName).join(' or ')
      if (await judgePending(`which site is "${slots.piece_text ?? 'this'}" — ${sites}?`, text) === 'letgo') {
        // bail — the item stays in the batch and gets re-asked next cycle
        await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
        await send(ctx.supabase, ctx.from, { kind: 'text', body: `No problem — I'll check back on it next time.` }, meta)
        return
      }
      await send(ctx.supabase, ctx.from, { kind: 'text', body: `Which site — reply with the number or the site name, or *skip* to leave it.` }, meta)
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
