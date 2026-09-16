// importSheet — assemble ParsedRow[] from a header-mapped grid of raw cells, applying the importParse
// normalizers. The sheet mirrors the prototype's shape (date/name/amount/site/mode/note).

import { suite, test, expect } from './harness';
import { parseTable, assembleRows, hasAmbiguousDates } from '../importSheet';
import { detectColumns } from '../importParse';

const TABLE = {
  headers: ['Date', 'Paid To', 'Amount', 'Site', 'Mode', 'Note'],
  rows: [
    ['5 Aug', 'Durga', '8,400', 'Gandhinagar Villas', 'Cash', 'week wages'],
    ['3/8', 'Suri Babu', '4,200', 'Kakinada', 'UPI', 'majoori'],   // ambiguous "3/8" date
  ],
};

suite('importSheet — assemble rows', () => {
  const { map, rows } = parseTable(TABLE, { refYear: 2026 });

  test('columns auto-detect from the header', () => {
    expect(map).toEqual({ date: 0, name: 1, amount: 2, site: 3, mode: 4, note: 5 });
  });

  test('the first row normalizes end to end', () => {
    expect(rows[0]).toEqual({
      rowNo: 2,                       // header is row 1
      date: '2026-08-05', dateAmbiguous: false,
      name: 'Durga', amount: 8400, site: 'Gandhinagar Villas', mode: 'Cash',
      note: 'week wages', directionCell: null,
    });
  });

  test('an ambiguous date is flagged for the Check step', () => {
    expect(rows[1].date).toBe('2026-08-03');
    expect(rows[1].dateAmbiguous).toBe(true);
    expect(hasAmbiguousDates(rows)).toBe(true);
  });

  test('the whole-sheet dayFirst answer resolves ambiguity everywhere', () => {
    const resolved = assembleRows(TABLE, detectColumns(TABLE.headers), { refYear: 2026, dayFirst: false });
    expect(resolved[1].date).toBe('2026-03-08');
    expect(resolved[1].dateAmbiguous).toBe(false);
  });

  test('a missing optional column is simply absent (no crash)', () => {
    const t = { headers: ['Date', 'Name', 'Amount'], rows: [['5 Aug', 'Ramu', '500']] };
    const out = parseTable(t, { refYear: 2026 }).rows[0];
    expect(out.site).toBe(null);
    expect(out.mode).toBe(null);
    expect(out.amount).toBe(500);
  });
});

suite('importSheet — Tally cash/bank book (twin Debit/Credit, Particulars as party)', () => {
  const TALLY = {
    headers: ['Date', 'Particulars', 'Vch Type', 'Debit', 'Credit', 'Site'],
    rows: [
      ['02-04-2026', 'Ramesh Cement Traders', 'Payment', '', '25,000', 'Green Meadows'],  // credit → money out
      ['03-04-2026', 'Advance from client', 'Receipt', '1,00,000', '', 'Green Meadows'],   // debit  → money in
    ],
  };
  const { map, rows } = parseTable(TALLY, { refYear: 2026, dayFirst: true });

  test('debit and credit are detected as their own columns, not amount', () => {
    expect(map.debit).toBe(3);
    expect(map.credit).toBe(4);
    expect(map.amount).toBe(undefined);
    expect(map.note).toBe(1);   // Particulars
  });

  test('a Credit is money OUT; Particulars becomes the party', () => {
    expect(rows[0]).toEqual({
      rowNo: 2, date: '2026-04-02', dateAmbiguous: false,
      name: 'Ramesh Cement Traders', amount: 25000, site: 'Green Meadows',
      mode: null, note: 'Ramesh Cement Traders', directionCell: 'out',
    });
  });

  test('a Debit is money IN', () => {
    expect(rows[1].amount).toBe(100000);
    expect(rows[1].directionCell).toBe('in');
    expect(rows[1].name).toBe('Advance from client');
  });
});
