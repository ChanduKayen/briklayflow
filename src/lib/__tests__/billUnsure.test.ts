// WHAT THE READER WAS UNSURE OF.
//
// The bill panel's check step puts a hollow clay ring beside the lines it wants you to look at.
// Nothing in the extract comes back with a confidence score, so the ring has to be earned honestly —
// from what the read actually produced. Two things earn it:
//   · a field the reader could not find at all (no vendor, no number, no date, no amount)
//   · a date that cannot be right — tomorrow's bill, or one from before the firm existed. That is
//     the classic misread: a year picked up wrong, or the due date read as the bill date.
// Everything else is left alone, because a ring on every line is a ring on none.

import { suite, test, expect } from './harness'
import { unsureOf } from '../../components/nav/billUnsure'

const iso = (daysFromNow: number) => new Date(Date.now() + daysFromNow * 864e5).toISOString().slice(0, 10);
const bill = (over: Partial<Parameters<typeof unsureOf>[0]> = {}) =>
  unsureOf({ vendor: 'Sri Durga Cements', no: 'SDC/26/1187', date: iso(-1), amount: '46800', site: '', siteName: '', ...over });

suite('the bill panel — what the reader was unsure of', () => {
  test('a clean read asks nothing', () => {
    expect(bill()).toEqual([]);
  });

  test('a field it could not find asks to be checked', () => {
    expect(bill({ vendor: '' })).toEqual(['vendor']);
    expect(bill({ no: '   ' })).toEqual(['no']);
    expect(bill({ date: '' })).toEqual(['date']);
    expect(bill({ amount: '' })).toEqual(['amount']);
    expect(bill({ amount: '0' })).toEqual(['amount']);
  });

  test('a bill dated in the future is a misread, not a bill', () => {
    expect(bill({ date: iso(3) })).toEqual(['date']);
    expect(bill({ date: iso(730) })).toEqual(['date']);
  });

  test('today and yesterday are fine — a bill photographed the day it was written', () => {
    expect(bill({ date: iso(0) })).toEqual([]);
    expect(bill({ date: iso(-1) })).toEqual([]);
  });

  test('an old bill is allowed; an impossibly old one is not', () => {
    expect(bill({ date: iso(-400) })).toEqual([]);       // last year's bill, catching up
    expect(bill({ date: iso(-900) })).toEqual(['date']); // two and a half years: a misread year
  });

  test('several at once, in the order the slip reads them', () => {
    expect(bill({ vendor: '', no: '', date: '', amount: '' })).toEqual(['vendor', 'no', 'date', 'amount']);
    expect(bill({ no: '', amount: '0' })).toEqual(['no', 'amount']);
  });

  test('the site is never rung: it is not on the bill to begin with', () => {
    expect(bill({ site: '', siteName: '' })).toEqual([]);
  });
});
