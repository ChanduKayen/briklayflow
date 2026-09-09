// The audit that catches a paper read only as far as its first page — and, just as importantly,
// leaves alone every paper that is simply not a taxed goods invoice.
//
// The first fixture is real: Pattabhi Traders sent ONE PDF of six pages — three tax invoices (3445,
// 3446, 3455) each followed by its e-way page. The reader summed all three grand totals correctly
// (₹73,750) and returned a single line worth ₹25,000, so two thirds of the cement had no line to
// explain it and nobody could see that from the total.
//
// The rest are the papers the audit used to misjudge, because it assumed 18% GST on anything that
// didn't print its tax: an electricity bill, a rent receipt, a handwritten chit.
import { suite, test, expect } from './harness.ts';
import { auditLines } from '../_lineAudit.ts';

suite('line audit — did the reader reach the last page?', () => {
  test('the Pattabhi bill as it was actually read: one invoice of three → re-read', () => {
    const a = auditLines({
      bill_total_extracted: 73750,
      gst_amount: null,                       // not printed → grant it the most tax it could carry
      line_items: [{ item: 'ULTRATECH PPC', qty: 100, unit: 'Bgs', rate: 250, amount: 25000 }],
    });
    expect(a.basic).toBe(57617);              // 73,750 ÷ 1.28 — the least the lines could come to
    expect(a.lineSum).toBe(25000);
    expect(a.missing).toBe(32617);            // short by more than any tax rate could explain
    expect(a.retry).toBe(true);
  });

  test('the same bill read whole: three lines, one per invoice → no second call', () => {
    const a = auditLines({
      bill_total_extracted: 73750,
      gst_amount: 11250,
      line_items: [
        { item: 'ULTRATECH PPC', qty: 100, rate: 250, amount: 25000, source_doc: '3445' },
        { item: 'ULTRATECH PPC', qty: 100, rate: 250, amount: 25000, source_doc: '3446' },
        { item: 'ULTRATECH PPC', qty: 50,  rate: 250, amount: 12500, source_doc: '3455' },
      ],
    });
    expect(a.lineSum).toBe(62500);
    expect(a.missing).toBe(0);
    expect(a.retry).toBe(false);
  });

  test('a bill with no itemisation at all never costs a second call', () => {
    const a = auditLines({ bill_total_extracted: 29500, gst_amount: 4500, line_items: [] });
    expect(a.retry).toBe(false);
  });

  test('one invoice, read correctly', () => {
    const a = auditLines({
      bill_total_extracted: 29500, gst_amount: 4500,
      line_items: [{ item: 'ULTRATECH PPC', qty: 100, rate: 250, amount: 25000 }],
    });
    expect(a.retry).toBe(false);
  });

  test('lines printed tax-inclusive read HIGH, not short — never a re-read', () => {
    const a = auditLines({
      bill_total_extracted: 29500, gst_amount: 4500,
      line_items: [{ item: 'ULTRATECH PPC', qty: 100, rate: 295, amount: 29500 }],
    });
    expect(a.retry).toBe(false);
  });

  test('a line with no amount is still counted from qty × rate', () => {
    const a = auditLines({
      bill_total_extracted: 29500, gst_amount: 4500,
      line_items: [{ item: 'ULTRATECH PPC', qty: 100, rate: 250, amount: null }],
    });
    expect(a.lineSum).toBe(25000);
    expect(a.retry).toBe(false);
  });

  test('rounding inside 2% is not a missing page', () => {
    const a = auditLines({
      bill_total_extracted: 29500, gst_amount: 4500,
      line_items: [{ item: 'ULTRATECH PPC', qty: 100, rate: 249.5, amount: 24950 }],
    });
    expect(a.retry).toBe(false);
  });

  test('no total printed → nothing to reconcile against, so no re-read', () => {
    const a = auditLines({
      bill_total_extracted: null, gst_amount: null,
      line_items: [{ item: 'ULTRATECH PPC', qty: 100, rate: 250, amount: 25000 }],
    });
    expect(a.retry).toBe(false);
  });
});

suite('line audit — papers that are not goods invoices', () => {
  // The bill in the bug report. No GST line anywhere; the charges very nearly are the total, and
  // the small gap is a duty the meter reading doesn't itemise. Under the old 18% assumption this
  // read as 340 "missing" and bought a second, worse reading.
  test('an electricity bill, fully read, is left alone', () => {
    const a = auditLines({
      doc_type: 'electricity bill',
      bill_total_extracted: 2340, gst_amount: null, tax_amount: null,
      line_items: [
        { item: 'Energy charges 312 units', qty: 312, unit: 'units', rate: 5.5, amount: 1716, rate_basis: 'per_unit' },
        { item: 'Fixed charges', amount: 120, rate_basis: 'lot' },
        { item: 'Electricity duty', amount: 104, rate_basis: 'lot' },
        { item: 'Customer charges', amount: 40, rate_basis: 'lot' },
        { item: 'Arrears', amount: 360, rate_basis: 'lot' },
      ],
    });
    expect(a.lineSum).toBe(2340);
    expect(a.retry).toBe(false);
  });

  // A subsidy is a real line and a negative one. Counting it as +900 would have hidden a genuine
  // shortfall; counting it as 0 would have invented one.
  test('a deduction counts as the negative it is', () => {
    const a = auditLines({
      bill_total_extracted: 1400, gst_amount: null,
      line_items: [
        { item: 'Energy charges', amount: 2000 },
        { item: 'Government subsidy', amount: -600 },
      ],
    });
    expect(a.lineSum).toBe(1400);
    expect(a.retry).toBe(false);
  });

  test('rent, one line and no tax at all, is not short', () => {
    const a = auditLines({
      doc_type: 'rent receipt',
      bill_total_extracted: 45000, gst_amount: null,
      line_items: [{ item: 'Site office rent — Sept 2026', amount: 45000, rate_basis: 'lot' }],
    });
    expect(a.retry).toBe(false);
  });

  // A handwritten chit that names a figure and nothing else. There is nothing to re-read.
  test('a chit with a figure and no lines never costs a second call', () => {
    const a = auditLines({
      doc_type: 'handwritten chit', bill_total_extracted: 900,
      gst_amount: null, tax_amount: null, line_items: [],
    });
    expect(a.retry).toBe(false);
    expect(a.missing).toBe(703);   // reported, but not worth an API call
  });

  test('a paper that prints tax under its own name, not GST, is believed', () => {
    const a = auditLines({
      bill_total_extracted: 11800, gst_amount: null, tax_amount: 1800,
      line_items: [{ item: 'Annual maintenance — 1 Apr to 31 Mar', amount: 10000, rate_basis: 'lot' }],
    });
    expect(a.basic).toBe(10000);
    expect(a.retry).toBe(false);
  });

  // The one case that must still fire on a non-invoice: half the paper genuinely unread.
  test('a statement whose lines cover half of what is payable is still re-read', () => {
    const a = auditLines({
      doc_type: 'statement of account',
      bill_total_extracted: 88000, gst_amount: null,
      line_items: [{ item: 'Invoice 214', amount: 30000 }],
    });
    expect(a.retry).toBe(true);
  });
});
