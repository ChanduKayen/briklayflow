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

/**
 * Fuse a payment stated in the CAPTION/text into an invoice read. The paid amount is very often ONLY in
 * the caption ("paid 10000", "10k paid") — which vision, reading the invoice pixels, misses. When the
 * document is an invoice and we don't already have a confirmed paid amount, a caption that states an
 * OUTGOING amount becomes the payment. Never overrides an amount vision already read; never turns a
 * received/"to pay" caption into a payment (that's the text extractor's job to sign as direction).
 */
export function fuseCaptionPayment(
  r: FinDocRead,
  cap: { amount: number | null; direction: 'out' | 'in' | null; mode: 'cash' | 'upi' | 'bank' | null },
): FinDocRead {
  const hasInvoice = r.document_kind === 'invoice' || r.document_kind === 'both'
  if (!hasInvoice) return r
  if (r.payment_occurred === true && pos(r.paid_amount)) return r    // vision already has the payment
  if (!pos(cap.amount) || cap.direction === 'in') return r           // no outgoing amount in the caption
  return { ...r, payment_occurred: true, paid_amount: cap.amount, mode: r.mode ?? cap.mode }
}
