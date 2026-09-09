// The two halves of the reader, working on the same answer.
//
// Everything past the model — parse what it said, then decide whether it read the whole paper — is
// pure, so the documents that used to fail can be walked through it here without an API key. What
// cannot be proved from this machine is the model's own reading; that needs the function deployed
// and a real bill in front of it.
import { suite, test, expect } from './harness.ts';
import { parseModelJson } from '../_parseJson.ts';
import { auditLines } from '../_lineAudit.ts';

const read = (raw: string) => { const r = parseModelJson(raw); return { r, audit: auditLines(r) }; };

suite('a whole answer, parsed then audited', () => {
  test('the electricity bill from the bug report goes through untouched', () => {
    const { r, audit } = read('```json\n' + JSON.stringify({
      doc_type: 'electricity bill',
      vendor_name: 'Eastern Power Distribution Company',
      bill_number: '2107110004521', reference_kind: 'service connection no',
      bill_date: '2026-09-04', period: 'Aug 2026',
      bill_total_extracted: 2340, tax_amount: null, gst_amount: null,
      line_items: [
        { item: 'Energy charges 312 units', qty: 312, unit: 'units', rate: 5.5, amount: 1716, rate_basis: 'per_unit', source_doc: null },
        { item: 'Fixed charges', qty: null, unit: null, rate: null, amount: 120, rate_basis: 'lot', source_doc: null },
        { item: 'Electricity duty', qty: null, unit: null, rate: null, amount: 104, rate_basis: 'lot', source_doc: null },
        { item: 'Customer charges', qty: null, unit: null, rate: null, amount: 40, rate_basis: 'lot', source_doc: null },
        { item: 'Arrears', qty: null, unit: null, rate: null, amount: 360, rate_basis: 'lot', source_doc: null },
      ],
    }) + '\n```');
    expect(r.vendor_name).toBe('Eastern Power Distribution Company');
    expect(r.bill_total_extracted).toBe(2340);
    expect((r.line_items as unknown[]).length).toBe(5);
    expect(audit.retry).toBe(false);          // a second call here would only make it worse
  });

  test('a handwritten chit: a name, a figure, nothing else — and that is a complete answer', () => {
    const { r, audit } = read(JSON.stringify({
      doc_type: 'handwritten chit', vendor_name: 'Sri Balaji Hardware',
      bill_number: null, reference_kind: null, bill_date: '2026-09-06', period: null,
      bill_total_extracted: 900, tax_amount: null, gst_amount: null, line_items: [],
    }));
    expect(r.vendor_name).toBe('Sri Balaji Hardware');
    expect((r.line_items as unknown[]).length).toBe(0);
    expect(audit.retry).toBe(false);
  });

  test('a bill carrying a subsidy: the deduction is honoured, not dropped', () => {
    const { audit } = read(JSON.stringify({
      doc_type: 'electricity bill', bill_total_extracted: 1400, gst_amount: null,
      line_items: [
        { item: 'Energy charges', amount: 2000, rate_basis: 'lot' },
        { item: 'Government subsidy', amount: -600, rate_basis: 'lot' },
      ],
    }));
    expect(audit.lineSum).toBe(1400);
    expect(audit.retry).toBe(false);
  });

  test('the three-invoice materials PDF, read only as far as page one, still buys a re-read', () => {
    const { audit } = read('Here is what I found:\n' + JSON.stringify({
      doc_type: 'tax invoice', vendor_name: 'Pattabhi Traders',
      bill_number: '3445', bill_date: '2026-08-30',
      bill_total_extracted: 73750, gst_amount: null, tax_amount: null,
      line_items: [{ item: 'ULTRATECH PPC', qty: 100, unit: 'Bgs', rate: 250, amount: 25000, source_doc: '3445' }],
    }));
    expect(audit.retry).toBe(true);
    expect(audit.missing).toBe(32617);
  });

  test('a model that answers in prose fails in words, not in jargon', () => {
    let msg = '';
    try { read('I can see this is an electricity bill, not a vendor invoice, so I cannot extract PO line items.'); }
    catch (e) { msg = (e as Error).message; }
    expect(msg).toBe("The reader couldn't make figures out of that page");
  });
});
