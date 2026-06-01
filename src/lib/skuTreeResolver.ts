import type { ExtractedAttributes } from './skuAttributeExtractor';
import { normalizeFraction } from './normalizeFraction';

// ── Shared types (exported for use in components + NewPurchaseOrder) ─────────

export interface AliasFamilyMatch {
  matched_term: string;
  category:     string;
  sub_category: string;
  source:       string;
  family_size:  number;
  similarity:   number;
}

export interface TreeLevel {
  attribute:      string;
  coverage:       number;
  distinct_count: number;
  values:         string[];
}

export interface FamilyProfile {
  family_exists: boolean;
  family_size:   number;
  category:      string;
  sub_category:  string;
  unit?:         string;
  siblings?:     string[];
  tree_depth:    TreeLevel[];
  fields?: {
    dimension: { expected: boolean; coverage: number; common_values: string[] };
    variant:   { expected: boolean; coverage: number; common_values: string[] };
    grade:     { expected: boolean; coverage: number; common_values: string[] };
  };
}

export interface FamilyMember {
  sku_id:    string;
  item_name: string;
  dimension: string | null;
  variant:   string | null;
  grade:     string | null;
  unit:      string;
  aliases:   string | null;
}

export interface TreeResolution {
  status:           'fully_resolved' | 'partially_resolved' | 'unresolved' | 'no_tree';
  resolved:         Record<string, string>;
  missing:          TreeLevel[];
  matchedMember:    FamilyMember | null;
  candidateMembers: FamilyMember[];
  hasNovelValue:    boolean;
}

export interface WebVariantGroup {
  attribute:    string;
  description?: string;
  options:      { value: string; hint?: string }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLACEHOLDER_SET = new Set(['n/a', 'generic', 'standard', 'none', 'default', '-', '']);

export function isPlaceholder(val: string): boolean {
  return PLACEHOLDER_SET.has(val.toLowerCase().trim());
}

export function normalizeAttrValue(val: string): string {
  if (!val) return val;
  // Normalize fractional inches FIRST so both the user's "11/2\"" and the catalog's
  // "1.5\"" land on the same decimal before the rest of the canonicalization runs.
  return normalizeFraction(String(val)).toLowerCase().trim()
    .replace(/\s+/g, '')
    .replace(/"/g,    'inch')
    .replace(/''/g,   'inch')
    .replace(/½/g,   '0.5')
    .replace(/¾/g,   '0.75')
    .replace(/¼/g,   '0.25');
}

// ── Tree resolution ───────────────────────────────────────────────────────────

export function resolveAgainstTree(
  extracted:     ExtractedAttributes,
  familyProfile: FamilyProfile,
  familyMembers: FamilyMember[]
): TreeResolution {
  const treeDepth = familyProfile.tree_depth;

  if (!treeDepth || treeDepth.length === 0) {
    return {
      status:           'no_tree',
      resolved:         {},
      missing:          [],
      matchedMember:    familyMembers.length === 1 ? familyMembers[0] : null,
      candidateMembers: familyMembers,
      hasNovelValue:    false,
    };
  }

  const resolved: Record<string, string> = {};
  const missing:  TreeLevel[]            = [];
  let candidates               = [...familyMembers];
  let hasNovelValue            = false;
  let candidatePoolExhausted   = false;

  for (const level of treeDepth) {
    const attrName  = level.attribute as keyof ExtractedAttributes;
    const userValue = extracted[attrName] as string | null | undefined;

    if (userValue) {
      const matching = candidates.filter(m => {
        const mv = m[attrName as keyof FamilyMember] as string | null;
        return mv ? normalizeAttrValue(mv) === normalizeAttrValue(userValue) : false;
      });

      if (matching.length > 0) {
        resolved[level.attribute] = userValue;
        candidates = matching;
      } else {
        // Novel value — no existing member has this; don't kill subsequent picker options
        resolved[level.attribute] = userValue;
        hasNovelValue            = true;
        candidatePoolExhausted   = true;
      }
    } else {
      let availableValues: string[];

      if (candidatePoolExhausted) {
        // Fall back to full profile values so pickers aren't empty
        availableValues = level.values;
      } else {
        availableValues = [...new Set(
          candidates
            .map(m => m[attrName as keyof FamilyMember] as string | null)
            .filter((v): v is string => !!v && !isPlaceholder(v))
        )];
        if (availableValues.length === 0) availableValues = level.values;
      }

      missing.push({ ...level, values: availableValues });
    }
  }

  let status: TreeResolution['status'];
  if      (missing.length === 0)                status = 'fully_resolved';
  else if (Object.keys(resolved).length > 0)    status = 'partially_resolved';
  else                                           status = 'unresolved';

  const matchedMember =
    status === 'fully_resolved' && !hasNovelValue && candidates.length === 1
      ? candidates[0]
      : null;

  return { status, resolved, missing, matchedMember, candidateMembers: candidates, hasNovelValue };
}
