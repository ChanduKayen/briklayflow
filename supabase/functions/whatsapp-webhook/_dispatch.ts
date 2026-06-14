// WhatsApp Sprint 4 dispatcher. Router classifies; THIS owns control flow + state
// in wa_conversations. TRANSACTION now routes to the real Transaction agent (the
// Sprint-3 legacy bridge + wa_sessions mirror are retired). Reporting/data queries
// still bridge to the legacy handleQuery until a Reporting agent exists.

import { routeMessage } from './_router.ts'
import {
  getRouterView, openConversation, abandonConversation, logRouterDecision, type ConvoRow,
} from './_conversation.ts'
import { runConcierge } from './_agents/concierge.ts'
import {
  runTransaction, answerTransaction, commitInterrupted, cancelTransaction, type TxnCtx,
} from './_agents/transaction.ts'
import { send } from './_format.ts'
import { handleQuery } from './_handlers.ts'   // reporting/query bridge only

export type DispatchCtx = {
  supabase: any
  from: string
  senderName: string
  registered: any
  wamid: string
  orgId: string
}

// Reporting/data query the router doesn't model yet -> legacy handleQuery bridge.
const QUERY_RE = /how\s*much|how much|balance|pending|due|outstanding|ledger|total|statement|enta|entha|evariki|\?$/i

// Explicit cancel/negation (distinct from interrupt). The router returns
// ANSWERS_PENDING for any bare yes/no with pending; we split cancel here.
const CANCEL = new Set(['no', 'nope', 'nah', 'cancel', 'stop', 'wrong', 'vaddu', 'వద్దు', 'kaadu', 'kadu', 'nahi', 'nahin', 'cheyyaddu'])
function isCancel(t: string): boolean {
  return CANCEL.has(t.trim().toLowerCase().replace(/[!.?]+$/, ''))
}

export async function dispatch(ctx: DispatchCtx, text: string): Promise<void> {
  const { supabase, from, registered, wamid, orgId } = ctx
  const txnCtx: TxnCtx = { supabase, from, senderName: ctx.senderName, orgId, wamid }

  // ── Three-tier read: OPEN -> lingering CLOSED -> fresh ──────────────────────
  const view = await getRouterView(supabase, orgId, from)
  const pending = view.open
    ? { agent: view.open.owning_agent ?? 'CONCIERGE', question: view.open.pending_question ?? '', slots: view.open.slots_so_far }
    : null
  const lingering = view.lingering ? { last_action_summary: view.lingering.last_action_summary ?? '' } : null

  const d = await routeMessage({ text, pending, lingering })
  const lang = d.reply_language
  const chosenAgent =
    d.decision === 'ANSWERS_PENDING' ? (pending?.agent ?? 'CONCIERGE')
    : d.decision === 'NEW_INTENT' ? (d.intent_agent ?? 'CONCIERGE')
    : 'CONCIERGE'

  await logRouterDecision(supabase, {
    orgId, sender: from, wamid, inputText: text,
    decision: d.decision, intentAgent: d.intent_agent, confidence: d.confidence,
    slotHints: d.slot_hints, chosenAgent, convoState: view.state,
  })

  // ── ANSWERS_PENDING: route by the DB's owning agent (never the LLM's) ────────
  if (d.decision === 'ANSWERS_PENDING') {
    if (pending?.agent === 'TRANSACTION' && view.open) {
      if (isCancel(text)) await cancelTransaction(txnCtx, view.open as ConvoRow)
      else await answerTransaction(txnCtx, text, view.open as ConvoRow)
    } else {
      await runConcierge(supabase, { from, orgId, wamid, text, language: lang, lingering })
      await abandonOpenConcierge(supabase, orgId, from)
    }
    return
  }

  // ── Interruption: any non-answer while OPEN commits/closes A first. ──────────
  // A TRANSACTION commits its current state (or fails on no-amount) and returns an
  // ack we fold into B's single message. A CONCIERGE pending is just dropped.
  let prefix: string | undefined
  if (view.open) {
    if (view.open.owning_agent === 'TRANSACTION') prefix = await commitInterrupted(txnCtx, view.open as ConvoRow)
    else await abandonConversation(supabase, orgId, from)
  }

  switch (d.decision) {
    case 'NEW_INTENT': {
      if (d.intent_agent === 'TRANSACTION') {
        await runTransaction(txnCtx, text, { prefix, lingering: view.lingering })
      } else if (QUERY_RE.test(text)) {
        if (prefix) await send(supabase, from, { kind: 'text', body: prefix }, { org_id: orgId, wamid })
        await handleQuery(supabase, text, from, registered)
      } else {
        await runConcierge(supabase, { from, orgId, wamid, text, language: lang, lingering, prefix })
      }
      return
    }
    case 'CHITCHAT': {
      if (QUERY_RE.test(text)) {
        if (prefix) await send(supabase, from, { kind: 'text', body: prefix }, { org_id: orgId, wamid })
        await handleQuery(supabase, text, from, registered)
      } else {
        await runConcierge(supabase, { from, orgId, wamid, text, language: lang, lingering, prefix })
      }
      return
    }
    case 'AMBIGUOUS': {
      await send(supabase, from, {
        kind: 'buttons',
        body: (prefix ? prefix + '\n\n' : '') + "I didn't quite catch that -- what would you like to do?",
        buttons: [
          { id: 'disamb_log', title: 'Log a payment' },
          { id: 'disamb_ask', title: 'Ask a question' },
        ],
      }, { org_id: orgId, wamid })
      await openConversation(supabase, {
        orgId, sender: from, owningAgent: 'CONCIERGE',
        pendingQuestion: 'disambiguation: log a payment or ask a question?', lastMessageId: wamid,
      })
      return
    }
  }
}

/** Concierge never leaves a lingering pending: drop any OPEN concierge convo. */
async function abandonOpenConcierge(supabase: any, orgId: string, from: string): Promise<void> {
  const view = await getRouterView(supabase, orgId, from)
  if (view.open && view.open.owning_agent === 'CONCIERGE') await abandonConversation(supabase, orgId, from)
}
