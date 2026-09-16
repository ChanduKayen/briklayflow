// Thin SheetJS wrapper — the ONLY impure part of the sheet-reading path (kept out of importSheet.ts so
// that module stays unit-testable without xlsx). Reads the first sheet of an .xlsx/.csv File into the
// header + rows shape assembleRows expects. cellDates keeps real dates as Date objects (parseSheetDate
// handles them); numbers stay numbers (parseIndianAmount handles the rest).

import * as XLSX from 'xlsx';
import type { SheetTable, Cell } from './importSheet';
import { findHeaderRow, detectColumns, parseSheetDate, parseIndianAmount } from './importParse';

/**
 * Build and download a starter .xlsx so a user knows the exact shape to bring.
 *  • 'standard' — the flat one-row-per-transaction sheet (Date, Name, Amount, Site, Mode, Note).
 *  • 'tally'    — a Tally Day Book export shape (Date, Particulars, Vch Type, Debit, Credit, Site).
 *                 Direction comes from Vch Type (Payment→out, Receipt→in); the filled Debit/Credit side
 *                 gives the amount (Payments sit in Debit, Receipts in Credit); Particulars is the party.
 *                 This runs in the real app (not the artifact sandbox), so writeFile downloads normally.
 */
export function downloadImportTemplate(kind: 'standard' | 'tally'): void {
  const rows: (string | number)[][] = kind === 'tally'
    ? [
        ['Date', 'Particulars', 'Vch Type', 'Debit', 'Credit', 'Site'],
        ['02-04-2026', 'Ramesh Cement Traders', 'Payment', 25000, '', 'Green Meadows'],
        ['03-04-2026', 'Advance from client', 'Receipt', '', 100000, 'Green Meadows'],
        ['04-04-2026', 'Suresh (labour)', 'Payment', 8000, '', 'Green Meadows'],
      ]
    : [
        ['Date', 'Name', 'Amount', 'Site', 'Mode', 'Note'],
        ['02-04-2026', 'Ramesh Cement Traders', 25000, 'Green Meadows', 'NEFT', 'Cement 50 bags'],
        ['03-04-2026', 'Suresh (labour)', 8000, 'Green Meadows', 'Cash', 'Week wages'],
      ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, kind === 'tally' ? 'Tally' : 'Transactions');
  XLSX.writeFile(wb, kind === 'tally' ? 'briklay-tally-template.xlsx' : 'briklay-import-template.xlsx');
}

export async function readWorkbook(file: File): Promise<SheetTable> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', cellDates: true });
  const first = wb.SheetNames[0];
  if (!first) return { headers: [], rows: [] };
  const ws = wb.Sheets[first];
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, blankrows: false, defval: null });
  if (!aoa.length) return { headers: [], rows: [] };

  // The header may not be row 1 — Tally/bank exports carry a title+period banner above it.
  const grid = aoa as (string | number | Date | null | undefined)[][];
  const h = findHeaderRow(grid);
  const headers = (grid[h] ?? []).map((c) => (c == null ? '' : String(c)));

  // Drop non-data rows below the header (a "Inwards Qty/Outwards Qty" sub-header, blank lines, a
  // trailing total). Keep a row only if it has a real date, or a party name + a money value — using the
  // detected columns so the test stays honest to what the importer will actually read.
  const map = detectColumns(headers);
  const nameIdx = map.name ?? map.note;
  const moneyIdx = [map.amount, map.debit, map.credit].filter((i): i is number => i != null);
  const hasDate = (r: Cell[]) => map.date != null && parseSheetDate(r[map.date] ?? null).iso != null;
  const hasName = (r: Cell[]) => nameIdx != null && String(r[nameIdx] ?? '').trim() !== '';
  const hasMoney = (r: Cell[]) => moneyIdx.some((i) => { const v = parseIndianAmount(r[i] as string | number | null); return v != null && v !== 0; });

  const rows: Cell[][] = [];
  const rowNos: number[] = [];
  for (let i = h + 1; i < grid.length; i++) {
    const r = grid[i] as Cell[];
    if (hasDate(r) || (hasName(r) && hasMoney(r))) { rows.push(r); rowNos.push(i + 1); }  // 1-based source row
  }
  return { headers, rows, rowNos };
}
