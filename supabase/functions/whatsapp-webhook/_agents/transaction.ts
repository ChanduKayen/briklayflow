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

import { extractTransaction, extractTransactionFromImage, type TxnExtract } from '../_extract.ts'
import { parseSpokenAmount } from '../_amount.ts'
import { matchPayee, matchProject, type Match } from '../_match.ts'
import { send, renderToWhatsApp, type OutMessage } from '../_format.ts'
import { openConversation, closeConversation, abandonConversation, type ConvoRow } from '../_conversation.ts'
import { WriteCommitFailed } from '../_spine.ts'
import * as M from '../_messages.ts'
import type { Lang } from '../_messages.ts'

const LINK = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app/logbook'
const SOURCE = 'WHATSAPP_TEXT'
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
  image?: { base64: string; mime: string; caption: string }   // present for payment images -> vision extraction
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
async function stageV2(
  ctx: TxnCtx, status: string, rawText: string, ai: Record<string, unknown>, msg: OutMessage,
  reaction?: OutMessage,
): Promise<string | null> {
  const { data, error } = await ctx.supabase.rpc('stage_entry_v2', {
    p_org_id: ctx.orgId, p_sender: ctx.from, p_wamid: ctx.wamid, p_status: status, p_source: SOURCE,
    p_sender_name: ctx.senderName, p_raw_text: rawText, p_ai: ai,
    p_payload: msg, p_rendered: renderToWhatsApp(ctx.from, msg), p_link_base: LINK,
    p_reaction: reaction ? renderToWhatsApp(ctx.from, reaction) : null,
  })
  if (error) { console.error('[txn] stage_entry_v2 error:', error); return null }
  return (data as string) ?? null
}

/**
 * The staging RPC rolled back -> the entry does NOT exist. Persist the parsed values
 * for one-tap replay, then send the EXPLICIT failure message via send() -- an
 * INDEPENDENT enqueue (the entry's tx is gone, this one stands on its own). The
 * caller throws WriteCommitFailed so processJob marks the job FAILED without the
 * generic message. This fires ONLY on the RPC result, never on a delivery failure.
 */
async function handleWriteFailure(ctx: TxnCtx, plan: Plan, text: string): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const replayId = crypto.randomUUID()
  const parsed = {
    amount: plan.amount, amount_confidence: plan.slots.amount_confidence,
    amount_source_phrase: plan.slots.amount_source_phrase, payee: plan.payeeDisplay,
    raw: plan.slots.raw, project: plan.slots.project,
    direction: plan.slots.direction, mode: plan.slots.mode, note: plan.slots.note,
    raw_text: text, lang,
  }
  const { error } = await supabase.from('wa_failed_writes').insert({ replay_id: replayId, org_id: orgId, sender: from, parsed })
  if (error) console.error('[txn] wa_failed_writes insert error:', error)
  await send(supabase, from, M.mWriteFailed(lang, {
    payee: plan.payeeDisplay, amount: plan.amount, project: plan.projectName ?? plan.projectRaw, replayId,
  }), { org_id: orgId, wamid })
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

/**
 * Silent, conservative matching. Auto-link ONLY at near-exact (the matcher's 'auto'
 * band). Below that we TAKE EXACTLY WHAT'S WRITTEN -- never substitute ("ramu" never
 * becomes "Raju" in chat) -- and stash the nearest candidate for the Day Book.
 */
function buildPlan(
  ext: TxnExtract,
  stakeholders: { stakeholder_id: string; name: string }[],
  projects: { project_id: string; name: string }[],
  from: string,
): Plan {
  const payeeM = matchPayee(ext.payee, stakeholders)
  const payeeAuto = payeeM.band === 'auto'
  const payeeId = payeeAuto ? payeeM.id : null
  const payeeDisplay = payeeAuto ? payeeM.name! : (ext.payee ?? null)   // never the guess
  const payeeSug = ext.payee ? suggestionFrom(payeeM) : null

  let projectId: string | null = null, projectName: string | null = null
  let projectSug: { id: string; name: string; score: number } | null = null
  if (ext.project) {
    const pm = matchProject(ext.project, projects)
    if (pm.band === 'auto') { projectId = pm.id; projectName = pm.name }
    else projectSug = suggestionFrom(pm)
  }
  const projectRaw = ext.project && !projectId ? ext.project : null

  const ai = {
    payee_raw: ext.payee, payee_name: payeeDisplay, payee_id: payeeId,
    payee_matched: payeeAuto, payee_unmatched: !payeeAuto && !!ext.payee,
    payee_confidence: payeeAuto ? 'HIGH' : payeeSug ? 'MEDIUM' : 'LOW',
    suggested_payee: payeeSug,
    amount: ext.amount, amount_confidence: ext.amount_confidence ?? null,
    amount_source_phrase: ext.amount_source_phrase ?? null,
    mode: ext.mode, direction: ext.direction, description_raw: ext.note,
    project_id: projectId, project_name: projectName, project_raw: ext.project ?? null,
    project_matched: !!projectId, project_unmatched: !!ext.project && !projectId,
    suggested_project: projectSug,
    source_agent: 'transaction-v3', sender_number: from,
  }
  const slots = {
    amount: ext.amount, amount_confidence: ext.amount_confidence, amount_source_phrase: ext.amount_source_phrase,
    payee: payeeDisplay, raw: ext.payee,
    project: ext.project, mode: ext.mode, note: ext.note, direction: ext.direction,
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
 * The two-essential gate. Stage-on-ask (capture-first): the draft is written even
 * when we ask, so an interrupt/timeout can commit it flagged -- never lost. When
 * both essentials are present we commit and confirm; the agent asks at most ONE
 * question, ever.
 */
async function applyPlan(ctx: TxnCtx, plan: Plan, text: string, opts: { prefix?: string; entryId?: string | null }): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const both = plan.amountMissing && plan.payeeMissing

  let msg: OutMessage
  let pending: string | null
  if (both) { msg = M.mAskBoth(lang); pending = 'AWAIT_BOTH' }
  else if (plan.amountMissing) { msg = M.mAskAmount(lang, { payee: plan.payeeDisplay }); pending = 'AWAIT_AMOUNT' }
  else if (plan.payeeMissing) { msg = M.mAskPayee(lang, { amount: plan.amount }); pending = 'AWAIT_PAYEE' }
  else {
    msg = M.mComplete(lang, {
      payee: plan.payeeDisplay, payeeMatched: plan.payeeMatched, amount: plan.amount,
      projectName: plan.projectName, projectRaw: plan.projectRaw, note: plan.note,
    })
    pending = null
  }
  msg = applyPrefix(msg, opts.prefix)

  // Incomplete while asking -> AWAITING_CONTEXT; complete -> PENDING when the payee
  // auto-linked, else AWAITING_CONTEXT so the Day Book surfaces the link/suggestion.
  const status = pending ? 'AWAITING_CONTEXT' : (plan.payeeMatched ? 'PENDING' : 'AWAITING_CONTEXT')

  // Clean-entry ✓ reaction (only a fully-matched, ready entry earns it). Enqueued
  // in-tx by the staging RPC, so it's commit-gated exactly like the confirmation.
  const reaction: OutMessage | undefined = (!pending && status === 'PENDING')
    ? { kind: 'reaction', messageId: wamid, emoji: '✅' } : undefined

  let entryId: string | null
  if (opts.entryId) {
    await updateV2(ctx, opts.entryId, plan.ai, status, msg); entryId = opts.entryId
  } else {
    entryId = await stageV2(ctx, status, text, plan.ai, msg, reaction)
    // null == the staging tx rolled back -> the entry does NOT exist. Tell the user
    // explicitly (with replay) and signal processJob; never a false "✓", never silence.
    if (entryId === null) { await handleWriteFailure(ctx, plan, text); throw new WriteCommitFailed() }
  }

  if (pending) {
    await openConversation(supabase, {
      orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: pending,
      slots: plan.slots, stagedEntryId: entryId, lastMessageId: wamid,
    })
  } else {
    await closeConversation(supabase, {
      orgId, sender: from, stagedEntryId: entryId, lastMessageId: wamid, lastActionSummary: summaryOf(plan),
    })
  }
}

// ── New transaction (also the answer re-entry path via preExtract + entryId) ──────
export async function runTransaction(
  ctx: TxnCtx, text: string,
  opts: { prefix?: string; lingering?: ConvoRow | null; preExtract?: TxnExtract; entryId?: string | null } = {},
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

  // TRACE 3/4 -- what the AGENT DECODED (its own understanding of the message).
  console.log('[trace] decoded(txn)', JSON.stringify({
    amount: ext.amount, src: ext.amount_source_phrase, conf: ext.amount_confidence,
    payee: ext.payee, project: ext.project, direction: ext.direction, mode: ext.mode, note: ext.note,
  }))

  const plan = buildPlan(ext, stakeholders, projects, from)

  // TRACE 4/4 -- the deterministic PLAN: matched payee, gate, what gets committed.
  console.log('[trace] plan(txn)', JSON.stringify({
    payee: plan.payeeDisplay, matched: plan.payeeMatched, amount: plan.amount,
    project: plan.projectName ?? plan.projectRaw ?? null,
    missingAmount: plan.amountMissing, missingPayee: plan.payeeMissing,
  }))

  await applyPlan(ctx, plan, text, { prefix: opts.prefix, entryId: opts.entryId ?? null })
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
