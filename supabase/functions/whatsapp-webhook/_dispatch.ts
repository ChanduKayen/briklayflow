// WhatsApp Sprint 4 dispatcher. Router classifies; THIS owns control flow + state
// in wa_conversations. TRANSACTION now routes to the real Transaction agent (the
// Sprint-3 legacy bridge + wa_sessions mirror are retired). Reporting/data queries
// still bridge to the legacy handleQuery until a Reporting agent exists.

import { routeMessage } from './_router.ts'
import {
  getRouterView, openConversation, abandonConversation, logRouterDecision, type ConvoRow,
} from './_conversation.ts'
import { agentFor } from './_registry.ts'
import { runTransaction, retryBatchEntries, type TxnCtx } from './_agents/transaction.ts'   // direct: the replay path
import { startVendorFlow } from './_agents/procurement.ts'   // direct: vendor-Flow test trigger
import { runConcierge } from './_agents/concierge.ts'   // direct: first-touch orientation
import { send } from './_format.ts'
import * as M from './_messages.ts'
import type { Lang } from './_messages.ts'
import type { TxnExtract } from './_extract.ts'
import { handleQuery } from './_handlers.ts'   // reporting/query bridge only

// Forced to <origin>/logbook (see transaction.ts) so a misconfigured WA_APP_LINK can't
// send "Open Day Book" / entry deep-links to "/" -> /ledger.
const LINK = (() => {
  const b = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app'
  try { return new URL('/logbook', b).href } catch { return 'https://briklayflow.vercel.app/logbook' }
})()

export type DispatchCtx = {
  supabase: any
  from: string
  senderName: string
  registered: any
  wamid: string
  orgId: string
  interactiveId: string | null   // Sprint 5: id of a tapped LIST row / reply button
  flowResponse?: Record<string, unknown> | null   // decoded WhatsApp Flow completion (nfm_reply.response_json)
  image?: { base64: string; mime: string; caption: string }   // payment-image -> agent vision extraction
  firstTouch?: boolean   // Sprint 6: member's first-ever contact -> orient / welcome
  dormant?: boolean      // Sprint 6: returning after a long gap -> welcome-back prefix
}

/** Join a first-contact welcome with any interrupt ack into one prefix (or undefined). */
function mergePrefix(a?: string, b?: string): string | undefined {
  return [a, b].filter(Boolean).join('\n\n') || undefined
}

/** Org display name for the orientation summary (one cheap read, first touch only). */
async function orgNameOf(supabase: any, orgId: string): Promise<string | null> {
  const { data } = await supabase.from('organizations').select('name').eq('org_id', orgId).maybeSingle()
  return (data?.name as string) ?? null
}

/** Stamp the one-time orientation marker so a member is oriented at most once. */
async function markOriented(supabase: any, from: string): Promise<void> {
  await supabase.from('wa_registered_numbers')
    .update({ oriented_at: new Date().toISOString() })
    .eq('phone_number', from).is('oriented_at', null)
}

// Reporting/data query the router doesn't model yet -> legacy handleQuery bridge.
// Match ONLY genuine money/report words — NOT every "?", which used to swallow plain
// conversational questions ("do you speak Hindi?") and dump them on the reports handler.
const QUERY_RE = /how\s*much|balance|pending|due|outstanding|ledger|\btotal\b|statement|enta|entha|evariki/i

export async function dispatch(ctx: DispatchCtx, text: string): Promise<void> {
  const { supabase, from, registered, wamid, orgId } = ctx

  // ── Recovery taps from the explicit write-failure message bypass the router ──
  // (a button id, not natural language). [Try again] -> replay the held entry;
  // [Add in Day Book] -> follow with the Day Book CTA link (a CTA URL button can't
  // share a message with reply buttons, so it arrives as its own message).
  if (ctx.interactiveId === 'add_daybook') {
    await send(supabase, from, M.mDaybookLink('en', LINK), { org_id: orgId, wamid })
    return
  }
  if (ctx.interactiveId?.startsWith('retryall_')) {
    await handleRetryBatch(ctx, ctx.interactiveId.slice('retryall_'.length))
    return
  }
  if (ctx.interactiveId?.startsWith('retry_')) {
    await handleRetry(ctx, ctx.interactiveId.slice('retry_'.length))
    return
  }

  // ── Procurement approval taps (approve_po_<id> / reject_po_<id> / review_po_<id>) ──
  // The button carries the PO id. The sender's phone is already resolved to a user via
  // wa_registered_numbers; we act AS that user through decide_purchase_order (which
  // re-checks authority + the amount limit). Review just sends the deep link.
  if (ctx.interactiveId && /^(approve|reject|review)_po_/.test(ctx.interactiveId)) {
    const [act, , ...idParts] = ctx.interactiveId.split('_')
    const poId = idParts.join('_')
    const poLink = (() => {
      const b = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app'
      try { return new URL('/purchase-orders/' + poId, b).href } catch { return 'https://briklayflow.vercel.app/purchase-orders/' + poId }
    })()
    if (act === 'review') {
      await send(supabase, from, { kind: 'cta', body: `Purchase order ${poId} — review the full details, then approve or send back.`, cta: { text: 'Review details', url: poLink } }, { org_id: orgId, wamid })
      return
    }
    const actorId = ctx.registered?.user_id ?? null
    if (!actorId) {
      await send(supabase, from, { kind: 'text', body: "We couldn't verify your account for approvals. Please review in the app." }, { org_id: orgId, wamid })
      return
    }
    const { data } = await supabase.rpc('decide_purchase_order', {
      p_po_id: poId, p_action: act === 'approve' ? 'APPROVE' : 'REJECT',
      p_remarks: `${act === 'approve' ? 'Approved' : 'Rejected'} on WhatsApp by ${ctx.senderName || from}`,
      p_actor_id: actorId,
    })
    const res = (data ?? {}) as { success?: boolean; already?: boolean; error?: string; amount?: number; limit?: number }
    let body: string
    if (res.already) body = `Purchase order ${poId} was already decided.`
    else if (res.success) body = act === 'approve' ? `✅ Approved — ${poId} is now a live order.` : `Rejected — ${poId} won't proceed.`
    else if (res.error === 'above_limit') body = `${poId} is above your approval limit — it goes to your higher approver to sign off.`
    else if (res.error === 'Not authorized to approve procurement') body = `You're not set up to approve purchases. Ask an approver to review ${poId}.`
    else body = `Couldn't record that for ${poId}. Please try in the app.`
    await send(supabase, from, { kind: 'cta', body, cta: { text: 'Open in app', url: poLink } }, { org_id: orgId, wamid })
    return
  }

  // ── Vendor-Flow test trigger: `pr single <text>` / `pr rfq <text>` ───────────
  // Deterministic (bypasses the LLM router): stage a draft PR from <text>, then send
  // the matching vendor Flow so send + receive can be exercised end-to-end. <text>
  // becomes the PR title/item so the test PR is distinguishable.
  const prTest = /^pr\s+(single|rfq)\s+([\s\S]+)/i.exec(text.trim())
  if (prTest) {
    const fctx: TxnCtx = {
      supabase, from, senderName: ctx.senderName, orgId, wamid,
      lang: 'en', interactiveId: null, flowResponse: null, image: ctx.image,
    }
    await startVendorFlow(fctx, prTest[1].toLowerCase() === 'rfq' ? 'rfq' : 'single', prTest[2].trim())
    return
  }

  // ── Three-tier read: OPEN -> lingering CLOSED -> fresh ──────────────────────
  const view = await getRouterView(supabase, orgId, from)
  const pending = view.open
    ? { agent: view.open.owning_agent ?? 'CONCIERGE', question: view.open.pending_question ?? '', slots: view.open.slots_so_far }
    : null
  const lingering = view.lingering ? { last_action_summary: view.lingering.last_action_summary ?? '' } : null

  const d = await routeMessage({ text, pending, lingering })
  const lang = d.reply_language
  // The uniform agent context (carries language + the tapped interactive id + any Flow payload).
  const actx: TxnCtx = { supabase, from, senderName: ctx.senderName, orgId, wamid, lang, interactiveId: ctx.interactiveId, flowResponse: ctx.flowResponse ?? null, image: ctx.image }

  // An INTERACTIVE reply (button tap / list pick / Flow completion) against an OPEN
  // conversation is, by construction, an ANSWER to what we asked — never a fresh
  // intent. Override any router misread (e.g. the button title "Send to a vendor"
  // classified AMBIGUOUS -> concierge). Terminal Flows echo no token, so the open
  // wa_conversation (owning_agent + staged_entry_id) IS the binding.
  const isInteractiveReply = !!(ctx.interactiveId || ctx.flowResponse)
  const decision = (view.open && isInteractiveReply) ? 'ANSWERS_PENDING' : d.decision

  const chosenAgent =
    decision === 'ANSWERS_PENDING' ? (pending?.agent ?? 'CONCIERGE')
    : decision === 'NEW_INTENT' ? (d.intent_agent ?? 'CONCIERGE')
    : 'CONCIERGE'

  await logRouterDecision(supabase, {
    orgId, sender: from, wamid, inputText: text,
    decision, intentAgent: d.intent_agent, confidence: d.confidence,
    chosenAgent, convoState: view.state,
  })

  // TRACE 2/4 -- what is PASSED TO THE AGENT (the raw text + the routing call).
  console.log('[trace] route', JSON.stringify({ agent: chosenAgent, decision, routerDecision: d.decision, lang, convo: view.state, text: text.slice(0, 300) }))

  // ── First contact (Sprint 6) ─────────────────────────────────────────────────
  // A member's FIRST-EVER message with no real intent (greeting / unclear) gets a
  // warm orientation — name, org, role, what I do, a sample command — instead of
  // generic chitchat or a disambiguation prompt. A first message that DOES carry an
  // intent (a payment) is honoured as usual, with the welcome FOLDED into that one
  // reply (capture-first: never make them repeat themselves). A returning-after-a-gap
  // member just gets a light "welcome back" folded in. Stamped once via oriented_at.
  const firstContact = ctx.firstTouch === true
  if (firstContact && (decision === 'CHITCHAT' || decision === 'AMBIGUOUS') && !QUERY_RE.test(text)) {
    await runConcierge(supabase, {
      from, orgId, wamid, text, language: lang, mode: 'orientation',
      orientation: { name: ctx.senderName, orgName: await orgNameOf(supabase, orgId), role: registered?.role ?? null },
    })
    await markOriented(supabase, from)
    return
  }
  const welcome = firstContact ? M.welcomePrefix(lang, { name: ctx.senderName })
    : ctx.dormant ? M.welcomeBack(lang, { name: ctx.senderName }) : undefined
  if (firstContact) await markOriented(supabase, from)

  // ── ANSWERS_PENDING: route by the DB's owning agent (never the LLM's) ────────
  if (decision === 'ANSWERS_PENDING') {
    const owner = agentFor(pending?.agent)
    if (owner.answer && view.open) {
      // The agent owns cancel-vs-answer (a bare "no" means "someone else" at a
      // confirm prompt, but "discard" at an amount prompt) -- see answerTransaction.
      await owner.answer(actx, text, view.open as ConvoRow)
    } else {
      await agentFor('CONCIERGE').run(actx, text, { lingering: view.lingering })
      await abandonOpenConcierge(supabase, orgId, from)
    }
    return
  }

  // ── Interruption: any non-answer while OPEN commits/closes A first. ──────────
  // An agent with a commit-interrupt handler (TRANSACTION) commits its current state
  // and returns an ack we fold into B's single message; otherwise the pending drops.
  let prefix: string | undefined
  if (view.open) {
    const owner = agentFor(view.open.owning_agent)
    if (owner.commitInterrupted) prefix = await owner.commitInterrupted(actx, view.open as ConvoRow)
    else await abandonConversation(supabase, orgId, from)
  }
  // Lead with the first-contact welcome / welcome-back, ahead of any interrupt ack.
  prefix = mergePrefix(welcome, prefix)

  switch (decision) {
    case 'NEW_INTENT': {
      const agent = agentFor(d.intent_agent)
      if (agent.intent === 'TRANSACTION') {
        await agent.run(actx, text, { prefix, lingering: view.lingering })
      } else if (QUERY_RE.test(text)) {
        if (prefix) await send(supabase, from, { kind: 'text', body: prefix }, { org_id: orgId, wamid })
        await handleQuery(supabase, text, from, registered)
      } else {
        await agent.run(actx, text, { prefix, lingering: view.lingering })
      }
      return
    }
    case 'CHITCHAT': {
      if (QUERY_RE.test(text)) {
        if (prefix) await send(supabase, from, { kind: 'text', body: prefix }, { org_id: orgId, wamid })
        await handleQuery(supabase, text, from, registered)
      } else {
        await agentFor('CONCIERGE').run(actx, text, { prefix, lingering: view.lingering })
      }
      return
    }
    case 'AMBIGUOUS': {
      await send(supabase, from, M.mDisambiguate(lang, prefix), { org_id: orgId, wamid })
      await openConversation(supabase, {
        orgId, sender: from, owningAgent: 'CONCIERGE',
        pendingQuestion: 'disambiguation: log a payment or ask a question?', lastMessageId: wamid,
      })
      return
    }
  }
}

/**
 * [Try again] replay. Re-runs the staging RPC with the EXACT held values from
 * wa_failed_writes (so the user never re-types). Success -> the normal confirmation
 * + reaction, and the replay row is cleared. Re-failure -> runTransaction throws
 * WriteCommitFailed after enqueuing a FRESH failure message (new replay); we leave
 * the old row for the TTL sweep and let the throw mark the job FAILED. Expired or
 * missing replay_id -> a gentle "just send it again" (never a crash).
 */
async function handleRetry(ctx: DispatchCtx, replayId: string): Promise<void> {
  const { supabase, from, senderName, orgId, wamid } = ctx
  const { data: row } = await supabase
    .from('wa_failed_writes')
    .select('*')
    .eq('replay_id', replayId).eq('org_id', orgId)
    .maybeSingle()

  if (!row || (row.expires_at && new Date(row.expires_at) < new Date())) {
    await send(supabase, from, M.mReplayExpired('en'), { org_id: orgId, wamid })
    return
  }

  const p = (row.parsed ?? {}) as any
  const lang = (p.lang ?? 'en') as Lang
  const ext: TxnExtract = {
    amount: p.amount ?? null, amount_confidence: p.amount_confidence ?? null,
    amount_source_phrase: p.amount_source_phrase ?? null,
    payee: p.payee ?? p.raw ?? null, project: p.project ?? null,
    direction: p.direction ?? null, mode: p.mode ?? null, note: p.note ?? null, ref: null,
  }
  const txnCtx: TxnCtx = { supabase, from, senderName, orgId, wamid, lang, interactiveId: null }

  // Re-stage at the entry's ORIGINAL key (wamid + index from parsed) so a retry that
  // actually raced through no-ops instead of duplicating. Legacy rows (no wamid/index)
  // fall back to this message's wamid + index 0 — unchanged single-entry behaviour.
  // Throws WriteCommitFailed on a re-failure (a fresh failure message is sent inside).
  await runTransaction(txnCtx, p.raw_text ?? '', {
    preExtract: ext,
    keyWamid: (p.wamid as string) ?? wamid,
    entryIndex: typeof p.entry_index === 'number' ? p.entry_index : 0,
  })
  // Reached only on success -> clear the replay row.
  await supabase.from('wa_failed_writes').delete().eq('replay_id', replayId)
}

/**
 * [Try again] for a multi-failure batch. Loads every still-held failed entry for the
 * ORIGINAL message and re-stages each by its own key (idempotent), then sends one fresh
 * aggregated card. Rows that land are cleared inside retryBatchEntries.
 */
async function handleRetryBatch(ctx: DispatchCtx, originalWamid: string): Promise<void> {
  const { supabase, from, orgId, wamid } = ctx
  const { data: rows } = await supabase
    .from('wa_failed_writes')
    .select('replay_id, parsed, expires_at')
    .eq('org_id', orgId).eq('sender', from)
  const now = new Date()
  const mine = (rows ?? []).filter((r: any) =>
    (r.parsed?.wamid) === originalWamid && (!r.expires_at || new Date(r.expires_at) >= now))
  if (mine.length === 0) {
    await send(supabase, from, M.mReplayExpired('en'), { org_id: orgId, wamid })
    return
  }
  const lang = (mine[0].parsed?.lang ?? 'en') as Lang
  const txnCtx: TxnCtx = { supabase, from, senderName: ctx.senderName, orgId, wamid, lang, interactiveId: null }
  await retryBatchEntries(txnCtx, mine.map((r: any) => ({ replay_id: r.replay_id, parsed: r.parsed ?? {} })))
}

/** Concierge never leaves a lingering pending: drop any OPEN concierge convo. */
async function abandonOpenConcierge(supabase: any, orgId: string, from: string): Promise<void> {
  const view = await getRouterView(supabase, orgId, from)
  if (view.open && view.open.owning_agent === 'CONCIERGE') await abandonConversation(supabase, orgId, from)
}
