// WhatsApp Sprint 4 -- the Transaction agent. Commit-always: the moment there's
// an amount it becomes a durable Day Book draft (rough_entries) via one atomic
// staging+outbox RPC; the conversation only ever enriches it. Owns
// wa_conversations natively (no wa_sessions, no mirror).

import { extractTransaction, type TxnExtract } from '../_extract.ts'
import { matchPayee, matchProject, type Match } from '../_match.ts'
import { send } from '../_format.ts'
import { openConversation, closeConversation, abandonConversation, type ConvoRow } from '../_conversation.ts'

const LINK = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app/logbook'
const SOURCE = 'WHATSAPP_TEXT'

export type TxnCtx = {
  supabase: any
  from: string
  senderName: string
  orgId: string
  wamid: string
}

const fmt = (n: number) => 'Rs ' + n.toLocaleString('en-IN')

function parseAmount(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/₹|rs\.?\s*|rupees?\s*/gi, '').replace(/,/g, '').trim()
  if (/^\d+(\.\d+)?k$/i.test(s)) return parseFloat(s) * 1000
  if (/^\d+(\.\d+)?\s*l(akh)?$/i.test(s)) return parseFloat(s) * 100_000
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

async function loadStakeholders(supabase: any, orgId: string) {
  const { data } = await supabase.from('stakeholders').select('stakeholder_id, name').eq('org_id', orgId)
  return (data ?? []) as { stakeholder_id: string; name: string }[]
}
async function loadActiveProjects(supabase: any, orgId: string) {
  const { data } = await supabase.from('projects').select('project_id, name').eq('org_id', orgId).eq('status', 'Active')
  return (data ?? []) as { project_id: string; name: string }[]
}

function aiExtracted(ext: TxnExtract, payeeM: Match, projectId: string | null, projectName: string | null, from: string) {
  return {
    payee_raw: ext.payee, payee_name: payeeM.name ?? ext.payee, payee_id: payeeM.id,
    payee_matched: payeeM.band !== 'open', payee_unmatched: payeeM.band === 'open',
    payee_confidence: payeeM.band === 'auto' ? 'HIGH' : payeeM.band === 'confirm' ? 'MEDIUM' : 'LOW',
    amount: ext.amount, mode: ext.mode, direction: ext.direction,
    description_raw: ext.note,
    project_id: projectId, project_name: projectName,
    project_matched: !!projectId, project_unmatched: !projectId,
    source_agent: 'transaction-v1', sender_number: from,
  }
}

/** Resolve a pronoun/reference ("him","same") from the lingering CLOSED convo. */
async function resolveRef(supabase: any, lingering: ConvoRow | null): Promise<{ payee?: string; payeeId?: string; project?: string; projectId?: string }> {
  if (!lingering?.staged_entry_id) return {}
  const { data } = await supabase.from('rough_entries').select('ai_extracted').eq('id', lingering.staged_entry_id).maybeSingle()
  const ex = (data?.ai_extracted ?? {}) as any
  return { payee: ex.payee_name ?? ex.payee_raw ?? undefined, payeeId: ex.payee_id ?? undefined, project: ex.project_name ?? undefined, projectId: ex.project_id ?? undefined }
}

// ── Public entry points ─────────────────────────────────────────────────────────

/** New transaction (NEW_INTENT) or amount-answer re-entry (via preExtract). */
export async function runTransaction(
  ctx: TxnCtx, text: string,
  opts: { prefix?: string; lingering?: ConvoRow | null; preExtract?: TxnExtract } = {},
): Promise<void> {
  const { supabase, from, senderName, orgId, wamid } = ctx
  const prefix = opts.prefix ? opts.prefix + '\n\n' : ''
  const ext = opts.preExtract ?? await extractTransaction(text)

  // Lingering reference resolution ("another 2000 to him").
  if (!ext.payee && ext.ref && opts.lingering) {
    const r = await resolveRef(supabase, opts.lingering)
    if (r.payee) ext.payee = r.payee
    if (!ext.project && r.project) ext.project = r.project
  }

  const [stakeholders, activeProjects] = await Promise.all([loadStakeholders(supabase, orgId), loadActiveProjects(supabase, orgId)])
  const payeeM = matchPayee(ext.payee, stakeholders)

  // Project resolution: explicit match -> single active project (auto) -> ask (if many).
  let projectId: string | null = null, projectName: string | null = null
  let projectBand: 'auto' | 'confirm' | 'open' = 'open'
  let needProjectQ = false
  let projectOptions: { id: string; name: string }[] = []
  if (ext.project) {
    const pm = matchProject(ext.project, activeProjects)
    if (pm.band !== 'open') { projectId = pm.id; projectName = pm.name; projectBand = pm.band }
    else if (activeProjects.length > 1) { needProjectQ = true; projectOptions = activeProjects.slice(0, 5).map(p => ({ id: p.project_id, name: p.name })) }
  } else if (activeProjects.length === 1) {
    projectId = activeProjects[0].project_id; projectName = activeProjects[0].name; projectBand = 'auto'  // auto-resolve, skip the question
  } else if (activeProjects.length > 1) {
    needProjectQ = true; projectOptions = activeProjects.slice(0, 5).map(p => ({ id: p.project_id, name: p.name }))
  }

  const dispPayee = payeeM.name ?? ext.payee ?? 'someone'

  // ── Gate 1: amount is the floor. No amount -> ask once, NO commit. ───────────
  if (ext.amount == null) {
    await openConversation(supabase, {
      orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'AWAIT_AMOUNT',
      slots: { payee: dispPayee, payee_id: payeeM.id, project: projectName ?? ext.project, project_id: projectId, mode: ext.mode, note: ext.note, direction: ext.direction },
      lastMessageId: wamid,
    })
    await send(supabase, from, { kind: 'text', body: prefix + `How much${ext.payee ? ` to ${dispPayee}` : ''}? e.g. "paid 5000 to ramu"` }, { org_id: orgId, wamid })
    return
  }

  // ── Amount present -> commit-always. ────────────────────────────────────────
  const payeeOk = payeeM.band !== 'open'
  const projectResolved = projectBand === 'auto' || projectBand === 'confirm'
  const ai = aiExtracted(ext, payeeM, projectId, projectName, from)

  if (needProjectQ) {
    // Commit the draft (AWAITING_CONTEXT) AND ask the project, atomically. Entry is
    // already safe; the question only enriches it.
    const lines = projectOptions.map((p, i) => `${i + 1}) ${p.name}`).join('\n')
    const msg = prefix + `Saved ${dispPayee} ${fmt(ext.amount)}. Which project?\n${lines}\nReply 1-${projectOptions.length}`
    const entryId = await stage(ctx, 'AWAITING_CONTEXT', text, ai, msg)
    await openConversation(supabase, {
      orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'AWAIT_PROJECT',
      slots: { payee: dispPayee, amount: ext.amount, project_options: projectOptions },
      stagedEntryId: entryId, lastMessageId: wamid,
    })
    return
  }

  const status = payeeOk && projectResolved ? 'PENDING' : 'AWAITING_CONTEXT'
  let msg: string
  if (status === 'PENDING') {
    msg = `Saved ${dispPayee} ${fmt(ext.amount)}${projectName ? ` -> ${projectName}` : ''} ✓`
    if (projectBand === 'confirm') msg += ` (-> ${projectName}?)`
  } else {
    const missing = !projectName ? 'project' : !payeeOk ? 'payee' : 'some details'
    msg = `Saved ${dispPayee} ${fmt(ext.amount)} -- ${missing} not set, edit anytime`
  }
  const entryId = await stage(ctx, status, text, ai, prefix + msg)
  await closeConversation(supabase, {
    orgId, sender: from, stagedEntryId: entryId, lastMessageId: wamid,
    lastActionSummary: `Saved ${dispPayee} ${fmt(ext.amount)}${projectName ? ` -> ${projectName}` : ''}`,
  })
}

/** ANSWERS_PENDING for an OPEN transaction (amount answer or project pick). */
export async function answerTransaction(ctx: TxnCtx, text: string, convo: ConvoRow): Promise<void> {
  const { supabase, from, orgId, wamid } = ctx
  const slots = (convo.slots_so_far ?? {}) as any

  if (convo.pending_question === 'AWAIT_AMOUNT') {
    const amt = parseAmount(text)
    if (!amt || amt <= 0) {
      await send(supabase, from, { kind: 'text', body: 'Just the number please -- e.g. 5000 or 5k' }, { org_id: orgId, wamid })
      return // keep OPEN
    }
    const ext: TxnExtract = { amount: amt, payee: slots.payee ?? null, project: slots.project ?? null, direction: slots.direction ?? null, mode: slots.mode ?? null, note: slots.note ?? null, ref: null }
    await runTransaction(ctx, text, { preExtract: ext })  // amount present -> commits
    return
  }

  if (convo.pending_question === 'AWAIT_PROJECT') {
    const options = (slots.project_options ?? []) as { id: string; name: string }[]
    const num = parseInt(text.trim(), 10)
    if (num >= 1 && num <= options.length) {
      const chosen = options[num - 1]
      await ctx.supabase.rpc('update_rough_entry_reply', {
        p_entry_id: convo.staged_entry_id, p_patch: { project_id: chosen.id, project_name: chosen.name, project_matched: true, project_unmatched: false },
        p_status: 'PENDING', p_org_id: orgId, p_sender: from, p_wamid: wamid,
        p_message: `Saved -> ${chosen.name} ✓`, p_link_base: LINK,
      })
      await closeConversation(supabase, { orgId, sender: from, stagedEntryId: convo.staged_entry_id, lastMessageId: wamid, lastActionSummary: `Saved ${slots.payee ?? ''} -> ${chosen.name}` })
    } else {
      await send(supabase, from, { kind: 'text', body: `Reply 1-${options.length}` }, { org_id: orgId, wamid })  // keep OPEN
    }
    return
  }
}

/** Interrupt: commit current state, return an ack string for the consolidated message. */
export async function commitInterrupted(ctx: TxnCtx, convo: ConvoRow): Promise<string> {
  const { supabase, from, orgId } = ctx
  const slots = (convo.slots_so_far ?? {}) as any
  if (convo.staged_entry_id) {
    // Draft already committed (amount was present) -> just close + acknowledge.
    await closeConversation(supabase, { orgId, sender: from, stagedEntryId: convo.staged_entry_id, lastMessageId: ctx.wamid, lastActionSummary: `Saved ${slots.payee ?? ''} ${slots.amount ? fmt(Number(slots.amount)) : ''}`.trim() })
    return `Saved ${slots.payee ?? 'that'} ${slots.amount ? fmt(Number(slots.amount)) : ''} (draft) -- ${LINK}?entry=${convo.staged_entry_id}`
  }
  // Awaiting amount, nothing committed -> gate 1: fail, no commit.
  await abandonConversation(supabase, orgId, from)
  return `Couldn't log the previous one -- no amount was given.`
}

/** Explicit cancel: discard (delete draft if any), no commit. */
export async function cancelTransaction(ctx: TxnCtx, convo: ConvoRow): Promise<void> {
  const { supabase, from, orgId, wamid } = ctx
  if (convo.staged_entry_id) {
    await supabase.rpc('discard_rough_entry', { p_entry_id: convo.staged_entry_id, p_org_id: orgId, p_sender: from, p_wamid: wamid, p_message: 'Okay, discarded that.' })
  } else {
    await send(supabase, from, { kind: 'text', body: 'Okay, discarded that.' }, { org_id: orgId, wamid })
  }
  await abandonConversation(supabase, orgId, from)
}

// ── Atomic staging (entry + ack in one DB transaction) ──────────────────────────
async function stage(ctx: TxnCtx, status: string, rawText: string, ai: Record<string, unknown>, message: string | null): Promise<string | null> {
  const { data, error } = await ctx.supabase.rpc('stage_rough_entry', {
    p_org_id: ctx.orgId, p_sender: ctx.from, p_wamid: ctx.wamid, p_status: status, p_source: SOURCE,
    p_sender_name: ctx.senderName, p_raw_text: rawText, p_ai_extracted: ai,
    p_message: message, p_link_base: LINK,
  })
  if (error) { console.error('[txn] stage_rough_entry error:', error); return null }
  return data as string
}
