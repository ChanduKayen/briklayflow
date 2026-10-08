// Bill-date plausibility — the deterministic safety net over the extractor's date reading.
//
// A vision model reading a handwritten, rotated cash voucher will sometimes emit a confident-but-wrong
// date (a "12/12/2026" read as Oct 2023). This never trusts a single OCR date: it checks the read date
// against reality — is it in the future? implausibly old? a year that isn't this year or last? did the
// model itself flag low confidence? — and, when something's off, proposes the most likely correction
// (keep the day/month, snap the year to now) so the user confirms in one tap instead of retyping.
//
// It NEVER blocks filing. It only decides whether to ASK. This is exactly the human-in-the-loop pattern
// commercial bill tools (Dext, Bill.com, Ramp, Concur) use: low-confidence financial fields get confirmed,
// never silently posted.

export interface BillDateAssessment {
  date: string | null;        // the ISO date to use as-is (the read date, when readable)
  flagged: boolean;           // true → surface a confirmation before filing
  reason: string | null;      // short human-readable why, for the nudge
  suggestion: string | null;  // a corrected ISO date to offer ("Did you mean …?"), or null
}

const DAY = 86400000;
const pad = (n: number) => String(n).padStart(2, '0');
const toISO = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;

// Parse an ISO (YYYY-MM-DD) date-only string to a UTC Date, or null. Avoids timezone drift.
function parseISO(s: string | null | undefined): Date | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s).trim());
  if (!m) return null;
  const dt = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  return isNaN(dt.getTime()) ? null : dt;
}

// Parse a raw hand/printed date string with INDIAN locale (DAY first): "12/12/2026", "15-3-26",
// "01.02.2026". Returns {y,m,d} or null. A 2-digit year maps into the 2000s.
export function parseRawIndia(raw: string | null | undefined): { y: number; m: number; d: number } | null {
  if (!raw) return null;
  const m = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{2,4})/.exec(String(raw));
  if (!m) return null;
  let d = +m[1], mo = +m[2], y = +m[3];
  if (y < 100) y += 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  return { y, m: mo, d };
}

// Given a day+month, pick the year (currentYear, else previous) that lands the date on/before today+grace.
function recentYearFor(mo: number, d: number, today: Date, graceDays = 2): string | null {
  const cur = today.getUTCFullYear();
  for (const y of [cur, cur - 1]) {
    const cand = new Date(Date.UTC(y, mo - 1, d));
    if (!isNaN(cand.getTime()) && cand.getTime() <= today.getTime() + graceDays * DAY) {
      return toISO(y, mo, d);
    }
  }
  // both this year and last are still in the future (a Jan bill read in Dec, say) → previous year.
  const cand = new Date(Date.UTC(cur - 1, mo - 1, d));
  return isNaN(cand.getTime()) ? null : toISO(cur - 1, mo - 1, d);
}

export function assessBillDate(input: {
  iso: string | null;
  raw?: string | null;
  confidence?: 'high' | 'medium' | 'low' | null;
  today?: Date;
  cutover?: string | null;    // the org's opening/cutover date — a bill before it is suspicious
  maxAgeMonths?: number;      // how far back is "plausibly recent" (default 12)
}): BillDateAssessment {
  const today = input.today ?? new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
  const maxAgeMonths = input.maxAgeMonths ?? 12;
  const dt = parseISO(input.iso);
  const cur = today.getUTCFullYear();

  // The correction we'd propose: from the raw string if we can read it, else from the read ISO.
  const rawParsed = parseRawIndia(input.raw);
  const mo = rawParsed?.m ?? (dt ? dt.getUTCMonth() + 1 : null);
  const d = rawParsed?.d ?? (dt ? dt.getUTCDate() : null);
  const suggestion = mo && d ? recentYearFor(mo, d, today) : null;
  const differs = (s: string | null) => s && s !== input.iso ? s : null;

  // 1) Unreadable — no date to trust at all.
  if (!dt) {
    return { date: null, flagged: true, reason: 'The date couldn’t be read — please set it.', suggestion: differs(suggestion) };
  }

  const ageMs = today.getTime() - dt.getTime();
  const yr = dt.getUTCFullYear();

  // 2) In the future (beyond a small grace for timezones / a bill dated tomorrow).
  if (dt.getTime() > today.getTime() + 2 * DAY) {
    return { date: input.iso, flagged: true, reason: 'That date is in the future.', suggestion: differs(suggestion) };
  }
  // 3) Year isn't this year or last — the classic OCR year misread.
  if (yr !== cur && yr !== cur - 1) {
    return { date: input.iso, flagged: true, reason: `The year reads ${yr}, which looks misread.`, suggestion: differs(suggestion) };
  }
  // 4) Implausibly old.
  if (ageMs > maxAgeMonths * 30 * DAY) {
    const months = Math.round(ageMs / (30 * DAY));
    return { date: input.iso, flagged: true, reason: `That date is about ${months} months ago — unusually old for a bill.`, suggestion: differs(suggestion) };
  }
  // 5) Before the ledger cutover — it would fold into the opening balance rather than show as a line.
  const cut = parseISO(input.cutover ?? null);
  if (cut && dt.getTime() < cut.getTime()) {
    return { date: input.iso, flagged: true, reason: 'That date is before your ledger opening.', suggestion: differs(suggestion) };
  }
  // 6) The model itself was unsure.
  if (input.confidence === 'low') {
    return { date: input.iso, flagged: true, reason: 'The date was read with low confidence — please confirm.', suggestion: differs(suggestion) };
  }

  return { date: input.iso, flagged: false, reason: null, suggestion: null };
}
