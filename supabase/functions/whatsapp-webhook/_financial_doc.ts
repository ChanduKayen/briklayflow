// WhatsApp — the financial-document decision layer.
//
// A financial image the router handed to the transaction agent is ONE of three things, and the
// difference is a MEANING the vision model reports, never a keyword we scan for (the codebase has
// deleted every word-list that tried; see _router.ts). The model reads the picture + the caption and
// tells us two facts:
//   • document_kind — is this an INVOICE (a bill / what is owed), a PAYMENT_PROOF (a UTR / bank
//     screenshot / receipt — evidence money moved), BOTH (an invoice stamped paid, with a UTR), or
//     OTHER (not a financial document at all).
//   • payment_occurred — did money ACTUALLY move? Past/confirmed ("paid", a UTR, a "PAID" stamp) is
//     true; a future/imperative ("to pay", "please pay", "due") is false; genuinely unclear is null.
//
// THIS module is the deterministic disposer: given those two facts it decides what we DO. It is pure
// and unit-tested so the money-safety rules below can never regress silently.
//
// THE SAFETY INVARIANT (the reason the default is what it is): under-recording is recoverable — a bill
// with no payment can always have a payment attached later. OVER-recording is a corruption — a phantom
// payment inflates what we think we paid a vendor and unbalances the party ledger (the class of bug this
// repo has paid for repeatedly: the ₹8,375 ghost, phantom advances, netting drift). So:
//   • We NEVER mint a payment on our own guess. A payment is logged only when the model says money moved
//     AND we have an amount, or the owner says so.
//   • We NEVER assume the paid amount equals the bill total. Partial payment is the norm; if a payment
//     occurred but the amount is unknown, we ASK — we do not log the bill total as "paid".
//   • On ambiguity the fallback is always the SMALLER claim: record the bill, ask about the payment.

export type FinDocLine = {
  name: string | null
  spec: string | null
  unit: string | null
  qty: number | null
  rate: number | null
  amount: number | null
}

/** What the vision model reports after reading a financial image + its caption. Every field is the
 *  model's own reading; this module trusts it as data and never re-guesses it. */
export type FinDocRead = {
  document_kind: 'invoice' | 'payment_proof' | 'both' | 'other'
  // Did money ACTUALLY move? true = past/confirmed; false = future/intent only; null = genuinely unclear.
  payment_occurred: boolean | null
  // ── bill (invoice) fields ──
  vendor: string | null
  bill_no: string | null
  bill_date: string | null       // ISO if the model could parse one
  bill_total: number | null
  lines: FinDocLine[]
  // ── payment fields (present on a proof / a paid invoice) ──
  paid_amount: number | null
  mode: 'cash' | 'upi' | 'bank' | null
  utr: string | null
  // ── shared context ──
  project: string | null
  note: string | null
}

/** The deterministic action. The transaction agent branches on `kind`.
 *  - PAYMENT_ONLY      → today's path unchanged: stage a payment rough-entry, the image is its proof.
 *  - BILL_ONLY         → stage a BILL rough-entry (a record; no money is logged).
 *  - BILL_AND_PAYMENT  → stage a BILL rough-entry carrying an attached payment of `paidAmount`.
 *  - BILL_ASK_PAYMENT  → stage a BILL rough-entry now, THEN ask "Did you pay this? If yes, how much?"
 *                        (an ambiguous invoice, or a paid invoice whose amount we couldn't read). */
export type FinancialAction =
  | { kind: 'PAYMENT_ONLY' }
  | { kind: 'BILL_ONLY' }
  | { kind: 'BILL_AND_PAYMENT'; paidAmount: number }
  | { kind: 'BILL_ASK_PAYMENT' }

const pos = (n: number | null | undefined): n is number => typeof n === 'number' && isFinite(n) && n > 0

/**
 * Decide what to do with a financial document. Pure; see the safety invariant above.
 *
 * The gate is INVOICE-PRESENCE first, PAYMENT-ACTUALITY second:
 *   no invoice           → PAYMENT_ONLY   (a UTR/receipt, or a misread 'other' — today's capture-first path)
 *   invoice + paid + amt → BILL_AND_PAYMENT   (the ONLY case that skips the question)
 *   invoice + anything else → BILL_ASK_PAYMENT   (stage the bill, then ASK "did you also pay this? how much?")
 *
 * WHY EVERY OTHER INVOICE ASKS (owner's instruction): even a bill the model read as unpaid must still
 * offer to record a payment — the owner may have paid it in a way the image doesn't show. So we never
 * silently file a bill-only record; we save the bill and ask. Only a bill we can already SEE was paid,
 * with a real amount, is logged without a question. BILL_ONLY is thus never chosen here — it is the
 * RESULT of the owner answering "not paid" to that question (see answerBillPayment).
 */
export function decideFinancialAction(r: FinDocRead): FinancialAction {
  const hasInvoice = r.document_kind === 'invoice' || r.document_kind === 'both'

  // No invoice in the picture. A payment proof (UTR/bank/receipt) — and the 'other' misroute, which
  // keeps today's exact behaviour — flow through the unchanged payment path where the image is proof.
  if (!hasInvoice) return { kind: 'PAYMENT_ONLY' }

  // An invoice is present, and we can SEE it was paid with a real amount → log it (never the bill total;
  // partial payment is normal). Everything else stages the bill and asks about the payment.
  if (r.payment_occurred === true && pos(r.paid_amount)) {
    return { kind: 'BILL_AND_PAYMENT', paidAmount: r.paid_amount as number }
  }
  return { kind: 'BILL_ASK_PAYMENT' }
}

// A paid VERB in the caption — the "money went out for this bill" signal (English + common Telugu/Hindi
// transliterations). Its mere presence is a signal; it does NOT license using a stray caption number.
const PAID_VERB_RE = /\b(paid|pay|payment|cleared|settled|transferred|remitted|gave|given|chellinch\w*|kattin\w*|katta\w*|ichcha\w*|icha\w*|diya|kiya)\b/i
// An EXPLICIT paid amount — a paid verb tied to a number ("paid 10000", "paid ₹5,000", "10k paid",
// "cleared 2 lakh"). Only THIS lets a caption number stand in as the paid amount.
const EXPLICIT_PAID_RE = /(?:\b(?:paid|pay|payment|cleared|settled|transferred|remitted|gave|given)\b[^0-9]{0,12}(?:₹|rs\.?|inr)?\s*\d[\d,]*\s*(?:k|lac|lakh|l)?)|(?:\d[\d,]*\s*(?:k|lac|lakh|l)?\s*(?:paid|cleared|settled|given)\b)/i

/**
 * Fuse a payment stated alongside a BILL image into the invoice read.
 *
 * THE FIX (owner's rule): the bill TOTAL is read reliably from the image; the paid amount must NOT be
 * pulled from a stray number in the caption, which is often about something else entirely. So when a bill
 * carries a paid SIGNAL (a "paid" verb, or an outgoing amount in the caption), the paid amount DEFAULTS to
 * the BILL TOTAL — they paid the bill — UNLESS the caption EXPLICITLY states a paid amount ("paid 5000"),
 * in which case that explicit amount stands (a partial payment). No signal at all → unchanged (it will ASK).
 * Never overrides an amount vision read off the image; never treats a received/"to pay" caption as a payment.
 */
export function fuseCaptionPayment(
  r: FinDocRead,
  cap: { amount: number | null; direction: 'out' | 'in' | null; mode: 'cash' | 'upi' | 'bank' | null },
  captionText = '',
): FinDocRead {
  const hasInvoice = r.document_kind === 'invoice' || r.document_kind === 'both'
  if (!hasInvoice) return r
  if (r.payment_occurred === true && pos(r.paid_amount)) return r    // vision already read the exact amount
  if (cap.direction === 'in') return r                               // "received / to pay" — not a payment out

  const text = captionText.toLowerCase()
  const explicit = pos(cap.amount) && EXPLICIT_PAID_RE.test(text)    // caption says the amount, verbatim
  const paidSignal = PAID_VERB_RE.test(text) || (pos(cap.amount) && cap.direction === 'out') || r.payment_occurred === true
  if (!paidSignal) return r                                          // nothing says paid → leave it to ASK

  // Explicit amount wins (partial payment); otherwise the bill was paid — use the bill total, not the
  // caption's stray number. Only fall back to the caption amount if there is no readable bill total.
  const amt = explicit ? (cap.amount as number) : (pos(r.bill_total) ? (r.bill_total as number) : cap.amount)
  if (!pos(amt)) return r
  return { ...r, payment_occurred: true, paid_amount: amt as number, mode: r.mode ?? cap.mode }
}
