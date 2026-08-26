// Thin SheetJS wrapper — the ONLY impure part of the sheet-reading path (kept out of importSheet.ts so
// that module stays unit-testable without xlsx). Reads the first sheet of an .xlsx/.csv File into the
// header + rows shape assembleRows expects. cellDates keeps real dates as Date objects (parseSheetDate
// handles them); numbers stay numbers (parseIndianAmount handles the rest).

import * as XLSX from 'xlsx';
import type { SheetTable } from './importSheet';

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
