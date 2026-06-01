// Converts mixed/whole/standalone fractional-inch expressions to a decimal string.
//   "1 1/2" | "11/2" | "1-1/2" | "1½" | "1 1/2 inch"  → "1.5"   (unit suffix preserved)
//   "1/2" → "0.5"   |   "3/4\"" → "0.75\""   |   "1½ inch" → "1.5 inch"
//   already-decimal / plain numbers pass through unchanged ("1.5" → "1.5", "12" → "12").
//
// Hardware uses fractional inches everywhere (screws, bolts, pipe), and the catalog
// stores decimals — so the user's "11/2\"" must land on the same value as "1.5\"".
const VULGAR: Record<string, string> = {
  '½': '1/2', '¼': '1/4', '¾': '3/4', '⅓': '1/3', '⅔': '2/3',
  '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8',
};

export function normalizeFraction(input: string): string {
  if (!input) return input;
  let s = input.trim();

  // Expand unicode vulgar fractions to ascii ("1½" → "1 1/2", standalone "½" → "1/2").
  s = s.replace(/(\d)\s*([½¼¾⅓⅔⅛⅜⅝⅞])/g, (_m, w, v) => `${w} ${VULGAR[v]}`);
  s = s.replace(/([½¼¾⅓⅔⅛⅜⅝⅞])/g, (_m, v) => VULGAR[v]);

  // Capture an optional trailing unit ("|inch|in|mm|cm) to re-attach after conversion.
  const unitMatch = s.match(/\s*("|''|inch(?:es)?|in|mm|cm)\s*$/i);
  const unit = unitMatch ? unitMatch[0].trim() : '';
  const core = unit ? s.slice(0, s.length - unitMatch![0].length).trim() : s;

  let whole = 0, num = 0, den = 0;
  let m: RegExpMatchArray | null;
  if ((m = core.match(/^(\d+)\s*[-\s]\s*(\d+)\s*\/\s*(\d+)$/))) {
    // Mixed with an explicit separator: "1 1/2", "1-1/2".
    whole = +m[1]; num = +m[2]; den = +m[3];
  } else if ((m = core.match(/^(\d)(\d)\/(\d+)$/)) && +m[3] <= 8) {
    // Glued single-digit-whole shorthand: "11/2" → 1½, "31/4" → 3¼. Checked BEFORE the
    // simple-fraction branch (otherwise "11/2" parses as 11/2 = 5.5). Constrained to
    // denominators ≤ 8 (halves/quarters/eighths) so genuine sixteenths like "11/16"
    // fall through to the simple branch (0.6875) instead of being read as 1 1/16.
    whole = +m[1]; num = +m[2]; den = +m[3];
  } else if ((m = core.match(/^(\d+)\/(\d+)$/))) {
    // Simple fraction: "1/2", "3/4", "11/16".
    whole = 0; num = +m[1]; den = +m[2];
  } else {
    return input; // not a fraction (decimal, plain number, dimensioned pair, etc.)
  }
  if (!den) return input;

  const dec = whole + num / den;
  const decStr = Number.isInteger(dec) ? String(dec) : String(parseFloat(dec.toFixed(4)));
  return unit
    ? `${decStr}${unit === '"' || unit === "''" ? '"' : ' ' + unit}`
    : decStr;
}

// ── Compound / fraction dimension scanner ───────────────────────────────────
// Re-reads the RAW input and returns a normalized dimension ONLY when it confidently
// finds a unit- or fraction-bearing size — so it never steals a bare quantity ("2 bags").
// Handles compounds the base extractor misses: 3"x1½", 3"-1½", 3 × 1.5, plus 1½/2½/12mm.
const VULGAR_CHARS = '½¼¾⅓⅔⅛⅜⅝⅞';
const UNIT = `(?:"|''|”|mm|cm|inch|in\\b|ft\\b)`;
// One size token: whole/decimal, optional a/b or vulgar fraction, optional unit.
const SIZE = `\\d+(?:\\.\\d+)?(?:\\s*\\d+\\/\\d+)?\\s*[${VULGAR_CHARS}]?\\s*${UNIT}?`;
// A size that REQUIRES a trailing unit (used for reducer-dash disambiguation).
const SIZE_UNIT = `\\d+(?:\\.\\d+)?\\s*[${VULGAR_CHARS}]?\\s*${UNIT}`;

export function scanDimension(input: string): string | null {
  if (!input) return null;

  // 1) Cross compound (x or ×) — unambiguous reducer/cross spec.
  let m = input.match(new RegExp(`(${SIZE})\\s*[x×]\\s*(${SIZE})`, 'i'));
  if (m) {
    const a = normalizeFraction(m[1].trim()), b = normalizeFraction(m[2].trim());
    if (a && b) return `${a} × ${b}`;
  }
  // 2) Reducer dash (A-B) — ONLY when BOTH sides carry a unit, so "1-1/2" (a mixed
  //    number, no unit) is NOT split into 1 × 1/2.
  m = input.match(new RegExp(`(${SIZE_UNIT})\\s*-\\s*(${SIZE_UNIT})`, 'i'));
  if (m) {
    const a = normalizeFraction(m[1].trim()), b = normalizeFraction(m[2].trim());
    if (a && b) return `${a} × ${b}`;
  }
  // 3) Single size — override the base extractor ONLY if it carries a unit or a fraction
  //    (a bare number is ambiguous with quantity; leave those to the base extractor).
  m = input.match(new RegExp(SIZE, 'i'));
  if (m && new RegExp(`["”'']|[${VULGAR_CHARS}]|mm|cm|inch|in\\b|ft\\b|\\d\\/\\d`, 'i').test(m[0])) {
    const n = normalizeFraction(m[0].trim());
    if (n && /\d/.test(n)) return n;
  }
  return null;
}
