// Transactions importer — assemble normalized rows from a parsed sheet table. PURE (no xlsx here;
// the workbook read lives in importWorkbook.ts so this stays unit-testable). Turns a header-mapped
// grid of raw cells into ParsedRow[] the resolver consumes, applying the importParse normalizers.

import {
  detectColumns, parseIndianAmount, parseSheetDate, normalizeMode,
  type ColumnMap, type ImportField,
} from './importParse';
import type { ParsedRow } from './importResolve';

export type Cell = string | number | Date | null | undefined;
export interface SheetTable { headers: string[]; rows: Cell[][] }

const str = (v: Cell): string | null => {
  if (v == null) return null;
  const s = (v instanceof Date ? v.toISOString() : String(v)).trim();
  return s || null;
};

/**
 * Map a raw table to ParsedRow[]. `map` comes from detectColumns (or a manual override); `opts.dayFirst`
 * is the whole-sheet "ask once" date answer; `refYear` the year for year-less dates. rowNo is the source
 * SHEET row (header is row 1, so the first data row is 2) — the number shown in the Check step.
 */
export function assembleRows(
  table: SheetTable,
  map: ColumnMap,
  opts: { dayFirst?: boolean; refYear?: number } = {},
): ParsedRow[] {
  const at = (row: Cell[], field: ImportField): Cell => {
    const i = map[field];
    return i == null ? null : row[i] ?? null;
  };
  // A Tally-style export carries a SEPARATE Debit + Credit pair. With both columns present we read the
  // filled side as the amount and derive direction: Debit = money IN, Credit = money OUT (the reading a
  // Tally Cash/Bank book gives, and consistent with Receipt vouchers landing in Debit, Payments in Credit).
  const twin = map.debit != null && map.credit != null;
  return table.rows.map((row, idx) => {
    const d = parseSheetDate(at(row, 'date'), opts);
    let amount = parseIndianAmount(at(row, 'amount') as string | number | null);
    let directionCell = str(at(row, 'direction'));
    let name = str(at(row, 'name'));

    if (map.debit != null || map.credit != null) {
      const dv = map.debit != null ? parseIndianAmount(at(row, 'debit') as string | number | null) : null;
      const cv = map.credit != null ? parseIndianAmount(at(row, 'credit') as string | number | null) : null;
      if (dv != null && dv !== 0) { amount = Math.abs(dv); if (twin) directionCell = 'in'; }
      else if (cv != null && cv !== 0) { amount = Math.abs(cv); if (twin) directionCell = 'out'; }
      else if (dv != null || cv != null) { amount = Math.abs((dv ?? cv) as number); }
      // A Tally daybook has no "name" column — the party is the Particulars (claimed as note).
      if (!name) name = str(at(row, 'note'));
    }

    return {
      rowNo: idx + 2,
      date: d.iso,
      dateAmbiguous: d.ambiguous,
      name,
      amount,
      site: str(at(row, 'site')),
      mode: normalizeMode(str(at(row, 'mode'))),
      note: str(at(row, 'note')),
      directionCell,
    };
  });
}

/** True if any row's date came out ambiguous — the wizard uses this to ask the day/month question once. */
export function hasAmbiguousDates(rows: ParsedRow[]): boolean {
  return rows.some((r) => r.dateAmbiguous);
}

/** Convenience: detect columns from the header row and assemble in one call. */
export function parseTable(table: SheetTable, opts: { dayFirst?: boolean; refYear?: number } = {}): {
  map: ColumnMap;
  rows: ParsedRow[];
} {
  const map = detectColumns(table.headers);
  return { map, rows: assembleRows(table, map, opts) };
}
