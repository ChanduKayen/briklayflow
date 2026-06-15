// WhatsApp -- agent registry (ITV → Router → Agent pattern).
//
// The single place that binds a router INTENT to the agent that owns it. The router
// classifies (intent + conversation-state); the dispatcher looks the intent up HERE
// and invokes the agent's own understanding + deterministic policy. Adding an agent =
// adding ONE entry below (its intent + its handlers) — NOT editing dispatcher branches.
//
// This file changes NO routing DECISION. The dispatcher still decides ANSWERS_PENDING
// vs NEW_INTENT vs CHITCHAT vs AMBIGUOUS and which agent owns the turn (router intent /
// stored owning-agent). The registry only resolves "which function runs for this
// agent." Conversation-state machinery stays in _dispatch.ts.

import type { ConvoRow } from './_conversation.ts'
import type { TxnCtx } from './_agents/transaction.ts'
import { runTransaction, answerTransaction, commitInterrupted } from './_agents/transaction.ts'
import { runConcierge } from './_agents/concierge.ts'

// The uniform turn context the dispatcher hands any agent. (The transaction agent's
// TxnCtx already carries exactly these fields, so it consumes this directly.)
export type AgentCtx = TxnCtx

export type TurnOpts = {
  prefix?: string                 // consolidated-interrupt ack to fold into the reply
  lingering?: ConvoRow | null     // most-recent CLOSED convo (reference resolution)
}

export type AgentDef = {
  intent: string
  // NEW_INTENT entry: the agent's own understanding + deterministic policy.
  run(ctx: AgentCtx, text: string, opts: TurnOpts): Promise<void>
  // ANSWERS_PENDING resume — only agents that leave a pending question implement this.
  answer?(ctx: AgentCtx, text: string, convo: ConvoRow): Promise<void>
  // Interrupt: commit current state, return an ack folded into the interrupting reply.
  commitInterrupted?(ctx: AgentCtx, convo: ConvoRow): Promise<string>
}

// Concierge adapter — also the bridge target for not-yet-built agents.
function conciergeRun(ctx: AgentCtx, text: string, opts: TurnOpts): Promise<void> {
  return runConcierge(ctx.supabase, {
    from: ctx.from, orgId: ctx.orgId, wamid: ctx.wamid, text, language: ctx.lang,
    lingering: opts.lingering ? { last_action_summary: opts.lingering.last_action_summary ?? '' } : null,
    prefix: opts.prefix,
  })
}

const TRANSACTION: AgentDef = {
  intent: 'TRANSACTION',
  run: (ctx, text, opts) => runTransaction(ctx, text, { prefix: opts.prefix, lingering: opts.lingering }),
  answer: (ctx, text, convo) => answerTransaction(ctx, text, convo),
  commitInterrupted: (ctx, convo) => commitInterrupted(ctx, convo),
}

const CONCIERGE: AgentDef = { intent: 'CONCIERGE', run: conciergeRun }

// Registered intents the router may emit but whose agents aren't built yet: they
// bridge to the concierge ("coming soon"). Swapping in the real agent is a one-line
// change HERE — the dispatcher never changes.
const PROCUREMENT: AgentDef = { intent: 'PROCUREMENT', run: conciergeRun }
const SITEOPS: AgentDef = { intent: 'SITEOPS', run: conciergeRun }

export const AGENTS: Record<string, AgentDef> = { TRANSACTION, CONCIERGE, PROCUREMENT, SITEOPS }

/** Resolve a router intent (or stored owning-agent) to its agent; unknown -> concierge. */
export function agentFor(intent: string | null | undefined): AgentDef {
  return (intent && AGENTS[intent]) || CONCIERGE
}
