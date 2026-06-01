// Frontend brand/stop-word filter. Mirrors the Edge Function's BRAND_NAMES
// (supabase/functions/sku-matcher/index.ts) but ships to the browser so the
// pill builder + searchSKUs can strip locally without an RPC round-trip.
//
// Update both files together when changing the brand list.

// Indian construction-material manufacturer/brand names. Strip from canonical
// names, aliases, and unmatched-token pill candidates.
export const BRAND_NAMES: readonly string[] = [
  'ashirvad', 'supreme', 'finolex', 'prince', 'astral',
  'asian paints', 'berger', 'nerolac', 'dulux',
  'ultratech', 'acc', 'ambuja', 'jk', 'birla', 'dalmia', 'shree',
  'jsw', 'tata', 'sail', 'jindal',
  'kajaria', 'somany', 'orient', 'johnson', 'rak',
  'cera', 'parryware', 'hindware', 'jaquar',
  'havells', 'anchor', 'polycab', 'kei', 'rr kabel',
  'syska', 'philips', 'crompton', 'bajaj',
  'godrej', 'hettich', 'ebco', 'dorset', 'yale', 'europa',
  'pidilite', 'sika', 'basf', 'fosroc', 'myk', 'laticrete', 'weber',
  'greenply', 'century', 'kitply', 'archid', 'merino',
  'sundek', 'national', 'sintex', 'sheetal',
  'texmo', 'cri', 'kirloskar', 'grundfos',
  'v-guard', 'luminous', 'microtek', 'exide', 'amaron',
  'bosch', 'makita', 'dewalt', 'stanley', 'black & decker',
  'usha', 'khaitan', 'orient bell', 'nitco',
];

// Brand tokens that became generic product names — DO NOT strip these.
// "M Seal" is what people call epoxy compound; "Fevicol" is white glue.
export const BRAND_AS_GENERIC: ReadonlySet<string> = new Set([
  'm seal', 'mseal', 'm-seal',
  'fevicol',
  'feviquick',
  'wd-40', 'wd40',
  'araldite',
  'dettol',
  'xerox',
  'flex',
  'fevikwik', 'fevi kwik',
  'dr. fixit', 'dr fixit',
]);

export function stripBrandNames(text: string): string {
  if (!text) return text;
  const lower = text.toLowerCase();
  // Skip stripping entirely if the text matches a brand-as-generic phrase.
  // (Handles the multi-token case "M Seal" where neither token alone is a brand.)
  for (const brand of BRAND_AS_GENERIC) {
    if (lower.includes(brand)) return text;
  }
  let cleaned = text;
  for (const brand of BRAND_NAMES) {
    if (BRAND_AS_GENERIC.has(brand)) continue;
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    cleaned = cleaned.replace(new RegExp(`\\b${escaped}\\b`, 'gi'), '');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

// Filler words people sprinkle through purchase requests. Stripped before
// alias-index search and excluded from common-pill rendering.
export const STOP_WORDS: ReadonlySet<string> = new Set([
  'i', 'need', 'want', 'the', 'a', 'an', 'of', 'for', 'to', 'and', 'or',
  'with', 'in', 'at', 'on', 'is', 'are', 'was', 'were', 'please', 'get',
  'buy', 'order', 'send', 'deliver', 'nos', 'pcs', 'pieces', 'numbers',
  'no', 'pls', 'plz', 'kindly', 'asap', 'urgent', 'urgently', 'today',
  'tomorrow', 'site', 'work',
]);

export function isStopWord(token: string): boolean {
  return STOP_WORDS.has(token.toLowerCase().trim());
}

// Phrases that mark a line as a service / labour / hire rather than a
// material order — used by searchSKUs to short-circuit the SKU pipeline.
export const SERVICE_TERMS_REGEX =
  /\b(labour|labor|service|services|transport|transportation|hire|rental|charges|fees|commission|consulting|supervision|watching)\b/i;

// Generic English stems that mean "any" of a class of products. Used by
// the alias-specificity check (Gap 13) to detect when an alias is too
// generic to identify a single family.
export const GENERIC_STEMS: ReadonlySet<string> = new Set([
  'pipe', 'valve', 'wire', 'rod', 'bar', 'cement', 'paint', 'brick',
  'tile', 'sand', 'fitting', 'sheet', 'board', 'channel', 'angle',
  'plate', 'strip', 'tape', 'putty', 'adhesive', 'primer', 'cable',
  'glue', 'sealant',
]);
