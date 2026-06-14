// WhatsApp Sprint 3 -- dispatcher. Router classifies; THIS owns control flow and
// conversation state in wa_conversations. Transaction bridge = approach (b): the
// legacy handlers keep using wa_sessions internally; we MIRROR their post-call
// state into wa_conversations (the router's source of truth) and abandon both on
// interrupt. The bridge is throwaway -- Sprint 4's agent uses wa_conversations.

import { routeMessage } from './_router.ts'
import {
  getRouterView, openConversation, closeConversation, abandonConversation, logRouterDecision,
} from './_conversation.ts'
import { runConcierge } from './_agents/concierge.ts'
import { send } from './_format.ts'
import { handleFinancial, handleQuery, handleSessionReply, processExpiredImageEntries } from './_handlers.ts'
import { getSession, clearSession, type WaSessionState } from './_session.ts'

export type DispatchCtx = {
  supabase: any
  from: string
  senderName: string
  registered: any
  wamid: string
  orgId: string
}

// A data query the router doesn't model yet (no Reporting agent). Preserve the
// working balance feature via a small bridge to the legacy query handler.
const QUERY_RE = /how\s*much|how much|balance|pending|due|outstanding|ledger|total|statement|enta|entha|evariki|\?$/i

export async function dispatch(ctx: DispatchCtx, text: string): Promise<void> {
  const { supabase, from, senderName, registered, wamid, orgId } = ctx

  // Legacy maintenance (AWAITING_CONTEXT cleanup) -- unchanged behavior.
  await processExpiredImageEntries(supabase, from, senderName)
    .catch((e) => console.error('[dispatch] processExpiredImageEntries error:', e))

  // ── Three-tier read: OPEN -> lingering CLOSED -> fresh ──────────────────────
  const view = await getRouterView(supabase, orgId, from)
  const pending = view.open
    ? { agent: view.open.owning_agent ?? 'CONCIERGE', question: view.open.pending_question ?? '', slots: view.open.slots_so_far }
    : null
  const lingering = view.lingering ? { last_action_summary: view.lingering.last_action_summary ?? '' } : null

  // ── Route (classification only) ─────────────────────────────────────────────
  const d = await routeMessage({ text, pending, lingering })
  const lang = d.reply_language

  const chosenAgent =
    d.decision === 'ANSWERS_PENDING' ? (pending?.agent ?? 'CONCIERGE')
    : d.decision === 'NEW_INTENT'    ? (d.intent_agent ?? 'CONCIERGE')
    : 'CONCIERGE'

  // Decision log on EVERY router call (T3.4).
  await logRouterDecision(supabase, {
    orgId, sender: from, wamid, inputText: text,
    decision: d.decision, intentAgent: d.intent_agent, confidence: d.confidence,
    slotHints: d.slot_hints, chosenAgent, convoState: view.state,
  })

  // Interruption: ANY non-answer while a conversation is OPEN parks it (keep slots)
  // and abandons the legacy session. No scolding (DoD #4). ANSWERS_PENDING does not park.
  if (d.decision !== 'ANSWERS_PENDING' && view.open) {
    await abandonConversation(supabase, orgId, from)
    await clearSession(supabase, from)
  }

  // ── Control flow from VALIDATED ENUMS ONLY (never echoed free text, T3.2) ───
  switch (d.decision) {
    case 'ANSWERS_PENDING': {
      if (pending?.agent === 'TRANSACTION') {
        await transactionReply(ctx, text)
      } else {
        // Concierge-owned pending (e.g. a disambiguation) -> concierge resolves.
        await runConcierge(supabase, { from, orgId, wamid, text, language: lang, lingering })
        await closeConcierge(supabase, orgId, from)
      }
      return
    }

    case 'NEW_INTENT': {
      if (d.intent_agent === 'TRANSACTION') {
        await transactionNew(ctx, text)
      } else {
        // PROCUREMENT / SITEOPS not built -> concierge handles honestly. Queries
        // bridge to the legacy reporting handler.
        if (QUERY_RE.test(text)) {
          await handleQuery(supabase, text, from, registered)
        } else {
          await runConcierge(supabase, { from, orgId, wamid, text, language: lang, lingering })
        }
        await closeConcierge(supabase, orgId, from)
      }
      return
    }

    case 'CHITCHAT': {
      if (QUERY_RE.test(text)) {
        await handleQuery(supabase, text, from, registered)   // query bridge
      } else {
        await runConcierge(supabase, { from, orgId, wamid, text, language: lang, lingering })
      }
      await closeConcierge(supabase, orgId, from)
      return
    }

    case 'AMBIGUOUS': {
      // One disambiguation via buttons; set a short-lived CONCIERGE pending so the
      // next turn resolves. (Exercises the interactive renderer.)
      await send(supabase, from, {
        kind: 'buttons',
        body: "I didn't quite catch that — what would you like to do?",
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

// ── Transaction bridge (approach b): mirror wa_sessions -> wa_conversations ──────

async function transactionNew(ctx: DispatchCtx, text: string): Promise<void> {
  const { supabase, from, senderName, registered, orgId, wamid } = ctx
  await handleFinancial(supabase, text, from, senderName, registered)
  await mirrorTxnState(supabase, orgId, from, wamid)
}

async function transactionReply(ctx: DispatchCtx, text: string): Promise<void> {
  const { supabase, from, senderName, registered, orgId, wamid } = ctx
  const session = await getSession(supabase, from)
  if (session) {
    const asText = { type: 'text', text: { body: text }, from, id: wamid }
    await handleSessionReply(supabase, session, asText, from, senderName)
  } else {
    // wa_conversations said OPEN but the legacy session expired (10-min TTL) --
    // treat the message as a fresh entry rather than dropping it.
    await handleFinancial(supabase, text, from, senderName, registered)
  }
  await mirrorTxnState(supabase, orgId, from, wamid)
}

/** After a legacy txn handler runs: session present -> OPEN(pending); else CLOSED(lingering). */
async function mirrorTxnState(supabase: any, orgId: string, from: string, wamid: string): Promise<void> {
  const session = await getSession(supabase, from)
  if (session) {
    await openConversation(supabase, {
      orgId, sender: from, owningAgent: 'TRANSACTION',
      pendingQuestion: questionForState(session.state),
      slots: session.context ?? {},
      stagedEntryId: session.rough_entry_id ?? null,
      lastMessageId: wamid,
    })
  } else {
    await closeConversation(supabase, {
      orgId, sender: from, lastActionSummary: await summarizeLastEntry(supabase, from), lastMessageId: wamid,
    })
  }
}

function questionForState(state: WaSessionState): string {
  switch (state) {
    case 'AWAIT_AMOUNT':       return 'How much was paid?'
    case 'AWAIT_PAYEE':        return 'Who was paid?'
    case 'AWAIT_PAYEE_CHOICE': return 'Which person? (reply with the number)'
    case 'AWAIT_PROJECT':      return 'Which project? (reply with the number)'
    case 'AWAIT_IMAGE_CONTEXT':return 'Any details about that image?'
    default:                   return 'Please continue.'
  }
}

async function summarizeLastEntry(supabase: any, from: string): Promise<string> {
  const { data } = await supabase
    .from('rough_entries')
    .select('ai_extracted')
    .eq('sender_number', from)
    .order('created_at', { ascending: false })
    .limit(1).maybeSingle()
  const ex = (data?.ai_extracted ?? {}) as any
  const payee = ex.payee_name || ex.payee_raw || ''
  const amt = ex.amount ? `₹${ex.amount}` : ''
  return `Saved a payment${payee ? ` to ${payee}` : ''}${amt ? ` (${amt})` : ''}.`
}

/** Concierge never leaves a lingering pending: clear any OPEN concierge convo. */
async function closeConcierge(supabase: any, orgId: string, from: string): Promise<void> {
  const view = await getRouterView(supabase, orgId, from)
  if (view.open && view.open.owning_agent === 'CONCIERGE') {
    await abandonConversation(supabase, orgId, from)
  }
}
