// THE AMOUNT, READ BACK.
//
// The composer's keypad has no decimal point and no keyboard — just digits and "000". That makes a
// missing or extra zero the one mistake it can't stop you making, and ₹2,40,000 filed for ₹24,000 is
// not a typo anyone notices in a list. So the panel says the number back in words, under the figure,
// where the eye is already looking.
//
// Indian numbering, because that is how the number will be said out loud on site: thousand, lakh,
// crore — not million. These are that function's terms.

import { suite, test, expect } from './harness'
import { words, fmt } from '../../components/nav/txDraft'

suite('the amount, read back in words', () => {
  test('nothing typed says nothing', () => {
    expect(words(0)).toBe('');
  });

  test('the small ones, as they are said', () => {
    expect(words(1)).toBe('one');
    expect(words(19)).toBe('nineteen');
    expect(words(20)).toBe('twenty');
    expect(words(45)).toBe('forty-five');
    expect(words(192)).toBe('one hundred ninety-two');
    expect(words(900)).toBe('nine hundred');
  });

  test('thousands — the everyday amount', () => {
    expect(words(1000)).toBe('one thousand');
    expect(words(9000)).toBe('nine thousand');
    expect(words(24000)).toBe('twenty-four thousand');
    expect(words(46800)).toBe('forty-six thousand eight hundred');
    expect(words(38300)).toBe('thirty-eight thousand three hundred');
  });

  test('lakh and crore, not million — this is how it is said on site', () => {
    expect(words(100000)).toBe('one lakh');
    expect(words(118000)).toBe('one lakh eighteen thousand');
    expect(words(462300)).toBe('four lakh sixty-two thousand three hundred');
    expect(words(10000000)).toBe('one crore');
    expect(words(22171430)).toBe('two crore twenty-one lakh seventy-one thousand four hundred thirty');
  });

  test('the zeroes between the groups are not spoken', () => {
    expect(words(100005)).toBe('one lakh five');
    expect(words(1000000)).toBe('ten lakh');
    expect(words(10000500)).toBe('one crore five hundred');
  });

  test('paise never arrive: the keypad has no point, so the words never have one either', () => {
    expect(words(24000.75)).toBe('twenty-four thousand');
  });

  test('the figure above the words groups the Indian way', () => {
    expect(fmt('24000')).toBe('24,000');
    expect(fmt('100000')).toBe('1,00,000');
    expect(fmt('22171430')).toBe('2,21,71,430');
    expect(fmt('')).toBe('0');
    expect(fmt('000')).toBe('0');            // "000" alone is still nothing
  });
});
