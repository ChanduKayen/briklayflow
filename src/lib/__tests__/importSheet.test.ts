// importSheet — assemble ParsedRow[] from a header-mapped grid of raw cells, applying the importParse
// normalizers. The sheet mirrors the prototype's shape (date/name/amount/site/mode/note).

import { suite, test, expect } from './harness';
import { parseTable, assembleRows, hasAmbiguousDates } from '../importSheet';
import { detectColumns, detectDirection } from '../importParse';

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

suite('importSheet — Tally Day Book (twin Debit/Credit, Vch Type, Particulars as party)', () => {
  // Real Tally shape: a Payment's amount sits in Debit, a Receipt's in Credit; Vch Type gives in/out.
  const TALLY = {
    headers: ['Date', 'Particulars', 'Vch Type', 'Vch No.', 'Debit Amount', 'Credit Amount'],
    rows: [
      ['31-03-2026', 'Salary Payble A/c', 'Payment', '3', 8500, null],     // Payment → Debit → out
      ['28-04-2026', 'Venkata Praveen - Current A/c', 'Receipt', '9', null, 100000],  // Receipt → Credit → in
    ] as any[],
  };
  const { map, rows } = parseTable(TALLY, { refYear: 2026, dayFirst: true });

  test('"Debit Amount"/"Credit Amount" claim their own columns; Particulars is the note; Vch Type is direction', () => {
    expect(map.debit).toBe(4);
    expect(map.credit).toBe(5);
    expect(map.amount).toBe(undefined);
    expect(map.note).toBe(1);
    expect(map.direction).toBe(2);
  });

  test('a Payment (amount in Debit) reads as money OUT; Particulars becomes the party', () => {
    expect(rows[0]).toEqual({
      rowNo: 2, date: '2026-03-31', dateAmbiguous: false,
      name: 'Salary Payble A/c', amount: 8500, site: null,
      mode: null, note: 'Salary Payble A/c', directionCell: 'Payment',
    });
    expect(detectDirection({ directionCell: rows[0].directionCell })).toBe('out');
  });

  test('a Receipt (amount in Credit) reads as money IN', () => {
    expect(rows[1].amount).toBe(100000);
    expect(detectDirection({ directionCell: rows[1].directionCell })).toBe('in');
  });

  test('no Vch Type column → Day-Book side decides: Debit = out, Credit = in', () => {
    const t = { headers: ['Date', 'Particulars', 'Debit', 'Credit'], rows: [
      ['5-4-2026', 'Cement', 700, null],
      ['6-4-2026', 'Client advance', null, 500],
    ] as any[] };
    const out = parseTable(t, { refYear: 2026, dayFirst: true }).rows;
    expect(out[0].directionCell).toBe('out');
    expect(out[0].amount).toBe(700);
    expect(out[1].directionCell).toBe('in');
    expect(out[1].amount).toBe(500);
  });

  test('rowNos from the workbook drive rowNo (real source rows survive junk-row filtering)', () => {
    const t = { headers: ['Date', 'Name', 'Amount'], rows: [['5 Aug', 'Ramu', '500']] as any[], rowNos: [9] };
    expect(assembleRows(t, detectColumns(t.headers), { refYear: 2026 })[0].rowNo).toBe(9);
  });
});
