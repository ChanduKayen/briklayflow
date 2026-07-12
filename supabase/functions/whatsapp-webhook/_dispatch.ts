// WhatsApp Sprint 4 dispatcher. Router classifies; THIS owns control flow + state
// in wa_conversations. TRANSACTION now routes to the real Transaction agent (the
// Sprint-3 legacy bridge + wa_sessions mirror are retired). Reporting/data queries
// still bridge to the legacy handleQuery until a Reporting agent exists.

import { routeMessage } from './_router.ts'
import {
  getRouterView, openConversation, closeConversation, abandonConversation, logRouterDecision, type ConvoRow,
} from './_conversation.ts'
import { agentFor } from './_registry.ts'
import { runTransaction, retryBatchEntries, type TxnCtx } from './_agents/transaction.ts'   // direct: the replay path
import { startVendorFlow } from './_agents/procurement.ts'   // direct: vendor-Flow test trigger
import { runConcierge } from './_agents/concierge.ts'   // direct: first-touch orientation
import { classifyPhotoFollowup, stampPossibleFollowup, handleQuotedReply, handleUndoResolve, type SiteopsCtx } from './_agents/siteops.ts'   // STEP 2/4b: photo window + readback-correction steering; 2b: undo
import { send, sendNow } from './_format.ts'
import * as M from './_messages.ts'
import type { Lang } from './_messages.ts'
import type { TxnExtract } from './_extract.ts'
import { handleQuery } from './_handlers.ts'   // reporting/query bridge only
import { loadHistory } from './_history.ts'   // the conversation the router reads
import { resurfaceBody, pendingSubjectOf, deferredOf, snapshotPending, type DeferredPending } from './_pending.ts'   // pure renderers + deferral snapshot for the credibility flow

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
  quotedWamid?: string | null    // wamid of a quoted/replied-to message (Cloud API context.id) — the PRIMARY
                                 // association signal for SiteOps photo↔text (a reply binds deterministically,
                                 // even after the association window lapsed). Consumed by the siteops flow.
  flowResponse?: Record<string, unknown> | null   // decoded WhatsApp Flow completion (nfm_reply.response_json)
  // payment-image -> agent vision extraction; storagePath (rough-entry-media) → siteops attachment.
  // `description` is OUR read of the pixels, carried beside the caption (never glued to it) — see _siteops_media.ts.
  image?: { base64: string; mime: string; caption: string; description?: string | null; storagePath?: string | null }
  audio?: { storagePath: string; mime: string }   // VOICE note's already-stored audio (rough-entry-media) → siteops records it findable (T7 clause 1)
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
// NAMED for what it matches: the MONEY/REPORT bridge to the legacy handleQuery. It stays ONLY until a
// Reporting agent exists — deleting it today would strand every "how much did I pay Ramesh" with the
// concierge. It must never again be read as "is this a question?".
//
// DELETED (2026-07-09): isAssistantQuestion / HELP_PHRASE_RE — a per-language list of capability phrases,
// written to stop the B3 chase-batch override (also deleted) from swallowing "what can you do?". It was a
// guard on a hack: it could only ever BLOCK a misroute, never route, and it needed a new entry for every
// language, phrasing and transcription. The router reads the conversation now and needs neither.
const MONEY_QUERY_RE = /how\s*much|balance|pending|due|outstanding|ledger|\btotal\b|statement|enta|entha|evariki/i

// ── Agent-agnostic pending-question credibility ──────────────────────────────
// A question we asked (ANY agent's) can be interrupted by a new turn. The DISPATCHER — never the agent —
// owns the interrupted question's fate: it stashes it, handles the turn, then RE-SURFACES it (with a Dismiss
// button) or DROPS it with a notice. The PURE renderers (resurfaceBody / pendingSubjectOf) live in _pending.ts
// so they're unit-testable without the dispatcher's IO; resurfacePending below wires them to the DB + send.

// A held question — a live ConvoRow or a deferred snapshot — carries exactly the fields re-surface needs.
type HeldQuestion = { owning_agent: string | null; pending_question: string | null; slots_so_far?: Record<string, unknown> | null; staged_entry_id?: string | null }

/** Re-open the held question EXACTLY as it was (its slots ride along → drain groups, held items and
 *  candidates all restored) and re-send it with a Dismiss button. `preamble` prefixes it (the ambiguous
 *  "didn't catch that" note). The Dismiss button id is uniform (`pending_dismiss`) — handled at dispatch top. */
async function resurfacePending(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, ids: { orgId: string; from: string; wamid: string }, p: HeldQuestion, lang: Lang, preamble?: string,
): Promise<void> {
  await openConversation(supabase, {
    orgId: ids.orgId, sender: ids.from, owningAgent: p.owning_agent ?? 'CONCIERGE',
    pendingQuestion: p.pending_question ?? '', slots: p.slots_so_far ?? {},
    stagedEntryId: p.staged_entry_id ?? null, lastMessageId: ids.wamid,
  })
  const body = (preamble ? preamble + '\n\n' : '') + resurfaceBody(p, lang)
  await send(supabase, ids.from, { kind: 'buttons', body, buttons: [{ id: 'pending_dismiss', title: M.pendingDismissLabel(lang) }] }, { org_id: ids.orgId, wamid: ids.wamid })
}

// ── THE 30-MINUTE RULE ───────────────────────────────────────────────────────────────────────────────────
// A question that has gone unanswered for half an hour, while the sender kept messaging about other things,
// is one he has decided not to answer. Re-showing it a fourth time is nagging. We RETIRE it: the agent
// disposes of it honestly (park — the observation survives in the review list), and we say so, once.
//
// Age is measured from when the question was FIRST asked (slots.first_asked_at, stamped by openConversation),
// never from the last time it was re-shown — otherwise every interruption renews its lease and it never ages.
//
// The clock only decides the fate of a question the sender did NOT answer: this runs on the interruption
// path, after the router has already ruled the message a new turn. An answer that arrives at minute 31 is
// still an answer, and is honoured. (Scoped to SITEOPS: a TRANSACTION question holds a staged entry whose
// disposal is a commit, not a park — it keeps its own lifecycle and the 24h sweep.)
const PENDING_TTL_MIN = 30

/** Minutes since the question was FIRST asked (not since it was last re-surfaced). */
export function pendingAgeMins(p: { slots_so_far?: Record<string, unknown> | null; opened_at?: string | null }, now: number = Date.now()): number {
  const slots = (p.slots_so_far ?? {}) as Record<string, unknown>
  const stamp = (typeof slots.first_asked_at === 'string' ? slots.first_asked_at : null) ?? p.opened_at ?? null
  const t = stamp ? new Date(stamp).getTime() : NaN
  return Number.isFinite(t) ? Math.max(0, Math.floor((now - t) / 60_000)) : 0
}

/** Retire an aged-out question: the owning agent parks it (no drop), and the sender is told, once.
 *  Returns true when it was retired — the caller then handles the turn as if nothing had been pending. */
async function retireStalePending(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, actx: TxnCtx, ids: { orgId: string; from: string; wamid: string }, p: ConvoRow, lang: Lang,
): Promise<boolean> {
  if (p.owning_agent !== 'SITEOPS') return false
  if (pendingAgeMins(p) < PENDING_TTL_MIN) return false
  const dispose = agentFor('SITEOPS').commitInterrupted
  if (!dispose) return false
  console.log(`[dispatch] pending retired — unanswered for ${pendingAgeMins(p)}m (ttl=${PENDING_TTL_MIN}m)`)
  await dispose(actx, p)   // parks the observation + closes the conversation; never a drop
  await send(supabase, ids.from, M.pendingRetiredNotice(lang, pendingSubjectOf(p)), { org_id: ids.orgId, wamid: ids.wamid })
  return true
}

/** DEFER a held question behind an open one: it rides that convo's slots as `deferred_pending`, to re-surface
 *  when that convo's chain finishes. Never drops — the older question is preserved verbatim. */
async function carryDeferredOnto(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: any, convo: ConvoRow, deferred: DeferredPending,
): Promise<void> {
  const slots = { ...((convo.slots_so_far ?? {}) as Record<string, unknown>), deferred_pending: deferred }
  const { error } = await supabase.from('wa_conversations').update({ slots_so_far: slots }).eq('id', convo.id)
  if (error) console.error('[dispatch] carryDeferredOnto error:', error)
}

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
  // THE CONVERSATION — the recent turns of this thread, including OUR outbound ones. This replaces the
  // one-line `lingering` summary the router used to get (which a real lingering conversation also SHADOWED,
  // so the chase digest never reached it). The current inbound message is already logged, so exclude it.
  const history = await loadHistory(supabase, from, wamid)

  // ONE CLASSIFIER. The router reads PENDING + HISTORY + the message and decides; its answer is FINAL.
  // The chase batch is NOT consulted here any more. It was a routing bias (B3: batchOpen + CHITCHAT →
  // SITEOPS), which overrode a model that had already answered correctly — most visibly on 2026-07-09, when
  // a Telugu "what tasks can you do?" (CHITCHAT/CONCIERGE, confidence 1.0) was forced into SITEOPS, run
  // through decompose, and answered "Didn't catch a site update in that."
  //
  // The batch is what siteops.ts has always called it in its own comments — "a prior … NEVER a router". It
  // now serves exactly two jobs, both inside the agent: ranking/injecting the ⭐ chased candidates, and
  // dropBatchItems bookkeeping. Whether a chase is open is legible to the router from HISTORY (the digest
  // is an assistant turn) — as a FACT to reason over, never as a gate that decides for it.
  const d = await routeMessage({ text, pending, history })
  const lang = d.reply_language
  // The uniform agent context (carries language + the tapped interactive id + any Flow payload).
  const actx: TxnCtx = { supabase, from, senderName: ctx.senderName, orgId, wamid, lang, interactiveId: ctx.interactiveId, flowResponse: ctx.flowResponse ?? null, image: ctx.image, audio: ctx.audio }

  // ── Dismiss tap on a RE-SURFACED pending question (agent-agnostic) ───────────
  // The credibility flow re-shows an interrupted question with a Dismiss button (`pending_dismiss`). A TAP is
  // the ONLY way to drop it — any TEXT goes through the normal router (referent rule: the model decides, no
  // keyword guesses). Q1: drop + tell, don't store. Placed before the "interactive reply ⇒ ANSWERS_PENDING"
  // binding below so the tap is never mistaken for an answer to the question it dismisses.
  if (ctx.interactiveId === 'pending_dismiss') {
    await closeConversation(supabase, { orgId, sender: from, lastActionSummary: 'pending dismissed' })
    await send(supabase, from, M.pendingDismissedAck(lang), { org_id: orgId, wamid })
    return
  }

  // ── STEP 4b: a QUOTED-REPLY to one of OUR sent messages (context.id ∈ wa_message_map, Step 4a). A
  //    reply to a task READBACK is an authoritative correction — resolve the mapped objects and apply
  //    the edit, PREEMPTING normal routing. The map keys OUTBOUND wamids, so this never fires on a reply
  //    to the user's own photo (the enrichment window matches the INBOUND photo wamid below). Only a
  //    text reply carries a correction; a photo reply stays a fresh observation (handled downstream).
  // v2 UNDO (2b) — a "Not resolved" tap on a resolve readback. The tap carries interactiveId='siteops_undo'
  // + quotedWamid (the readback's wamid); resolve back through the 4a map to that specific resolve event and
  // reopen it (bounded to the event, idempotent, stale-safe). Preempts normal routing.
  if (ctx.interactiveId === 'siteops_undo' && ctx.quotedWamid) {
    const sctx: SiteopsCtx = { supabase, from, orgId, wamid, lang }
    if (await handleUndoResolve(sctx, ctx.quotedWamid)) return
  }

  if (ctx.quotedWamid && !ctx.image && await handleQuotedReply(actx, text, ctx.quotedWamid)) return

  // An INTERACTIVE reply (button tap / list pick / Flow completion) against an OPEN
  // conversation is, by construction, an ANSWER to what we asked — never a fresh
  // intent. Override any router misread (e.g. the button title "Send to a vendor"
  // classified AMBIGUOUS -> concierge). Terminal Flows echo no token, so the open
  // wa_conversation (owning_agent + staged_entry_id) IS the binding.
  const isInteractiveReply = !!(ctx.interactiveId || ctx.flowResponse)
  let decision = (view.open && isInteractiveReply) ? 'ANSWERS_PENDING' : d.decision
  let intentAgent = d.intent_agent
  // (B3 lived here — deleted 2026-07-09. See the routeMessage call above.)

  // An IMAGE can't answer a SITEOPS pick. Every open SITEOPS wa_conversation pick asks for a CHOICE —
  // "which task?" / "which project?" / "which item is this photo about?" / "which site?" — answered by a
  // number or a name, never by a photo. So a photo arriving while a SITEOPS pick is open is a NEW
  // observation, not that pick's answer; the router only shunted it ANSWERS_PENDING off the thin one-line
  // describeImage text, which can't tell answer from new. Route it NEW_INTENT so it grounded-classifies
  // fresh in runSiteops (where project + candidate context lives), and let the credibility flow below STASH
  // the open pick and re-surface it afterward (or drop it with a notice if the photo's own turn raises a
  // question) — instead of orphaning the photo as an answer it structurally cannot be. Chase-reply photos are
  // UNAFFECTED BY CONSTRUCTION: a chase lives in
  // chase_batches, consulted only when `pending` is null (see getOpenBatch above), so no wa_conversation
  // pending exists for a chase reply and this predicate cannot fire on it — the role='answer' path stands.
  if (decision === 'ANSWERS_PENDING' && ctx.image && pending?.agent === 'SITEOPS') {
    decision = 'NEW_INTENT'; intentAgent = 'SITEOPS'
  }

  // ── STEP 2: a TEXT arriving while a siteops_photo ENRICHMENT WINDOW is open. Steer it, reusing existing
  //    machinery rather than a new interaction:
  //      RELATED   → answer (enrich the same objects); then answerSiteops closes the window.
  //      NOOP      → a bare "ok"/"haan" (readback ack) → close the window clean, no re-route.
  //      UNRELATED → (incl. uncertain + expired — the chosen fail-safe) re-classify FRESH so it reaches its
  //                  REAL agent ("send 50 bags cement" → procurement), stamp possible_photo_followup for
  //                  Step 3, and let the credibility flow below STASH the window and re-surface it (Dismiss
  //                  button) after the message routes to its true agent. This is the COMMON path for busy
  //                  senders, so it must re-dispatch through the router, never runSiteops.
  //    A PHOTO during the window is handled by the image predicate above (NEW_INTENT → its own window).
  if (view.open && !ctx.image && !isInteractiveReply && pending?.agent === 'SITEOPS'
      && (pending.slots as { kind?: string })?.kind === 'siteops_photo') {
    const verdict = classifyPhotoFollowup(view.open as ConvoRow, text, ctx.quotedWamid ?? null, Date.now())
    if (verdict === 'noop') {
      await closeConversation(supabase, { orgId, sender: from, lastActionSummary: 'photo logged' })
      return
    }
    if (verdict === 'related') {
      decision = 'ANSWERS_PENDING'   // → SITEOPS.answer enriches the held objects, then closes the window
    } else {
      await stampPossibleFollowup(supabase, orgId, view.open as ConvoRow, text)
      const fresh = await routeMessage({ text, pending: null, history })   // classify as if no window existed
      decision = fresh.decision
      intentAgent = fresh.intent_agent
      // fall through: not ANSWERS_PENDING → the interruption block closes the window (commitInterrupted →
      // siteops_photo → clean, no park) → the message routes to its true agent via the switch below.
    }
  }

  const chosenAgent =
    decision === 'ANSWERS_PENDING' ? (pending?.agent ?? 'CONCIERGE')
    : decision === 'NEW_INTENT' ? (intentAgent ?? 'CONCIERGE')
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
  if (firstContact && (decision === 'CHITCHAT' || decision === 'AMBIGUOUS') && !MONEY_QUERY_RE.test(text)) {
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
  // TWO holes closed (2026-07-09), both of which silently ate real messages:
  //
  //  (a) NO OPEN CONVERSATION. The router can say ANSWERS_PENDING while `view.open` is null — the question was
  //      killed by an earlier interrupt, or (now that the router reads HISTORY) it simply SEES the question we
  //      asked. This branch used to hand that answer to the CONCIERGE. Live: we asked "which project?", a
  //      payment interrupted and closed the question, the supervisor replied "Dr Shyam's Residence" — and it
  //      was answered with chitchat. Giving the router history makes this MORE likely, not less.
  //
  //  (b) NOT AN ANSWER. The agent's frozen offered list resolves the reply to none of it. That is a fact, and
  //      the agent parks its pending piece and says so. Live: a ₹25,000 payment, bound to a "which item?" ask
  //      by the router at confidence 1.0, was answered "No problem — I'll check back on it next time."
  //
  // Both now RE-CLASSIFY the message as a fresh turn. Nothing is dropped and nothing is guessed.
  // A reply the agent can't resolve to its frozen list is NOT an answer: the agent leaves its question
  // UNTOUCHED (no park, no close — agent-agnostic credibility, 2026-07-11) and we re-classify the message as a
  // fresh turn, carrying the interrupted question forward as `stashedP` for the credibility flow below.
  let stashedP: ConvoRow | null = null
  if (decision === 'ANSWERS_PENDING') {
    const owner = agentFor(pending?.agent)
    if (owner.answer && view.open) {
      // The agent owns cancel-vs-answer (a bare "no" means "someone else" at a confirm prompt, but "discard"
      // at an amount prompt) -- see answerTransaction. 'not_an_answer' → the reply matched none of the frozen
      // list, so the question is interrupted (not resolved) and the dispatcher owns its fate.
      // An older question may be DEFERRED behind this one (held when THIS question interrupted it). Capture it
      // BEFORE the agent resolves + closes the convo.
      const carried = deferredOf(view.open as ConvoRow)
      const verdict = await owner.answer(actx, text, view.open as ConvoRow)
      if (verdict !== 'not_an_answer') {
        // Resolved. If an older question was deferred behind this one, either CARRY it onto whatever follow-up
        // this answer opened (the chain isn't finished), or — the chain is now done — RE-SURFACE it as promised.
        if (carried) {
          const nowOpen = (await getRouterView(supabase, orgId, from)).open
          if (nowOpen) await carryDeferredOnto(supabase, nowOpen as ConvoRow, carried)
          else await resurfacePending(supabase, { orgId, from, wamid }, carried, lang)
        }
        return
      }
      stashedP = view.open as ConvoRow
    }
    const fresh = await routeMessage({ text, pending: null, history })
    console.log(`[dispatch] ANSWERS_PENDING re-classified → ${fresh.decision}/${fresh.intent_agent ?? '-'}`)
    decision = fresh.decision === 'ANSWERS_PENDING' ? 'NEW_INTENT' : fresh.decision   // nothing pending now; never loop
    intentAgent = fresh.intent_agent
    if (decision === 'NEW_INTENT' && !intentAgent) intentAgent = 'SITEOPS'
  } else if (view.open) {
    // A NEW_INTENT / CHITCHAT / AMBIGUOUS arriving while a question is OPEN → that question is interrupted.
    stashedP = view.open as ConvoRow
  }

  // ── Agent-agnostic pending-question credibility ──────────────────────────────
  // The DISPATCHER (never the agent) owns a held question's fate: FREE the slot, handle THIS turn, then bring
  // the question back. Never dropped. If the turn raised NO question of its own → RE-SURFACE it now (Dismiss
  // button). If it DID → DEFER it behind that question (rides its slots), nudge the user, and re-surface it
  // when that question's whole chain finishes (see the resolve path above). Replaces the old park/evict path.
  let prefix = welcome
  // THE 30-MINUTE RULE — an interrupted question that has been unanswered this long is retired, not held.
  // Checked BEFORE the stash so a dead question is never re-promised, deferred or re-shown.
  if (stashedP && await retireStalePending(supabase, actx, { orgId, from, wamid }, stashedP, lang)) {
    stashedP = null
  }
  if (stashedP) {
    // Free the slot; P is held in memory (its slots ride the closed row, so a re-open restores it exactly).
    await closeConversation(supabase, { orgId, sender: from, lastActionSummary: 'held for interruption' })
    // PRE-PROMISE THE RETURN on a NEW_INTENT — always honoured now (defer or re-surface, never dropped).
    // Sent RIGHT NOW (sendNow), not folded into `prefix`: the prefix only reaches the agent's own say(), and
    // SiteOps' first outbound is its receipt ack, which ignores it — so live, the promise glued itself to the
    // LAST message of the turn and arrived after the thing it was promising about. It is a promise; it goes
    // first. (CHITCHAT answers first and then re-surfaces; no pre-promise there.)
    if (decision === 'NEW_INTENT') await sendNow(supabase, from, { kind: 'text', body: M.pendingReturnAck(lang) })
    // AMBIGUOUS while pending: don't open a disambiguation convo (it would read as an eviction) — just bring
    // the question back with a soft "didn't catch that" preamble, and stop here.
    if (decision === 'AMBIGUOUS') {
      await resurfacePending(supabase, { orgId, from, wamid }, stashedP, lang, M.pendingUnclearLead(lang))
      return
    }
  } else {
    prefix = mergePrefix(welcome, undefined)
  }

  // ── Handle THIS turn (new intent / chitchat / ambiguous-with-no-pending) ─────
  if (decision === 'NEW_INTENT') {
    const agent = agentFor(intentAgent)
    if (agent.intent === 'TRANSACTION') {
      // Instant ack the moment we route to TRANSACTION — before the (slower) extraction + staging. Sent
      // DIRECTLY (sendNow), NOT via the durable outbox: the queued path is drained later and would land after
      // the confirmation. The real confirmation (mComplete / asks / batch card) still follows via the outbox.
      await sendNow(supabase, from, M.mTxnAck(lang))
      await agent.run(actx, text, { prefix, lingering: view.lingering, history })
    } else if (MONEY_QUERY_RE.test(text)) {
      if (prefix) await send(supabase, from, { kind: 'text', body: prefix }, { org_id: orgId, wamid })
      await handleQuery(supabase, text, from, registered)
    } else {
      // Procurement (materials request) gets the same instant ack as TRANSACTION, sent directly so it lands
      // before the slower sourcing reply. Concierge shares this branch but is conversational — no ack.
      if (agent.intent === 'PROCUREMENT') await sendNow(supabase, from, M.mProcRouteAck(lang))
      await agent.run(actx, text, { prefix, lingering: view.lingering, history })
    }
  } else if (decision === 'CHITCHAT') {
    if (MONEY_QUERY_RE.test(text)) {
      if (prefix) await send(supabase, from, { kind: 'text', body: prefix }, { org_id: orgId, wamid })
      await handleQuery(supabase, text, from, registered)
    } else {
      await agentFor('CONCIERGE').run(actx, text, { prefix, lingering: view.lingering, history })
    }
  } else if (decision === 'AMBIGUOUS') {
    // Only reached with NO pending question (the pending case re-surfaced + returned above).
    await send(supabase, from, M.mDisambiguate(lang, prefix), { org_id: orgId, wamid })
    await openConversation(supabase, {
      orgId, sender: from, owningAgent: 'CONCIERGE',
      pendingQuestion: 'disambiguation: log a payment or ask a question?', lastMessageId: wamid,
    })
    return
  }

  // ── Bring the held question back — now, or after this turn's own question finishes ───
  // After THIS turn ran: if it opened its OWN question (a convo is open again), DEFER the held question behind
  // it (rides its slots + a nudge) so it re-surfaces when that question's chain completes — never dropped.
  // Otherwise the turn asked nothing, so re-surface the held question now with a Dismiss button.
  if (stashedP) {
    const reopened = (await getRouterView(supabase, orgId, from)).open
    if (reopened) {
      await carryDeferredOnto(supabase, reopened as ConvoRow, snapshotPending(stashedP))
      await send(supabase, from, M.pendingDeferredNudge(lang, pendingSubjectOf(stashedP)), { org_id: orgId, wamid })
    } else {
      await resurfacePending(supabase, { orgId, from, wamid }, stashedP, lang)
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
