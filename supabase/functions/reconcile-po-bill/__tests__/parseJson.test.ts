// What the reader does with whatever the model actually says.
//
// The bug this guards: an electricity bill went in, the model answered in prose about how this
// wasn't a vendor invoice, and the user got "No JSON found in AI response" over a form they could
// have typed into. The prompt no longer invites that answer and the call is locked to JSON, but the
// parser is the last line: it must survive a fence, a preamble, a trailing sentence — and when
// there is truly nothing to read, say so in words a person can act on.
import { suite, test, expect } from './harness.ts';
import { parseModelJson } from '../_parseJson.ts';

const OK = { vendor_name: 'APEPDCL', bill_total_extracted: 2340, line_items: [] };

suite('reading the model’s answer', () => {
  test('a plain object', () => {
    expect(parseModelJson(JSON.stringify(OK)).vendor_name).toBe('APEPDCL');
  });

  test('a fenced object', () => {
    expect(parseModelJson('```json\n' + JSON.stringify(OK) + '\n```').bill_total_extracted).toBe(2340);
  });

  test('an object with a sentence in front of it', () => {
    expect(parseModelJson('Here is the extracted data:\n' + JSON.stringify(OK)).vendor_name).toBe('APEPDCL');
  });

  test('a trailing sentence containing a brace cannot swallow the object', () => {
    const raw = JSON.stringify(OK) + '\n\nNote: the field {amount} was hard to read.}';
    expect(parseModelJson(raw).vendor_name).toBe('APEPDCL');
  });

  test('a brace inside a string value is not a nesting level', () => {
    const r = parseModelJson(JSON.stringify({ ...OK, bill_number: 'A{1}B' }));
    expect(r.bill_number).toBe('A{1}B');
  });

  test('an escaped quote inside a string does not end it', () => {
    const r = parseModelJson(JSON.stringify({ ...OK, vendor_name: 'M/s "Sri" Traders' }));
    expect(r.vendor_name).toBe('M/s "Sri" Traders');
  });

  test('nested objects and arrays come back whole', () => {
    const raw = JSON.stringify({ ...OK, line_items: [{ item: 'Energy charges', amount: 1716 }, { item: 'Duty', amount: 104 }] });
    expect((parseModelJson(raw).line_items as unknown[]).length).toBe(2);
  });

  test('prose with no object at all fails in words a person can act on', () => {
    let msg = '';
    try { parseModelJson('This appears to be an electricity bill rather than a vendor invoice.'); }
    catch (e) { msg = (e as Error).message; }
    expect(msg).toBe("The reader couldn't make figures out of that page");
    expect(/JSON|AI response/i.test(msg)).toBe(false);
  });

  test('an empty answer fails the same way', () => {
    let msg = '';
    try { parseModelJson(''); } catch (e) { msg = (e as Error).message; }
    expect(msg).toBe("The reader couldn't make figures out of that page");
  });

  test('a truncated object fails rather than half-parsing', () => {
    let threw = false;
    try { parseModelJson('{"vendor_name":"APEPDCL","line_items":[{"item":"Energy'); } catch { threw = true; }
    expect(threw).toBe(true);
  });
});
