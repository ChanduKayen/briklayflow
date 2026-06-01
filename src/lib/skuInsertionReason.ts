import type { ExtractedAttributes } from './skuAttributeExtractor';
import type { AliasFamilyMatch, FamilyMember } from './skuTreeResolver';
import { normalizeForConflictCheck } from './skuConflictDetector';

export interface InsertionReason {
  message:         string;
  novelAttributes: string[];
  existingValues:  Record<string, string[]>;
}

const PLACEHOLDERS: ReadonlySet<string> = new Set([
  'n/a', 'na', 'generic', 'standard', 'none', 'default', '-', '', 'null',
]);
const ATTRIBUTE_LABELS: Record<string, string> = {
  dimension: 'Size',
  variant:   'Type',
  grade:     'Grade',
};

function humanLabel(attr: string): string {
  return ATTRIBUTE_LABELS[attr] || attr;
}

function isPlaceholder(val: string | null | undefined): boolean {
  return !val || PLACEHOLDERS.has(String(val).toLowerCase().trim());
}

/**
 * Build a one-line explanation for why a *new* SKU is about to be created
 * instead of linking to an existing one. Returns null when no insertion is
 * happening (i.e., the user is linking to an existing entry).
 *
 * Three shapes:
 *   - "New item — nothing similar in your catalog yet"          (no family)
 *   - "9 inch is new — catalog has Floor Machine in 11 inch"    (novel attribute value)
 *   - "This specific combination is new to your TMT Bar catalog" (each value exists, combination doesn't)
 */
export function buildInsertionReason(
  family:     AliasFamilyMatch | null | undefined,
  resolution: { resolved?: Record<string, string>; hasNovelValue?: boolean } | null | undefined,
  _extracted: Partial<ExtractedAttributes>,
  members:    FamilyMember[],
): InsertionReason | null {
  if (!family) {
    return {
      message:         'New item — nothing similar in your catalog yet',
      novelAttributes: [],
      existingValues:  {},
    };
  }

  if (!resolution?.hasNovelValue) return null;

  const resolved = resolution.resolved || {};
  const novelAttrs:    string[]                = [];
  const existingVals:  Record<string, string[]> = {};

  for (const [attr, userVal] of Object.entries(resolved)) {
    if (!userVal) continue;
    const memberVals = Array.from(new Set(
      members
        .map(m => (m as any)[attr] as string | null)
        .filter((v): v is string => !isPlaceholder(v)),
    ));
    if (memberVals.length === 0) continue;
    const userNorm = normalizeForConflictCheck(String(userVal));
    const existsInFamily = memberVals.some(v => normalizeForConflictCheck(v) === userNorm);
    if (!existsInFamily) {
      novelAttrs.push(attr);
      existingVals[attr] = memberVals;
    }
  }

  if (novelAttrs.length === 0) {
    return {
      message:         `This specific combination is new to your ${family.sub_category} catalog`,
      novelAttributes: [],
      existingValues:  {},
    };
  }

  const parts = novelAttrs.map(attr => {
    const userVal  = resolved[attr];
    const existing = existingVals[attr];
    if (existing.length <= 4) {
      return `${userVal} is new — catalog has ${humanLabel(attr).toLowerCase()} ${existing.join(', ')}`;
    }
    return `${userVal} is new — catalog has ${existing.slice(0, 3).join(', ')} and ${existing.length - 3} more`;
  });

  return {
    message:         parts.join('. '),
    novelAttributes: novelAttrs,
    existingValues:  existingVals,
  };
}
