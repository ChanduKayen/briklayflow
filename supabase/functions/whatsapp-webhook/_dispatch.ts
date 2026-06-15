// WhatsApp Sprint 4 dispatcher. Router classifies; THIS owns control flow + state
// in wa_conversations. TRANSACTION now routes to the real Transaction agent (the
// Sprint-3 legacy bridge + wa_sessions mirror are retired). Reporting/data queries
// still bridge to the legacy handleQuery until a Reporting agent exists.

import { routeMessage } from './_router.ts'
import {
  getRouterView, openConversation, abandonConversation, logRouterDecision, type ConvoRow,
} from './_conversation.ts'
import { agentFor } from './_registry.ts'
import { runTransaction, type TxnCtx } from './_agents/transaction.ts'   // direct: the replay path
import { send } from './_format.ts'
import * as M from './_messages.ts'
import type { Lang } from './_messages.ts'
import type { TxnExtract } from './_extract.ts'
import { handleQuery } from './_handlers.ts'   // reporting/query bridge only

const LINK = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app/logbook'

export type DispatchCtx = {
  supabase: any
  from: string
  senderName: string
  registered: any
  wamid: string
  orgId: string
  interactiveId: string | null   // Sprint 5: id of a tapped LIST row / reply button
  image?: { base64: string; mime: string; caption: string }   // payment-image -> agent vision extraction
}

// Reporting/data query the router doesn't model yet -> legacy handleQuery bridge.
const QUERY_RE = /how\s*much|how much|balance|pending|due|outstanding|ledger|total|statement|enta|entha|evariki|\?$/i

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
  if (ctx.interactiveId?.startsWith('retry_')) {
    await handleRetry(ctx, ctx.interactiveId.slice('retry_'.length))
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
  // The uniform agent context (carries language + the tapped interactive id).
  const actx: TxnCtx = { supabase, from, senderName: ctx.senderName, orgId, wamid, lang, interactiveId: ctx.interactiveId, image: ctx.image }
  const chosenAgent =
    d.decision === 'ANSWERS_PENDING' ? (pending?.agent ?? 'CONCIERGE')
    : d.decision === 'NEW_INTENT' ? (d.intent_agent ?? 'CONCIERGE')
    : 'CONCIERGE'

  await logRouterDecision(supabase, {
    orgId, sender: from, wamid, inputText: text,
    decision: d.decision, intentAgent: d.intent_agent, confidence: d.confidence,
    chosenAgent, convoState: view.state,
  })

  // TRACE 2/4 -- what is PASSED TO THE AGENT (the raw text + the routing call).
  console.log('[trace] route', JSON.stringify({ agent: chosenAgent, decision: d.decision, lang, convo: view.state, text: text.slice(0, 300) }))

  // ── ANSWERS_PENDING: route by the DB's owning agent (never the LLM's) ────────
  if (d.decision === 'ANSWERS_PENDING') {
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

  switch (d.decision) {
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

  // Throws WriteCommitFailed on a re-failure (a fresh failure message is sent inside);
  // that propagates to processJob, which marks the job FAILED without a generic message.
  await runTransaction(txnCtx, p.raw_text ?? '', { preExtract: ext })
  // Reached only on success -> clear the replay row.
  await supabase.from('wa_failed_writes').delete().eq('replay_id', replayId)
}

/** Concierge never leaves a lingering pending: drop any OPEN concierge convo. */
async function abandonOpenConcierge(supabase: any, orgId: string, from: string): Promise<void> {
  const view = await getRouterView(supabase, orgId, from)
  if (view.open && view.open.owning_agent === 'CONCIERGE') await abandonConversation(supabase, orgId, from)
}
