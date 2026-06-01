import type { ExtractedAttributes } from './skuAttributeExtractor';
import type {
  AliasFamilyMatch, FamilyMember, FamilyProfile, TreeResolution, WebVariantGroup,
} from './skuTreeResolver';
import type { TokenMatchOutput } from './skuTokenMatcher';
import type { AttributeConflict } from './skuConflictDetector';
import { stripBrandNames, isStopWord } from './brandFilter';

export type PillState = 'satisfied' | 'missing' | 'common' | 'suggested' | 'conflict';
export type PillSource = 'regex' | 'token_match' | 'user_selected' | 'ai' | 'web';

export interface PillData {
  attribute:     string;
  label:         string;
  value:         string | null;
  state:         PillState;
  options?:      string[];
  source?:       PillSource;
  // Conflict state: the SKU value that disagrees with the user's value.
  conflictWith?: string;
  // Editable: tappable to reopen options for re-selection. Defaults to true
  // for non-sub_category satisfied pills.
  editable?:     boolean;
}

export interface BuildPillsInput {
  familyMatch?:     AliasFamilyMatch;
  familyProfile?:   FamilyProfile;
  treeResolution?:  TreeResolution;
  tokenMatches?:    TokenMatchOutput;
  regexExtracted?:  Partial<ExtractedAttributes>;
  webVariants?:     WebVariantGroup[];
  aiExtracted?: {
    ai_suggested_name?: string;
    sub_category?:      string;
    dimension?:         string | null;
    variant?:           string | null;
    grade?:             string | null;
  };
  isOrphan?:        boolean;
}

const ATTRIBUTE_LABELS: Record<string, string> = {
  dimension:    'Size',
  variant:      'Type',
  grade:        'Grade',
  sub_category: 'Item',
  material:     'Material',
  angle:        'Angle',
  thread:       'Thread',
  finish:       'Finish',
  thickness:    'Thickness',
  weight:       'Weight',
};

export function humanLabel(attribute: string): string {
  if (attribute.startsWith('info_')) return attribute.slice(5);
  return ATTRIBUTE_LABELS[attribute] ||
    attribute.charAt(0).toUpperCase() + attribute.slice(1).replace(/_/g, ' ');
}

/**
 * Conflict pills — built when an auto-link target's catalog attributes
 * contradict what the user typed. The matched sub_category stays satisfied
 * (the product type is right), but each conflicting attribute becomes a
 * `'conflict'` pill carrying both values for the user to disambiguate.
 */
export function buildConflictPills(
  family:     AliasFamilyMatch | null,
  matchedSku: { sub_category?: string | null; item_name?: string; dimension?: string | null; variant?: string | null; grade?: string | null },
  extracted:  Partial<ExtractedAttributes>,
  conflicts:  AttributeConflict[],
): PillData[] {
  const pills: PillData[] = [];
  const conflictAttrs = new Set(conflicts.map(c => c.attribute));

  // Sub-category pill — product type matched, just spec disagrees.
  const subCat = family?.sub_category
    || matchedSku.sub_category
    || (matchedSku.item_name ? matchedSku.item_name.split(/\s+\d/)[0].trim() : null);
  if (subCat) {
    pills.push({
      attribute: 'sub_category',
      label:     humanLabel('sub_category'),
      value:     subCat,
      state:     'satisfied',
    });
  }

  for (const conflict of conflicts) {
    pills.push({
      attribute:    conflict.attribute,
      label:        conflict.humanLabel,
      value:        conflict.userValue,
      state:        'conflict',
      conflictWith: conflict.skuValue,
      // options[0] = catalog (existing), options[1] = user's value (add as new).
      options:      [conflict.skuValue, conflict.userValue],
    });
  }

  // Non-conflicting attributes that we know about (user or catalog).
  for (const attr of ['dimension', 'variant', 'grade'] as const) {
    if (conflictAttrs.has(attr)) continue;
    const userVal = (extracted as any)[attr] as string | null | undefined;
    const skuVal  = (matchedSku as any)[attr] as string | null | undefined;
    const value   = userVal || skuVal;
    if (!value) continue;
    pills.push({
      attribute: attr,
      label:     humanLabel(attr),
      value:     String(value),
      state:     'satisfied',
      editable:  true,
    });
  }

  return pills;
}

/**
 * Novel-variant pills — used when the tree walk fully resolved but the
 * combination doesn't match any existing member (hasNovelValue). All
 * tree-depth attributes render as satisfied; the checkmark becomes
 * available so the user can commit the new variant.
 */
export function buildNovelVariantPills(
  family:    AliasFamilyMatch,
  resolved:  Record<string, string>,
  members:   FamilyMember[],
  treeDepth: { attribute: string; values: string[] }[],
): PillData[] {
  const pills: PillData[] = [{
    attribute: 'sub_category',
    label:     humanLabel('sub_category'),
    value:     family.sub_category,
    state:     'satisfied',
  }];

  for (const level of treeDepth) {
    const val = resolved[level.attribute];
    if (!val) continue;
    // Pull options from existing family members so the user can re-pick.
    const memberVals = Array.from(new Set(
      members.map(m => (m as any)[level.attribute] as string | null).filter((v): v is string => !!v),
    ));
    pills.push({
      attribute: level.attribute,
      label:     humanLabel(level.attribute),
      value:     val,
      state:     'satisfied',
      editable:  true,
      options:   memberVals.length > 0 ? memberVals : level.values,
    });
  }

  return pills;
}

/**
 * Family-selection pill — used when multiple candidate families match the
 * input with similar confidence and the user must pick one. The single
 * "missing" pill carries one option per candidate family.
 */
export function buildFamilySelectionPills(families: AliasFamilyMatch[]): PillData[] {
  return [{
    attribute: 'family',
    label:     'Which type',
    value:     null,
    state:     'missing',
    options:   families.map(f => f.sub_category),
  }];
}

/**
 * Build the attribute-pill array for a line item based on its current
 * resolution state. The pills are the single representation of "what
 * we know about this item and what's still missing" — they replace the
 * family resolution panel, the orphan web panel, and the parametric
 * review panel.
 */
export function buildPills(input: BuildPillsInput): PillData[] {
  const pills: PillData[] = [];

  // Sub-category pill — anchors the row when a family is known
  if (input.familyMatch) {
    pills.push({
      attribute: 'sub_category',
      label:     humanLabel('sub_category'),
      value:     input.familyMatch.sub_category,
      state:     'satisfied',
      source:    'token_match',
    });
  } else if (input.aiExtracted?.ai_suggested_name) {
    pills.push({
      attribute: 'sub_category',
      label:     humanLabel('sub_category'),
      value:     input.aiExtracted.ai_suggested_name,
      state:     'satisfied',
      source:    'ai',
    });
  } else if (input.aiExtracted?.sub_category) {
    pills.push({
      attribute: 'sub_category',
      label:     humanLabel('sub_category'),
      value:     input.aiExtracted.sub_category,
      state:     'satisfied',
      source:    'ai',
    });
  }

  const treeAttrs = new Set<string>();

  // Tree-depth pills — one per level the family's profile lists. Each is
  // either satisfied (resolved by regex/token-match) or missing.
  if (input.familyProfile?.tree_depth && input.treeResolution) {
    const resolution    = input.treeResolution;
    const tokenMatches  = input.tokenMatches?.matches ?? [];

    for (const level of input.familyProfile.tree_depth) {
      treeAttrs.add(level.attribute);
      const resolvedValue = resolution.resolved[level.attribute];

      if (resolvedValue) {
        const matchedByToken = tokenMatches.some(m => m.attribute === level.attribute);
        pills.push({
          attribute: level.attribute,
          label:     humanLabel(level.attribute),
          value:     resolvedValue,
          state:     'satisfied',
          source:    matchedByToken ? 'token_match' : 'regex',
          editable:  true,
          options:   level.values || [],
        });
      } else {
        const missingLevel = resolution.missing.find(m => m.attribute === level.attribute);
        // The tree couldn't resolve this level — but the user may have TYPED a value for
        // it that simply isn't a standard catalog value for this family (a novel size /
        // variant). Show that typed value instead of a blank "missing" pill, so typed
        // attributes are never visually cleared. It's editable, with the standard options
        // still offered for re-pick; commit handles it as a novel variant.
        const typedRaw = (input.tokenMatches?.resolvedAttributes as any)?.[level.attribute]
          ?? (input.regexExtracted as any)?.[level.attribute];
        const typed = typedRaw != null && String(typedRaw).trim() ? String(typedRaw).trim() : null;
        if (typed) {
          pills.push({
            attribute: level.attribute,
            label:     humanLabel(level.attribute),
            value:     typed,
            state:     'satisfied',
            source:    'regex',
            editable:  true,
            options:   missingLevel?.values || level.values || [],
          });
        } else {
          pills.push({
            attribute: level.attribute,
            label:     humanLabel(level.attribute),
            value:     null,
            state:     'missing',
            options:   missingLevel?.values || level.values,
          });
        }
      }
    }

    // Common attributes — recognised by regex/token-match but not
    // differentiating within this family. Rendered faded, no action.
    // Filter through brand-strip + stop-word + family-name overlap so
    // "Ashirvad" doesn't appear as a pill and "pipe" inside "CPVC Pipe"
    // doesn't either.
    const subCatLower = (input.familyMatch?.sub_category || '').toLowerCase();
    const allExtracted: Record<string, string | null | undefined> = {
      ...(input.regexExtracted as any || {}),
      ...(input.tokenMatches?.resolvedAttributes || {}),
    };
    for (const [attr, val] of Object.entries(allExtracted)) {
      if (!val) continue;
      if (treeAttrs.has(attr)) continue;
      if (attr === 'residual' || attr === 'fullMinusDimension') continue;
      const cleaned = stripBrandNames(String(val)).trim();
      if (!cleaned || cleaned.length < 2) continue;
      if (isStopWord(cleaned)) continue;
      if (subCatLower && subCatLower.includes(cleaned.toLowerCase())) continue;
      pills.push({
        attribute: attr,
        label:     humanLabel(attr),
        value:     cleaned,
        state:     'common',
      });
    }

    // Unmatched tokens — surviving brand/stop-word/family-name filter.
    // Useful for surfacing real attributes the family doesn't list yet.
    const seenCommon = new Set(pills.filter(p => p.state === 'common').map(p => p.value!.toLowerCase()));
    for (const raw of (input.tokenMatches?.unmatchedTokens || [])) {
      const cleaned = stripBrandNames(raw).trim();
      if (!cleaned || cleaned.length < 2) continue;
      if (isStopWord(cleaned)) continue;
      if (/^\d+(?:\.\d+)?$/.test(cleaned)) continue;
      if (subCatLower && subCatLower.includes(cleaned.toLowerCase())) continue;
      const key = cleaned.toLowerCase();
      if (seenCommon.has(key)) continue;
      seenCommon.add(key);
      pills.push({
        attribute: `info_${key}`,
        label:     cleaned,
        value:     cleaned,
        state:     'common',
      });
    }
  }

  // Orphan path — no family found, but web search returned variant axes.
  if (input.isOrphan && input.webVariants && input.webVariants.length > 0) {
    for (const group of input.webVariants) {
      pills.push({
        attribute: group.attribute.toLowerCase(),
        label:     humanLabel(group.attribute.toLowerCase()),
        value:     null,
        state:     'missing',
        options:   group.options.map(o => o.value),
        source:    'web',
      });
    }
  }

  // Pure AI path — no family, no web variants. Render whatever the AI
  // extracted as satisfied pills so the user can see/edit.
  if (!input.familyProfile && !input.isOrphan && input.aiExtracted) {
    for (const attr of ['dimension', 'variant', 'grade'] as const) {
      const val = input.aiExtracted[attr];
      if (val) {
        pills.push({
          attribute: attr,
          label:     humanLabel(attr),
          value:     String(val),
          state:     'satisfied',
          source:    'ai',
        });
      }
    }
  }

  return pills;
}
