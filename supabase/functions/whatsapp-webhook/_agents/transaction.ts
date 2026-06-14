// WhatsApp Sprint 5 -- Transaction agent. Commit-always with rich, tappable
// messages (LIST / reply BUTTONS / CTA via _messages + _format), confidence bands
// (payee near-exact for auto; fuzzy -> confirm buttons), interactive-id resolution,
// and the consolidated interrupt. Owns wa_conversations natively.

import { extractTransaction, type TxnExtract } from '../_extract.ts'
import { matchPayee, matchProject, type Match } from '../_match.ts'
import { send, renderToWhatsApp, type OutMessage } from '../_format.ts'
import { openConversation, closeConversation, abandonConversation, type ConvoRow } from '../_conversation.ts'
import * as M from '../_messages.ts'
import type { Lang } from '../_messages.ts'

const LINK = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app/logbook'
const SOURCE = 'WHATSAPP_TEXT'
const MAX_PROJECT_ROWS = 10

export type TxnCtx = {
  supabase: any
  from: string
  senderName: string
  orgId: string
  wamid: string
  lang: Lang
  interactiveId: string | null   // id of a tapped LIST row / reply button (Sprint 5)
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
const isNo  = (t: string) => /^(no|nope|nah|kaadu|kadu|nahi)\b/i.test(t.trim())
const isYes = (t: string) => /^(yes|yeah|yep|ok|okay|sure|correct|right|sare|sari|avunu|haa|haan)\b/i.test(t.trim())

/** Prepend a consolidated-interrupt ack to any non-template message's body. */
function applyPrefix(msg: OutMessage, prefix?: string): OutMessage {
  if (!prefix || msg.kind === 'template') return msg
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

function aiExtracted(ext: TxnExtract, payeeDisplay: string | null, payeeId: string | null, payeeBand: string,
                     projectId: string | null, projectName: string | null, from: string) {
  return {
    payee_raw: ext.payee, payee_name: payeeDisplay, payee_id: payeeId,
    payee_matched: payeeBand !== 'open', payee_unmatched: payeeBand === 'open',
    payee_confidence: payeeBand === 'auto' ? 'HIGH' : payeeBand === 'confirm' ? 'MEDIUM' : 'LOW',
    amount: ext.amount, mode: ext.mode, direction: ext.direction, description_raw: ext.note,
    project_id: projectId, project_name: projectName,
    project_matched: !!projectId, project_unmatched: !projectId,
    source_agent: 'transaction-v2', sender_number: from,
  }
}

/** Resolve a pronoun/reference ("him","same") from the lingering CLOSED convo. */
async function resolveRef(supabase: any, lingering: ConvoRow | null): Promise<{ payee?: string; project?: string }> {
  if (!lingering?.staged_entry_id) return {}
  const { data } = await supabase.from('rough_entries').select('ai_extracted').eq('id', lingering.staged_entry_id).maybeSingle()
  const ex = (data?.ai_extracted ?? {}) as any
  return { payee: ex.payee_name ?? ex.payee_raw ?? undefined, project: ex.project_name ?? undefined }
}

// ── atomic staging / update (entry + rendered reply in one tx) ───────────────────
async function stageV2(ctx: TxnCtx, status: string, rawText: string, ai: Record<string, unknown>, msg: OutMessage): Promise<string | null> {
  const { data, error } = await ctx.supabase.rpc('stage_entry_v2', {
    p_org_id: ctx.orgId, p_sender: ctx.from, p_wamid: ctx.wamid, p_status: status, p_source: SOURCE,
    p_sender_name: ctx.senderName, p_raw_text: rawText, p_ai: ai,
    p_payload: msg, p_rendered: renderToWhatsApp(ctx.from, msg), p_link_base: LINK,
  })
  if (error) { console.error('[txn] stage_entry_v2 error:', error); return null }
  return data as string
}
async function updateV2(ctx: TxnCtx, entryId: string, patch: Record<string, unknown>, status: string | null, msg: OutMessage): Promise<void> {
  const { error } = await ctx.supabase.rpc('update_entry_v2', {
    p_entry_id: entryId, p_patch: patch, p_status: status, p_org_id: ctx.orgId, p_sender: ctx.from,
    p_wamid: ctx.wamid, p_payload: msg, p_rendered: renderToWhatsApp(ctx.from, msg), p_link_base: LINK,
  })
  if (error) console.error('[txn] update_entry_v2 error:', error)
}

// ── New transaction (or amount-answer re-entry via preExtract) ───────────────────
export async function runTransaction(
  ctx: TxnCtx, text: string,
  opts: { prefix?: string; lingering?: ConvoRow | null; preExtract?: TxnExtract } = {},
): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const ext = opts.preExtract ?? await extractTransaction(text)

  if (!ext.payee && ext.ref && opts.lingering) {
    const r = await resolveRef(supabase, opts.lingering)
    if (r.payee) ext.payee = r.payee
    if (!ext.project && r.project) ext.project = r.project
  }

  const [stakeholders, activeProjects] = await Promise.all([loadStakeholders(supabase, orgId), loadActiveProjects(supabase, orgId)])
  const payeeM = matchPayee(ext.payee, stakeholders)
  const payeeDisplay = payeeM.band !== 'open' ? payeeM.name! : (ext.payee ?? null)  // A3: keep raw token, never "someone"
  const payeeId = payeeM.band === 'auto' ? payeeM.id : null

  // Project plan: auto -> use; confirm -> button; open+many -> LIST; open+<=1 -> leave.
  let projOptions: { id: string; name: string }[] = []
  let projGuessId: string | null = null, projGuessName: string | null = null
  let projAutoId: string | null = null, projAutoName: string | null = null
  if (ext.project) {
    const pm = matchProject(ext.project, activeProjects)
    if (pm.band === 'auto') { projAutoId = pm.id; projAutoName = pm.name }
    else if (pm.band === 'confirm') { projGuessId = pm.id; projGuessName = pm.name }
    else if (activeProjects.length > 1) projOptions = activeProjects.slice(0, MAX_PROJECT_ROWS).map(p => ({ id: p.project_id, name: p.name }))
  } else if (activeProjects.length === 1) {
    projAutoId = activeProjects[0].project_id; projAutoName = activeProjects[0].name
  } else if (activeProjects.length > 1) {
    projOptions = activeProjects.slice(0, MAX_PROJECT_ROWS).map(p => ({ id: p.project_id, name: p.name }))
  }

  // Gate 1: amount is the floor. No amount -> ask once, NO row.
  if (ext.amount == null) {
    await openConversation(supabase, {
      orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'AWAIT_AMOUNT',
      slots: { payee: payeeDisplay, raw: ext.payee, project: ext.project, mode: ext.mode, note: ext.note, direction: ext.direction },
      lastMessageId: wamid,
    })
    await send(supabase, from, applyPrefix(M.mAmountMissing(lang, { payee: payeeDisplay }), opts.prefix), { org_id: orgId, wamid })
    return
  }

  const amount = ext.amount
  const baseAi = aiExtracted(ext, payeeDisplay, payeeId, payeeM.band, projAutoId, projAutoName, from)
  // Carry the full plan in slots so answer handlers can advance without re-deriving.
  const planSlots = {
    payee: payeeDisplay, amount, raw: ext.payee,
    proj_options: projOptions, proj_guess_id: projGuessId, proj_guess_name: projGuessName,
    proj_auto_id: projAutoId, proj_auto_name: projAutoName,
  }

  // Q1 -- payee confirm (fuzzy payee). Commit draft + reply buttons.
  if (payeeM.band === 'confirm') {
    const id = await stageV2(ctx, 'AWAITING_CONTEXT', text, baseAi, applyPrefix(M.mConfirmPayee(lang, { guess: payeeM.name! }), opts.prefix))
    await openConversation(supabase, { orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'CONFIRM_PAYEE',
      slots: { ...planSlots, payee_guess: payeeM.name, payee_guess_id: payeeM.id }, stagedEntryId: id, lastMessageId: wamid })
    return
  }
  // Q2 -- project LIST (open + multiple active).
  if (projOptions.length > 0) {
    const id = await stageV2(ctx, 'AWAITING_CONTEXT', text, baseAi, applyPrefix(M.mProjectList(lang, { payee: payeeDisplay, amount, options: projOptions }), opts.prefix))
    await openConversation(supabase, { orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'AWAIT_PROJECT',
      slots: { ...planSlots, project_options: projOptions }, stagedEntryId: id, lastMessageId: wamid })
    return
  }
  // Q3 -- project confirm (fuzzy project).
  if (projGuessName) {
    const ai = { ...baseAi, project_id: projGuessId, project_name: projGuessName, project_matched: true, project_unmatched: false }
    const id = await stageV2(ctx, 'AWAITING_CONTEXT', text, ai, applyPrefix(M.mConfirmProject(lang, { guess: projGuessName }), opts.prefix))
    await openConversation(supabase, { orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'CONFIRM_PROJECT',
      slots: { ...planSlots }, stagedEntryId: id, lastMessageId: wamid })
    return
  }
  // Complete. Payee auto -> PENDING; payee raw/unmatched -> AWAITING_CONTEXT (owner maps in app).
  const status = payeeM.band === 'auto' ? 'PENDING' : 'AWAITING_CONTEXT'
  const id = await stageV2(ctx, status, text, baseAi, applyPrefix(M.mComplete(lang, { payee: payeeDisplay, amount, project: projAutoName }), opts.prefix))
  await closeConversation(supabase, { orgId, sender: from, stagedEntryId: id, lastMessageId: wamid,
    lastActionSummary: `Saved ${payeeDisplay ?? ''} ${fmtNum(amount)}${projAutoName ? ` -> ${projAutoName}` : ''}`.trim() })
}

// ── ANSWERS_PENDING handler (the interactive-reply path -- resolves by id) ───────
export async function answerTransaction(ctx: TxnCtx, text: string, convo: ConvoRow): Promise<void> {
  const { supabase, from, orgId, wamid, lang, interactiveId: iid } = ctx
  const slots = (convo.slots_so_far ?? {}) as any
  const pending = convo.pending_question

  // Explicit cancel from any pending state -> discard.
  if (isHardCancel(text)) { await cancelTransaction(ctx, convo); return }

  if (pending === 'AWAIT_AMOUNT') {
    const amt = parseAmount(text)
    if (!amt || amt <= 0) {
      if (isNo(text)) { await cancelTransaction(ctx, convo); return }   // bare "no" at amount = discard
      await send(supabase, from, { kind: 'text', body: 'Just the amount please — e.g. 5000 or 5k' }, { org_id: orgId, wamid })
      return
    }
    const ext: TxnExtract = { amount: amt, payee: slots.raw ?? slots.payee ?? null, project: slots.project ?? null,
      direction: slots.direction ?? null, mode: slots.mode ?? null, note: slots.note ?? null, ref: null }
    await runTransaction(ctx, text, { preExtract: ext })
    return
  }

  if (pending === 'CONFIRM_PAYEE') {
    if (iid === 'confirm_payee_yes' || (isYes(text) && iid !== 'confirm_payee_no')) {
      await advanceAfterPayee(ctx, convo, { payee_id: slots.payee_guess_id, payee_name: slots.payee_guess,
        payee_matched: true, payee_unmatched: false, payee_confidence: 'HIGH' }, slots.payee_guess)
    } else { // "No, someone else" -> ask the name
      await openConversation(supabase, { orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'AWAIT_PAYEE',
        slots, stagedEntryId: convo.staged_entry_id, lastMessageId: wamid })
      await send(supabase, from, M.mAskPayee(lang), { org_id: orgId, wamid })
    }
    return
  }

  if (pending === 'AWAIT_PAYEE') {
    const m = matchPayee(text, await loadStakeholders(supabase, orgId))
    const name = m.band !== 'open' ? m.name! : text
    await advanceAfterPayee(ctx, convo, { payee_raw: text, payee_name: name, payee_id: m.band === 'auto' ? m.id : null,
      payee_matched: m.band !== 'open', payee_unmatched: m.band === 'open',
      payee_confidence: m.band === 'auto' ? 'HIGH' : m.band === 'confirm' ? 'MEDIUM' : 'LOW' }, name)
    return
  }

  if (pending === 'AWAIT_PROJECT') {
    const options = (slots.project_options ?? slots.proj_options ?? []) as { id: string; name: string }[]
    let chosen = iid ? options.find((o) => o.id === iid) : undefined      // resolve by LIST row id
    if (!chosen) { const num = parseInt(text.trim(), 10); if (num >= 1 && num <= options.length) chosen = options[num - 1] }
    if (!chosen) { const m = matchProject(text, options.map((o) => ({ project_id: o.id, name: o.name }))); if (m.band !== 'open') chosen = { id: m.id!, name: m.name! } }
    if (!chosen) { await send(supabase, from, M.mProjectList(lang, { payee: slots.payee, amount: Number(slots.amount), options }), { org_id: orgId, wamid }); return }
    await updateV2(ctx, convo.staged_entry_id!, { project_id: chosen.id, project_name: chosen.name, project_matched: true, project_unmatched: false },
      'PENDING', M.mComplete(lang, { payee: slots.payee, amount: Number(slots.amount), project: chosen.name }))
    await closeConversation(supabase, { orgId, sender: from, stagedEntryId: convo.staged_entry_id, lastMessageId: wamid, lastActionSummary: `Saved ${slots.payee ?? ''} -> ${chosen.name}` })
    return
  }

  if (pending === 'CONFIRM_PROJECT') {
    if (iid === 'confirm_project_yes' || (isYes(text) && iid !== 'confirm_project_no')) {
      await updateV2(ctx, convo.staged_entry_id!, { project_matched: true, project_unmatched: false },
        'PENDING', M.mComplete(lang, { payee: slots.payee, amount: Number(slots.amount), project: slots.proj_guess_name }))
      await closeConversation(supabase, { orgId, sender: from, stagedEntryId: convo.staged_entry_id, lastMessageId: wamid, lastActionSummary: `Saved ${slots.payee ?? ''} -> ${slots.proj_guess_name ?? ''}` })
    } else { // "Pick another" -> show the LIST
      const options = (await loadActiveProjects(supabase, orgId)).slice(0, MAX_PROJECT_ROWS).map((p) => ({ id: p.project_id, name: p.name }))
      await openConversation(supabase, { orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'AWAIT_PROJECT',
        slots: { ...slots, project_options: options }, stagedEntryId: convo.staged_entry_id, lastMessageId: wamid })
      await send(supabase, from, M.mProjectList(lang, { payee: slots.payee, amount: Number(slots.amount), options }), { org_id: orgId, wamid })
    }
    return
  }
}

/** After the payee is resolved, ask the next outstanding slot or finalize. */
async function advanceAfterPayee(ctx: TxnCtx, convo: ConvoRow, payeePatch: Record<string, unknown>, payeeName: string | null): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const slots = (convo.slots_so_far ?? {}) as any
  const amount = Number(slots.amount)
  const eid = convo.staged_entry_id!

  if ((slots.proj_options ?? []).length > 0) {
    await updateV2(ctx, eid, payeePatch, 'AWAITING_CONTEXT', M.mProjectList(lang, { payee: payeeName, amount, options: slots.proj_options }))
    await openConversation(supabase, { orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'AWAIT_PROJECT',
      slots: { ...slots, payee: payeeName, project_options: slots.proj_options }, stagedEntryId: eid, lastMessageId: wamid })
  } else if (slots.proj_guess_name) {
    await updateV2(ctx, eid, { ...payeePatch, project_id: slots.proj_guess_id, project_name: slots.proj_guess_name },
      'AWAITING_CONTEXT', M.mConfirmProject(lang, { guess: slots.proj_guess_name }))
    await openConversation(supabase, { orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'CONFIRM_PROJECT',
      slots: { ...slots, payee: payeeName }, stagedEntryId: eid, lastMessageId: wamid })
  } else {
    await updateV2(ctx, eid, payeePatch, 'PENDING', M.mComplete(lang, { payee: payeeName, amount, project: slots.proj_auto_name ?? null }))
    await closeConversation(supabase, { orgId, sender: from, stagedEntryId: eid, lastMessageId: wamid,
      lastActionSummary: `Saved ${payeeName ?? ''} ${fmtNum(amount)}${slots.proj_auto_name ? ` -> ${slots.proj_auto_name}` : ''}`.trim() })
  }
}

/** Interrupt: commit current state, return an ack string for the consolidated message. */
export async function commitInterrupted(ctx: TxnCtx, convo: ConvoRow): Promise<string> {
  const { supabase, from, orgId, lang } = ctx
  const slots = (convo.slots_so_far ?? {}) as any
  if (convo.staged_entry_id) {
    await closeConversation(supabase, { orgId, sender: from, stagedEntryId: convo.staged_entry_id, lastMessageId: ctx.wamid,
      lastActionSummary: `Saved ${slots.payee ?? ''} ${slots.amount ? fmtNum(Number(slots.amount)) : ''}`.trim() })
    return M.ackLine(lang, { payee: slots.payee ?? null, amount: slots.amount != null ? Number(slots.amount) : null })
  }
  await abandonConversation(supabase, orgId, from)  // awaiting amount, nothing committed -> gate 1
  return "Couldn't log the previous one (no amount)."
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
