// importParse — pure normalizers for the Transactions importer. Fixtures lean on the prototype's
// own sample cells (briklay-import-simple.html) so the tests track the real thing the sheets carry:
// Indian-grouped amounts, "3/8" ambiguity, blank/zero amounts, "Bank" mode, income triggers.

import { suite, test, expect } from './harness';
import { parseIndianAmount, parseSheetDate, normalizeMode, detectDirection, detectColumns } from '../importParse';

suite('importParse — Indian amounts', () => {
  test('grouped amounts strip commas correctly', () => {
    expect(parseIndianAmount('4,200')).toBe(4200);
    expect(parseIndianAmount('1,68,000')).toBe(168000);   // Indian grouping, not thousands
    expect(parseIndianAmount('₹86,400')).toBe(86400);
    expect(parseIndianAmount('Rs 2000')).toBe(2000);
    expect(parseIndianAmount('2,000/-')).toBe(2000);
  });
  test('numbers pass through; a plain 0 is a real 0, not a failure', () => {
    expect(parseIndianAmount(7500)).toBe(7500);
    expect(parseIndianAmount('0')).toBe(0);
  });
  test('negatives — leading minus and accounting parentheses', () => {
    expect(parseIndianAmount('-500')).toBe(-500);
    expect(parseIndianAmount('(2,000)')).toBe(-2000);
  });
  test('blank / non-numeric → null (the Check step flags it)', () => {
    expect(parseIndianAmount('')).toBe(null);
    expect(parseIndianAmount('   ')).toBe(null);
    expect(parseIndianAmount('tea, water cans')).toBe(null);
    expect(parseIndianAmount(null)).toBe(null);
  });
});

suite('importParse — dates', () => {
  const y = { refYear: 2026 };
  test('month-name forms are unambiguous', () => {
    expect(parseSheetDate('5 Aug', y)).toEqual({ iso: '2026-08-05', ambiguous: false });
    expect(parseSheetDate('19 Aug', y)).toEqual({ iso: '2026-08-19', ambiguous: false });
  });
  test('"3/8" is genuinely ambiguous — provisional day-first, flagged for the Check step', () => {
    expect(parseSheetDate('3/8', y)).toEqual({ iso: '2026-08-03', ambiguous: true });
  });
  test('the whole-sheet "ask once" answer resolves it (dayFirst false → 3 Mar)', () => {
    expect(parseSheetDate('3/8', { refYear: 2026, dayFirst: false })).toEqual({ iso: '2026-03-08', ambiguous: false });
  });
  test('a part > 12 disambiguates itself (19/8 → 19 Aug)', () => {
    expect(parseSheetDate('19/8', y)).toEqual({ iso: '2026-08-19', ambiguous: false });
  });
  test('ISO-ish 4-digit-first is taken year-first', () => {
    expect(parseSheetDate('2025/08/03', y)).toEqual({ iso: '2025-08-03', ambiguous: false });
  });
  test('an Excel serial number is converted (44927 → 2023-01-01)', () => {
    expect(parseSheetDate(44927).iso).toBe('2023-01-01');
  });
  test('a JS Date is read in UTC', () => {
    expect(parseSheetDate(new Date(Date.UTC(2026, 7, 5))).iso).toBe('2026-08-05');
  });
  test('unreadable → null, not a throw', () => {
    expect(parseSheetDate('sometime last week', y)).toEqual({ iso: null, ambiguous: false });
  });
});

suite('importParse — payment mode', () => {
  test('recognised modes fold to the enum; "Bank" → NEFT', () => {
    expect(normalizeMode('Cash')).toBe('Cash');
    expect(normalizeMode('UPI')).toBe('UPI');
    expect(normalizeMode('gpay')).toBe('UPI');
    expect(normalizeMode('PhonePe')).toBe('UPI');
    expect(normalizeMode('Bank')).toBe('NEFT');
    expect(normalizeMode('IMPS')).toBe('NEFT');
    expect(normalizeMode('chq')).toBe('Cheque');
  });
  test('blank / unknown → null ("leave blank if unsure")', () => {
    expect(normalizeMode('')).toBe(null);
    expect(normalizeMode('barter')).toBe(null);
  });
});

suite('importParse — direction (default out, income on any trigger)', () => {
  test('default is out (v1 is expenses)', () => {
    expect(detectDirection({ amount: 5000, note: 'cement bags' })).toBe('out');
  });
  test('an explicit direction cell wins', () => {
    expect(detectDirection({ directionCell: 'Credit' })).toBe('in');
    expect(detectDirection({ directionCell: 'Paid' })).toBe('out');
    expect(detectDirection({ directionCell: 'out', amount: -500 })).toBe('out');  // explicit beats sign
  });
  test('a negative amount → in', () => {
    expect(detectDirection({ amount: -2000 })).toBe('in');
  });
  test('a Client party → in', () => {
    expect(detectDirection({ amount: 500000, partyType: 'Client' })).toBe('in');
  });
  test('an income keyword in the note → in', () => {
    expect(detectDirection({ amount: 500000, note: '3rd instalment received' })).toBe('in');
  });
});

suite('importParse — column detection', () => {
  test('a plain English header row maps cleanly', () => {
    const m = detectColumns(['Date', 'Paid To', 'Amount', 'Site', 'Mode', 'Note']);
    expect(m).toEqual({ date: 0, name: 1, amount: 2, site: 3, mode: 4, note: 5 });
  });
  test('synonyms resolve — Vendor/Project/Remarks', () => {
    const m = detectColumns(['Txn Date', 'Vendor', 'Value', 'Project', 'Payment Method', 'Remarks']);
    expect(m.name).toBe(1);
    expect(m.site).toBe(3);
    expect(m.note).toBe(5);
  });
  test('"Paid To" is a name, not an amount — and a separate "Paid" is the amount', () => {
    const m = detectColumns(['Date', 'Paid To', 'Paid']);
    expect(m.name).toBe(1);
    expect(m.amount).toBe(2);
  });
  test('a bare "Type" header is direction, not mode', () => {
    const m = detectColumns(['Date', 'Name', 'Amount', 'Type']);
    expect(m.direction).toBe(3);
  });
});
