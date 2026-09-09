/**
 * Do the lines the reader returned actually account for the paper?
 *
 * This exists to catch a reading that stopped early. One upload is routinely a file holding three
 * tax invoices, each followed by its own transport page; the reader sums all three grand totals
 * correctly and returns only the FIRST invoice's lines — a paper whose header says ₹73,750 and
 * whose lines say ₹25,000, with two thirds of the goods silently missing and nobody able to see
 * that from the total.
 *
 * No second opinion is needed to see it: the printed lines cannot be that much smaller than the
 * amount payable unless something was skipped. This is that arithmetic, kept apart from the edge
 * function so it can be run against real papers without an API key.
 *
 * IT MUST NOT ASSUME THE PAPER IS A TAXED GOODS INVOICE. It used to: with no tax printed it took
 * 18% off the total and demanded the lines cover the rest. On an electricity bill — energy charge,
 * fixed charge, duty, a subsidy in the negative, arrears carried forward — the lines legitimately
 * fall short of that invented figure, so a perfectly-read bill bought a second API call and a
 * worse answer. When the paper prints no tax we now assume the MOST it could possibly be carrying
 * and ask only whether the lines fall short even of that. What survives is a signal that means one
 * thing on any document: this cannot be explained by tax, so pages are missing.
 */
export interface LineAudit {
  /** The amount payable the reader claims. */
  total: number;
  /** The least the lines could add to and still explain that total. */
  basic: number;
  /** What the lines actually add up to (deductions counted as the negatives they are). */
  lineSum: number;
  /** How much of the paper has no line to explain it. */
  missing: number;
  /** True when pages were almost certainly skipped and one more read is worth its cost. */
  retry: boolean;
}

const n = (v: unknown): number => { const x = Number(v); return Number.isFinite(x) ? x : 0; };

/**
 * The highest GST slab in India. When a paper prints no tax at all we cannot know whether it
 * carries any, so we grant it the most it could — and call the lines short only when they fall
 * below even that. A utility bill (no GST line, charges summing near the total) passes; a
 * three-invoice file read only as far as page one does not.
 */
const MOST_TAX_MULTIPLIER = 1.28;

/** Under this share of the explainable amount, a line is missing rather than rounded. */
const TOLERANCE = 0.98;

export function auditLines(result: unknown): LineAudit {
  const r = (result ?? {}) as {
    line_items?: unknown; bill_total_extracted?: unknown;
    gst_amount?: unknown; tax_amount?: unknown;
  };
  const lines = Array.isArray(r.line_items) ? r.line_items as Array<Record<string, unknown>> : [];
  const total = n(r.bill_total_extracted);
  // Whatever the paper calls its tax. Only a printed figure counts — an absent one is not zero and
  // not 18%; it is unknown, and unknown is what the multiplier below is for.
  const printed = r.gst_amount != null ? n(r.gst_amount)
                : r.tax_amount != null ? n(r.tax_amount)
                : null;
  const basic = total <= 0 ? 0
              : printed != null ? total - printed
              : total / MOST_TAX_MULTIPLIER;
  const lineSum = lines.reduce((a, l) => a + (n(l?.amount) || n(l?.qty) * n(l?.rate)), 0);

  // A paper with no itemisation at all is a different thing — a chit, a bill printed as one figure
  // — and re-reading it would find nothing, so it never costs a second call.
  const retry = lines.length >= 1 && basic > 0 && lineSum < basic * TOLERANCE;

  return {
    total: Math.round(total), basic: Math.round(basic), lineSum: Math.round(lineSum),
    missing: Math.round(Math.max(0, basic - lineSum)), retry,
  };
}
