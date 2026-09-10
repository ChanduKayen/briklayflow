// The bill-payment reply, made phantom-safe. During "how much did you pay?", ONLY a clean amount becomes the
// payment; a phrase — a note, a garbled number — is `other` (the dispatcher attaches it to the bill and
// re-asks). This is the ₹21,677 phantom fix: a number inside a sentence must never become the paid amount.
import { suite, test, expect } from './harness'
import { isCleanAmount, billReplyKind, parseBillAnswer } from '../_agents/bill.ts'

suite('bill — only a CLEAN amount becomes the paid amount', () => {
  test('a bare number', () => { expect(isCleanAmount('20000')).toBe(20000) })
  test('paid + number', () => { expect(isCleanAmount('paid 20000')).toBe(20000) })
  test('shorthand k', () => { expect(isCleanAmount('20k')).toBe(20000) })
  test('currency word + commas', () => { expect(isCleanAmount('rs 19,627')).toBe(19627) })
  test('rupee sign + commas', () => { expect(isCleanAmount('₹19,627')).toBe(19627) })
  test('a phrase with a trailing number is NOT clean', () => { expect(isCleanAmount('asm site bill 21677')).toBe(null) })
  test('a phrase with a leading number is NOT clean', () => { expect(isCleanAmount('21677 for the asm site')).toBe(null) })
  test('a pure note is not an amount', () => { expect(isCleanAmount('Asm site bill')).toBe(null) })
  test('empty', () => { expect(isCleanAmount('')).toBe(null) })
})

suite('bill — reply kind during AWAIT_BILL_PAYMENT', () => {
  test('clean amount', () => { expect(billReplyKind('20000')).toEqual({ kind: 'amount', amount: 20000 }) })
  test('a Not-paid tap', () => { expect(billReplyKind('', 'bill_not_paid').kind).toBe('no') })
  test('"not paid" in words', () => { expect(billReplyKind('not paid').kind).toBe('no') })
  test('Telugu ledu', () => { expect(billReplyKind('ledu').kind).toBe('no') })
  test('cancel', () => { expect(billReplyKind('cancel').kind).toBe('cancel') })
  test('a note phrase → other (never amount)', () => { expect(billReplyKind('Asm site bill').kind).toBe('other') })
  test('a stray number in a phrase → other (never amount)', () => { expect(billReplyKind('21677 for asm site').kind).toBe('other') })
})

suite('bill — parseBillAnswer maps other → unclear (re-ask, never a phantom amount)', () => {
  test('a note → unclear (not amount)', () => { expect(parseBillAnswer('Asm site bill').kind).toBe('unclear') })
  test('a phrase-with-number → unclear (not amount)', () => { expect(parseBillAnswer('21677 for asm site').kind).toBe('unclear') })
  test('a clean amount still parses', () => { expect(parseBillAnswer('19627')).toEqual({ kind: 'amount', amount: 19627 }) })
})
