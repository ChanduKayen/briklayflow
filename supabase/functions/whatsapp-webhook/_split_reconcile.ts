// The split-reconciliation guard.
//
// A payment PROOF (a CRED/UPI screenshot) with a caption that ITEMISES what the one payment was for —
// "Bhaskar salary 15k + 3650 site expenses" on an ₹18,650 proof — was read by the multi-entry extractor as
// THREE payments (18,650 + 15,000 + 3,650 = ₹37,300 filed for ₹18,650 that actually moved). The caption is a
// BREAKDOWN of the single payment, not extra payments — and the tell is arithmetic: the parts sum to the
// screenshot amount.
//
// This module detects that pattern purely and collapses it to ONE payment carrying the breakdown as a
// structured split + a readable note. It never invents money and never merges genuinely separate payments
// (those don't sum to one of themselves). Money-safety: over-recording is the corruption we refuse.

import type { TxnExtract, SplitLine } from './_extract.ts'

export type Reconciled = { totalIndex: number; partIndexes: number[] }

/**
 * PURE: is one entry's amount the SUM of the others (within a small tolerance), with at least two parts?
 * Then that entry is the real payment and the others are its split. Returns the indices, or null when the
 * amounts don't reconcile — i.e. they are genuinely separate payments and must stay separate.
 *
 * `tolerance` is a FRACTION of the total (default 1%), floored at ₹1, so "15,000 + 3,650 = 18,650" collapses
 * but a real second payment (which won't sum to the first) is filed on its own.
 */
export function reconcileSplitPayment(entries: TxnExtract[], tolerance = 0.01): Reconciled | null {
  const pos = entries
    .map((e, idx) => ({ idx, amt: Number(e.amount) }))
    .filter((x) => Number.isFinite(x.amt) && x.amt > 0)
  if (pos.length < 3) return null                 // need a total + at least two parts
  pos.sort((a, b) => b.amt - a.amt)               // the total is necessarily the largest (parts are positive)
  const total = pos[0]
  const parts = pos.slice(1)
  const sum = parts.reduce((s, p) => s + p.amt, 0)
  const tol = Math.max(total.amt * tolerance, 1)
  if (Math.abs(sum - total.amt) > tol) return null
  return { totalIndex: total.idx, partIndexes: parts.map((p) => p.idx) }
}

const inr = (n: number) => '₹' + Math.round(n).toLocaleString('en-IN')

/** PURE: fold the parts INTO the total as one payment — a structured `split` (for the Day Book to itemise)
 *  plus a readable "Split: …" note (so the breakdown shows on the card and in the ledger note). */
export function buildSplitTotal(total: TxnExtract, parts: TxnExtract[]): TxnExtract {
  const split: SplitLine[] = parts.map((p) => ({
    amount: Number(p.amount), purpose: (p.note ?? p.project ?? null), payee: (p.payee ?? null),
  }))
  const breakdown = parts
    .map((p) => `${inr(Number(p.amount))} ${(p.note || p.payee || '').toString().trim()}`.trim())
    .join(' + ')
  const note = [total.note?.trim(), breakdown ? `Split: ${breakdown}` : '']
    .filter(Boolean).join(' · ') || total.note
  return { ...total, note, split }
}
