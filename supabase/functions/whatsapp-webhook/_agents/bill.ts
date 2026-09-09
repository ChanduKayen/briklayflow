// WhatsApp — the BILL path of the financial agent.
//
// A financial IMAGE routed to TRANSACTION is read once as a document (_extract.extractFinancialDoc) and
// disposed by _financial_doc.decideFinancialAction. When the disposer says BILL_ONLY / BILL_AND_PAYMENT /
// BILL_ASK_PAYMENT, THIS module stages it — capture-first, exactly like a payment: it writes a rough_entries
// row (kind='BILL', the bill payload in ai_extracted, the image as the bill document) and the Day Book is
// where the vendor/site are confirmed and it is filed into the `bills` table. The WhatsApp side asks at most
// ONE thing (crack 4): whether the bill was also paid, and if so how much — everything else is edited in the
// Day Book like today. A payment is NEVER minted on a guess (see _financial_doc's safety invariant).

import { send } from '../_format.ts'
import { signedMediaUrl, storeMedia } from '../_normalize.ts'
import { openConversation, closeConversation, type ConvoRow } from '../_conversation.ts'
import { parseSpokenAmount } from '../_amount.ts'
import { entryLink } from '../_links.ts'
import * as M from '../_messages.ts'
import type { TxnCtx } from './transaction.ts'
import type { FinDocRead, FinancialAction } from '../_financial_doc.ts'

// The bill document image lives in the private rough-entry-media bucket; we link a long-TTL signed URL onto
// the rough entry (same mechanism as a payment proof), which flows to bills.doc_url when the entry is filed.
const PROOF_URL_TTL = 315_360_000
const SOURCE_IMAGE = 'WHATSAPP_IMAGE'
// Day Book deep-link base for the staging RPC (matches transaction.ts); the entry CTA is appended by the RPC.
const LINK = (() => {
  const b = Deno.env.get('WA_APP_LINK') ?? 'https://briklay.app'
  try { return new URL('/logbook', b).href } catch { return 'https://briklay.app/logbook' }
})()

const fmtNum = (n: number | null | undefined) => (n != null ? '₹' + n.toLocaleString('en-IN') : null)

/** Link the WhatsApp photo as the BILL DOCUMENT on the just-staged entry (best-effort; never a write fail). */
async function attachBillDoc(ctx: TxnCtx, entryId: string): Promise<void> {
  if (!ctx.image) return
  try {
    let path = ctx.image.storagePath ?? null
    if (!path && ctx.image.base64) {
      try {
        const bytes = Uint8Array.from(atob(ctx.image.base64), (c) => c.charCodeAt(0))
        path = await storeMedia(ctx.supabase, bytes, ctx.image.mime || 'image/jpeg', ctx.from)
      } catch (e) { console.error('[bill] doc re-upload failed:', (e as Error).message) }
    }
    if (!path) { console.warn('[bill] no storage path for doc on', entryId); return }
    const url = await signedMediaUrl(ctx.supabase, path, PROOF_URL_TTL)
    if (!url) { console.warn('[bill] doc sign returned null for', path); return }
    const { error } = await ctx.supabase.from('rough_entries').update({ raw_image_url: url }).eq('id', entryId)
    if (error) console.error('[bill] doc attach failed:', error.message)
  } catch (e) { console.error('[bill] doc attach error:', (e as Error).message) }
}

/** The ai_extracted blob for a staged bill. `kind:'BILL'` is the discriminator the Day Book branches on.
 *  `payment` is the attached payment (BILL_AND_PAYMENT) or null; `payment_status` records how we know. */
export function billAi(read: FinDocRead, action: FinancialAction): Record<string, unknown> {
  const payment =
    action.kind === 'BILL_AND_PAYMENT' ? { amount: action.paidAmount, mode: read.mode, utr: read.utr } : null
  const payment_status =
    action.kind === 'BILL_AND_PAYMENT' ? 'paid' : action.kind === 'BILL_ONLY' ? 'unpaid' : 'unknown'
  return {
    kind: 'BILL', source_agent: 'bill-v1',
    vendor_name: read.vendor, bill_no: read.bill_no, bill_date: read.bill_date, bill_total: read.bill_total,
    lines: read.lines, project_raw: read.project, description_raw: read.note,
    payment, payment_status,
  }
}

/** A one-line story for the Day Book / history when the image had no caption. */
function billRawText(read: FinDocRead): string {
  const who = read.vendor ?? 'a vendor'
  const amt = fmtNum(read.bill_total)
  return read.note?.trim() || `Bill from ${who}${amt ? ` for ${amt}` : ''}${read.bill_no ? ` (No. ${read.bill_no})` : ''}`
}

/** Stage the BILL rough-entry via the shared idempotent RPC. Returns the entry id, or null if it rolled back. */
async function stageBillEntry(ctx: TxnCtx, ai: Record<string, unknown>, read: FinDocRead): Promise<string | null> {
  // raw_text is the "message" the Day Book shows (like a txn card). Prefer the sender's actual caption;
  // fall back to a synthesized one-liner only when there was no caption.
  const rawText = ctx.image?.caption?.trim() || billRawText(read)
  const { data, error } = await ctx.supabase.rpc('stage_entry_v3', {
    p_org_id: ctx.orgId, p_sender: ctx.from, p_wamid: ctx.wamid, p_entry_index: 0,
    p_status: 'PENDING', p_source: SOURCE_IMAGE, p_sender_name: ctx.senderName,
    p_raw_text: rawText, p_ai: ai,
    p_payload: null, p_rendered: null, p_link_base: LINK, p_reaction: null,
  })
  const res = (data ?? null) as { id?: string; committed?: boolean } | null
  if (error || !res?.committed) { if (error) console.error('[bill] stage_entry_v3 error:', error); return null }
  return res.id ?? null
}

/**
 * Stage a bill and tell the sender exactly what happened — one card whose meaning is unambiguous:
 *   BILL_ONLY        → "Bill saved for record" (no money logged).
 *   BILL_AND_PAYMENT → "Bill saved + ₹paid logged, attached".
 *   BILL_ASK_PAYMENT → "Bill saved" + the ONE question: did you pay this? if yes, how much?
 * The answer to that question is resumed by answerBillPayment (via the transaction agent's answer()).
 */
export async function runBill(ctx: TxnCtx, read: FinDocRead, action: FinancialAction): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const ai = billAi(read, action)
  const entryId = await stageBillEntry(ctx, ai, read)
  if (!entryId) {
    await send(supabase, from, M.mBillWriteFailed(lang), { org_id: orgId, wamid })
    return
  }
  await attachBillDoc(ctx, entryId)
  const vendor = read.vendor
  const reviewUrl = entryLink(entryId).url   // deep link to the For-review page for THIS bill

  if (action.kind === 'BILL_AND_PAYMENT') {
    await send(supabase, from, M.mBillAndPayment(lang, { vendor, billTotal: read.bill_total, paidAmount: action.paidAmount, reviewUrl }), { org_id: orgId, wamid })
    await closeConversation(supabase, { orgId, sender: from, stagedEntryId: entryId, lastMessageId: wamid, lastActionSummary: `Bill + payment — ${vendor ?? 'vendor'}` })
    return
  }
  if (action.kind === 'BILL_ONLY') {
    await send(supabase, from, M.mBillSaved(lang, { vendor, billTotal: read.bill_total, reviewUrl }), { org_id: orgId, wamid })
    await closeConversation(supabase, { orgId, sender: from, stagedEntryId: entryId, lastMessageId: wamid, lastActionSummary: `Bill saved — ${vendor ?? 'vendor'}` })
    return
  }
  // BILL_ASK_PAYMENT — stage, then ask the ONE question and hold it open for the answer.
  await send(supabase, from, M.mBillAskPayment(lang, { vendor, billTotal: read.bill_total }), { org_id: orgId, wamid })
  await openConversation(supabase, {
    orgId, sender: from, owningAgent: 'TRANSACTION', pendingQuestion: 'AWAIT_BILL_PAYMENT',
    slots: { kind: 'bill_payment', vendor, bill_total: read.bill_total }, stagedEntryId: entryId, lastMessageId: wamid,
  })
}

// ── the answer to "did you pay this?" ────────────────────────────────────────────
/** PURE: read the reply to the bill-payment question. A tap on "Not paid yet" (interactiveId) is the
 *  keyword-free path; the word tests are a scoped fallback for a specific yes/no (English/Telugu/Hindi),
 *  and the amount is parsed by the shared spoken-amount parser + a digit fallback. */
export function parseBillAnswer(text: string, interactiveId?: string | null): { kind: 'cancel' | 'no' | 'amount' | 'unclear'; amount?: number } {
  const t = (text ?? '').trim()
  const low = t.toLowerCase()
  if (interactiveId === 'bill_not_paid') return { kind: 'no' }
  // Native-script tests are SEPARATE: JS \b is ASCII-only, so `వద్దు\b` never matches at end-of-string.
  if (/^(cancel|stop|discard|vaddu)\b/i.test(low) || /^వద్దు/.test(t)) return { kind: 'cancel' }
  // "not paid" / "no" / Telugu ledu / Hindi nahi — a scoped answer to THIS yes/no, not open routing.
  if (/^(no|nope|nah|not\s*yet|not\s*paid|kaadu|kadu|nahi|ledu|led)\b/i.test(low) || /^(లేదు|కాదు|नहीं)/.test(t)) return { kind: 'no' }
  const sp = parseSpokenAmount(t)
  const amt = sp.amount ?? parseAmountLocal(t)
  if (amt && amt > 0) return { kind: 'amount', amount: amt }
  return { kind: 'unclear' }   // a bare "yes"/garbled number → we re-ask for the amount
}

function parseAmountLocal(text: string): number | null {
  const s = text.trim().toLowerCase().replace(/₹|rs\.?\s*|rupees?\s*/gi, '').replace(/,/g, '').trim()
  if (/^\d+(\.\d+)?k$/i.test(s)) return parseFloat(s) * 1000
  if (/^\d+(\.\d+)?\s*l(akh)?$/i.test(s)) return parseFloat(s) * 100_000
  const n = parseFloat(s)
  return isNaN(n) ? null : n
}

/** Resume the bill-payment question. A clear "no" keeps it a record-only bill; an amount attaches the
 *  payment; a garbled/bare-yes reply is re-asked in place (never dropped — the bill is already safe). A
 *  genuinely new intent never reaches here: the router classifies it NEW_INTENT and it interrupts instead. */
export async function answerBillPayment(ctx: TxnCtx, text: string, convo: ConvoRow): Promise<void> {
  const { supabase, from, orgId, wamid, lang } = ctx
  const entryId = convo.staged_entry_id ?? null
  const slots = (convo.slots_so_far ?? {}) as { vendor?: string | null; bill_total?: number | null }
  const vendor = slots.vendor ?? null
  const a = parseBillAnswer(text, ctx.interactiveId)

  if (a.kind === 'cancel') {
    if (entryId) await supabase.rpc('discard_rough_entry', { p_entry_id: entryId, p_org_id: orgId, p_sender: from, p_wamid: wamid, p_message: M.mBillCancelled(lang).body })
    else await send(supabase, from, M.mBillCancelled(lang), { org_id: orgId, wamid })
    await closeConversation(supabase, { orgId, sender: from, lastActionSummary: 'bill discarded' })
    return
  }
  if (a.kind === 'no') {
    // Kept as a bill-only record — the staged entry already defaults to unpaid; just confirm + close.
    if (entryId) await patchBillPayment(ctx, entryId, null)
    await send(supabase, from, M.mBillKeptAsBill(lang, { vendor }), { org_id: orgId, wamid })
    await closeConversation(supabase, { orgId, sender: from, stagedEntryId: entryId, lastMessageId: wamid, lastActionSummary: `Bill saved — ${vendor ?? 'vendor'}` })
    return
  }
  if (a.kind === 'amount') {
    if (entryId) await patchBillPayment(ctx, entryId, a.amount!)
    const reviewUrl = entryLink(entryId ?? '').url
    await send(supabase, from, M.mBillAndPayment(lang, { vendor, billTotal: slots.bill_total ?? null, paidAmount: a.amount!, reviewUrl }), { org_id: orgId, wamid })
    await closeConversation(supabase, { orgId, sender: from, stagedEntryId: entryId, lastMessageId: wamid, lastActionSummary: `Bill + payment — ${vendor ?? 'vendor'}` })
    return
  }
  // unclear — a bare "yes" or a garbled number. Re-ask for the amount; keep the question open (don't drop).
  await send(supabase, from, M.mBillJustAmount(lang), { org_id: orgId, wamid })
  return
}

/** Merge the payment (or explicit unpaid) onto the staged bill's ai_extracted. */
async function patchBillPayment(ctx: TxnCtx, entryId: string, amount: number | null): Promise<void> {
  const patch = amount != null
    ? { payment: { amount }, payment_status: 'paid' }
    : { payment: null, payment_status: 'unpaid' }
  const { error } = await ctx.supabase.rpc('update_entry_v2', {
    p_entry_id: entryId, p_patch: patch, p_status: 'PENDING',
    p_org_id: ctx.orgId, p_sender: ctx.from, p_wamid: ctx.wamid, p_payload: null, p_rendered: null,
  })
  if (error) console.error('[bill] update_entry_v2 error:', error)
}
