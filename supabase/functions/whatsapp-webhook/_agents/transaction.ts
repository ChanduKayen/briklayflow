// WhatsApp -- Transaction agent (capture-first redesign, revises Sprint 4-5).
//
// Philosophy: whatever the user sends lands in the Day Book. The agent asks for
// exactly TWO essentials -- amount + payee -- and ONLY when one is missing. Those
// asks capture a RAW value; they never match against the DB. Everything else
// (project, mode, direction, note) is taken as written or left blank and tidied in
// the app. All matching/disambiguation moved to the Day Book as one-tap suggestions.
//
// What this removes vs Sprint 5 (the Transaction agent's USAGE only -- the shared
// machinery stays live for concierge/future agents):
//   - the "Which project?" interactive LIST  (projects take-as-written)
//   - the mid-confidence confirm BUTTONS      (moved to Day Book suggestions)
//   - most interrupt/parking surface          (only AWAIT_AMOUNT/PAYEE/BOTH pend)
// The list/buttons formatter types, wa_conversations, staging, lingering reference
// resolution, and interrupt/parking all remain for everything else.

import {
  extractTransaction, extractTransactionFromImage,
  extractTransactions, extractTransactionsFromImage, type TxnExtract,
} from '../_extract.ts'
import { parseSpokenAmount } from '../_amount.ts'
import { matchPayee, matchProject, distinctiveTokens, type Match } from '../_match.ts'
import { send, renderToWhatsApp, type OutMessage } from '../_format.ts'
import { signedMediaUrl } from '../_normalize.ts'
import { closeConversation, abandonConversation, type ConvoRow } from '../_conversation.ts'
import { toLatinName } from '../_translit.ts'
import { WriteCommitFailed } from '../_spine.ts'
import * as M from '../_messages.ts'
import type { Lang } from '../_messages.ts'

// The Day Book deep-link base. Forced to <origin>/logbook so a WA_APP_LINK that points at
// a bare domain or another page can't land the entry CTA on "/" (which the app redirects
// to /ledger). The RPC appends "?entry=<id>" to this.
const LINK = (() => {
  const b = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app'
  try { return new URL('/logbook', b).href } catch { return 'https://briklayflow.vercel.app/logbook' }
})()
const SOURCE = 'WHATSAPP_TEXT'
// Proof image: the private rough-entry-media bucket has no public URL, and the Day Book renders
// rough_entries.raw_image_url DIRECTLY as <img src> (and it flows to transactions.proof_document_url
// on posting). So we store a SIGNED url with a long TTL — a durable, per-object bearer link that the
// existing UI shows with no frontend change. (~10y; re-signable if the JWT secret is ever rotated.)
const PROOF_URL_TTL = 315_360_000

/**
 * Persist the WhatsApp photo as PROOF on the just-committed entry. The image was already stored in the
 * private rough-entry-media bucket by _normalize (ctx.image.storagePath); here we only LINK it —
 * rough_entries.raw_image_url → a signed URL the Day Book renders and that fileEntry copies to
 * transactions.proof_document_url when the entry is posted. Best-effort: the entry already committed,
 * so a missing/failed proof link must NEVER surface as a write failure.
 */
async function attachProofImage(ctx: TxnCtx, entryId: string | null): Promise<void> {
  const path = ctx.image?.storagePath
  if (!entryId || !path) return
  try {
    const url = await signedMediaUrl(ctx.supabase, path, PROOF_URL_TTL)
    if (!url) { console.warn('[txn] proof sign returned null for', path); return }
    const { error } = await ctx.supabase.from('rough_entries').update({ raw_image_url: url }).eq('id', entryId)
    if (error) console.error('[txn] proof attach failed:', error.message)
  } catch (e) { console.error('[txn] proof attach error:', (e as Error).message) }
}
// Below this score a nearest candidate is too weak to surface as a Day Book
// suggestion (we still take the raw value as-is either way). Env-tunable.
const SUGGEST_FLOOR = Number(Deno.env.get('TXN_SUGGEST_FLOOR') ?? '0.45')

export type TxnCtx = {
  supabase: any
  from: string
  senderName: string
  orgId: string
  wamid: string
  lang: Lang
  interactiveId: string | null   // id of a tapped LIST row / reply button (kept for parity)
  flowResponse?: Record<string, unknown> | null   // decoded nfm_reply.response_json (WhatsApp Flow completion)
  // present for payment images -> vision extraction; storagePath is the ALREADY-stored object
  // (rough-entry-media) we link onto the entry as PROOF.
  image?: { base64: string; mime: string; caption: string; storagePath?: string | null }
  audio?: { storagePath: string; mime: string }   // present for a VOICE note -> siteops records it as findable evidence (T7)
}

const fmtNum = (n: number) => '₹' + n.toLocaleString('en-IN')
function parseAmount(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/₹|rs\.?\s*|rupees?\s*/gi, '').replace(/,/g, '').trim()
  if (/^\d+(\.\d+)?k$/i.test(s)) return parseFloat(s) * 1000
  if (/^\d+(\.\d+)?\s*l(akh)?$/i.test(s)) return parseFloat(s) * 100_000
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}
const isHardCancel = (t: string) => /^(cancel|stop|discard|వద్దు|vaddu)\b/i.test(t.trim())
const isNo = (t: string) => /^(no|nope|nah|kaadu|kadu|nahi)\b/i.test(t.trim())

/** Prepend a consolidated-interrupt ack to any body-bearing message. */
function applyPrefix(msg: OutMessage, prefix?: string): OutMessage {
  if (!prefix || msg.kind === 'template' || msg.kind === 'reaction') return msg
  return { ...msg, body: `${prefix}\n\n${(msg as { body: string }).body}` }
}

async function loadStakeholders(supabase: any, orgId: string) {
  const { data } = await supabase.from('stakeholders').select('stakeholder_id, name').eq('org_id', orgId)
  return (data ?? []) as { stakeholder_id: string; name: string }[]
}
async function loadActiveProjects(supabase: any, orgId: string) {
  const { data } = await supabase.from('projects').select('project_id, name').eq('org_id', orgId).eq('status', 'Active')
  return (data ?? []) as { project_id: string; name: string }[]
}

/** Nearest non-auto candidate worth surfacing in the Day Book ("did you mean…"). */
function suggestionFrom(m: Match): { id: string; name: string; score: number } | null {
  if (m.band === 'auto') return null
  const c = m.closest[0]
  if (!c || m.score < SUGGEST_FLOOR) return null
  return { id: c.id, name: c.name, score: Math.round(m.score * 100) / 100 }
}

/** Resolve a pronoun/reference ("him","same") from the lingering CLOSED convo (silent). */
async function resolveRef(supabase: any, lingering: ConvoRow | null): Promise<{ payee?: string; project?: string }> {
  if (!lingering?.staged_entry_id) return {}
  const { data } = await supabase.from('rough_entries').select('ai_extracted').eq('id', lingering.staged_entry_id).maybeSingle()
  const ex = (data?.ai_extracted ?? {}) as any
  return { payee: ex.payee_name ?? ex.payee_raw ?? undefined, project: ex.project_name ?? undefined }
}

// ── atomic staging / update (entry + rendered reply [+ ✓ reaction] in one tx) ─────
// The confirmation AND the clean-entry reaction are enqueued INSIDE this RPC's
// transaction, alongside the rough_entries insert: they can only send if the entry
// committed (commit-gated, never optimistic). null return == the tx rolled back.
// keyWamid = the ORIGINAL message's wamid (NOT a retry's). With entryIndex it forms the
// idempotency key (org_id, wa_message_id, entry_index); a re-stage of the same entry
// no-ops in-DB and returns the existing row as committed (never a false failure).
async function stageV2(
  ctx: TxnCtx, status: string, rawText: string, ai: Record<string, unknown>, msg: OutMessage,
  reaction: OutMessage | undefined, keyWamid: string, entryIndex: number,
): Promise<string | null> {
  const { data, error } = await ctx.supabase.rpc('stage_entry_v3', {
    p_org_id: ctx.orgId, p_sender: ctx.from, p_wamid: keyWamid, p_entry_index: entryIndex,
    p_status: status, p_source: SOURCE,
    p_sender_name: ctx.senderName, p_raw_text: rawText, p_ai: ai,
    p_payload: msg, p_rendered: renderToWhatsApp(ctx.from, msg), p_link_base: LINK,
    p_reaction: reaction ? renderToWhatsApp(ctx.from, reaction) : null,
  })
  // v3 returns {id, committed, conflict}; ON CONFLICT is idempotent SUCCESS (never null).
  const res = (data ?? null) as { id?: string; committed?: boolean } | null
  if (error || !res?.committed) { if (error) console.error('[txn] stage_entry_v3 error:', error); return null }
  return res.id ?? null
}

/**
 * The staging RPC rolled back -> the entry does NOT exist. Persist the parsed values
 * for one-tap replay, then send the EXPLICIT failure message via send() -- an
 * INDEPENDENT enqueue (the entry's tx is gone, this one stands on its own). The
 * caller throws WriteCommitFailed so processJob marks the job FAILED without the
 * generic message. This fires ONLY on the RPC result, never on a delivery failure.
 */
async function handleWriteFailure(ctx: TxnCtx, plan: Plan, text: string, keyWamid: string, entryIndex: number): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  await send(supabase, from, M.mWriteFailed(lang, {
    payee: plan.payeeDisplay, amount: plan.amount, project: plan.projectName ?? plan.projectRaw,
    replayId: await recordFailedWrite(ctx, plan, text, keyWamid, entryIndex),
  }), { org_id: orgId, wamid })
}

/** One wa_failed_writes row carrying everything [Try again] needs to re-stage THIS entry
 *  at its ORIGINAL key (wamid + entry_index) — so a retry that actually raced through
 *  no-ops instead of duplicating. Returns the replay_id. */
async function recordFailedWrite(ctx: TxnCtx, plan: Plan, text: string, keyWamid: string, entryIndex: number): Promise<string> {
  const replayId = crypto.randomUUID()
  const parsed = {
    amount: plan.amount, amount_confidence: plan.slots.amount_confidence,
    amount_source_phrase: plan.slots.amount_source_phrase, payee: plan.payeeDisplay,
    raw: plan.slots.raw, project: plan.slots.project,
    direction: plan.slots.direction, mode: plan.slots.mode, note: plan.slots.note,
    raw_text: text, lang: ctx.lang, wamid: keyWamid, entry_index: entryIndex,
  }
  const { error } = await ctx.supabase.from('wa_failed_writes').insert({ replay_id: replayId, org_id: ctx.orgId, sender: ctx.from, parsed })
  if (error) console.error('[txn] wa_failed_writes insert error:', error)
  return replayId
}
async function updateV2(ctx: TxnCtx, entryId: string, patch: Record<string, unknown>, status: string | null, msg: OutMessage): Promise<void> {
  const { error } = await ctx.supabase.rpc('update_entry_v2', {
    p_entry_id: entryId, p_patch: patch, p_status: status, p_org_id: ctx.orgId, p_sender: ctx.from,
    p_wamid: ctx.wamid, p_payload: msg, p_rendered: renderToWhatsApp(ctx.from, msg), p_link_base: LINK,
  })
  if (error) console.error('[txn] update_entry_v2 error:', error)
}

// ── The plan: silent matching, capture-first ─────────────────────────────────────
type Plan = {
  ai: Record<string, unknown>
  slots: Record<string, unknown>
  payeeDisplay: string | null
  payeeMatched: boolean
  amount: number | null
  projectName: string | null   // only when auto-linked
  projectRaw: string | null    // mentioned but unmatched
  note: string | null          // free description -> shown on the confirmation
  amountMissing: boolean
  payeeMissing: boolean
}

// Honorifics that commonly prefix a project's name. Too generic to prove a project was
// really mentioned -- "Dr site" shares "dr" with any "Dr <name>" project -- so they never
// count toward grounding on their own.
const GENERIC_PROJECT_TOKENS = new Set(['dr', 'mr', 'mrs', 'ms', 'sri', 'smt', 'md', 'sir'])

/** Guard against the extractor INVENTING a project name -- its few-shot examples leaking onto a
 *  vague input (the live "…Dr site…" -> "Dr Shyam's Residence" bug). A non-auto project is trusted
 *  only when GROUNDED: at least one of its distinctive, non-generic words actually appears in the
 *  source message. "Dr Shyam's Residence" shares only the generic "dr" with the message -> ungrounded
 *  -> dropped, so no invented name reaches the Day Book. A real project the message clearly names
 *  auto-matches earlier and never reaches this check. A mention with nothing distinctive to verify
 *  (only a title/filler, e.g. "Dr site") is left alone -- we drop only demonstrable fabrications. */
function projectGroundedInMessage(project: string | null, text: string): boolean {
  if (!project) return false
  const sig = distinctiveTokens(project).filter((t) => t.length >= 3 && !GENERIC_PROJECT_TOKENS.has(t))
  if (!sig.length) return true
  const msg = new Set(distinctiveTokens(text))
  return sig.some((t) => msg.has(t))
}

/**
 * Silent, conservative matching. Auto-link ONLY at near-exact (the matcher's 'auto'
 * band). Below that we TAKE EXACTLY WHAT'S WRITTEN -- never substitute ("ramu" never
 * becomes "Raju" in chat) -- and stash the nearest candidate for the Day Book.
 */
export function buildPlan(
  ext: TxnExtract,
  stakeholders: { stakeholder_id: string; name: string }[],
  projects: { project_id: string; name: string }[],
  from: string,
  text: string,
): Plan {
  const payeeM = matchPayee(ext.payee, stakeholders)
  const payeeAuto = payeeM.band === 'auto'
  const payeeId = payeeAuto ? payeeM.id : null
  const payeeDisplay = payeeAuto ? payeeM.name! : (ext.payee ?? null)   // never the guess
  const payeeSug = ext.payee ? suggestionFrom(payeeM) : null

  let projectId: string | null = null, projectName: string | null = null
  let projectSug: { id: string; name: string; score: number } | null = null
  const projGrounded = projectGroundedInMessage(ext.project, text)
  if (ext.project) {
    const pm = matchProject(ext.project, projects)
    if (pm.band === 'auto') { projectId = pm.id; projectName = pm.name }
    else if (projGrounded) projectSug = suggestionFrom(pm)   // ungrounded -> don't even suggest
  }
  // Trust a project only if it auto-matched a REAL one, or its words are grounded in the message.
  // An ungrounded, unmatched name is a model fabrication (few-shot leak) -> it never surfaces.
  const safeProject = (projectId != null || projGrounded) ? ext.project : null
  const projectRaw = safeProject && !projectId ? safeProject : null

  const ai = {
    payee_raw: ext.payee, payee_name: payeeDisplay, payee_id: payeeId,
    payee_matched: payeeAuto, payee_unmatched: !payeeAuto && !!ext.payee,
    payee_confidence: payeeAuto ? 'HIGH' : payeeSug ? 'MEDIUM' : 'LOW',
    suggested_payee: payeeSug,
    amount: ext.amount, amount_confidence: ext.amount_confidence ?? null,
    amount_source_phrase: ext.amount_source_phrase ?? null,
    mode: ext.mode, direction: ext.direction, description_raw: ext.note,
    project_id: projectId, project_name: projectName, project_raw: safeProject ?? null,
    project_matched: !!projectId, project_unmatched: !!safeProject && !projectId,
    suggested_project: projectSug,
    source_agent: 'transaction-v3', sender_number: from,
  }
  const slots = {
    amount: ext.amount, amount_confidence: ext.amount_confidence, amount_source_phrase: ext.amount_source_phrase,
    payee: payeeDisplay, raw: ext.payee,
    project: safeProject, mode: ext.mode, note: ext.note, direction: ext.direction,
  }
  return {
    ai, slots, payeeDisplay, payeeMatched: payeeAuto, amount: ext.amount,
    projectName, projectRaw, note: ext.note, amountMissing: ext.amount == null, payeeMissing: !payeeDisplay,
  }
}

function summaryOf(plan: Plan): string {
  const p = plan.payeeDisplay ?? '(payee not set)'
  const a = plan.amount != null ? fmtNum(plan.amount) : '(amount not set)'
  return `Saved ${p} ${a}${plan.projectName ? ` -> ${plan.projectName}` : ''}`.trim()
}

/**
 * Capture-first commit — NO follow-up questions, ever. The draft is ALWAYS written:
 * a complete entry confirms with a ✓; an entry missing an essential (amount/payee) is
 * staged FLAGGED with a "Saved — finish in the Day Book" reply. Single entries follow
 * the same no-question policy as batches; the owner corrects gaps in the Day Book.
 */
async function applyPlan(ctx: TxnCtx, plan: Plan, text: string, opts: { prefix?: string; entryId?: string | null; keyWamid: string; entryIndex: number }): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const incomplete = plan.amountMissing || plan.payeeMissing

  // Missing an essential -> "Saved … <gap> not set. Add anytime." + Day Book CTA (never
  // a question). Complete -> the usual confirmation.
  let msg: OutMessage
  if (incomplete) {
    const missing = (plan.amountMissing && plan.payeeMissing)
      ? 'amount and payee'
      : plan.amountMissing ? 'amount' : 'payee'
    msg = M.mAbandoned(lang, { payee: plan.payeeDisplay, amount: plan.amount, missing })
  } else {
    msg = M.mComplete(lang, {
      payee: plan.payeeDisplay, payeeMatched: plan.payeeMatched, amount: plan.amount,
      projectName: plan.projectName, projectRaw: plan.projectRaw, note: plan.note,
    })
  }
  msg = applyPrefix(msg, opts.prefix)

  // Complete + auto-linked -> PENDING (ready); incomplete or unmatched -> AWAITING_CONTEXT
  // so the Day Book surfaces the gap/suggestion. Same gate as the batch path.
  const status = statusFor(plan)

  // Clean-entry ✓ reaction (only a fully-matched, ready entry earns it). Enqueued
  // in-tx by the staging RPC, so it's commit-gated exactly like the confirmation.
  const reaction: OutMessage | undefined = (!incomplete && status === 'PENDING')
    ? { kind: 'reaction', messageId: wamid, emoji: '✅' } : undefined

  let entryId: string | null
  if (opts.entryId) {
    await updateV2(ctx, opts.entryId, plan.ai, status, msg); entryId = opts.entryId
  } else {
    entryId = await stageV2(ctx, status, text, plan.ai, msg, reaction, opts.keyWamid, opts.entryIndex)
    // null == the staging tx rolled back -> the entry does NOT exist. Tell the user
    // explicitly (with replay) and signal processJob; never a false "✓", never silence.
    if (entryId === null) { await handleWriteFailure(ctx, plan, text, opts.keyWamid, opts.entryIndex); throw new WriteCommitFailed() }
  }

  // Link the WhatsApp photo (if this was a payment image) as proof on the committed entry.
  await attachProofImage(ctx, entryId)

  // No pending question -> always close the conversation (keeps the lingering context for
  // "another 2000 to him"). Incomplete entries are finished in the Day Book.
  await closeConversation(supabase, {
    orgId, sender: from, stagedEntryId: entryId, lastMessageId: wamid, lastActionSummary: summaryOf(plan),
  })
}

// ── New transaction (also the answer re-entry path via preExtract + entryId) ──────
export async function runTransaction(
  ctx: TxnCtx, text: string,
  opts: { prefix?: string; lingering?: ConvoRow | null; preExtract?: TxnExtract; entryId?: string | null; keyWamid?: string; entryIndex?: number } = {},
): Promise<void> {
  const { supabase, orgId, from } = ctx
  // Load first so the extractor can be told the user's known projects (it returns the
  // listed name when the message clearly points to one; raw mention / null otherwise).
  const [stakeholders, projects] = await Promise.all([loadStakeholders(supabase, orgId), loadActiveProjects(supabase, orgId)])
  const projectNames = projects.map((p) => p.name)
  // A payment image -> one strong vision call (skip the describe->re-parse hop); plain
  // text/voice -> the text extractor. Both honor the SAME contract + reconcileAmount.
  const ext = opts.preExtract ?? (ctx.image
    ? await extractTransactionFromImage(ctx.image.base64, ctx.image.mime, ctx.image.caption, projectNames, stakeholders.map((s) => s.name))
    : await extractTransaction(text, projectNames))

  // Lingering reference resolution stays -- a silent READ, never a question.
  if (!ext.payee && ext.ref && opts.lingering) {
    const r = await resolveRef(supabase, opts.lingering)
    if (r.payee) ext.payee = r.payee
    if (!ext.project && r.project) ext.project = r.project
  }

  // Universal Latin gate: a name is NEVER stored in native script -- whether it came from
  // the extractor (single-shot) or a raw follow-up answer, both funnel through here.
  // Idempotent on Latin input, so it runs unconditionally.
  ext.payee = toLatinName(ext.payee)
  ext.project = toLatinName(ext.project)

  // TRACE 3/4 -- what the AGENT DECODED (its own understanding of the message).
  console.log('[trace] decoded(txn)', JSON.stringify({
    amount: ext.amount, src: ext.amount_source_phrase, conf: ext.amount_confidence,
    payee: ext.payee, project: ext.project, direction: ext.direction, mode: ext.mode, note: ext.note,
  }))

  const plan = buildPlan(ext, stakeholders, projects, from, text)

  // TRACE 4/4 -- the deterministic PLAN: matched payee, gate, what gets committed.
  console.log('[trace] plan(txn)', JSON.stringify({
    payee: plan.payeeDisplay, matched: plan.payeeMatched, amount: plan.amount,
    project: plan.projectName ?? plan.projectRaw ?? null,
    missingAmount: plan.amountMissing, missingPayee: plan.payeeMissing,
  }))

  await applyPlan(ctx, plan, text, {
    prefix: opts.prefix, entryId: opts.entryId ?? null,
    keyWamid: opts.keyWamid ?? ctx.wamid, entryIndex: opts.entryIndex ?? 0,
  })
}

// ── Multi-entry: many payments in one message ────────────────────────────────────
// The registered NEW_INTENT entry point. Extract ALL payments ONCE; a single payment
// (0 or 1 entry) takes the UNCHANGED single-entry path (we reuse the extract as
// preExtract — no second LLM call); two or more loop the SAME single-entry commit per
// entry, then one aggregated card. No questions for a batch (incomplete entries stage
// flagged for the Day Book). Router + single-entry UX are untouched.

type EntryOutcome = { payee: string | null; amount: number | null; project: string | null; committed: boolean; replayId?: string
  /** The staged entry's id — the deep-link target ('View entry'). Present only when it committed. */
  entryId?: string | null }

/** Batch status: incomplete entries are NOT questions — they stage flagged for the Day Book. */
function statusFor(plan: Plan): string {
  if (plan.amountMissing || plan.payeeMissing) return 'AWAITING_CONTEXT'
  return plan.payeeMatched ? 'PENDING' : 'AWAITING_CONTEXT'
}

/** Stage ONE batch entry (card suppressed — the batch sends one aggregated card after).
 *  Bounded in-loop retry (3 attempts) smooths a TRANSIENT hiccup so fewer entries land
 *  failed; a deterministic failure (or the test sentinel) exhausts the attempts and
 *  reports failed. Idempotency is by (org, keyWamid, entryIndex) — already-landed = success. */
async function commitEntry(ctx: TxnCtx, status: string, text: string, ai: Record<string, unknown>, keyWamid: string, entryIndex: number): Promise<string | null> {
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data, error } = await ctx.supabase.rpc('stage_entry_v3', {
      p_org_id: ctx.orgId, p_sender: ctx.from, p_wamid: keyWamid, p_entry_index: entryIndex,
      p_status: status, p_source: SOURCE, p_sender_name: ctx.senderName, p_raw_text: text,
      p_ai: ai, p_payload: null, p_rendered: null, p_link_base: LINK, p_reaction: null,
    })
    const res = (data ?? null) as { id?: string; committed?: boolean } | null
    if (!error && res?.committed) return res.id ?? null
    console.error(`[txn-batch] stage_entry_v3 entry ${entryIndex} attempt ${attempt}:`, error ?? 'no-commit')
    if (attempt < 3) await new Promise((r) => setTimeout(r, 150 * attempt))
  }
  return null
}

/** Build + send the ONE aggregated card, plus a single ✓ when the whole batch is clean.
 *  A partial batch is NOT a job failure: the committed entries are in the ledger and the
 *  failed ones are NAMED on the card with [Try again]. So this never throws — every entry
 *  ends in exactly one visible state (ticked, or named-not-saved). */
async function sendBatchCard(ctx: TxnCtx, outcomes: EntryOutcome[], prefix?: string): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const failed = outcomes.filter((o) => !o.committed)
  const committedCount = outcomes.length - failed.length
  // ≥2 failures can't each carry a button (WhatsApp caps at 3) -> ONE retry-all keyed on
  // the original message; exactly 1 -> that entry's own replay id.
  const retryButtonId = failed.length === 0 ? null
    : failed.length === 1 ? `retry_${failed[0].replayId}`
    : `retryall_${wamid}`
  // Ordered (message order) so the serials read 1..N regardless of saved/failed grouping.
  const card = applyPrefix(M.mBatch(lang, {
    entries: outcomes.map((o) => ({ payee: o.payee, amount: o.amount, project: o.project, committed: o.committed, entryId: o.entryId ?? null })),
    retryButtonId,
  }), prefix)
  await send(supabase, from, card, { org_id: orgId, wamid })
  if (failed.length === 0 && committedCount > 0) {
    await send(supabase, from, { kind: 'reaction', messageId: wamid, emoji: '✅' }, { org_id: orgId, wamid })
  }
}

/** The batch loop: each entry through the SAME single-entry commit (matching + flag +
 *  idempotent stage), card suppressed; then one aggregated card. */
async function runBatch(
  ctx: TxnCtx, text: string, entries: TxnExtract[],
  stakeholders: { stakeholder_id: string; name: string }[], projects: { project_id: string; name: string }[],
  prefix?: string,
): Promise<void> {
  const outcomes: EntryOutcome[] = []
  for (let i = 0; i < entries.length; i++) {
    const plan = buildPlan(entries[i], stakeholders, projects, ctx.from, text)
    const project = plan.projectName ?? plan.projectRaw ?? null
    const id = await commitEntry(ctx, statusFor(plan), text, plan.ai, ctx.wamid, i)
    if (id) { outcomes.push({ payee: plan.payeeDisplay, amount: plan.amount, project, committed: true, entryId: id }); await attachProofImage(ctx, id) }
    else outcomes.push({ payee: plan.payeeDisplay, amount: plan.amount, project, committed: false, replayId: await recordFailedWrite(ctx, plan, text, ctx.wamid, i) })
  }
  await sendBatchCard(ctx, outcomes, prefix)
}

/** [Try again] for a multi-failure batch (retryall_): re-stage each held entry by its
 *  ORIGINAL key (idempotent), clear the rows that land, re-record those that don't, and
 *  send one fresh aggregated card. */
export async function retryBatchEntries(ctx: TxnCtx, rows: { replay_id: string; parsed: Record<string, unknown> }[]): Promise<void> {
  const [stakeholders, projects] = await Promise.all([loadStakeholders(ctx.supabase, ctx.orgId), loadActiveProjects(ctx.supabase, ctx.orgId)])
  const outcomes: EntryOutcome[] = []
  const cleared: string[] = []
  for (const row of rows) {
    const p = (row.parsed ?? {}) as Record<string, any>
    const ext: TxnExtract = {
      amount: p.amount ?? null, amount_confidence: p.amount_confidence ?? null,
      amount_source_phrase: p.amount_source_phrase ?? null, payee: p.payee ?? p.raw ?? null,
      project: p.project ?? null, direction: p.direction ?? null, mode: p.mode ?? null, note: p.note ?? null, ref: null,
    }
    const plan = buildPlan(ext, stakeholders, projects, ctx.from, (p.raw_text as string) ?? '')
    const project = plan.projectName ?? plan.projectRaw ?? null
    const keyWamid = (p.wamid as string) ?? ctx.wamid
    const idx = typeof p.entry_index === 'number' ? p.entry_index : 0
    const id = await commitEntry(ctx, statusFor(plan), (p.raw_text as string) ?? '', plan.ai, keyWamid, idx)
    if (id) { outcomes.push({ payee: plan.payeeDisplay, amount: plan.amount, project, committed: true, entryId: id }); cleared.push(row.replay_id) }
    else outcomes.push({ payee: plan.payeeDisplay, amount: plan.amount, project, committed: false, replayId: await recordFailedWrite(ctx, plan, (p.raw_text as string) ?? '', keyWamid, idx) })
  }
  if (cleared.length) await ctx.supabase.from('wa_failed_writes').delete().in('replay_id', cleared)
  await sendBatchCard(ctx, outcomes)
}

/** NEW_INTENT entry point (registered as the agent's `run`). Decides single vs batch. */
export async function runTransactionMessage(ctx: TxnCtx, text: string, opts: { prefix?: string; lingering?: ConvoRow | null } = {}): Promise<void> {
  const { supabase, orgId } = ctx
  const [stakeholders, projects] = await Promise.all([loadStakeholders(supabase, orgId), loadActiveProjects(supabase, orgId)])
  const projectNames = projects.map((p) => p.name)
  const entries = ctx.image
    ? await extractTransactionsFromImage(ctx.image.base64, ctx.image.mime, ctx.image.caption, projectNames, stakeholders.map((s) => s.name))
    : await extractTransactions(text, projectNames)

  console.log('[trace] multi-extract(txn)', JSON.stringify({ count: entries.length }))

  if (entries.length >= 2) { await runBatch(ctx, text, entries, stakeholders, projects, opts.prefix); return }
  // ONE payment -> the UNCHANGED single-entry path, reusing the extract (no 2nd LLM call).
  if (entries.length === 1) {
    await runTransaction(ctx, text, { prefix: opts.prefix, lingering: opts.lingering, preExtract: entries[0] })
    return
  }
  // ZERO -> fall back to the proven single extractor (don't discard a payment the multi
  // pass may have missed; it also drives the capture-first "who/how much?" ask).
  await runTransaction(ctx, text, { prefix: opts.prefix, lingering: opts.lingering })
}

/** Merge a captured essential onto the slots carried across the one extra turn. */
function mergeExt(slots: any, patch: Partial<TxnExtract>): TxnExtract {
  return {
    amount: patch.amount ?? slots.amount ?? null,
    amount_confidence: patch.amount_confidence ?? slots.amount_confidence ?? null,
    amount_source_phrase: patch.amount_source_phrase ?? slots.amount_source_phrase ?? null,
    payee: patch.payee ?? slots.raw ?? slots.payee ?? null,
    project: patch.project ?? slots.project ?? null,
    direction: patch.direction ?? slots.direction ?? null,
    mode: patch.mode ?? slots.mode ?? null,
    note: patch.note ?? slots.note ?? null,
    ref: null,
  }
}

// ── ANSWERS_PENDING: capture the missing essential, then commit (no DB interrogation) ──
export async function answerTransaction(ctx: TxnCtx, text: string, convo: ConvoRow): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const slots = (convo.slots_so_far ?? {}) as any
  const pending = convo.pending_question
  const entryId = convo.staged_entry_id ?? null

  if (isHardCancel(text)) { await cancelTransaction(ctx, convo); return }

  if (pending === 'AWAIT_AMOUNT') {
    // Deterministic spoken-amount parse first ("muppai aidu vela" = 35000); the
    // digit/k-L parser is the fallback. A garbled numeral span -> flag, don't guess.
    const sp = parseSpokenAmount(text)
    const amt = sp.amount ?? parseAmount(text)
    if (!amt || amt <= 0) {
      // They may have typed a fuller sentence ("5k to ramu instead") -> re-extract.
      const re = await extractTransaction(text)
      if (re.amount && re.amount > 0) { await runTransaction(ctx, text, { preExtract: mergeExt(slots, re), entryId }); return }
      if (isNo(text)) { await cancelTransaction(ctx, convo); return }   // bare "no" at amount = discard
      await send(supabase, from, M.mJustAmount(lang), { org_id: orgId, wamid })
      return
    }
    // Deterministic when the answer span is fully recognized or a pure digit; a
    // partial/garbled numeral -> LOW so the card flags it with the phrase.
    const amount_confidence: 'HIGH' | 'LOW' = (sp.amount != null && (sp.fullyRecognized || !sp.hasWord)) ? 'HIGH' : 'LOW'
    await runTransaction(ctx, text, { preExtract: mergeExt(slots, { amount: amt, amount_confidence, amount_source_phrase: text.trim() }), entryId })
    return
  }

  if (pending === 'AWAIT_PAYEE') {
    // Take the answer as-written (the captured payee). Strip a leading "to ".
    const raw = text.trim().replace(/^to\s+/i, '').trim()
    await runTransaction(ctx, text, { preExtract: mergeExt(slots, { payee: raw || null }), entryId })
    return
  }

  if (pending === 'AWAIT_BOTH') {
    const re = await extractTransaction(text)
    const ext = mergeExt(slots, re)
    // If extraction found neither, take the whole line as the payee (capture-first).
    if (ext.payee == null && re.amount == null) ext.payee = text.trim() || null
    await runTransaction(ctx, text, { preExtract: ext, entryId })
    return
  }

  // Legacy pending from a pre-redesign convo (CONFIRM_*/AWAIT_PROJECT): commit what
  // we have rather than re-interrogate.
  await runTransaction(ctx, text, { entryId })
}

/** Interrupt: the draft is already staged, so commit it flagged and return an ack. */
export async function commitInterrupted(ctx: TxnCtx, convo: ConvoRow): Promise<string> {
  const { supabase, from, orgId, lang } = ctx
  const slots = (convo.slots_so_far ?? {}) as any
  const payee = slots.payee ?? null
  const amount = slots.amount != null ? Number(slots.amount) : null
  if (convo.staged_entry_id) {
    await closeConversation(supabase, {
      orgId, sender: from, stagedEntryId: convo.staged_entry_id, lastMessageId: ctx.wamid,
      lastActionSummary: `Saved ${payee ?? '(payee not set)'} ${amount != null ? fmtNum(amount) : '(amount not set)'}`.trim(),
    })
    return M.ackLine(lang, { payee, amount })
  }
  // Defensive: nothing staged (shouldn't happen now that we stage-on-ask).
  await abandonConversation(supabase, orgId, from)
  return M.mFailureNoAmount(lang).body
}

/** Explicit cancel: discard the draft (if any), no commit. */
export async function cancelTransaction(ctx: TxnCtx, convo: ConvoRow): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  if (convo.staged_entry_id) {
    await supabase.rpc('discard_rough_entry', { p_entry_id: convo.staged_entry_id, p_org_id: orgId, p_sender: from, p_wamid: wamid, p_message: M.mCancelled(lang).body })
  } else {
    await send(supabase, from, M.mCancelled(lang), { org_id: orgId, wamid })
  }
  await abandonConversation(supabase, orgId, from)
}
