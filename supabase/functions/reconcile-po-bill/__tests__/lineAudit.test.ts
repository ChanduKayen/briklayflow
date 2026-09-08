// The audit that catches a bill read only as far as its first page.
//
// The fixture is a real one: Pattabhi Traders sent ONE PDF of six pages — three tax invoices
// (3445, 3446, 3455) each followed by its e-Way bill. The reader summed all three grand totals
// correctly (₹73,750) and returned a single line worth ₹25,000, so two thirds of the cement had
// no line to explain it and nobody could see that from the total.
import { suite, test, expect } from './harness.ts';
import { auditLines } from '../_lineAudit.ts';

suite('line audit — did the reader reach the last page?', () => {
  test('the Pattabhi bill as it was actually read: one invoice of three → re-read', () => {
    const a = auditLines({
      bill_total_extracted: 73750,
      gst_amount: null,                       // not printed → assume 18%
      line_items: [{ item: 'ULTRATECH PPC', qty: 100, unit: 'Bgs', rate: 250, amount: 25000 }],
    });
    expect(a.basic).toBe(62500);              // 25,000 + 25,000 + 12,500
    expect(a.lineSum).toBe(25000);
    expect(a.missing).toBe(37500);            // the two invoices it skipped
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
