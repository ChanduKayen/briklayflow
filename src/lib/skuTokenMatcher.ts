import type { ExtractedAttributes } from './skuAttributeExtractor';
import type { TreeLevel } from './skuTreeResolver';

export interface TokenMatchResult {
  attribute:     string;
  matchedValue:  string;
  inputFragment: string;
  confidence:    number;
}

export interface TokenMatchOutput {
  matches:             TokenMatchResult[];
  resolvedAttributes:  Record<string, string>;
  unmatchedTokens:     string[];
}

// Strict normalization: lowercase, collapse whitespace, normalize the symbols
// that show up in dimension/grade text (°, ", fractions, mm).
function normalizeForComparison(str: string): string {
  return String(str ?? '')
    .toLowerCase()
    .trim()
    .replace(/°/g, ' degree')
    .replace(/''/g, ' inch')
    .replace(/"/g, ' inch')
    .replace(/½/g, '0.5')
    .replace(/¾/g, '0.75')
    .replace(/¼/g, '0.25')
    .replace(/⅜/g, '0.375')
    .replace(/⅝/g, '0.625')
    .replace(/⅞/g, '0.875')
    .replace(/\bmm\b/g, ' mm')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Match user input tokens against a family's known attribute values.
 *
 * Uses the family's OWN vocabulary, not a regex pattern. Longest values are
 * tried first so "45 Degree Bend" wins over "45 Degree" or "Bend". Regex-
 * extracted attributes are seeded into the output and are not re-matched.
 */
export function matchTokensAgainstFamily(
  input:           string,
  treeDepth:       TreeLevel[],
  regexExtracted:  Partial<ExtractedAttributes>,
): TokenMatchOutput {
  const matches:             TokenMatchResult[]            = [];
  const resolvedAttributes:  Record<string, string>        = {};

  // Seed from regex — these are already resolved, don't re-match.
  if (regexExtracted.dimension) resolvedAttributes.dimension = regexExtracted.dimension;
  if (regexExtracted.grade)     resolvedAttributes.grade     = regexExtracted.grade;
  if (regexExtracted.variant)   resolvedAttributes.variant   = regexExtracted.variant;

  let remaining = normalizeForComparison(input);

  for (const level of treeDepth) {
    if (resolvedAttributes[level.attribute]) continue;
    if (!Array.isArray(level.values) || level.values.length === 0) continue;

    // Longest first — "45 Degree Bend" must beat "45 Degree" and "Bend".
    const sortedValues = [...level.values].sort((a, b) => b.length - a.length);

    for (const familyValue of sortedValues) {
      const normalizedValue = normalizeForComparison(familyValue);
      if (!normalizedValue) continue;

      if (remaining.includes(normalizedValue)) {
        matches.push({
          attribute:     level.attribute,
          matchedValue:  familyValue,
          inputFragment: familyValue,
          confidence:    1.0,
        });
        resolvedAttributes[level.attribute] = familyValue;
        remaining = remaining.replace(normalizedValue, ' ').replace(/\s+/g, ' ').trim();
        break;
      }

      // Compact fuzzy: "45degree" → "45 degree". Only useful for values >= 3 chars.
      const compactValue = normalizedValue.replace(/\s+/g, '');
      const compactRemaining = remaining.replace(/\s+/g, '');
      if (compactValue.length >= 3 && compactRemaining.includes(compactValue)) {
        matches.push({
          attribute:     level.attribute,
          matchedValue:  familyValue,
          inputFragment: familyValue,
          confidence:    0.9,
        });
        resolvedAttributes[level.attribute] = familyValue;
        remaining = compactRemaining.replace(compactValue, ' ').replace(/\s+/g, ' ').trim();
        break;
      }
    }
  }

  const unmatchedTokens = remaining
    .split(' ')
    .map(t => t.trim())
    .filter(t => t.length >= 2);

  return { matches, resolvedAttributes, unmatchedTokens };
}
