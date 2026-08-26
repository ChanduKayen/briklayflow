// Transactions importer — pure parsing/normalizing helpers (no I/O, no SheetJS here).
//
// The workbook read (SheetJS → rows of cells) is a thin wrapper added in the UI phase; everything
// that DECIDES anything lives here so it is unit-testable under `npm run test:lib`. Inputs arrive
// as already-extracted cell values (string | number | Date); outputs are the canonical shapes the
// bulk-import RPC and the resolver expect.
//
// Scope: English sheets for v1 (the detection heuristics are English), designed so the taxonomy of
// fields stays language-agnostic when we widen it later.

export type TxnMode = 'Cash' | 'UPI' | 'NEFT' | 'Cheque';
export type Direction = 'in' | 'out';

export type ImportField = 'date' | 'name' | 'amount' | 'site' | 'mode' | 'note' | 'direction';
export type ColumnMap = Partial<Record<ImportField, number>>;

// ── Amount ───────────────────────────────────────────────────────────────────────────────────────
/**
 * Parse an Indian-grouped money cell → a number, or null if there is nothing numeric to read.
 * Handles "₹1,68,000", "4,200", "86,400/-", "Rs 2000", plain numbers, and negatives (leading "-"
 * or accounting parentheses). Zero parses to 0 (a real value — the Check step flags zeros
 * separately; that is a validation question, not a parse failure).
 */
export function parseIndianAmount(raw: string | number | null | undefined): number | null {
  if (raw == null) return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = raw.trim();
  if (!s) return null;
  const paren = /^\((.*)\)$/.exec(s);           // (2,000) → negative
  let neg = false;
  if (paren) { neg = true; s = paren[1]; }
  s = s.replace(/[₹]/g, '').replace(/\brs\.?\b/gi, '').replace(/rupees?/gi, '').replace(/\/-/g, '');
  s = s.replace(/,/g, '').replace(/\s+/g, '').trim();   // Indian grouping is just commas — strip all
  if (s.startsWith('-')) { neg = true; s = s.slice(1); }
  if (s === '' || !/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

// ── Date ─────────────────────────────────────────────────────────────────────────────────────────
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};
const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

export interface ParsedDate {
  iso: string | null;   // best-guess yyyy-mm-dd (null if unreadable)
  ambiguous: boolean;   // a bare numeric d/m where both could be the day → the Check step must ask
}

/**
 * Parse a sheet date cell. Accepts Excel serials (number), JS Date, and text ("3/8", "5 Aug",
 * "11-08-2025"). A bare numeric date whose first two parts are BOTH 1..12 is ambiguous (3/8 = 3 Aug
 * or 8 Mar) unless `dayFirst` is given — that is the "ask once for the whole sheet" answer. A
 * month-name form is never ambiguous. A missing year falls back to `refYear` (default: this year).
 */
export function parseSheetDate(
  raw: string | number | Date | null | undefined,
  opts: { dayFirst?: boolean; refYear?: number } = {},
): ParsedDate {
  const refYear = opts.refYear ?? new Date().getFullYear();
  if (raw == null || raw === '') return { iso: null, ambiguous: false };

  if (raw instanceof Date && !isNaN(raw.getTime())) {
    return { iso: toISO(raw.getUTCFullYear(), raw.getUTCMonth() + 1, raw.getUTCDate()), ambiguous: false };
  }
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    // Excel serial (days since 1899-12-30, its epoch incl. the 1900 leap bug).
    const ms = Date.UTC(1899, 11, 30) + Math.round(raw) * 86400000;
    const d = new Date(ms);
    return { iso: toISO(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), ambiguous: false };
  }

  const s = String(raw).trim().toLowerCase();

  // Month-name forms: "5 aug", "aug 5", "5 aug 2025", "5-aug-25".
  const mn = /^(\d{1,2})[\s\-/]+([a-z]{3,4})\.?(?:[\s\-/]+(\d{2,4}))?$/.exec(s)
          || /^([a-z]{3,4})\.?[\s\-/]+(\d{1,2})(?:[\s\-/]+(\d{2,4}))?$/.exec(s);
  if (mn) {
    const dayFirst = /^\d/.test(s);
    const day = Number(dayFirst ? mn[1] : mn[2]);
    const mon = MONTHS[(dayFirst ? mn[2] : mn[1]).slice(0, 4)] ?? MONTHS[(dayFirst ? mn[2] : mn[1]).slice(0, 3)];
    let year = mn[3] ? Number(mn[3]) : refYear;
    if (year < 100) year += 2000;
    if (mon && day >= 1 && day <= 31) return { iso: toISO(year, mon, day), ambiguous: false };
  }

  // Bare numeric: d/m, d/m/y, with / - or . separators.
  const num = /^(\d{1,4})[\/\-.](\d{1,2})(?:[\/\-.](\d{1,4}))?$/.exec(s);
  if (num) {
    let a = Number(num[1]), b = Number(num[2]);
    let year = num[3] != null ? Number(num[3]) : refYear;
    if (year < 100) year += 2000;
    // ISO-ish "2025/08/03" (4-digit first part) → year is first.
    if (num[1].length === 4) { year = Number(num[1]); const m = Number(num[2]); const d = Number(num[3] ?? 1); return { iso: toISO(year, m, d), ambiguous: false }; }
    let ambiguous = false;
    let day: number, mon: number;
    if (a > 12 && b <= 12) { day = a; mon = b; }          // 19/8 → day is a
    else if (b > 12 && a <= 12) { day = b; mon = a; }      // 8/19 → day is b (US-ish); disambiguated by >12
    else if (opts.dayFirst === true) { day = a; mon = b; }
    else if (opts.dayFirst === false) { mon = a; day = b; }
    else { day = a; mon = b; ambiguous = a <= 12 && b <= 12; }  // both plausible → provisional day-first, flagged
    if (mon >= 1 && mon <= 12 && day >= 1 && day <= 31) return { iso: toISO(year, mon, day), ambiguous };
  }

  return { iso: null, ambiguous: false };
}

// ── Mode ─────────────────────────────────────────────────────────────────────────────────────────
/**
 * Map a free-text payment mode to the `payment_mode` enum, or null when unrecognized ("leave blank
 * if unsure"). "Bank"/transfer/NEFT/IMPS/RTGS all fold to NEFT (the enum's bank-transfer member).
 */
export function normalizeMode(raw: string | null | undefined): TxnMode | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (/\b(cash|by hand|nagadu)\b/.test(s) || s === 'cash') return 'Cash';
  if (/\b(upi|g[\s-]?pay|gpay|google pay|phonepe|phone pe|paytm|bhim|qr)\b/.test(s)) return 'UPI';
  if (/\b(cheque|check|chq|dd)\b/.test(s)) return 'Cheque';
  if (/\b(neft|imps|rtgs|bank|transfer|online|net ?banking|acct?|account)\b/.test(s)) return 'NEFT';
  return null;
}

// ── Direction ──────────────────────────────────────────────────────────────────────────────────────
/**
 * Decide in/out. Default is `out` (v1 is expenses); a row becomes income (`in`) on ANY of, in
 * precedence order: an explicit direction cell, a negative amount, a Client-type party, or an
 * income keyword in the note. This is deliberately eager per the product call ("probably all").
 */
export function detectDirection(opts: {
  directionCell?: string | null;
  amount?: number | null;
  note?: string | null;
  partyType?: string | null;
}): Direction {
  const dc = (opts.directionCell ?? '').trim().toLowerCase();
  if (dc) {
    if (/\b(in|credit|cr|received|receipt|deposit|income|inflow)\b/.test(dc)) return 'in';
    if (/\b(out|debit|dr|paid|payment|expense|outflow)\b/.test(dc)) return 'out';
  }
  if (typeof opts.amount === 'number' && opts.amount < 0) return 'in';
  if ((opts.partyType ?? '').trim().toLowerCase() === 'client') return 'in';
  const note = (opts.note ?? '').toLowerCase();
  if (/\b(received|receipt|instal?ment|instal|advance from|deposit|credited|refund)\b/.test(note)) return 'in';
  return 'out';
}

// ── Column detection ───────────────────────────────────────────────────────────────────────────────
// Ordered so a header is claimed by its most specific field first: direction/note/mode before the
// broad amount rule (which matches "paid"), name before site, etc. Each field takes the first
// still-unclaimed header that matches its pattern.
// Leading word-boundary only — NO trailing \b, so plurals in headers match ("Remarks" → remark,
// "Vendors" → vendor, "Notes" → note). Ordered by specificity so a header is claimed by its most
// precise field first (direction/note/mode before the broad amount rule that matches "paid").
const FIELD_PATTERNS: [ImportField, RegExp][] = [
  ['direction', /\b(direction|in\s*\/?\s*out|dr\s*\/?\s*cr|credit\/debit|type)/],
  ['note',      /\b(note|remark|desc|particular|purpose|detail|narration|comment|reason)/],
  ['mode',      /\b(mode|method|paid by|payment (mode|method|type)|via|instrument)/],
  ['date',      /\b(date|dt|day|txn date|transaction date)/],
  ['name',      /\b(name|payee|paid to|pay to|vendor|worker|party|supplier|received from|to whom)/],
  ['site',      /\b(site|project|location|work site|place)/],
  ['amount',    /\b(amount|amt|value|total|sum|paid|debit|credit|rs|₹|money)/],
];

/**
 * Map a header row to field → column index. Greedy by specificity (FIELD_PATTERNS order), each
 * header claimed once. Unmatched fields are simply absent — the caller decides what is required
 * (date, name, amount) vs optional (site, mode, note, direction) and can offer a manual mapping
 * fallback when a required field is missing.
 */
export function detectColumns(headers: (string | null | undefined)[]): ColumnMap {
  const norm = headers.map((h) => (h ?? '').toString().trim().toLowerCase());
  const map: ColumnMap = {};
  const claimed = new Set<number>();
  for (const [field, re] of FIELD_PATTERNS) {
    for (let i = 0; i < norm.length; i++) {
      if (claimed.has(i) || !norm[i]) continue;
      if (re.test(norm[i])) { map[field] = i; claimed.add(i); break; }
    }
  }
  return map;
}
