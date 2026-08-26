// importResolve — the Transactions importer's resolve layer: collapse rows to unique names/sites,
// band them, flag un-fileable rows, and detect ones already in the books (within the sheet's own
// date span). Fixtures follow the prototype's shape (briklay-import-simple.html).

import { suite, test, expect } from './harness';
import {
  groupNames, groupSites, validateRow, findDuplicates,
  type ParsedRow, type ResolvedRow, type ExistingTxn,
} from '../importResolve';

const STAKEHOLDERS = [
  { stakeholder_id: 'S1', name: 'Durga Prasad' },
  { stakeholder_id: 'S2', name: 'Durga Traders' },
  { stakeholder_id: 'S3', name: 'Balaji Hardware' },
];
const PROJECTS = [
  { id: 'P1', name: 'Gandhinagar Villas' },
  { id: 'P2', name: 'The Pride' },
];

const row = (o: Partial<ParsedRow> & { rowNo: number }): ParsedRow => ({
  date: '2026-08-06', name: null, amount: 1000, site: null, mode: null, note: null, ...o,
});

suite('importResolve — group names (resolve once, most-used first)', () => {
  const rows = [
    row({ rowNo: 1, name: 'Durga', note: 'wages', amount: 8400 }),
    row({ rowNo: 2, name: 'durga', note: 'centering', amount: 3000 }),   // same name, different case
    row({ rowNo: 3, name: 'Balaji Hardware', note: 'nails', amount: 2000 }),
    row({ rowNo: 4, name: 'Nagaraju Sand', note: 'river sand', amount: 4000 }),
  ];
  const groups = groupNames(rows, STAKEHOLDERS);

  test('12 rows collapse to unique names, most-used first', () => {
    expect(groups.map((g) => g.key)).toEqual(['durga', 'balaji hardware', 'nagaraju sand']);
  });
  test('a name gathers all its rows and all its notes (for the LLM classify)', () => {
    const durga = groups.find((g) => g.key === 'durga')!;
    expect(durga.rowNos).toEqual([1, 2]);
    expect(durga.notes).toEqual(['wages', 'centering']);
  });
  test('"Durga" is a confirm/doubt (two Durgas) — never a silent auto-link', () => {
    const durga = groups.find((g) => g.key === 'durga')!;
    expect(durga.match.band).toBe('confirm');
    expect(durga.match.doubt).toBe(true);
  });
  test('"Balaji Hardware" auto-links; "Nagaraju Sand" is new (open → create form)', () => {
    expect(groups.find((g) => g.key === 'balaji hardware')!.match.band).toBe('auto');
    expect(groups.find((g) => g.key === 'nagaraju sand')!.match.band).toBe('open');
  });
});

suite('importResolve — group sites', () => {
  test('sites collapse and band; blank-site rows are skipped (handled in Check)', () => {
    const rows = [
      row({ rowNo: 1, site: 'Gandhinagar Villas' }),
      row({ rowNo: 2, site: 'gandhinagar villas' }),
      row({ rowNo: 3, site: null }),
      row({ rowNo: 4, site: 'Zenith Heights' }),
    ];
    const g = groupSites(rows, PROJECTS);
    expect(g.map((x) => x.key)).toEqual(['gandhinagar villas', 'zenith heights']);
    expect(g.find((x) => x.key === 'gandhinagar villas')!.match.best?.id).toBe('P1');
    expect(g.find((x) => x.key === 'zenith heights')!.match.band).toBe('open');
  });
});

suite('importResolve — validate a row (one blocking reason, or clean)', () => {
  test('blank amount', () => { expect(validateRow(row({ rowNo: 1, name: 'X', amount: null }))).toEqual({ field: 'amount', why: 'blank' }); });
  test('zero amount', () => { expect(validateRow(row({ rowNo: 1, name: 'X', amount: 0 }))).toEqual({ field: 'amount', why: 'zero' }); });
  test('unreadable date', () => { expect(validateRow(row({ rowNo: 1, name: 'X', amount: 5000, date: null }))).toEqual({ field: 'date', why: 'unreadable' }); });
  test('ambiguous date', () => { expect(validateRow(row({ rowNo: 1, name: 'X', amount: 5000, dateAmbiguous: true }))).toEqual({ field: 'date', why: 'ambiguous' }); });
  test('blank name (amount + date fine)', () => { expect(validateRow(row({ rowNo: 1, name: '', amount: 2000, date: '2026-08-19' }))).toEqual({ field: 'name', why: 'blank' }); });
  test('a complete row is clean', () => { expect(validateRow(row({ rowNo: 1, name: 'Suri', amount: 2000, date: '2026-08-19' }))).toBe(null); });
});

suite('importResolve — duplicates, scoped to the sheet date span', () => {
  const resolved: ResolvedRow[] = [
    { rowNo: 1, stakeholderId: 'S1', date: '2026-08-06', amount: 8400, mode: 'Cash' },
    { rowNo: 3, stakeholderId: 'S3', date: '2026-08-11', amount: 2000, mode: 'NEFT' },
    { rowNo: 4, stakeholderId: null, date: '2026-08-04', amount: 4000, mode: null },   // unresolved → never a dup
  ];
  const existing: ExistingTxn[] = [
    { txn_id: 'T1', stakeholder_id: 'S1', date: '2026-08-06', amount: 8400, mode: 'Cash' },   // dup of row 1
    { txn_id: 'T2', stakeholder_id: 'S3', date: '2026-08-11', amount: 2000, mode: 'NEFT' },   // dup of row 3
    { txn_id: 'T3', stakeholder_id: 'S1', date: '2026-07-01', amount: 8400, mode: 'Cash' },   // OUT of span (July)
  ];

  test('rows already in the books are flagged; the out-of-span match is ignored', () => {
    const hits = findDuplicates(resolved, existing);
    expect(hits.map((h) => h.rowNo)).toEqual([1, 3]);
    expect(hits.map((h) => h.existing.txn_id).includes('T3')).toBe(false);
  });

  test('one-to-one — two identical same-day rows, one existing txn → only ONE is a dup', () => {
    const twins: ResolvedRow[] = [
      { rowNo: 1, stakeholderId: 'S1', date: '2026-08-06', amount: 8400, mode: 'Cash' },
      { rowNo: 2, stakeholderId: 'S1', date: '2026-08-06', amount: 8400, mode: 'Cash' },
    ];
    const one: ExistingTxn[] = [{ txn_id: 'E1', stakeholder_id: 'S1', date: '2026-08-06', amount: 8400, mode: 'Cash' }];
    expect(findDuplicates(twins, one).length).toBe(1);
  });
});
