// Block A — the real SITEOPS agent. A3 wires the full pipeline onto the A1 capture shell:
//   decompose (Stage 1) → resolveProject + resolveTask (Stage 2) → route to progress/
//   issue/todo + answer QC (Stage 3) → one-line confirm (Stage 4).
// Carry-through: hold inferences LOOSELY, lean on the confirm net. map-or-park (never
// force-map), disambiguate ONLY on genuine progress ambiguity (a need-to-ask), cause as a
// surfaced suggestion. Disambiguation reuses the AWAIT_PROJECT mechanism (openConversation +
// the dispatcher's ANSWERS_PENDING → answer()), not a new interaction.

// ONE ROAD (2026-07-13). `send` — the outbox — is deliberately NOT imported here any more. The outbox is
// drained by a pg_cron on a 10-second tick, and this agent's messages are read by a human IN SEQUENCE: an
// ack before its ask, a failure notice before the next question. Mixing the queue with the direct path meant
// the fast message overtook the slow one and the turn was heard out of order (see one_road.test). Everything
// SiteOps says in a turn now goes by sendNowDurable — which IS the durable path (it falls back to that same
// outbox on any failure, and stamps wa_message_map just the same), minus the queue's latency. The queue still
// carries what nobody is waiting on: the chase cron, the sweeper, the digests.
import { sendNowDurable } from '../_format.ts'
import { resolveProject, type ProjectRef } from '../_resolve.ts'
import { distinctiveTokens } from '../_match.ts'
import { openConversation, closeConversation, type ConvoRow } from '../_conversation.ts'
import { combineReadbacks, composeConfirmation, composePhotoAck, recordLink, type HeldReadback, type ReadbackEntry } from '../_siteops_readback.ts'
import { parkConvoObservation } from '../_siteops_sweep.ts'
import { decompose, callLLM, safeParse, DecomposeUnreadable, VALID_CAUSE_KEYS, structureFromText, type SiteItem } from '../_siteops_extract.ts'
import { decomposeImage, applyMediaStructure, mergeSameScene } from '../_siteops_vision.ts'
import { mediaComposite, humanizeInbound, type MediaParts } from '../_siteops_media.ts'
import { G, bold, italic, lines, blocks, rowTitle, rowDesc } from '../_voice.ts'
import { loadCandidates, prefilterCandidates, groundingLabels } from '../_siteops_candidates.ts'
import { resolveTypedPick, type PickCandidate } from '../_siteops_attach.ts'
import { interpretPickReply } from '../_siteops_pick_llm.ts'
import type { CaptureRef } from '../_wa_message_map.ts'
import { distillSignal } from '../_siteops_reanalyze.ts'
import { planCorrection } from '../_siteops_correct.ts'
import { classifyReaction, isRetraction } from '../_siteops_verbs.ts'
import { reconstructParkedSlots, type ParkedRow } from '../_siteops_lateanswer.ts'
import { decideAssociation, isBareAffirmation, photoRelatedness, type AssocVerdict } from '../_siteops_assoc.ts'
import {
  routeItems, applyProgress, buildConfirm, parseWhen, normTaskName,
  type RouteCtx, type RouteOutcome, type SiteTaskRow, type OrgMember,
  type ProgressResult, type ProblemResult, type TodoResult,
} from '../_siteops_route.ts'
import { loadCadenceMap, type CadenceMap } from '../_siteops_timing.ts'
import {
  getOpenBatch, dropBatchItems,
  type OpenBatch, type BatchItem,
} from '../_siteops_batch.ts'
import {
  composeReadback, homesOf, assertAllApplied, executeResolution, nothingToUpdate, COULDNT_READ_THAT, ALREADY_LOGGED,
  type Terminal, type TerminalOutcome, type AttachUpdate, type StructureSlot,
} from '../_siteops_resolution.ts'
import { resolveInbound, prefetchResolveInputs, type ResolveInboundCtx } from '../_siteops_resolution_llm.ts'
// The engine, bundled for Deno — used to materialise a project's full task set on first WhatsApp touch.
import { buildProjectVM, instantiate, persistGraph, fanOutQc, toPersistRows, geometryOf, geometryOptionsOf, loadProjectRow } from '../../_shared/siteops-engine.js'

export type SiteopsCtx = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any
  from: string
  orgId: string
  wamid: string
  lang: 'en' | 'te' | 'te-en' | 'hi'
  // The id of a tapped LIST row / reply button (the dispatcher's AgentCtx has always carried it; SiteOps only
  // started needing it when the item pick became a list). A pick row's id is its POSITION (`pick:N`), so a tap
  // resolves positionally against the frozen offered list — never by re-parsing the row's human title.
  interactiveId?: string | null
  // Present when the inbound message is an image the router sent to SITEOPS. `storagePath` is the
  // ALREADY-uploaded object (rough-entry-media) from _normalize's storeMedia — we link it, never re-upload.
  // `description` — OUR read of the pixels (the router's describeImage). It is a signal in its own right (a
  // floor chalked on a wall, a board in the frame) and was being dropped whenever a caption existed.
  image?: { base64: string; mime: string; caption: string; description?: string | null; storagePath?: string | null }
  // Present when the inbound was a VOICE note: the ALREADY-stored audio (rough-entry-media). We record it
  // as an attachment on the narration so the source audio stays FINDABLE (clause 1), never re-upload.
  audio?: { storagePath: string; mime: string }
  // THE READ-TIME SELF-HEAL's memo (see ensureProjectFresh). Turn-scoped, and used ONLY to make the
  // reconcile-before-read happen once per project per turn. It is deliberately NOT the memo the write
  // guardrail uses — that one is per-applyTerminals, for the reason spelled out on materializeProjectTasks.
  vmRead?: VmMemo
}

const TASK_COLS = 'task_id, phase, trade_phase, trade, floor_label, unit_label, name, status, node_key, task_type_id, owner_id, owner_source'

/** APPLIABLE task identities: engine rows (node_key, deduped) PLUS flat one-offs with no engine
 *  NAME-TWIN — a flat duplicate of an engine row stays invisible (the columns lesson: its write can't
 *  render in the Sequence overlay), but a manual one-off ("Parking deck & markings") is a real
 *  Task-Manager row with no engine identity at all (the parking lesson). Falls back to all rows for
 *  stack-less projects that have no engine tasks. Twin rule mirrors buildCandidateSet + the guardrail. */
function engineTasks(rows: SiteTaskRow[]): SiteTaskRow[] {
  const engine = [...new Map(rows.filter((t) => t.node_key).map((t) => [t.node_key as string, t])).values()]
  if (!engine.length) return rows
  const engineNames = new Set(engine.map((t) => normTaskName(t.name)))
  return [...engine, ...rows.filter((t) => !t.node_key && !engineNames.has(normTaskName(t.name)))]
}

/**
 * Ensure a project's full engine task set exists as site_tasks rows, so a WhatsApp message can reach
 * a task that was never opened in the UI (rows are otherwise lazily materialised only on drawer-open).
 * Idempotent — inserts ONLY the node_keys that don't exist yet, mirroring the UI's materialise shape.
 * Best-effort: a failure never blocks the message (matching falls back to whatever rows are present).
 */
/** A per-applyTerminals cache of the project VM. See VmMemo. */
export type VmMemo = Map<string, Promise<{ keys: Set<string>; names: Set<string> }>>

/**
 * The project's VM fold-id set. TWO DB reads plus a full buildProjectVM — and it was rebuilt for EVERY task
 * write. A collective sweep ("all 10 fixtures done") rebuilt it ten times, once per sibling.
 *
 * `memo` caches it for the lifetime of ONE applyTerminals call, which is the exact scope where it is provably
 * safe: every target the call writes to ALREADY EXISTS as a site_tasks row, so its node_key is already in the
 * VM before any of our writes land. We deliberately do NOT cache across the turn — the VM is built from task
 * STATUSES, and completing a task can unlock new nodes, so a turn-wide cache could refuse a later legitimate
 * write. Cheap where it is safe; absent where it is not.
 */
async function materializeProjectTasks(ctx: SiteopsCtx, projectId: string, memo?: VmMemo): Promise<{ keys: Set<string>; names: Set<string> }> {
  const hit = memo?.get(projectId)
  if (hit) return hit
  const p = materializeProjectTasksUncached(ctx, projectId)
  memo?.set(projectId, p)
  return p
}

/**
 * RECONCILE BEFORE WE READ THE WORK — not only before we write it (live probe, 2026-07-13, 17:19).
 *
 * materializeProjectTasks is the self-heal: it rebuilds the project's rows from the current library and
 * retires the ones the library no longer generates. It was reachable ONLY from the write paths. So a
 * project whose rows predate a library change stayed stale until somebody happened to write to it — and
 * every message about it in the meantime was matched against rows that no longer existed.
 *
 * The Pride had 87 rows from the OLD, zone-split library; today's engine builds 57. A photo arrived, we
 * read the 87, offered him `ceiling_frame@Ground#Ground-unit-dry`, he picked it — and the ANSWER turn, being
 * the first WRITE, finally ran the reconcile, deleted that very row (retired=61), and then the guardrail
 * correctly refused to write to it. He was offered a row and then told it could not be saved. The self-heal
 * and the bug were the same line of code, in the same turn.
 *
 * So it runs at the READ now: whatever we are about to OFFER him, we have already made true. A library
 * change is absorbed by the FIRST message about the project, not by the unlucky one that happens to write.
 *
 * It is cheap where there is nothing to heal — graphIsMaterialized short-circuits the whole reconcile to a
 * single select on a settled project — and memoised per turn (ctx.vmRead), so a compound multi-project
 * message pays it once per site.
 *
 * It RETURNS the VM it built, because the reader wants it: the candidate set is filtered through these same
 * sets so we can never OFFER a row the guardrail would then refuse (buildCandidateSet's `vm`). This is NOT
 * the memo the WRITE path uses — that one is rebuilt per applyTerminals, deliberately, because a completed
 * task can unlock new nodes mid-turn and a turn-wide cache could refuse a later legitimate write.
 */
async function ensureProjectFresh(ctx: SiteopsCtx, projectId: string): Promise<{ keys: Set<string>; names: Set<string> }> {
  return await materializeProjectTasks(ctx, projectId, (ctx.vmRead ??= new Map()))
}

/** One persisted row, as the materialised-check reads it. */
export interface MaterializedRow {
  node_key?: string | null
  seq_no?: number | null
  source?: string | null
  // …and its PLAN. Without this, a library change that alters a task's dependencies but not its position in
  // the order looks "unchanged" here, the reconcile is skipped, and the row keeps a plan the library no
  // longer holds — forever. (persist.ts: toRefresh. The desk reads `binding` to decide "can this start?".)
  binding?: { node_key?: string; nature?: string; reason?: string }[] | null
}

/** The dependency list as a stable, order-insensitive string — the same comparison persist.reconcile makes. */
const bindingKey = (b: MaterializedRow['binding']): string =>
  JSON.stringify([...(b ?? [])].map((x) => [x.node_key, x.nature, x.reason]).sort())

/**
 * WOULD persistGraph CHANGE ANYTHING? (2026-07-13)
 *
 * persistGraph is a GENERATOR, and it ran on EVERY inbound WhatsApp message: a select, a reconcile, a
 * delete, an insert, then a seq_no update PER ROW. On a settled project every one of those is a no-op —
 * the live logs read `inserted=0 retired=0` turn after turn — and the round trips are pure latency on a
 * turn a human is sitting through.
 *
 * This is EXACT, not a heuristic. persistGraph writes precisely two things about a generated row: that it
 * exists (node_key) and where it sits (seq_no). So compare exactly that — the generated rows'
 * (node_key → seq_no) against the graph's — and skip only when they already agree.
 *
 * Anything that would make persistGraph do work moves one of those and the full reconcile runs: a library
 * change, a new floor, an amenity ticked, a task suppressed, a re-ordered topo, the zone-collapse
 * migration retiring old keys. The project still SELF-HEALS mid-conversation. It just stops paying for
 * the privilege when there is nothing to heal.
 *
 * MANUAL ROWS ARE IGNORED on purpose: reconcile never touches them (it neither deletes nor re-sequences
 * a human's row), so their presence or absence cannot make persistGraph do work, and counting them here
 * would make a hand-added task look like a reason to re-reconcile on every single message, forever.
 */
export function graphIsMaterialized(
  existing: MaterializedRow[],
  // The rows the engine WOULD write (toPersistRows). Not the bare graph: the graph knows a node's id and its
  // place in the order, but a row also carries its PLAN (`binding` — the hard predecessors), and that is the
  // field a library change most often moves. Compared here, a corrected dependency reaches every existing
  // project on its next message; compared only on (key, seq) it would reach none of them.
  fresh: { node_key: string; seq_no: number; binding?: MaterializedRow['binding'] }[],
): boolean {
  const byKey = new Map<string, MaterializedRow>()
  for (const r of existing) {
    if (r.node_key && r.source === 'generated' && typeof r.seq_no === 'number') byKey.set(r.node_key, r)
  }
  if (byKey.size !== fresh.length) return false                   // a row was added, retired, or never made
  for (const n of fresh) {
    const prior = byKey.get(n.node_key)
    if (!prior) return false                                      // a key the library makes and the DB lacks
    if (prior.seq_no !== n.seq_no) return false                   // its place in the order moved
    // `binding` absent from the SELECT → we cannot judge the plan; judge only what we were given.
    if (prior.binding !== undefined && bindingKey(prior.binding) !== bindingKey(n.binding)) return false
  }
  return true
}

async function materializeProjectTasksUncached(ctx: SiteopsCtx, projectId: string): Promise<{ keys: Set<string>; names: Set<string> }> {
  // Returns the project's CURRENT VM fold-id set (every node_key the UI overlay can render) PLUS the
  // normalized VM task labels (the flat-row TWIN check). The write path uses both for the `visibleInVM`
  // check (Step-1 diagnostic / Step-3 guardrail, twin-aware since the parking lesson).
  const vmKeys = new Set<string>()
  const vmNames = new Set<string>()
  try {
    // ONE DOOR — the row, and the geometry it describes, come from the engine (loadProjectRow/geometryOf).
    // This used to hand-assemble the option bag twice inside this one function (once for the VM, once for
    // the persist), which is how a sixth disagreement gets born.
    const project = await loadProjectRow(ctx.supabase, projectId)
    const geometry = geometryOf(project)
    if (!geometry) { console.log(`[siteops:materialize] project=${projectId} HAS NO construction_stack — cannot generate tasks`); return { keys: vmKeys, names: vmNames } }
    // seq_no + source ride along on the SAME query (no extra round trip) — they are what
    // graphIsMaterialized() reads to decide whether the reconcile below has any work to do.
    const { data: existing } = await ctx.supabase.from('site_tasks').select('node_key, status, seq_no, source, binding').eq('project_id', projectId)
    const completion = new Map<string, 'active' | 'done'>()
    const seen = new Set<string>()
    for (const r of (existing ?? [])) {
      if (r.node_key) { seen.add(r.node_key); if (r.status === 'active' || r.status === 'done') completion.set(r.node_key, r.status) }
    }
    // hasExternalWorks is NOT passed: it defaults true. It used to be wired to has_common_areas here and
    // at every other call site, so a project with no amenities silently had no façade and no site works.
    const vm = buildProjectVM(projectId, project!.construction_stack as never, completion, {
      name: project?.name ?? projectId, dryRun: true,
      ...geometryOptionsOf(project),
    })
    for (const f of vm.floors) for (const b of f.blocks) for (const t of b.tasks) {
      vmKeys.add(t.nodeKey)
      vmNames.add(normTaskName(t.label))
    }
    // ── ONE DOOR (2026-07-11) ──────────────────────────────────────────────────────────────────────
    // This used to hand-roll its own INSERT — a second implementation of persist that wrote a SUBSET of
    // the columns (no binding, no zone_id, no order_source, no needs_review). A webhook-born row was
    // therefore not the same row a wizard-born one was, and nothing said so: it surfaced later as a null
    // `binding` when the UI tried to render "why is this blocked". Now every path that creates tasks —
    // the setup wizard, the Sequence view, and this — goes through the engine's own persistGraph, so a
    // row is the same row whoever made it.
    //
    // SAFE TO RECONCILE MID-CONVERSATION: reconcile() never deletes a row without a node_key (the legacy
    // expander rows are `keptManual`), and never deletes a manual or human-reordered row. What it DOES
    // retire is an obsolete AUTHORED row — which is exactly right after a library change: the old
    // `beams@Ground` / `slab@Ground` rows go, the floor-cycle rows arrive, no human action needed.
    const graph = instantiate(geometry)

    // ── IS THERE ANYTHING TO DO? (2026-07-13) ─────────────────────────────────────────────────────
    // persistGraph is a GENERATOR, and it ran on EVERY inbound message: a select, a reconcile, a delete,
    // an insert, then a seq_no update PER ROW, then the QC fan-out. On a settled project every one of
    // those is a no-op — the live logs read `inserted=0 retired=0` turn after turn — and the round trips
    // are pure latency on a turn a human is waiting through.
    //
    // So: skip it when it would change NOTHING. `unchanged` is exact, not a heuristic — it compares the
    // generated rows' (node_key → seq_no) against the graph's, which is precisely the set of facts
    // persistGraph would write. Anything else — a library change, a new floor, an amenity ticked, a
    // suppressed task, a re-ordered topo, the zone-collapse migration — moves a key or a seq, and the
    // full reconcile runs. The project still SELF-HEALS mid-conversation; it just stops paying for the
    // privilege when there is nothing to heal.
    //
    // fanOutQc is NOT skipped with it, deliberately. It is the door that guarantees no task exists
    // without its checks (see persist.ts), and it must not become conditional on a row set changing — a
    // fan-out that failed once would then never retry. One read, unconditionally, forever.
    // The rows the engine would write, RIGHT NOW — the yardstick for "is this project already materialised?"
    // and the source of the plan (`binding`) each row must carry.
    const freshRows = toPersistRows(graph, { project_id: projectId, org_id: project.org_id })
    if (graphIsMaterialized(existing ?? [], freshRows)) {
      const qcInserted = await fanOutQc(ctx.supabase, { project_id: projectId, org_id: project.org_id })
      console.log(`[siteops:materialize] project=${projectId} UNCHANGED (${graph.nodes.size} nodes) — reconcile skipped, qc=${qcInserted}`)
    } else {
      const res = await persistGraph(ctx.supabase, { project_id: projectId, org_id: project.org_id }, graph)
      console.log(`[siteops:materialize] project=${projectId} existingRows=${(existing ?? []).length} vmNodeKeys=${vmKeys.size} inserted=${res.inserted} retired=${res.deleted} refreshed=${res.refreshed} keptManual=${res.keptManual}`)
    }
  } catch (e) {
    console.error('[siteops:materialize] ENGINE/BUILD ERROR:', (e as Error).message, (e as Error).stack)
  }
  return { keys: vmKeys, names: vmNames }
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
    await sendNowDurable(ctx.supabase, ctx.from, { kind: 'cta', body: buildConfirm({ ...base, ctaMode: true }), cta: { text: 'View task', url } }, { ...meta, capture })
    return
  }
  await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: buildConfirm(base) }, { ...meta, capture })
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
  // THIN WRAPPER (T1): the park itself is the shared core in _siteops_sweep.ts — the ONE
  // siteops_unplaced insert site, also driven by the stale-convo sweeper (which ABANDONs; the
  // interrupt closes CLEAN — CLOSED = handled, not the raw ABANDONED that dropped the item before).
  // The kind→reason map, the payload mapping (incl. the collision piece_text and unit-project text
  // fixes), the enrichment-window no-park rule, and the question_wamid stamp all live in the core.
  // STEP C1 — NO SILENT DROP on interruption: if this ask was HOLDING a resolved summary, flush it FIRST
  // (the sure items land), then park the pending item and let the caller run the new intent. The parked item
  // is named by the returned note ("Kept your earlier note…"), so nothing is dropped and the user is told.
  const held = ((convo.slots_so_far ?? {}) as { held_readback?: HeldReadback }).held_readback ?? null
  if (held?.entries?.length) {
    await sendNowDurable(ctx.supabase, ctx.from, composeConfirmation(held.entries, held.resolvedRefs ?? []), { org_id: ctx.orgId, wamid: ctx.wamid })
  }
  const out = await parkConvoObservation(ctx.supabase, convo)
  await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'parked to place' })
  if (!out.parked) return ''
  return out.objectPath ? `Kept that photo to place later.` : `Kept your earlier note to place later.`
}

const fmtDay = (d: Date) => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
/** A2 (clause 2) — does the message REFERENCE a project (even a partial/abbrev we couldn't resolve)? A
 *  distinctive token of any project name appearing in the text = a placeable site message → ASK which site
 *  rather than silently miss it. Genuine junk/greeting (no project token) is an honest didn't-catch. Reuses
 *  the matcher's distinctiveTokens (filler-stripped) so "at asm" hits "ASM Elite" but "site is clean" won't. */
function mentionsProjectToken(text: string, projects: ProjectRef[]): boolean {
  const proj = new Set(projects.flatMap((p) => distinctiveTokens(p.name)).filter((w) => w.length >= 3))
  return proj.size ? distinctiveTokens(text).some((t) => t.length >= 3 && proj.has(t)) : false
}
/** First few words of an item's title — for PICK ROWS and question labels (UI-truncated anyway). */
// NEVER TRUNCATE what we show a human. This was `shortLabel` — a 3-WORD cut that rendered "wiring completed
// for the entire apartment except the fifth floor" as "ASM Elite: fifth", and (probe C2) turned "bathroom
// tiles not fixed correctly" + "resolved" into "✓ bathroom tiles not resolved" — a truth inversion. A
// WhatsApp text message holds 4096 characters: there was nothing to save and a sentence to lose.
const fullText = (title: string) => title.trim()
/** READBACK-facing label: the (near-)full title, capped by LENGTH, never by word count. Probe C2: the
 *  3-word cut turned "bathroom tiles not fixed correctly" + "resolved" into "✓ bathroom tiles not
 *  resolved" — a truth inversion. Truncation may shorten a label; it may never negate the sentence.
 *  composeReadback quotes these, so the reader parses the label as the item's NAME. */
const readbackLabel = (title: string) => {
  const t = title.trim()
  return t.length <= 60 ? t : `${t.slice(0, 59).trimEnd()}…`
}

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

// DELETED (2026-07-09): judgeResolution + JUDGE_SYSTEM — a SECOND LLM opinion on "is this issue resolved?",
// asked after the resolution ladder had already ruled. Its only live caller was the chase-reply engine, and
// the executor had long passed `force` precisely so the judge would NOT re-decide and contradict the
// terminal. With the engine gone, so is the second opinion: executeResolution is the sole authority.

/**
 * Apply a reply to ONE batch item: log the reply, then either RESOLVE it, or keep
 * it open and RE-TIME the next chase (to a stated date, else the cause cadence).
 * For ISSUES the resolve/keep-open call is an LLM judgment whose REASON is recorded
 * (the UI's "why"); to-dos keep the simple keyword strike-off. Always appends to the
 * item's trail (B1). Returns the resolved/open verdict.
 */
// The LADDER is now the SOLE authority: every caller has already decided, so `applied` is REQUIRED and this
// function only executes it. The old signature carried a keyword `status`, a `bareAck` flag, and a re-judging
// `callModel` — all reachable only from the deleted chase-reply engines. Deleting them removes the last place
// a second opinion could contradict the terminal that produced it.
async function applyBatchResolution(
  ctx: SiteopsCtx, item: BatchItem, applied: 'resolve' | 'addressing' | 'blocked',
  replyText: string, cadenceMap: CadenceMap, actorId: string | null, now: Date,
  opts: { reason?: string; out?: { resolveEvent?: string } } = {},
): Promise<'resolved' | 'open' | 'blocked'> {
  // A BLOCKED report trails as `blocker_noted` — the enum's own words: "a reply/comment naming a blocker;
  // item stays open, re-times". The UI already renders it (amber "Blocker") and counts it as the owner
  // having answered; nothing on the WhatsApp path had ever written one.
  await trailEvent(ctx, item, applied === 'blocked' ? 'blocker_noted' : 'reply_received', replyText.slice(0, 180), actorId)

  const resolved = applied === 'resolve'
  const reason = opts.reason ?? ''

  /**
   * ONE ITEM, ONE PATH. This function used to fork on `item.kind`, because a to-do lived in a
   * different table — and the fork was not merely plumbing: a to-do got no ADDRESSING state, no
   * cause cadence, no resolve event to undo, and a "Done" that no portal screen could ever undo or
   * even see. It was a second-class item with a second-class life.
   *
   * A to-do is now a planned snag in `problems` (20260713000001), so there is nothing to fork on.
   * Everything below treats every item the same way, which is the point.
   */
  if (resolved) {
    const note = reason || replyText.trim().slice(0, 140)
    // Trail FIRST so its id exists as the FK target, then stamp it as the ACTIVE resolve — the undo binds
    // to this exact event, so a later re-resolve (new event) makes a stale old undo no-op.
    const eid = await trailEvent(ctx, item, 'status_changed', note ? `Resolved — ${note}` : 'Resolved — confirmed by reply', actorId)
    await ctx.supabase.from('problems').update({ status: 'RESOLVED', next_followup_at: null, active_resolve_event: eid }).eq('id', item.id)
    if (opts.out) opts.out.resolveEvent = eid ?? undefined
    return 'resolved'
  }

  // BLOCKED — the supervisor says it has NOT happened. Status is UNTOUCHED (never advanced to ADDRESSING:
  // a blocker is the opposite of "being handled"), the blocker is already on the trail above, and the next
  // chase is PULLED IN so the item comes back sooner rather than on its lazy cadence. That earlier chase IS
  // the priority raise — we deliberately do NOT write an `escalated` event, which in this schema means "no
  // resolution, pushed UP to the supervisor / principal" and would be a lie about a report the supervisor
  // just made themselves.
  if (applied === 'blocked') {
    const stated = parseWhen(replyText, now)
    // a stated date wins ("tiles by Friday"); else chase on the next tick.
    const next = stated && stated.getTime() > now.getTime() ? stated : now
    const patch: Record<string, string> = { next_followup_at: next.toISOString() }
    // a planned snag's DEADLINE is the promise; a stated date moves it, and the chase follows.
    if (stated) patch.deadline = stated.toISOString().slice(0, 10)
    await ctx.supabase.from('problems').update(patch).eq('id', item.id)
    return 'blocked'
  }

  // kept alive — re-time the next chase (to a stated date, else the cause cadence)
  const when = parseWhen(replyText, now)
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
  const patch: Record<string, string> = { next_followup_at: next.toISOString(), ...(advancing ? { status: 'ADDRESSING' } : {}) }
  if (when) patch.deadline = when.toISOString().slice(0, 10)      // the promise moved with the answer
  await ctx.supabase.from('problems').update(patch).eq('id', item.id)
  const why = reason || (when ? `expected ${fmtDay(next)}` : 'will check back')
  await trailEvent(ctx, item, 'status_changed', advancing ? `Now addressing — ${why}` : `Kept open — ${why}`, actorId)
  return 'open'
}

// ── v2 EXECUTOR (Layer 2a) — apply the AUTHORITATIVE terminals, capture REAL outcomes, one honest reply ──
// executeResolution decided; this applies. Each terminal → its effect via the EXISTING machinery, wrapped
// to capture ok/failed, then ONE combined readback (composeReadback). NO effect is ever dropped: a failed
// object_created (and any not-yet-wired kind) PARKS to siteops_unplaced so "saved for review" in the reply
// is TRUE — honest-reply AND actually-preserved, never the eat wearing an apology. The ladder already
// judged, so object_updated applies with `force` (no re-judge). assertAllApplied backs the no-drop.
// (The undo button on a resolve readback is Layer 2b; here the readback is plain text.)
/** The QC thread: what the sender STATED, and the door the strict matcher grades it through. */
export interface QcThread {
  statements: string[]
  call?: (system: string, user: string) => Promise<string>
}

export interface ExecCtx {
  itemsById: Map<string, BatchItem>       // candidate/batch items by id, to resolve an update's target
  labelById: Map<string, string>          // human title for EVERY offered candidate (not just batch items) —
                                          // a FAILED outcome's readback label resolves here, NEVER from the uuid
  candById?: Map<string, ExecCandidate>   // EVERY offered candidate (all kinds) — resolves TASK which_item
                                          // asks and the place_photo shortlist (ids → pick rows)
  cadenceMap: CadenceMap
  actorId: string | null
  now: Date
  narrationId: string | null
  projectId?: string | null               // THE project (singular unit) — object_created defaults here when
                                          // the item carries no resolvable project_hint (spec: no match → CREATE)
  readbackSuffix?: string                 // appended to the combined readback (e.g. the interim
                                          // pending_stage2 truth: "· 1 more saved for review")
  assumedSite?: string                    // T8b — the ASSUMED project name (batch prior, via='auto'); disclosed so a
                                          // silent wrong adoption becomes visible/correctable (clause 4).
  message?: string                        // B floor — the raw inbound message, so a near-candidate which_item ask
                                          // carries it as the collision piece_text (trail/apply on confirm).
  // WHERE the item is (floor/unit), as decompose or the vision pass read it. object_created writes it
  // onto the row: a snag that knew it was on the fourth floor while it was being created must not
  // forget by the time it is stored — and a unit chip has nothing to count problems BY without it.
  structure?: StructureSlot | null
  // BATCHED READBACK (opt-in) — when a sink is present, applyTerminals COLLECTS its readback body + resolved
  // refs into it instead of sending, so runSiteops emits ONE combined reply for a whole compound/multi-project
  // message (asks still fire inline). Absent (every direct caller / the resume path) → send immediately, as before.
  readbackSink?: ReadbackSink
  projectName?: string | null             // the project a collected body belongs to — labels the combined reply
  // SERIALIZED ASKS (opt-in) — when a queue is present, applyTerminals ENQUEUES its which_item ask instead of
  // sending it. applyTerminals already aggregates the asks WITHIN one call; the fan-out was ACROSS calls — the
  // Stage-2 loop runs one applyTerminals per decomposed item, and each ask called openConversation, which
  // upserts the ONE open conversation per (org, sender). LIVE FAILURE (2026-07-09): a 5-item voice note asked
  // three which_item questions; the sender saw all three, but only the last was answerable — the first two were
  // silently overwritten. runSiteops owns the queue and drains it one ask at a time (the which_project cursor).
  askQueue?: PendingItemAsk[]
  // ONE ASK CURSOR (2026-07-11). A which_project terminal used to open its pick INLINE from inside
  // applyTerminals while the which_item asks waited in askQueue — and the drain's openConversation then
  // upserted over it. LIVE FAILURE: a 9-item note asked "which project is *tie gunny bags* for?" and then a
  // "tiles being laid — which one?" pick; the sender answered the PROJECT question, the answer landed on the
  // TILES pick, and it was meaning-matched into a wrong "Floor tiling (First) updated". With this queue the
  // project ask is DEFERRED too; runSiteops asks exactly one thing (the project first — a site is a
  // prerequisite for everything else — carrying the item asks in its slots). Absent → inline, as before.
  projectAskQueue?: PendingProjectAsk[]
  /** Per-call project-VM cache — a collective sweep must not rebuild the VM once per swept task. */
  vmMemo?: VmMemo
  /** STEP A — the checkable FACTS this item stated ("poured continuous, no cold joint"), positionally the
   *  ones decompose/vision found for the message being applied, plus the QC matcher's model door. Without
   *  them the strict matcher has nothing to match and every task's checks stay pending forever. */
  qc?: QcThread
  /** THE IDEMPOTENCY FLOOR — `<target>:<action>` keys already applied THIS TURN. Owned by the unit loop so it
   *  spans every decomposed item's applyTerminals call: the same row + the same action is written once and
   *  read back once, however many items named it. Absent → applyTerminals scopes it to its own call. */
  appliedTargets?: Set<string>
}

/** One deferred which_item ask, JSON-serializable so the REMAINDER can ride the open pick's slots
 *  (`pending_item_asks`) and be drained by its answer — the same cursor `pending_groups` uses. */
/** One deferred which_project ask — a new item the resolver could not site. runSiteops turns it into an
 *  AskGroup (the proven `siteops_project` pick), so it drains through the SAME cursor as an unresolved
 *  decompose group and cannot open a second conversation. */
export interface PendingProjectAsk {
  item: SiteItem
  narrationId: string | null
}

export interface PendingItemAsk {
  candidates: CollisionCand[]
  pieceText: string
  /** GAP 1 — the checkable FACTS the message/photo stated. They ride the ask so the ANSWER can apply them:
   *  the moment we learn which task it was is exactly the moment the evidence becomes usable, and it was
   *  being thrown away there. */
  qcStatements?: string[]
  projectId: string | null
  narrationId: string | null
  image: { storagePath: string; caption: string | null } | null
  update: AttachUpdate | null
  fork: boolean
  /** A fact the supervisor needs BEFORE he can answer, printed above the choices — today, "this site has no
   *  floor cellar; the floors it has are …". Rides the drain cursor like everything else the ask needs. */
  preamble?: string | null
}

// A per-turn pool of readback bodies (one per applyTerminals call that produced one) + the resolved refs for
// the optional undo. runSiteops owns it and flushes ONE message at the end.
export interface ReadbackSink {
  entries: ReadbackEntry[]
  resolvedRefs: { kind: string; id: string; event: string }[]
  // STEP C1 — set by askItemPick when a which_item ask is opened this turn: the ask's slots + question, so
  // flushOrHoldReadback can STASH the held summary onto that same conversation (the resume folds it) without
  // re-reading the row. Captured at finally, so it holds whatever resolved BEFORE or AFTER the ask.
  askSlots?: Record<string, unknown>
  askQuestion?: { pendingQuestion: string; lastMessageId: string | null }
}

// the executor's slim view of an offered candidate (built from res.candidates in the caller).
export interface ExecCandidate {
  kind: 'task' | 'issue' | 'todo'; title: string; projectId: string | null; projectName: string | null
  // THE FACTS BEHIND THE LABEL (task ROWS only — `site_tasks.name` / `floor_label` / `unit_label`).
  // `title` is those three COMPOSED for a human to read; it is not a data structure, and it must never be
  // parsed back apart. It cannot be: the engine's naming contract is `Category — Work` ("Ceiling — POP
  // finish"), and the row composer joins the floor on with the SAME ' — ', so the label's separators are
  // ambiguous by construction. Absent (issues/todos, whose title is free text) → the renderer falls back to
  // its heuristic. See splitLabel.
  name?: string; floor?: string | null; unit?: string | null
}

function toSiteItem(it: { kind: 'issue' | 'snag'; detail: string; location: string | null; project_hint: string | null; confidence?: 'high' | 'med' | 'low'; planned?: boolean; due_date?: string | null; cause?: string | null; owner?: string | null }, structure?: StructureSlot | null): SiteItem {
  // T6 — the planner's KIND + CONFIDENCE ride through to the row (clauses 3 + 4). `type` stays 'issue' so
  // routeItems routes it to createProblem (issue AND snag are the SAME `problems` table); `kind` records
  // which it actually is; `confidence` gates the chase (createProblem holds a low/med note un-scheduled).
  // #1 — PLANNED work rides `planned`, and its DEADLINE rides date_hint (createProblem parses it → the L1
  // user date → problems.deadline + the chase clock). The old hard-coded date_hint:null dropped deadlines.
  // NO-INFO-LOSS — CAUSE (clamped to the taxonomy → drives cadence/impact) and OWNER ("tell Ramesh") now
  // ride through instead of the old hard-coded 'other'/null that silently dropped them.
  const cause = it.cause && (VALID_CAUSE_KEYS as readonly string[]).includes(it.cause) ? it.cause : 'other'
  return { type: 'issue', kind: it.kind, confidence: it.confidence, planned: it.planned, text: it.detail, task_hint: it.location, qc_statements: [], cause, cause_reason: null, owner_hint: it.owner ?? null, date_hint: it.due_date ?? null, project_hint: it.project_hint, structure: structure ?? null }
}

/** STAGE 2 (1/N) — apply a HIGH-confidence update onto an offered OPEN TASK via the PROVEN applyProgress
 *  (VM-guardrail intact; a photo rides as creation evidence). Returns the readback label on success;
 *  null → the caller's understood-but-held park stands (row gone / VM-refused / no project) — honest,
 *  replayable, visible in the queue. MED/LOW task targets never reach here: no soft rung exists for a
 *  task (applying IS the state change), so uncertainty keeps holding. */
async function applyTaskUpdate(ctx: SiteopsCtx, t: Extract<Terminal, { kind: 'object_updated' }>, ex: ExecCtx): Promise<string | null> {
  // T2 — terminal task closure is the LADDER's alone (Hazard 3 / clause-4). Authorize applyProgress to
  // write 'done' ONLY when the ladder ruled a resolve; an ADDRESSING verdict advances the task, never
  // closes it — even if the reason text happens to carry a "done"/"completed" word (the regex no longer
  // overrides the ladder).
  const label = await applyTaskProgressById(ctx, t.update.target_id, t.update.reason, ex.narrationId, ex.now, ex.projectId ?? null, t.applied === 'resolve', ex.vmMemo, ex.qc)
  if (label && ctx.image?.storagePath) await attachImage(ctx, 'site_task', t.update.target_id, ctx.image.storagePath, ctx.image.caption ?? null, 'creation')
  return label
}

/**
 * A BLOCKED report against a TASK. `followup_events` has a one-parent CHECK (problem_id XOR todo_id), so a
 * task's blocker cannot live there — it lands as a system comment on the task, which is where a task's
 * human notes already live. The task's STATUS is untouched: "tiles not yet laid" must never advance the
 * tiling task. Returns the readback label, or null when the row is gone (the caller parks honestly).
 */
async function applyTaskBlockedById(ctx: SiteopsCtx, taskId: string, text: string): Promise<string | null> {
  const { data: rows } = await ctx.supabase.from('site_tasks').select('task_id, name, floor_label, unit_label').eq('task_id', taskId)
  const task = (rows ?? [])[0] as { task_id: string; name: string; floor_label?: string | null; unit_label?: string | null } | undefined
  if (!task) return null
  const { error } = await ctx.supabase.from('site_task_comments').insert({
    task_id: taskId, org_id: ctx.orgId, author_id: null, author_name: null,
    body: `Blocked — ${text.slice(0, 180)}`,
  })
  if (error) { console.error('[siteops:task-blocked] comment insert failed:', error.message); return null }
  return readbackLabel([task.name, task.floor_label].filter(Boolean).join(' — '))
}

// ── STEP B/C — THE QUALITY AXIS ──────────────────────────────────────────────────────────────────────
// Every task carries the authored QC checks of its TYPE (engine library → persistGraph fan-out). These two
// functions are the whole quality axis for a photo:
//
//   loadQcChecks    — show the vision pass the checks for the work it is looking at. This is what turns
//                     "find problems in this photo" (which yields nitpicks — unpainted walls, debris, work
//                     that is simply not finished yet) into "does this photo settle a check the org already
//                     decided matters". Relevance is INHERITED from the checklist, never invented.
//   applyQcFailures — a contradicted check IS the issue. Code disposes: we already know the check, its task
//                     and whether it is critical, so nothing is left for a model to infer.
export interface QcCheckRef { id: string; taskId: string; question: string; critical: boolean; taskLabel: string }

/** The open checks for the shortlisted work, as prompt lines + the map a failure is disposed through.
 *  Best-effort: on any error the photo is still read, just without the quality axis. */
async function loadQcChecks(ctx: SiteopsCtx, shortlist: { kind: string; id: string; label: string }[]): Promise<{ lines: string[]; byId: Map<string, QcCheckRef> }> {
  const byId = new Map<string, QcCheckRef>()
  const lines: string[] = []
  const taskIds = shortlist.filter((c) => c.kind === 'task').map((c) => c.id)
  if (!taskIds.length) return { lines, byId }
  const labelOf = new Map(shortlist.map((c) => [c.id, c.label]))
  const { data, error } = await ctx.supabase.from('site_task_qc')
    .select('id, task_id, question, is_critical, qc_status').in('task_id', taskIds)
  if (error) { console.error('[siteops:qc] load failed:', error.message); return { lines, byId } }
  for (const r of ((data ?? []) as { id: string; task_id: string; question: string; is_critical: boolean; qc_status: string | null }[])) {
    if (r.qc_status === 'confirmed') continue   // already answered — never ask the photo to re-prove it
    const taskLabel = labelOf.get(r.task_id) ?? ''
    byId.set(r.id, { id: r.id, taskId: r.task_id, question: r.question, critical: !!r.is_critical, taskLabel })
    lines.push(`[qc:${r.id}]${r.is_critical ? '[C]' : ''} ${r.question}${taskLabel ? ` — ${taskLabel}` : ''}`)
  }
  return { lines, byId }
}

/** A check the photo CONTRADICTS. Mark it failed (the photo's own words as the evidence, and the narration
 *  that saw it as the provenance), and raise the finding — CHASED when the failed check is critical, a
 *  visible NOTE when it is not. The photo rides the created row as evidence. */
async function applyQcFailures(
  ctx: SiteopsCtx, failures: SiteItem[], qcById: Map<string, QcCheckRef>,
  projectId: string | null, narrationId: string | null, sink?: ReadbackSink,
): Promise<void> {
  if (!projectId) return
  for (const f of failures) {
    const check = qcById.get(f.qc_failed as string)
    if (!check) continue
    // The check now says what the photo showed. The answer text is OUR observation and the narration id is
    // the provenance — exactly the shape a confirmation records, so the trail reads the same either way.
    const { error } = await ctx.supabase.from('site_task_qc').update({
      qc_status: 'failed', answer: f.text, source_narration_id: narrationId, answered_at: new Date().toISOString(),
    }).eq('id', check.id)
    if (error) console.error('[siteops:qc:fail] check update failed:', error.message)

    // CRITICAL → a tracked, chased issue. Otherwise a NOTE: recorded and visible, never chased at anyone.
    // (createProblem gates the chase clock on exactly this `confidence` — high schedules, med/low does not.)
    const item: SiteItem = {
      type: 'issue', kind: 'issue', confidence: check.critical ? 'high' : 'med',
      text: f.text, task_hint: f.task_hint, structure: f.structure ?? null, qc_statements: [],
      cause: 'rework', cause_reason: `fails a quality check on ${check.taskLabel || 'this work'}: ${check.question}`,
      owner_hint: f.owner_hint ?? null, date_hint: null, project_hint: null,
    }
    const out = await routeGroup(ctx, projectId, [item], narrationId)
    if (ctx.image?.storagePath) {
      for (const pr of out.problems) if (pr.id) await attachImage(ctx, 'problem', pr.id, ctx.image.storagePath, ctx.image.caption ?? null, 'creation')
    }
    console.log(`[siteops:qc:fail] check=${check.id} critical=${check.critical} task=${JSON.stringify(check.taskLabel)} -> ${check.critical ? 'chased issue' : 'note'}`)
    const body = check.critical
      ? `⚠️ *A quality check failed* — ${check.question}\n_${f.text}_\nLogged as an issue and being chased.`
      : `A quality check didn't pass — ${check.question}\n_${f.text}_\nLogged for review (not chased).`
    if (sink) sink.entries.push({ project: null, body })
    else await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body }, { org_id: ctx.orgId, wamid: ctx.wamid })
  }
}

/** The by-id core of a task progress write — shared by the executor (HIGH updates) and the collision
 *  resume (a confirmed med/low task pick). Loads the row, builds the twin-aware guardrail context, and
 *  applies via the proven applyProgress. Returns the readback label, or null when the row is gone / the
 *  guardrail refused / no project — the caller parks honestly. Photo attachment is the CALLER's step
 *  (executor: ctx.image; resume: slots.image). */
async function applyTaskProgressById(ctx: SiteopsCtx, taskId: string, text: string, narrationId: string | null, now: Date, fallbackProjectId: string | null, closureAuthorized = false, memo?: VmMemo, qc?: QcThread): Promise<string | null> {
  const { data: rows } = await ctx.supabase.from('site_tasks').select(`${TASK_COLS}, project_id`).eq('task_id', taskId)
  const task = (rows ?? [])[0] as (SiteTaskRow & { project_id?: string | null }) | undefined
  if (!task) return null
  const projectId = task.project_id ?? fallbackProjectId
  if (!projectId) return null
  const [vm, oc] = await Promise.all([materializeProjectTasks(ctx, projectId, memo), ownerCtx(ctx.supabase, ctx.orgId, projectId)])
  // vmNodeKeys: an EMPTY fold-set means the VM couldn't be built (stack-less project) — the guardrail's
  // own "absent → can't judge → proceed" case, so pass undefined rather than refuse every write.
  const rc: RouteCtx = {
    supabase: ctx.supabase, orgId: ctx.orgId, projectId, byLabel: ctx.from, ...oc,
    narrationId, now, vmNodeKeys: vm.keys.size ? vm.keys : undefined, vmTaskNames: vm.keys.size ? vm.names : undefined,
    callQc: qc?.call,
  }
  // STEP A (2026-07-11) — THE STATEMENTS REACH THE APPLY. This built its SiteItem with a hard-coded
  // `qc_statements: []`, and matchQc opens with `if (!statements.length) return []` — so the strict QC
  // matcher returned empty on every message ever sent, for text and image alike. The extractor pulled
  // "poured continuous, no cold joint" out of the message and the executor dropped it on the floor. The
  // whole QC-answering feature was inert. The statements the item carried now travel with it.
  const item: SiteItem = { type: 'progress', text, task_hint: null, qc_statements: qc?.statements ?? [], cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null }
  const res = await applyProgress(rc, task, item, { closureAuthorized })
  if (!res.visibleInVM) return null   // GUARDRAIL: never a false "✓ updated" onto a row the UI can't render
  return readbackLabel(`${task.name}${task.floor_label ? ` (${task.floor_label})` : ''}`)
}
// The human label for a terminal's readback line. RULE: a terminal outcome may NEVER surface a raw id to a
// human — for an update we look the target up in the candidate-title map (all offered candidates, not just the
// open batch) and fall back to a generic phrase, but NEVER to `target_id`. terminalObservation (the durable
// park record, machine-facing) keeps the id; this (human-facing) one must not.
function terminalLabel(t: Terminal, labelById?: Map<string, string>): string {
  if (t.kind === 'object_created') return readbackLabel(t.item.detail)
  if (t.kind === 'object_updated') {
    const l = labelById?.get(t.update.target_id)
    return l && l.trim() ? l : 'that item'
  }
  if (t.kind === 'queued_as_evidence') return 'photo'
  if (t.kind === 'question_asked') {
    if (t.about === 'place_photo') return 'photo'
    if (t.update) { const l = labelById?.get(t.update.target_id); return l && l.trim() ? l : 'that item' }
    if (t.item) return readbackLabel(t.item.detail)
    return 'question'
  }
  return ''
}
function terminalObservation(t: Terminal): string {
  if (t.kind === 'object_created') return t.item.detail
  if (t.kind === 'object_updated') return `update ${t.update.target_id}: ${t.update.reason}`
  if (t.kind === 'question_asked') return t.update ? `update ${t.update.target_id}: ${t.update.reason}` : (t.item?.detail ?? t.kind)
  return t.kind
}
// `replay` (→ the jsonb `candidates` column) carries the structured payload a distinguished park needs so a
// later phase can act on the row mechanically — e.g. a non_batch_target park stores the update + its label so
// Phase 3's fresh path can re-apply it. Null for the plain "couldn't place" parks.
// AUDIT #4/#7 — a park must carry every piece of context the flow already holds: THE resolved project
// (else the replay re-asks what we knew) and the inbound photo's bucket/object_path (else "photo saved"
// names an unfindable photo — the eat wearing a receipt).
async function parkObservation(ctx: SiteopsCtx, observation: string, reason: string, narrationId: string | null, replay: unknown = null, opts: { projectId?: string | null; image?: { storagePath?: string | null; caption?: string | null } | null } = {}): Promise<void> {
  // opts.image overrides ctx.image for RESUME-side parks: the answer message carries no image — the
  // photo lives in the conversation slots, and the park must still carry it (findable, audit #7).
  const img = opts.image ?? ctx.image ?? null
  await ctx.supabase.from('siteops_unplaced').insert({
    org_id: ctx.orgId, project_id: opts.projectId ?? null, reason, observation,
    candidates: replay,
    bucket: img?.storagePath ? 'rough-entry-media' : null,
    object_path: img?.storagePath ?? null,
    caption: img?.caption?.trim() || null,
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
  if (reopened) await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: 'Reopened — back on the chase.' }, { org_id: ctx.orgId, wamid: ctx.wamid })
  return true   // we handled the undo tap (a stale/idempotent no-op is still "handled")
}

// ── the ONE which_item composer (clause 2 + clause 5 — de-dup) ───────────────────────────────────────────
// EVERY candidate-pick question routes through here: the near-floor both-false ask, the ladder's LOW-
// confidence / MED-task ask, and the legacy collision copy. Canonicalizes the near-floor's correct impl:
//  • clause 5 — ONE composed, NUMBERED text message (never one interactive list per candidate: that was the
//    fan-out — "Wiring done at asm" → five number-less messages).
//  • clause 2 — the offered list is FROZEN into the siteops_batch_collision slots at ask-time, in the SAME
//    order the message NUMBERS it, so display index == stored index == what resolveTypedPick resolves against
//    (never re-derived from the reply). The proven collision resume is the SOLE resolve path.
// `update` threads the ladder's held verdict (T3 sole-authority) for a SINGLE-target ask; a multi-candidate
// ask has no single verdict → verdict-less slot → the resume forces ADDRESSING on confirm (the safe floor).
// `name`/`loc` are the row's OWN facts (task rows only — see ExecCandidate), carried here so the renderer
// never has to guess them back out of `title`. OPTIONAL, and that is deliberate two ways: an issue/todo has
// no such decomposition to carry, and an ask SERIALIZED by an older deploy (they ride `slots.candidates`
// across a restart) will not have them. Both land on the splitLabel fallback — which is exactly the old
// behaviour, so no in-flight pick changes under a deploy.
type CollisionCand = { id: string; kind: 'issue' | 'todo' | 'task'; orgId: string; projectId: string | null; projectName: string; title: string; cause: string | null; name?: string; loc?: string }

// ── THE PICK'S LIST ROWS (2026-07-11) ─────────────────────────────────────────────────────────────────────
// Meta's HARD caps: 10 rows per list, 24 chars per row title, 72 per row description. The pick was TEXT-only
// because of the 24 — a cut label lies ("bathroom tiles not" + "resolved" read as its own negation). The way
// through is not to truncate less; it is to stop making the row the place where meaning lives:
//   • the BODY still prints every candidate in full (unchanged) — that is the truth the supervisor reads;
//   • the row TITLE carries only the DIFFERENTIATOR — the one thing that tells these rows apart;
//   • the DESCRIPTION carries the full label, so the task name AND its floor · unit are on every row.
// Two rows are always spoken for ("something else" / "none of these"), so a pick of more than 8 candidates
// cannot fit: it falls back to the TEXT list rather than drop a row inside the cap (→ null).
const LIST_MAX_CANDS = 8
const cut = (s: string, n: number) => (s.length <= n ? s : `${s.slice(0, n - 1).trimEnd()}…`)
/**
 * THE LAST RESORT — guess a name/location boundary out of a display label. Only for a title with no facts
 * behind it: a free-text issue/todo ("Slab — Ground floor"), or an ask serialized by an older deploy.
 *
 * IT MUST NEVER BE ASKED ABOUT A TASK. A task label is `Category — Work — Floor · Unit`, and both of the
 * first two ' — 's look identical to this function, so it reads the engine's own naming contract backwards:
 * "Ceiling — POP finish — First" → name "Ceiling", loc "POP finish — First". Live, that turned a which-WORK
 * tie between "Ceiling — boarding" and "Ceiling — POP finish" into "Where should this go?" — asking a man for
 * the floor he had just given us, over two rows already pinned to it. Tasks carry their facts now (partsOf).
 *
 * The heuristic survives only because an issue's title genuinely is prose — there are no columns under it to
 * read instead, so a first-' — ' guess is the best available, and it is what shipped.
 */
const splitLabel = (title: string): { name: string; loc: string } => {
  const i = title.indexOf(' — ')
  return i > 0 ? { name: title.slice(0, i), loc: title.slice(i + 3) } : { name: title, loc: '' }
}

/** The location, composed the way the label composes it (`_siteops_resolution_llm.ts` rowTitle). */
const locLabel = (floor?: string | null, unit?: string | null): string => [floor, unit].filter(Boolean).join(' · ')

/** What tells these rows apart, and where: the candidate's FACTS when it carries them, else the guess. */
const partsOf = (c: CollisionCand): { name: string; loc: string } =>
  c.name === undefined ? splitLabel(c.title) : { name: c.name, loc: c.loc ?? '' }

type PickRow = { id: string; title: string; description?: string }

/**
 * WHICH AXIS IS THIS PICK ABOUT? It decides the row titles AND the question, and those two must agree —
 * a message whose rows say "First · Unit A / Second · Unit A" while the question asks "which work is this?"
 * is asking about a thing its own options do not vary.
 *
 *   'work'      same place, different work — three kinds of tiling on First · Unit A
 *   'location'  same work, different places — wiring on five floors
 *   'mixed'     neither — a genuine grab-bag
 */
type PickAxis = 'work' | 'location' | 'mixed'
function pickAxis(cands: CollisionCand[]): PickAxis {
  const parts = cands.map(partsOf)
  if (parts.every((p) => p.loc && p.loc === parts[0].loc)) return 'work'
  if (parts.every((p) => p.name === parts[0].name) && parts.every((p) => p.loc)) return 'location'
  return 'mixed'
}

function pickRows(cands: CollisionCand[], multiKind: boolean): PickRow[] | null {
  if (!cands.length || cands.length > LIST_MAX_CANDS) return null
  const parts = cands.map(partsOf)
  const axis = pickAxis(cands)
  /**
   * THE ROW IS NOW THE ONLY PLACE THE CANDIDATES APPEAR, so it has to carry the fact whole.
   *
   * It could not, before: a 24-char title truncated "Ceiling — false-ceiling frame" to a stump, so the
   * body printed the full list as well — and that duplicate print was a P1. The fix is in the row, not
   * the body: rowTitle() drops the category prefix, because the DESCRIPTION already carries it. The
   * title says WHAT the work is; the description says which kind and where. Between them nothing is
   * lost, and nothing is said twice.
   *
   * MARKUP DOES NOT RENDER IN A ROW. Bold in a row title shows literal asterisks, and visible stars read
   * as a broken app — so rowTitle/rowDesc strip every mark. Hierarchy comes from title vs description,
   * which is precisely what those two fields are for.
   */
  const rows: PickRow[] = cands.map((c, i) => {
    const p = parts[i]
    const differentiator = axis === 'location' ? p.loc : p.name
    return {
      id: `pick:${i + 1}`,                                   // POSITIONAL — display order IS stored order
      title: rowTitle(differentiator),
      description: rowDesc([c.title, multiKind ? c.kind : null].filter(Boolean).join(' · ')),
    }
  })

  /**
   * THE ESCAPE HATCHES — always last, always in this order, and each says what it DOES.
   *
   * 🆕 logs a new item; ⏸ changes nothing and holds it in Review. They keep their numbers (resolveTypedPick
   * reads length+1 / length+2), so a tap and a typed number mean exactly the same thing.
   *
   * ── WHAT IS MISSING HERE, AND SHOULD NOT BE ────────────────────────────────────────────────────────
   *
   * The spec's third escape is `➕ Add 1st floor & file there` — and it is the best row in the message,
   * because it BELIEVES HIM. He said 1st floor; he is standing on it. Creating the floor from a tap is
   * the difference between a question and a dead end.
   *
   * It is not here because it is a WRITE — it would add a level to the construction stack and re-run the
   * engine — and this pass is the message system, not the machinery behind it. A row that does nothing is
   * worse than no row, so it stays out until the action exists. This is the one part of Type 4 still owed.
   */
  rows.push({ id: `pick:${cands.length + 1}`, title: '🆕 Log as new item', description: 'It is not on the list yet' })
  rows.push({ id: `pick:${cands.length + 2}`, title: '⏸ Hold for review', description: 'Change nothing — I will keep it in Review' })
  return rows
}
/**
 * THE which_item QUESTION, IN WORDS. Extracted so the message we SEND and the body we STORE (slots.ask_body,
 * replayed verbatim by a re-surface) are the same string by construction — a re-render can drift, and did:
 * the live re-surface dropped the piece, both escape options and the drain counter.
 *
 * NOTHING IS TRUNCATED. The supervisor cannot pick what they cannot read, and a cut label lies: the 3-word
 * `shortLabel` once rendered "wiring completed for the entire apartment except the fifth floor" as
 * "ASM Elite: fifth", and a 3-word cut of "bathroom tiles not fixed correctly" + "resolved" read as
 * "✓ bathroom tiles not resolved" — a truth inversion (probe C2). The candidate titles carry their
 * "— Floor · Unit" tail because that is the only thing that tells same-name rows apart. This is a plain TEXT
 * message, so WhatsApp imposes no per-row cap (interactive LIST rows are capped at 24 chars by Meta — which
 * is exactly why picks are not sent as lists).
 */
function composeItemPickBody(
  a: { pieceText: string; pending?: PendingItemAsk[]; preamble?: string | null },
  cands: CollisionCand[], multiKind: boolean, tappable: boolean,
): string {
  /**
   * ══ TYPE 4 · THE QUESTION — ONE JOB, AND IT IS ASKING ════════════════════════════════════════════
   *
   * This message was the worst in the system, and it was worst because it was doing FOUR jobs at once:
   * it quoted him, it re-printed the vision essay, it denied his building, it enumerated the candidates
   * as a numbered list — AND THEN sent the same candidates again as tappable rows. He was shown the same
   * five things twice in one bubble.
   *
   *   THE DUPLICATE PRINT IS A P1. Not a cosmetic one: a wrong extraction looks like a mistake, and a
   *   duplicate looks like a MALFUNCTION. It costs more trust than being wrong does.
   *
   * The reason it existed was honest — a 24-character row title truncates ("Ceiling — false-ceiling
   * frame" → "Ceiling — false-ceilin…"), so the body carried the full names as the place a fact could
   * always be read. But that is a truncation problem, and it has a truncation fix (rowTitle() drops the
   * category prefix — which the row DESCRIPTION already carries — so "False-ceiling frame" fits whole).
   * Fix the row, and the body's copy of it is pure noise.
   *
   * So the body now does exactly one job:
   *
   *     ❓ You said _"1st floor false ceilings"_
   *     I don't have a *1st floor* for this site — only Ground.
   *     Where should this go?
   *
   *   · THE GAP FIRST, OWNED BY US (§1.3). One line.
   *   · ONE QUESTION. Five words. No compound clauses.
   *   · THE VISION ESSAY DOES NOT RIDE ALONG. The readback already happened (Type 3) and he read it.
   *     Repeating it here is the system talking to itself.
   *   · NO "or just name the work, for example …". That is training-wheels copy. The line goes; the
   *     input is still accepted, exactly as before.
   *   · NO REPAIR HANDLE. A question is not done yet, and begging to be corrected mid-flow reads anxious.
   */
  const { said } = humanizeInbound(a.pieceText)

  // HIS words, in his voice. On a photo the piece is a composite (his caption + OUR read of the pixels);
  // quoting the whole thing put our sentence in his mouth. Only the caption is ever "what you said".
  const heard = said ? `${G.ask} You said: ${italic('"' + said + '"')}` : G.ask

  const why = a.preamble?.trim() ?? ''

  /**
   * THE QUESTION ASKS ABOUT THE AXIS THE OPTIONS VARY ON — and nothing else.
   *
   * "Where should this go?" over three kinds of tiling that are all on First · Unit A is not a question,
   * it is a non-sequitur: the answer he would give ("first floor") is already true of every option. So
   * the pick's axis (the same one that chose the row titles) chooses the sentence, and the two can never
   * disagree, because they are computed from the same call.
   */
  const question = { work: 'Which work is this?', location: 'Where should this go?', mixed: 'Which one is it?' }[pickAxis(cands)]

  // The drain is serialized, so say so — without it a 3-ask turn reads as one question and two lost
  // updates. It is meta, so it sits alone at the bottom.
  const more = a.pending?.length
    ? `${a.pending.length} more to sort out after this.`
    : ''

  // NOT TAPPABLE (too many rows for Meta's cap) → the candidates must appear SOMEWHERE, so the body
  // carries them, numbered, and the typed number still resolves. This is the ONLY case in which the
  // body ever lists them, and it is the case where the rows do not exist to list them instead.
  const listed = tappable
    ? ''
    : cands.map((c, i) => `${i + 1}. ${c.title}${multiKind ? ` [${c.kind}]` : ''}`).join('\n')

  return blocks(
    lines(heard, why),
    tappable ? question : lines(question, listed),
    more,
  )
}

async function askItemPick(ctx: SiteopsCtx, meta: { org_id: string; wamid: string }, a: {
  candidates: CollisionCand[]; pieceText: string; projectId: string | null; narrationId: string | null
  image: { storagePath: string; caption: string | null } | null
  qcStatements?: string[]
  update?: AttachUpdate | null; prefix?: string; fork?: boolean; sink?: ReadbackSink; preamble?: string | null
  /** id → where this row came from ('model_nearest' | 'lexical_belt' | 'structural_sibling'), for the log. */
  provenance?: Record<string, string>
  // THE DRAIN CURSOR — the which_item asks still owed after this one. They ride THIS pick's slots and are
  // asked, one at a time, by its answer (finishItemAsk). `heldEntries`/`heldRefs` thread the readback summary
  // accumulated so far across the drain, so the fold lands on the LAST answer — the which_project twin.
  pending?: PendingItemAsk[]
  heldEntries?: { project: string | null; body: string }[]
  heldRefs?: { kind: string; id: string; event: string }[]
}): Promise<void> {
  // STEP 4 — the KIND FORK. A pick that spans MORE THAN ONE kind (a wiring TASK next to a wiring-broke ISSUE —
  // "is it the work or the defect?") tags each row with its [kind] so the two are distinguishable. When that
  // cross-kind pick is a PURE MEANING fork (`fork` — no location/floor-pin component) it is also capped to 2
  // (+ new) so it stays a glance-and-tap. A SINGLE-kind pick (five same-name floors — the location axis) or a
  // mixed-axis pick keeps the full list (cap 9). The sliced list is FROZEN into slots, so display == stored ==
  // resolved either way.
  const multiKind = new Set(a.candidates.map((c) => c.kind)).size > 1
  const cands = a.candidates.slice(0, multiKind && a.fork ? 2 : 9)
  const rows = pickRows(cands, multiKind)   // null → too many for a WhatsApp list; the TEXT pick stands
  const askBody = composeItemPickBody(a, cands, multiKind, !!rows)   // the question, in the words it is asked in
  const slots = {
    kind: 'siteops_batch_collision', status: 'still_open', piece_text: a.pieceText,
    candidates: cands, project_id: a.projectId, narration_id: a.narrationId, image: a.image,
    // GAP 1 — the QC evidence rides the question. Frozen here with the offered list, applied by the answer.
    ...(a.qcStatements?.length ? { qc_statements: a.qcStatements } : {}),
    // THE QUESTION, VERBATIM (2026-07-11). A re-surface used to RE-RENDER the question from the stored
    // question string + candidate names — which silently dropped the "You said …" piece, the "It's something
    // else" / "None of these" escapes, and the "(N more to sort out)" counter. The supervisor was shown a
    // stump of the question he was being asked to answer. Store what we asked; replay exactly that.
    ask_body: askBody,
    ...(a.update ? { update: a.update } : {}),
    ...(a.pending?.length ? { pending_item_asks: a.pending } : {}),
    ...(a.heldEntries?.length ? { held_readback: { entries: a.heldEntries, resolvedRefs: a.heldRefs ?? [] } satisfies HeldReadback } : {}),
  }
  await openConversation(ctx.supabase, {
    orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
    pendingQuestion: 'which item?', slots, lastMessageId: ctx.wamid,
  })
  // STEP C1 — record the opened ask on the sink so flushOrHoldReadback can STASH the turn's resolved summary
  // onto THIS conversation (the resume folds it into one readback), holding it until the ask is answered.
  if (a.sink) { a.sink.askSlots = slots; a.sink.askQuestion = { pendingQuestion: 'which item?', lastMessageId: ctx.wamid } }
  // NOTHING IS TRUNCATED. The supervisor cannot pick what they cannot read, and a cut label lies: the 3-word
  // `shortLabel` once rendered "wiring completed for the entire apartment except the fifth floor" as
  // "ASM Elite: fifth", and a 3-word cut of "bathroom tiles not fixed correctly" + "resolved" read as
  // "✓ bathroom tiles not resolved" — a truth inversion (probe C2). The candidate titles carry their
  // "— Floor · Unit" tail because that is the only thing that tells same-name rows apart. This is a plain TEXT
  // message, so WhatsApp imposes no per-row cap (interactive LIST rows are capped at 24 chars by Meta — which
  // is exactly why picks are not sent as lists).
  // The LIST is a tap-shortcut over the SAME body — every candidate is still printed above it, in full, so a
  // 24-char row title can never be the only place a fact appears. Too many rows for Meta's cap → text, whole.
  // The turn-specific prefix (a welcome) leads the message but is NOT part of the question, so it never rides
  // the slots: a question replayed an hour later must not re-greet the sender.
  const body = a.prefix ? `${a.prefix}\n\n${askBody}` : askBody
  // An ask is the ONE message that actually blocks the human — he can do nothing until it arrives, so it
  // must never sit in a 10-second queue. (Falls back to the outbox on a failed send, exactly as before.)
  await sendNowDurable(ctx.supabase, ctx.from, rows
    ? { kind: 'list', body, button: 'Pick the work', rows }
    : { kind: 'text', body }, meta)

  // WHY THESE N ROWS — the provenance of every offered row and, crucially, what the cap DROPPED. Without the
  // dropped list a live "which of these?" cannot be explained: we could not tell whether the right floor was
  // ranked out or never existed.
  const srcOf = (id: string) => (a.update?.target_id === id ? 'model_pick' : a.provenance?.[id] ?? 'shortlist')
  console.log(`[siteops:ask:compose] piece=${JSON.stringify(a.pieceText)} axis=${a.fork ? 'meaning(fork)' : 'meaning/location'} multiKind=${multiKind} cap=${multiKind && a.fork ? 2 : 9}`)
  console.log(`[siteops:ask:offered] ${JSON.stringify(cands.map((c) => ({ id: c.id, kind: c.kind, label: c.title, src: srcOf(c.id) })))}`)
  const dropped = a.candidates.slice(cands.length)
  if (dropped.length) console.log(`[siteops:ask:dropped] cap removed ${dropped.length}: ${JSON.stringify(dropped.map((c) => ({ id: c.id, label: c.title, src: srcOf(c.id) })))}`)
}

/**
 * THE ITEM-ASK DRAIN. Ask the FIRST owed which_item question and carry the REST in its slots, so the answer
 * asks the next (finishItemAsk). Mirrors askProjectGroups' `pending_groups` cursor exactly. Returns true when
 * a question went out — the caller must then NOT flush its readback (the ask holds it).
 */
async function drainItemAsks(
  ctx: SiteopsCtx, meta: { org_id: string; wamid: string }, queue: PendingItemAsk[],
  opts: { sink?: ReadbackSink; heldEntries?: { project: string | null; body: string }[]; heldRefs?: { kind: string; id: string; event: string }[] } = {},
): Promise<boolean> {
  if (!queue.length) return false
  const [first, ...rest] = queue
  console.log(`[siteops:ask:drain] asking 1 of ${queue.length} which_item asks (${rest.length} queued)`)
  await askItemPick(ctx, meta, {
    ...first, update: first.update ?? null, pending: rest,
    sink: opts.sink, heldEntries: opts.heldEntries, heldRefs: opts.heldRefs,
  })
  return true
}

// question_asked → open the pick through an EXISTING proven resume, storing exactly the offered set in the
// conversation slots (same-set-in / same-set-validated-out — the conversation twin of the planner's
// candidate-membership guard). which_item confirms a LOW/un-offered update — the confirm upgrades WHICH
// item; the ladder still gates WHETHER it resolves (closure_explicit rides in `update` for the resume to
// re-run — T3 sole-authority), so a no-closure confirm → ADDRESSING, an explicit-closure one → RESOLVE.
// which_project sites a new item. Both carry the "None — it's new" / project-pick escapes the resumes
// already implement.
// Returns whether a question was actually SENT — an un-sendable one (target not in itemsById, unknown
// `about`) must be handled by the caller as a park + honest readback, never a silent 'ok' (T3 fix).
async function askResolutionQuestion(ctx: SiteopsCtx, t: Extract<Terminal, { kind: 'question_asked' }>, ex: ExecCtx): Promise<boolean> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  // which_item is NOT handled here — every candidate-pick ask routes through the ONE composer (askItemPick),
  // AGGREGATED across terminals in applyTerminals so N low-confidence updates ask ONCE, not N times (the
  // fan-out). This function now handles only place_photo + which_project (a photo placement / a new item's
  // site — not an item-candidate pick).
  // ASK-BEFORE-EVIDENCE: an unplaced photo with lexically-near candidates → the PROVEN typed pick
  // (attach-on-pick / evidence-park-on-"none"), photo riding the slots. Un-sendable (no mapping, no
  // stored photo) → false, and the caller falls back to the evidence park — the floor never moves.
  if (t.about === 'place_photo') {
    const shortlist = (t.shortlistIds ?? [])
      .map((id) => ({ id, c: ex.candById?.get(id) }))
      .filter((x): x is { id: string; c: ExecCandidate } => !!x.c)
      .map((x) => ({ kind: x.c.kind, id: x.id, label: x.c.title }))
      .slice(0, 9)   // slots shortlist === sent rows, so "None" (= length + 1) resolves to observe
    if (!shortlist.length || !ctx.image?.storagePath) return false
    const full = [...(ex.candById ?? new Map<string, ExecCandidate>())].map(([id, c]) => ({ kind: c.kind, id, label: c.title }))
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: 'place photo',
      slots: {
        kind: 'siteops_typed_pick', project_id: ex.projectId ?? null, item: null,
        shortlist, full, narration_id: ex.narrationId,
        image: { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null },
      },
      lastMessageId: ctx.wamid,
    })
    await sendNowDurable(ctx.supabase, ctx.from, {
      kind: 'list',
      body: `Got the photo — is it about one of these, or something new?`,
      button: 'Pick',
      rows: [
        ...shortlist.map((c, i) => ({ id: `pick:${i + 1}`, title: fullText(c.label).slice(0, 24), description: `[${c.kind}]` })),
        { id: `pick:${shortlist.length + 1}`, title: 'None — just save it' },
      ],
    }, meta)
    return true
  }
  if (t.about === 'which_project' && t.item) {
    // SERIALIZED — inside a queued turn this ask WAITS (runSiteops asks it first, carrying the item asks in
    // its slots). Opening it here would clobber, or be clobbered by, the item drain: openConversation upserts
    // the ONE open conversation per (org, sender). Deferred is still SENT — just by the single cursor.
    if (ex.projectAskQueue) {
      ex.projectAskQueue.push({ item: toSiteItem(t.item), narrationId: ex.narrationId })
      return true
    }
    const { data: projRows } = await ctx.supabase.from('projects').select('project_id, name').eq('org_id', ctx.orgId).eq('status', 'Active')
    const cands = ((projRows ?? []) as { project_id: string; name: string }[]).map((p) => ({ id: p.project_id, name: p.name }))
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: 'which project?',
      slots: { kind: 'siteops_project', items: [toSiteItem(t.item)], candidates: cands, narration_id: ex.narrationId, image: null },
      lastMessageId: ctx.wamid,
    })
    await sendNowDurable(ctx.supabase, ctx.from, {
      kind: 'list', body: `Which project is *${fullText(t.item.detail)}* for?`, button: 'Pick project',
      rows: cands.slice(0, 10).map((c, i) => ({ id: `pick:${i + 1}`, title: c.name.slice(0, 24) })),
    }, meta)
    return true
  }
  return false
}

export async function applyTerminals(ctx: SiteopsCtx, terminals: Terminal[], ex: ExecCtx): Promise<TerminalOutcome[]> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  ex.vmMemo ??= new Map()   // scoped to THIS call (see materializeProjectTasks)
  console.log(`[siteops:apply] project=${ex.projectName ?? ex.projectId ?? '-'} terminals=${JSON.stringify(terminals.map((t) => t.kind === 'object_updated' && t.collectiveTargetIds?.length ? `${t.kind}×${t.collectiveTargetIds.length}` : t.kind))}`)
  const outcomes: TerminalOutcome[] = []
  const resolvedRefs: { kind: string; id: string; event: string }[] = []   // resolved ISSUES → the undo binding
  const createdRefs: { kind: 'problem' | 'todo'; id: string; label: string }[] = []   // image-created objects → the enrichment window (T5 Gap C)

  // ── which_item asks: ONE aggregated pick, never one message per terminal (the fan-out) ─────────────────
  // Every which_item question the ladder produced (LOW-confidence updates, MED-task targets, the both-false
  // near floor) resolves the SAME way — pick one offered item or "new". Collect them into ONE numbered
  // message via the shared composer; a target that resolves to no offered candidate still PARKS honestly (T3
  // no-silent-drop). N low-confidence updates on one message → ONE question, not N. The composer freezes the
  // offered order into slots (display == resolution), so the loop below must SKIP these (handled here).
  const wiQs = terminals.filter((t): t is Extract<Terminal, { kind: 'question_asked' }> => t.kind === 'question_asked' && t.about === 'which_item')
  if (wiQs.length) {
    const seen = new Set<string>()
    const cands: CollisionCand[] = []
    for (const q of wiQs) {
      // A shortlist (the structural-pin ask, the near-floor both-false ask) offers ITS FULL residual set; a
      // bare single-target ask (low-confidence / med-task) offers just that target + "new". Prefer the
      // shortlist when present so a structural which_item never collapses to the model's (unpinned) pick.
      for (const id of (q.shortlistIds?.length ? q.shortlistIds : (q.update ? [q.update.target_id] : []))) {
        if (seen.has(id)) continue
        const item = ex.itemsById.get(id)
        const c = ex.candById?.get(id)
        const kind = (item?.kind ?? c?.kind) as 'issue' | 'todo' | 'task' | undefined
        if (!kind) continue   // target resolves to no offered candidate → not askable; parked in the else below
        seen.add(id)
        // The row's FACTS ride along when it has them (task rows), so the renderer names the axis from what
        // the options ARE, not from what their labels look like. A batch ITEM is an issue/todo — free text,
        // no facts to carry — so it never sets them, and the fallback stands.
        const facts = c?.name !== undefined && !item ? { name: c.name, loc: locLabel(c.floor, c.unit) } : {}
        cands.push({
          id, kind, orgId: ctx.orgId,
          projectId: item?.projectId ?? c?.projectId ?? ex.projectId ?? null,
          projectName: item?.projectName ?? c?.projectName ?? '',
          title: item?.title ?? c?.title ?? '', cause: item?.cause ?? null,
          ...facts,
        })
      }
    }
    if (cands.length) {
      // carry the held verdict ONLY for a single-target ask (T3 sole-authority thread); a multi-candidate ask
      // has no single verdict → verdict-less slot forces ADDRESSING on confirm (the conservative floor).
      const single = wiQs.length === 1 && cands.length === 1 ? (wiQs[0].update ?? null) : null
      const image = ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null
      // STEP 4 — cap the cross-kind fork to 2 ONLY when EVERY contributing ask is the MEANING axis. A location
      // component (same-name floor pin) present → keep the full list so no floor is truncated (fork=false).
      const fork = wiQs.every((q) => (q.axis ?? 'meaning') === 'meaning')
      // A preamble is a fact about THIS site's structure ("no floor cellar"), so it holds for every ask folded
      // into this one pick. Take the first that carries one — there is at most one structure per narration.
      const preamble = wiQs.find((q) => q.preamble)?.preamble ?? null
      const ask: PendingItemAsk = {
        candidates: cands, pieceText: ex.message ?? cands[0].title, qcStatements: ex.qc?.statements ?? [],
        projectId: ex.projectId ?? cands[0].projectId ?? null, narrationId: ex.narrationId, image, update: single, fork, preamble,
      }
      // SERIALIZED — with a queue, this ask waits its turn (the caller drains one at a time). Without one
      // (the direct/resume callers), it goes out inline exactly as before.
      if (ex.askQueue) ex.askQueue.push(ask)
      else await askItemPick(ctx, meta, { ...ask, sink: ex.readbackSink })
      for (const q of wiQs) outcomes.push({ terminal: q, status: 'ok', label: terminalLabel(q, ex.labelById) })
    } else {
      // NONE resolvable → the T3 floor: park each honestly (never a silent drop); the readback tells the sender.
      for (const q of wiQs) {
        await parkObservation(ctx, terminalObservation(q), q.update ? 'non_batch_target' : 'v2_unhandled_terminal', ex.narrationId,
          q.update ? { target_id: q.update.target_id, target_kind: q.update.target_kind, label: terminalLabel(q, ex.labelById), update: q.update } : null,
          { projectId: ex.projectId ?? null })
        outcomes.push({ terminal: q, status: 'failed', label: terminalLabel(q, ex.labelById) })
      }
    }
  }

  // THE IDEMPOTENCY FLOOR (live probe, 2026-07-11). One row, one action, ONE write and ONE readback line —
  // however many times the message named it. An over-decomposed photo ("the frame is boarded at the front /
  // the frame is still exposed at the rear") produces two updates that pin to the SAME row; applying twice
  // writes the row twice and tells the sender twice that it was updated, which reads as two separate reports
  // that never happened. The set is TURN-scoped (ex.appliedTargets, owned by the unit loop) so it also holds
  // ACROSS the per-item applyTerminals calls, not just within one.
  const appliedOnce = (ex.appliedTargets ??= new Set<string>())
  const applyKey = (t: Extract<Terminal, { kind: 'object_updated' }>) =>
    `${t.collectiveTargetIds?.length ? [...t.collectiveTargetIds].sort().join(',') : t.update.target_id}:${t.applied}`

  for (const t of terminals) {
    try {
      if (t.kind === 'object_updated') {
        const key = applyKey(t)
        if (appliedOnce.has(key)) {
          console.log(`[siteops:apply:dup] ${key} — already applied this turn; not written again, not read back twice`)
          outcomes.push({ terminal: t, status: 'duplicate', label: terminalLabel(t, ex.labelById) })
          continue
        }
        appliedOnce.add(key)
        // #2 COLLECTIVE — an explicit "all" swept the residual same-name tasks; apply the shared verdict to
        // EVERY one and read back ONE combined line. (Tasks only; no undo — consistent with today's task
        // updates, and the undo is not mandatory in this setting.)
        if (t.collectiveTargetIds?.length) {
          const succeeded: string[] = []
          for (const id of t.collectiveTargetIds) {
            // a collective BLOCKED ("none of the ceilings are done") records the blocker on every residual
            // sibling — it must never reach applyProgress, which would advance them all.
            const label = t.applied === 'blocked'
              ? await applyTaskBlockedById(ctx, id, t.update.reason)
              : await applyTaskProgressById(ctx, id, t.update.reason, ex.narrationId, ex.now, ex.projectId ?? null, t.applied === 'resolve', ex.vmMemo, ex.qc)
            if (label) succeeded.push(id)
          }
          // THE SWEPT ROWS' SHARED NAME — the row's own `name`, never the label with its tail chopped off.
          // The old `title.split(' — ')[0]` was the same mistake splitLabel made: on "Plumbing — sanitaryware
          // & fittings — Ground" it read the CATEGORY as the whole name, so a three-floor sweep read back as
          // "Plumbing — marked all 3", which names a trade, not the work that was done. Falls back to the old
          // split only for a row with no facts (a legacy shortlist), where a guess is all there is.
          const cand = ex.candById?.get(t.update.target_id)
          const baseName = cand?.name ?? (cand?.title ?? ex.labelById.get(t.update.target_id) ?? 'tasks').split(' — ')[0]
          console.log(`[siteops:collective] name=${JSON.stringify(baseName)} targets=${t.collectiveTargetIds.length} applied=${succeeded.length}`)
          outcomes.push({ terminal: { ...t, collectiveTargetIds: succeeded.length ? succeeded : t.collectiveTargetIds }, status: succeeded.length ? 'ok' : 'failed', label: baseName })
          continue
        }
        const item = ex.itemsById.get(t.update.target_id)
        if (!item) {
          // STAGE 2 — a HIGH-confidence TASK target applies first-class (the probe-P5 gap): the third of
          // the spec's three kinds ("tasks + issues + snags") finally lands instead of holding.
          // A BLOCKED task lands at med too (it changes no status, so it needs no high-confidence gate) and
          // must never route through applyTaskUpdate → applyProgress.
          if (t.update.target_kind === 'task' && t.applied === 'blocked') {
            const label = await applyTaskBlockedById(ctx, t.update.target_id, t.update.reason)
            if (label) { outcomes.push({ terminal: t, status: 'ok', label }); continue }
          }
          if (t.update.target_kind === 'task' && t.update.confidence === 'high') {
            const label = await applyTaskUpdate(ctx, t, ex)
            if (label) { outcomes.push({ terminal: t, status: 'ok', label }); continue }
          }
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
        await applyBatchResolution(ctx, item, t.applied, t.update.reason, ex.cadenceMap, ex.actorId, ex.now, { reason: t.update.reason, out })
        // A photo riding an update is ANSWER EVIDENCE for the item it updates (decision (a): a chase-reply
        // photo never spawns a fresh object) — attach + trail, the role='answer' path the flip had dropped.
        if (ctx.image?.storagePath) await answerWithPhoto(ctx, { kind: item.kind, id: item.id, orgId: item.orgId }, ctx.image.storagePath, ctx.image.caption ?? null)
        if (t.applied === 'resolve' && item.kind === 'issue' && out.resolveEvent) resolvedRefs.push({ kind: 'issue', id: item.id, event: out.resolveEvent })
        outcomes.push({ terminal: t, status: 'ok', label: readbackLabel(item.title) })
      } else if (t.kind === 'object_created') {
        // the item's own named project wins (cross-script hint the string-match missed); else THE project
        // the unit resolved — "no match → CREATE" must land on the message's site, never nowhere.
        const proj = await resolveProject(ctx.supabase, ctx.orgId, { nameHint: t.item.project_hint })
        const pid = proj.projectId ?? ex.projectId ?? null
        if (!pid) throw new Error('project unresolved')
        const out = await routeGroup(ctx, pid, [toSiteItem(t.item, ex.structure)], ex.narrationId)
        if (out.progress.length + out.problems.length + out.todos.length === 0) throw new Error('nothing created')
        // Image evidence rides the create (finishRoute's twin): link the ALREADY-stored photo to each
        // object this terminal created — after create, so a failed create leaves no orphan attachment.
        if (ctx.image?.storagePath) {
          const sp = ctx.image.storagePath, cap = ctx.image.caption ?? null
          for (const p of out.problems) if (p.id) await attachImage(ctx, 'problem', p.id, sp, cap, 'creation')
          // a to-do IS a problems row now (a planned snag) — the parent kind must say where it lives,
          // or its photo hangs off an id in a table that no longer receives writes
          for (const td of out.todos) if (td.id) await attachImage(ctx, 'problem', td.id, sp, cap, 'creation')
          for (const pr of out.progress) if (pr.taskId) await attachImage(ctx, 'site_task', pr.taskId, sp, cap, 'creation')
          // T5 Gap C — remember the CREATED objects so the enrichment window can hold over them (below). Only
          // problems/todos: the window resume enriches those (site_task refs are skipped by the resume).
          for (const p of out.problems) if (p.id) createdRefs.push({ kind: 'problem', id: p.id, label: p.title })
          for (const td of out.todos) if (td.id) createdRefs.push({ kind: 'problem', id: td.id, label: td.text })
        }
        outcomes.push({ terminal: t, status: 'ok', label: readbackLabel(t.item.detail) })
      } else if (t.kind === 'acked_untracked_work') {
        // The work is real; we hold no task list to tick off. Audit it exactly like a miss (the reviewer wants
        // to know WHY nothing landed), but the reply is an honest explanation, not "didn't catch".
        if (ex.narrationId) {
          const { error } = await ctx.supabase.from('site_narrations')
            .update({ miss_verdict: { reason: t.reason, contract: t.contract } }).eq('id', ex.narrationId)
          if (error) console.error('[siteops:miss-verdict] persist failed:', error.message)
        }
        outcomes.push({ terminal: t, status: 'ok', label: '' })   // no state effect; the narration IS the note
      } else if (t.kind === 'acked_no_place') {
        // A task named a floor/unit we couldn't place (no such floor, or the floor exists but the task isn't
        // tracked there). No wrong write; audit it, and the readback shows the real structure / points to the app.
        if (ex.narrationId) {
          const { error } = await ctx.supabase.from('site_narrations')
            .update({ miss_verdict: { reason: t.reason, contract: t.contract } }).eq('id', ex.narrationId)
          if (error) console.error('[siteops:miss-verdict] persist failed:', error.message)
        }
        outcomes.push({ terminal: t, status: 'ok', label: '' })   // no state effect; the narration IS the note
      } else if (t.kind === 'acked_didnt_catch') {
        // T7 (clause 6) — a BOTH-FALSE miss must be AUDITABLE, not in-memory: persist the resolution
        // verdict onto the narration it belongs to so a reviewer can query "why did we miss this" after
        // the fact (the contract shows the ladder found nothing; raw_text + decomposed already sit here).
        // Best-effort: a verdict write must never fail the ack.
        if (ex.narrationId) {
          const { error } = await ctx.supabase.from('site_narrations')
            .update({ miss_verdict: { reason: t.reason, contract: t.contract } }).eq('id', ex.narrationId)
          if (error) console.error('[siteops:miss-verdict] persist failed:', error.message)
        }
        outcomes.push({ terminal: t, status: 'ok', label: '' })   // no state effect; the readback IS the ack
      } else if (t.kind === 'question_asked') {
        if (t.about === 'which_item') continue   // ALL which_item asks are AGGREGATED into one composer above
        // Open the pick through the PROVEN resume, storing exactly the offered set in slots (so the answer
        // validates against what was asked, never a re-load). Sends its own interactive message.
        // T3 FIX — an UN-SENDABLE question (target not in itemsById / unknown about) used to vanish as a
        // silent 'ok': no message, no park, green invariant. Now it parks replayable + reads back honestly.
        const sent = await askResolutionQuestion(ctx, t, ex)
        if (sent) {
          outcomes.push({ terminal: t, status: 'ok', label: terminalLabel(t, ex.labelById) })
        } else if (t.about === 'place_photo') {
          // un-sendable placement pick → the evidence FLOOR (distinct park, photo carried); the readback
          // line for a failed place_photo is the honest "photo saved as evidence", never a ⚠️.
          await parkObservation(ctx, 'photo evidence', 'evidence_await_placement', ex.narrationId, null, { projectId: ex.projectId ?? null })
          outcomes.push({ terminal: t, status: 'failed', label: 'photo' })
        } else {
          await parkObservation(ctx, terminalObservation(t), t.update ? 'non_batch_target' : 'v2_unhandled_terminal', ex.narrationId,
            t.update ? { target_id: t.update.target_id, target_kind: t.update.target_kind, label: terminalLabel(t, ex.labelById), update: t.update } : null,
            { projectId: ex.projectId ?? null })
          outcomes.push({ terminal: t, status: 'failed', label: terminalLabel(t, ex.labelById) })
        }
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
  // (a 'duplicate' is silent — the fact is already on a line the sender has been sent; a turn whose ONLY
  // outcomes are duplicates and sent questions has nothing new to read back.)
  if (outcomes.some((o) => o.status !== 'duplicate' && (o.terminal.kind !== 'question_asked' || o.status !== 'ok'))) {
    // T8c-2 (clause 5) UNDERSTOOD-FIRST — a compound where fragment-1 was a MISS but the rest was SAVED must
    // lead with what we held (the saved rest), not the miss. composeReadback would put the lone didn't-catch
    // first and append the saved suffix; reorder that one case so the understood part leads.
    const loneMiss = outcomes.length === 1 && outcomes[0].terminal.kind === 'acked_didnt_catch' && outcomes[0].status === 'ok'
    let body = (loneMiss && ex.readbackSuffix)
      ? `Got it —${ex.readbackSuffix.replace(/^ ·/, '')} · didn't catch anything else in that`
      : composeReadback(outcomes, ctx.lang) + (ex.readbackSuffix ?? '')
    // T8b (clause 4) — DISCLOSE a batch-ASSUMED project so a wrong adoption is visible and correctable
    // (there's no project-correction tap yet — reuse the fresh path: "send it again with the site").
    if (ex.assumedSite) body += ` · logged at *${ex.assumedSite}* (assumed from your open chase) — wrong site? send it again with the site`
    // TYPE 5 — WHERE the rows landed, and (when it is exactly one row) WHICH row. Both are read off the
    // OUTCOMES, here, where the truth is: the sink entry carries them to whichever door finally sends.
    const homes = homesOf(outcomes)
    const written = outcomes.filter((o) => o.status === 'ok' && o.terminal.kind === 'object_updated')
    const one = written.length === 1 && !written[0].terminal.collectiveTargetIds?.length ? written[0].terminal : null
    const link = one && one.kind === 'object_updated'
      ? recordLink(ex.projectId, one.update.target_id, one.update.target_kind)
      : null
    const entry: ReadbackEntry = { project: ex.projectName ?? null, body, homes, link }

    if (ex.readbackSink) {
      // BATCHED — collect for the ONE combined reply runSiteops flushes (asks already went out inline).
      console.log(`[siteops:readback:collect] project=${ex.projectName ?? '-'} homes=${homes.join('+') || '-'} body=${JSON.stringify(body.slice(0, 200))}`)
      ex.readbackSink.entries.push(entry)
      for (const r of resolvedRefs) ex.readbackSink.resolvedRefs.push(r)
    } else {
      // ONE DOOR (Type 5) — body, destination line and button are composed in one place, so the direct path
      // and the batched path cannot drift. The undo capture still rides along when a resolve landed.
      await sendNowDurable(ctx.supabase, ctx.from, composeConfirmation([entry], resolvedRefs),
        resolvedRefs.length ? { ...meta, capture: { ref_kind: 'readback', object_refs: resolvedRefs } } : meta)
    }
  }

  // STEP 2 — ENRICHMENT WINDOW (images only), ported from finishRoute into the ONE pipeline (T5 Gap C). When
  // an image CREATED object(s), hold an OPEN siteops_photo convo (~90s) so a follow-up TEXT (or quoted reply)
  // ENRICHES these SAME objects rather than twinning them (dispatch → classifyPhotoFollowup → the
  // siteops_photo resume). Event-driven, no timer. Guard: never when a pick is already pending (one open
  // convo per sender) — the pick owns the slot.
  const pickPending = outcomes.some((o) => o.terminal.kind === 'question_asked' && o.status === 'ok')
  if (ctx.image?.storagePath && createdRefs.length && !pickPending) {
    const holdMs = Number(Deno.env.get('WA_SITEOPS_PHOTO_HOLD_MS') ?? '90000')
    const extract = createdRefs.map((r) => r.label).filter(Boolean).join(' · ')
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: 'photo enrichment window',
      slots: {
        kind: 'siteops_photo', object_refs: createdRefs.map((r) => ({ kind: r.kind, id: r.id })),
        project_id: ex.projectId ?? null, photo_wamid: ctx.wamid,
        hold_until: new Date(Date.now() + holdMs).toISOString(),
        label: fullText(extract || 'the photo'), extract, narration_id: ex.narrationId,
      },
      lastMessageId: ctx.wamid,
    })
  }
  return outcomes
}

/** "“cement short”✓ resolved" / "“masons absent” still open (will check back)" — one readback part.
 *  Quoted, length-capped labels (readbackLabel) — a word-count cut can invert the sentence (probe C2). */
function readbackPart(item: BatchItem, verdict: 'resolved' | 'open' | 'blocked'): string {
  if (verdict === 'resolved') return `“${readbackLabel(item.title)}” ✓ ${item.kind === 'todo' ? 'done' : 'resolved'}`
  if (verdict === 'blocked') return `⏳ “${readbackLabel(item.title)}” still open — noted, chasing sooner`
  return `“${readbackLabel(item.title)}” still open (will check back)`
}

// PHASE 4 EXECUTED (2026-07-09). Deleted here: handleBatchReply + handleBatchReplyLegacy — the adoption-era
// chase-reply engines, UNREACHABLE since the text path went singular-first and the image path went
// project-first, and kept only "for one bisectable revert". They were the sole consumers of the reply
// word-lists (isBareAck / interpretStatus / classifyReplyFragment / matchPieceToBatch) and of the
// standalone judgeResolution. A chase reply is now an ordinary inbound message: the router reads the
// conversation, and the batch is what siteops always claimed it was in its own comments — a ⭐ candidate
// prior, never a router.


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
  messages: string[]     // one grading message per decomposed item of THIS project group (Stage-2 loop)
  // What decompose called each message ('progress' | 'issue' | 'todo'), positionally aligned with `messages`.
  // A PROGRESS report needs a task to land on; on a site with no task list that deserves an honest sentence,
  // not a quiz. This is decompose's classification finally reaching the resolver instead of being discarded.
  itemTypes?: (('progress' | 'issue' | 'todo') | null)[]
  // Decompose's per-item STRUCTURE slot (where the work is), positionally aligned with `messages`. The model
  // never sees a floor; code pins the physical task row from this. Absent → the pin asks over the type's rows.
  structures?: (StructureSlot | null)[]
  // STEP A — the CHECKABLE FACTS each item stated ("poured continuous, no cold joint"), positionally aligned
  // with `messages`. These are what the strict QC matcher grades the task's authored checks against; without
  // them every check stays pending forever, however clearly the supervisor stated it.
  qcStatements?: (string[] | null)[]
  batch: OpenBatch | null
  narrationId: string | null
  callModel: (system: string, user: string) => Promise<string>
  assumedSite?: string   // T8b — the project NAME when ASSUMED from a single-site batch (via='auto'); disclosed once.
  sink?: ReadbackSink    // batched readback pool (runSiteops owns it); absent → applyTerminals sends inline.
  askQueue?: PendingItemAsk[]   // serialized which_item asks (runSiteops owns it); absent → asks fire inline.
  projectAskQueue?: PendingProjectAsk[]   // serialized which_project asks (same cursor; see ExecCtx).
  projectName?: string | null   // this group's project name — labels its lines in a multi-project combined reply.
  context?: string | null   // FIX B — the WHOLE narration these items were split from (background for each resolveInbound).
  // When present, the chased ids this group RESOLVED are pushed here instead of being dropped from the batch
  // immediately. dropBatchItems rewrites `items` from the CALLER'S in-memory snapshot, so two groups sharing
  // one `batch` object each write "everything except my own resolves" — and the second resurrects the first's.
  // (That is a live bug today, sequential or not: a multi-project chase reply loses one project's strike-offs.)
  // The caller collects across groups and drops ONCE. Absent → this unit drops its own (single-group callers).
  resolvedOut?: string[]
}): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const now = new Date()
  const cadenceMap = await loadCadenceMap(ctx.supabase, ctx.orgId)
  const actorId = await senderUserId(ctx)

  // the batch as a PRIOR: only its same-project items reach the set (⭐); a batch on another project is
  // invisible — by construction, not by guard (journeys a/b/e assert the prompt's contents).
  const scopedBatchItems = (u.batch?.items ?? []).filter((b) => b.projectId === u.projectId)
  const rankBatch = scopedBatchItems.length ? { items: scopedBatchItems } : null
  const batchById = new Map((u.batch?.items ?? []).map((i) => [i.id, i]))

  // projectName rides along: this unit's site is SETTLED (decompose named it, the group resolved it), so a new
  // item the model forgets to site is created HERE, not sent back as "which project is this for?".
  const rc: ResolveInboundCtx = { supabase: ctx.supabase, orgId: ctx.orgId, from: ctx.from, projectId: u.projectId, projectName: u.projectName ?? null }
  const say = (body: string) => sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body }, meta)
  const image = ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null

  // STAGE-2 LOOP — recurse over THIS project's items (a single narration = one message; a same-project
  // compound = N). Each item is one resolveInbound over THE project's candidate set → apply per the ladder.
  // The photo rides the FIRST message only (no duplicate attach). No pending_stage2 park: the loop OWNS
  // every item now — a per-item model failure still parks itself inside resolveInbound.
  console.log(`[siteops:unit] project=${u.projectName ?? u.projectId} messages=${u.messages.length} batchPrior=${scopedBatchItems.length} batched=${!!u.sink}`)
  const resolvedIds: string[] = []
  // ONE row, ONE action, once — across every item of this unit (see ExecCtx.appliedTargets).
  const appliedTargets = new Set<string>()

  // ── RESOLVE CONCURRENTLY, APPLY SERIALLY (2026-07-13, latency) ────────────────────────────────────
  // Each item's resolve is one model call over THE SAME candidate set, and it produces terminals without
  // touching a row. They do not depend on one another — but they ran one after another anyway, so a
  // four-item voice note paid four model calls end to end (~1.1–1.7s each, measured), plus four identical
  // candidate loads. Nothing was waiting on anything.
  //
  // The APPLY still runs strictly in order, one item at a time, exactly as before. That is not an
  // oversight — the order is load-bearing: `appliedTargets` enforces one-row-one-action across the unit,
  // the ask queue must offer questions in the order the sentences were spoken, and the readback sink
  // composes its lines in that order too. Only the THINKING is parallel. Every write stays in single file.
  //
  // resolveInbound's happy path sends nothing; it only speaks when it PARKS (a model failure). Those
  // notices are independent of each other, so no ordering promise is broken by them racing.
  // THE OFFER MUST BE TRUE BEFORE IT IS MADE. prefetchResolveInputs reads site_tasks straight out of the
  // DB; on a project whose rows predate a library change those rows are fiction, and we would ask him to
  // pick one of them. Heal first, then read — and hand the READER the same VM the WRITER is judged against,
  // so a row the guardrail would refuse is never offered in the first place. (Memoised per turn.)
  rc.vm = await ensureProjectFresh(ctx, u.projectId)
  const pre = await prefetchResolveInputs(rc, rankBatch)
  const resolutions = await Promise.all(u.messages.map((msg, mi) => resolveInbound(
    rc,
    { message: msg, image: mi === 0 ? image : null, narrationId: u.narrationId, context: u.context ?? null, itemType: u.itemTypes?.[mi] ?? null, structure: u.structures?.[mi] ?? null },
    rankBatch, say, u.callModel, pre,
  )))

  for (let mi = 0; mi < u.messages.length; mi++) {
    const res = resolutions[mi]
    if (res.kind === 'parked') { console.log(`[siteops:unit:msg] i=${mi} → PARKED (${res.reason})`); continue }   // honest five-part park; nothing touched for this item

    // itemsById spans EVERY offered issue/todo candidate — an update onto THE project's open work applies
    // first-class, chased or not. Chased items keep their full batch shape; non-chased get a minimal one.
    const itemsById = new Map<string, BatchItem>()
    for (const c of res.candidates) {
      if (c.kind !== 'issue' && c.kind !== 'todo') continue
      itemsById.set(c.id, batchById.get(c.id) ?? {
        kind: c.kind, id: c.id, orgId: ctx.orgId, projectId: c.project_id ?? u.projectId,
        projectName: c.project_name ?? null, title: c.title, taskName: null, cause: 'other',
      } as BatchItem)
    }
    const labelById = new Map(res.candidates.map((c) => [c.id, readbackLabel(c.title ?? '')]))
    const candById = new Map<string, ExecCandidate>(res.candidates.map((c) => [c.id, { kind: c.kind, title: c.title, projectId: c.project_id, projectName: c.project_name }]))
    // TASK candidates are TYPES; the pin retargets to a physical ROW id (for the apply) or offers row ids (for
    // a location which_item ask). Those row ids must resolve to a human label + a candidate, so add every row.
    for (const c of res.candidates) {
      if (c.kind !== 'task' || !c.rows?.length) continue
      for (const r of c.rows) {
        labelById.set(r.id, readbackLabel(r.title))
        // `r.title` is r.name + r.floor + r.unit, composed. Carry the three THEMSELVES as well: the pick's
        // renderer needs to know what tells its rows apart, and the composed string cannot tell it (both the
        // name's own ' — ' and the floor's join on the same separator).
        candById.set(r.id, { kind: 'task', title: r.title, projectId: c.project_id, projectName: c.project_name, name: r.name, floor: r.floor, unit: r.unit })
      }
    }
    const outcomes = await applyTerminals(ctx, res.terminals, {
      itemsById, labelById, candById, cadenceMap, actorId, now,
      narrationId: u.narrationId, projectId: u.projectId, assumedSite: mi === 0 ? u.assumedSite : undefined, message: u.messages[mi],
      readbackSink: u.sink, projectName: u.projectName, askQueue: u.askQueue, projectAskQueue: u.projectAskQueue,
      appliedTargets,
      // WHERE this item is. The slot was computed at decompose and handed to the resolver as the
      // task pin's only input — it just never travelled as far as the row it created.
      structure: u.structures?.[mi] ?? null,
      qc: { statements: u.qcStatements?.[mi] ?? [], call: u.callModel },
    })
    console.log(`[siteops:unit:msg] i=${mi} outcomes=${JSON.stringify(outcomes.map((o) => ({ k: o.terminal.kind, s: o.status, l: (o.label ?? '').slice(0, 40) })))}`)
    for (const o of outcomes) {
      const tt = o.terminal
      if (tt.kind === 'object_updated' && tt.applied === 'resolve' && o.status === 'ok' && batchById.has(tt.update.target_id)) {
        resolvedIds.push(tt.update.target_id)
      }
    }
  }
  // batch bookkeeping: drop resolved ∩ batch across ALL items, close when empty. With `resolvedOut` the caller
  // owns the single drop (see the field's note) — otherwise this unit is the only writer and drops its own.
  if (u.resolvedOut) u.resolvedOut.push(...resolvedIds)
  else if (resolvedIds.length && u.batch) await dropBatchItems(ctx.supabase, u.batch, resolvedIds)
}

// ── THE COMBINED READBACK (one reply for a whole compound/multi-project message) ──────────────────────────
// Each applyTerminals call pushed its composed body (+ project) to the sink; here we emit ONE message. A
// SINGLE entry is sent verbatim — identical to the un-batched path, undo button and all (so the common case
// is unchanged). MULTIPLE entries are stripped of their "Got it —" wrappers and joined; when they span more
// than one project each line is prefixed with its site (so an ASM line can't read as a Soundharya line). The
// undo is NOT attached to a multi-entry reply — an "all-or-nothing" undo over a batch is not wanted here.
// combineReadbacks + HeldReadback now live in ../_siteops_readback.ts (SHARED with the sweep's held-flush).
// STEP A — the IMMEDIATE receipt ack. Sent as soon as decompose knows the count, BEFORE the (sequential,
// multi-model-call) resolve loop, so a compound message doesn't sit in a long silence. A batch names the
// count and pre-frames the possible clarifying asks; a single message gets a lighter "got your message".
// A decompose failure (count 0) degrades to the single ack — never promises a count we couldn't parse.
//
// AN IMAGE GETS MORE THAN A RECEIPT. Pass `seen` (the grounded vision items) and the ack becomes the
// CONFIRMATION: what we read out of the photo, quoted back beside the caption, before the resolve loop
// writes anything — so a misread is caught by the one person who was standing there. See composePhotoAck.
// It degrades to the plain count ack whenever the photo yielded nothing to show.
//
// IT TAKES THE SAME ROAD AS THE ASK (live probe, 2026-07-13, 17:19). This used `send()` — the outbox —
// while every ask and readback in the turn uses `sendNowDurable()` — a direct POST. The outbox is drained
// by a pg_cron on a 10-second tick, so on a 4-second turn the ask, SAID second, was HEARD first:
//
//     17:19  "This site has no floor First…" + the numbered pick — the question.
//     17:20  "Here's what I can see in it… Checking it against the open work now — I'll confirm back."
//
// We promised to come back after we had come back, and the confirmation whose entire purpose is to let him
// catch a misread BEFORE we act arrived after we had acted. A message that another message in the same turn
// must not overtake has to travel by the same road as that message; the outbox's FIFO guarantee is worth
// nothing to a message that skips the queue. sendNowDurable keeps the durability (it falls back to the
// outbox if the direct POST fails), it just stops paying the queue's latency for a message a human is
// actively waiting on — which is exactly what it exists for.
async function sendReceiptAck(
  ctx: SiteopsCtx, meta: { org_id: string; wamid: string }, itemCount: number,
  seen?: { items: SiteItem[]; caption: string | null; project?: string | null; replyTo?: string },
): Promise<void> {
  const photo = seen ? composePhotoAck(seen.items, seen.caption, { project: seen.project ?? null }) : null

  /**
   * TYPE 2 · STAGE 2 — THE TRIAGE REPORT, AND IT EARNS ITS BUBBLE ONLY BY CARRYING A COUNT.
   *
   * Two acks that say the same thing ("got it" … "processing it") are noise: TIME ALONE NEVER JUSTIFIES
   * A MESSAGE. A count does. So a single quick item gets no second bubble at all — it goes straight from
   * the transport receipt to the confirmation — and a four-part voice note earns one, because "found 4
   * updates" is information the sender did not have.
   *
   * ✅ is dead everywhere (it is a duplicate of ✓, and two glyphs for one meaning is how a vocabulary
   * stops being one).
   */
  const body = photo ?? (itemCount > 1
    ? `Found ${bold(`${itemCount} updates`)} — checking each against open work. Confirming back in a moment.`
    : `Got it — checking against open work. Confirming back in a moment.`)

  await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body, replyTo: seen?.replyTo }, meta)
}

// STEP C1 — HOLD-and-FOLD. When some items resolved this turn AND a which_item ask is now OPEN, stash the
// resolved summary onto that ask's conversation (held_readback) instead of flushing mid-turn; the resume
// FOLDS it with the answer into ONE readback (finishItemAsk). No open collision ask → flush now (unchanged).
// The interrupt (commitInterruptedSiteops) and sweep paths flush a held summary, so the hold never drops it.
async function flushOrHoldReadback(ctx: SiteopsCtx, sink: ReadbackSink, meta: { org_id: string; wamid: string }): Promise<void> {
  // A which_item ask was opened this turn (askSlots set) AND items resolved → re-open THAT conversation with the
  // resolved summary stashed as held_readback; the resume folds it into ONE readback. No ask, or nothing
  // resolved → flush now (unchanged). Re-open (not read-modify-write) because openConversation upserts by sender.
  if (sink.entries.length && sink.askSlots) {
    await openConversation(ctx.supabase, {
      orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
      pendingQuestion: sink.askQuestion?.pendingQuestion ?? 'which item?',
      slots: { ...sink.askSlots, held_readback: { entries: sink.entries, resolvedRefs: sink.resolvedRefs } satisfies HeldReadback },
      lastMessageId: sink.askQuestion?.lastMessageId ?? ctx.wamid,
    })
    console.log(`[siteops:readback:hold] entries=${sink.entries.length} stashed on the open which_item ask`)
    return
  }
  await flushReadback(ctx, sink, meta)
}

/**
 * STEP C1 — the which_item resume's terminal step: emit the resume's readback, FOLDING any held batch summary
 * into ONE combined reply (no held → the answer's own line verbatim; bare held → flushed).
 * THE DRAIN: if more item asks are owed, ask the NEXT one instead and thread the accumulated readback onto it,
 * so the fold lands on the LAST answer. Every exit of the pick resume goes through here — an unanswered ask
 * can never be stranded by the answer to another one.
 */
async function finishItemAsk(
  ctx: SiteopsCtx, meta: { org_id: string; wamid: string }, slots: Record<string, unknown>,
  entry: { project: string | null; body: string } | null,
): Promise<void> {
  const pending = (slots.pending_item_asks ?? []) as PendingItemAsk[]
  const held = (slots.held_readback ?? null) as HeldReadback | null
  const entries = [...(held?.entries ?? []), ...(entry ? [entry] : [])]
  if (pending.length) {
    await drainItemAsks(ctx, meta, pending, { heldEntries: entries, heldRefs: held?.resolvedRefs ?? [] })
    return
  }
  if (entries.length) {
    const refs = held?.resolvedRefs ?? []
    await sendNowDurable(ctx.supabase, ctx.from, composeConfirmation(entries, refs),
      refs.length ? { ...meta, capture: { ref_kind: 'readback', object_refs: refs } } : meta)
  }
}

async function flushReadback(ctx: SiteopsCtx, sink: ReadbackSink, meta: Record<string, unknown>): Promise<void> {
  if (!sink.entries.length) { console.log('[siteops:readback:flush] nothing to send (entries=0)'); return }
  const msg = composeConfirmation(sink.entries, sink.resolvedRefs)
  console.log(`[siteops:readback:flush] entries=${sink.entries.length} resolves=${sink.resolvedRefs.length} kind=${msg.kind} body=${JSON.stringify(('body' in msg ? msg.body : '').slice(0, 400))}`)
  // sendNowDurable, not send: THIS is the message he has been waiting ~30 seconds for, and the outbox is
  // drained by a 10-second cron — so it used to sit in a queue for up to a third as long again as the
  // thinking took. It still falls back to that same outbox if the direct send fails, and it still stamps
  // wa_message_map for the capture, so undo and quoted-replies work exactly as before.
  await sendNowDurable(ctx.supabase, ctx.from, msg,
    sink.resolvedRefs.length ? { ...meta, capture: { ref_kind: 'readback', object_refs: sink.resolvedRefs } } : meta)
}

// ── THE PROJECT-GROUP ARRAY (multi-project → recurse per site) ────────────────────────────────────────
// One decompose → an ORDERED array of per-project groups. SINGLE-project = array-of-one. Each item's site
// resolves via resolveProject (the txn-style banded matcher); an item with no site of its own carries
// forward the nearest preceding site (belt on decompose's own carry-forward). Items on the same resolved
// project group together (shared candidate set); unresolved items group by tried name so one ask covers
// them. A single-site OPEN batch adopts an otherwise-unresolved lone group (the prior, disclosed via='auto').
interface ProjectGroup {
  projectId: string | null
  nameTried: string | null
  suggestions: { id: string; name: string }[]
  items: SiteItem[]
  via: string
  assumedSite?: string
}
async function resolveGroups(ctx: SiteopsCtx, decomposed: { items: SiteItem[]; project_hint: string | null } | null, projects: ProjectRef[], batch: OpenBatch | null, rawText: string, opts: { adoptBatch?: boolean } = {}): Promise<ProjectGroup[]> {
  const items = decomposed?.items ?? []
  if (!items.length) return []
  const topHint = decomposed?.project_hint ?? null

  // effective per-item hint with code carry-forward (nearest preceding named site, else the top-level hint)
  const effHints: (string | null)[] = []
  let carried: string | null = topHint
  for (const it of items) {
    const h = it.project_hint ?? topHint ?? carried
    if (it.project_hint) carried = it.project_hint
    effHints.push(h)
  }

  // resolve each DISTINCT hint once (the DB round-trip is per unique site, not per item)
  const cache = new Map<string, { projectId: string | null; nameTried: string | null; suggestions: { id: string; name: string }[]; via: string }>()
  const resolveOne = async (h: string | null) => {
    const key = h ?? '\0'
    const hit = cache.get(key)
    if (hit) return hit
    const r = await resolveProject(ctx.supabase, ctx.orgId, { narration: rawText, nameHint: h })
    const out = { projectId: r.projectId, nameTried: r.nameTried ?? h ?? null, suggestions: r.suggestions ?? projects.map((p) => ({ id: p.id, name: p.name })), via: r.via as string }
    cache.set(key, out)
    return out
  }

  // group by resolved projectId (or by tried-name bucket when unresolved), preserving first-appearance order
  const groups: ProjectGroup[] = []
  const byKey = new Map<string, ProjectGroup>()
  for (let i = 0; i < items.length; i++) {
    const r = await resolveOne(effHints[i])
    const key = r.projectId ?? `?${r.nameTried ?? effHints[i] ?? ''}`
    let g = byKey.get(key)
    if (!g) { g = { projectId: r.projectId, nameTried: r.nameTried, suggestions: r.suggestions, items: [], via: r.via }; byKey.set(key, g); groups.push(g) }
    g.items.push(items[i])
  }

  // single unresolved group + a SINGLE-site open batch → adopt it (the batch prior, disclosed via='auto').
  // NOT on the image path (adoptBatch:false): a photo carries no site WORDS at all, so adopting the sender's
  // active building off a photo that names nothing is exactly the silent mis-file the founder rule forbids
  // (_resolve.ts:15) — an unsited photo ASKS which project instead (the caller's unresolved-group ask). Text
  // keeps the prior: a message mid-conversation about one site legitimately carries that site forward.
  if (opts.adoptBatch !== false && groups.length === 1 && !groups[0].projectId && batch?.items?.length) {
    const pids = [...new Set(batch.items.map((b) => b.projectId).filter(Boolean))] as string[]
    if (pids.length === 1) {
      groups[0].projectId = pids[0]; groups[0].via = 'auto'
      groups[0].assumedSite = projects.find((p) => p.id === pids[0])?.name
    }
  }
  return groups
}

// ── THE DUPLICATE-NARRATION GUARD ────────────────────────────────────────────────────────────────────────
// Two sends of the same voice note are one report. Matched on MEANING-neutral normalisation (case, spacing
// and punctuation drift between two transcriptions of the same audio is not a new message), inside a short
// window, and ONLY against a narration we actually handled — `decomposed` holds items. A narration that
// FAILED (decompose_failed) or that the model read and found nothing in is not "handled": re-sending it is a
// retry or a rephrase, and both must run.
const DUP_WINDOW_MIN = 30
const normNarration = (s: string): string =>
  (s ?? '').toLowerCase().replace(/[.,!?;:"'()।]/g, '').replace(/\s+/g, ' ').trim()

async function recentDuplicateNarration(ctx: SiteopsCtx, text: string): Promise<{ id: string; ageMins: number } | null> {
  const want = normNarration(text)
  if (!want) return null
  // Recent narrations for the org; the window and the comparison are done here (a normalised match is not a
  // SQL equality). Best-effort — a read failure must never block a real message.
  const { data, error } = await ctx.supabase
    .from('site_narrations').select('id, raw_text, decomposed, created_at, miss_verdict')
    .eq('org_id', ctx.orgId).order('created_at', { ascending: false }).limit(20)
  if (error) { console.error('[siteops:duplicate] lookup failed (continuing):', error.message); return null }

  const now = Date.now()
  for (const r of (data ?? []) as { id: string; raw_text: string; decomposed: unknown; created_at: string; miss_verdict: unknown }[]) {
    const ageMs = now - new Date(r.created_at).getTime()
    if (!(ageMs >= 0 && ageMs < DUP_WINDOW_MIN * 60_000)) continue
    if (normNarration(r.raw_text) !== want) continue
    const handled = Array.isArray(r.decomposed) && r.decomposed.length > 0
    if (!handled) continue     // a failed or empty narration → a re-send is a retry, not a duplicate
    return { id: r.id, ageMins: Math.round(ageMs / 60_000) }
  }
  return null
}

export async function runSiteops(ctx: SiteopsCtx, text: string, opts: { prefix?: string; callModel?: (system: string, user: string) => Promise<string> } = {}): Promise<void> {
  const meta = { org_id: ctx.orgId, wamid: ctx.wamid }
  const say = (body: string) => sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: opts.prefix ? `${opts.prefix}\n\n${body}` : body }, meta)

  // ── FOUR READS, ONE WAVE (2026-07-13, latency) ────────────────────────────────────────────────────
  // The open batch, the duplicate probe, the sender's name and the org's project roster are FOUR
  // independent reads, and they ran one after another: four serial round trips before this agent had done
  // a single thing. On the measured voice turn that stretch was ~2.3s of the ~30s the supervisor waited.
  //
  // Nothing here depends on anything else here — a supabase-js builder is a thenable and does not fire
  // until awaited, so building them first and Promise.all-ing sends them together. (The same reasoning,
  // and the same fix, as buildCandidateSet's "ONE WAVE, not four".)
  //
  // The ORDER OF THE DECISIONS below is unchanged: the duplicate check still short-circuits before a single
  // thing is captured, modelled or matched. Only the WAITING is shared.
  const [batch, dup, sName, projRows] = await Promise.all([
    // The open chase batch is CONTEXT — a prior for the fast path, for project resolution, and for
    // candidate ranking. It is NEVER a router: the gate that force-routed any message into batch-only
    // execution died with the singular-first restructure (D5 batch-captures-fresh, Phase-0 E1).
    getOpenBatch(ctx.supabase, ctx.orgId, ctx.from),
    // A RE-SEND IS NOT NEW INFORMATION (2026-07-11). The supervisor re-sent his voice note; we had already
    // logged its contents, so its own sentences now matched the rows they had created, and we asked him
    // which of his own items he meant. Recognise the repeat and say so. Only a narration we actually
    // HANDLED counts: a re-send after a FAILURE is a RETRY, and the retry is the whole point of "send it
    // again whenever you like".
    recentDuplicateNarration(ctx, text),
    senderName(ctx),
    // Roster for project resolution: hand the extractor the org's active project NAMES so it returns the
    // CANONICAL project (semantic match), mirroring the transaction agent. Then resolveProject's string
    // match is just a safety net, not the primary resolver. Ids ride along so the multi-project planner
    // resolves each item's site without a second round-trip.
    ctx.supabase.from('projects').select('project_id, name').eq('org_id', ctx.orgId).eq('status', 'Active'),
  ])

  if (dup) {
    console.log(`[siteops:duplicate] same narration as ${dup.id} (${dup.ageMins}m ago) — acknowledged, not re-run`)
    await say(ALREADY_LOGGED)
    return
  }

  const projects: ProjectRef[] = (((projRows as { data?: { project_id: string; name: string }[] })?.data ?? []) as { project_id: string; name: string }[])
    .map((p) => ({ id: p.project_id, name: p.name }))
  const projectNames = projects.map((p) => p.name)

  // Capture-first: persist the raw narration immediately so nothing is ever lost. Stamp the sender's
  // name so the task feed shows who sent it; fall back without the column if the migration isn't applied
  // yet (capture-first must never fail on a missing column).
  const base = { org_id: ctx.orgId, raw_text: text, resolved_project_via: 'unresolved' }
  let ins = await ctx.supabase.from('site_narrations').insert({ ...base, sender_name: sName }).select('id').single()
  if (ins.error) ins = await ctx.supabase.from('site_narrations').insert(base).select('id').single()
  const narrationId: string | null = ins.data?.id ?? null
  console.log(`[siteops:entry] wamid=${ctx.wamid} narration=${narrationId} image=${!!ctx.image?.base64} audio=${!!ctx.audio?.storagePath} batch=${batch?.items?.length ?? 0} text=${JSON.stringify((text ?? '').slice(0, 200))}`)

  // T7 (clause 1) — a VOICE note's audio is already in the bucket; RECORD it as an attachment on this
  // narration so the source stays FINDABLE (a transcript miss must not orphan the audio). Best-effort,
  // after the narration exists; the CHECK admits parent_type='site_narration'.
  if (ctx.audio?.storagePath && narrationId) {
    const { error } = await ctx.supabase.from('attachments').insert({
      org_id: ctx.orgId, parent_type: 'site_narration', parent_id: narrationId, role: 'creation',
      bucket: 'rough-entry-media', object_path: ctx.audio.storagePath, caption: null, created_by: null,
    })
    if (error) console.error('[siteops:audio-attach] insert failed:', error.message)
  }

  // DELETED (2026-07-09) — the bare-ack FAST PATH. `isBareAck(text) && batch.items.length === 1` advanced
  // the lone chased item to ADDRESSING, re-timed its next chase, and wrote a `status_changed` trail row,
  // all without a model call. Two things were wrong with it.
  //
  // It ACTED ON AN ACKNOWLEDGEMENT. "ok" names nothing; it agrees that a question was asked. Converting that
  // into a state change moved real work and — because `status_changed` resets `unansweredStreak` — wiped the
  // escalation clock on an item nobody had touched. (The trail even has a `bare_ack` type that IS excluded
  // from that streak: the intent was right, and the same function defeated it.)
  //
  // And it depended on a word list, which is unmaintainable across en/te/hi/Tenglish/native script and cannot
  // fail loudly. The rule now: SITEOPS acts only on a message that NAMES its referent. An acknowledgement
  // reaches the concierge, which shows the supervisor what a naming message looks like. Nothing moves until
  // they say what changed.

  // (the project roster is loaded up top, in the one wave — see "FOUR READS, ONE WAVE")

  // BATCHED READBACK — one combined reply for a whole compound/multi-project message. Every runSingularUnit
  // COLLECTS its readback into this sink instead of sending; the finally flushes ONE message after all groups
  // ran and all asks fired. Fast path / ask-only / park exits populate nothing → the flush is a no-op there.
  const sink: ReadbackSink = { entries: [], resolvedRefs: [] }
  // SERIALIZED ASKS — every runSingularUnit ENQUEUES its which_item asks here instead of sending them; after
  // all groups have run, exactly ONE ask goes out and the rest ride its slots (the drain cursor). Without this
  // pool each ask overwrote the last one's conversation, so only the final question was answerable.
  const askQueue: PendingItemAsk[] = []
  // …and the which_project asks a UNIT raised (a new item the resolver could not site). They ride the SAME
  // cursor as an unresolved decompose group — asked first, carrying the item asks — so no ask can clobber
  // another (see PendingProjectAsk).
  const projectAskQueue: PendingProjectAsk[] = []
  const pname = (id: string | null | undefined): string | null => projects.find((p) => p.id === id)?.name ?? null
  // A unit's deferred which_project ask, in the shape askProjectGroups speaks (the proven siteops_project pick).
  const projAskGroup = (a: PendingProjectAsk): AskGroup => ({
    messages: [a.item.text], nameTried: a.item.project_hint ?? null,
    candidates: projects.map((p) => ({ id: p.id, name: p.name })),
    specs: [{ text: a.item.text, type: 'issue', structure: a.item.structure ?? null }],
  })
  try {

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
    // STEP B — the authored QC checks for the shortlisted work, and the map code disposes a FAILURE through.
    let qcChecks: string[] = []
    let qcById = new Map<string, QcCheckRef>()
    let groundedProjectId: string | null = null
    let groundedProjectName: string | null = null
    try {
      const pre = await resolveProject(ctx.supabase, ctx.orgId, { narration: ctx.image.caption ?? '', nameHint: null })
      if (pre.projectId) {
        groundedProjectId = pre.projectId
        groundedProjectName = pre.projectName ?? null
        // …and the SAME heal before the grounding read: the shortlist we show the vision pass, and the QC
        // checks we ask it to grade, are drawn from these rows. Grounding a photo against dead work is how
        // a misread starts. (Memoised — the unit below reuses this call, it does not repeat it.)
        await ensureProjectFresh(ctx, pre.projectId)
        const cands = await loadCandidates(ctx.supabase, ctx.orgId, pre.projectId, batch?.items ?? [])
        const shortlist = prefilterCandidates(cands, ctx.image.caption ?? '')
        groundingHints = groundingLabels(shortlist)
        const qc = await loadQcChecks(ctx, shortlist)
        qcChecks = qc.lines
        qcById = qc.byId
        console.log(`[siteops:ground] project=${pre.projectId} candidates=${cands.length} shortlist=${groundingHints.length} qcChecks=${qcChecks.length}`)
      }
    } catch (e) { console.error('[siteops:ground] skipped:', (e as Error).message) }

    // BOTH SIGNALS, EACH LABELLED. The caption is the sender's; the description is ours. `caption || text`
    // used to drop our read of the photo the moment he typed anything — so a floor visible only in the frame
    // never reached the resolver at all. See _siteops_media.ts.
    const mediaParts: MediaParts = { caption: ctx.image.caption ?? null, description: ctx.image.description ?? null }

    let decomposed: { items: SiteItem[]; project_hint: string | null } | null = null
    try {
      decomposed = await decomposeImage(ctx.image.base64, ctx.image.mime, ctx.image.caption, projectNames, groundingHints, qcChecks, opts.callModel)
      // THE SILENT VISION NO-OP (live probe, 2026-07-11 23:01). This catch swallowed EVERYTHING, and
      // validate() folds a JSON-parse failure into `{items: []}`. So three completely different events —
      // the model errored, the model spoke and we couldn't read it, and the photo genuinely showed nothing
      // — were indistinguishable in the logs. The whole image path hangs off this call; when it returns
      // empty we degrade to the text path, quote our own auto-description back at the sender as HIS words,
      // and lose the floor. A probe could not be diagnosed. Say which one happened.
      console.log(`[siteops:vision:in] items=${decomposed?.items?.length ?? 0} hints=${groundingHints.length} qcChecks=${qcChecks.length} caption=${JSON.stringify(ctx.image.caption ?? '')}`)
      if (!decomposed?.items?.length) {
        console.error(`[siteops:vision:EMPTY] the vision pass returned NO items — model failure, unreadable response, or a genuinely empty photo. mime=${ctx.image.mime} bytes~${ctx.image.base64.length} model=${Deno.env.get('WA_SITEOPS_IMAGE_MODEL') ?? '(unset!)'}`)
      }
    } catch (e) {
      decomposed = null
      console.error('[siteops:vision:THREW]', (e as Error).message, (e as Error).stack)
    }
    // BOTH HALVES, EACH LABELLED — computed HERE, not after the no-items branch. When vision returns nothing
    // the fallback used to grade on the router's ` -- ` mush, which (a) hid whose words were whose and (b) got
    // quoted straight back at the sender as "You said: …" — with OUR auto-description inside it. Live, 23:01.
    const imgRawText = mediaComposite(mediaParts) || text

    // THE CODE FLOOR — the floor the caption (then the model, then the photo) names, on every item. Without
    // it the pin runs blind and offers every row of every matching type on every floor (the live 9-row
    // ceiling pick), when one floor leaves exactly one row and no question at all.
    // The structured items REPLACE the decomposed set — the groups (and therefore the pin) read from there.
    const items = applyMediaStructure(decomposed?.items ?? [], mediaParts)
    if (decomposed) decomposed = { ...decomposed, items }

    // ── STEP C — A CONTRADICTED CHECK *IS* THE ISSUE (code disposes) ─────────────────────────────────
    // We already know the check, the task it belongs to and whether it is CRITICAL, so there is nothing
    // left to infer: handling it here (rather than posting it through the resolver) both gets the
    // severity right and stops the resolver creating a SECOND, duplicate issue for the same defect.
    //   · critical check contradicted → a tracked, CHASED issue (the pour is about to bury it)
    //   · anything else               → a visible NOTE, recorded and never chased
    // An invented check id fails the membership guard and the item falls through to the normal path —
    // a check the model was never shown can never be marked failed.
    const qcFailures = items.filter((it) => it.qc_failed && qcById.has(it.qc_failed))
    const unitItems = items.filter((it) => !(it.qc_failed && qcById.has(it.qc_failed)))
    if (decomposed) decomposed = { ...decomposed, items: unitItems }
    // STEP A (IMAGE) — read the observation BACK before the resolve loop writes anything. The words are ours,
    // not his; he is the only one who can catch a misread, and only if we show him what we saw.
    // The readback names the project — the ONE part of the place we have actually confirmed. It does not
    // name the floor: if the floor is about to be questioned (Type 4), stating it here as fact is the
    // self-contradiction that cost the most trust in the live transcript.
    await sendReceiptAck(ctx, meta, items.length, {
      items, caption: ctx.image.caption ?? null, project: groundedProjectName, replyTo: meta.wamid,
    })
    if (qcFailures.length) {
      await applyQcFailures(ctx, qcFailures, qcById, groundedProjectId, narrationId, sink)
    }

    // T5 sub-step 5 (Gap B) — images no longer FAN OUT per-site (runMulti retired). A multi-site photo takes
    // the FIRST fragment through the unit and parks the rest pending_stage2 (runSingularUnit's `rest`),
    // uniform with the text path's interim compound rule. Stage 2 restores the per-project loop for BOTH
    // modalities at once — images must not fan out differently.

    // NO ITEMS AT ALL — resolve THE site from the caption first. A RESOLVED project runs the unit on the
    // vision line so the both-false image lands as the evidence park WITH its project (audit #1), never a
    // false receipt. Only a genuinely UNSITED photo floor-parks (project null, path kept); no photo → miss.
    if (!unitItems.length && qcFailures.length) return   // the photo's whole content WAS the QC failure — handled
    if (!items.length) {
      const proj = await resolveProject(ctx.supabase, ctx.orgId, { narration: ctx.image.caption || text, nameHint: null })
      const pid = proj.projectId; const via: string = proj.via
      // NO single-site-batch adoption for a siteless photo (the twin of the resolveGroups guard). A photo we
      // could not even read, with no site named, must not be filed onto the sender's active building off a
      // prior — pid stays null, so it falls to the caption-names-a-site ask below, else an honest evidence
      // park. (via can still be 'auto' only for a genuine single-project org — that disclosure is kept.)
      const assumed: string | undefined = via === 'auto' ? (pname(pid) ?? undefined) : undefined
      await ctx.supabase.from('site_narrations').update({ project_id: pid, decomposed: items, resolved_project_via: pid ? via : 'unresolved' }).eq('id', narrationId)
      if (pid) {
        // Grade on the MARKED COMPOSITE (his caption + our read, each attributed), never the ` -- ` mush —
        // and carry the CAPTION's own structure so a floor he named survives a vision failure.
        await runSingularUnit(ctx, {
          projectId: pid, messages: [imgRawText], batch, narrationId, callModel: opts.callModel ?? callLLM,
          assumedSite: via === 'auto' ? assumed : undefined, sink, projectName: pname(pid),
          structures: [structureFromText(ctx.image.caption ?? '')],
        })
        return
      }
      // CLAUSE 2, FOR THE IMAGE PATH (live probe, 2026-07-11). Vision read nothing from the pixels — but the
      // CAPTION is the sender's own words, and if it NAMES a site we merely failed to score, this is a
      // placeable message, not an unreadable one. ASK WHICH SITE, with the photo and the caption riding the
      // pick — exactly the rule the text path applies twenty lines below. Without it, "ASM Stilt floor" (a
      // site AND a floor, in his own words) was answered "Couldn't read that photo — kept it on your to-place
      // list", which was true of the pixels and false of the message: nothing was pending, so his next message
      // had no question to answer and the work was never tracked.
      const said = ctx.image.caption?.trim() ?? ''
      if (said && mentionsProjectToken(said, projects)) {
        await askProjectGroups(ctx, meta, [{
          messages: [said], nameTried: proj.nameTried,
          candidates: proj.suggestions ?? projects.map((p) => ({ id: p.id, name: p.name })),
          // …and the caption's OWN structure ("stilt floor" — the code floor reads it with no model at all)
          // rides the pick, so the resume PINS the row instead of re-asking a floor he already named.
          specs: [{ text: said, type: null, structure: structureFromText(said) }],
        }], narrationId, { storagePath: ctx.image.storagePath ?? null, caption: ctx.image.caption ?? null })
        return
      }
      // Nothing said and nothing read: the photo really is unreadable, and there is no question to ask. Park it
      // (never lost) and say so honestly.
      if (ctx.image.storagePath) {
        await ctx.supabase.from('siteops_unplaced').insert({
          org_id: ctx.orgId, project_id: null, reason: 'floor', observation: null,
          candidates: null, bucket: 'rough-entry-media', object_path: ctx.image.storagePath,
          caption: ctx.image.caption?.trim() || null, narration_id: narrationId, sender_number: ctx.from, created_by: null,
        })
        await say(`Couldn't read that photo — kept it on your to-place list so it isn't lost.`)
        return
      }
      if (narrationId) await ctx.supabase.from('site_narrations').update({ miss_verdict: { reason: 'nothing_extracted' } }).eq('id', narrationId)
      await say(nothingToUpdate(ctx.lang))
      return
    }

    // RESOLVE + RUN — the STAGE-2 per-project loop, image twin of the text path. Group by site (the caption
    // is the resolution hint), record narration provenance, run every RESOLVED group through the SINGULAR
    // UNIT (the photo rides the first message), and serialize UNRESOLVED groups into which_project asks
    // carrying the photo. finishRoute/routeItems are retired here — one pipeline for both modalities.
    // THE MARKED COMPOSITE — the message the resolver reads. Both halves, each attributed. (`caption || text`
    // discarded the photo's own evidence whenever a caption existed; the bare ` -- ` mush the router builds
    // hid whose claim was whose, and got quoted back to the sender as HIS words.) No caption and no
    // description → fall back to whatever the router had.
    const rawGroups = await resolveGroups(ctx, decomposed, projects, batch, imgRawText, { adoptBatch: false })
    // `single` is judged on what the photo ACTUALLY yielded (before the merge): one observation still grades on
    // the marked composite (caption + our read), exactly as before. Two observations of one scene grade on the
    // MERGED bullets, which say more than the composite's thin routing description does.
    const single = rawGroups.length === 1 && rawGroups[0].items.length === 1
    // ONE PHOTO IS ONE SCENE — two halves of the same ceiling are one thought, not two questions. Applied per
    // GROUP (a merge across sites would be a merge across places, which is what the key already forbids).
    // The ack above already showed every bullet: what we SAW is reported in full; only the ASK is one.
    const groups = rawGroups.map((g) => ({ ...g, items: mergeSameScene(g.items) }))
    const soleProject = groups.length === 1 ? groups[0].projectId : null
    await ctx.supabase.from('site_narrations').update({
      project_id: soleProject, decomposed: items,
      resolved_project_via: soleProject ? groups[0].via : (groups.length > 1 ? 'multi' : 'unresolved'),
    }).eq('id', narrationId)

    // A single-observation photo is graded on the MARKED COMPOSITE — the sender's caption and our read of the
    // image, each labelled — not on the router's ` -- ` mush (which said neither whose words were whose nor,
    // when a caption existed, anything about the photo at all).
    const imsg = (g: ProjectGroup) => (single ? [imgRawText] : g.items.map((it) => it.text))
    const pimg = ctx.image.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null
    console.log(`[siteops:vision] items=${items.length} groups=${groups.length} resolved=${groups.filter((g) => g.projectId).length}`)
    // The image path keeps its groups SEQUENTIAL: the same photo rides every group, and concurrent attachment
    // writes for one storage object are not worth the risk for a modality that rarely spans sites.
    const imgResolvedIds: string[] = []
    for (const g of groups.filter((x) => x.projectId)) {
      await runSingularUnit(ctx, {
        projectId: g.projectId!, messages: imsg(g), batch, narrationId,
        callModel: opts.callModel ?? callLLM, assumedSite: g.via === 'auto' ? g.assumedSite : undefined,
        sink, askQueue, projectAskQueue, projectName: pname(g.projectId), context: imgRawText, itemTypes: g.items.map((it) => (it.type === 'progress' || it.type === 'issue' || it.type === 'todo' ? it.type : null)), structures: g.items.map((it) => it.structure ?? null),
        qcStatements: g.items.map((it) => it.qc_statements ?? []),
        resolvedOut: imgResolvedIds,
      })
    }
    // ONE strike-off (see the text path): a per-group drop rewrites `items` from a stale in-memory snapshot.
    if (imgResolvedIds.length && batch) await dropBatchItems(ctx.supabase, batch, imgResolvedIds)
    const unresolved = groups.filter((x) => !x.projectId)
    // the project ask goes first and carries any owed item asks (one ask cursor per turn — see the text twin).
    // the decomposition rides the ask here too — a photo's caption names a floor as often as a text does,
    // and the resume's pin is just as blind without it (the text twin, same bug).
    const imgProjectAsks: AskGroup[] = [
      ...unresolved.map((g) => ({
        messages: imsg(g), nameTried: g.nameTried, candidates: g.suggestions, narration: imgRawText,
        specs: g.items.map((it, i) => ({
          text: imsg(g)[i] ?? it.text,
          type: (it.type === 'progress' || it.type === 'issue' || it.type === 'todo' ? it.type : null),
          structure: it.structure ?? null,
        })),
      })),
      ...projectAskQueue.map(projAskGroup),
    ]
    if (imgProjectAsks.length) {
      await askProjectGroups(ctx, meta, imgProjectAsks, narrationId, pimg, { sink, pendingItemAsks: askQueue })
    } else {
      await drainItemAsks(ctx, meta, askQueue, { sink })
    }
    return
  }

  // ── TEXT: THE STAGE-2 PER-PROJECT LOOP (single = array-of-one) ────────────────────────────────────
  // decompose = normalizer/splitter/project-hint source (one counted model door). Then group by site and
  // recurse the singular unit per group; unresolved groups serialize into which_project asks.
  let decomposed: { items: SiteItem[]; project_hint: string | null } | null = null
  let modelDied: DecomposeUnreadable | null = null
  try {
    // NO `?? callLLM` HERE. Passing the raw client made decompose's OWN door — the longer leash and the
    // budget sized for a nine-item narration — dead code: every voice note ran on the 15s/1200-token default
    // meant for a one-line payment text, and was cut off or timed out. Absent ⇒ decompose owns its door.
    decomposed = await decompose(text, projectNames, opts.callModel)
  } catch (e) {
    decomposed = null
    if (e instanceof DecomposeUnreadable) modelDied = e   // OUR outage, not "there was nothing in the message"
    console.error('[siteops:decompose:threw]', (e as Error).message)
  }

  // THE MODEL DIED — park and say so, and go no further. Everything below this line assumes decompose spoke:
  // the raw-text fallback would run a nine-fact, three-site narration through the unit as ONE message, and
  // the didn't-catch terminal would tell the supervisor HE was unclear. Both are lies about an outage of
  // ours. The park is the same no-drop floor resolveInbound gives its own model failures.
  if (modelDied) {
    await parkObservation(ctx, text, 'decompose_failed', narrationId, null, {
      projectId: null,
      image: ctx.image?.storagePath ? { storagePath: ctx.image.storagePath, caption: ctx.image.caption ?? null } : null,
    })
    if (narrationId) {
      // WHICH failure — 'no_response' (timeout / rate-limit / dead endpoint) vs 'unparseable' (the model
      // spoke and we could not read it — usually OUR token cap cutting it off). They need opposite fixes,
      // and the miss_verdict is where a reviewer finds out which one happened, after the fact.
      await ctx.supabase.from('site_narrations')
        .update({ miss_verdict: { reason: 'decompose_failed', cause: modelDied.cause } }).eq('id', narrationId)
    }
    console.log(`[siteops:decompose] MODEL DIED (${modelDied.cause}) — parked decompose_failed, nothing resolved`)
    await say(COULDNT_READ_THAT)
    return
  }
  const items = decomposed?.items ?? []
  // `slot` (the structure) is printed because WITHOUT IT NO TASK CAN BE PINNED — and a floor decompose never
  // extracted looks identical, from the outside, to a floor that was dropped in transit. They need opposite
  // fixes. The live 3-tiling probe could not be diagnosed without this line.
  console.log(`[siteops:decompose] items=${items.length} ${JSON.stringify(items.map((it) => ({ type: it.type, hint: it.project_hint, slot: it.structure ?? null, text: (it.text ?? '').slice(0, 60) })))}`)
  await sendReceiptAck(ctx, meta, items.length)   // STEP A — ack now (count known), before the resolve loop
  const groups = await resolveGroups(ctx, decomposed, projects, batch, text)
  console.log(`[siteops:groups] count=${groups.length} resolved=${groups.filter((g) => g.projectId).length} ${JSON.stringify(groups.map((g) => ({ project: g.projectId ? (pname(g.projectId) ?? g.projectId) : `?${g.nameTried ?? ''}`, items: g.items.length, via: g.via })))}`)

  if (!groups.length) {
    // decompose produced NO items (a closure like "tiles arrived" yields no NEW item, or the model was down).
    // Resolve THE site from the raw text and RUN it: a resolved project → runSingularUnit([text]) so
    // resolveInbound grades the update (or parks llm_unreadable on a model failure). Only a genuinely
    // unsited, content-bearing note ASKS; a truly trivial one is the honest didn't-catch. Never eat a note.
    const proj = await resolveProject(ctx.supabase, ctx.orgId, { narration: text, nameHint: null })
    let pid = proj.projectId; let via: string = proj.via; let assumed: string | undefined
    if (!pid && batch?.items?.length) {
      const pids = [...new Set(batch.items.map((b) => b.projectId).filter(Boolean))] as string[]
      if (pids.length === 1) { pid = pids[0]; via = 'auto'; assumed = projects.find((p) => p.id === pid)?.name }
    }
    await ctx.supabase.from('site_narrations').update({ project_id: pid, decomposed: items, resolved_project_via: pid ? via : 'unresolved' }).eq('id', narrationId)
    if (pid) {
      await runSingularUnit(ctx, { projectId: pid, messages: [text], batch, narrationId, callModel: opts.callModel ?? callLLM, assumedSite: via === 'auto' ? assumed : undefined, sink, projectName: pname(pid) })
      return
    }
    if (!decomposed && !mentionsProjectToken(text, projects)) {
      if (narrationId) await ctx.supabase.from('site_narrations').update({ miss_verdict: { reason: 'nothing_extracted' } }).eq('id', narrationId)
      await say(nothingToUpdate(ctx.lang))
      return
    }
    await askProjectGroups(ctx, meta, [{ messages: [text], nameTried: proj.nameTried, candidates: proj.suggestions ?? projects.map((p) => ({ id: p.id, name: p.name })) }], narrationId, null)
    return
  }

  // NARRATION provenance: a single-group narration records its site (or 'unresolved'); a genuine multi-
  // project narration is 'multi' (per-group project_id lands on each object at apply time).
  const soleProject = groups.length === 1 ? groups[0].projectId : null
  await ctx.supabase.from('site_narrations').update({
    project_id: soleProject, decomposed: items,
    resolved_project_via: soleProject ? groups[0].via : (groups.length > 1 ? 'multi' : 'unresolved'),
  }).eq('id', narrationId)

  // SINGLE narration + SINGLE item → the raw text is the message (faithful, unsplit). Any compound/multi →
  // each item's own text. Run every RESOLVED group now; serialize the UNRESOLVED into which_project asks.
  const singleItem = groups.length === 1 && groups[0].items.length === 1
  const msgsOf = (g: ProjectGroup) => (singleItem ? [text] : g.items.map((it) => it.text))
  // decompose's TYPE for each fragment, positionally aligned with the messages above. A single, unsplit
  // narration still carries its one item's type — the whole point is that the resolver stops guessing what
  // kind of statement it is looking at.
  const typesOf = (g: ProjectGroup): (('progress' | 'issue' | 'todo') | null)[] =>
    g.items.map((it) => (it.type === 'progress' || it.type === 'issue' || it.type === 'todo' ? it.type : null))
  // decompose's STRUCTURE slot per fragment (where the work is). Positionally aligned with the messages.
  const structuresOf = (g: ProjectGroup): (StructureSlot | null)[] => g.items.map((it) => it.structure ?? null)
  // STEP A — the checkable FACTS each item stated; the strict QC matcher grades the task's authored checks
  // against these. They were extracted all along and thrown away at the apply.
  const qcOf = (g: ProjectGroup): string[][] => g.items.map((it) => it.qc_statements ?? [])
  // The same two facts, PACKED for a which_project ask's slots (the resume has no decompose to re-run — and
  // must not: re-extracting would be a second model call AND a second chance to read the message differently).
  // `messages` is passed in because the single-item path sends the RAW text, not the item's split text.
  const specsOf = (g: ProjectGroup, messages: string[]): AskItemSpec[] =>
    g.items.map((it, i) => ({ text: messages[i] ?? it.text, type: typesOf(g)[i] ?? null, structure: it.structure ?? null }))

  // PROJECT GROUPS RUN CONCURRENTLY. Different projects touch DISJOINT rows — different site_tasks, problems
  // and todos — so there is nothing to serialize between them. On the live 5-item probe a group cost ~1.4s of
  // candidate loading plus ~2s per item of model time; two sites paid that twice, in series, for nothing.
  //
  // ORDER IS PRESERVED WHERE IT IS OBSERVABLE. Each group fills its OWN sink and ask queue, and they are
  // merged back in GROUP order after every group finishes — never in completion order. The readback's per-site
  // sections and the ask drain both depend on that: the drain's contract is that the offered order is the
  // stored order.
  const resolvedGroups = groups.filter((x) => x.projectId)
  const perGroup = await Promise.all(resolvedGroups.map(async (g) => {
    const gSink: ReadbackSink = { entries: [], resolvedRefs: [] }
    const gAsks: PendingItemAsk[] = []
    const gProjAsks: PendingProjectAsk[] = []
    const gResolved: string[] = []
    await runSingularUnit(ctx, {
      projectId: g.projectId!, messages: msgsOf(g), batch, narrationId,
      callModel: opts.callModel ?? callLLM, assumedSite: g.via === 'auto' ? g.assumedSite : undefined,
      sink: gSink, askQueue: gAsks, projectAskQueue: gProjAsks,
      projectName: pname(g.projectId), context: text, itemTypes: typesOf(g), structures: structuresOf(g),
      qcStatements: qcOf(g),
      resolvedOut: gResolved,
    })
    return { gSink, gAsks, gProjAsks, gResolved }
  }))
  const groupResolvedIds: string[] = []
  for (const r of perGroup) {
    sink.entries.push(...r.gSink.entries)
    sink.resolvedRefs.push(...r.gSink.resolvedRefs)
    askQueue.push(...r.gAsks)
    projectAskQueue.push(...r.gProjAsks)
    groupResolvedIds.push(...r.gResolved)
  }
  // ONE strike-off for the whole turn. dropBatchItems rewrites `items` from the caller's in-memory snapshot,
  // so a per-group call would write "everything except MY resolves" and resurrect its sibling's strike-offs.
  if (groupResolvedIds.length && batch) await dropBatchItems(ctx.supabase, batch, groupResolvedIds)
  const unresolved = groups.filter((x) => !x.projectId)
  // ONE ask cursor per turn. Every which_project ask — an unresolved decompose GROUP, or one a resolved
  // group's unit raised on an item it could not site — goes out FIRST (a site is a prerequisite for anything
  // else), carrying the owed which_item asks in its slots; its resume drains them. Opening two would clobber:
  // openConversation upserts the single OPEN conversation per (org, sender).
  // STEP C2c — pass the sink so a which_project ask also HOLDS the turn's resolved summary (folded on answer).
  const projectAsks: AskGroup[] = [
    ...unresolved.map((g) => ({
      messages: msgsOf(g), nameTried: g.nameTried, candidates: g.suggestions,
      specs: specsOf(g, msgsOf(g)), narration: text,     // the decomposition rides the ask → the resume is not blind
    })),
    ...projectAskQueue.map(projAskGroup),
  ]
  if (projectAsks.length) {
    await askProjectGroups(ctx, meta, projectAsks, narrationId, null, { sink, pendingItemAsks: askQueue })
  } else {
    // DRAIN — ask the first owed which_item question; the rest ride its slots. The sink is threaded so
    // flushOrHoldReadback HOLDS this turn's summary on the ask instead of sending it alongside.
    await drainItemAsks(ctx, meta, askQueue, { sink })
  }

  } finally {
    // ONE combined reply for everything that resolved this turn (asks already went out inline). STEP C1/C2c —
    // if a which_item OR which_project ask is open, HOLD the summary on it (the resume folds it into one readback).
    await flushOrHoldReadback(ctx, sink, meta)
  }
}

/** THE ASK — serialized across groups (the drain cursor). Ask "which project?" for the FIRST unresolved
 *  group and carry the REMAINING groups in the pick's slots, so the answer resumes the drain
 *  (answerSiteops → siteops_project). The list SHOWN is the list STORED (pre-sorted by match confidence, so
 *  the likeliest site is row 1). The observation rides the body AND the slots (`messages`), so the resume
 *  runs the singular unit's remainder from slots — no re-extraction, validated against the OFFERED list. */
// THE DECOMPOSITION RIDES THE ASK (2026-07-11). `messages` alone was never enough: decompose also learned WHAT
// each fragment is (progress/issue/todo) and WHERE the work is (the structure slot — the ONLY place a floor or
// unit is captured). The resume re-ran the unit with neither, so on every project-disambiguated message the
// task pin had no floor, the untracked-work terminal couldn't fire, and the full-narration background was gone.
// `specs` carries them, positionally aligned with `messages`; `narration` is the raw message (the context
// block). Both are plain JSON — they ride the conversation slots and come back on the answer.
interface AskItemSpec { text: string; type: 'progress' | 'issue' | 'todo' | null; structure: StructureSlot | null }
interface AskGroup { messages: string[]; nameTried: string | null; candidates: { id: string; name: string }[]; specs?: AskItemSpec[]; narration?: string | null }
async function askProjectGroups(
  ctx: SiteopsCtx, meta: Record<string, unknown>, groups: AskGroup[], narrationId: string | null,
  image?: { storagePath?: string | null; caption?: string | null } | null,
  // STEP C2c — `sink`: record this which_project ask so flushOrHoldReadback HOLDS the turn's resolved summary
  // onto it (like askItemPick). `heldEntries`: carry an already-accumulated held summary forward across the
  // drain (a serialized which_project resume re-asks the next group and threads held so the fold lands last).
  // `pendingItemAsks`: which_item asks owed from THIS turn's resolved groups. Only ONE conversation can be
  // open per sender, so they ride the project pick's slots and drain after it resolves.
  opts: { sink?: ReadbackSink; heldEntries?: { project: string | null; body: string }[]; pendingItemAsks?: PendingItemAsk[] } = {},
): Promise<void> {
  const g = groups[0]
  const pending = groups.slice(1)
  // AUDIT #2 — the question CARRIES the observation in its TEXT, not just the slots: the supervisor must
  // see WHAT is being sited before picking, or a stale question reads as a context-free "which project?".
  // ONE LINE, NEVER OUR READ. For a PHOTO the observation is OURS — a routing description (single item, a
  // <photo>…</photo> composite) or the vision read (multi item). Quoting it back put our paragraph in his
  // mouth AND leaked the markers. So a photo quotes only HIS caption; no caption → "your photo". Plain text
  // is his own words and passes through exactly as before.
  const isPhoto = !!image?.storagePath
  const caption = (image?.caption ?? '').trim()
  const obs = isPhoto
    ? (caption ? `"${caption}"` : 'your photo')
    : g.messages[0]
      ? `"${g.messages[0]}"${g.messages.length > 1 ? ` (+${g.messages.length - 1} more)` : ''}`
      : 'your site note'
  const body = g.nameTried
    ? `I couldn't find a project called "${g.nameTried}". Which project is ${obs} for?`
    : `Got ${obs} — which project is it for?`
  const pickList = g.candidates.slice(0, 10)
  const img = image?.storagePath ? { storagePath: image.storagePath, caption: image.caption ?? null } : null
  const slots = {
    kind: 'siteops_project', messages: g.messages, candidates: pickList, nameTried: g.nameTried,
    pending_groups: pending, narration_id: narrationId, image: img,
    ask_body: body,   // the question as ASKED — a re-surface replays it, never a re-render (see askItemPick)
    // THE DECOMPOSITION — what each message IS and WHERE its work is, so the resume resolves with the same
    // knowledge the fresh path had. Without these the pin runs blind (see AskItemSpec).
    ...(g.specs?.length ? { items: g.specs } : {}),
    ...(g.narration ? { narration_text: g.narration } : {}),
    ...(opts.pendingItemAsks?.length ? { pending_item_asks: opts.pendingItemAsks } : {}),
    ...(opts.heldEntries?.length ? { held_readback: { entries: opts.heldEntries, resolvedRefs: [] } satisfies HeldReadback } : {}),
  }
  await openConversation(ctx.supabase, {
    orgId: ctx.orgId, sender: ctx.from, owningAgent: 'SITEOPS',
    pendingQuestion: 'which project?', slots, lastMessageId: ctx.wamid,
  })
  if (opts.sink) { opts.sink.askSlots = slots; opts.sink.askQuestion = { pendingQuestion: 'which project?', lastMessageId: ctx.wamid } }
  await sendNowDurable(ctx.supabase, ctx.from, {
    kind: 'list',
    body,
    button: 'Pick project',
    rows: pickList.map((c: { name: string }, i: number) => ({ id: `pick:${i + 1}`, title: c.name.slice(0, 24) })),
  }, meta)
}

/** Route ONE project's items → write + return its outcome (no send; the multi confirm composes). */
async function routeGroup(ctx: SiteopsCtx, projectId: string, items: SiteItem[], narrationId: string | null): Promise<RouteOutcome> {
  const vm = await materializeProjectTasks(ctx, projectId)
  const { data: taskRows } = await ctx.supabase.from('site_tasks').select(TASK_COLS).eq('project_id', projectId)
  const rawRows = (taskRows ?? []) as SiteTaskRow[]
  const tasks = engineTasks(rawRows)
  console.log(`[siteops:dbg:load] (multi) project=${projectId} rawRows=${rawRows.length} engineRows=${rawRows.filter((t) => t.node_key).length} flatRows=${rawRows.filter((t) => !t.node_key).length} usedForMatch=${tasks.length} vmNodeKeys=${vm.keys.size}`)
  const oc = await ownerCtx(ctx.supabase, ctx.orgId, projectId)
  const rc: RouteCtx = { supabase: ctx.supabase, orgId: ctx.orgId, projectId, byLabel: ctx.from, ...oc, narrationId, now: new Date(), vmNodeKeys: vm.keys, vmTaskNames: vm.names }
  return await routeItems(rc, tasks, items)
}

// DELETED (2026-07-11): judgePending — the "answer-or-let-go" LLM guess consulted after a pick failed to
// match. Both its outcomes lost the message ('letgo' dropped it, 'answer' nagged), and guessing the user's
// intent from a single reply is exactly what the AGENT-AGNOSTIC pending-credibility design removes: a
// non-matching reply is simply NOT AN ANSWER (return 'not_an_answer'), and the DISPATCHER decides the
// pending question's fate uniformly — re-surface with a Dismiss button, or drop with a notice. Dismissal is
// a structural button tap, never a meaning-guess. Nothing to maintain, nothing to mis-judge.

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
    await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: n ? `Dismissed — pulled ${n} item${n > 1 ? 's' : ''} back out (the photo/record stays). 👍` : `Noted 👍` }, meta)
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
    if (n) await sendNowDurable(supabase, p.from, { kind: 'text', body: `Dismissed — pulled ${n} item${n > 1 ? 's' : ''} back out (the record stays). 👍` }, { org_id: p.orgId })
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
    // 'todo' is a legacy ref kind — the row it names is a problems row now (a planned snag), so both
    // land in the same place. Keeping the kind name costs nothing; sending it to another table costs
    // the retraction.
    if (r.kind === 'problem' || r.kind === 'todo') ({ error: err } = await supabase.from('problems').update({ status: 'DISMISSED' }).eq('id', r.id))
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
    await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `That one's on your to-place list — open it in the app to sort it.` }, meta)
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
  if (isBareAffirmation(text)) { await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: 'Got it 👍' }, meta); return }

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
    // both kinds are problems rows now — one read, one write, one deadline column
    const res = await ctx.supabase.from('problems').select('cause, deadline').eq('id', r.id).maybeSingle()
    const row = res.data as Record<string, string | null> | null
    if (!row) continue
    const plan = planCorrection(
      { kind, cause: row.cause ?? null, deadline: row.deadline ?? null },
      sig, now,
    )
    if (!plan.changed) continue
    const upd: Record<string, string> = {}
    if (plan.updates.cause) upd.cause = plan.updates.cause
    if (plan.updates.deadline) upd.deadline = plan.updates.deadline
    if (Object.keys(upd).length) await ctx.supabase.from('problems').update(upd).eq('id', r.id)
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
  await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body }, meta)
}

/** Resume a pending SITEOPS follow-up — a project pick OR a task disambiguation. */
/**
 * 'not_an_answer' — the reply resolved to NONE of the frozen offered list, so it was never an answer to our
 * question. The pending piece is parked (nothing dropped) and the DISPATCHER re-classifies the message as a
 * fresh turn. Anything else returns void ('handled'). The dispatcher owns re-entry so siteops never has to
 * import _dispatch (which imports siteops) — a return value, not a cycle.
 */
export type AnswerVerdict = 'not_an_answer' | void

export async function answerSiteops(ctx: SiteopsCtx, text: string, convo: ConvoRow, opts: { callModel?: (system: string, user: string) => Promise<string> } = {}): Promise<AnswerVerdict> {
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
    await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: trailed ? `Added your note to what I logged from the photo. 👍` : `Noted with the photo. 👍` }, meta)
    return
  }

  // ── B3 same-cause collision → the supervisor named the site for the held item ──
  if (slots.kind === 'siteops_batch_collision') {
    const cands = (slots.candidates ?? []) as { id: string; kind: 'issue' | 'todo' | 'task'; orgId: string; projectId?: string | null; projectName: string; title: string; cause: string | null }[]
    // Resolve the reply BY MEANING against the STORED offered list — clause 2 (validate against the offered
    // list, never re-derive from the reply). resolveTypedPick is the SAME resolver the typed-pick ask uses:
    // a visible number → that offered row (display order == stored order), a typed label → the matching item
    // (shortlist == full here), "new"/none → a fresh observation. No positional index into a re-ranked list,
    // no bare-integer demand — the heuristic the sprint sequence deleted, gone from this resume too.
    // label = the FULL title (NOT shortLabel) so resolveTypedPick matches a natural answer against the whole
    // name — "Fourth floor" resolves "Wiring — Fourth floor", which the 3-token display label had truncated.
    const picks: PickCandidate[] = cands.map((c) => ({ kind: c.kind, id: c.id, label: c.title }))
    // A TAP is unambiguous by construction — the row carries its POSITION as its id (`pick:N`), and the stored
    // order is the displayed order. Resolve it as that number and skip the text matcher entirely: a row TITLE
    // is a human label, never a resolution key. It cannot be one: the tiling tie's third row is the bare word
    // "Tiling", which is a substring of "Floor tiling" AND "Wall tiling / dado" — matching that text would be
    // ambiguous (correctly) and re-prompt a supervisor who had already answered.
    const tapped = /^pick:(\d+)$/.exec((ctx.interactiveId ?? '').trim())?.[1] ?? null
    let picked = resolveTypedPick(picks, picks, tapped ?? text)

    // ── THE LEXICAL MATCHER CANNOT READ TELUGU (2026-07-13) ────────────────────────────────────────────
    // resolveTypedPick tokenizes with /[a-z0-9]{3,}/g. A Telugu-script reply yields ZERO tokens, so it can
    // never match — and our supervisors answer in Telugu. Live: we offered one option ("Plumbing — in-wall
    // lines") and he replied "ఎలక్ట్రికల్ గార్డలు తీసాం, ప్లంబింగ్ గార్డలు కాదు" — the electrical ones, not the
    // plumbing. A perfect answer. It matched nothing, was re-read as a fresh narration, and decompose turned
    // his negation into a NEW ISSUE: "plumbing guards not removed". We invented a defect out of a correction.
    //
    // So when the lexical pass finds nothing, ask the model what he meant — bounded to the ids we offered,
    // failing CLOSED to not_an_answer. A TAP never comes here (it is unambiguous by construction), so this
    // costs a call only on a reply we had already given up on.
    if (picked.kind === 'none' && !tapped) {
      const reading = await interpretPickReply((slots.ask_body as string | null) ?? 'Which item is this about?', picks, text)
      if (reading.kind === 'pick') picked = { kind: 'attach', target: reading.target }
      else if (reading.kind === 'new') picked = { kind: 'observe' }
      else if (reading.kind === 'none') picked = { kind: 'park' }
      // 'not_an_answer' → leave `picked` as 'none' and fall through to the dispatcher's fresh-turn path
      // below, UNCHANGED. That path exists because a ₹25,000 payment once arrived mid-pick and was dropped;
      // it stays exactly as it is.
    }
    // "None of these" — the offered list is wrong, and the right row may not EXIST (the fifth-floor wiring
    // task nobody created). Creating a duplicate would be the wrong repair, so the piece is saved for review
    // and NOTHING changes. This is the option every pick now spells out.
    if (picked.kind === 'park') {
      const pieceText = (slots.piece_text as string | null) ?? text
      await parkObservation(ctx, pieceText, 'disambig', (slots.narration_id as string | null) ?? null, null,
        { projectId: (slots.project_id as string | null) ?? null, image: (slots.image ?? null) as { storagePath?: string; caption?: string | null } | null })
      await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'saved for review' })
      await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `Understood — I've changed nothing and saved it for review:
"${pieceText}"

` + `If the right task isn't set up yet, add it in the app and tell me again.` }, meta)
      await finishItemAsk(ctx, meta, slots, null)
      return
    }
    if (picked.kind === 'observe') {
      // "new"/none → route the piece FRESH to the project; never force a genuinely-new observation onto a chase.
      const pid = (slots.project_id as string | null) ?? cands[0]?.projectId ?? null
      const pieceText = (slots.piece_text as string | null) ?? text
      await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
      if (!pid) {
        await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `Got it — send that as a new update with the site and I'll log it.` }, meta)
        await finishItemAsk(ctx, meta, slots, null)   // still move the cursor — the other asks are not this one's fault
        return
      }
      const dec = await decompose(pieceText).catch(() => ({ items: [] as SiteItem[], project_hint: null }))
      const items = dec.items.length ? dec.items
        : [{ type: 'issue', text: pieceText, task_hint: null, qc_statements: [], cause: 'other', cause_reason: null, owner_hint: null, date_hint: null, project_hint: null } as SiteItem]
      const out = await routeGroup(ctx, pid, items, (slots.narration_id as string | null) ?? null)
      const cimg = slots.image as { storagePath?: string; caption?: string | null } | null
      if (cimg?.storagePath) {
        for (const p of out.problems) if (p.id) await attachImage(ctx, 'problem', p.id, cimg.storagePath, cimg.caption ?? null, 'creation')
        for (const td of out.todos) if (td.id) await attachImage(ctx, 'problem', td.id, cimg.storagePath, cimg.caption ?? null, 'creation')
      }
      const n = out.problems.length + out.todos.length + out.progress.length
      await finishItemAsk(ctx, meta, slots, { project: null, body: n ? `Logged as new — *${fullText(pieceText)}*. 👍` : `Noted 👍` })
      return
    }
    const chosen = picked.kind === 'attach' ? cands.find((c) => c.id === picked.target.id) ?? null : null
    if (!chosen) {
      // NOT AN ANSWER. The offered list is FROZEN and it just told us this reply resolves to none of it —
      // that is a fact, not something to ask a model about. `judgePending` used to guess here, and both of
      // its branches lost the message: 'letgo' replied "No problem" and dropped it, the other nagged.
      //
      // LIVE FAILURE (2026-07-09): with a which_item ask open, "రాజుకి పాతికి వేలు ఇచ్చాను" (I gave Raju
      // twenty-five thousand) was routed ANSWERS_PENDING/SITEOPS by the router, failed to match any offered
      // item — correctly — and was then answered "No problem — I'll check back on it next time." A ₹25,000
      // payment, gone. Two slab-completion reports went the same way.
      //
      // AGENT-AGNOSTIC PENDING CREDIBILITY (2026-07-11): the answer handler does NOTHING here but report the
      // fact. It does NOT park, close, or touch state. The DISPATCHER owns the pending question's fate — it
      // stashes P, handles this message as a fresh turn, then RE-SURFACES P (with a Dismiss button) or DROPS
      // it with a notice if the fresh turn raised its own question. Same uniform machinery for every agent.
      console.log(`[siteops:pick:not-an-answer] piece=${JSON.stringify(slots.piece_text ?? '')} reply=${JSON.stringify(text)} → dispatcher stashes + re-surfaces`)
      return 'not_an_answer'
    }
    // A TASK confirm (the parking lesson): the supervisor confirmed a med/low task match — apply the
    // progress via the proven by-id core (twin-aware guardrail intact), attach the carried photo, and
    // read back "updated". A refused/gone row parks honestly — never a silent close.
    if (chosen.kind === 'task') {
      const pieceText = (slots.piece_text as string | null) ?? text
      const narrId = (slots.narration_id as string | null) ?? null
      const projId = (slots.project_id as string | null) ?? chosen.projectId ?? null
      // A confirmed BLOCKED pick records the blocker; it must NEVER reach applyProgress. The held verdict says
      // which — "tiles not yet laid → that one" confirms the TARGET, never that the work happened.
      const heldTask = slots.update as AttachUpdate | null | undefined
      const blocked = heldTask?.action === 'blocked'
      // THE PICK IS THE MISSING CONFIDENCE. He read the row and tapped it, so WHICH task is now certain — the
      // exact thing the fresh ladder needed to close. So closure is authorized iff the held update was an
      // explicit-closure resolve (action='resolve' + closure_explicit) — the SAME rule landTask applies once a
      // task is high-confidence, and the twin of the issue/todo pick just below (which re-runs the ladder at
      // confidence:'high'). Without this the pick could NEVER close: a picked "అయిపోయింది / finished" stayed at
      // in-progress no matter how plainly he said it (closureAuthorized was hard-coded false here — the bug). A
      // verdict-less slot (pre-T3 fossil) carries no held update → false, exactly as the issue path force-addresses.
      const closeOk = heldTask?.action === 'resolve' && heldTask?.closure_explicit === true
      // GAP 1 — the checkable facts the ORIGINAL message stated ride the slots; apply them here, where we
      // finally know WHICH task they belong to. Without this the ask path silently discarded every piece of
      // QC evidence — and the ask path is the one an ambiguous photo of slab steel always takes.
      const qcStatements = (slots.qc_statements as string[] | undefined) ?? []
      const label = blocked
        ? await applyTaskBlockedById(ctx, chosen.id, heldTask?.reason || pieceText)
        : await applyTaskProgressById(ctx, chosen.id, pieceText, narrId, new Date(), projId, closeOk, undefined,
            { statements: qcStatements, call: opts.callModel ?? callLLM })
      const cimg = slots.image as { storagePath?: string; caption?: string | null } | null
      if (label && cimg?.storagePath) await attachImage(ctx, 'site_task', chosen.id, cimg.storagePath, cimg.caption ?? null, 'creation')
      await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
      if (label) {
        const body = blocked
          ? `⏳ “${label}” still open — noted, chasing sooner — ${chosen.projectName}`
          : closeOk
            ? `✓ “${label}” done — ${chosen.projectName}`
            : `✓ “${label}” updated — ${chosen.projectName}`
        await finishItemAsk(ctx, meta, slots, { project: chosen.projectName, body })
      } else {
        await parkObservation(ctx, `update ${chosen.id}: ${pieceText}`, 'v2_effect_failed', narrId, null, { projectId: projId, image: cimg })
        await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `Couldn't update “${fullText(chosen.title)}” just now — saved it for review so nothing's lost.` }, meta)
        await finishItemAsk(ctx, meta, slots, null)   // a failed effect still moves the cursor — never strand the rest
      }
      return
    }
    const now = new Date()
    const cadenceMap = await loadCadenceMap(ctx.supabase, ctx.orgId)
    const actorId = await senderUserId(ctx)
    const item: BatchItem = { kind: chosen.kind, id: chosen.id, orgId: chosen.orgId, projectId: null, projectName: chosen.projectName, title: chosen.title, taskName: null, cause: chosen.cause }
    // T3 — the LADDER is the SOLE authority. The confirm upgrades WHICH item (target fixed, match → high),
    // never WHETHER it closed. Re-enter the one authority (executeResolution) with the held update so the
    // ladder rules the disposition and the executor simply applies it (there is no second opinion). A
    // verdict-less slot (pre-T3 stamp / fossil) carries no held update → FORCE ADDRESSING: no stored
    // closure_explicit is no proof of closure, and a confirm never answers "is it closed" (Q1).
    // A held BLOCKED verdict survives the confirm: the pick fixed WHICH item, not whether the work happened.
    const held = slots.update as AttachUpdate | null | undefined
    const applied: 'resolve' | 'addressing' | 'blocked' = held
      ? (executeResolution(
          { issue_snag_found: { found: false, items: [] }, update_found: { found: true, updates: [{ ...held, target_id: chosen.id, confidence: 'high' }] } },
          { candidateIds: new Set([chosen.id]), isImage: false },
        ).find((tt): tt is Extract<Terminal, { kind: 'object_updated' }> => tt.kind === 'object_updated')?.applied ?? 'addressing')
      : 'addressing'
    const verdict = await applyBatchResolution(
      ctx, item, applied, slots.piece_text ?? text, cadenceMap, actorId, now,
      { reason: held?.reason ?? (slots.piece_text as string | null) ?? '' },
    )
    // STEP 3: if the colliding message was a PHOTO (carried in slots), attach it to the chosen item now.
    const cimg = slots.image as { storagePath?: string; caption?: string | null } | null
    if (cimg?.storagePath) await answerWithPhoto(ctx, { kind: item.kind, id: item.id, orgId: item.orgId }, cimg.storagePath, cimg.caption ?? null)
    const batch = await getOpenBatch(ctx.supabase, ctx.orgId, ctx.from)
    if (batch) await dropBatchItems(ctx.supabase, batch, [chosen.id])
    await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
    await finishItemAsk(ctx, meta, slots, { project: chosen.projectName, body: `${readbackPart(item, verdict)} — ${chosen.projectName}` })
    return
  }

  // ── STEP 3: multi-item chase reply was a PHOTO with no clear match → supervisor picks which item
  //    it's about; attach the carried photo to that item (never fresh). ──
  if (slots.kind === 'siteops_photo_pick') {
    const cands = (slots.candidates ?? []) as { id: string; kind: 'issue' | 'todo'; orgId: string; title: string }[]
    const img = (slots.image ?? {}) as { storagePath?: string; caption?: string | null }
    const t = text.trim().toLowerCase()
    const m = text.match(/(\d+)/)
    const idx = m ? parseInt(m[1], 10) - 1 : cands.findIndex((c) => fullText(c.title).toLowerCase().includes(t) && t.length >= 3)
    const chosen = idx >= 0 && idx < cands.length ? cands[idx] : null
    if (!chosen) {
      // Not one of the offered items → not an answer. Dispatcher stashes P + re-surfaces/drops (agent-agnostic).
      return 'not_an_answer'
    }
    if (!img.storagePath) {
      await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `Reply with the number of the item this photo is about.` }, meta)
      return
    }
    await answerWithPhoto(ctx, { kind: chosen.kind, id: chosen.id, orgId: chosen.orgId }, img.storagePath, img.caption ?? null)
    await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'photo attached' })
    await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `Added your photo to *${fullText(chosen.title)}*.` }, meta)
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
      // Resolves to none of the offered items → not an answer. Dispatcher stashes P + re-surfaces/drops.
      return 'not_an_answer'
    }
    if (d.kind === 'attach') {
      if (img.storagePath) await attachExistingEvidence(ctx, { kind: d.target.kind, id: d.target.id }, img.storagePath, img.caption ?? null)
      await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'photo attached' })
      await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `Added your photo to *${fullText(d.target.label)}*.` }, meta)
      return
    }
    // observe — create the held item fresh, attach the photo as creation evidence, confirm.
    // A place_photo pick holds NO item (the model found nothing to create) — "None — just save it"
    // lands the photo on the honest evidence park (photo carried from slots), never a routeGroup crash.
    if (!storedItem) {
      await parkObservation(ctx, 'photo evidence', 'evidence_await_placement', (slots.narration_id as string | null) ?? null, null, { projectId: (slots.project_id as string | null) ?? null, image: img })
      await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'photo parked' })
      await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `Saved the photo to your to-place list. 👍` }, meta)
      return
    }
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
    const pending = (slots.pending_groups ?? []) as AskGroup[]
    const t = text.trim().toLowerCase()
    const m = text.match(/(\d+)/)
    const idx = m ? parseInt(m[1], 10) - 1
      : candidates.findIndex((c) => { const n = c.name.toLowerCase(); return n === t || (n.includes(t) && t.length >= 3) || (t.includes(n) && n.length >= 3) })
    const chosen = idx >= 0 && idx < candidates.length ? candidates[idx] : null
    if (!chosen) {
      // Not a project pick → not an answer. The answer handler touches NOTHING: the DISPATCHER stashes this
      // convo (its slots — incl. the pending_groups drain — ride the closed row) and RE-SURFACES it after the
      // fresh turn, or DROPS it with a notice if that turn raised its own question. No judgePending guess.
      return 'not_an_answer'
    }
    if (slots.narration_id) {
      await ctx.supabase.from('site_narrations').update({ project_id: chosen.id, resolved_project_via: 'selected' }).eq('id', slots.narration_id)
    }
    // The project is ALREADY picked — run its message(s) through the SINGULAR UNIT, NAMING the project in
    // each so a CREATE (planObserve asks which_project on a null project_hint) lands on the picked site
    // instead of re-asking. The carried photo (slots.image) is RE-HYDRATED onto the ctx so it RIDES the
    // unit's terminals. No re-extraction — the stored messages ARE the observation (journey (c) counts calls).
    // Back-compat: an in-flight LEGACY convo (pre-Stage-2) carries slots.items/slots.text, not messages.
    // THE DECOMPOSITION, restored. `specs` (new) carries each message's TYPE and STRUCTURE slot; without it the
    // pin has no floor and re-asks a question the supervisor already answered. A legacy in-flight convo (opened
    // before this shipped) has no specs and degrades to exactly the old behaviour — never a crash, just blind.
    // NB `slots.items` is the LEGACY SiteItem[] shape (pre-Stage-2 convos); `specs` rides `slots.items` too but
    // is distinguished by carrying `structure`/`type` — read it defensively.
    const specs = ((slots.items ?? []) as AskItemSpec[]).filter((s) => s && typeof s.text === 'string' && ('structure' in s || 'type' in s))
    const rawMsgs = specs.length ? specs.map((s) => s.text)
      : ((slots.messages ?? null) as string[] | null)
      ?? [typeof slots.text === 'string' ? slots.text : (((slots.items ?? []) as SiteItem[])[0]?.text ?? text)]
    const named = rawMsgs.map((mm) => `${chosen.name}: ${mm}`)
    const pimg = (slots.image ?? null) as { storagePath?: string; caption?: string | null } | null
    const rctx: SiteopsCtx = pimg?.storagePath ? { ...ctx, image: { base64: '', mime: '', caption: pimg.caption ?? '', storagePath: pimg.storagePath } } : ctx
    const batch = await getOpenBatch(ctx.supabase, ctx.orgId, ctx.from)
    await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
    // STEP C2c — run THIS group into a sink (batched) so its outcome FOLDS with any held summary instead of
    // sending inline; carry the accumulated summary forward across the drain, flushing only when it's the last.
    const held = ((slots.held_readback ?? null) as HeldReadback | null)
    const rsink: ReadbackSink = { entries: [], resolvedRefs: [] }
    // item asks owed from EARLIER groups ride the slots; this group may add its own. Both drain below.
    const itemAsks = [...((slots.pending_item_asks ?? []) as PendingItemAsk[])]
    await runSingularUnit(rctx, {
      projectId: chosen.id, messages: named, batch,
      narrationId: slots.narration_id ?? null, callModel: opts.callModel ?? callLLM,
      sink: rsink, askQueue: itemAsks, projectName: chosen.name,
      // …and the resume resolves with everything the fresh path knew: WHERE the work is (the pin), WHAT each
      // fragment is (the honest untracked-work terminal), and the WHOLE narration as background.
      context: ((slots.narration_text ?? null) as string | null) ?? rawMsgs.join(' '),
      itemTypes: specs.length ? specs.map((s) => s.type ?? null) : undefined,
      structures: specs.length ? specs.map((s) => s.structure ?? null) : undefined,
    })
    const acc = [...(held?.entries ?? []), ...rsink.entries]
    if (pending.length) {
      // DRAIN — ask the next unresolved group, threading the accumulated summary so the fold lands on the LAST
      // answer, and carrying the item asks forward (a site is a prerequisite; items are sorted out after).
      await askProjectGroups(ctx, meta, pending, slots.narration_id ?? null, null, { heldEntries: acc, pendingItemAsks: itemAsks })
    } else if (await drainItemAsks(ctx, meta, itemAsks, { heldEntries: acc, heldRefs: rsink.resolvedRefs })) {
      // every project is sited; now sort out the ambiguous items, one question at a time (the ask holds `acc`).
    } else if (acc.length) {
      await sendNowDurable(ctx.supabase, ctx.from, composeConfirmation(acc, rsink.resolvedRefs), meta)
    }
    return
  }

  if (slots.kind !== 'siteops_disambig') {
    await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site note' })
    await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: 'Okay.' }, meta)
    return
  }
  const candidates = (slots.candidates ?? []) as { task_id: string; node_key?: string | null; name: string; floor: string | null; unit: string | null }[]
  const m = text.match(/(\d+)/)
  const pickIdx = m ? parseInt(m[1], 10) - 1 : candidates.findIndex((c) => c.name.toLowerCase() === text.trim().toLowerCase())
  const chosen = pickIdx >= 0 ? candidates[pickIdx] : null
  if (!chosen) {
    // Not one of the offered tasks → not an answer. Dispatcher stashes P + re-surfaces/drops (agent-agnostic).
    return 'not_an_answer'
  }

  const vm = await materializeProjectTasks(ctx, slots.project_id)
  const { data: taskRows } = await ctx.supabase.from('site_tasks').select(TASK_COLS).eq('task_id', chosen.task_id)
  const task = (taskRows ?? [])[0] as SiteTaskRow | undefined
  console.log(`[siteops:dbg:resume-pick] task_id=${chosen.task_id} node_key=${task?.node_key ?? 'NULL'} visibleInVM=${!!(task?.node_key && vm.keys.has(task.node_key))}`)
  const oc = await ownerCtx(ctx.supabase, ctx.orgId, slots.project_id)
  const rc: RouteCtx = { supabase: ctx.supabase, orgId: ctx.orgId, projectId: slots.project_id, byLabel: ctx.from, ...oc, narrationId: slots.narration_id ?? null, now: new Date(), vmNodeKeys: vm.keys, vmTaskNames: vm.names }

  await closeConversation(ctx.supabase, { orgId: ctx.orgId, sender: ctx.from, lastActionSummary: 'site update' })
  if (!task) {
    await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `I couldn't find that task anymore — send the update again and I'll re-place it.` }, meta)
    return
  }
  const res = await applyProgress(rc, task, slots.item)
  // GUARDRAIL (Step 3): a pick that resolved to a row the UI can't render must NEVER read back as
  // "✓ logged" — that's the silent-loss bug. Be honest and let the supervisor re-place it.
  if (!res.visibleInVM) {
    await sendNowDurable(ctx.supabase, ctx.from, { kind: 'text', body: `I couldn't attach that to a task on your screen — send it again with the floor/task and I'll place it.` }, meta)
    return
  }
  await sendTaskConfirm(ctx, meta, slots.project_name ?? null, slots.project_id, { progress: [res], problems: [], todos: [], parked: 0 })
}
