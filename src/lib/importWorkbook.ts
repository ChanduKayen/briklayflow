// Thin SheetJS wrapper — the ONLY impure part of the sheet-reading path (kept out of importSheet.ts so
// that module stays unit-testable without xlsx). Reads the first sheet of an .xlsx/.csv File into the
// header + rows shape assembleRows expects. cellDates keeps real dates as Date objects (parseSheetDate
// handles them); numbers stay numbers (parseIndianAmount handles the rest).

import * as XLSX from 'xlsx';
import type { SheetTable } from './importSheet';

/**
 * Build and download a starter .xlsx so a user knows the exact shape to bring.
 *  • 'standard' — the flat one-row-per-transaction sheet (Date, Name, Amount, Site, Mode, Note).
 *  • 'tally'    — a Tally Cash/Bank book export shape (Date, Particulars, Vch Type, Debit, Credit,
 *                 Site). The importer reads Debit = money IN, Credit = money OUT, and uses Particulars
 *                 as the party. This runs in the real app (not the artifact sandbox), so writeFile
 *                 triggers a normal browser download.
 */
export function downloadImportTemplate(kind: 'standard' | 'tally'): void {
  const rows: (string | number)[][] = kind === 'tally'
    ? [
        ['Date', 'Particulars', 'Vch Type', 'Debit', 'Credit', 'Site'],
        ['02-04-2026', 'Ramesh Cement Traders', 'Payment', '', 25000, 'Green Meadows'],
        ['03-04-2026', 'Advance from client', 'Receipt', 100000, '', 'Green Meadows'],
        ['04-04-2026', 'Suresh (labour)', 'Payment', '', 8000, 'Green Meadows'],
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
  const headers = (aoa[0] as unknown[]).map((h) => (h == null ? '' : String(h)));
  const rows = aoa.slice(1).map((r) => r as (string | number | Date | null)[]);
  return { headers, rows };
}
