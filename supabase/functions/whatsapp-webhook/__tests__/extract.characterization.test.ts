// STEP 0 — PAYMENT REGRESSION GATE (characterization).
//
// Pins the CURRENT deterministic behavior of the transaction image-extraction path BEFORE images
// become a shared modality. extractTransactionFromImage() makes a non-deterministic vision call,
// then feeds the model's raw JSON through a PURE, deterministic pipeline that decides the money:
//     reconcileAmount(normalizeTxn(p), '', llmAmountConf(p))
// That pipeline is what "moves money" (the stored amount + its confidence flag). These tests pin it
// exactly, so any accidental change to the shared extract module while adding the siteops image
// branch is caught. The vision model's output itself is NOT tested (it's the model, not our code).
import { suite, test, expect } from './harness';
import { reconcileAmount, normalizeTxn, llmAmountConf, type TxnExtract } from '../_extract.ts';
import { parseSpokenAmount } from '../_amount.ts';

// The EXACT composition extractTransactionFromImage applies to the model's raw JSON (see _extract.ts).
const imageDeterministic = (p: Record<string, unknown>): TxnExtract =>
  reconcileAmount(normalizeTxn(p), '', llmAmountConf(p));

suite('image extraction — deterministic transform (the money path)', () => {
  test('clean UPI digit + model HIGH → amount kept, HIGH', () => {
    expect(imageDeterministic({ amount: 5000, payee: 'Suresh', mode: 'upi', direction: 'out', amount_confidence: 'high' })).toEqual({
      amount: 5000, amount_source_phrase: null, amount_confidence: 'HIGH',
      payee: 'Suresh', project: null, direction: 'out', mode: 'upi', note: null, ref: null,
    });
  });

  test('model LOW confidence → LOW (flag), fields normalised (note capitalised)', () => {
    expect(imageDeterministic({ amount: 45000, amount_confidence: 'low', payee: 'UltraTech', mode: 'bank', direction: 'out', project: 'Tower A', note: 'cement', ref: 'him' })).toEqual({
      amount: 45000, amount_source_phrase: null, amount_confidence: 'LOW',
      payee: 'UltraTech', project: 'Tower A', direction: 'out', mode: 'bank', note: 'Cement', ref: 'him',
    });
  });

  test('spoken source phrase agrees with model → parser value, HIGH', () => {
    expect(imageDeterministic({ amount: 35000, amount_source_phrase: 'muppai aidu vela', payee: 'Ravi' })).toEqual({
      amount: 35000, amount_source_phrase: 'muppai aidu vela', amount_confidence: 'HIGH',
      payee: 'Ravi', project: null, direction: null, mode: null, note: null, ref: null,
    });
  });

  test('spoken phrase, model dropped a word → parser value WINS, LOW (disagreement flags)', () => {
    expect(imageDeterministic({ amount: 5000, amount_source_phrase: 'muppai aidu vela' })).toEqual({
      amount: 35000, amount_source_phrase: 'muppai aidu vela', amount_confidence: 'LOW',
      payee: null, project: null, direction: null, mode: null, note: null, ref: null,
    });
  });

  test('pure-digit phrase disagreeing with model → model value KEPT, LOW (25 must not clobber 25000)', () => {
    expect(imageDeterministic({ amount: 25000, amount_source_phrase: '25', amount_confidence: 'high' })).toEqual({
      amount: 25000, amount_source_phrase: '25', amount_confidence: 'LOW',
      payee: null, project: null, direction: null, mode: null, note: null, ref: null,
    });
  });

  test('garbage/typed-wrong fields coerce to null; no amount → confidence null', () => {
    expect(imageDeterministic({ amount: '5000', payee: '   ', direction: 'sideways', mode: 'card', note: 'for bricks', project: 42, ref: null })).toEqual({
      amount: null, amount_source_phrase: null, amount_confidence: null,
      payee: null, project: null, direction: null, mode: null, note: 'For bricks', ref: null,
    });
  });
});

suite('reconcileAmount — code decides the amount (exported core)', () => {
  const base = (over: Partial<TxnExtract>): TxnExtract => ({
    amount: null, amount_source_phrase: null, amount_confidence: null, payee: null,
    project: null, direction: null, mode: null, note: null, ref: null, ...over,
  });
  test('digit phrase agreeing with model → HIGH, amount kept', () => {
    expect(reconcileAmount(base({ amount: 1000, amount_source_phrase: '1000' }), '', null).amount_confidence).toBe('HIGH');
  });
  test('falls back to the `text` arg when amount_source_phrase is null (spoken → parser authoritative)', () => {
    const r = reconcileAmount(base({ amount: 2000 }), 'rendu vela', null);
    expect(r.amount).toBe(2000);
    expect(r.amount_confidence).toBe('HIGH');
  });
  test('model LOW is preserved even on agreement', () => {
    expect(reconcileAmount(base({ amount: 1000, amount_source_phrase: '1000' }), '', 'LOW').amount_confidence).toBe('LOW');
  });
});

suite('normalizeTxn — coercion (exported)', () => {
  test('valid fields pass; note capitalised; amount_confidence always nulled', () => {
    expect(normalizeTxn({ amount: 100, payee: 'A', project: 'P', direction: 'in', mode: 'cash', note: 'note', ref: 'r', amount_source_phrase: 'x', amount_confidence: 'high' })).toEqual({
      amount: 100, amount_source_phrase: 'x', amount_confidence: null,
      payee: 'A', project: 'P', direction: 'in', mode: 'cash', note: 'Note', ref: 'r',
    });
  });
  test('empty object → all null', () => {
    expect(normalizeTxn({})).toEqual({
      amount: null, amount_source_phrase: null, amount_confidence: null,
      payee: null, project: null, direction: null, mode: null, note: null, ref: null,
    });
  });
});

suite('llmAmountConf — model self-confidence mapping (exported)', () => {
  test("'high' → HIGH", () => { expect(llmAmountConf({ amount_confidence: 'high' })).toBe('HIGH'); });
  test("'HIGH' (any case) → HIGH", () => { expect(llmAmountConf({ amount_confidence: 'HIGH' })).toBe('HIGH'); });
  test("'low' → LOW", () => { expect(llmAmountConf({ amount_confidence: 'low' })).toBe('LOW'); });
  test("unknown → null", () => { expect(llmAmountConf({ amount_confidence: 'medium' })).toBeNull(); });
  test('missing → null', () => { expect(llmAmountConf({})).toBeNull(); });
});

suite('parseSpokenAmount — deterministic amount parser (the cross-check)', () => {
  test("'5000' → 5000 digits", () => { expect(parseSpokenAmount('5000')).toEqual({ amount: 5000, hasWord: false, fullyRecognized: true }); });
  test("'5k' → 5000", () => { expect(parseSpokenAmount('5k')).toEqual({ amount: 5000, hasWord: false, fullyRecognized: true }); });
  test("'muppai aidu vela' → 35000 (fully recognised spoken)", () => { expect(parseSpokenAmount('muppai aidu vela')).toEqual({ amount: 35000, hasWord: true, fullyRecognized: true }); });
  test("'rendu lakh' → 200000", () => { expect(parseSpokenAmount('rendu lakh')).toEqual({ amount: 200000, hasWord: true, fullyRecognized: true }); });
  test("'' → null", () => { expect(parseSpokenAmount('')).toEqual({ amount: null, hasWord: false, fullyRecognized: true }); });
});
