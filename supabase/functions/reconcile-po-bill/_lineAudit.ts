/**
 * Does what the reader returned actually account for the whole bill?
 *
 * One upload from an Indian vendor is routinely a PDF holding three tax invoices, each followed by
 * its own e-Way bill page. The failure this exists to catch is the reader summing all three grand
 * totals correctly while returning only the FIRST invoice's line items — a bill whose header says
 * ₹73,750 and whose lines say ₹25,000, with two thirds of the goods silently missing.
 *
 * No second opinion is needed to see that: the printed lines, plus GST, must reconcile to the grand
 * total. This is that arithmetic, kept apart from the edge function so it can be run against real
 * bills without an API key.
 */
export interface LineAudit {
  /** The grand total the reader claims, incl. tax. */
  total: number;
  /** What the lines should add up to — the total less GST. */
  basic: number;
  /** What the lines actually add up to. */
  lineSum: number;
  /** How much of the bill has no line to explain it. */
  missing: number;
  /** True when pages were almost certainly skipped and one more read is worth its cost. */
  retry: boolean;
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/** Most Indian construction materials sit at 18%; used only when the bill doesn't print its GST. */
const ASSUMED_GST_MULTIPLIER = 1.18;

/** Under this share of the goods accounted for, a line is missing rather than rounded. */
const TOLERANCE = 0.98;

export function auditLines(result: unknown): LineAudit {
  const r = (result ?? {}) as { line_items?: unknown; bill_total_extracted?: unknown; gst_amount?: unknown };
  const lines = Array.isArray(r.line_items) ? r.line_items as Array<Record<string, unknown>> : [];
  const total = n(r.bill_total_extracted);
  const gst = r.gst_amount != null ? n(r.gst_amount) : (total > 0 ? total - total / ASSUMED_GST_MULTIPLIER : 0);
  const basic = total > 0 ? total - gst : 0;
  const lineSum = lines.reduce((a, l) => a + (n(l?.amount) || n(l?.qty) * n(l?.rate)), 0);

  // A bill with no itemisation at all is a different thing — re-reading it would find nothing, so
  // it never costs a second call.
  const retry = lines.length >= 1 && basic > 0 && lineSum < basic * TOLERANCE;

  return {
    total: Math.round(total), basic: Math.round(basic), lineSum: Math.round(lineSum),
    missing: Math.round(Math.max(0, basic - lineSum)), retry,
  };
}
