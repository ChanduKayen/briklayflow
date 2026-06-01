import { normalizeFraction } from './normalizeFraction';

export interface ExtractedAttributes {
  dimension: string | null;
  grade: string | null;
  variant: string | null;
  residual: string;           // input minus dimension and grade only — variant stays
  fullMinusDimension: string; // fallback if residual is too short
  // Bare trailing number with no unit suffix (e.g. "floor machine 9"). Used by
  // the conflict detector as a dimension-candidate when the user clearly meant
  // a size but didn't write the unit. NOT used by the tree walk.
  bare_number: string | null;
}

// Order matters: check 2D patterns before 1D so "300x300mm" isn't partially matched
const DIMENSION_PATTERNS: RegExp[] = [
  /(\d+(?:\.\d+)?)\s*x\s*\d+(?:\.\d+)?\s*(mm|cm|m|inch|")\b/i,
  /(\d+(?:\.\d+)?)\s*(mm|cm|m|inch|inches|"|''|ft|feet|gauge|ga|swg)\b/i,
  /(½|¾|⅜|¼|⅝|⅞)\s*(inch|"|'')?/i,
  /(\d+)\s*\/\s*(\d+)\s*(inch|"|'')/i,
];

// Last-resort dimension pattern: a bare number at the END of the string with no
// unit suffix. "floor machine 9" → "9". Captured separately into bare_number so
// the tree walk still requires a properly-typed dimension.
const BARE_NUMBER_PATTERN = /\b(\d+(?:\.\d+)?)\s*$/;

const GRADE_PATTERNS: RegExp[] = [
  /\b(Fe\s*\d{3}D?)\b/i,
  /\b(OPC\s*\d{2,3})\b/i,
  /\b(PPC)\b/i,
  /\b(M\s*\d{2,3})\b/i,
  /\b(IS\s*\d{3,5})\b/i,
  /\b(BWR|MR|BR|Commercial)\b/i,
  /\b(ISI|Non[\s-]?ISI)\b/i,
  /\b(\d{2,3})\s*(?:grade|grd)\b/i,
  /\b(CPVC|UPVC|PVC|PPR|GI|CI|SS|MS|HDPE|LDPE)\b/i,
];

// Detected but NOT stripped — variant is family identity (elbow ≠ tee ≠ coupling)
const VARIANT_PATTERNS: RegExp[] = [
  /\b(male|female|reducer|tee|elbow|coupling|union|socket|bend|cap|plug|nipple|bush|flange)\b/i,
  /\b(threaded|compression|solvent|push[\s-]?fit|flanged|grooved)\b/i,
  /\b(90°?|45°?|180°?)\b/,
  /\b(long|short|extended|close)\b/i,
];

// Common grades that LOOK like bare numbers ("43 grade cement", "53 grade cement").
// Promoted into the grade pattern path so they don't get mis-classified as bare_number.
const LIKELY_GRADE_NUMBERS = new Set(['43', '53']);

export function extractAttributesFromInput(input: string): ExtractedAttributes {
  let working = input;
  let dimension: string | null = null;
  let grade: string | null = null;
  let variant: string | null = null;
  let bare_number: string | null = null;

  // Strip dimension from residual
  for (const pattern of DIMENSION_PATTERNS) {
    const match = working.match(pattern);
    if (match) {
      dimension = match[0].trim();
      working = working.replace(match[0], ' ');
      break;
    }
  }

  // Strip grade from residual
  for (const pattern of GRADE_PATTERNS) {
    const match = working.match(pattern);
    if (match) {
      grade = match[1].trim();
      working = working.replace(match[0], ' ');
      break;
    }
  }

  // Detect variant but do NOT strip — it's part of family identity
  for (const pattern of VARIANT_PATTERNS) {
    const match = input.match(pattern);
    if (match) {
      variant = match[1].trim();
      break;
    }
  }

  // Bare-number fallback (Gap 1). Only run when no unit-suffixed dimension
  // matched. The number must be at the END of the input. We filter:
  //   - common grade numbers ("43", "53") — those mean OPC/PPC grade
  //   - small counts (≤3) — those are almost always quantities ("2 bags cement")
  // Anything above 3 (and not a grade) is treated as a likely size.
  if (!dimension) {
    const bareMatch = working.match(BARE_NUMBER_PATTERN);
    if (bareMatch) {
      const num    = bareMatch[1];
      const numVal = parseFloat(num);
      if (!LIKELY_GRADE_NUMBERS.has(num) && Number.isFinite(numVal) && numVal > 3) {
        bare_number = num;
        working = working.replace(bareMatch[0], ' ');
      }
    }
  }

  const residual = working.replace(/\s+/g, ' ').trim();

  const fullMinusDimension = dimension
    ? input.replace(dimension, '').replace(/\s+/g, ' ').trim()
    : input;

  // Normalize fractional inches to the catalog's decimal form ("11/2\"" → "1.5\"")
  // so a carried/extracted dimension can match the tree. Strip-side `dimension` above
  // kept the raw match (correct for stripping); only the returned value is normalized.
  return {
    dimension: dimension ? normalizeFraction(dimension) : null,
    grade, variant, residual, fullMinusDimension, bare_number,
  };
}
