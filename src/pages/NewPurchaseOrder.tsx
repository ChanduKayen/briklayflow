// @ts-nocheck
import React, { useState, useRef, useMemo, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '../lib/supabase';
import { useSnackbar } from '../components/Snackbar';
import type { Session } from '@supabase/supabase-js';
import { useUserProfile } from '../App';
import { useOrgId } from '../lib/auth/AuthProvider';
import { VENDOR_TRADE_GROUPS, OTHER_TRADE } from '../lib/trades';
import { brandsFor, addCustomBrand, BRANDS_BY_CATEGORY } from '../lib/brandsByCategory';
import { multiply, subtract, applyPercent, sum } from '../lib/money';
import { matchSKUsFromFile, matchSKUsFromText } from '../lib/skuMatcher';
import { SKU_AUTO_COMMIT, SKU_CLEAN_MATCH, SKU_CHIP_DISPLAY, SKU_LOW_DISPLAY, SKU_QUERY_THRESHOLD, DYM_CONFIDENCE_FLOOR } from '../lib/skuThresholds';
import { extractAttributesFromInput } from '../lib/skuAttributeExtractor';
import type { ExtractedAttributes } from '../lib/skuAttributeExtractor';
import { scanDimension } from '../lib/normalizeFraction';
import { resolveAgainstTree, normalizeAttrValue, isPlaceholder } from '../lib/skuTreeResolver';
import { matchTokensAgainstFamily } from '../lib/skuTokenMatcher';
import { createTrace, addStep, setStatus, logTrace } from '../lib/skuResolutionTrace';
import type { ResolutionTrace } from '../lib/skuResolutionTrace';
import { buildPills, buildFamilySelectionPills, buildConflictPills, buildNovelVariantPills, humanLabel } from '../lib/buildPillsFromResolution';
import type { PillData } from '../lib/buildPillsFromResolution';
import { ItemAttributeFields } from '../components/ItemAttributeFields';
import { isStopWord, SERVICE_TERMS_REGEX, GENERIC_STEMS } from '../lib/brandFilter';
import { detectAttributeConflicts } from '../lib/skuConflictDetector';
import type { AttributeConflict } from '../lib/skuConflictDetector';
import { buildInsertionReason } from '../lib/skuInsertionReason';
import type { InsertionReason } from '../lib/skuInsertionReason';
// ui/new-po-redesign — presentation-only sibling components (brief §0.2 / amendment A).
// Aliased with a ui-prefix where needed to avoid shadowing any existing identifier (§2).
import UiSaveCeremony from '../components/po-new-ui/UiSaveCeremony';
import RequestQuotesModal from '../components/po-new-ui/RequestQuotesModal';
import { V as uiV, nums as uiNums } from '../components/po-new-ui/voiceTokens';
import UiContextRecap from '../components/po-new-ui/UiContextRecap';
import UiProjectChips from '../components/po-new-ui/UiProjectChips';
import UiLinkedBadge from '../components/po-new-ui/UiLinkedBadge';
import { UiResolutionStrip, UiStripEscapes, UiDemotedSuggestion } from '../components/po-new-ui/UiResolutionStrip';
import UiAttributeFieldsHost from '../components/po-new-ui/UiAttributeFieldsHost';
import { UiMoney, UiTotalExclGst } from '../components/po-new-ui/UiMoney';
import UiSaveHint from '../components/po-new-ui/UiSaveHint';

// ── Helpers ───────────────────────────────────────────────────────────────────


function SectionLabel({ n, title }: { n: string; title: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-4">
      <span className="text-[10px] font-bold text-on-surface-variant/40">{n}</span>
      <span className="h-px flex-1 bg-outline-variant/20" />
      <span className="text-[10px] font-semibold text-on-surface-variant/50 uppercase tracking-[0.1em]">{title}</span>
    </div>
  );
}

// Sheet-redesign (ui/new-po-sheet). Section header = a small terra bar + uppercase label.
function SheetSectionLabel({ title, right }: { title: string; right?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-2.5">
      <div className="flex items-center gap-2">
        <span className="h-3.5 w-[3px] rounded-full" style={{ background: uiV.accent }} />
        <span className="text-[11px] font-bold uppercase tracking-[0.1em]" style={{ color: uiV.systemFaint }}>{title}</span>
      </div>
      {right}
    </div>
  );
}

// A keyboard-key chip used in the sheet's help line ("Move with [Tab] / [Enter]…").
function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center px-1.5 py-[1px] rounded-[5px] text-[10.5px] font-medium align-middle"
      style={{ background: uiV.surface, border: `1px solid ${uiV.line}`, color: uiV.system, ...uiNums }}
    >
      {children}
    </span>
  );
}


const UNITS = ['Nos', 'Bags', 'MT', 'm³', 'm²', 'RFT', 'Ltr', 'kg', 'Set', 'LS', 'Pair', 'Rmt', 'Sqft'];
const GST_RATES = [0, 5, 12, 18, 28];
const PAYMENT_TERMS = [15, 30, 45, 60];

const VENDOR_TO_SKU_CATEGORIES: Record<string, string[]> = {
  'Cement Supplier':                    ['Cement'],
  'Sand & Aggregate Supplier':          ['Sand', 'Aggregate'],
  'Bricks / Blocks Supplier':           ['Brick', 'Block'],
  'Steel / TMT Bar Supplier':           ['Steel'],
  'Waterproofing Materials Supplier':   ['Waterproofing'],
  'Admixture Supplier':                 ['Admixture', 'Chemical'],
  'Tiles Supplier':                     ['Tile'],
  'Marble / Granite Supplier':          ['Tile'],
  'Paint Supplier':                     ['Paint'],
  'Hardware & Fittings Supplier':       ['Hardware'],
  'Glass & Aluminium Supplier':         ['Glass', 'Windows', 'Doors'],
  'False Ceiling Materials Supplier':   ['Hardware', 'Plywood'],
  'Flooring Materials Supplier':        ['Tile'],
  'Electrical Materials Supplier':      ['Electrical'],
  'Plumbing Materials Supplier':        ['Plumbing'],
  'HVAC Materials Supplier':            ['Electrical', 'Plumbing'],
  'Sanitary Ware Supplier':             ['Plumbing'],
  'Lighting Supplier':                  ['Electrical'],
  'Cables & Conduits Supplier':         ['Electrical'],
  'Scaffolding Supplier':               ['Hardware'],
  'Tools & Machinery Vendor':           ['Hardware'],
  'Ready Mix Concrete (RMC) Plant':     ['Cement', 'Aggregate', 'Sand'],
};

// Maps a vendor trade category (e.g. "Plumbing Materials Supplier") to the first material
// category stored in sku_directory (e.g. "Plumbing"). Falls back to stripping common
// vendor-label suffixes so "Foo Supplier" → "Foo" rather than polluting the catalog.
function vendorCategoryToMaterialCategory(vendorCategory: string): string {
  const mapped = VENDOR_TO_SKU_CATEGORIES[vendorCategory];
  if (mapped && mapped.length > 0) return mapped[0];
  return vendorCategory
    .replace(/\s+(Materials?\s*)?Supplier$/i, '')
    .replace(/\s+Store$/i, '')
    .replace(/\s+Dealer$/i, '')
    .replace(/\s+Contractor$/i, '')
    .replace(/\s+Vendor$/i, '')
    .trim() || vendorCategory;
}

type SKUResult = {
  sku_id:       string
  item_name:    string
  category?:    string
  sub_category?: string
  dimension?:   string | null
  variant?:     string | null
  grade?:       string | null
  unit:         string
  aliases?:     string
  similarity:   number
}

// ── Auto-alias learning loop ──────────────────────────────────────────
// Every time a user input resolves to a SKU (via AI translation, DB re-search,
// manual chip click, family picker, redbox approve), the raw input is written
// back as an alias on that SKU. The next user who types the same vernacular
// hits the alias index instantly with zero AI cost.
//
// Guards: skip generic single words, numeric-only tokens, very short strings.
// The RPC is case-insensitive idempotent — duplicates are no-ops.
const ALIAS_LEARN_BLOCKLIST = new Set([
  'pipe', 'wire', 'rod', 'bar', 'valve', 'paint', 'cement', 'sand', 'water',
  'brick', 'tile', 'cable', 'block', 'glass', 'door', 'window', 'steel',
  'aggregate', 'gravel', 'putty', 'tape', 'sheet',
]);

function learnAlias(skuId: string | null | undefined, rawInput: string | null | undefined): void {
  if (!skuId || !rawInput) return;
  const cleaned = String(rawInput).trim();
  if (cleaned.length < 3) return;
  if (/^\d+(?:\.\d+)?$/.test(cleaned)) return;
  if (ALIAS_LEARN_BLOCKLIST.has(cleaned.toLowerCase())) return;
  // Fire-and-forget — errors are logged but never block the user flow.
  supabase.rpc('append_sku_alias', { p_sku_id: skuId, p_alias: cleaned })
    .then(({ error }) => { if (error) console.warn('learnAlias failed:', error.message); })
    .catch((e: unknown) => console.warn('learnAlias error:', e));
}

// Product decision: NEVER auto-select a catalog match. A confident match is offered in the
// dropdown (highlighted top suggestion) and the user picks it — nothing links on its own.
// Flip to true to restore the old auto-link behaviour.
const AUTO_LINK_MATCHES = false;

// Always capitalise the first letter of a typed item name (e.g. "wall putty" → "Wall putty").
const capFirst = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

// A soft, dark rounded hover tooltip (matches the platform's tooltip styling) — replaces the raw
// native `title=`. Anchored below and right-aligned so it never runs off the header edge.
function Tip({ text, children, width = 240 }: { text: string; children: React.ReactNode; width?: number }) {
  return (
    <span className="relative inline-flex group">
      {children}
      <span role="tooltip" className="pointer-events-none absolute top-full right-0 mt-2 z-[70] opacity-0 translate-y-0.5 group-hover:opacity-100 group-hover:translate-y-0 transition-all duration-150">
        <span className="block rounded-xl px-3 py-2 text-[11.5px] leading-snug font-medium" style={{ background: '#2A231E', color: '#F6EFE6', width, boxShadow: '0 14px 34px -12px rgba(30,22,16,.55)', border: '1px solid rgba(255,255,255,.07)' }}>
          {text}
        </span>
      </span>
    </span>
  );
}

// Returns a · -joined spec string from matched SKU fields, filtering placeholder values.
// ── Strict auto-link gate (Resolution Rethink) ────────────────────────
// The ONLY conditions under which a sku_id is set without user confirmation.
// Every other pathway must surface a suggestion / pills / card_message and
// require an explicit user action. Keep this predicate the single source of
// truth — do not inline these checks elsewhere.
function canAutoLink(
  resolution: { status: string; matchedMember: { sku_id: string } | null; hasNovelValue: boolean },
  conflicts: { attribute: string }[],
): boolean {
  return (
    resolution.status === 'fully_resolved'
    && resolution.matchedMember !== null
    && !resolution.hasNovelValue
    && conflicts.length === 0
  );
}

// ── Message builders for card_message ─────────────────────────────────
function _humanAttrLabel(attr: string): string {
  const MAP: Record<string, string> = { dimension: 'size', variant: 'type', grade: 'grade' };
  return MAP[attr] || attr;
}

function _normalizeForMsg(val: string): string {
  return String(val ?? '').toLowerCase().trim().replace(/\s+/g, '');
}

function buildConflictMessage(conflicts: { userValue: string; skuValue: string }[]): CardMessage {
  const parts = conflicts.map(c => `You entered ${c.userValue} — catalog has ${c.skuValue}`);
  return { type: 'conflict', text: `${parts.join('. ')}. Choose which to use.` };
}

function buildMissingMessage(
  family: { sub_category: string },
  resolution: { missing: { attribute: string }[] },
): CardMessage {
  const missing = resolution.missing.map(m => _humanAttrLabel(m.attribute));
  if (missing.length === 1) {
    return { type: 'partial', text: `Found ${family.sub_category}. Which ${missing[0]}?` };
  }
  return { type: 'partial', text: `Found ${family.sub_category}. Specify ${missing.join(' and ')} to match.` };
}

function buildNovelMessage(
  family: { sub_category: string },
  resolution: { resolved?: Record<string, string> },
  members: { dimension?: string | null; variant?: string | null; grade?: string | null }[],
): CardMessage {
  const resolved = resolution.resolved || {};
  const novelEntries = Object.entries(resolved).filter(([attr, val]) => {
    const memberVals = members.map(m => (m as any)[attr] as string | null).filter(Boolean);
    return val && !memberVals.some(mv => _normalizeForMsg(mv!) === _normalizeForMsg(val));
  });
  if (novelEntries.length > 0) {
    const [attr, val] = novelEntries[0];
    const existing = Array.from(new Set(
      members.map(m => (m as any)[attr] as string | null).filter(Boolean) as string[],
    ));
    const display = existing.length <= 3
      ? existing.join(', ')
      : `${existing.slice(0, 3).join(', ')} and ${existing.length - 3} more`;
    return {
      type: 'novel',
      text: `Found ${family.sub_category}. ${val} is new — catalog has ${display}. Add to catalog?`,
    };
  }
  return { type: 'novel', text: `New variant of ${family.sub_category}. Add to catalog?` };
}

function buildMultipleMembersMessage(
  family: { sub_category: string },
  members: { sku_id: string }[],
): CardMessage {
  return { type: 'suggestion', text: `Found ${members.length} ${family.sub_category} items. Which one?` };
}

function buildSuggestionMessage(): CardMessage {
  return { type: 'suggestion', text: 'Similar items found. Select one or skip.' };
}

function buildIdentifiedMessage(name: string, isNew: boolean): CardMessage {
  return {
    type: 'identified',
    text: isNew
      ? `Identified as ${name} (new item). Add to catalog?`
      : `Identified as ${name}. Add to catalog?`,
  };
}

function buildNotFoundMessage(): CardMessage {
  return { type: 'not_found', text: "Couldn't identify this item." };
}

function buildSpecFromSKU(match: { dimension?: string | null; variant?: string | null; grade?: string | null }): string {
  const PLACEHOLDERS = new Set(['generic', 'standard', 'n/a', 'na', 'general', 'default', 'none', 'other', '-', '']);
  const parts = [match.dimension, match.variant, match.grade]
    .filter((v): v is string => !!v && !PLACEHOLDERS.has(v.toLowerCase().trim()));
  return parts.join(' · ');
}

// Builds the spec line from the resolved attribute pills. Replaces the manual
// spec input that the labeled-field redesign removed — same join logic as
// buildSpecFromSKU but driven by the live pill values the user has resolved.
function buildSpecFromPills(pills: PillData[] | undefined | null): string {
  if (!pills?.length) return '';
  const PLACEHOLDERS = new Set(['n/a', 'na', 'nil', 'generic', 'standard', 'none', 'default', 'other', '-', '']);
  return pills
    .filter(p =>
      !!p.value
      && p.state === 'satisfied'
      && !['sub_category', 'family', 'info', 'brand'].includes(p.attribute)
      && !p.attribute.startsWith('info_')
      && !PLACEHOLDERS.has(p.value.toLowerCase().trim()),
    )
    .map(p => p.value!)
    .join(' · ');
}

// ── Material-token reclassifier ─────────────────────────────────────────────
// The regex extractor sometimes bins material codes (ss/ms/gi/brass…) into `grade`.
// Materials are VARIANT identity; grade is for Fe500/OPC53/SCH40/PN10. This corrects
// the extractor's output without touching skuAttributeExtractor.ts.
const MATERIAL_TOKENS = new Set([
  'ss', 'ms', 'gi', 'ci', 'di', 'brass', 'bronze', 'gunmetal', 'copper', 'cu',
  'aluminium', 'aluminum', 'al', 'pvc', 'cpvc', 'upvc', 'ppr', 'hdpe', 'ldpe', 'frp',
  'stainless steel', 'mild steel', 'cast iron', 'galvanized', 'galvanised',
]);

function reclassifyMaterialAttrs<T extends { grade?: string | null; variant?: string | null }>(ex: T): T {
  const g = String(ex.grade ?? '').toLowerCase().trim();
  if (g && MATERIAL_TOKENS.has(g)) {
    return { ...ex, variant: ex.variant ?? ex.grade, grade: null };
  }
  return ex;
}

// Single entry point — extract through this so material reclassification is uniform
// across the resolution + display paths. Also augments the base extractor's dimension
// with the compound/fraction scanner (3"x1½", 3"-1½", 2½ …), overriding ONLY when the
// scan confidently finds a unit/fraction-bearing size (never a bare quantity).
function extractAttrs(input: string) {
  const ex = reclassifyMaterialAttrs(extractAttributesFromInput(input));
  const dim = scanDimension(input);
  if (dim) (ex as any).dimension = dim;
  return ex;
}

// ── Brand detection (order-only; keeps brand OUT of the SKU match) ──────────
// Every known brand, longest-first so "Asian Paints" matches before "Asian".
const ALL_BRANDS = Array.from(new Set(Object.values(BRANDS_BY_CATEGORY).flat()))
  .sort((a, b) => b.length - a.length);

function brandRe(brand: string): RegExp {
  return new RegExp(`(^|\\s)${brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=\\s|$)`, 'i');
}

// First brand found in the input — prefers the line's category, then any category.
function detectBrandInInput(input: string, category: string): string | null {
  const pool = [...brandsFor(category), ...ALL_BRANDS];
  for (const b of pool) if (brandRe(b).test(input)) return b;
  return null;
}

// Remove every known brand token (for SKU-matching terms ONLY — never the display name).
function stripKnownBrands(text: string): string {
  let out = text;
  for (const b of ALL_BRANDS) out = out.replace(new RegExp(brandRe(b).source, 'ig'), ' ');
  return out.replace(/\s+/g, ' ').trim();
}

// ── Typed-attribute helpers (FIX 10) ────────────────────────────────────────
// A durable home for what the user typed, independent of any SKU match — so a
// size/variant/grade is shown and saved even when nothing resolves.
function pillsFromTypedAttrs(
  ta?: { dimension: string | null; variant: string | null; grade: string | null },
): PillData[] {
  if (!ta) return [];
  const out: PillData[] = [];
  const push = (attribute: 'dimension' | 'variant' | 'grade', label: string, value: string | null) => {
    if (value && value.trim()) {
      out.push({ attribute, label, value: value.trim(), state: 'satisfied', editable: true, source: 'token_match' });
    }
  };
  push('dimension', 'Size / Dimension', ta.dimension);
  push('variant',   'Variant / Type',   ta.variant);
  push('grade',     'Grade',            ta.grade);
  return out;
}

// Overlay typed attributes onto whatever pills the resolution produced. Family pills win
// when they carry a value, but any axis the family left empty — OR doesn't have at all —
// is filled from what the user typed. This guarantees typed size/variant/grade are never
// visually lost once a family resolves, no matter which pill-builder ran. Display-only.
function mergeTypedAttrsIntoPills(
  familyPills: PillData[],
  ta?: { dimension: string | null; variant: string | null; grade: string | null },
): PillData[] {
  const typed = pillsFromTypedAttrs(ta);
  if (!typed.length) return familyPills;
  if (!familyPills.length) return typed;
  const byAttr = new Map(familyPills.map(p => [p.attribute, p]));
  for (const tp of typed) {
    const existing = byAttr.get(tp.attribute);
    if (!existing) {
      byAttr.set(tp.attribute, tp);                                   // family has no such axis
    } else if (!existing.value || !String(existing.value).trim()) {
      byAttr.set(tp.attribute, { ...existing, value: tp.value, state: 'satisfied' }); // fill empty
    }
    // else: family pill already carries a value (resolved/conflict) — leave it
  }
  const result = familyPills.map(p => byAttr.get(p.attribute) || p);
  for (const tp of typed) {
    if (!familyPills.some(fp => fp.attribute === tp.attribute)) result.push(tp);
  }
  return result;
}

function specFromTypedAttrs(
  ta?: { dimension: string | null; variant: string | null; grade: string | null },
): string {
  if (!ta) return '';
  return [ta.dimension, ta.variant, ta.grade].filter(Boolean).join(' · ');
}

// Single-sentence, plain-English explanation of how a line item was
// resolved. Reads the trace's stages and final status to pick the right
// narrative, e.g. "Matched 'CPVC Pipe' from catalog by name + spec."
// Returns '' when there's nothing useful to say — caller hides the line.
function buildResolutionStory(
  trace?: { steps: Array<{ stage: string; input: string; result: string }>; finalStatus?: string },
  originalInput?: string,
): string {
  if (!trace?.steps?.length) return '';

  const has = (stage: string) => trace.steps.some(s => s.stage === stage);
  const last = (stage: string) => [...trace.steps].reverse().find(s => s.stage === stage);
  const status = trace.finalStatus;

  // Pull the family name out of the first alias_index hit — "PlumbingPutty(0.91)..."
  const aliasStep   = trace.steps.find(s => s.stage === 'alias_index');
  const aliasFamily = aliasStep
    ? aliasStep.result.split('(')[0].replace(/^user picked\s+/, '').split(',')[0].trim()
    : '';
  const userPicked  = !!aliasStep?.result.startsWith('user picked');

  // Pull the AI's identified name when present
  const aiStep = trace.steps.find(s => s.stage === 'ai');
  const aiName = aiStep?.result.trim();

  // Tree-walk outcome flag
  const treeStep      = last('tree_walk');
  const treeResolved  = treeStep?.result === 'fully_resolved';
  const treeConflict  = !!treeStep?.result.includes('CONFLICT');
  const treeNoTree    = treeStep?.result === 'no_tree';

  // db_re_search summary
  const dbStep   = trace.steps.find(s => s.stage === 'db_re_search');
  const dbChips  = dbStep?.result.includes('chip') ? dbStep.result.match(/^(\d+)/)?.[1] : null;

  const input = originalInput?.trim() ? `"${originalInput.trim()}"` : 'this item';

  // ── Auto-linked: the strongest happy path ──────────────────────────
  if (status === 'auto_linked') {
    if (aliasFamily && treeResolved) {
      return `Auto-linked to "${aliasFamily}" — your text matched the catalog name and every spec.`;
    }
    if (aliasFamily && treeNoTree) {
      return `Auto-linked to "${aliasFamily}" — only one item in that family, so it was an exact match.`;
    }
    if (aliasFamily) {
      return `Auto-linked to "${aliasFamily}" from the catalog alias index.`;
    }
    return `Auto-linked from catalog.`;
  }

  // ── Committed: user clicked "Add to catalog & use" / "Add as custom" ─
  if (status === 'committed') {
    // Look at the commit-stage result tag to know what really happened.
    const commitStep = last('commit');
    const commitKind = commitStep?.result || '';

    if (commitKind === 'LINKED-EXISTING') {
      return aliasFamily
        ? `Linked to an existing catalog item in the "${aliasFamily}" family.`
        : `Linked to an existing catalog item.`;
    }
    if (commitKind === 'ADDED-NEW-VARIANT') {
      const familyForVariant = commitStep?.input || aliasFamily;
      return familyForVariant
        ? `Wasn't a known variant of "${familyForVariant}" — added it to the catalog as a new variant and linked it here.`
        : `Saved as a new variant in the catalog and linked here.`;
    }
    if (commitKind === 'ADDED-NEW-FROM-AI') {
      const newName = commitStep?.input;
      return newName
        ? `Not in catalog — web identified ${input} as "${newName}", added it to the catalog and linked it here.`
        : `Not in catalog — identified by web search, added and linked here.`;
    }
    if (commitKind === 'ADDED-CUSTOM') {
      return `No match in catalog or web — saved ${input} as a custom catalog entry and linked here.`;
    }

    // Fallbacks if commit step is missing (older code paths).
    if (aliasFamily && userPicked) {
      return `You picked "${aliasFamily}" from the catalog suggestions and linked here.`;
    }
    if (aliasFamily && treeConflict) {
      return `Wasn't a known variant of "${aliasFamily}" — added to catalog as a new variant and linked here.`;
    }
    if (aliasFamily) {
      return `Added "${aliasFamily}" from a catalog suggestion.`;
    }
    if (aiName) {
      return `Not in catalog — identified by web as "${aiName}", added and linked here.`;
    }
    if (dbStep) {
      return `Picked from catalog suggestions and added.`;
    }
    return `Added ${input} to the catalog and linked here.`;
  }

  // ── Dismissed: user clicked "Use as typed" ─────────────────────────
  if (status === 'dismissed') {
    return `Using ${input} as-is — no catalog link.`;
  }

  // ── Still resolving (pending / needs_input) — describe current state ─
  if (treeConflict) {
    return `Found "${aliasFamily}" in catalog but the spec you typed doesn't match. Pick one.`;
  }
  if (aliasFamily && !treeResolved && has('tree_walk')) {
    return `Found "${aliasFamily}" in catalog — fill in the missing specs to link it.`;
  }
  if (aliasFamily && !has('tree_walk')) {
    return `Looks like "${aliasFamily}" from catalog — confirm to continue.`;
  }
  if (aiName) {
    return `Web search identified ${input} as "${aiName}" — confirm to add.`;
  }
  if (dbChips) {
    return `Found ${dbChips} similar item${Number(dbChips) === 1 ? '' : 's'} in catalog — pick one or use as typed.`;
  }
  if (dbStep) {
    return `No catalog match for ${input} yet.`;
  }

  return `Searching catalog for ${input}…`;
}

// Minimal read-only pills derived from a matched SKU member. Used in
// auto-link / direct-pick paths that never built pills from a tree walk so
// the labeled attribute fields can still show resolved values after linking.
function buildLinkedPills(member: {
  dimension?: string | null;
  variant?:   string | null;
  grade?:     string | null;
}): PillData[] {
  const PLACEHOLDERS = new Set(['n/a', 'na', 'nil', 'generic', 'standard', 'none', 'default', 'other', '-', '']);
  const pills: PillData[] = [];
  const push = (attribute: 'dimension' | 'variant' | 'grade', label: string, raw: string | null | undefined) => {
    const value = raw?.trim();
    if (!value || PLACEHOLDERS.has(value.toLowerCase())) return;
    pills.push({ attribute, label, value, state: 'satisfied' });
  };
  push('dimension', 'Size / Dimension', member.dimension);
  push('variant',   'Variant / Type',   member.variant);
  push('grade',     'Grade',            member.grade);
  return pills;
}

// Read-only satisfied pills from a chosen catalog member, so the attribute fields SHOW the
// linked SKU's attributes after a chip click. editable:false — the SKU is locked.
function pillsFromMember(m: {
  dimension?: string | null; variant?: string | null; grade?: string | null;
}): PillData[] {
  const out: PillData[] = [];
  const push = (attribute: 'dimension' | 'variant' | 'grade', label: string, value?: string | null) => {
    const v = (value ?? '').toString().trim();
    if (v && !isPlaceholder(v)) {
      out.push({ attribute, label, value: v, state: 'satisfied', editable: false, source: 'user_selected' });
    }
  };
  push('dimension', 'Size / Dimension', m.dimension);
  push('variant',   'Variant / Type',   m.variant);
  push('grade',     'Grade',            m.grade);
  return out;
}

// Label for a candidate chip. sub_category is common to a family, so it must NOT be in the
// label — prefer the canonical item_name; if that's missing, compose from the distinguishing
// attributes only (never sub_category).
function memberChipLabel(m: {
  item_name?: string | null; dimension?: string | null; variant?: string | null;
  grade?: string | null; sub_category?: string | null;
}): string {
  const name = (m.item_name ?? '').trim();
  if (name) return name;
  const composed = [m.variant, m.dimension, m.grade]
    .map(v => (v ?? '').toString().trim())
    .filter(v => v && !isPlaceholder(v))
    .join(' ')
    .trim();
  return composed || (m.sub_category ?? 'Item');
}

// Derives a human-readable explanation of why a match was made.
function buildMatchReason(
  originalInput: string,
  matchedItem: { aliases?: string; item_name: string; match_source?: string }
): string {
  const term = originalInput.toLowerCase().trim();
  if (matchedItem.aliases) {
    const aliasList = matchedItem.aliases.split(',').map(a => a.trim().toLowerCase());
    if (aliasList.includes(term)) return 'matched as known alias';
  }
  switch (matchedItem.match_source) {
    case 'alias_tree':    return 'matched to product family — linked by specification';
    case 'alias_index':   return 'matched to catalog family alias';
    case 'cohere_rerank':
    case 'trgm+cohere':   return 'identified by material analysis';
    case 'llm_fallback':  return 'identified by AI classification';
    default:              return 'closely matches catalog entry';
  }
}

interface DraftLineItem {
  id: string;
  line_number: number;
  category_id: string;
  item_name: string;
  specification: string;
  unit: string;
  quantity_ordered: number;
  unit_rate: number;
  discount_percent: number;
  gst_rate: number;
  basic_amount: number;
  discount_amount: number;
  cgst: number;
  sgst: number;
  total_amount: number;
  sku_id:        string | null;
  searchResults: SKUResult[];
  searching:     boolean;
  showDropdown:  boolean;
  confidence?:           number;
  needs_review?:         boolean;
  match_source?:         string;
  ai_suggested_name?:    string;
  extraction_confidence?: 'HIGH' | 'MEDIUM' | 'LOW';
  sku_alternatives?:     SKUResult[];
  validation_metrics?:   any;
  expandedReview?:       boolean;
  aiSuggestion?: {
    ai_suggested_name: string;
    extracted_attributes: {
      sub_category: string;
      dimension: string | null;
      variant: string | null;
      grade: string | null;
    };
    validation_metrics: {
      passes_shop_floor_test: boolean;
      missing_parameters: string[];
    };
    aliases?: string[];
    sku_id?: string;
    unit?: string;
  };
  isGeneratingAiChip?: boolean;
  original_input?: string;
  auto_applied?: boolean;
  searchCancelled?: boolean;
  auto_apply_reason?: string;
  auto_apply_shown_at?: number;
  family_match?:            any;
  family_profile?:          any;
  family_members?:          any[];
  tree_resolution?:         any;
  web_variants?:            any[];
  auto_create_new_variant?: boolean;
  // Dismiss → quiet state: user clicked ✕ on an auto-applied/suggested match.
  // The card sits silent (no auto-search, no AI trigger, no suggestions) until
  // the text is actually modified. dismissed_sku_ids are SKU IDs the user
  // explicitly rejected on this card — filtered out of future search results.
  dismissed?:               boolean;
  dismissed_sku_ids?:       string[];
  // Inline pills system (replaces FamilyResolutionPanel / OrphanWebPanel /
  // ParametricReviewPanel). attribute_pills drives the in-card UI; checkmark_ready
  // makes the commit button prominent; resolution_trace is dev-only debugging.
  attribute_pills?:         PillData[];
  checkmark_ready?:         boolean;
  resolution_trace?:        ResolutionTrace;
  // Set when the user clicked "Not what you need? Search web" — the AI
  // re-search must skip trgm so the same fuzzy hit (e.g. "Ball Valve"
  // for "Check Valve") doesn't come back. Alias index still runs because
  // exact matches are always trustworthy. Cleared on item-name retype.
  skip_trgm_on_re_search?:  boolean;
  // Patch fields: source-of-resolution tracking, family-selection candidates,
  // custom-item fallback, and service-line short-circuit flag.
  resolution_source?:       'alias_index' | 'trgm' | 'ai' | 'ai_db_re_search';
  pending_families?:        any[];
  show_custom_fallback?:    boolean;
  // What the user actually typed (post material-reclassification), independent of any
  // SKU match. Survives resolution failure so size/variant/grade are never lost. Reset
  // on retype. Kept OUT of attribute_pills so it doesn't trip the chip-suppression gate.
  typed_attrs?:             { dimension: string | null; variant: string | null; grade: string | null };
  // Order-line brand. Pure order-placement metadata — NOT a SKU attribute, never a pill,
  // never enters resolution. Saved to po_line_items.brand.
  brand?:                   string;
  sku_match_skipped?:       boolean;
  // Conflict detection + insertion reasoning. attribute_conflicts is set
  // when an auto-link target's catalog values disagree with the user's
  // input. insertion_reason explains why a *new* SKU is about to be
  // created instead of linking to an existing one.
  attribute_conflicts?:     AttributeConflict[];
  insertion_reason?:        InsertionReason | null;
  // Submit validation: set on items that lack a sku_id when the user
  // attempts to save. Renders a visible red badge until the user resolves
  // them. Cleared by every auto-link / commit path.
  needs_sku_badge?:         boolean;
  // Distinguishes auto-applied (system chose) from user-selected (chip click).
  // Drives ✕ behaviour: auto_applied reverts to original_input + spec,
  // user_selected just clears sku_id and keeps the current text.
  user_selected?:           boolean;
  // Pre-auto-apply specification value, kept for revert-on-dismiss.
  pre_auto_spec?:           string;
  // Skip-without-linking: user deliberately chose to leave the item unlinked.
  // No further matching attempted; submit validation ignores it.
  skipped_linking?:         boolean;
  // Stage indicator for the inline progress UI (replaces the glass overlay).
  // Each stage maps to a different message + dot animation.
  search_stage?:            'searching_catalog' | 'catalog_empty' | 'checking_ai' | 'ai_analyzing' | null;
  // Set while the alias-family + trgm RPCs are in flight so the card shows
  // an immediate "Searching catalog…" cue before any results arrive.
  isSearching?:             boolean;
  // One-line contextual message rendered under the pills/chips. The colour
  // is derived from `type`. Cleared on every resolution path.
  card_message?:            CardMessage;
  // Google-style "Did you mean?" — the canonical name the immediate, parallel
  // AI fire (fireDidYouMean) came back with. A plain string kept SEPARATE from
  // aiSuggestion so it never triggers the legacy AI-chip / orphan-pill UI. Only
  // rendered when the line isn't otherwise resolved.
  did_you_mean?:            string;
  // True while the parallel Serper/Google identification call is in flight.
  dym_loading?:             boolean;
}

// ── Strict auto-link gate + message types (Resolution Rethink) ─────────
// Auto-link is the ONLY pathway that bypasses user confirmation. The four
// preconditions below are the canonical definition; every other path must
// show a suggestion / pills and let the user act.
interface CardMessage {
  type: 'matched' | 'partial' | 'conflict' | 'novel' | 'suggestion' | 'not_found' | 'identified';
  text: string;
}

interface ExtractedItem {
  _id: string;
  item_raw: string;
  item_name: string;
  specification: string;
  unit: string;
  quantity: number;
  unit_rate: number;
  gst_rate: number;
  amount: number;
  has_price: boolean;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
}

function newLine(lineNumber: number): DraftLineItem {
  return {
    id: crypto.randomUUID(),
    line_number: lineNumber,
    category_id: '',
    item_name: '',
    specification: '',
    unit: 'Nos',
    quantity_ordered: 1,
    unit_rate: 0,
    discount_percent: 0,
    gst_rate: 18,
    basic_amount: 0,
    discount_amount: 0,
    cgst: 0,
    sgst: 0,
    total_amount: 0,
    sku_id:        null,
    searchResults: [],
    searching:     false,
    showDropdown:  false,
    isGeneratingAiChip: false,
  };
}

function computeLine(li: DraftLineItem): DraftLineItem {
  const basic   = multiply(li.quantity_ordered, li.unit_rate);
  const disc    = applyPercent(basic, li.discount_percent);
  const taxable = subtract(basic, disc);
  const cgst    = applyPercent(taxable, li.gst_rate / 2);
  const sgst    = applyPercent(taxable, li.gst_rate / 2);
  return {
    ...li,
    basic_amount:    basic,
    discount_amount: disc,
    cgst,
    sgst,
    total_amount: sum([taxable, cgst, sgst]),
  };
}

function fmtDate(d: string | null | undefined) {
  if (!d) return '—';
  const parsed = new Date(d);
  if (isNaN(parsed.getTime())) return d;
  return parsed.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

const EXTRACT_PROMPT = `You are a senior procurement manager for Indian construction projects with expertise in material trade names across AP, Telangana, and pan-India.

Given an image of a quotation, proforma invoice, or price list, extract ALL line items.

CRITICAL — item_name MUST be the standard industry name. NEVER copy the vendor's raw text verbatim.
Translate regional/trade shorthand to proper construction terminology:
- "jelly 20mm" / "metal" → "Coarse Aggregate 20mm"
- "tmt 12mm fe500d" / "tor bar" → "TMT Bar Fe500D 12mm"
- "opc 53" / "53 grade" / brand+"53" → "OPC 53 Cement"
- "opc 43" / "43 grade" → "OPC 43 Cement"
- "m-sand" / "robo sand" → "Manufactured Sand (M-Sand)"
- "river sand" / "fine agg" → "River Sand"
- "ita brick" / "mitti" / "country brick" → "Clay Brick"
- "solid block 200" / "cc block" → "Concrete Solid Block 200mm"
- "fly ash brick" / "fal-g" → "Fly Ash Brick"
Apply your domain knowledge for any other regional or trade terms you recognise.

Return ONLY valid JSON:
{
  "vendor_name": "string or null",
  "items": [
    {
      "item_raw": "verbatim text as it appears in the document",
      "item_name": "standard Indian construction industry name — never vendor shorthand or brand",
      "specification": "grade / size / variant string, or null",
      "unit": "one of: Nos Bags MT m³ m² RFT Ltr kg Set LS Pair Rmt Sqft",
      "quantity": number or null (null if not shown),
      "unit_rate": number or null — CRITICAL: null if the rate is NOT clearly printed in the document. DO NOT estimate, assume, or guess a price. Only set a number when the price is unambiguously visible.,
      "gst_rate": 5 or 12 or 18 or 28 or null (null if not shown — do not assume),
      "amount": number or null (null if unit_rate is null),
      "confidence": "HIGH" | "MEDIUM" | "LOW"
    }
  ]
}

Confidence: HIGH = all fields clearly visible, MEDIUM = some fields inferred, LOW = heavy guessing.
For lump-sum items use unit "LS", quantity 1, unit_rate = lump-sum value only if the value is explicitly stated.
Do not invent items, prices, or quantities not visible in the document.`;

async function fileToBase64(file: File): Promise<{ base64: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result as string;
      const [header, base64] = dataUrl.split(',');
      const mimeType = header.match(/data:([^;]+)/)?.[1] || file.type || 'image/jpeg';
      resolve({ base64, mimeType });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ── Mapping explanation component ────────────────────────────────────────────
// Fades in 300ms after auto-apply, auto-fades after 8s, zero layout shift.

function MappingExplanation({
  originalInput, canonicalName, reason,
}: {
  originalInput: string;
  canonicalName: string;
  reason: string;
}) {
  return (
    <div
      className="explanation-lifecycle mt-1.5 text-[11px] pointer-events-none"
      style={{ minHeight: '1.25rem' }}
    >
      <span className="italic text-on-surface-variant/60">"{originalInput}"</span>
      <span className="text-on-surface-variant/30 mx-1">→</span>
      <span className="text-on-surface-variant/50">{canonicalName}</span>
      <span className="text-on-surface-variant/30 mx-1">·</span>
      <span className="italic text-on-surface-variant/40">{reason}</span>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NewPurchaseOrder({ session }: { session: Session }) {
  const navigate   = useNavigate();
  const location   = useLocation();
  const qc         = useQueryClient();
  const { show: showSnackbar } = useSnackbar();
  const { data: profile } = useUserProfile(session.user.id);
  const orgId = useOrgId();
  const vendorSearchRef   = useRef<HTMLInputElement>(null);
  const [vendorHint, setVendorHint] = useState(false); // surfaces "select a vendor first" at the vendor field when items are touched first
  const searchDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const aiMatchDebounceRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Separate timer for the immediate "Did you mean?" AI fire — runs in parallel
  // with the catalog search, never blocked by it.
  const dymDebounceRef     = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const fileInputRef      = useRef<HTMLInputElement>(null);
  const itemRefs          = useRef<Map<string, HTMLDivElement>>(new Map());
  const lineItemsRef      = useRef<DraftLineItem[]>([]);
  // Line ids that should NOT auto-open their match dropdown (bulk bill extract → many lines at
  // once; the match is ready but the user opens each on focus). Consumed once per id.
  const noAutoOpenRef     = useRef<Set<string>>(new Set());

  const [orderedDate, setOrderedDate]         = useState(new Date().toISOString().split('T')[0]);
  const [expectedDelivery, setExpectedDelivery] = useState('');
  const orderedBy = profile?.name ?? '';

  const [projectId, setProjectId]               = useState<string>((location.state as any)?.projectId || '');
  // Where Save/Back return to: the page the user LAUNCHED from, captured ONCE at
  // mount — not the currently-selected project. Callers that know the exact origin
  // (e.g. a transaction in the ledger) pass state.returnTo and we honour it verbatim;
  // the project PO page opens New PO with state.projectId; the main PO page (and side
  // nav / FAB) pass no state.
  const returnToRef = useRef<string>(
    (location.state as any)?.returnTo
      || ((location.state as any)?.projectId
        ? `/projects/${(location.state as any).projectId}/purchase-orders`
        : '/purchase-orders'),
  );
  const returnTo = returnToRef.current;
  const [vendorId, setVendorId]                 = useState('');
  const [vendorSearch, setVendorSearch]         = useState('');
  const [showVendorSug, setShowVendorSug]       = useState(false);
  const [selectedVendor, setSelectedVendor]     = useState<any>(null);
  const [brandTick, setBrandTick]               = useState(0); // bump to re-read custom brands after an add
  const [paymentTermsDays, setPaymentTermsDays] = useState(30);
  const [customTerms, setCustomTerms]           = useState('');
  const [deliveryLocation, setDeliveryLocation] = useState('');
  // Place a PO (you have a vendor + price) vs Request quotes (you have items, ask vendors to price).
  const [poMode, setPoMode] = useState<'po' | 'rfq'>('po');
  const [showRfq, setShowRfq] = useState(false);

  const [showVendorCreate, setShowVendorCreate] = useState(false);
  const [newVendorName, setNewVendorName]             = useState('');
  const [newVendorCategory, setNewVendorCategory]     = useState('');
  const [newVendorCategoryOther, setNewVendorCategoryOther] = useState('');
  const [newVendorGstin, setNewVendorGstin]           = useState('');

  const [lineItems, setLineItems] = useState<DraftLineItem[]>([newLine(1)]);
  const [aiJustMatchedIds, setAIJustMatchedIds] = useState<Set<string>>(new Set());
  const [dictAddingIds, setDictAddingIds]   = useState<Set<string>>(new Set());
  const [dictAddedIds, setDictAddedIds]     = useState<Set<string>>(new Set());
  const [isGlobalMatching, setIsGlobalMatching] = useState(false);
  const [skuResolutionMode, setSkuResolutionMode] = useState(false);
  const [isAnalyzingSubmit, setIsAnalyzingSubmit] = useState(false);

  lineItemsRef.current = lineItems;

  const [docExtracting, setDocExtracting] = useState(false);
  const [docExtractError, setDocExtractError] = useState<string | null>(null);

  const [vendorNotes, setVendorNotes]   = useState('');
  const [internalNotes, setInternalNotes] = useState('');

  const { data: projects } = useQuery({
    queryKey: ['projects'],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name, site_location, project_code').order('name');
      if (error) throw error;
      return data as { project_id: string; name: string; site_location: string; project_code: string | null }[];
    },
  });

  const { data: vendors } = useQuery({
    queryKey: ['vendors_all'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('stakeholders')
        .select('stakeholder_id, name, category, gstin, is_approved, type, contact')
        .in('type', ['Vendor'])
        .order('name');
      if (error) throw error;
      return data as any[];
    },
  });

  const selectedProjectObj = projects?.find(p => p.project_id === projectId);

  const vendorSuggestions = useMemo(() => {
    if (!vendorSearch || !vendors) return [];
    const q = vendorSearch.toLowerCase();
    return vendors.filter(v => v.name.toLowerCase().includes(q) || v.category?.toLowerCase().includes(q)).slice(0, 8);
  }, [vendorSearch, vendors]);

  // Step 1 vendor list — full universe, filtered by the hero search input.
  const filteredVendors = useMemo(() => {
    if (!vendors) return [] as any[];
    const q = vendorSearch.trim().toLowerCase();
    if (!q) return vendors as any[];
    return (vendors as any[]).filter(v =>
      v.name.toLowerCase().includes(q) || v.category?.toLowerCase().includes(q)
    );
  }, [vendors, vendorSearch]);

  const vendorSKUCategories = useMemo<string[] | null>(() => {
    if (!selectedVendor?.category) return null;
    return VENDOR_TO_SKU_CATEGORIES[selectedVendor.category] ?? null;
  }, [selectedVendor]);


  // Single entry point for picking a vendor — sets state and records the choice
  // in the recent-vendors list so the next PO surfaces it as a one-tap chip.
  function selectVendor(v: any) {
    setVendorId(v.stakeholder_id);
    setSelectedVendor(v);
    setVendorSearch('');
    setShowVendorResults(false);
    try {
      const prev: string[] = JSON.parse(localStorage.getItem('briklay_recent_vendors') || '[]');
      const next = [v.stakeholder_id, ...prev.filter(id => id !== v.stakeholder_id)].slice(0, 10);
      localStorage.setItem('briklay_recent_vendors', JSON.stringify(next));
    } catch { /* ignore */ }
  }

  // When launched from a payment (Track → "Create a new purchase order"), the vendor
  // is already known — auto-select it once the vendor list loads. Runs once, so the
  // owner can still clear/change it.
  const prefillVendorId = (location.state as any)?.stakeholderId as string | undefined;
  const didPrefillVendorRef = useRef(false);
  useEffect(() => {
    if (didPrefillVendorRef.current || !prefillVendorId || !vendors || vendorId) return;
    const v = (vendors as any[]).find(x => x.stakeholder_id === prefillVendorId);
    if (v) { didPrefillVendorRef.current = true; selectVendor(v); }
  }, [vendors, prefillVendorId, vendorId]);

  // A single-project org has nothing to choose — auto-select it so the PO is linkable and submittable
  // (without it, opening New PO globally left projectId empty with no way to set it).
  useEffect(() => {
    if (!projectId && projects && projects.length === 1) setProjectId(projects[0].project_id);
  }, [projects, projectId]);

  // ── Single-page UX state ─────────────────────────────────────────────
  // Vendor dropdown visibility + per-card "active" highlight + date editor.
  const [showVendorResults, setShowVendorResults] = useState(false);
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  // Which action is mid-commit (drives the loading spinner, then a brief success tick).
  const [committing, setCommitting] = useState<{ id: string; kind: 'link' | 'typed' | 'add'; skuId?: string; phase: 'loading' | 'done' } | null>(null);
  // PO-wide mode: 'catalog' = match each item to the catalog (default); 'typed' = use every item
  // exactly as typed, no catalog matching (for quick one-off orders).
  const [poMatchMode, setPoMatchMode] = useState<'catalog' | 'typed'>('catalog');
  const [isEditingDate, setIsEditingDate] = useState(false);
  // ui/new-po-redesign — cosmetic, dead-ended (brief §3). Read ONLY by the save
  // ceremony JSX; never by any pipeline path or payload-constructing handler.
  const [uiCeremonyOpen, setUiCeremonyOpen] = useState(false);

  // Sheet redesign: ONE order-level GST switch instead of the per-line GST/discount inputs.
  // It's pure UI over the SAME per-line data model — flipping it maps every line's gst_rate to
  // 18 or 0 and recomputes, so the saved payload (gst_value/total_value) is produced exactly as
  // before. Default ON (newLine already seeds gst_rate = 18).
  const [gstOn, setGstOn] = useState(true);
  function toggleGlobalGst(on: boolean) {
    setGstOn(on);
    setLineItems(prev => prev.map(li => computeLine({ ...li, gst_rate: on ? 18 : 0 })));
  }

  function getInitials(name: string): string {
    if (!name) return '?';
    return name.trim().split(/\s+/).map(w => w[0]).filter(Boolean).slice(0, 2).join('').toUpperCase();
  }

  // Save is enabled when vendor, project, and at least one named item are set.
  const canSubmit = !!vendorId && !!projectId && lineItems.some(li => li.item_name.trim().length > 0);

  // Clear the mapping explanation on any deliberate card interaction so it
  // doesn't linger for the full 8 seconds when the user has already moved on.
  function dismissExplanation(itemId: string) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (li?.auto_apply_reason) updateLine(itemId, { auto_apply_reason: undefined });
  }

  function updateLine(id: string, patch: Partial<DraftLineItem>) {
    setLineItems(prev =>
      prev.map(li => {
        if (li.id !== id) return li;
        // Snapshot the pre-auto-apply spec the first time the patch sets a
        // sku_id together with a spec value. This lets dismiss revert to
        // whatever the user originally typed before auto-fill overwrote it.
        const isAutoLink   = patch.sku_id && !li.sku_id;
        const replacesSpec = patch.specification !== undefined && patch.specification !== li.specification;
        const effectivePatch: Partial<DraftLineItem> = {
          // Any time a sku_id is assigned, clear the transient cues so the
          // staged-progress UI, submit-validation badge, and contextual
          // card_message don't linger past the resolution.
          ...(patch.sku_id
            ? { needs_sku_badge: false, search_stage: null, isSearching: false, card_message: undefined }
            : {}),
          ...(isAutoLink && replacesSpec && li.pre_auto_spec === undefined
            ? { pre_auto_spec: li.specification ?? '' }
            : {}),
          ...patch,
        };
        return computeLine({ ...li, ...effectivePatch });
      })
    );
  }

  function addLine() {
    setLineItems(prev => {
      const fresh = newLine(prev.length + 1);
      // Respect the order-level GST switch so a new row matches the rest.
      if (!gstOn) fresh.gst_rate = 0;
      // Activate the new card so its inputs are visually highlighted
      setActiveCardId(fresh.id);
      return [...prev, fresh];
    });
  }

  function removeLine(id: string) {
    clearTimeout(searchDebounceRef.current[id]);
    clearTimeout(aiMatchDebounceRef.current[id]);
    clearTimeout(dymDebounceRef.current[id]);
    delete searchDebounceRef.current[id];
    delete aiMatchDebounceRef.current[id];
    delete dymDebounceRef.current[id];
    setLineItems(prev => {
      const next = prev.filter(li => li.id !== id);
      return next.map((li, i) => ({ ...li, line_number: i + 1 }));
    });
  }

  // Material category for an order line's Brand datalist. Vendor-first: use the vendor's
  // material category, refined to the linked SKU's category when stored on the line. Pure
  // order metadata — does NOT touch any SKU/resolution state.
  function lineBrandCategory(li: DraftLineItem): string {
    const linkedCat = (li as any).category as string | undefined;
    return linkedCat
      || (selectedVendor?.category ? vendorCategoryToMaterialCategory(selectedVendor.category) : 'Hardware');
  }

  // ── searchSKUs helpers ────────────────────────────────────────────

  // Specificity check (Gap 13): does the search term carry at least one
  // non-generic-stem word that's also in the family's sub_category? If
  // not, treat the alias as too generic and look for sibling families.
  function getAliasSpecificity(term: string, subCategory: string): 'high' | 'low' {
    const aliasWords = new Set(term.toLowerCase().split(/\s+/).filter(Boolean));
    const subCatWords = subCategory.toLowerCase().split(/\s+/);
    const specificWords = subCatWords.filter(w => !GENERIC_STEMS.has(w) && w.length >= 2);
    if (specificWords.length === 0) return 'low';
    return specificWords.some(w => aliasWords.has(w)) ? 'high' : 'low';
  }

  // Query the alias-family index for other families in the same category
  // that share the generic stem of the matched family. Used to populate
  // family-selection pills when a generic alias like "nali" lands on one
  // family but logically maps to many.
  async function findSiblingFamilies(
    category: string,
    subCategory: string,
  ): Promise<{ sub_category: string; family_size: number; category: string }[]> {
    const subCatLower = subCategory.toLowerCase();
    const stem = Array.from(GENERIC_STEMS).find(s => subCatLower.includes(s));
    if (!stem) return [];
    const { data } = await supabase
      .from('sku_alias_family_index')
      .select('sub_category, family_size, category')
      .eq('category', category)
      .eq('source', 'sub_category')
      .neq('sub_category', subCategory)
      .ilike('sub_category', `%${stem}%`);
    const seen = new Set<string>();
    return (data || []).filter((d: any) => {
      if (seen.has(d.sub_category)) return false;
      seen.add(d.sub_category);
      return true;
    }) as any;
  }

  // Score an alias-family candidate by how many of the user's extracted
  // attributes (dimension/grade/variant) appear in that family's tree
  // values. Used to disambiguate "cement 53 grade" → OPC (which has the
  // 53 grade) over PPC (which doesn't).
  async function scoreFamilyByAttributes(
    family: any,
    extracted: { dimension: string | null; grade: string | null; variant: string | null },
  ): Promise<{ family: any; profile: any; attributeScore: number }> {
    const { data: profile } = await supabase.rpc('get_sku_family_profile', {
      p_category:     family.category,
      p_sub_category: family.sub_category,
    });
    let attributeScore = 0;
    const treeDepth = (profile as any)?.tree_depth || [];
    for (const level of treeDepth) {
      const userValue = (extracted as any)[level.attribute] as string | null | undefined;
      if (!userValue) continue;
      const normalizedUser = String(userValue).toLowerCase().trim().replace(/\s+/g, '');
      const match = (level.values || []).some((v: string) => {
        const nv = String(v).toLowerCase().trim().replace(/\s+/g, '');
        return nv.includes(normalizedUser) || normalizedUser.includes(nv);
      });
      if (match) attributeScore += 1;
    }
    return { family, profile, attributeScore };
  }

  // Run the full single-family pipeline (token match → tree walk → pills →
  // either auto-link or store pills + checkmark state). Factored out so
  // both the direct single-match branch and the disambiguation-winner
  // branch share one code path.
  // ── Bridge: any matched SKU → family pipeline ─────────────────────────
  // Every SKU match (trgm, AI DB re-search, manual chip click, autoMatch)
  // must check for family context BEFORE rendering as a standalone chip or
  // direct-linking. This helper is the single entry point.
  //
  // Behaviour:
  //   - Looks up the matched SKU's (category, sub_category) — fetching from
  //     sku_directory when not already in the input (trgm_match_sku omits
  //     sub_category from its return shape).
  //   - Fetches the family profile + members in parallel.
  //   - If the family has a tree depth → delegates to resolveAgainstSingleFamily
  //     (canAutoLink decides whether to commit).
  //   - If no tree but multiple members → surfaces the members as a picker
  //     (sku_alternatives + buildMultipleMembersMessage).
  //   - Returns false when the caller should keep its original behaviour
  //     (no family lookup possible, single-member homogeneous family, or
  //     network failure).
  // Build a pseudo tree_depth from a family's members when it has no formal tree.
  // Only axes that VARY across members become facets. Ordered dimension → variant → grade.
  function synthesizeTreeDepth(members: any[]): { attribute: string; values: string[] }[] {
    const axes: { attribute: string; values: string[] }[] = [];
    for (const attr of ['dimension', 'variant', 'grade'] as const) {
      const values = Array.from(new Set(
        members
          .map(m => (m as any)[attr])
          .filter((v: any): v is string => !!v && String(v).trim() !== '')
          .map((v: any) => String(v).trim()),
      ));
      if (values.length > 1) axes.push({ attribute: attr, values });
    }
    return axes;
  }

  async function bridgeToFamilyTreeWalk(
    itemId:    string,
    matchedSku: { sku_id: string; category?: string; sub_category?: string; item_name?: string; similarity?: number; [k: string]: any },
    query:     string,
    trace?:    ResolutionTrace,
    seedAttributes?: Partial<ExtractedAttributes>,
  ): Promise<boolean> {
    if (!matchedSku?.sku_id) return false;

    let category    = matchedSku.category;
    let subCategory = matchedSku.sub_category;
    if (!category || !subCategory) {
      const { data: skuRow, error } = await supabase
        .from('sku_directory')
        .select('category, sub_category')
        .eq('sku_id', matchedSku.sku_id)
        .maybeSingle();
      if (error || !skuRow) return false;
      category    = (skuRow as any).category as string;
      subCategory = (skuRow as any).sub_category as string;
    }
    if (!category || !subCategory) return false;

    try {
      const [profileRes, membersRes] = await Promise.all([
        supabase.rpc('get_sku_family_profile', { p_category: category, p_sub_category: subCategory }),
        supabase.rpc('get_family_members',     { p_category: category, p_sub_category: subCategory }),
      ]);
      const profile = profileRes.data as any;
      const members = (membersRes.data || []) as any[];
      if (members.length === 0) return false;

      const tracker = trace ?? createTrace();

      // Family with a tree → delegate to the standard pipeline.
      if (profile?.tree_depth?.length > 0) {
        const syntheticFamily = {
          category,
          sub_category: subCategory,
          family_size:  members.length,
          similarity:   matchedSku.similarity ?? 0.9,
          source:       'bridge',
          matched_term: query,
        };
        addStep(tracker, {
          stage:  'tree_walk',
          input:  `bridge→${subCategory}`,
          result: `${members.length} members, tree depth ${profile.tree_depth.length}`,
        });
        // Merge any seeded attributes (carried from the original input via the DYM
        // accept path) over what we can extract from the bare corrected name (FIX 8d).
        const baseEx = extractAttrs(query);
        const extracted = seedAttributes
          ? {
              ...baseEx,
              dimension: seedAttributes.dimension ?? baseEx.dimension,
              grade:     seedAttributes.grade     ?? baseEx.grade,
              variant:   seedAttributes.variant   ?? baseEx.variant,
            }
          : baseEx;
        await resolveAgainstSingleFamily(itemId, query, syntheticFamily, extracted, tracker, profile, members);
        return true;
      }

      // No tree depth, multiple members → DELEGATE to resolveAgainstSingleFamily, which
      // synthesizes a tree_depth from the members (PART B3) so the family presents as
      // attribute dropdowns and any typed/seeded attributes are actually resolved —
      // instead of dumping every member as a full-name chip picker.
      if (members.length > 1) {
        const familyMatch = {
          category,
          sub_category: subCategory,
          family_size:  members.length,
          similarity:   matchedSku.similarity ?? 0.9,
          source:       'bridge',
          matched_term: query,
        };
        addStep(tracker, {
          stage:  'tree_walk',
          input:  `bridge→${subCategory}`,
          result: `${members.length} members, synthesizing facets`,
        });
        const base = extractAttrs(query);
        const extracted = seedAttributes
          ? {
              ...base,
              dimension: seedAttributes.dimension ?? base.dimension,
              grade:     seedAttributes.grade     ?? base.grade,
              variant:   seedAttributes.variant   ?? base.variant,
            }
          : base;
        await resolveAgainstSingleFamily(itemId, query, familyMatch, extracted, tracker, profile, members);
        return true;
      }

      // Single member, no tree → original behaviour wins (caller handles).
      return false;
    } catch (err) {
      console.warn('Bridge to family tree walk failed:', err);
      return false;
    }
  }

  // Backwards-compat shim for existing call sites that still use the old name.
  // Identical behaviour — just a thin wrapper.
  const maybeRouteTrgmHitToFamilyPipeline = (
    itemId:    string,
    query:     string,
    topResult: { sku_id: string; category?: string; item_name: string; similarity: number },
    seedExtracted: Partial<ExtractedAttributes>,
    trace:     ResolutionTrace,
    // Forward the (already seed-merged) attributes so the bridge's re-extraction
    // doesn't drop a carried dimension/grade/variant on the trgm→bridge path (FIX 8d).
  ): Promise<boolean> => bridgeToFamilyTreeWalk(itemId, topResult, query, trace, seedExtracted);

  async function resolveAgainstSingleFamily(
    itemId: string,
    query: string,
    family: any,
    extracted: any,
    trace: ResolutionTrace,
    profileOverride?: any,
    membersOverride?: any[],
  ) {
    let familyProfile = profileOverride;
    let familyMembers: any[] = [];

    if (familyProfile) {
      if (membersOverride) {
        // Caller already fetched the members (e.g. bridgeToFamilyTreeWalk) — reuse
        // them instead of issuing a second get_family_members round trip.
        familyMembers = membersOverride;
      } else {
        const { data: members } = await supabase.rpc('get_family_members', {
          p_category:     family.category,
          p_sub_category: family.sub_category,
        });
        familyMembers = (members || []) as any[];
      }
    } else {
      const [profileRes, membersRes] = await Promise.all([
        supabase.rpc('get_sku_family_profile', { p_category: family.category, p_sub_category: family.sub_category }),
        supabase.rpc('get_family_members',     { p_category: family.category, p_sub_category: family.sub_category }),
      ]);
      familyProfile = profileRes.data as any;
      familyMembers = (membersRes.data || []) as any[];
    }

    // No formal tree but multiple members → synthesize facets from the members so the
    // family presents as attribute dropdowns AND so resolveAgainstTree actually consumes
    // the user's typed/seeded attributes (a no_tree profile discards `extracted` entirely).
    if (!(familyProfile?.tree_depth?.length > 0) && familyMembers.length > 1) {
      const synth = synthesizeTreeDepth(familyMembers);
      if (synth.length > 0) {
        familyProfile = { ...(familyProfile || {}), tree_depth: synth };
      }
    }

    const tokenMatches = matchTokensAgainstFamily(
      query,
      familyProfile?.tree_depth || [],
      extracted,
    );
    addStep(trace, {
      stage: 'token_match',
      input: 'family values',
      result: JSON.stringify(tokenMatches.resolvedAttributes),
    });

    const mergedExtracted = {
      ...extracted,
      ...(tokenMatches.resolvedAttributes as any),
    };
    const resolution = resolveAgainstTree(mergedExtracted, familyProfile, familyMembers);
    addStep(trace, { stage: 'tree_walk', input: JSON.stringify(mergedExtracted), result: resolution.status });

    const pills = buildPills({
      familyMatch:    family,
      familyProfile,
      treeResolution: resolution,
      tokenMatches,
      regexExtracted: extracted,
    });

    // ── fully_resolved branch ─────────────────────────────────────────
    if (resolution.status === 'fully_resolved') {
      const probeMember = resolution.matchedMember || familyMembers[0];
      const conflicts   = probeMember ? detectAttributeConflicts(mergedExtracted, probeMember) : [];
      addStep(trace, {
        stage:  'tree_walk',
        input:  'conflict_check',
        result: conflicts.length === 0 ? 'no conflicts' : `CONFLICT: ${conflicts.map(c => c.attribute).join(',')}`,
      });

      // Strict gate: only this branch auto-links.
      if (canAutoLink(resolution as any, conflicts as any)) {
        // Never auto-select: offer the match in the dropdown for the user to pick.
        if (!AUTO_LINK_MATCHES) { offerMatchInDropdown(itemId, resolution.matchedMember!, familyMembers, query, trace, family.similarity ?? 1); return; }
        const member      = resolution.matchedMember!;
        const currentItem = lineItemsRef.current.find(l => l.id === itemId);
        setStatus(trace, 'auto_linked');
        addStep(trace, { stage: 'commit', input: member.sku_id, result: 'AUTO-LINKED' });
        logTrace(query, trace);
        updateLine(itemId, {
          sku_id:              member.sku_id,
          item_name:           member.item_name,
          unit:                member.unit,
          needs_review:        false,
          confidence:          Math.round((family.similarity ?? 1) * 100),
          match_source:        'alias_tree',
          original_input:      query,
          auto_applied:        true,
          specification:       currentItem?.specification?.trim() ? currentItem.specification : buildSpecFromSKU(member),
          auto_apply_reason:   buildMatchReason(query, { item_name: member.item_name, match_source: 'alias_tree' }),
          auto_apply_shown_at: Date.now(),
          attribute_pills:     pills.map(p => ({ ...p, state: 'satisfied' as const })),
          attribute_conflicts: undefined,
          insertion_reason:    null,
          card_message:        undefined,
          resolution_source:   'alias_index',
          family_match:        undefined,
          family_profile:      undefined,
          family_members:      undefined,
          tree_resolution:     undefined,
          checkmark_ready:     undefined,
          pending_families:    undefined,
          web_variants:        [],
          sku_alternatives:    undefined,
          aiSuggestion:        undefined,
          searchResults:       [],
          showDropdown:        false,
          searching:           false,
          isGeneratingAiChip:  false,
          show_custom_fallback: false,
          resolution_trace:    trace,
        });
        learnAlias(member.sku_id, query);
        return;
      }

      // canAutoLink was false → exactly ONE of: conflict, novel value, no
      // matchedMember. Branch by reason so the user sees the right message.
      setStatus(trace, 'needs_input');
      logTrace(query, trace);

      if (conflicts.length > 0) {
        const conflictPills = buildConflictPills(family, probeMember!, mergedExtracted, conflicts);
        updateLine(itemId, {
          family_match:        family,
          family_profile:      familyProfile,
          family_members:      familyMembers,
          tree_resolution:     resolution,
          attribute_pills:     conflictPills,
          attribute_conflicts: conflicts,
          card_message:        buildConflictMessage(conflicts),
          checkmark_ready:     false,
          insertion_reason:    null,
          resolution_source:   'alias_index',
          pending_families:    undefined,
          web_variants:        [],
          original_input:      query,
          searching:           false,
          showDropdown:        false,
          sku_alternatives:    undefined,
          aiSuggestion:        undefined,
          isGeneratingAiChip:  false,
          show_custom_fallback: false,
          resolution_trace:    trace,
        });
        return;
      }

      // Novel value (resolution.hasNovelValue or no matchedMember).
      const novelPills = buildNovelVariantPills(
        family,
        resolution.resolved || {},
        familyMembers,
        (familyProfile?.tree_depth || []) as any,
      );
      const reason = buildInsertionReason(family, resolution, mergedExtracted, familyMembers);
      updateLine(itemId, {
        family_match:        family,
        family_profile:      familyProfile,
        family_members:      familyMembers,
        tree_resolution:     resolution,
        attribute_pills:     novelPills,
        attribute_conflicts: undefined,
        insertion_reason:    reason,
        card_message:        buildNovelMessage(family, resolution, familyMembers),
        checkmark_ready:     true,
        resolution_source:   'alias_index',
        pending_families:    undefined,
        web_variants:        [],
        original_input:      query,
        searching:           false,
        showDropdown:        false,
        sku_alternatives:    undefined,
        aiSuggestion:        undefined,
        isGeneratingAiChip:  false,
        show_custom_fallback: false,
        resolution_trace:    trace,
      });
      return;
    }

    // ── partially_resolved / unresolved branch ────────────────────────
    if (resolution.status !== 'no_tree') {
      setStatus(trace, 'needs_input');
      logTrace(query, trace);
      const allSatisfied = pills.every(p => p.state !== 'missing');
      updateLine(itemId, {
        family_match:       family,
        family_profile:     familyProfile,
        family_members:     familyMembers,
        tree_resolution:    resolution,
        attribute_pills:    pills,
        attribute_conflicts: undefined,
        insertion_reason:   null,
        card_message:       buildMissingMessage(family, resolution as any),
        checkmark_ready:    allSatisfied,
        resolution_source:  'alias_index',
        pending_families:   undefined,
        web_variants:       [],
        original_input:     query,
        searching:          false,
        showDropdown:       false,
        sku_alternatives:   undefined,
        aiSuggestion:       undefined,
        isGeneratingAiChip: false,
        show_custom_fallback: false,
        resolution_trace:   trace,
      });
      return;
    }

    // ── no_tree branch ────────────────────────────────────────────────
    // Single member + no conflict is the second permitted auto-link path
    // (the family is homogeneous and the user's input matches it cleanly).
    // Multi-member surfaces as a picker; single-member-with-conflict shows
    // a conflict pill.
    if (familyMembers.length === 1) {
      const m         = familyMembers[0];
      const conflicts = detectAttributeConflicts(mergedExtracted, m);
      addStep(trace, {
        stage:  'tree_walk',
        input:  'conflict_check',
        result: conflicts.length === 0 ? 'no conflicts' : `CONFLICT: ${conflicts.map(c => c.attribute).join(',')}`,
      });

      if (conflicts.length === 0) {
        // Never auto-select: offer the single member in the dropdown for the user to pick.
        if (!AUTO_LINK_MATCHES) { offerMatchInDropdown(itemId, m, familyMembers, query, trace, 1); return; }
        setStatus(trace, 'auto_linked');
        addStep(trace, { stage: 'commit', input: m.sku_id, result: 'AUTO-LINKED (no_tree single)' });
        logTrace(query, trace);
        updateLine(itemId, {
          sku_id:              m.sku_id,
          item_name:           m.item_name,
          unit:                m.unit,
          needs_review:        false,
          confidence:          Math.round((family.similarity ?? 1) * 100),
          match_source:        'alias_tree',
          original_input:      query,
          auto_applied:        true,
          specification:       buildSpecFromSKU(m),
          auto_apply_reason:   buildMatchReason(query, { item_name: m.item_name, match_source: 'alias_tree' }),
          auto_apply_shown_at: Date.now(),
          attribute_pills:     [
            { attribute: 'sub_category', label: 'Item', value: family.sub_category, state: 'satisfied' as const },
            ...buildLinkedPills(m),
          ],
          attribute_conflicts: undefined,
          insertion_reason:    null,
          card_message:        undefined,
          resolution_source:   'alias_index',
          family_match:        undefined,
          family_profile:      undefined,
          family_members:      undefined,
          tree_resolution:     undefined,
          checkmark_ready:     undefined,
          pending_families:    undefined,
          web_variants:        [],
          sku_alternatives:    undefined,
          aiSuggestion:        undefined,
          searchResults:       [],
          showDropdown:        false,
          searching:           false,
          isGeneratingAiChip:  false,
          show_custom_fallback: false,
          resolution_trace:    trace,
        });
        learnAlias(m.sku_id, query);
        return;
      }

      const conflictPills = buildConflictPills(family, m, mergedExtracted, conflicts);
      setStatus(trace, 'needs_input');
      logTrace(query, trace);
      updateLine(itemId, {
        family_match:        family,
        family_profile:      familyProfile,
        family_members:      familyMembers,
        tree_resolution:     resolution,
        attribute_pills:     conflictPills,
        attribute_conflicts: conflicts,
        card_message:        buildConflictMessage(conflicts),
        insertion_reason:    null,
        checkmark_ready:     false,
        resolution_source:   'alias_index',
        original_input:      query,
        searching:           false,
        showDropdown:        false,
        sku_alternatives:    undefined,
        aiSuggestion:        undefined,
        isGeneratingAiChip:  false,
        show_custom_fallback: false,
        resolution_trace:    trace,
      });
      return;
    }

    // no_tree + multiple members → surface as a picker. Members carry the
    // same shape as SKUResult so existing chip rendering handles them.
    if (familyMembers.length > 1) {
      const alternatives = familyMembers.map(m => ({
        sku_id:     m.sku_id,
        item_name:  m.item_name,
        unit:       m.unit,
        category:   family.category,
        sub_category: family.sub_category,
        dimension:  m.dimension ?? null,
        variant:    m.variant ?? null,
        grade:      m.grade ?? null,
        similarity: 1.0,
      }));
      setStatus(trace, 'needs_input');
      logTrace(query, trace);
      updateLine(itemId, {
        family_match:        family,
        family_profile:      familyProfile,
        family_members:      familyMembers,
        tree_resolution:     resolution,
        sku_alternatives:    alternatives as any,
        attribute_pills:     undefined,
        attribute_conflicts: undefined,
        insertion_reason:    null,
        card_message:        buildMultipleMembersMessage(family, familyMembers),
        checkmark_ready:     false,
        resolution_source:   'alias_index',
        original_input:      query,
        searching:           false,
        showDropdown:        false,
        aiSuggestion:        undefined,
        isGeneratingAiChip:  false,
        show_custom_fallback: false,
        resolution_trace:    trace,
      });
    }
  }

  // ── Immediate "Did you mean?" — fires when the user types, in its own
  // thread, fully parallel to and independent of the catalog search. It calls
  // the DEDICATED, isolated `identifyProduct` Edge action (Serper/Google web
  // search + one LLM call → a clean generic product name). That action touches
  // NO DB and shares nothing with generateStructuredSkuWithContext or the
  // catalog pipeline, so a dimensioned DB member name can never leak in. We pull
  // ONLY the `name` out and stash it in the dedicated `did_you_mean` string —
  // never aiSuggestion — so it can't disturb the catalog pipeline or light up
  // the legacy AI-chip / orphan-pill surfaces. Best-effort; failures swallowed.
  // Short 120ms debounce so it leads the catalog search but doesn't spam the API.
  function fireDidYouMean(itemId: string, query: string) {
    clearTimeout(dymDebounceRef.current[itemId]);
    const q = query.trim();
    if (q.length < 2) return;
    if (SERVICE_TERMS_REGEX.test(query)) return;
    const before = lineItemsRef.current.find(l => l.id === itemId);
    if (before?.dismissed || before?.skipped_linking) return;
    dymDebounceRef.current[itemId] = setTimeout(async () => {
      // Mark the Google lookup as in-flight so the card can show it leading.
      const start = lineItemsRef.current.find(l => l.id === itemId);
      if (start && start.item_name.trim() === q && !start.sku_id) {
        updateLine(itemId, { dym_loading: true });
      }
      try {
        // The "Did you mean?" path calls the DEDICATED, fully-isolated
        // `identifyProduct` action: Serper (Google) web search + one LLM call →
        // a CLEAN generic product name. Serper's web context is what lets it know
        // "ituka" → Clay Brick / "siminti" → cement (GPT alone can't). It touches
        // NO DB and shares nothing with the catalog search, so a dimensioned DB
        // member name can never leak in. Response is just { name, confidence }.
        const { data } = await supabase.functions.invoke('sku-matcher', {
          body: {
            action: 'identifyProduct',
            query: q,
            vendor_category: selectedVendor?.category,
          },
        });
        console.log('[DYM]', q, '→', data);   // TEMP — remove after verifying identifyProduct output
        const name = (data as any)?.name;
        const confidence = (data as any)?.confidence ?? 0;
        const latest = lineItemsRef.current.find(l => l.id === itemId);
        // Drop it if the user has moved on, already resolved, or retyped.
        if (!latest || latest.sku_id || latest.skipped_linking) { updateLine(itemId, { dym_loading: false }); return; }
        if (latest.item_name.trim() !== q) { updateLine(itemId, { dym_loading: false }); return; }
        // Only surface a confident guess that isn't just what the user typed.
        const usable = name
          && confidence >= DYM_CONFIDENCE_FLOOR
          && name.trim().toLowerCase() !== q.toLowerCase();
        updateLine(itemId, {
          dym_loading:  false,
          did_you_mean: usable ? name : undefined,
        });
      } catch {
        updateLine(itemId, { dym_loading: false }); // best-effort, non-blocking
      }
    }, 120);
  }

  // ── Restart resolution from scratch with a brand-new item name ──────────
  // Used when the user accepts a "Did you mean?" suggestion: the chosen name
  // drops into the input field, EVERY prior resolution artifact is wiped, and
  // the full pipeline re-runs from step one — identical to the user retyping
  // the name by hand. Any in-flight catalog/AI work for the old text is
  // abandoned via the timer clears inside searchSKUs.
  function startFreshResolution(
    itemId: string,
    name: string,
    rawInput?: string,                              // original garbled text (for alias learning)
    seedAttributes?: Partial<ExtractedAttributes>,  // its extracted size/grade/variant
  ) {
    clearTimeout(searchDebounceRef.current[itemId]);
    clearTimeout(aiMatchDebounceRef.current[itemId]);
    clearTimeout(dymDebounceRef.current[itemId]);
    updateLine(itemId, {
      item_name:              name,
      sku_id:                 null,
      ai_suggested_name:      undefined,
      sku_alternatives:       undefined,
      aiSuggestion:           undefined,
      auto_applied:           false,
      // Keep the raw text as original_input so a successful link learns it as an alias
      // ("11/2\"ss skruss" → matched SKU). The commit/auto-link paths use
      // original_input || item_name for learnAlias.
      original_input:         rawInput ?? undefined,
      // Carry the typed attributes from the seed so the fallback fields keep showing
      // the user's size/variant/grade through the corrected re-resolution (FIX 10 / B4).
      typed_attrs:            seedAttributes ? {
        dimension: seedAttributes.dimension ?? null,
        variant:   seedAttributes.variant   ?? null,
        grade:     seedAttributes.grade     ?? null,
      } : undefined,
      searchCancelled:        false,
      auto_apply_reason:      undefined,
      attribute_pills:        undefined,
      checkmark_ready:        undefined,
      family_match:           undefined,
      family_profile:         undefined,
      family_members:         undefined,
      tree_resolution:        undefined,
      pending_families:       undefined,
      show_custom_fallback:   false,
      sku_match_skipped:      false,
      resolution_source:      undefined,
      resolution_trace:       undefined,
      skip_trgm_on_re_search: false,
      attribute_conflicts:    undefined,
      insertion_reason:       null,
      needs_sku_badge:        false,
      user_selected:          false,
      pre_auto_spec:          undefined,
      skipped_linking:        false,
      isSearching:            false,
      isGeneratingAiChip:     false,
      search_stage:           null,
      card_message:           undefined,
      did_you_mean:           undefined,
      dym_loading:            false,
      dismissed:              false,
      dismissed_sku_ids:      [],
    });
    // Restart BOTH independent searches with the corrected name (FLOW C): the
    // catalog pipeline (seeded with the original input's attributes, FIX 8a) AND a
    // fresh "Did you mean?" pass. The new suggestion only renders if it differs from
    // the corrected name (guarded in the render).
    searchSKUs(itemId, name, seedAttributes);
    if (name.trim().length >= 3) fireDidYouMean(itemId, name);
  }

  async function searchSKUs(itemId: string, query: string, seedAttributes?: Partial<ExtractedAttributes>) {
    // Cancel both timers on every new keystroke
    clearTimeout(searchDebounceRef.current[itemId]);
    clearTimeout(aiMatchDebounceRef.current[itemId]);
    // NOTE: the parallel "Did you mean?" call (fireDidYouMean) is NOT triggered
    // here anymore — it fires independently from the input's onChange, so the
    // catalog search and the AI suggestion are fully decoupled paths.

    if (!query || query.trim().length < 2) {
      updateLine(itemId, {
        searchResults: [], showDropdown: false, sku_alternatives: [],
        family_match: undefined, searching: false, isGeneratingAiChip: false,
      });
      return;
    }

    // Service / labour / hire item — bypass the entire SKU pipeline.
    if (SERVICE_TERMS_REGEX.test(query)) {
      updateLine(itemId, {
        sku_match_skipped:  true,
        searching:          false,
        isGeneratingAiChip: false,
        attribute_pills:    undefined,
        family_match:       undefined,
        family_profile:     undefined,
        family_members:     undefined,
        tree_resolution:    undefined,
        sku_alternatives:   undefined,
        aiSuggestion:       undefined,
        show_custom_fallback: false,
      });
      return;
    }

    // Quiet state: user dismissed a suggestion on this card, OR explicitly
    // opted out via Skip. Don't re-search (and don't fire AI) until the text
    // is actually modified.
    const currentBefore = lineItemsRef.current.find(l => l.id === itemId);
    if (currentBefore?.dismissed || currentBefore?.skipped_linking) return;

    updateLine(itemId, {
      searching:         true,
      isSearching:       true,
      sku_match_skipped: false,
      search_stage:      'searching_catalog',
    });

    // ── Search debounce: 350ms — fast, alias + trgm only ─────────────
    searchDebounceRef.current[itemId] = setTimeout(async () => {
      const current = lineItemsRef.current.find(l => l.id === itemId);
      // Stale-query guard: if user typed more since this fired, do nothing
      if (!current || current.sku_id || current.searchCancelled) return;
      if (current.item_name !== query) return;

      const cats = vendorSKUCategories;

      // PART 2: strip known brands for MATCHING ONLY (the displayed item_name is untouched,
      // and the stale guard above already passed on the real `query`). "Finolex CPVC pipe"
      // → matches against "CPVC pipe" so the brand never pollutes trigram; brand rides in
      // li.brand. Dimensions are unaffected (brands carry no size tokens).
      const queryForSearch = stripKnownBrands(query);

      // ── Step 1: Regex attribute extraction ────────────────────────────
      const trace = createTrace();
      // Merge seeded attributes from the original (pre-correction) input. Seed values
      // override only where non-null, so a corrected name with no attributes of its own
      // (e.g. "Screw") inherits the size/grade/variant the user already typed.
      const base = extractAttrs(queryForSearch);
      const extracted = seedAttributes
        ? {
            ...base,
            dimension: seedAttributes.dimension ?? base.dimension,
            grade:     seedAttributes.grade     ?? base.grade,
            variant:   seedAttributes.variant   ?? base.variant,
          }
        : base;
      const { residual, fullMinusDimension } = extracted;
      addStep(trace, {
        stage: 'regex',
        input: query,
        result: `dim=${extracted.dimension ?? '∅'}, grade=${extracted.grade ?? '∅'}, variant=${extracted.variant ?? '∅'}`,
      });

      // ── Step 1.5: Stop-word clean the search terms (Gap 10) ──────────
      // "I need 2 bags cement" → "cement" hits the alias index. Without
      // stripping, the term is full of filler that drags trgm similarity down.
      const stripStopWords = (s: string | undefined): string =>
        (s || '')
          .split(/\s+/)
          .filter(w => w.length >= 2 && !isStopWord(w))
          .join(' ');
      const cleanedResidual = stripStopWords(residual);
      const cleanedFMD      = stripStopWords(fullMinusDimension);

      // Empty-residual fallback (Gap 12): when the residual collapses to
      // nothing useful (e.g. "12mm"), skip the alias index entirely and go
      // straight to trgm with the full query.
      const skipAliasStep = cleanedResidual.length < 2 && cleanedFMD.length < 2;

      // ── Step 2: Alias-family search (3 terms, first hit wins) ─────────
      let aliasMatches: any[] = [];
      let aliasMatchTerm: string | undefined;
      if (!skipAliasStep) {
        const searchTerms = [cleanedResidual, cleanedFMD, queryForSearch].filter(t => t && t.length >= 2);
        for (const term of searchTerms) {
          const ap: Record<string, unknown> = { p_search_term: term, p_limit: 5 };
          if (cats?.length === 1)  ap.p_category   = cats[0];
          else if (cats?.length)   ap.p_categories = cats;
          const { data: aData } = await supabase.rpc('search_alias_family', ap as any);
          if (aData && aData.length > 0) {
            aliasMatches  = aData;
            aliasMatchTerm = term;
            break;
          }
        }
        if (aliasMatches.length > 0) {
          addStep(trace, {
            stage: 'alias_index',
            input: aliasMatchTerm ?? query,
            result: aliasMatches.map(a => `${a.sub_category}(${a.similarity.toFixed(2)})`).join(', '),
            confidence: aliasMatches[0].similarity,
          });
        }
      }

      // ── Step 2.1: Disambiguate multiple alias matches (Gap 2) ─────────
      // When several families come back with similar similarity, score each
      // by how many of the user's regex-extracted attributes (dimension,
      // grade, variant) exist in that family's tree values. If one family
      // wins on attribute score, pick it. Otherwise show a family-selection
      // pill (Gap 5).
      let topMatch: any = aliasMatches[0] || null;
      let topProfile: any = null;
      if (aliasMatches.length > 1) {
        // F1: consider ALL returned families (p_limit caps this at 5), not just
        // the top 3 — a 4-way tie like "sand" → M-Sand / Natural Sand / Plaster
        // Sand / River Sand must keep every tied family in the picker set.
        const candidates = aliasMatches.slice(0, 5);
        const scored = await Promise.all(
          candidates.map(c => scoreFamilyByAttributes(c, extracted)),
        );
        scored.sort((a, b) =>
          (b.attributeScore - a.attributeScore) ||
          ((b.family.similarity ?? 0) - (a.family.similarity ?? 0))
        );

        // F2: pick a winner ONLY on a decisive separation; otherwise show the
        // picker. Ties go to the user, never to an arbitrary auto-pick among
        // equals (the old `else` branch silently chose scored[0]).
        const SIM_MARGIN  = 0.12;   // similarity gap that counts as a decisive winner
        const ATTR_MARGIN = 1;      // attribute-score gap that counts as decisive

        const w = scored[0], r = scored[1];
        const simWinner  = (w.family.similarity - (r?.family.similarity ?? 0)) >= SIM_MARGIN;
        const attrWinner = (w.attributeScore   - (r?.attributeScore   ?? 0)) >= ATTR_MARGIN;

        // Families bunched near the top score (within a small band) — the picker set.
        const topSim   = w.family.similarity;
        const tieband  = scored.filter(s => (topSim - s.family.similarity) <= 0.1
                                            && s.family.similarity >= SKU_CHIP_DISPLAY);

        if (attrWinner || simWinner) {
          // Decisive winner — proceed as today.
          topMatch   = w.family;
          topProfile = w.profile;
        } else if (tieband.length > 1) {
          // Genuine near-tie among >=2 valid families → ASK. Never auto-pick among equals.
          const pickFamilies = tieband.map(s => s.family);
          const pills = buildFamilySelectionPills(pickFamilies);
          setStatus(trace, 'needs_input');
          logTrace(query, trace);
          updateLine(itemId, {
            attribute_pills:     pills,
            pending_families:    pickFamilies,
            family_match:        undefined,
            family_profile:      undefined,
            family_members:      undefined,
            tree_resolution:     undefined,
            checkmark_ready:     false,
            original_input:      query,
            resolution_source:   'alias_index',
            sku_alternatives:    undefined,
            aiSuggestion:        undefined,
            searching:           false,
            isGeneratingAiChip:  false,
            show_custom_fallback: false,
            resolution_trace:    trace,
            card_message:        { type: 'suggestion', text: 'Multiple matches — which one?' },
          });
          return;
        } else {
          // Single candidate above band, or one clearly-best → proceed.
          topMatch   = w.family;
          topProfile = w.profile;
        }
      }

      // ── Step 2.2: High-confidence single match ─────────────────────────
      if (topMatch && topMatch.similarity >= SKU_AUTO_COMMIT) {
        // Specificity check (Gap 13): if the alias is generic ("nali") and
        // siblings exist in the same category, surface a family-selection
        // pill instead of locking onto one family.
        const specificity = getAliasSpecificity(aliasMatchTerm || query, topMatch.sub_category);
        if (specificity === 'low') {
          const siblings = await findSiblingFamilies(topMatch.category, topMatch.sub_category);
          if (siblings.length > 0) {
            const allFamilies = [
              topMatch,
              ...siblings.map(s => ({
                ...topMatch,
                sub_category: s.sub_category,
                category:     s.category,
                family_size:  s.family_size,
                similarity:   topMatch.similarity * 0.9,
              })),
            ];
            const pills = buildFamilySelectionPills(allFamilies);
            setStatus(trace, 'needs_input');
            logTrace(query, trace);
            updateLine(itemId, {
              attribute_pills:     pills,
              pending_families:    allFamilies,
              family_match:        undefined,
              family_profile:      undefined,
              family_members:      undefined,
              tree_resolution:     undefined,
              checkmark_ready:     false,
              original_input:      query,
              resolution_source:   'alias_index',
              sku_alternatives:    undefined,
              aiSuggestion:        undefined,
              searching:           false,
              isGeneratingAiChip:  false,
              show_custom_fallback: false,
              resolution_trace:    trace,
            });
            return;
          }
        }

        await resolveAgainstSingleFamily(itemId, query, topMatch, extracted, trace, topProfile);
        return;

      } else if (topMatch && topMatch.similarity >= SKU_CHIP_DISPLAY) {
        // ── Medium confidence (Gap 4) ─────────────────────────────────
        // Build pills with sub_category in 'suggested' state. User must tap
        // to confirm. We also fall through to trgm so DB alternatives can
        // appear as chips below.
        const suggestedPills: PillData[] = [{
          attribute: 'sub_category',
          label:     'Item',
          value:     topMatch.sub_category,
          state:     'suggested',
          source:    'token_match',
        }];
        updateLine(itemId, {
          family_match:       topMatch,
          attribute_pills:    suggestedPills,
          checkmark_ready:    false,
          original_input:     query,
          resolution_source:  'alias_index',
          resolution_trace:   trace,
        });
        // Background members fetch — used by handleFamilySuggestionClick
        supabase.rpc('get_family_members', {
          p_category:     topMatch.category,
          p_sub_category: topMatch.sub_category,
        }).then(({ data: members }) => {
          const still = lineItemsRef.current.find(l => l.id === itemId);
          if (still && !still.sku_id && still.item_name === query) {
            updateLine(itemId, { family_members: members || [] });
          }
        });
        // Fall through to trgm ↓
      }

      // When the alias index found NOTHING, trgm is our only signal — drop the
      // display/bridge floor so a real-but-low-similarity hit (e.g. "Laking jales"
      // → CP Fitting Jali Grating @ 0.38) is shown/bridged instead of hidden. When
      // alias DID match, keep the strict chip floor.
      const hadAliasMatch = aliasMatches.length > 0 || !!topMatch;
      const effectiveFloor = hadAliasMatch ? SKU_CHIP_DISPLAY : SKU_LOW_DISPLAY;

      // ── Step 5: trgm (runs for medium-confidence alias AND no-alias) ──
      const rpcParams: Record<string, unknown> = {
        p_search_term: queryForSearch.trim(),
        p_limit:       3,
      };
      if (cats && cats.length === 1)   rpcParams.p_category   = cats[0];
      else if (cats && cats.length > 1) rpcParams.p_categories = cats;

      const { data, error } = await supabase.rpc('trgm_match_sku', rpcParams as any);
      if (error) {
        console.error('SKU search error:', error);
        if (typeof navigator !== 'undefined' && !navigator.onLine) {
          showSnackbar('No internet connection. SKU search will retry when back online.');
        }
        updateLine(itemId, { searching: false });
        return;
      }
      // Filter out SKU IDs the user has explicitly dismissed on this card.
      const currentForFilter = lineItemsRef.current.find(l => l.id === itemId);
      const dismissedIds = new Set(currentForFilter?.dismissed_sku_ids || []);
      const results = ((data ?? []) as SKUResult[]).filter(r => !dismissedIds.has(r.sku_id));
      const top = results[0];

      // ── Step 5b: trgm fallback ─────────────────────────────────────────
      // If the top trgm result belongs to a family with a tree, route through
      // the family pipeline — that lets canAutoLink fire when the user's
      // attributes match an existing member cleanly. Otherwise the result
      // stays a suggestion chip; the user must click it.
      {
        const hasChips     = results.some(c => c.similarity > effectiveFloor);
        const visibleChips = results.filter(c => c.similarity > effectiveFloor);

        // Family-pipeline promotion attempt — when we have a top match at/above the
        // effective floor AND no alias-family already in flight. The bridge runs its
        // own family lookup + canAutoLink gate, so a low-sim hit that turns out to be
        // a real family member walks the tree; one that isn't falls through to chips.
        if (!topMatch && top && top.similarity >= effectiveFloor) {
          const routed = await maybeRouteTrgmHitToFamilyPipeline(itemId, query, top, extracted, trace);
          if (routed) return;
        }

        addStep(trace, {
          stage:  'db_re_search',
          input:  query,
          result: hasChips
            ? `${visibleChips.length} chip(s) found`
            : results.length > 0
              ? `${results.length} low-similarity match(es)`
              : 'no matches',
        });
        updateLine(itemId, {
          sku_alternatives: hasChips ? visibleChips : results,
          card_message:     hasChips && !topMatch ? buildSuggestionMessage() : undefined,
          searchResults:    [],
          showDropdown:     false,
          searching:        false,
          isSearching:      false,
          // No AI fallback fires from here anymore — clear the stage. The
          // parallel "Did you mean?" (fireDidYouMean, from onChange) is the
          // only AI surface now, and it lives in its own zone on the card.
          search_stage:     null,
          resolution_trace: trace,
        });
      }
    }, 300);
  }

  // Edit a line's Size / Variant / Grade directly in the sheet columns. Writes to typed_attrs,
  // which the columns mirror and specFromTypedAttrs turns into the line's specification.
  function setTypedAttr(itemId: string, key: 'dimension' | 'variant' | 'grade', value: string) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    const cur = li?.typed_attrs || { dimension: null, variant: null, grade: null };
    updateLine(itemId, { typed_attrs: { ...cur, [key]: value.trim() ? value : null } });
  }

  // Never-auto-link: surface a confident match (and any alternatives) in the dropdown as the
  // highlighted top suggestion instead of committing it. The user picks → selectSKU commits.
  function offerMatchInDropdown(itemId: string, member: any, alternatives: any[], query: string, trace?: any, topSim = 1) {
    const toResult = (m: any, sim: number): SKUResult => ({
      sku_id: m.sku_id, item_name: m.item_name, category: m.category, sub_category: m.sub_category,
      dimension: m.dimension ?? null, variant: m.variant ?? null, grade: m.grade ?? null,
      unit: m.unit, aliases: m.aliases, similarity: sim,
    });
    const clampSim = (s: number) => Math.min(1, Math.max(0.5, s > 0 ? s : 0.9));
    const seen = new Set<string>([member.sku_id]);
    const results: SKUResult[] = [toResult(member, clampSim(topSim))];
    for (const a of alternatives || []) {
      if (a?.sku_id && !seen.has(a.sku_id)) { seen.add(a.sku_id); results.push(toResult(a, clampSim(typeof a.similarity === 'number' ? a.similarity : 0.6))); }
    }
    // Single typed item → open the dropdown right away (match highlighted). Bulk bill extract →
    // keep it closed (the field's onFocus reopens it) so we don't stack many dropdowns at once.
    const autoOpen = !noAutoOpenRef.current.has(itemId);
    noAutoOpenRef.current.delete(itemId);
    clearTimeout(dymDebounceRef.current[itemId]);   // cancel the parallel "Did you mean?" — the dropdown is the one surface
    if (trace) setStatus(trace, 'needs_input');
    updateLine(itemId, {
      sku_id:              undefined,
      original_input:      query,
      searchResults:       results,
      showDropdown:        autoOpen,
      needs_review:        true,
      auto_applied:        false,
      checkmark_ready:     false,
      // ONE clean surface: the "Catalog matches" dropdown. Suppress the parallel strips (yellow
      // card message, "Did you mean?", family disambiguation, spec editor) so the row isn't
      // cluttered with three competing prompts.
      card_message:        undefined,
      did_you_mean:        undefined,
      dym_loading:         false,
      insertion_reason:    null,
      attribute_pills:     undefined,
      attribute_conflicts: undefined,
      pending_families:    undefined,
      searching:           false,
      resolution_trace:    trace,
    });
  }

  // Commit a catalog pick: a brief loading beat, then link (the row settling into its linked
  // state is the success).
  function commitPick(itemId: string, sku: SKUResult, e: React.MouseEvent) {
    e.preventDefault();
    if (committing) return;
    setCommitting({ id: itemId, kind: 'link', skuId: sku.sku_id, phase: 'loading' });
    setTimeout(() => { selectSKU(itemId, sku); setCommitting(null); }, 360);
  }
  // Commit "Use as typed": loading → a green success tick → then keep-as-typed.
  function commitUseAsTyped(itemId: string, e: React.MouseEvent) {
    e.preventDefault();
    if (committing) return;
    setCommitting({ id: itemId, kind: 'typed', phase: 'loading' });
    setTimeout(() => setCommitting({ id: itemId, kind: 'typed', phase: 'done' }), 320);
    setTimeout(() => { handleSkipWithoutLinking(itemId); setCommitting(null); }, 900);
  }
  // Commit "Add to catalog & use" — a REAL async op: spinner until it lands, then a success tick.
  function commitAddToCatalog(itemId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (committing) return;
    setCommitting({ id: itemId, kind: 'add', phase: 'loading' });
    Promise.resolve(handleAddToCatalog(itemId))
      .then(() => { setCommitting({ id: itemId, kind: 'add', phase: 'done' }); setTimeout(() => setCommitting(null), 700); })
      .catch(() => setCommitting(null));
  }

  // Flip the whole PO between "match to catalog" and "use everything as typed".
  function setMatchMode(mode: 'catalog' | 'typed') {
    if (mode === poMatchMode) return;
    setPoMatchMode(mode);
    if (mode === 'typed') {
      // Use all as typed: cancel any resolution, drop the catalog UI, mark every named line skipped.
      lineItemsRef.current.forEach((li) => {
        clearTimeout(aiMatchDebounceRef.current[li.id]);
        clearTimeout(dymDebounceRef.current[li.id]);
        clearTimeout(searchDebounceRef.current[li.id]);
        if (li.item_name.trim()) updateLine(li.id, {
          skipped_linking: true, sku_id: null, showDropdown: false, searchResults: [],
          sku_alternatives: undefined, did_you_mean: undefined, dym_loading: false,
          card_message: undefined, pending_families: undefined, family_match: undefined,
          family_members: undefined, tree_resolution: undefined, attribute_pills: undefined,
          needs_sku_badge: false, checkmark_ready: undefined, isSearching: false, search_stage: null,
        });
      });
    } else {
      // Back to catalog: clear the skip and re-resolve each named, still-unlinked line.
      lineItemsRef.current.forEach((li) => {
        if (li.item_name.trim() && !li.sku_id) {
          updateLine(li.id, { skipped_linking: false });
          noAutoOpenRef.current.add(li.id);
          setTimeout(() => { const raw = li.item_name; startFreshResolution(li.id, raw, raw, li.typed_attrs ?? extractAttrs(raw)); }, 50);
        }
      });
    }
  }

  function selectSKU(itemId: string, sku: SKUResult) {
    const li        = lineItemsRef.current.find(l => l.id === itemId);
    const userTerm  = li?.original_input ?? li?.item_name ?? '';
    const extracted = extractAttrs(userTerm);
    const conflicts = detectAttributeConflicts(extracted, sku as any);

    if (conflicts.length === 0) {
      // Clean pick → the line is RESOLVED (sku_id is set below). Kill the
      // in-flight "Did you mean?" call and clear the suggestion; sku_id would
      // hide it anyway, but this also stops a pending result from flickering in.
      clearTimeout(dymDebounceRef.current[itemId]);
      // Persist read-only attribute pills so the labeled fields stay populated
      // after the user picks from the dropdown. li.attribute_pills may have
      // carried a suggested or satisfied sub_category — preserve it if so.
      const existing = li?.attribute_pills?.length
        ? li.attribute_pills.map(p => ({ ...p, state: 'satisfied' as const }))
        : [];
      const enriched = buildLinkedPills(sku as any);
      const have     = new Set(existing.map(p => p.attribute));
      const finalPills = [...existing, ...enriched.filter(p => !have.has(p.attribute))];
      if (li?.resolution_trace) setStatus(li.resolution_trace, 'committed');
      updateLine(itemId, {
        item_name:           sku.item_name,
        sku_id:              sku.sku_id,
        unit:                sku.unit,
        // Manual pick: user_selected drives a different dismiss path than auto-apply.
        auto_applied:        false,
        user_selected:       true,
        original_input:      userTerm,
        attribute_pills:     finalPills.length > 0 ? finalPills : undefined,
        attribute_conflicts: undefined,
        insertion_reason:    null,
        searchResults:       [],
        showDropdown:        false,
        sku_alternatives:    undefined,
        did_you_mean:        undefined,   // resolved → clear the suggestion
        dym_loading:         false,
      });
      learnAlias(sku.sku_id, userTerm);
      return;
    }

    // Conflict — surface the pills, keep selection open. This path leaves sku_id
    // null (the line isn't resolved yet), so the parallel "Did you mean?" suggestion
    // is intentionally LEFT ALONE: it lives in its own zone and persists until the
    // user explicitly acts on it (picks it, edits the name, links, or skips).
    const conflictPills = buildConflictPills(null, sku as any, extracted, conflicts);
    updateLine(itemId, {
      attribute_pills:     conflictPills,
      attribute_conflicts: conflicts,
      checkmark_ready:     false,
      insertion_reason:    null,
      original_input:      userTerm,
      searchResults:       [],
      showDropdown:        false,
    });
  }

  function clearSKU(itemId: string) {
    updateLine(itemId, { sku_id: null, searchResults: [], showDropdown: false, sku_alternatives: undefined });
  }

  // Used for DB chip + AI chip clicks. Runs the same conflict check the
  // automatic paths run so the user can never silently link to a SKU whose
  // catalog spec contradicts what they typed.
  async function handleChipClick(itemId: string, chip: any) {
    const li        = lineItemsRef.current.find(l => l.id === itemId);
    if (!li) return;
    const userTerm  = li.original_input || li.item_name;

    // The chip from the search may carry ONLY { sku_id, item_name } — e.g. when the deployed
    // trgm RPC predates the spec-columns migration, or category/sub_category weren't selected.
    // Fetch the chosen member's structured attributes by sku_id so its dimension/variant/grade
    // drive both the resolution seed and the displayed fields, regardless of the RPC shape.
    let member: any = chip;
    if (chip.sku_id && chip.dimension === undefined && chip.variant === undefined && chip.grade === undefined) {
      const { data } = await supabase
        .from('sku_directory')
        .select('sku_id, category, sub_category, dimension, variant, grade, standard_unit')
        .eq('sku_id', chip.sku_id)
        .maybeSingle();
      if (data) member = { ...chip, ...data };
    }
    console.log('[CHIP-CLICK] member after fetch=', JSON.stringify({ sku_id: member.sku_id, dimension: member.dimension, variant: member.variant, grade: member.grade })); // TEMP

    // Bridge first: every chip click must check for family context. SEED with the chosen
    // member's own attributes — the user picked this specific member, so its dimension/
    // variant/grade must drive the resolution (otherwise the bridge re-resolves against the
    // vague typed text and the chip's size comes back blank).
    const chipSeed = {
      dimension: member.dimension ?? null,
      variant:   member.variant   ?? null,
      grade:     member.grade     ?? null,
    };
    const bridged = await bridgeToFamilyTreeWalk(itemId, member, userTerm, undefined, chipSeed);
    if (bridged) {
      // Clear any leftover alternatives — the family pipeline is the UI now.
      updateLine(itemId, { sku_alternatives: undefined });
      return;
    }

    const extracted = extractAttrs(userTerm);
    const conflicts = detectAttributeConflicts(extracted, member);

    if (conflicts.length === 0) {
      // Build read-only pills from the chosen member, then keep any prior pill the member
      // doesn't cover (e.g. a typed grade the SKU lacks) so nothing the user resolved is lost.
      const memberPills = pillsFromMember(member);
      const covered     = new Set(memberPills.map(p => p.attribute));
      const carried     = (li.attribute_pills || [])
        .filter(p => p.value && p.state === 'satisfied' && !covered.has(p.attribute));
      const finalPills  = [...memberPills, ...carried];
      if (li.resolution_trace) setStatus(li.resolution_trace, 'committed');
      updateLine(itemId, {
        item_name:           member.item_name || chip.item_name,
        sku_id:              member.sku_id || chip.sku_id,
        unit:                member.standard_unit || chip.standard_unit || chip.unit,
        original_input:      userTerm,
        // User explicitly tapped a chip — not an auto-apply.
        auto_applied:        false,
        user_selected:       true,
        attribute_pills:     finalPills.length > 0 ? finalPills : undefined,
        attribute_conflicts: undefined,
        insertion_reason:    null,
        card_message:        undefined,
        sku_alternatives:    undefined,
        aiSuggestion:        undefined,
        validation_metrics:  undefined,
      });
      learnAlias(member.sku_id || chip.sku_id, userTerm);
      return;
    }

    const conflictPills = buildConflictPills(null, chip, extracted, conflicts);
    updateLine(itemId, {
      attribute_pills:     conflictPills,
      attribute_conflicts: conflicts,
      card_message:        buildConflictMessage(conflicts),
      checkmark_ready:     false,
      insertion_reason:    null,
      original_input:      userTerm,
    });
  }

  async function autoMatchSKU(itemId: string, query: string) {
    if (!query || query.trim().length < 2) return;
    const cats = vendorSKUCategories;
    const rpcParams: Record<string, unknown> = {
      p_search_term: query.trim(),
      p_limit:       8,
    };
    if (cats && cats.length === 1)  rpcParams.p_category   = cats[0];
    else if (cats && cats.length > 1) rpcParams.p_categories = cats;

    updateLine(itemId, { searching: true, showDropdown: false });
    const { data, error } = await supabase.rpc('trgm_match_sku', rpcParams as any);
    if (error || !data?.length) {
      updateLine(itemId, { searching: false });
      return;
    }
    const results = data as SKUResult[];
    const top     = results[0];

    // Bridge first: even on this batch-import / submit-time fallback path
    // we drive every trgm hit through the family pipeline so canAutoLink
    // gets the final say. Only if the top match has no family context (or
    // a tree-less single-member family) do we fall back to suggestion chips.
    if (top && top.similarity >= SKU_CHIP_DISPLAY) {
      const bridged = await bridgeToFamilyTreeWalk(itemId, top, query);
      if (bridged) {
        updateLine(itemId, { searching: false, isSearching: false });
        return;
      }
    }

    // Resolution rethink: trgm never auto-links. Surface results as
    // suggestions only; the user must click a chip to commit (and that
    // path runs through handleChipClick's bridge + conflict gate).
    const visible = results.filter(c => c.similarity > SKU_CHIP_DISPLAY).slice(0, 3);
    updateLine(itemId, {
      sku_alternatives: visible.length > 0 ? visible : results.slice(0, 3),
      card_message:     visible.length > 0 ? buildSuggestionMessage() : undefined,
      searchResults:    [],
      showDropdown:     false,
      searching:        false,
      isSearching:      false,
      original_input:   query,
    });
  }

  // Custom-item fallback (Gap 6). Creates a minimal SKU directly under
  // an Uncategorized category from the user's raw text. Used when every
  // other path (alias, trgm, AI) failed to produce a candidate.
  // User explicitly chose not to link this line. Clears every suggestion and
  // marks the line as "deliberately unlinked" — submit validation skips it.
  function handleSkipWithoutLinking(itemId: string) {
    clearTimeout(searchDebounceRef.current[itemId]);
    clearTimeout(aiMatchDebounceRef.current[itemId]);
    const skLi = lineItemsRef.current.find(l => l.id === itemId);
    const skipTrace = skLi?.resolution_trace;
    if (skipTrace) setStatus(skipTrace, 'dismissed');
    updateLine(itemId, {
      skipped_linking:      true,
      sku_id:               null,
      // Keep the typed size/variant/grade on the line even though it's unlinked,
      // so "Use as typed" still saves "3\" · ss" (FIX 10 / B8).
      specification:        skLi?.specification?.trim() || specFromTypedAttrs(skLi?.typed_attrs),
      attribute_pills:      undefined,
      attribute_conflicts:  undefined,
      insertion_reason:     null,
      sku_alternatives:     undefined,
      aiSuggestion:         undefined,
      family_match:         undefined,
      family_profile:       undefined,
      family_members:       undefined,
      tree_resolution:      undefined,
      pending_families:     undefined,
      checkmark_ready:      undefined,
      web_variants:         [],
      isGeneratingAiChip:   false,
      isSearching:          false,
      search_stage:         null,
      searchCancelled:      true,
      dismissed:            true,
      show_custom_fallback: false,
      needs_sku_badge:      false,
      card_message:         undefined,
    });
  }

  // (handleCustomItemAdd removed — the always-visible "Add to catalog & use"
  // footer + handleAddToCatalog is now the single add-to-catalog path.)

  // ── Inline pill handlers (replace FamilyResolutionPanel / OrphanWebPanel) ──

  function handlePillSelection(itemId: string, attribute: string, value: string) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (!li) return;

    // Family-selection pill (Gap 5): user picked one of several candidate
    // families. Look it up, fetch its profile + members, then run the
    // single-family resolution pipeline so pills + checkmark behave the
    // same as the direct alias hit.
    if (attribute === 'family') {
      // F4: the value carries a stable `${category}::${sub_category}` key so two
      // same-named families across different categories are distinguishable.
      // Fall back to sub_category-only for any legacy caller that passes a bare name.
      const [chosenCategory, chosenSub] = value.includes('::')
        ? value.split('::')
        : [undefined, value];
      const selected =
        (li.pending_families || []).find(
          (f: any) => f.sub_category === chosenSub && (!chosenCategory || f.category === chosenCategory),
        ) || (li.pending_families || []).find((f: any) => f.sub_category === chosenSub);
      if (!selected) return;
      const trace = createTrace();
      addStep(trace, { stage: 'alias_index', input: value, result: `user picked ${selected.sub_category}` });
      const extracted = extractAttrs(li.original_input || li.item_name);
      // Fire-and-forget — resolveAgainstSingleFamily handles all state updates.
      resolveAgainstSingleFamily(itemId, li.original_input || li.item_name, selected, extracted, trace);
      updateLine(itemId, { pending_families: undefined });
      return;
    }

    // Conflict-resolution branch: the pill in conflict is being resolved by
    // the user picking one of the two options. options[0] = existing catalog
    // value, options[1] = user's typed value.
    const conflictPill = li.attribute_pills?.find(
      p => p.attribute === attribute && p.state === 'conflict',
    );
    if (conflictPill && conflictPill.conflictWith) {
      const isExistingValue = value === conflictPill.conflictWith;
      const matchedSku =
        li.family_members?.find((m: any) => m.sku_id) ||
        li.sku_alternatives?.[0];

      if (isExistingValue && matchedSku) {
        // User accepts the catalog value → link to the matched SKU
        const m: any = matchedSku;
        if (li.resolution_trace) setStatus(li.resolution_trace, 'committed');
        updateLine(itemId, {
          sku_id:              m.sku_id,
          item_name:           m.item_name,
          unit:                m.unit || m.standard_unit,
          specification:       buildSpecFromSKU(m),
          auto_applied:        true,
          needs_review:        false,
          auto_apply_reason:   `confirmed ${conflictPill.humanLabel || humanLabel(attribute)}: ${value}`,
          attribute_pills:     li.attribute_pills?.map(p =>
            p.attribute === attribute
              ? { ...p, value, state: 'satisfied' as const, conflictWith: undefined, options: undefined }
              : p,
          ),
          attribute_conflicts: undefined,
          insertion_reason:    null,
          family_match:        undefined,
          family_profile:      undefined,
          family_members:      undefined,
          tree_resolution:     undefined,
          checkmark_ready:     undefined,
          sku_alternatives:    undefined,
        });
        learnAlias(m.sku_id, li.original_input || li.item_name);
        return;
      }

      // User keeps their value → treat as novel variant; show insertion reason.
      const updatedPills: PillData[] = (li.attribute_pills || []).map(p =>
        p.attribute === attribute
          ? { ...p, value, state: 'satisfied' as const, conflictWith: undefined }
          : p,
      );
      const extractedAfter = extractAttrs(li.original_input || li.item_name);
      const reason = buildInsertionReason(
        li.family_match || null,
        {
          resolved:      { ...(li.tree_resolution?.resolved || {}), [attribute]: value },
          hasNovelValue: true,
        },
        extractedAfter,
        li.family_members || [],
      );
      const allSatisfied = updatedPills.every(p => p.state !== 'missing' && p.state !== 'conflict');
      updateLine(itemId, {
        attribute_pills:     updatedPills,
        attribute_conflicts: undefined,
        checkmark_ready:     allSatisfied,
        insertion_reason:    reason,
        specification:       buildSpecFromPills(updatedPills),
        tree_resolution: {
          ...(li.tree_resolution || {} as any),
          resolved:      { ...(li.tree_resolution?.resolved || {}), [attribute]: value },
          hasNovelValue: true,
          matchedMember: null,
        } as any,
      });
      return;
    }

    // Family path — the common case. Use the family profile + members + tree
    // walk to figure out whether the new value fully resolves the row.
    if (li.family_profile && li.family_members) {
      const currentResolved = { ...(li.tree_resolution?.resolved || {}), [attribute]: value };
      const extracted       = extractAttrs(li.original_input || li.item_name);
      const mergedExtracted = { ...extracted, ...currentResolved } as any;

      const newResolution = resolveAgainstTree(mergedExtracted, li.family_profile, li.family_members);
      const newPills = buildPills({
        familyMatch:    li.family_match,
        familyProfile:  li.family_profile,
        treeResolution: newResolution,
        regexExtracted: extracted,
      });

      if (newResolution.status === 'fully_resolved' && newResolution.matchedMember) {
        const m         = newResolution.matchedMember;
        const conflicts = detectAttributeConflicts(mergedExtracted, m);

        if (canAutoLink(newResolution as any, conflicts as any)) {
          if (li.resolution_trace) setStatus(li.resolution_trace, 'auto_linked');
          updateLine(itemId, {
            sku_id:              m.sku_id,
            item_name:           m.item_name,
            unit:                m.unit,
            needs_review:        false,
            confidence:          100,
            match_source:        'alias_tree',
            original_input:      li.original_input || li.item_name,
            auto_applied:        true,
            specification:       li.specification?.trim() || buildSpecFromSKU(m),
            auto_apply_reason:   `selected ${humanLabel(attribute)}: ${value}`,
            auto_apply_shown_at: Date.now(),
            attribute_pills:     newPills.map(p => ({ ...p, state: 'satisfied' as const })),
            attribute_conflicts: undefined,
            insertion_reason:    null,
            card_message:        undefined,
            family_match:        undefined,
            family_profile:      undefined,
            family_members:      undefined,
            tree_resolution:     undefined,
            checkmark_ready:     undefined,
            sku_alternatives:    undefined,
          });
          learnAlias(m.sku_id, li.original_input || li.item_name);
          return;
        }

        // Catalog member has a conflicting non-tree attribute. Surface pills.
        const conflictPills = buildConflictPills(li.family_match, m, mergedExtracted, conflicts);
        updateLine(itemId, {
          attribute_pills:     conflictPills,
          attribute_conflicts: conflicts,
          card_message:        buildConflictMessage(conflicts),
          checkmark_ready:     false,
          insertion_reason:    null,
          tree_resolution:     newResolution,
          specification:       buildSpecFromPills(conflictPills),
        });
        return;
      }

      // Novel variant — fully resolved but no exact member. Surface insertion reason.
      if (newResolution.status === 'fully_resolved' && newResolution.hasNovelValue) {
        const novelPills = buildNovelVariantPills(
          li.family_match,
          newResolution.resolved || {},
          li.family_members || [],
          (li.family_profile?.tree_depth || []) as any,
        );
        const reason = buildInsertionReason(
          li.family_match || null,
          newResolution,
          mergedExtracted,
          li.family_members || [],
        );
        updateLine(itemId, {
          tree_resolution:     newResolution,
          attribute_pills:     novelPills,
          checkmark_ready:     true,
          insertion_reason:    reason,
          card_message:        buildNovelMessage(li.family_match, newResolution as any, li.family_members || []),
          attribute_conflicts: undefined,
          specification:       buildSpecFromPills(novelPills),
        });
        return;
      }

      const allSatisfied = newPills.every(p => p.state !== 'missing');
      updateLine(itemId, {
        tree_resolution:     newResolution,
        attribute_pills:     newPills,
        checkmark_ready:     allSatisfied,
        attribute_conflicts: undefined,
        insertion_reason:    null,
        card_message:        buildMissingMessage(li.family_match, newResolution as any),
        specification:       buildSpecFromPills(newPills),
      });
      return;
    }

    // Orphan / AI-only path — no family profile. Toggle the pill itself. When there
    // are no family pills yet, seed from the typed-attr fallback (FIX 10 / B7) so an
    // edit to a fallback field sticks, and add the attribute if it wasn't present.
    const basePills = li.attribute_pills?.length ? li.attribute_pills : pillsFromTypedAttrs(li.typed_attrs);
    let pills = basePills.map(p =>
      p.attribute === attribute
        ? { ...p, value, state: 'satisfied' as const }
        : p,
    );
    if (!pills.some(p => p.attribute === attribute)) {
      pills = [...pills, { attribute, label: humanLabel(attribute), value, state: 'satisfied' as const, editable: true }];
    }
    const allSatisfied = pills.every(p => p.state !== 'missing');
    updateLine(itemId, {
      attribute_pills: pills,
      checkmark_ready: allSatisfied,
      specification:   buildSpecFromPills(pills),
    });
  }

  async function handleCheckmarkCommit(itemId: string) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (!li) return;
    // Refuse to commit while conflicts are unresolved — the user must
    // explicitly choose "use existing" or "add as new" from the conflict pill.
    if (li.attribute_conflicts && li.attribute_conflicts.length > 0) return;

    // Mark the trace as committed before branching — every code path below
    // ends in a successful commit, so finalStatus is uniform.
    if (li.resolution_trace) setStatus(li.resolution_trace, 'committed');

    const resolution = li.tree_resolution;
    const family     = li.family_match;

    if (resolution?.matchedMember) {
      const m = resolution.matchedMember;
      // Existing SKU — no insert. Story should read as "linked".
      if (li.resolution_trace) {
        addStep(li.resolution_trace, { stage: 'commit', input: m.sku_id, result: 'LINKED-EXISTING' });
      }
      const existing = li.attribute_pills?.length
        ? li.attribute_pills.map(p => ({ ...p, state: 'satisfied' as const }))
        : [];
      const enriched = buildLinkedPills(m);
      const have     = new Set(existing.map(p => p.attribute));
      const finalPills = [...existing, ...enriched.filter(p => !have.has(p.attribute))];
      updateLine(itemId, {
        sku_id:              m.sku_id,
        item_name:           m.item_name,
        unit:                m.unit,
        specification:       buildSpecFromSKU(m),
        auto_applied:        true,
        needs_review:        false,
        attribute_pills:     finalPills.length > 0 ? finalPills : undefined,
        family_match:        undefined,
        family_profile:      undefined,
        family_members:      undefined,
        tree_resolution:     undefined,
        checkmark_ready:     undefined,
      });
      learnAlias(m.sku_id, li.original_input || li.item_name);
      return;
    }

    if (family) {
      // Merge tree-resolved values with the satisfied PILL values — the pills carry novel
      // typed sizes/variants the tree couldn't place (see buildPills), so they're included
      // in the new SKU instead of being dropped on commit.
      const pillVals: Record<string, string> = {};
      (li.attribute_pills || []).forEach(p => {
        if (p.value && p.state === 'satisfied' && (p.attribute === 'dimension' || p.attribute === 'variant' || p.attribute === 'grade')) {
          pillVals[p.attribute] = p.value;
        }
      });
      const resolved: any = { ...(resolution?.resolved || {}), ...pillVals };
      // Fall back to the typed attributes for any axis still empty (the display merge is
      // display-only, so a typed value the family tree lacked won't be in the pills).
      (['dimension', 'variant', 'grade'] as const).forEach(a => {
        if (!resolved[a] && (li.typed_attrs as any)?.[a]) resolved[a] = (li.typed_attrs as any)[a];
      });
      const newSpec = [resolved.dimension, resolved.variant, resolved.grade].filter(Boolean).join(' · ');
      // Novel variant — autoAddItemToDictionary inserts a new SKU row.
      // Tag the commit step so the story can say "added new variant".
      if (li.resolution_trace) {
        addStep(li.resolution_trace, { stage: 'commit', input: family.sub_category, result: 'ADDED-NEW-VARIANT' });
      }
      const explicitSkuData = {
        sub_category:  family.sub_category,
        dimension:     resolved.dimension || null,
        variant:       resolved.variant   || null,
        grade:         resolved.grade     || null,
        canonicalName: li.item_name,
        aliases:       [],
        originalName:  li.original_input || li.item_name,
      };
      updateLine(itemId, {
        specification:   li.specification?.trim() || newSpec,
        attribute_pills: li.attribute_pills?.map(p => ({ ...p, state: 'satisfied' as const })),
        family_match:    undefined,
        family_profile:  undefined,
        family_members:  undefined,
        tree_resolution: undefined,
        checkmark_ready: undefined,
      });
      setTimeout(() => autoAddItemToDictionary(itemId, true, explicitSkuData), 50);
      return;
    }

    if (li.aiSuggestion) {
      const attrs = li.aiSuggestion.extracted_attributes;
      // Brand-new item identified by web/AI — autoAddItemToDictionary inserts.
      if (li.resolution_trace) {
        addStep(li.resolution_trace, {
          stage:  'commit',
          input:  li.aiSuggestion.ai_suggested_name || attrs.sub_category || li.item_name,
          result: 'ADDED-NEW-FROM-AI',
        });
      }
      const explicitSkuData = {
        sub_category:  attrs.sub_category,
        dimension:     attrs.dimension,
        variant:       attrs.variant,
        grade:         attrs.grade,
        aliases:       li.aiSuggestion.aliases || [],
        canonicalName: li.aiSuggestion.ai_suggested_name,
        originalName:  li.original_input || li.item_name,
      };
      updateLine(itemId, {
        attribute_pills: li.attribute_pills?.map(p => ({ ...p, state: 'satisfied' as const })),
        checkmark_ready: undefined,
        aiSuggestion:    undefined,
      });
      setTimeout(() => autoAddItemToDictionary(itemId, true, explicitSkuData), 50);
    }
  }

  // ── Single "Add to catalog & use" entry point ──────────────────────────
  // The ONE way to add an unlinked line to the catalog. Three cases:
  //   1. Card already has resolved family/tree/AI context → delegate to the
  //      existing commit engine (links an exact match, or inserts a novel
  //      variant with the resolved attributes — conflicts already gated there).
  //   2. Truly unmatched → classify + insert. We prefer the AI "Did you mean"
  //      name ("Clay Brick") over the raw typo ("ituka") as the catalog name,
  //      passing it as classifyName; the raw text survives as the SKU alias.
  async function handleAddToCatalog(itemId: string) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (!li || li.sku_id) return;
    // Don't commit while an attribute conflict is unresolved (same gate the
    // checkmark commit enforces).
    if (li.attribute_conflicts && li.attribute_conflicts.length > 0) return;

    // Case 1 — resolved context exists: reuse the proven commit path.
    if (li.tree_resolution?.matchedMember || li.family_match || li.aiSuggestion) {
      return handleCheckmarkCommit(itemId);
    }

    // Case 2 — nothing matched. Classify & insert, preferring the DYM name.
    const preferred = li.did_you_mean?.trim() || undefined;
    updateLine(itemId, { did_you_mean: undefined, dym_loading: false, card_message: undefined });
    autoAddItemToDictionary(itemId, true, undefined, preferred);
  }

  async function handleFamilySuggestionClick(itemId: string) {
    // Medium-confidence alias chip click. Run the same pipeline as a
    // high-confidence alias hit — fetch profile + members, token-match,
    // tree-walk, build pills. Either auto-links or shows pills.
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (!li?.family_match) return;
    const topFamily = li.family_match;
    const query     = li.original_input || li.item_name;

    const [membersRes, profileRes] = await Promise.all([
      li.family_members
        ? Promise.resolve({ data: li.family_members })
        : supabase.rpc('get_family_members', { p_category: topFamily.category, p_sub_category: topFamily.sub_category }),
      supabase.rpc('get_sku_family_profile', { p_category: topFamily.category, p_sub_category: topFamily.sub_category }),
    ]);

    const members      = (membersRes.data || []) as any[];
    const profile      = profileRes.data as any;
    const extracted    = extractAttrs(query);
    const tokenMatches = matchTokensAgainstFamily(query, profile?.tree_depth || [], extracted);
    const merged       = { ...extracted, ...(tokenMatches.resolvedAttributes as any) };
    const resolution   = resolveAgainstTree(merged, profile, members);
    const pills        = buildPills({
      familyMatch:    topFamily,
      familyProfile:  profile,
      treeResolution: resolution,
      tokenMatches,
      regexExtracted: extracted,
    });

    // Apply the strict gate: only auto-link if every condition holds.
    if (resolution.status === 'fully_resolved' && resolution.matchedMember) {
      const m         = resolution.matchedMember;
      const conflicts = detectAttributeConflicts(merged, m);

      if (canAutoLink(resolution as any, conflicts as any)) {
        if (li.resolution_trace) setStatus(li.resolution_trace, 'auto_linked');
        updateLine(itemId, {
          sku_id:              m.sku_id,
          item_name:           m.item_name,
          unit:                m.unit,
          needs_review:        false,
          confidence:          100,
          match_source:        'alias_tree',
          original_input:      query,
          auto_applied:        true,
          specification:       li.specification?.trim() || buildSpecFromSKU(m),
          auto_apply_reason:   buildMatchReason(query, { item_name: m.item_name, match_source: 'alias_tree' }),
          auto_apply_shown_at: Date.now(),
          attribute_pills:     pills.map(p => ({ ...p, state: 'satisfied' as const })),
          attribute_conflicts: undefined,
          insertion_reason:    null,
          card_message:        undefined,
          family_match:        undefined,
          family_profile:      undefined,
          family_members:      undefined,
          tree_resolution:     undefined,
          checkmark_ready:     undefined,
          sku_alternatives:    undefined,
        });
        learnAlias(m.sku_id, query);
        return;
      }

      if (conflicts.length > 0) {
        const conflictPills = buildConflictPills(topFamily, m, merged, conflicts);
        updateLine(itemId, {
          family_match:        topFamily,
          family_profile:      profile,
          family_members:      members,
          tree_resolution:     resolution,
          attribute_pills:     conflictPills,
          attribute_conflicts: conflicts,
          card_message:        buildConflictMessage(conflicts),
          checkmark_ready:     false,
          insertion_reason:    null,
          original_input:      query,
          sku_alternatives:    undefined,
        });
        return;
      }
      // matchedMember present but hasNovelValue → treat as novel variant.
    }

    // Novel-value fully_resolved branch.
    if (resolution.status === 'fully_resolved') {
      const novelPills = buildNovelVariantPills(
        topFamily,
        resolution.resolved || {},
        members,
        (profile?.tree_depth || []) as any,
      );
      updateLine(itemId, {
        family_match:        topFamily,
        family_profile:      profile,
        family_members:      members,
        tree_resolution:     resolution,
        attribute_pills:     novelPills,
        attribute_conflicts: undefined,
        insertion_reason:    buildInsertionReason(topFamily, resolution, merged, members),
        card_message:        buildNovelMessage(topFamily, resolution, members),
        checkmark_ready:     true,
        sku_alternatives:    undefined,
      });
      return;
    }

    // partial / unresolved / no_tree → progressive pills.
    const allSatisfied = pills.every(p => p.state !== 'missing');
    updateLine(itemId, {
      family_match:     topFamily,
      family_profile:   profile,
      family_members:   members,
      tree_resolution:  resolution,
      attribute_pills:  pills,
      card_message:     resolution.status === 'no_tree' && members.length > 1
        ? buildMultipleMembersMessage(topFamily, members)
        : buildMissingMessage(topFamily, resolution as any),
      checkmark_ready:  allSatisfied,
      sku_alternatives: undefined,
    });
  }

  interface FinalSkuApprovalPayload {
    sub_category: string;
    dimension: string | null;
    variant: string | null;
    grade: string | null;
    canonicalName: string;
    aliases?: string[];
    p_embedding?: number[];
  }

  const handleApproveParametricSku = async (
    lineItemId: string,
    formValues: FinalSkuApprovalPayload,
    harvestedAliases: string[] = []
  ) => {
    try {
      // Conflict gate (Gap 7): the legacy parametric-review path is still
      // reachable from the doc-upload flow. Before inserting a new SKU,
      // confirm the form values don't disagree with an existing family
      // member the user might have wanted to link to.
      const li = lineItemsRef.current.find(l => l.id === lineItemId);
      if (li?.family_members && li.family_members.length > 0) {
        const userInput = li.original_input || li.item_name;
        const extracted = extractAttrs(userInput);
        // Merge regex-extracted with the form values the user is approving so
        // we compare the FULL picture against catalog members.
        const merged: Partial<ExtractedAttributes> = {
          ...extracted,
          dimension: formValues.dimension || extracted.dimension,
          variant:   formValues.variant   || extracted.variant,
          grade:     formValues.grade     || extracted.grade,
        };
        for (const member of li.family_members) {
          const conflicts = detectAttributeConflicts(merged, member);
          if (conflicts.length > 0) {
            updateLine(lineItemId, {
              attribute_pills:     buildConflictPills(li.family_match || null, member, merged, conflicts),
              attribute_conflicts: conflicts,
              checkmark_ready:     false,
              insertion_reason:    null,
            });
            return;
          }
        }
      }

      // 1. Generate a clean, independent client-side UUID for the new master record
      const newSkuId = crypto.randomUUID();
      
      // ANTI-POLLUTION GUARD: Strip out internal vendor codes or messy formatting strings
      const cleanSubCategory = (formValues.sub_category || "Plumbing Putty / Joint Sealant")
        .replace(/[_\-]/g, ' ')
        .trim();

      // 2. Insert through the semantic guardrail RPC — checks cosine distance before inserting
      //    to prevent near-duplicate SKUs from accumulating in the catalog.
      //    Returns the existing sku_id if a semantic duplicate is found, otherwise the new one.
      const { data: guardResult, error: guardError } = await supabase.rpc('safely_insert_sku_with_guardrail', {
        p_sku_id:        newSkuId,
        p_category:      vendorCategoryToMaterialCategory(selectedVendor?.category || 'General'),
        p_sub_category:  cleanSubCategory,
        p_dimension:     formValues.dimension && formValues.dimension.toLowerCase() !== 'null' ? formValues.dimension.trim() : null,
        p_variant:       formValues.variant && formValues.variant.toLowerCase() !== 'null' ? formValues.variant.trim() : null,
        p_grade:         formValues.grade && formValues.grade.toLowerCase() !== 'null' ? formValues.grade.trim() : null,
        p_aliases:       harvestedAliases,
        p_standard_unit: 'NOS',
        p_embedding:     formValues.p_embedding || null,
      });

      if (guardError) {
        if (guardError.code === '23505') {
          console.warn('Race condition handled: SKU signature already exists. Proceeding with state relink.');
        } else {
          throw guardError;
        }
      }

      // The RPC returns the sku_id that should be linked — either the new one or an existing duplicate.
      const resolvedSkuId = (guardResult as string) || newSkuId;
      if (resolvedSkuId !== newSkuId) {
        console.log(`Guardrail caught semantic duplicate: ${newSkuId} → ${resolvedSkuId}`);
        showSnackbar(`Matched to existing SKU: ${resolvedSkuId}`);
      }

      // 3. RE-LINKING ENGINE: Update local line items state to clear submission gates
      setLineItems((prevLines) =>
        prevLines.map((line) => {
          if (line.id === lineItemId) {
            return {
              ...line,
              sku_id: resolvedSkuId,
              item_name: formValues.canonicalName.toUpperCase().trim(),
              is_verified: true,
              needs_review: false,
              expandedReview: false
            };
          }
          return line;
        })
      );

      console.log(`Pipeline Linked Successfully: Row ${lineItemId} linked to SKU ${resolvedSkuId}`);
      showSnackbar(`✦ SKU Linked: ${formValues.canonicalName.toUpperCase().trim()}`);

      // Learn the user's raw input as an alias on the linked SKU.
      const liNow = lineItemsRef.current.find(l => l.id === lineItemId);
      learnAlias(resolvedSkuId, liNow?.original_input || liNow?.item_name);
    } catch (err: any) {
      console.error('Master Catalog Insertion Pipeline Crashed:', err);
      showSnackbar(`Database Link Failed: ${err.message}`);
    }
  };

  // classifyName (optional): the name to CLASSIFY instead of the raw typed text.
  // Used by "Add to catalog" so the catalog gets the AI "Did you mean" name
  // ("Clay Brick") rather than the vernacular typo ("ituka"). The raw text is
  // still preserved as the SKU alias via original_input/item_name below.
  async function autoAddItemToDictionary(itemId: string, viaAI: boolean = false, explicitSkuData?: any, classifyName?: string) {
    const li = lineItemsRef.current.find(l => l.id === itemId);
    if (!li || li.sku_id || li.item_name.trim().length < 2) return;
    if (dictAddingIds.has(itemId)) return;

    setDictAddingIds(prev => new Set([...prev, itemId]));
    try {
      let sku: any;

      if (explicitSkuData) {
        const category = vendorCategoryToMaterialCategory(selectedVendor?.category || 'General');
        const shortSub = explicitSkuData.sub_category.replace(/[^A-Za-z0-9]/g, '').substring(0, 10).toUpperCase();
        let skuId = `${category.toUpperCase()}-${shortSub}`;
        if (explicitSkuData.dimension) skuId += `-${explicitSkuData.dimension.replace(/[^A-Za-z0-9]/g, '').substring(0, 5).toUpperCase()}`;
        if (explicitSkuData.variant) skuId += `-${explicitSkuData.variant.replace(/[^A-Za-z0-9]/g, '').substring(0, 10).toUpperCase()}`;

        sku = {
          sku_id: skuId,
          category: category,
          sub_category: explicitSkuData.sub_category,
          dimension: explicitSkuData.dimension || null,
          variant: explicitSkuData.variant || null,
          grade: explicitSkuData.grade || null,
          standard_unit: String(li.unit || 'NOS').toUpperCase().trim(),
          aliases: explicitSkuData.aliases || (explicitSkuData.originalName ? [explicitSkuData.originalName] : [])
        };
      } else {
        // Server-side classification — keeps the OpenAI key out of the browser.
        // One-shot silent retry on transient failures (Option A): Edge Function
        // cold start, OpenAI 5xx, malformed GPT JSON. Catalog pollution is the
        // worst outcome of giving up too early, so it's worth one extra second.
        const classifyOnce = async () => {
          const res = await supabase.functions.invoke('sku-matcher', {
            body: {
              action:          'classifyForDictionary',
              item_name:       classifyName?.trim() || li.item_name,
              specification:   li.specification || '',
              vendor_category: selectedVendor?.category || 'unknown',
            },
          });
          if (res.error || !res.data || (res.data as any).error) {
            throw new Error('classifyForDictionary failed');
          }
          return res.data;
        };
        let classified: any;
        try {
          classified = await classifyOnce();
        } catch {
          await new Promise(r => setTimeout(r, 1000));
          try {
            classified = await classifyOnce();
          } catch {
            // Both attempts failed — surface as a service-side failure so the
            // user knows their input wasn't the problem.
            showSnackbar('Couldn\'t reach the AI. Please try again in a moment.');
            updateLine(itemId, { show_custom_fallback: true });
            return;
          }
        }
        sku = classified;
        if (!sku.sku_id || !sku.category || !sku.sub_category) return;
      }

      // ── CRITICAL: structured attributes go to COLUMNS, never aliases ──────────────
      // The user's resolved/selected attribute fields (satisfied pills) and inline-typed
      // attributes (FIX 10) are AUTHORITATIVE — they OVERRIDE the AI's guess and the
      // explicit path's values. Without this, the classify path trusts the model, which
      // can leave dimension/variant/grade NULL (and flatten the attrs into aliases),
      // making the new SKU invisible to faceted tree resolution.
      const fromPills: Record<string, string> = Object.fromEntries(
        (li.attribute_pills || [])
          .filter(p => p.state === 'satisfied' && p.value && p.value.trim()
            && (p.attribute === 'dimension' || p.attribute === 'variant' || p.attribute === 'grade'))
          .map(p => [p.attribute, p.value!.trim()]),
      );
      const ta = li.typed_attrs || ({} as any);
      sku.dimension = fromPills.dimension ?? ta.dimension ?? sku.dimension ?? null;
      sku.variant   = fromPills.variant   ?? ta.variant   ?? sku.variant   ?? null;
      sku.grade     = fromPills.grade     ?? ta.grade     ?? sku.grade     ?? null;
      // Aliases carry the user's RAW phrasing (a synonym for fuzzy matching) — NOT the
      // structured attributes. Keep any AI/explicit synonyms, but guarantee the raw input
      // is present and never let attribute values become the alias.
      const rawPhrasing = (li.original_input || li.item_name || '').trim();
      const existingAliases: string[] = Array.isArray(sku.aliases) ? sku.aliases : [];
      sku.aliases = Array.from(new Set(
        [rawPhrasing, ...existingAliases].filter(a => a && a.trim()),
      ));

      // Normalize unit casing so the catalog stays consistent ("Nos" → "NOS").
      const normalizedUnit = String(sku.standard_unit || li.unit || 'NOS').toUpperCase().trim();

      const { data: guardResult, error } = await supabase.rpc('safely_insert_sku_with_guardrail', {
        p_sku_id:        sku.sku_id,
        p_category:      sku.category,
        p_sub_category:  sku.sub_category,
        p_dimension:     sku.dimension    ?? null,
        p_variant:       sku.variant      ?? null,
        p_grade:         sku.grade        ?? null,
        p_aliases:       sku.aliases      ?? [],
        p_standard_unit: normalizedUnit,
        p_embedding:     explicitSkuData?.p_embedding || null,
      });
      if (error && error.code !== '23505') {
        console.error('SKU insert error:', error);
        showSnackbar('Failed to save this item to catalog. Please try again.');
        return;
      }

      // If guardrail found a semantic duplicate, bind to the existing SKU instead.
      const resolvedSkuId = (guardResult as string) || sku.sku_id;
      if (resolvedSkuId !== sku.sku_id) {
        console.log(`Guardrail caught duplicate in autoAdd: ${sku.sku_id} → ${resolvedSkuId}`);
        sku.sku_id = resolvedSkuId;
      }

      let topSkuId = null;
      let topItemName = null;
      let topUnit = null;

      if (explicitSkuData) {
        // Instant relinking for explicit data bypassing trgm index latency
        topSkuId = sku.sku_id;
        topItemName = explicitSkuData.canonicalName;
        topUnit = sku.standard_unit;
      } else {
        const cats = vendorSKUCategories;
        const params: Record<string, unknown> = { p_search_term: (classifyName?.trim() || li.item_name).trim(), p_limit: 1, p_threshold: SKU_QUERY_THRESHOLD };
        if (cats?.length === 1) params.p_category   = cats[0];
        else if (cats?.length)  params.p_categories = cats;
        const { data: trgmData } = await supabase.rpc('trgm_match_sku', params as any);
        const top = (trgmData as any[])?.[0];
        if (top) {
          topSkuId = top.sku_id;
          topItemName = top.item_name;
          topUnit = top.unit;
        }
      }

      const still = lineItemsRef.current.find(l => l.id === itemId);
      if (topSkuId && still && !still.sku_id) {
        updateLine(itemId, {
          sku_id:            topSkuId,
          item_name:         topItemName,
          unit:              topUnit || still.unit,
          confidence:        100,
          needs_review:      false,
          is_verified:       true,
          match_source:      explicitSkuData ? 'manual' : 'trgm',
          ai_suggested_name: undefined,
          expandedReview:    false
        });
        setDictAddedIds(prev => new Set([...prev, itemId]));
        setTimeout(() => setDictAddedIds(prev => { const n = new Set(prev); n.delete(itemId); return n; }), 4000);
        showSnackbar(`✦ New SKU "${sku.sub_category}" created & assigned`);
        learnAlias(topSkuId, still.original_input || still.item_name);
      }
    } catch (err) {
      console.error('Auto-add to dict failed for', li.item_name, err);
      showSnackbar('Could not classify this item. Try a more specific description.');
      updateLine(itemId, { show_custom_fallback: true, isGeneratingAiChip: false });
    } finally {
      setDictAddingIds(prev => { const n = new Set(prev); n.delete(itemId); return n; });
    }
  }

  const subtotal      = sum(lineItems.map(li => li.basic_amount));
  const totalDiscount = sum(lineItems.map(li => li.discount_amount));
  const totalGST      = sum(lineItems.map(li => li.cgst + li.sgst));
  const grandTotal    = sum(lineItems.map(li => li.total_amount));

  function handleProjectChange(pid: string) {
    setProjectId(pid);
    const proj = projects?.find(p => p.project_id === pid);
    if (proj?.site_location) setDeliveryLocation(proj.site_location);
  }

  const saveMutation = useMutation({
    mutationFn: async (status: string): Promise<string> => {
      if (!vendorId)     throw new Error('Please select a vendor');
      if (!projectId)    throw new Error('Please select a project');
      if (!lineItems.length || !lineItems.some(li => li.item_name.trim())) {
        throw new Error('Please add at least one line item');
      }

      const terms = paymentTermsDays === -1 ? parseInt(customTerms) || 30 : paymentTermsDays;

      const legacyItems = lineItems.map(li => ({
        description: li.item_name,
        qty: li.quantity_ordered,
        unit: li.unit,
        rate: li.unit_rate,
        amount: li.total_amount,
      }));

      const poData = {
        org_id:              orgId,
        project_id:          projectId,
        stakeholder_id:      vendorId,
        items:               legacyItems,
        order_value:         subtotal - totalDiscount,
        total_value:         grandTotal,
        gst_value:           totalGST,
        status,
        date_issued:         orderedDate,
        expected_delivery:   expectedDelivery || null,
        delivery_location:   deliveryLocation || null,
        payment_terms_days:  terms,
        ordered_by:          orderedBy || null,
        vendor_notes:        vendorNotes || null,
        internal_notes:      internalNotes || null,
        created_by:          session.user.id,
      };

      const lineItemRows = lineItems
        .filter(li => li.item_name.trim())
        .map(li => ({
          line_number:       li.line_number,
          category_id:       li.category_id || null,
          item_name:         li.item_name,
          // Fall back to the typed attributes so an unmatched line still saves its
          // size/variant/grade (FIX 10 / B8).
          specification:     (li.specification?.trim() || specFromTypedAttrs(li.typed_attrs)) || null,
          unit:              li.unit,
          quantity_ordered:  li.quantity_ordered,
          unit_rate:         li.unit_rate,
          basic_amount:      li.basic_amount,
          discount_percent:  li.discount_percent,
          discount_amount:   li.discount_amount,
          gst_rate:          li.gst_rate,
          cgst:              li.cgst,
          sgst:              li.sgst,
          igst:              0,
          total_amount:      li.total_amount,
          sku_id:            li.sku_id || null,
          brand:             li.brand?.trim() || null,   // order metadata — SKU stays generic
        }));

      const { data, error: rpcError } = await supabase.rpc('create_purchase_order', {
        p_po_data:    poData,
        p_line_items: lineItemRows,
      });
      if (rpcError) throw rpcError;
      if (!data?.success) throw new Error(data?.error ?? 'Failed to create purchase order');

      return data.po_id as string;
    },
    onSuccess: (generatedPoId) => {
      qc.invalidateQueries({ queryKey: ['purchase_orders_enhanced'] });
      showSnackbar(`PO ${generatedPoId} created`);
      // ui/new-po-redesign (decision 1): the ONE sanctioned behavior change.
      // Was: navigate(...) immediately. Now the ceremony opens and the EXISTING
      // navigate (identical args) fires from the ceremony's onLeave. Error path
      // is completely unchanged.
      setUiCeremonyOpen(true);
    },
    onError: (err: any) => {
      showSnackbar(err.message || 'Failed to save', { type: 'error' });
    },
  });

  const createVendor = useMutation({
    mutationFn: async () => {
      if (!newVendorName.trim()) throw new Error('Vendor name is required');
      const resolvedCategory =
        newVendorCategory === OTHER_TRADE
          ? (newVendorCategoryOther.trim() || 'Other')
          : newVendorCategory;
      if (!resolvedCategory) throw new Error('Category is required');
      const payload = {
        stakeholder_id: `STK-${Math.floor(1000 + Math.random() * 9000)}`,
        name:     newVendorName.trim(),
        type:     'Vendor',
        category: resolvedCategory,
        gstin:    newVendorGstin.trim() || undefined,
        org_id:   orgId,
      };
      const { data, error } = await supabase.from('stakeholders').insert([payload]).select().single();
      if (error) throw error;
      return data as any;
    },
    onSuccess: (v) => {
      qc.invalidateQueries({ queryKey: ['vendors_all'] });
      setVendorId(v.stakeholder_id);
      setSelectedVendor(v);
      setVendorSearch('');
      setShowVendorResults(false);
      try {
        const prev: string[] = JSON.parse(localStorage.getItem('briklay_recent_vendors') || '[]');
        const next = [v.stakeholder_id, ...prev.filter(id => id !== v.stakeholder_id)].slice(0, 10);
        localStorage.setItem('briklay_recent_vendors', JSON.stringify(next));
      } catch { /* ignore */ }
      setShowVendorCreate(false);
      setShowVendorSug(false);
      setNewVendorName('');
      setNewVendorCategory('');
      setNewVendorCategoryOther('');
      setNewVendorGstin('');
      showSnackbar(`Vendor "${v.name}" created`);
    },
    onError: (err: any) => showSnackbar(err.message || 'Failed to create vendor', { type: 'error' }),
  });

  async function handleDocumentUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setDocExtracting(true);
    setDocExtractError(null);
    try {
      const result = await matchSKUsFromFile(file, 'po_creation', selectedVendor?.category);
      if (result.error) {
        setDocExtractError(result.error);
        return;
      }
      const base = lineItems.filter(l => l.item_name.trim()).length;
      // Never auto-select from a bill: bring each extracted line in UNLINKED (raw name as read
      // off the bill, no sku_id, no auto-add) — then run resolution so its match(es) surface in
      // the dropdown for the user to pick, exactly like a typed item.
      const newItems = result.items.map((item, i) => {
        const rawName = capFirst(item.item_name ?? item.sku_name ?? '');
        const spec = (item as any).specification ?? null;
        // The doc's size / variant / grade come back on the `specification` string — parse them
        // out so the Size/Variant/Grade columns fill (prefer any structured fields if present).
        const a = extractAttrs(`${rawName} ${spec ?? ''}`.trim());
        const dimension = (item as any).dimension ?? a.dimension ?? null;
        const variant   = (item as any).variant   ?? a.variant   ?? null;
        const grade     = (item as any).grade     ?? a.grade     ?? null;
        return computeLine({
          ...newLine(base + i + 1),
          item_name:        rawName,
          unit:             item.unit ?? 'Nos',
          quantity_ordered: item.quantity ?? 1,
          specification:    spec,
          typed_attrs:      { dimension, variant, grade },
        });
      });
      setLineItems(prev => [...prev.filter(l => l.item_name.trim()), ...newItems]);
      showSnackbar(`${newItems.length} item${newItems.length !== 1 ? 's' : ''} extracted`);
      if (poMatchMode === 'typed') {
        // Use-as-typed mode: keep extracted items exactly as read; no catalog matching.
        newItems.filter(li => li.item_name.trim().length >= 2).forEach(li => updateLine(li.id, { skipped_linking: true }));
      } else {
        newItems
          .filter(li => li.item_name.trim().length >= 2)
          .forEach(li => {
            noAutoOpenRef.current.add(li.id);   // ready the match, but don't pop every dropdown at once
            // Seed resolution with the parsed size/variant/grade so the match respects them.
            setTimeout(() => { const raw = li.item_name; startFreshResolution(li.id, raw, raw, li.typed_attrs ?? extractAttrs(raw)); }, 300);
          });
      }
    } catch (err: any) {
      console.error('[handleDocumentUpload]', err);
      setDocExtractError(err?.message || 'Failed to process document. Try again.');
    } finally {
      setDocExtracting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleSubmit(status: string) {
    setIsGlobalMatching(true);
    // Everything runs inside try/finally so the full-screen "Matching items…" overlay
    // ALWAYS comes down — a thrown RPC/network error here used to strand the user on a
    // spinner forever with no message. Now it closes and the error is shown.
    try {
    let hasUnresolved = false;
    const updatedLines = [...lineItems];

    for (let i = 0; i < updatedLines.length; i++) {
      const li = updatedLines[i];
      // Skipped items pass through — the user made an explicit choice.
      if (li.skipped_linking) continue;
      if (li.item_name.trim() && !li.sku_id) {
        // Resolution rethink: at submit time we still surface suggestions
        // for the user, but we NEVER auto-link from trgm. The item is
        // flagged as needing a SKU — the user must either pick a chip,
        // explicitly Skip, or correct the input.
        const cats = vendorSKUCategories;
        const rpcParams: Record<string, unknown> = {
          p_search_term: li.item_name.trim(),
          p_limit: 8,
          p_threshold: SKU_QUERY_THRESHOLD,
        };
        if (cats && cats.length === 1) rpcParams.p_category = cats[0];
        else if (cats && cats.length > 1) rpcParams.p_categories = cats;

        const { data, error } = await supabase.rpc('trgm_match_sku', rpcParams as any);
        const candidates = (!error && Array.isArray(data) ? data : []) as SKUResult[];
        const visible = candidates.filter(c => c.similarity > SKU_CHIP_DISPLAY).slice(0, 3);
        hasUnresolved = true;
        updatedLines[i] = {
          ...li,
          needs_sku_badge:  true,
          sku_alternatives: visible.length > 0 ? visible : (li.sku_alternatives ?? undefined),
          card_message:     visible.length > 0 ? buildSuggestionMessage() : li.card_message,
        };
      }
    }

    if (hasUnresolved) {
      setLineItems(updatedLines);
      setSkuResolutionMode(true);
      const firstUnresolved = updatedLines.find(li => li.needs_sku_badge);
      if (firstUnresolved) {
        setActiveCardId(firstUnresolved.id);
        // Defer scroll one frame so the badge DOM exists.
        requestAnimationFrame(() => {
          const el = document.getElementById(`line-item-${firstUnresolved.id}`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
      const count = updatedLines.filter(li => li.needs_sku_badge).length;
      showSnackbar(`${count} item${count > 1 ? 's' : ''} need SKU linking before saving.`);
      return;
    }

    setLineItems(updatedLines);
    saveMutation.mutate(status);
    } catch (e: any) {
      showSnackbar(e?.message || 'Something went wrong preparing the order. Please try again.', { type: 'error' });
    } finally {
      setIsGlobalMatching(false);
    }
  }

  return (
    <>
      {/* Global matching overlay — unchanged from the card design. */}
      {isGlobalMatching && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-white/40 backdrop-blur-xl transition-all duration-300">
          <div className="relative flex items-center justify-center mb-6">
            <div className="absolute inset-0 rounded-full bg-blue-500/10 animate-ping scale-150 duration-1000" />
            <div className="p-5 bg-white shadow-xl rounded-2xl border border-slate-100 text-blue-600">
              <span className="material-symbols-outlined text-4xl animate-pulse">auto_awesome</span>
            </div>
          </div>
          <h3 className="text-xl font-semibold text-slate-800 tracking-tight mb-2">Matching items…</h3>
          <p className="text-sm text-slate-500 max-w-sm text-center mb-6 leading-relaxed">
            Finding the best catalog match for each line. This only takes a moment.
          </p>
          <div className="w-48 h-1.5 bg-slate-100 rounded-full overflow-hidden relative">
            <div className="absolute top-0 bottom-0 left-0 bg-gradient-to-r from-blue-500 to-indigo-600 rounded-full animate-[loading_1.5s_infinite_ease-in-out]" style={{ width: '40%' }} />
          </div>
          <style>{`
            @keyframes loading { 0% { transform: translateX(-100%); } 100% { transform: translateX(250%); } }
            .explanation-lifecycle { animation: explanation-lifecycle 8.6s linear forwards; }
            @keyframes explanation-lifecycle {
              0%, 3.5% { opacity: 0; transform: translateY(4px); }
              7%   { opacity: 1; transform: translateY(0); }
              94%  { opacity: 1; transform: translateY(0); }
              100% { opacity: 0; transform: translateY(0); }
            }
            @media (prefers-reduced-motion: reduce) {
              .animate-glass-breathe { animation: none !important; }
              .explanation-lifecycle { animation: none !important; opacity: 1; }
            }
          `}</style>
        </div>
      )}

      <div
        className="px-4 md:px-6 pt-6 pb-36 mx-auto"
        style={{ maxWidth: '100%', background: '#FBF9F6' }}
        onClick={(e) => {
          if (!(e.target as HTMLElement).closest('.po-sheet-row') && !(e.target as HTMLElement).closest('.po-row-expansion')) {
            setActiveCardId(null);
          }
        }}
        onKeyDown={(e) => {
          // Ctrl/Cmd + Enter creates the order (advertised in the help line).
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && canSubmit && !saveMutation.isPending) {
            e.preventDefault();
            handleSubmit('ORDERED');
          }
        }}
      >
        {/* ── Header ─────────────────────────────────────────────── */}
        <div className="flex items-center gap-3 mb-6">
          <button
            onClick={() => navigate(returnTo)}
            className="p-2 -ml-2 rounded-xl transition-colors"
            style={{ color: uiV.user }}
            aria-label="Back"
          >
            <span className="material-symbols-outlined text-[22px]">arrow_back</span>
          </button>
          <h1 className="flex-1 text-[26px] leading-none" style={{ color: uiV.user, fontFamily: "Georgia, 'Times New Roman', serif" }}>
            New purchase order
          </h1>
          <span
            className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs whitespace-nowrap"
            style={{ background: uiV.surface, border: `1px solid ${uiV.line}`, color: uiV.system }}
          >
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: uiV.accent }} />
            <span style={{ color: uiV.systemFaint }}>Auto-generated</span>
            <span style={{ color: uiV.user, ...uiNums }}>
              {selectedProjectObj?.project_code ? `PO-${selectedProjectObj.project_code}-…` : 'PO-—'}
            </span>
          </span>
        </div>

        {/* Place a PO, or request quotes from vendors first */}
        <div className="flex gap-1 p-1 rounded-xl mb-5 w-max" style={{ background: uiV.surface, border: `1px solid ${uiV.line}` }}>
          {([['po', 'Place PO'], ['rfq', 'Request quotes']] as const).map(([m, label]) => (
            <button key={m} type="button" onClick={() => setPoMode(m)}
              className="px-4 py-2 rounded-lg text-sm font-medium transition-colors"
              style={poMode === m ? { background: uiV.accent, color: '#fff' } : { color: uiV.system }}>
              {label}
            </button>
          ))}
        </div>

        {/* ── Order details ──────────────────────────────────────── */}
        <SheetSectionLabel title="Order details" />
        <div className="rounded-2xl overflow-hidden mb-2" style={{ border: `1px solid ${uiV.line}`, background: uiV.surface }}>
          {/* Row 1: Vendor | Project */}
          <div className="grid" style={{ gridTemplateColumns: '116px minmax(0,1fr) 116px minmax(0,1fr)', borderBottom: `1px solid ${uiV.line}` }}>
            <div className="flex items-center px-3.5 py-3 text-[13px]" style={{ background: uiV.field, borderRight: `1px solid ${uiV.line}`, color: uiV.system }}>Vendor</div>
            <div className="relative flex items-center">
              {selectedVendor && !showVendorResults && !vendorSearch ? (
                <div className="flex items-center gap-2.5 w-full px-3.5 py-2.5">
                  <div className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-medium shrink-0" style={{ background: uiV.field, color: uiV.system }}>
                    {getInitials(selectedVendor.name)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[14px] font-medium truncate" style={{ color: uiV.user }}>{selectedVendor.name}</p>
                    <p className="text-[11px] truncate" style={{ color: uiV.systemFaint }}>{selectedVendor.category}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => { setSelectedVendor(null); setVendorId(''); setVendorSearch(''); setShowVendorResults(true); window.setTimeout(() => vendorSearchRef.current?.focus(), 0); }}
                    className="shrink-0 w-6 h-6 rounded-full flex items-center justify-center"
                    style={{ color: uiV.systemFaint }}
                    aria-label="Clear vendor"
                  >
                    <span className="material-symbols-outlined text-[15px]">close</span>
                  </button>
                </div>
              ) : (
                <>
                  <input
                    ref={vendorSearchRef}
                    type="text"
                    value={vendorSearch}
                    onChange={(e) => { setVendorSearch(e.target.value); setShowVendorResults(true); }}
                    onFocus={() => setShowVendorResults(true)}
                    onBlur={() => window.setTimeout(() => setShowVendorResults(false), 180)}
                    placeholder="Search vendor…"
                    className="w-full px-3.5 py-3 text-[14px] bg-transparent outline-none"
                    style={{ color: uiV.user }}
                  />
                  {vendorHint && !selectedVendor && (
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-bold uppercase tracking-wider animate-pulse pointer-events-none" style={{ color: uiV.accent }}>Select first</span>
                  )}
                </>
              )}
              {/* Vendor results dropdown — portalled to <body> so the order-details card's
                  overflow-hidden can never clip it (it was getting buried inside the cell). */}
              {showVendorResults && vendorSearch.trim().length > 0 && vendorSearchRef.current && createPortal((() => {
                const rect = vendorSearchRef.current!.getBoundingClientRect();
                return (
                <div className="rounded-xl max-h-[280px] overflow-y-auto" style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 60, background: uiV.surface, border: `1px solid ${uiV.line}`, boxShadow: '0 16px 40px rgba(30,26,21,0.18)' }}>
                  {(() => {
                    const hasMatches = filteredVendors.length > 0;
                    const typed = vendorSearch.trim();
                    const openCreate = () => { setNewVendorName(typed); setShowVendorCreate(true); setShowVendorResults(false); };
                    return (
                      <>
                        {!hasMatches && (
                          <button type="button" onMouseDown={openCreate} className="group w-full flex items-center gap-3 px-4 py-3.5 text-left" style={{ background: uiV.accentSoft }}>
                            <div className="w-8 h-8 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0" style={{ background: uiV.accent, color: '#fff' }}>{typed ? getInitials(typed) : '+'}</div>
                            <div className="flex-1 min-w-0">
                              <p className="text-[14px] font-semibold truncate" style={{ color: uiV.user }}>{typed ? <>Create “{typed}”</> : 'Add a new vendor'}</p>
                              <p className="text-[12px]" style={{ color: uiV.systemFaint }}>New vendor · add category &amp; GSTIN</p>
                            </div>
                            <span className="material-symbols-outlined text-[18px]" style={{ color: uiV.accent }}>arrow_forward</span>
                          </button>
                        )}
                        {hasMatches && filteredVendors.slice(0, 12).map((v: any) => (
                          <button key={v.stakeholder_id} type="button" onMouseDown={() => selectVendor(v)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:brightness-[0.98]" style={{ borderBottom: `1px solid ${uiV.line}55` }}>
                            <div className="w-7 h-7 rounded-full flex items-center justify-center text-[12px] font-bold shrink-0" style={{ background: uiV.field, color: uiV.system }}>{getInitials(v.name)}</div>
                            <div className="min-w-0">
                              <p className="text-[14px] font-medium truncate" style={{ color: uiV.user }}>{v.name}</p>
                              <p className="text-[12px] truncate" style={{ color: uiV.systemFaint }}>{v.category}</p>
                            </div>
                          </button>
                        ))}
                        {hasMatches && (
                          <button type="button" onMouseDown={openCreate} className="w-full flex items-center gap-2 px-4 py-3 text-left" style={{ color: uiV.accent, borderTop: `1px solid ${uiV.line}` }}>
                            <span className="material-symbols-outlined text-[18px]">add</span>
                            <span className="text-[13px] font-medium">{typed ? <>Not listed? Add “{typed}”</> : 'Add a new vendor'}</span>
                          </button>
                        )}
                      </>
                    );
                  })()}
                </div>
                );
              })(), document.body)}
            </div>
            <div className="flex items-center px-3.5 py-3 text-[13px]" style={{ background: uiV.field, borderLeft: `1px solid ${uiV.line}`, borderRight: `1px solid ${uiV.line}`, color: uiV.system }}>Project</div>
            <div className="relative flex items-center">
              <select
                value={projectId}
                onChange={(e) => handleProjectChange(e.target.value)}
                className="w-full appearance-none px-3.5 py-3 pr-9 text-[14px] bg-transparent outline-none cursor-pointer"
                style={{ color: projectId ? uiV.user : uiV.systemFaint }}
              >
                <option value="" disabled>Choose project</option>
                {(projects || []).map((p: any) => (
                  <option key={p.project_id} value={p.project_id} style={{ color: uiV.user }}>{p.name}</option>
                ))}
              </select>
              <span className="material-symbols-outlined absolute right-3 top-1/2 -translate-y-1/2 text-[20px] pointer-events-none" style={{ color: uiV.systemFaint }}>expand_more</span>
            </div>
          </div>
          {/* Row 2: Order date | Deliver to */}
          <div className="grid" style={{ gridTemplateColumns: '116px minmax(0,1fr) 116px minmax(0,1fr)' }}>
            <div className="flex items-center px-3.5 py-3 text-[13px]" style={{ background: uiV.field, borderRight: `1px solid ${uiV.line}`, color: uiV.system }}>Order date</div>
            <div className="flex items-center">
              <input
                type="date"
                value={orderedDate}
                onChange={(e) => setOrderedDate(e.target.value)}
                className="w-full px-3.5 py-3 text-[14px] bg-transparent outline-none"
                style={{ color: uiV.user }}
              />
            </div>
            <div className="flex items-center px-3.5 py-3 text-[13px]" style={{ background: uiV.field, borderLeft: `1px solid ${uiV.line}`, borderRight: `1px solid ${uiV.line}`, color: uiV.system }}>Deliver to</div>
            <div className="flex items-center">
              <input
                type="text"
                value={deliveryLocation}
                onChange={(e) => setDeliveryLocation(e.target.value)}
                placeholder="Site address (auto-fills from project)"
                className="w-full px-3.5 py-3 text-[14px] bg-transparent outline-none placeholder:font-normal"
                style={{ color: uiV.user }}
              />
            </div>
          </div>
        </div>

        {/* Inline new-vendor form (unchanged behaviour) */}
        {showVendorCreate && (
          <div className="p-4 rounded-xl space-y-3 mb-4" style={{ background: uiV.field, border: `1px solid ${uiV.accentLine}` }}>
            <p className="text-[11px] font-bold uppercase tracking-wider" style={{ color: uiV.accent }}>New vendor</p>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: uiV.system }}>Name *</label>
              <input autoFocus className="bk-input text-[13px]" placeholder="Vendor / company name" value={newVendorName} onChange={(e) => setNewVendorName(e.target.value)} />
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: uiV.system }}>Category *</label>
              <select className="bk-input text-[13px]" value={newVendorCategory} onChange={(e) => { setNewVendorCategory(e.target.value); setNewVendorCategoryOther(''); }}>
                <option value="" disabled>Select category…</option>
                {VENDOR_TRADE_GROUPS.map((g: any) => (
                  <optgroup key={g.group} label={g.group}>
                    {g.trades.map((t: string) => <option key={t} value={t}>{t}</option>)}
                  </optgroup>
                ))}
              </select>
              {newVendorCategory === OTHER_TRADE && (
                <input autoFocus className="bk-input text-[13px] mt-2" placeholder="Specify category…" value={newVendorCategoryOther} onChange={(e) => setNewVendorCategoryOther(e.target.value)} />
              )}
            </div>
            <div>
              <label className="text-[10px] font-bold uppercase tracking-wider block mb-1" style={{ color: uiV.system }}>GSTIN</label>
              <input className="bk-input text-[13px] font-data-mono" placeholder="Optional" value={newVendorGstin} onChange={(e) => setNewVendorGstin(e.target.value)} />
            </div>
            <div className="flex gap-2 pt-1">
              <button type="button" onClick={() => { setShowVendorCreate(false); setNewVendorName(''); setNewVendorCategory(''); setNewVendorCategoryOther(''); setNewVendorGstin(''); }} className="text-[12px] px-3 py-1.5 rounded-lg" style={{ border: `1px solid ${uiV.line}`, color: uiV.system }}>Cancel</button>
              <button type="button" onClick={() => createVendor.mutate()} disabled={!newVendorName.trim() || !newVendorCategory || (newVendorCategory === OTHER_TRADE && !newVendorCategoryOther.trim()) || createVendor.isPending} className="text-[12px] px-4 py-1.5 rounded-lg flex items-center gap-1.5 disabled:opacity-50" style={{ background: uiV.accent, color: '#fff' }}>
                {createVendor.isPending ? 'Saving…' : 'Create & select'}
                <span className="material-symbols-outlined text-[14px]">check</span>
              </button>
            </div>
          </div>
        )}

        {/* ── Items ──────────────────────────────────────────────── */}
        <div className="mt-6">
          <SheetSectionLabel
            title="Items"
            right={(
              <div className="inline-flex items-center gap-2 flex-wrap justify-end">
                {/* PO-wide: match every item to the catalog, or use them all exactly as typed. */}
                <div className="inline-flex rounded-lg p-0.5" style={{ background: uiV.field, border: `1px solid ${uiV.line}` }}>
                  <Tip text="Recommended — standardise each item against your catalog, so spend stays consistent and is easy to track & report.">
                    <button
                      type="button"
                      onClick={() => setMatchMode('catalog')}
                      className="text-[11.5px] font-semibold px-2.5 py-1 rounded-md transition-all"
                      style={poMatchMode === 'catalog'
                        ? { background: uiV.surface, color: uiV.accentDeep, boxShadow: '0 1px 2px rgba(0,0,0,.08)' }
                        : { background: 'transparent', color: uiV.systemFaint }}
                    >
                      Match to catalog
                    </button>
                  </Tip>
                  <Tip text="For item lists that aren't in your catalog — keep everything exactly as typed, without linking.">
                    <button
                      type="button"
                      onClick={() => setMatchMode('typed')}
                      className="text-[11.5px] font-semibold px-2.5 py-1 rounded-md transition-all"
                      style={poMatchMode === 'typed'
                        ? { background: uiV.surface, color: uiV.accentDeep, boxShadow: '0 1px 2px rgba(0,0,0,.08)' }
                        : { background: 'transparent', color: uiV.systemFaint }}
                    >
                      Use as typed
                    </button>
                  </Tip>
                </div>
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="inline-flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg active:scale-95 transition-all hover:brightness-95"
                  style={{ color: uiV.accentDeep, border: `1px solid ${uiV.accentLine}`, background: uiV.accentSoft }}
                  title="Upload a quotation or bill — AI extracts items"
                >
                  <span className="material-symbols-outlined text-[16px]">document_scanner</span>
                  <span className="hidden sm:inline">Scan bill / quote</span>
                </button>
              </div>
            )}
          />
        </div>

        <input ref={fileInputRef} type="file" accept="image/*,.pdf,.txt" onChange={handleDocumentUpload} style={{ display: 'none' }} />
        {docExtracting && (
          <div className="flex items-center gap-3 rounded-xl px-4 py-3 mb-3" style={{ background: uiV.field, border: `1px solid ${uiV.line}` }}>
            <span className="material-symbols-outlined text-[18px] animate-spin shrink-0" style={{ color: uiV.systemFaint }}>progress_activity</span>
            <div>
              <div className="text-[13px] font-medium" style={{ color: uiV.userSoft }}>Reading document…</div>
              <div className="text-[11px] mt-0.5" style={{ color: uiV.systemFaint }}>Extracting items and matching to SKU library</div>
            </div>
          </div>
        )}
        {docExtractError && (
          <div className="flex items-center gap-2 rounded-lg px-3 py-2.5 text-[12px] mb-3" style={{ background: '#FDECEC', border: '1px solid #F6D2D2', color: '#B4231F' }}>
            <span className="material-symbols-outlined text-[14px]">error</span>
            {docExtractError}
          </div>
        )}

        {/* The sheet */}
        <div
          className="rounded-2xl overflow-hidden"
          style={{ border: `1px solid ${uiV.line}`, background: uiV.surface }}
          onFocusCapture={(e) => {
            // Focusing an item cell with no vendor bounces up to the vendor field, guided not hidden.
            if (!vendorId && (e.target as HTMLElement).tagName === 'INPUT' && (e.target as HTMLElement).getAttribute('data-po-item') === '1') {
              setVendorHint(true);
              vendorSearchRef.current?.focus();
            }
          }}
        >
          <div className="overflow-x-auto">
            <table className="w-full" style={{ borderCollapse: 'collapse', minWidth: 860 }}>
              <thead>
                <tr style={{ background: uiV.field }}>
                  {[
                    { k: 'n', t: '#', w: 44, a: 'left' },
                    { k: 'item', t: 'Item', w: undefined, a: 'left' },
                    { k: 'dim', t: 'Size / dimension', w: 130, a: 'left' },
                    { k: 'var', t: 'Variant / type', w: 120, a: 'left' },
                    { k: 'grd', t: 'Grade', w: 90, a: 'left' },
                    { k: 'qty', t: 'Qty', w: 64, a: 'right' },
                    { k: 'unit', t: 'Unit', w: 74, a: 'left' },
                    { k: 'rate', t: 'Rate', w: 96, a: 'right' },
                    { k: 'amt', t: 'Amount', w: 104, a: 'right' },
                    { k: 'del', t: '', w: 40, a: 'left' },
                  ].map((c) => (
                    <th
                      key={c.k}
                      className="px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[0.04em]"
                      style={{ width: c.w, textAlign: c.a as any, color: uiV.systemFaint, borderBottom: `1px solid ${uiV.line}` }}
                    >
                      {c.t}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {lineItems.map((li, rowIdx) => {
                  const hasPills          = !!li.attribute_pills && li.attribute_pills.length > 0;
                  const showOrphanContext = !li.family_match && !!li.web_variants && li.web_variants.length > 0;
                  const anyPanel          = hasPills || showOrphanContext;
                  const isSuccess         = aiJustMatchedIds.has(li.id);
                  const isActive          = activeCardId === li.id;

                  // Read-only mirror of the resolved / typed attributes for the sheet cells.
                  const rowPills = (li.attribute_pills && li.attribute_pills.length)
                    ? mergeTypedAttrsIntoPills(li.attribute_pills, li.typed_attrs)
                    : pillsFromTypedAttrs(li.typed_attrs);
                  const pv = (a: string) => rowPills.find((p: any) => p.attribute === a && p.value)?.value || null;
                  const dimVal = pv('dimension');
                  const varVal = pv('variant');
                  const grdVal = pv('grade');
                  const amount = (li.quantity_ordered || 0) * (li.unit_rate || 0);
                  const cell = { borderBottom: `1px solid ${isActive ? 'transparent' : uiV.line}`, verticalAlign: 'middle' as const };
                  const dash = <span style={{ color: uiV.systemFaint }}>—</span>;

                  return (
                    <React.Fragment key={li.id}>
                      <tr
                        id={`line-item-${li.id}`}
                        className="po-sheet-row group"
                        onClick={() => setActiveCardId(li.id)}
                        style={{ background: li.needs_sku_badge ? '#FDF3F2' : isSuccess ? uiV.confirmWash : isActive ? '#FCFBFA' : uiV.surface }}
                      >
                        {/* # + linked dot */}
                        <td className="px-3 py-2.5" style={cell}>
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] tabular-nums" style={{ color: uiV.systemFaint }}>{li.line_number}</span>
                            <span
                              className="w-1.5 h-1.5 rounded-full shrink-0"
                              title={li.sku_id ? 'Linked to your catalogue' : 'Not linked'}
                              style={{ background: li.sku_id ? uiV.confirm : uiV.line }}
                            />
                          </div>
                        </td>

                        {/* Item name */}
                        <td className="px-3 py-2" style={cell}>
                          <div className="relative" ref={(el) => { if (el) itemRefs.current.set(li.id, el); else itemRefs.current.delete(li.id); }}>
                            <input
                              data-po-item="1"
                              className="w-full text-[14px] font-medium bg-transparent border-0 px-0 py-1 outline-none placeholder:font-normal"
                              style={{ color: uiV.user }}
                              placeholder="Type item name…"
                              value={li.item_name}
                              onFocus={() => {
                                setActiveCardId(li.id);
                                clearTimeout(aiMatchDebounceRef.current[li.id]);
                                if (li.searchResults && li.searchResults.length > 0) updateLine(li.id, { showDropdown: true });
                              }}
                              onChange={(e) => {
                                const val = capFirst(e.target.value);
                                clearTimeout(aiMatchDebounceRef.current[li.id]);
                                // "Use as typed" mode: keep exactly what's typed, no catalog matching.
                                if (poMatchMode === 'typed') {
                                  const ta = extractAttrs(val);
                                  updateLine(li.id, {
                                    item_name: val, sku_id: null, skipped_linking: val.trim().length > 0,
                                    showDropdown: false, searchResults: [], did_you_mean: undefined,
                                    dym_loading: false, card_message: undefined, needs_sku_badge: false,
                                    typed_attrs: { dimension: ta.dimension ?? null, variant: ta.variant ?? null, grade: ta.grade ?? null },
                                  });
                                  return;
                                }
                                const prevText = li.dismissed ? (li.original_input ?? li.item_name) : li.item_name;
                                const textChanged = val !== prevText;
                                const wasCleared = val.trim().length <= 2;
                                const patch: Partial<DraftLineItem> = {
                                  item_name: val, sku_id: null, ai_suggested_name: undefined,
                                  sku_alternatives: undefined, aiSuggestion: undefined,
                                  auto_applied: false, original_input: undefined,
                                  searchCancelled: false, auto_apply_reason: undefined,
                                  attribute_pills: undefined, checkmark_ready: undefined,
                                  family_match: undefined, family_profile: undefined, family_members: undefined,
                                  tree_resolution: undefined, pending_families: undefined,
                                  show_custom_fallback: false, sku_match_skipped: false,
                                  resolution_source: undefined, resolution_trace: undefined,
                                  skip_trgm_on_re_search: false, attribute_conflicts: undefined,
                                  insertion_reason: null, needs_sku_badge: false, user_selected: false,
                                  pre_auto_spec: undefined, skipped_linking: false, isSearching: false,
                                  search_stage: null, card_message: undefined, did_you_mean: undefined, dym_loading: false,
                                };
                                const ta = extractAttrs(val);
                                patch.typed_attrs = { dimension: ta.dimension ?? null, variant: ta.variant ?? null, grade: ta.grade ?? null };
                                const detectedBrand = detectBrandInInput(val, lineBrandCategory(li));
                                if (detectedBrand && !(li.brand && li.brand.trim())) patch.brand = detectedBrand;
                                if (wasCleared) { patch.dismissed_sku_ids = []; patch.typed_attrs = undefined; }
                                if (li.isGeneratingAiChip) { patch.isGeneratingAiChip = false; patch.searchCancelled = true; }
                                if (li.dismissed && textChanged) patch.dismissed = false;
                                updateLine(li.id, patch);
                                if (li.dismissed && !textChanged) return;
                                searchSKUs(li.id, val);
                                if (val.trim().length >= 3) fireDidYouMean(li.id, val);
                              }}
                              onBlur={() => { setTimeout(() => updateLine(li.id, { showDropdown: false }), 200); clearTimeout(aiMatchDebounceRef.current[li.id]); }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey && li.item_name.trim().length > 0) {
                                  e.preventDefault();
                                  (e.currentTarget as HTMLInputElement).blur();
                                  addLine();
                                  requestAnimationFrame(() => {
                                    const rows = document.querySelectorAll('.po-sheet-row');
                                    const last = rows[rows.length - 1] as HTMLElement | undefined;
                                    const next = last?.querySelector<HTMLInputElement>('input[data-po-item="1"]');
                                    next?.focus();
                                  });
                                }
                              }}
                            />
                            {/* SKU dropdown (portals to body, anchored to this input) */}
                            {li.showDropdown && li.searchResults && li.searchResults.length > 0 && (() => {
                              const triggerEl = itemRefs.current.get(li.id);
                              if (!triggerEl) return null;
                              const rect = triggerEl.getBoundingClientRect();
                              return createPortal(
                                <div className="z-40" style={{ position: 'fixed', top: rect.bottom + 6, left: rect.left, width: Math.max(rect.width, 300), borderRadius: 12, overflow: 'hidden', maxHeight: 320, overflowY: 'auto', background: uiV.surface, border: `1px solid ${uiV.line}`, boxShadow: '0 18px 44px rgba(30,26,21,0.20)' }}>
                                  <style>{`
                                    @keyframes poSpin{to{transform:rotate(360deg)}}
                                    .po-pick{transition:background .14s ease, transform .1s ease}
                                    .po-pick:hover{background:${uiV.field} !important}
                                    .po-pick:active{transform:scale(.985)}
                                    .po-typed{transition:background .14s ease, border-color .14s ease, transform .1s ease, box-shadow .14s ease}
                                    .po-typed:hover{background:${uiV.confirmWash} !important;border-color:${uiV.confirm} !important;box-shadow:0 6px 16px -8px rgba(47,93,52,.5)}
                                    .po-typed:active{transform:scale(.97)}
                                    .po-spin{width:13px;height:13px;border-radius:50%;border:2px solid rgba(0,0,0,.15);border-top-color:${uiV.confirm};display:inline-block;animation:poSpin .7s linear infinite;flex-shrink:0}
                                  `}</style>
                                  <div style={{ padding: '7px 11px 5px', fontSize: 9, fontWeight: 700, color: uiV.systemFaint, textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: `1px solid ${uiV.line}` }}>
                                    Catalog matches — pick one to link
                                  </div>
                                  {li.searchResults.map((sku: any, si: number) => {
                                    const busy = committing?.id === li.id && committing.kind === 'link' && committing.skuId === sku.sku_id;
                                    return (
                                    <div key={sku.sku_id} className="po-pick" role="button" tabIndex={0}
                                      title={`Link this line to “${memberChipLabel(sku)}” in your catalog`}
                                      onMouseDown={(e) => commitPick(li.id, sku, e)}
                                      style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px', cursor: 'pointer', borderBottom: si < li.searchResults.length - 1 ? `1px solid ${uiV.line}55` : 'none', background: si === 0 ? 'rgba(47,93,52,0.06)' : 'transparent', opacity: committing && !busy ? 0.5 : 1 }}
                                    >
                                      {busy ? <span className="po-spin" /> : (si === 0 ? <span className="material-symbols-outlined" style={{ fontSize: 14, color: uiV.confirm, flexShrink: 0 }}>star</span> : <span style={{ width: 14, flexShrink: 0 }} />)}
                                      <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{ fontSize: 12.5, fontWeight: si === 0 ? 600 : 400, color: uiV.user, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{memberChipLabel(sku)}</div>
                                        <div style={{ fontSize: 9.5, color: uiV.systemFaint, marginTop: 1, fontFamily: 'monospace' }}>{busy ? 'Linking…' : `${sku.sku_id} · ${sku.unit}`}</div>
                                      </div>
                                      {!busy && <span style={{ fontSize: 10, padding: '1px 6px', borderRadius: 20, fontWeight: 600, flexShrink: 0, background: sku.similarity >= 0.75 ? '#DCFCE7' : sku.similarity >= 0.5 ? '#DBEAFE' : '#FEF9C3', color: sku.similarity >= 0.75 ? '#16A34A' : sku.similarity >= 0.5 ? '#1D4ED8' : '#A16207' }}>
                                        {Math.round(sku.similarity * 100)}%
                                      </span>}
                                    </div>
                                    );
                                  })}
                                  {/* Use as typed — an EQUAL, first-class action: keep exactly what you typed, no catalog link. */}
                                  {(() => {
                                    const busy = committing?.id === li.id && committing.kind === 'typed';
                                    return (
                                      <div style={{ padding: 8, borderTop: `1px solid ${uiV.line}`, background: uiV.field }}>
                                        <button type="button" className="po-typed"
                                          title="Keep exactly what you typed — don’t link it to the catalog"
                                          onMouseDown={(e) => commitUseAsTyped(li.id, e)}
                                          style={{ width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '9px 12px', borderRadius: 9, border: `1px solid ${uiV.line}`, background: uiV.surface, color: uiV.user, fontSize: 12.5, fontWeight: 600, cursor: 'pointer', opacity: committing && !busy ? 0.5 : 1 }}
                                        >
                                          {busy
                                            ? <><span className="po-spin" /> Using…</>
                                            : <><span className="material-symbols-outlined" style={{ fontSize: 15 }}>edit_note</span> Use “{li.item_name.trim()}” as typed</>}
                                        </button>
                                      </div>
                                    );
                                  })()}
                                </div>,
                                document.body,
                              );
                            })()}
                          </div>
                        </td>

                        {/* Size / Variant / Grade — editable (write to typed_attrs; feeds the spec). */}
                        <td className="px-3 py-2" style={cell}>
                          <input aria-label="Size" className="w-full text-[13px] bg-transparent border-0 px-0 py-1 outline-none placeholder:font-normal" style={{ color: uiV.userSoft }} placeholder="—" value={dimVal || ''} onFocus={() => setActiveCardId(li.id)} onChange={(e) => setTypedAttr(li.id, 'dimension', e.target.value)} />
                        </td>
                        <td className="px-3 py-2" style={cell}>
                          <input aria-label="Variant" className="w-full text-[13px] bg-transparent border-0 px-0 py-1 outline-none placeholder:font-normal" style={{ color: uiV.userSoft }} placeholder="—" value={varVal || ''} onFocus={() => setActiveCardId(li.id)} onChange={(e) => setTypedAttr(li.id, 'variant', e.target.value)} />
                        </td>
                        <td className="px-3 py-2" style={cell}>
                          <input aria-label="Grade" className="w-full text-[13px] bg-transparent border-0 px-0 py-1 outline-none placeholder:font-normal" style={{ color: uiV.userSoft }} placeholder="—" value={grdVal || ''} onFocus={() => setActiveCardId(li.id)} onChange={(e) => setTypedAttr(li.id, 'grade', e.target.value)} />
                        </td>

                        {/* Qty */}
                        <td className="px-2 py-2" style={{ ...cell, textAlign: 'right' }}>
                          <input
                            type="number" min="1" aria-label="Quantity"
                            className="w-full text-[13px] font-medium bg-transparent border-0 outline-none text-right tabular-nums"
                            style={{ color: uiV.user }}
                            value={li.quantity_ordered}
                            onFocus={() => dismissExplanation(li.id)}
                            onChange={(e) => updateLine(li.id, { quantity_ordered: parseFloat(e.target.value) || 0 })}
                          />
                        </td>

                        {/* Unit */}
                        <td className="px-2 py-2" style={cell}>
                          <div className="relative">
                            <select
                              aria-label="Unit"
                              className="w-full appearance-none bg-transparent border-0 outline-none text-[12px] pr-4 cursor-pointer uppercase tracking-wide"
                              style={{ color: uiV.system }}
                              value={li.unit}
                              onChange={(e) => updateLine(li.id, { unit: e.target.value })}
                            >
                              {(UNITS.includes(li.unit) ? UNITS : [li.unit, ...UNITS]).map((u) => <option key={u} value={u}>{u}</option>)}
                            </select>
                            <span className="material-symbols-outlined absolute right-0 top-1/2 -translate-y-1/2 text-[15px] pointer-events-none" style={{ color: uiV.systemFaint }}>expand_more</span>
                          </div>
                        </td>

                        {/* Rate */}
                        <td className="px-2 py-2" style={{ ...cell, textAlign: 'right' }}>
                          <div className="relative flex items-center">
                            <span className="text-[12px] mr-0.5" style={{ color: uiV.systemFaint }}>₹</span>
                            <input
                              type="number" min="0" step="0.01" aria-label="Rate"
                              className="w-full text-[13px] font-medium bg-transparent border-0 outline-none text-right tabular-nums placeholder:font-normal"
                              style={{ color: uiV.user }}
                              placeholder="rate"
                              value={li.unit_rate || ''}
                              onFocus={() => dismissExplanation(li.id)}
                              onChange={(e) => updateLine(li.id, { unit_rate: parseFloat(e.target.value) || 0 })}
                            />
                          </div>
                        </td>

                        {/* Amount */}
                        <td className="px-3 py-2.5 text-[13px] font-semibold tabular-nums text-right" style={{ ...cell, color: uiV.user }}>
                          {amount > 0 ? `₹${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}` : dash}
                        </td>

                        {/* Delete */}
                        <td className="px-2 py-2 text-center" style={cell}>
                          <button
                            type="button"
                            onClick={(e) => { e.stopPropagation(); removeLine(li.id); }}
                            className="material-symbols-outlined text-[16px] opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ color: uiV.systemFaint }}
                            title="Remove line"
                          >
                            delete
                          </button>
                        </td>
                      </tr>

                      {/* Expansion — the full resolution UI for the active row */}
                      {isActive && li.item_name.trim().length > 0 && (
                        <tr className="po-row-expansion">
                          <td colSpan={10} style={{ borderBottom: `1px solid ${uiV.line}`, background: '#FCFBFA' }}>
                            <div className="px-4 py-3 pl-12">
                              {/* Did you mean */}
                              {(() => {
                                const dym = li.did_you_mean?.trim();
                                // When the "Catalog matches" dropdown already carries picks, that's the single
                                // surface — don't also show a "Did you mean?" for the same line.
                                const hide = li.sku_id || li.sku_match_skipped || li.skipped_linking || li.dismissed || (li.searchResults && li.searchResults.length > 0);
                                if (hide) return null;
                                if (li.dym_loading && !dym) {
                                  return (
                                    <div className="mb-2 flex items-center gap-2">
                                      <span className="material-symbols-outlined text-[13px] animate-spin" style={{ color: uiV.systemFaint }}>progress_activity</span>
                                      <span className="text-[12px]" style={{ color: uiV.systemFaint }}>Identifying…</span>
                                    </div>
                                  );
                                }
                                if (!dym) return null;
                                if (dym.toLowerCase() === li.item_name.trim().toLowerCase()) return null;
                                const uiHigher =
                                  (!!li.pending_families?.length && !li.sku_id && !li.skipped_linking && !li.dismissed && !li.sku_match_skipped)
                                  || (!li.sku_id && !dictAddingIds.has(li.id) && !anyPanel && (li.sku_alternatives?.length ?? 0) > 0);
                                if (uiHigher) {
                                  return <UiDemotedSuggestion name={dym} onPick={() => { const raw = li.item_name; startFreshResolution(li.id, dym, raw, extractAttrs(raw)); }} />;
                                }
                                return (
                                  <div className="mb-2 flex items-center gap-2 flex-wrap">
                                    <span className="text-[12px]" style={{ color: uiV.systemFaint }}>Did you mean</span>
                                    <button
                                      type="button"
                                      onMouseDown={(e) => { e.preventDefault(); const raw = li.item_name; startFreshResolution(li.id, dym, raw, extractAttrs(raw)); }}
                                      className="text-[13px] underline underline-offset-2"
                                      style={{ color: uiV.accent }}
                                    >
                                      {dym}
                                    </button>
                                    <span className="text-[12px]" style={{ color: uiV.systemFaint }}>?</span>
                                  </div>
                                );
                              })()}

                              {/* Family disambiguation */}
                              {(() => {
                                const fams = li.pending_families;
                                if (!fams?.length) return null;
                                if (li.sku_id || li.skipped_linking || li.dismissed || li.sku_match_skipped) return null;
                                return (
                                  <>
                                    <UiResolutionStrip questionEn={<>“{li.item_name.trim()}” matches more than one catalog family — which one?</>}>
                                      <div className="flex gap-2.5 flex-wrap">
                                        {fams.map((fam: any) => (
                                          <button
                                            key={`${fam.category}::${fam.sub_category}`}
                                            type="button"
                                            onMouseDown={(e) => { e.preventDefault(); handlePillSelection(li.id, 'family', `${fam.category}::${fam.sub_category}`); }}
                                            className="text-left rounded-xl px-3.5 py-2.5 transition-transform active:scale-[0.98]"
                                            style={{ background: uiV.surface, border: `1px solid ${uiV.askLine}` }}
                                          >
                                            <span className="text-sm font-medium" style={{ color: uiV.askDeep }}>{fam.sub_category}</span>
                                          </button>
                                        ))}
                                      </div>
                                    </UiResolutionStrip>
                                    <UiStripEscapes term={li.item_name.trim()} onUseAsTyped={() => handleSkipWithoutLinking(li.id)} onAddNew={() => handleAddToCatalog(li.id)} />
                                  </>
                                );
                              })()}

                              {/* Attribute editor + Brand. The Size/Variant/Grade editor duplicates the
                                  sheet columns, so it appears ONLY while a decision is pending (a pill in
                                  missing/conflict/suggested state — i.e. family disambiguation). Once
                                  satisfied or linked, the columns carry the values and the strip is gone.
                                  Brand is order metadata (not a column), so it renders on its own, always. */}
                              {(() => {
                                const familyPills = li.attribute_pills || [];
                                const basePills = familyPills.length ? mergeTypedAttrsIntoPills(familyPills, li.typed_attrs) : pillsFromTypedAttrs(li.typed_attrs);
                                const novelSet = new Set(li.tree_resolution?.novelAttributes || []);
                                const displayPills = novelSet.size ? basePills.map((p: any) => (novelSet.has(p.attribute) ? { ...p, isNovel: true } : p)) : basePills;
                                const needsAttrHost = !li.sku_id && displayPills.some((p: any) => p.state === 'missing' || p.state === 'conflict' || p.state === 'suggested');
                                if (!needsAttrHost) return null;
                                return (
                                  <UiAttributeFieldsHost
                                    pills={displayPills}
                                    onSelectOption={(attribute: any, value: any) => handlePillSelection(li.id, attribute, value)}
                                    onCustomValue={(attribute: any, value: any) => handlePillSelection(li.id, attribute, value)}
                                    onConfirmSuggestion={() => handleFamilySuggestionClick(li.id)}
                                    familyName={li.family_match?.sub_category}
                                    familySize={li.family_match?.family_size}
                                    isOrphan={!li.family_match && (showOrphanContext || !!li.aiSuggestion)}
                                    disabled={!li.item_name?.trim() || li.item_name.trim().length < 2}
                                  />
                                );
                              })()}

                              {/* Mapping explanation */}
                              {li.auto_applied && li.auto_apply_reason && (
                                <MappingExplanation originalInput={li.original_input || ''} canonicalName={li.item_name} reason={li.auto_apply_reason} />
                              )}

                              {/* Family suggestion */}
                              {li.family_match && !li.sku_id && !li.tree_resolution && !hasPills && (
                                <div className="flex items-center justify-between mt-2.5 px-3 py-2 rounded-lg" style={{ background: uiV.field, border: `1px solid ${uiV.line}` }}>
                                  <div className="flex items-center gap-2 min-w-0">
                                    <span className="material-symbols-outlined text-[16px] shrink-0" style={{ color: uiV.accent }}>label</span>
                                    <span className="text-[12px] truncate" style={{ color: uiV.system }}>
                                      Closest catalog match:{' '}
                                      <button type="button" className="font-semibold hover:underline" style={{ color: uiV.accent }} onClick={() => handleFamilySuggestionClick(li.id)}>{li.family_match.sub_category}</button>
                                    </span>
                                  </div>
                                  <button type="button" onClick={() => handleFamilySuggestionClick(li.id)} className="text-[11px] flex items-center gap-0.5 shrink-0 ml-2" style={{ color: uiV.accent }}>
                                    Show variants<span className="material-symbols-outlined text-[14px]">arrow_forward</span>
                                  </button>
                                </div>
                              )}

                              {/* Catalogue + AI chips */}
                              {(() => {
                                const dbCandidates = li.sku_alternatives || [];
                                const shouldShowDbChips = !li.sku_id && !dictAddingIds.has(li.id) && !anyPanel && dbCandidates.length > 0;
                                const shouldShowAiChip = !li.sku_id && !dictAddingIds.has(li.id) && !anyPanel;
                                if (!shouldShowDbChips && !shouldShowAiChip) return null;
                                return (
                                  <div className="mt-2.5 flex flex-wrap gap-2 items-center">
                                    {shouldShowDbChips && dbCandidates.length > 0 && (
                                      <span className="text-[9px] font-bold mr-0.5 uppercase tracking-widest flex items-center gap-0.5" style={{ color: uiV.systemFaint }}>
                                        <span className="material-symbols-outlined text-[11px]">database</span> Catalogue matches:
                                      </span>
                                    )}
                                    {shouldShowDbChips && dbCandidates.slice(0, 3).map((chip: any) => {
                                      const low = chip.similarity < SKU_CHIP_DISPLAY;
                                      return (
                                        <button key={chip.sku_id} type="button" onClick={() => handleChipClick(li.id, chip)} title={chip.item_name}
                                          className="px-3 py-1.5 text-xs font-medium rounded-full border transition-colors"
                                          style={{ background: low ? uiV.field : uiV.surface, color: low ? uiV.systemFaint : uiV.userSoft, borderColor: uiV.line }}>
                                          {memberChipLabel(chip)}{low ? ' ?' : ''}
                                        </button>
                                      );
                                    })}
                                    {shouldShowAiChip && li.aiSuggestion && !li.isGeneratingAiChip && (
                                      <button
                                        type="button"
                                        onClick={() => {
                                          const attrs = li.aiSuggestion!.extracted_attributes;
                                          if (li.aiSuggestion!.validation_metrics?.passes_shop_floor_test) {
                                            const originalInput = li.item_name;
                                            const finalData = { sub_category: attrs.sub_category, dimension: attrs.dimension, variant: attrs.variant, grade: attrs.grade, aliases: li.aiSuggestion!.aliases || [], originalName: originalInput };
                                            updateLine(li.id, { item_name: li.aiSuggestion!.ai_suggested_name, aiSuggestion: undefined, needs_review: false });
                                            setTimeout(() => autoAddItemToDictionary(li.id, true, finalData), 100);
                                            return;
                                          }
                                          const PLACEHOLDER_VALS = new Set(['', 'null', 'n/a', 'none', 'generic', 'standard', 'default']);
                                          const looksPlaceholder = (v: unknown) => !v || PLACEHOLDER_VALS.has(String(v).toLowerCase().trim());
                                          const newPills: PillData[] = [];
                                          if (attrs.sub_category) newPills.push({ attribute: 'sub_category', label: 'Item', value: attrs.sub_category, state: 'satisfied', source: 'ai' });
                                          const missingParams = li.aiSuggestion!.validation_metrics?.missing_parameters || [];
                                          for (const attr of ['dimension', 'variant', 'grade'] as const) {
                                            const val = (attrs as any)[attr];
                                            if (!looksPlaceholder(val)) newPills.push({ attribute: attr, label: humanLabel(attr), value: String(val), state: 'satisfied', source: 'ai', editable: true });
                                            else if (missingParams.includes(attr)) newPills.push({ attribute: attr, label: humanLabel(attr), value: null, state: 'missing', options: [] });
                                          }
                                          updateLine(li.id, { attribute_pills: newPills, checkmark_ready: newPills.every((p) => p.state !== 'missing'), aiSuggestion: li.aiSuggestion, expandedReview: false });
                                        }}
                                        className="px-3 py-1.5 text-xs font-semibold rounded-full flex items-center gap-1 transition-all"
                                        style={{ background: uiV.askWash, color: uiV.askDeep, border: `1px solid ${uiV.askLine}` }}
                                      >
                                        <span className="material-symbols-outlined text-xs">auto_awesome</span>
                                        {(() => {
                                          const attrs = li.aiSuggestion!.extracted_attributes;
                                          const parts: string[] = [];
                                          if (attrs.dimension && attrs.dimension.toLowerCase() !== 'null' && attrs.dimension.trim() !== '') parts.push(attrs.dimension.trim());
                                          if (attrs.grade && attrs.grade.toLowerCase() !== 'null' && attrs.grade.trim() !== '') parts.push(attrs.grade.trim());
                                          if (attrs.sub_category && attrs.sub_category.toLowerCase() !== 'null' && attrs.sub_category.trim() !== '') parts.push(attrs.sub_category.trim());
                                          let baseName = parts.join(' ').toUpperCase();
                                          if (attrs.variant && attrs.variant.toLowerCase() !== 'null' && attrs.variant.trim() !== '') baseName += ` (${attrs.variant.trim().toUpperCase()})`;
                                          return baseName.replace(/\s+/g, ' ').trim();
                                        })()}
                                      </button>
                                    )}
                                  </div>
                                );
                              })()}

                              {/* Stop (long AI stage) */}
                              {(li.search_stage === 'checking_ai' || li.search_stage === 'ai_analyzing') && !li.sku_id && !li.searchCancelled && (
                                <div className="flex mt-2 py-1">
                                  <button type="button" onClick={(e) => { e.stopPropagation(); clearTimeout(aiMatchDebounceRef.current[li.id]); updateLine(li.id, { isGeneratingAiChip: false, isSearching: false, searchCancelled: true, search_stage: null, show_custom_fallback: true }); }} className="text-[11px] ml-auto" style={{ color: uiV.systemFaint }}>
                                    Stop
                                  </button>
                                </div>
                              )}

                              {/* Service line */}
                              {li.sku_match_skipped && !li.sku_id && (
                                <span className="text-[10px] italic" style={{ color: uiV.systemFaint }}>Service item — no SKU matching</span>
                              )}

                              {/* Insertion reasoning */}
                              {li.insertion_reason && li.checkmark_ready && !li.sku_id && (
                                <div className="flex items-start gap-2 px-3 py-2 rounded-lg mt-2" style={{ background: '#EEF4FB' }}>
                                  <span className="material-symbols-outlined text-[14px] mt-0.5 shrink-0" style={{ color: '#6B8FB8' }}>info</span>
                                  <p className="text-[11px] leading-relaxed" style={{ color: '#4E6B8A' }}>{li.insertion_reason.message}</p>
                                </div>
                              )}

                              {/* Submit-validation badge */}
                              {li.needs_sku_badge && !li.sku_id && (
                                <div className="flex items-center gap-2 px-3 py-2 rounded-lg mt-2" style={{ background: '#FDECEC', border: '1px solid #F6D2D2' }}>
                                  <span className="material-symbols-outlined text-[14px] shrink-0" style={{ color: '#D14343' }}>error</span>
                                  <span className="text-[12px] font-medium" style={{ color: '#B4231F' }}>Link to a SKU before saving</span>
                                </div>
                              )}

                              {/* Skipped */}
                              {li.skipped_linking && !li.sku_id && (
                                <span className="text-[11px] italic" style={{ color: uiV.systemFaint }}>Using as typed</span>
                              )}

                              {/* Card message */}
                              {li.card_message && !li.sku_id && !li.skipped_linking && (
                                <p className="text-[12px] leading-relaxed mt-1.5" style={{ color: li.card_message.type === 'conflict' ? '#B4231F' : (li.card_message.type === 'novel' || li.card_message.type === 'identified') ? '#4E6B8A' : uiV.system }}>
                                  {li.card_message.text}
                                </p>
                              )}

                              {/* Action footer — two first-class buttons with hover / click / loading /
                                  success (+ celebrate) states. */}
                              {!li.sku_id && !li.skipped_linking && li.item_name.trim().length >= 2 && (() => {
                                const mine      = committing?.id === li.id ? committing : null;
                                const usingBusy = mine?.kind === 'typed' && mine.phase === 'loading';
                                const usingDone = mine?.kind === 'typed' && mine.phase === 'done';
                                const addBusy   = mine?.kind === 'add'   && mine.phase === 'loading';
                                const addDone   = mine?.kind === 'add'   && mine.phase === 'done';
                                const anyBusy   = !!mine;
                                const conflicted = (li.attribute_conflicts?.length ?? 0) > 0;
                                return (
                                <div className="flex items-center justify-end gap-2.5 mt-2.5">
                                  <style>{`
                                    .po-fbtn{transition:background .15s ease,border-color .15s ease,color .15s ease,transform .1s ease,box-shadow .15s ease}
                                    .po-fbtn:not(:disabled):active{transform:scale(.96)}
                                    .po-fbtn:disabled{cursor:default}
                                    .po-useb:not(:disabled):hover{background:${uiV.field} !important;border-color:${uiV.lineStrong} !important;color:${uiV.user} !important}
                                    .po-addb:not(:disabled):hover{background:${uiV.accent} !important;color:#fff !important;border-color:${uiV.accent} !important;box-shadow:0 6px 16px -8px rgba(196,97,58,.55)}
                                    @keyframes poFSpin{to{transform:rotate(360deg)}}
                                    .po-fspin{width:13px;height:13px;border-radius:50%;border:2px solid currentColor;border-right-color:transparent;display:inline-block;animation:poFSpin .7s linear infinite}
                                  `}</style>
                                  <button
                                    type="button"
                                    disabled={anyBusy}
                                    onClick={(e) => { e.stopPropagation(); commitUseAsTyped(li.id, e); }}
                                    className="po-fbtn po-useb inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-[12px] font-semibold"
                                    style={usingDone
                                      ? { background: uiV.confirmWash, border: `1px solid ${uiV.confirm}`, color: uiV.confirm }
                                      : { background: uiV.surface, border: `1px solid ${uiV.line}`, color: uiV.system, opacity: anyBusy && !usingBusy ? 0.5 : 1 }}
                                    title="Keep this item with the text you typed — don't link to the catalog"
                                  >
                                    {usingDone
                                      ? <><span className="material-symbols-outlined text-[14px]">check_circle</span> Kept as typed</>
                                      : usingBusy
                                        ? <><span className="po-fspin" /> Using…</>
                                        : <><span className="material-symbols-outlined text-[14px]">edit_note</span> Use as typed</>}
                                  </button>
                                  <button
                                    type="button"
                                    disabled={anyBusy || conflicted}
                                    onClick={(e) => commitAddToCatalog(li.id, e)}
                                    className="po-fbtn po-addb inline-flex items-center gap-1.5 px-4 py-1.5 rounded-lg text-[12px] font-semibold disabled:opacity-40 disabled:cursor-not-allowed"
                                    style={addDone
                                      ? { background: uiV.confirmWash, color: uiV.confirm, border: `1px solid ${uiV.confirm}` }
                                      : { background: uiV.accentSoft, color: uiV.accentDeep, border: `1px solid ${uiV.accentLine}`, opacity: anyBusy && !addBusy ? 0.5 : undefined }}
                                    title={conflicted ? 'Resolve the attribute conflict first' : 'Add this item to the catalog and link it'}
                                  >
                                    {addDone
                                      ? <><span className="material-symbols-outlined text-[14px]">check_circle</span> Added</>
                                      : addBusy
                                        ? <><span className="po-fspin" /> Adding…</>
                                        : <><span className="material-symbols-outlined text-[14px]">add_circle</span> Add to catalog &amp; use</>}
                                  </button>
                                </div>
                                );
                              })()}

                              {/* Resolution story */}
                              {(() => {
                                const story = buildResolutionStory(li.resolution_trace, li.original_input);
                                if (!story) return null;
                                return (
                                  <div className="flex items-start gap-1.5 mt-2 pt-2" style={{ borderTop: `1px solid ${uiV.line}` }}>
                                    <span className="material-symbols-outlined text-[13px] mt-px shrink-0" style={{ color: uiV.accent }}>info</span>
                                    <p className="text-[11px] leading-relaxed" style={{ color: uiV.system }}>
                                      <span style={{ color: uiV.systemFaint }}>How this was matched: </span>{story}
                                    </p>
                                  </div>
                                );
                              })()}
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}

                {/* Add row */}
                <tr>
                  <td colSpan={10}>
                    <button onClick={addLine} className="w-full flex items-center justify-center gap-2 py-3 text-[13px] font-medium transition-colors hover:brightness-95" style={{ color: uiV.accentDeep, background: uiV.surface }}>
                      <span className="material-symbols-outlined text-[16px]">add</span>
                      Add row
                      <Kbd>Enter</Kbd>
                      <span style={{ color: uiV.systemFaint }}>on the last row also adds one</span>
                    </button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>

        {/* Help line + summary */}
        <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mt-4">
          <p className="text-[12px] leading-relaxed max-w-md" style={{ color: uiV.systemFaint }}>
            Move with <Kbd>Tab</Kbd> / <Kbd>Enter</Kbd> like a sheet. A green dot means the item is linked to your
            catalogue, so stock and rates carry over. <Kbd>Ctrl</Kbd> + <Kbd>Enter</Kbd> creates the order.
          </p>
          <div className="w-full md:w-[320px] shrink-0 rounded-2xl p-4" style={{ background: uiV.surface, border: `1px solid ${uiV.line}` }}>
            <div className="flex items-center justify-between">
              <span className="text-[13px]" style={{ color: uiV.system }}>Subtotal</span>
              <span className="text-[14px] font-medium tabular-nums" style={{ color: uiV.user }}>₹{subtotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex items-center justify-between mt-3">
              <button
                type="button"
                role="switch"
                aria-checked={gstOn}
                onClick={() => toggleGlobalGst(!gstOn)}
                className="flex items-center gap-2.5"
              >
                <span className="relative inline-flex items-center rounded-full transition-colors" style={{ width: 34, height: 20, background: gstOn ? uiV.accent : uiV.line }}>
                  <span className="absolute rounded-full bg-white transition-transform" style={{ width: 16, height: 16, top: 2, left: 2, transform: gstOn ? 'translateX(14px)' : 'translateX(0)' }} />
                </span>
                <span className="text-[13px]" style={{ color: uiV.system }}>GST 18%</span>
              </button>
              <span className="text-[14px] font-medium tabular-nums" style={{ color: uiV.user }}>₹{totalGST.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </div>
            <div className="flex items-center justify-between mt-3 pt-3" style={{ borderTop: `1px solid ${uiV.line}` }}>
              <span className="text-[14px] font-semibold" style={{ color: uiV.user }}>Total</span>
              <span className="text-[16px] font-bold tabular-nums" style={{ color: uiV.user }}>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sticky footer bar ──────────────────────────────────── */}
      <div className="fixed bottom-0 left-0 right-0 z-40" style={{ background: 'rgba(251,250,248,0.96)', backdropFilter: 'blur(12px)', borderTop: `1px solid ${uiV.line}`, paddingBottom: 'calc(env(safe-area-inset-bottom, 0px) + 10px)' }}>
        <div className="flex items-center justify-between gap-3 px-4 md:px-6 py-3 mx-auto" style={{ maxWidth: '100%' }}>
          <div className="flex items-baseline gap-2">
            <span className="text-[13px]" style={{ color: uiV.system }}>
              {lineItems.filter((li) => li.item_name.trim()).length} item{lineItems.filter((li) => li.item_name.trim()).length !== 1 ? 's' : ''}
            </span>
            <span className="text-[14px] font-semibold tabular-nums" style={{ color: uiV.user }}>₹{grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}</span>
          </div>
          {poMode === 'rfq' ? (
            <div className="flex items-center gap-4">
              {(() => {
                const canRfq = !!projectId && lineItems.some(li => li.item_name.trim().length > 0);
                return (
                  <button
                    type="button"
                    onClick={() => setShowRfq(true)}
                    disabled={!canRfq}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold transition-all disabled:cursor-not-allowed"
                    style={{ background: canRfq ? uiV.accent : uiV.line, color: canRfq ? '#fff' : uiV.systemFaint }}
                    title={!projectId ? 'Select a project' : 'Add at least one item'}
                  >
                    <span className="material-symbols-outlined text-[16px]">forward_to_inbox</span>Request quotes
                  </button>
                );
              })()}
            </div>
          ) : (
          <div className="flex items-center gap-4">
            <button
              type="button"
              onClick={() => handleSubmit('DRAFT')}
              disabled={saveMutation.isPending || isGlobalMatching}
              className="text-[14px] font-medium transition-colors disabled:opacity-50"
              style={{ color: uiV.system }}
            >
              Save draft
            </button>
            <button
              type="button"
              onClick={() => handleSubmit('ORDERED')}
              disabled={!canSubmit || saveMutation.isPending || isGlobalMatching}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-[14px] font-semibold transition-all disabled:cursor-not-allowed"
              style={{ background: canSubmit && !saveMutation.isPending ? uiV.accent : uiV.line, color: canSubmit && !saveMutation.isPending ? '#fff' : uiV.systemFaint }}
              title={!canSubmit ? (!vendorId ? 'Select a vendor' : !projectId ? 'Select a project' : 'Add at least one item') : undefined}
            >
              {saveMutation.isPending ? (
                <><span className="material-symbols-outlined text-[16px] animate-spin">progress_activity</span>Saving</>
              ) : (
                <><span className="material-symbols-outlined text-[16px]">check</span>Create purchase order</>
              )}
            </button>
          </div>
          )}
        </div>
      </div>

      {showRfq && (
        <RequestQuotesModal
          orgId={orgId ?? ''}
          projectId={projectId || null}
          deliveryLocation={deliveryLocation || null}
          tradeCategory={selectedVendor?.category ?? ((lineItems.find(li => (li as any).category) as any)?.category ?? null)}
          items={lineItems.filter(li => li.item_name.trim().length > 0).map((li, i) => ({ line: i + 1, item_name: li.item_name, unit: (li as any).unit, qty: (li as any).quantity_ordered, spec: (li as any).specification }))}
          onClose={() => setShowRfq(false)}
          onSent={() => { setShowRfq(false); navigate('/purchase-orders'); }}
        />
      )}

      {/* Save ceremony — unchanged */}
      <UiSaveCeremony
        open={uiCeremonyOpen}
        poId={saveMutation.data}
        vendorName={selectedVendor?.name}
        vendorId={selectedVendor?.stakeholder_id}
        vendorContact={selectedVendor?.contact}
        projectName={selectedProjectObj?.name}
        totalLabel={`₹${grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`}
        onLeave={() => navigate(returnTo)}
      />
    </>
  );
}
