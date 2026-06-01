import type { ExtractedAttributes } from './skuAttributeExtractor';

export interface AttributeConflict {
  attribute:   'dimension' | 'variant' | 'grade';
  userValue:   string;
  skuValue:    string;
  humanLabel:  string;
}

// Tight normalization for grade / variant conflicts — must NOT collapse
// meaningfully different values. Dimension uses dimensionsConflict instead
// so we can do cross-unit comparison.
export function normalizeForConflictCheck(val: string): string {
  return String(val ?? '')
    .toLowerCase()
    .trim()
    .replace(/°/g, 'degree')
    .replace(/''/g, 'inch')
    .replace(/"/g, 'inch')
    .replace(/½/g, '0.5')
    .replace(/¾/g, '0.75')
    .replace(/¼/g, '0.25')
    .replace(/⅜/g, '0.375')
    .replace(/⅝/g, '0.625')
    .replace(/⅞/g, '0.875')
    .replace(/\binches\b/g, 'inch')
    .replace(/\s+/g, '');
}

const PLACEHOLDERS: ReadonlySet<string> = new Set([
  'n/a', 'na', 'generic', 'standard', 'none', 'default', '-', '', 'null',
  'normal', 'regular', 'common', 'basic', 'ordinary',
]);

function isPlaceholder(val: string): boolean {
  return PLACEHOLDERS.has(String(val ?? '').toLowerCase().trim());
}

// Extract the numeric portion from a dimension string.
//   "11 INCH" → 11, "12mm" → 12, "9" → 9, "½ inch" → 0.5, "1/2 inch" → 0.5
function extractNumber(dim: string): number | null {
  const s = String(dim ?? '');
  const fractionMap: Record<string, number> = {
    '½': 0.5, '¾': 0.75, '¼': 0.25, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
  };
  for (const [frac, val] of Object.entries(fractionMap)) {
    if (s.includes(frac)) return val;
  }
  const fracMatch = s.match(/(\d+)\s*\/\s*(\d+)/);
  if (fracMatch) {
    const n = parseFloat(fracMatch[1]);
    const d = parseFloat(fracMatch[2]);
    if (d !== 0) return n / d;
  }
  const numMatch = s.match(/(\d+(?:\.\d+)?)/);
  return numMatch ? parseFloat(numMatch[1]) : null;
}

function detectUnit(dim: string): 'mm' | 'inch' | 'unknown' {
  const s = String(dim ?? '');
  if (/\bmm\b/i.test(s)) return 'mm';
  if (/\binch|"|''|inches|[½¾⅜¼⅝⅞]/i.test(s)) return 'inch';
  return 'unknown';
}

// True when two dimension strings represent meaningfully different sizes.
// Handles cross-unit equivalence (1 inch ≈ 25.4 mm) within a 1 mm tolerance.
export function dimensionsConflict(userDim: string, skuDim: string): boolean {
  const userNum = extractNumber(userDim);
  const skuNum  = extractNumber(skuDim);
  if (userNum === null || skuNum === null) {
    // Couldn't pull numbers — fall back to string compare.
    return normalizeForConflictCheck(userDim) !== normalizeForConflictCheck(skuDim);
  }
  if (userNum === skuNum) return false;
  const userUnit = detectUnit(userDim);
  const skuUnit  = detectUnit(skuDim);
  const TOL_MM   = 1;
  if (userUnit === 'inch' && skuUnit === 'mm') {
    return Math.abs(userNum * 25.4 - skuNum) > TOL_MM;
  }
  if (userUnit === 'mm' && skuUnit === 'inch') {
    return Math.abs(userNum - skuNum * 25.4) > TOL_MM;
  }
  return userNum !== skuNum;
}

/**
 * Compare the user's regex-extracted attributes against a matched SKU.
 * Returns a conflict only when BOTH sides have a real, non-placeholder
 * value and the two values disagree.
 *
 *   "9 inch"  vs  "11 inch"  → CONFLICT
 *   "9"  vs  "11 inch"       → CONFLICT (uses bare_number fallback)
 *   "1 inch"  vs  "25mm"     → no conflict (cross-unit equivalent)
 *   "9 inch"  vs  null       → no conflict (catalog unconstrained)
 *   null      vs  "11 inch"  → no conflict (user unconstrained)
 *   "Generic" vs  "11 inch"  → no conflict (catalog placeholder)
 *
 * This runs immediately before every auto-link to prevent silent
 * procurement errors — "floor machine 9 inch" must never silently link
 * to "Floor Machine 11 inch."
 */
export function detectAttributeConflicts(
  extracted:  Partial<ExtractedAttributes>,
  matchedSku: { dimension?: string | null; variant?: string | null; grade?: string | null },
): AttributeConflict[] {
  const conflicts: AttributeConflict[] = [];

  // Dimension — fall back to bare_number so "floor machine 9" still triggers
  // when the catalog has "11 INCH".
  const userDim = extracted.dimension || extracted.bare_number || null;
  const skuDim  = matchedSku.dimension;
  if (userDim && skuDim && !isPlaceholder(String(skuDim)) && !isPlaceholder(String(userDim))) {
    if (dimensionsConflict(String(userDim), String(skuDim))) {
      conflicts.push({
        attribute:  'dimension',
        userValue:  String(userDim),
        skuValue:   String(skuDim),
        humanLabel: 'Size',
      });
    }
  }

  const userGrade = extracted.grade;
  const skuGrade  = matchedSku.grade;
  if (userGrade && skuGrade && !isPlaceholder(String(userGrade)) && !isPlaceholder(String(skuGrade))) {
    if (normalizeForConflictCheck(String(userGrade)) !== normalizeForConflictCheck(String(skuGrade))) {
      conflicts.push({
        attribute:  'grade',
        userValue:  String(userGrade),
        skuValue:   String(skuGrade),
        humanLabel: 'Grade',
      });
    }
  }

  const userVar = extracted.variant;
  const skuVar  = matchedSku.variant;
  if (userVar && skuVar && !isPlaceholder(String(userVar)) && !isPlaceholder(String(skuVar))) {
    if (normalizeForConflictCheck(String(userVar)) !== normalizeForConflictCheck(String(skuVar))) {
      conflicts.push({
        attribute:  'variant',
        userValue:  String(userVar),
        skuValue:   String(skuVar),
        humanLabel: 'Type',
      });
    }
  }

  return conflicts;
}
