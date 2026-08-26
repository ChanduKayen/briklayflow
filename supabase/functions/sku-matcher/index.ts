import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'

const openai  = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

// IMPORTANT: These values MUST match src/lib/skuThresholds.ts
// If you change a threshold, update BOTH files.
const SKU_AUTO_COMMIT             = 0.82
const SKU_CLEAN_MATCH             = 0.92
const SKU_RERANK_REVIEW_THRESHOLD = 70   // Cohere/LLM rerank: confidence % below this → needs_review

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// ── Types ──────────────────────────────────────────────────────────────

interface SKURow {
  sku_id:        string
  category:      string
  sub_category:  string
  dimension:     string | null
  variant:       string | null
  grade:         string | null
  standard_unit: string
  aliases:       string[] | null
}

interface TrgmCandidate {
  sku_id:     string
  item_name:  string
  category:   string
  unit:       string
  aliases:    string
  similarity: number
}

interface MatchedItem {
  item_raw:      string
  item_name:     string
  specification: string | null
  quantity:      number | null
  unit:          string | null
  category_hint: string
  sku_id:        string | null
  sku_name:      string | null
  confidence:    number
  match_source:  'trgm' | 'openai' | 'trgm+openai' | 'cohere_rerank' | 'trgm+cohere' | 'llm_fallback' | 'none'
  reason:        string
  alternatives:  { sku_id: string; sku_name: string; confidence: number }[]
  needs_review:  boolean
}

interface SKUMatcherRequest {
  text?:            string
  image_base64?:    string
  image_url?:       string
  image_mime?:      string
  vendor_category?: string
  org_id?:          string
  caller?:          string
  action?:          string
  documentSiblingItems?: string[]
  // classifyForDictionary inputs
  item_name?:       string
  specification?:   string
  // suggestCostCode inputs
  remark?:          string
  cost_codes?:      { code: string; name: string }[]
  // classifyStakeholderTrade inputs — the Transactions importer. `parties` are the NEW names it
  // could not match, each with the notes across its rows; `trade_vocab` is the client's trades.ts
  // taxonomy (single source of truth), so the model is confined to real trades. The CLIENT snaps
  // the raw answer back onto the vocab (importClassify.ts) — this action only proposes.
  parties?:         { name: string; notes: string[] }[]
  trade_vocab?:     { Worker: string[]; Vendor: string[]; Client: string[] }
  // generateStructuredSkuWithContext: when true the DB re-search skips trgm
  // and only consults the alias index. Set by the frontend after the user
  // rejects fuzzy suggestions via "Not what you need? Search web".
  skip_trgm?:       boolean
  // identifyProduct: the user's raw query for the isolated Serper + LLM
  // product-identification path that powers the parallel "Did you mean?".
  query?:           string
}

// ── Vendor trade → SKU category mapping ───────────────────────────────

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
}

// ── Brand-name stripper ───────────────────────────────────────────────
// Indian construction-material brand names. The canonical SKU name and aliases
// must describe the PRODUCT TYPE, not a manufacturer's branded product —
// otherwise the same physical item from a different brand can't be reused.

const BRAND_NAMES: readonly string[] = [
  'ashirvad', 'supreme', 'finolex', 'prince', 'astral',
  'asian paints', 'berger', 'nerolac', 'dulux',
  'ultratech', 'acc', 'ambuja', 'jk', 'birla', 'dalmia', 'shree',
  'jsw', 'tata', 'sail', 'jindal',
  'kajaria', 'somany', 'orient', 'johnson', 'rak',
  'cera', 'parryware', 'hindware', 'jaquar',
  'havells', 'anchor', 'polycab', 'kei', 'rr kabel',
  'syska', 'philips', 'crompton', 'bajaj',
  'godrej', 'hettich', 'ebco', 'dorset', 'yale', 'europa',
  'pidilite',
  'sika', 'basf', 'fosroc', 'myk', 'laticrete', 'weber',
  'greenply', 'century', 'kitply', 'archid', 'merino',
  'sundek', 'national', 'sintex', 'sheetal',
  'texmo', 'cri', 'kirloskar', 'grundfos',
  'v-guard', 'luminous', 'microtek', 'exide', 'amaron',
  'bosch', 'makita', 'dewalt', 'stanley', 'black & decker',
  'usha', 'khaitan', 'orient bell', 'nitco',
];

// Brand tokens that became generic product names — KEEP these as-is when
// they appear in user input or AI extraction. "M Seal" is what people call
// epoxy compound; "Fevicol" is white glue. Must stay in sync with the
// frontend's brandFilter.ts (Gap 5).
const BRAND_AS_GENERIC: ReadonlySet<string> = new Set([
  'm seal', 'mseal', 'm-seal',
  'fevicol',
  'feviquick', 'fevikwik', 'fevi kwik',
  'wd-40', 'wd40',
  'araldite',
  'dettol',
  'xerox',
  'flex',
  'dr. fixit', 'dr fixit',
]);

function stripBrandNames(name: string): string {
  if (!name) return name;
  const lower = name.toLowerCase();
  // If the input matches a generic-by-usage phrase, leave it alone.
  for (const generic of BRAND_AS_GENERIC) {
    if (lower.includes(generic)) return name;
  }
  let cleaned = name;
  for (const brand of BRAND_NAMES) {
    if (BRAND_AS_GENERIC.has(brand)) continue;
    const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const regex = new RegExp(`\\b${escaped}\\b`, 'gi');
    cleaned = cleaned.replace(regex, '');
  }
  return cleaned.replace(/\s+/g, ' ').trim();
}

// ── Deterministic post-processor for GPT extraction ────────────────────
// The GPT prompt is guidance. cleanExtractionResult is the guarantee.
// It mutates the parsed GPT result in place, catching everything the
// model misses: quantity prefixes in the name, unit words, parentheticals,
// placeholder words, brand names, ALL CAPS, NOS-as-fallback-unit, and
// ensures the original user input is the first alias.

const UNIT_WORDS_REGEX = /\b(tonne|tonnes|ton|tons|bag|bags|kg|kgs|kilogram|kilograms|nos|number|numbers|piece|pieces|pcs|bundle|bundles|box|boxes|mtr|meter|meters|metre|metres|ft|feet|foot|ltr|litre|litres|liter|liters|sqm|sft|cft|rft|sqft|cum|brass|quintal|quintals)\b/gi;
const PLACEHOLDER_REGEX = /\b(standard|generic|default|normal|regular|n\/a|na|nil|none|common|basic|ordinary)\b/gi;
const KNOWN_ACRONYMS = [
  'OPC', 'PPC', 'TMT', 'PVC', 'CPVC', 'UPVC', 'PPR', 'GI', 'CI', 'SS', 'MS',
  'HDPE', 'LDPE', 'SWR', 'BWR', 'MR', 'ISI', 'RCC', 'PSC', 'WPC', 'MDF', 'HDF', 'FRP',
];

// Material category / sub_category keyword → standard unit. Order matters:
// more specific keys should appear before more general ones.
const CATEGORY_UNIT_MAP: Record<string, string> = {
  'opc cement':              'BAG',
  'ppc cement':              'BAG',
  'cement':                  'BAG',
  'construction sand':       'CFT',
  'river sand':              'CFT',
  'm-sand':                  'CFT',
  'sand':                    'CFT',
  'crushed stone aggregate': 'CFT',
  'aggregate':               'CFT',
  'gravel':                  'CFT',
  'murram':                  'CFT',
  'earth':                   'CFT',
  'timber':                  'CFT',
  'wood':                    'CFT',
  'tmt bar':                 'KG',
  'binding wire':            'KG',
  'steel':                   'KG',
  'clay brick':              'NOS',
  'brick':                   'NOS',
  'bricks':                  'NOS',
  'block':                   'NOS',
  'cpvc pipe':               'MTR',
  'upvc pipe':               'MTR',
  'pvc pipe':                'MTR',
  'gi pipe':                 'MTR',
  'pipe':                    'MTR',
  'cable':                   'MTR',
  'electrical wire':         'MTR',
  'emulsion':                'LTR',
  'primer':                  'LTR',
  'paint':                   'LTR',
  'construction water':      'TANKER',
  'water':                   'TANKER',
  'plywood':                 'SFT',
  'floor tiles':             'SFT',
  'tiles':                   'SFT',
  'waterproofing':           'KG',
};

function titleCaseWithAcronyms(name: string): string {
  // Only title-case if the input is effectively all-caps (excluding digits/symbols).
  const letters = name.replace(/[^A-Za-z]/g, '');
  if (letters.length === 0 || letters !== letters.toUpperCase() || letters.length <= 3) return name;
  let titled = name.replace(/\b\w+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  for (const acr of KNOWN_ACRONYMS) {
    titled = titled.replace(new RegExp(`\\b${acr.toLowerCase()}\\b`, 'gi'), acr);
  }
  return titled;
}

function looksLikePlaceholder(v: unknown): boolean {
  if (v == null) return true;
  const s = String(v).trim();
  if (!s || s.toLowerCase() === 'null') return true;
  PLACEHOLDER_REGEX.lastIndex = 0;
  const isPlaceholder = PLACEHOLDER_REGEX.test(s);
  PLACEHOLDER_REGEX.lastIndex = 0;
  return isPlaceholder;
}

function cleanExtractionResult(result: any, originalInput: string): any {
  let name = String(result.ai_suggested_name ?? '');

  // 1. Strip a leading quantity ("1 TONNE SAND" → "TONNE SAND")
  name = name.replace(/^\s*\d+(?:\.\d+)?\s+/i, '');
  // 2. Strip unit words anywhere in the name
  name = name.replace(UNIT_WORDS_REGEX, ' ');
  // 3. Strip parenthetical unknowns ("SAND (GVBGU)" → "SAND")
  name = name.replace(/\s*\([^)]*\)\s*/g, ' ');
  // 4. Strip placeholder words
  name = name.replace(PLACEHOLDER_REGEX, ' ');
  PLACEHOLDER_REGEX.lastIndex = 0;
  // 5. Strip brand names
  name = stripBrandNames(name);
  // 6. Whitespace + leading/trailing punctuation cleanup
  name = name.replace(/\s+/g, ' ').replace(/^[\s,.\-:]+/, '').replace(/[\s,.\-:]+$/, '').trim();
  // 7. Title-case ALL CAPS while preserving known acronyms
  name = titleCaseWithAcronyms(name);
  // 8. Fallback: if cleanup emptied the name, fall back to sub_category/category/input
  if (!name || name.length < 2) {
    const attrs = result.extracted_attributes || {};
    name = String(attrs.sub_category || result.sub_category || result.category || originalInput || '').trim();
  }
  result.ai_suggested_name = name;

  // Clean dimension/variant/grade — wherever they live.
  const attrs = result.extracted_attributes || (result.extracted_attributes = {});
  for (const field of ['dimension', 'variant', 'grade'] as const) {
    if (looksLikePlaceholder(attrs[field])) attrs[field] = null;
    if (looksLikePlaceholder(result[field])) result[field] = null;
  }
  if (attrs.variant) {
    const stripped = stripBrandNames(String(attrs.variant));
    attrs.variant = stripped || null;
  }
  if (attrs.sub_category) {
    const stripped = stripBrandNames(String(attrs.sub_category));
    if (stripped) attrs.sub_category = stripped;
  }

  // Detected quantity: if GPT didn't pull it out, try the leading number in the raw input
  if (result.detected_quantity == null) {
    const qtyMatch = String(originalInput || '').match(/^\s*(\d+(?:\.\d+)?)\b/);
    if (qtyMatch) result.detected_quantity = parseFloat(qtyMatch[1]);
  }

  // Unit: fix when GPT defaulted to NOS for a bulk material
  const unitKey = String(attrs.sub_category || result.sub_category || result.category || name).toLowerCase();
  const currentUnit = String(result.standard_unit || '').toUpperCase();
  if (!currentUnit || currentUnit === 'NOS') {
    for (const key of Object.keys(CATEGORY_UNIT_MAP)) {
      if (unitKey.includes(key)) {
        result.standard_unit = CATEGORY_UNIT_MAP[key];
        break;
      }
    }
  }

  // Aliases: ensure original input is first, then strip brands, then dedup + length floor
  const aliasArr: string[] = Array.isArray(result.aliases) ? result.aliases.map((a: any) => String(a)) : [];
  const inputTrimmed = String(originalInput || '').trim();
  if (inputTrimmed.length >= 2 && !aliasArr.some(a => a.toLowerCase().trim() === inputTrimmed.toLowerCase())) {
    aliasArr.unshift(inputTrimmed);
  }
  const seen = new Set<string>();
  result.aliases = aliasArr
    .map(a => stripBrandNames(a).trim())
    .filter(a => {
      if (a.length < 2) return false;
      const k = a.toLowerCase();
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });

  return result;
}

// ── Helpers ────────────────────────────────────────────────────────────

async function generateVectorEmbedding(
  openaiClient: any,
  textToEmbed: string
): Promise<number[]> {
  try {
    if (!textToEmbed) return [];
    
    // Ingest token configurations directly using the production hardened standard model
    const response = await openaiClient.embeddings.create({
      model: "text-embedding-3-small",
      input: textToEmbed.toUpperCase().trim(),
    });

    return response.data[0].embedding;
  } catch (err) {
    console.error("Vector Extraction Failed inside OpenAI Pipeline:", err);
    return [];
  }
}

function skuDisplayName(s: SKURow): string {
  return [s.sub_category, s.dimension, s.variant, s.grade].filter(Boolean).join(' ').trim()
}

// ── Step 1: Fetch SKUs relevant to vendor category ────────────────────

async function fetchSKUs(vendorCategory?: string): Promise<SKURow[]> {
  const cats = vendorCategory ? (VENDOR_TO_SKU_CATEGORIES[vendorCategory] ?? null) : null

  let query = supabase
    .from('sku_directory')
    .select('sku_id, category, sub_category, dimension, variant, grade, standard_unit, aliases')
    .eq('is_active', true)

  if (cats && cats.length > 0) {
    query = (query as any).in('category', cats)
  }

  const { data, error } = await (query as any).order('category').limit(300)
  if (error) { console.error('SKU fetch error:', error); return [] }
  return (data ?? []) as SKURow[]
}

// ── Step 2: trgm pre-filter for a single item name ────────────────────
// Uses the improved trgm_match_sku function (with word_similarity + FTS)
// to get a shortlist of candidates for this item.

async function trgmSearch(
  itemName:   string,
  categories: string[] | null,
  limit       = 8
): Promise<TrgmCandidate[]> {
  const params: Record<string, unknown> = {
    p_search_term: itemName.trim(),
    p_limit:       limit,
    p_threshold:   0.10,
  }
  if (categories?.length === 1) params.p_category   = categories[0]
  else if (categories?.length)  params.p_categories = categories

  const { data, error } = await supabase.rpc('trgm_match_sku', params as any)
  if (error) { console.error('trgm_search error:', error); return [] }
  return (data ?? []) as TrgmCandidate[]
}

// ── Step 3: GPT extract + match ───────────────────────────────────────
//
// Two-pass strategy (like Amazon SNAP / SAP Ariba candidate re-ranking):
//
//   For each line item the LLM extracts, we pre-filter the SKU list down
//   to ≤8 trgm candidates using word_similarity + FTS. The LLM then sees
//   only those tight candidates and picks the best one, rather than scanning
//   200 rows of noise. This dramatically improves precision without hurting
//   recall (the trgm pass with word_similarity is high-recall by design).
//
//   Confidence ≥ 85: auto-commit, no review needed.
//   Confidence 50–84: commit with needs_review = true.
//   Confidence < 50 or null: returned as unmatched, trgm fallback applied below.

function buildExtractionPrompt(vendorCategory?: string): string {
  const cats = vendorCategory ? (VENDOR_TO_SKU_CATEGORIES[vendorCategory] ?? []) : []
  const categoryContext = cats.length > 0
    ? `\nVendor type: "${vendorCategory}" — items are expected in [${cats.join(', ')}]. Use this to resolve ambiguous or regional names.\n`
    : ''

  return `You are a senior procurement manager for Indian construction projects with deep knowledge of material trade names across Andhra Pradesh, Telangana, and pan-India.${categoryContext}

TASK: Extract every material line item from the document. DO NOT match to SKUs yet — just extract cleanly.

CRITICAL — item_name MUST be the standard Indian construction industry name. Never copy vendor shorthand verbatim.

INTERPRETATION REFERENCE:
  Aggregates  : "jelly" / "metal" / "coarse agg" → "Coarse Aggregate <size>mm"
  Sand        : "m-sand" / "robo sand" → "M-Sand"  |  "river sand" → "River Sand"
  Cement      : "53 grade" / brand+"53" → "OPC 53 Cement"  |  "43 grade" → "OPC 43 Cement"
  Steel       : "tmt/tor/rebar" + grade+dia → "TMT Bar <grade> <dia>mm"
  Bricks      : "ita" / "mitti" → "Clay Brick"  |  "solid block 200" → "Concrete Block 200mm"
  Electrical  : "4c×6sq" → "4 Core 6 Sq.mm Armoured Cable"
  Plumbing    : "health facet" / "health facets" / "health fasset" → "Health Faucet" | "bib cock" → "Bib Cock" | "ball valve" → "Ball Valve" | "cpvc pipe" → "CPVC Pipe" | "upvc pipe" → "uPVC Pipe" | "gI pipe" / "gi pipe" → "GI Pipe" | "flush valve" → "Flush Valve" | "stop cock" → "Stop Cock"

Return ONLY a valid JSON array:
[{
  "item_raw": "verbatim text from document",
  "item_name": "standard industry name",
  "specification": "grade/size/variant or null",
  "quantity": number_or_null,
  "unit": "Bags|MT|kg|Nos|Rmt|Sqft|Ltr|m³|m²|null",
  "category_hint": "likely category: Cement|Steel|Sand|Aggregate|Brick|Block|Paint|Tile|Plumbing|Electrical|Hardware|Plywood|Waterproofing"
}]

If no items found, return [].`.trim()
}

function buildReRankPrompt(
  item: { item_raw: string; item_name: string; specification: string | null },
  candidates: TrgmCandidate[]
): string {
  const candidateList = candidates.map((c, i) =>
    `${i + 1}. ${c.sku_id} | ${c.item_name} | ${c.unit} | score ${Math.round(c.similarity * 100)}% | also: ${c.aliases}`
  ).join('\n')

  return `Match this construction item to the best SKU from the candidate list below.

Item from document: "${item.item_raw}"
Standardised name: "${item.item_name}"${item.specification ? `\nSpec: "${item.specification}"` : ''}

Candidates (pre-filtered from SKU directory):
${candidateList}

Rules:
- Pick the ONE best match. If none fit, return sku_id: null.
- Exact spec match (size, grade, variant): confidence 85-100
- Right category, minor spec diff: confidence 50-84, needs_review: true
- Closest available but clearly not right: confidence 20-49, needs_review: true
- No match: sku_id: null, confidence: 0

Return ONLY valid JSON (no markdown):
{
  "sku_id": "EXACT_ID_FROM_LIST_or_null",
  "sku_name": "matched name or null",
  "confidence": integer_0_to_100,
  "reason": "one sentence",
  "needs_review": boolean,
  "alternatives": [{"sku_id":"...","sku_name":"...","confidence":integer}]
}`
}

interface ExtractedRaw {
  item_raw:      string
  item_name:     string
  specification: string | null
  quantity:      number | null
  unit:          string | null
  category_hint: string
}

async function extractItems(
  req:  SKUMatcherRequest
): Promise<ExtractedRaw[]> {
  const systemPrompt = buildExtractionPrompt(req.vendor_category)

  let content: OpenAI.ChatCompletionContentPart[]
  if (req.text) {
    content = [{ type: 'text', text: req.text }]
  } else if (req.image_base64) {
    content = [
      { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${req.image_base64}`, detail: 'high' } },
      { type: 'text', text: 'Extract all material line items from this document.' },
    ]
  } else if (req.image_url) {
    content = [
      { type: 'image_url', image_url: { url: req.image_url, detail: 'high' } },
      { type: 'text', text: 'Extract all material line items from this document.' },
    ]
  } else {
    throw new Error('Provide text, image_base64, or image_url')
  }

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1', max_tokens: 2000, temperature: 0,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user',   content },
    ],
  })

  const raw     = response.choices[0].message.content?.trim() ?? '[]'
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  return JSON.parse(cleaned) as ExtractedRaw[]
}

// Shared return type for all rerankers (adds match_source to the MatchedItem pick)
type ReRankResult = Pick<MatchedItem, 'sku_id' | 'sku_name' | 'confidence' | 'reason' | 'needs_review' | 'alternatives'> & {
  match_source: string
}

interface CohereRerankResult {
  index:           number
  relevance_score: number
}

interface CohereRerankResponse {
  id:      string
  results: CohereRerankResult[]
}

function buildCandidateText(candidate: TrgmCandidate): string {
  return [candidate.item_name, candidate.category, candidate.aliases].filter(Boolean).join(' | ')
}

// Kept as fallback when Cohere is unavailable. Renamed from reRankWithLLM.
async function reRankWithLLMFallback(
  item:       ExtractedRaw,
  candidates: TrgmCandidate[],
  validIds:   Set<string>
): Promise<ReRankResult> {
  const prompt = buildReRankPrompt(item, candidates)

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini', max_tokens: 400, temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  })

  const raw     = response.choices[0].message.content?.trim() ?? '{}'
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const result  = JSON.parse(cleaned)

  const skuValid = result.sku_id && validIds.has(result.sku_id)
  return {
    sku_id:       skuValid ? result.sku_id : null,
    sku_name:     skuValid ? result.sku_name : null,
    confidence:   skuValid ? (result.confidence ?? 0) : 0,
    reason:       result.reason ?? '',
    needs_review: !skuValid || (result.confidence ?? 0) < SKU_RERANK_REVIEW_THRESHOLD,
    alternatives: (result.alternatives ?? []).filter((a: any) => validIds.has(a.sku_id)),
    match_source: 'llm_fallback',
  }
}

async function reRankWithCohere(
  item:       ExtractedRaw,
  candidates: TrgmCandidate[],
  validIds:   Set<string>
): Promise<ReRankResult> {
  const cohereKey = Deno.env.get('COHERE_API_KEY')
  if (!cohereKey) {
    console.warn('COHERE_API_KEY not set, using LLM fallback')
    return reRankWithLLMFallback(item, candidates, validIds)
  }

  const query = [item.item_raw, item.item_name, item.specification].filter(Boolean).join(' ')

  const response = await fetch('https://api.cohere.com/v2/rerank', {
    method: 'POST',
    headers: {
      'Content-Type':  'application/json',
      'Authorization': `Bearer ${cohereKey}`,
    },
    body: JSON.stringify({
      model:            'rerank-v3.5',
      query,
      documents:        candidates.map(c => ({ text: buildCandidateText(c) })),
      top_n:            Math.min(candidates.length, 5),
      return_documents: false,
    }),
  })

  if (!response.ok) {
    const errText = await response.text()
    throw new Error(`Cohere API error ${response.status}: ${errText}`)
  }

  const data: CohereRerankResponse = await response.json()

  const reranked = data.results
    .sort((a, b) => b.relevance_score - a.relevance_score)
    .map(result => ({ ...candidates[result.index], cohereScore: result.relevance_score }))
    .filter(r => validIds.has(r.sku_id))

  if (reranked.length === 0) {
    return {
      sku_id:       null,
      sku_name:     null,
      confidence:   0,
      reason:       'Cohere returned no valid candidates',
      needs_review: true,
      alternatives: [],
      match_source: 'cohere_rerank',
    }
  }

  const top           = reranked[0]
  const topConfidence = Math.round(top.cohereScore * 100)

  return {
    sku_id:       top.sku_id,
    sku_name:     top.item_name,
    confidence:   topConfidence,
    reason:       `Cohere rerank score ${topConfidence}%`,
    needs_review: topConfidence < SKU_RERANK_REVIEW_THRESHOLD,
    alternatives: reranked.slice(1).map(r => ({
      sku_id:     r.sku_id,
      sku_name:   r.item_name,
      confidence: Math.round(r.cohereScore * 100),
    })),
    match_source: 'cohere_rerank',
  }
}

// Primary entry point for reranking: tries Cohere, falls back to LLM on any error.
async function reRankCandidates(
  item:       ExtractedRaw,
  candidates: TrgmCandidate[],
  validIds:   Set<string>
): Promise<ReRankResult> {
  try {
    return await reRankWithCohere(item, candidates, validIds)
  } catch (err) {
    console.error('Cohere rerank failed, falling back to LLM:', err)
    return reRankWithLLMFallback(item, candidates, validIds)
  }
}

// ── Main matching pipeline ────────────────────────────────────────────

async function matchItems(
  items:          ExtractedRaw[],
  skus:           SKURow[],
  vendorCategory: string | undefined
): Promise<MatchedItem[]> {
  const validIds = new Set(skus.map(s => s.sku_id))
  const cats     = vendorCategory ? (VENDOR_TO_SKU_CATEGORIES[vendorCategory] ?? null) : null

  const results: MatchedItem[] = []

  for (const item of items) {
    const base: MatchedItem = {
      item_raw:      item.item_raw,
      item_name:     item.item_name,
      specification: item.specification,
      quantity:      item.quantity,
      unit:          item.unit,
      category_hint: item.category_hint,
      sku_id:        null,
      sku_name:      null,
      confidence:    0,
      match_source:  'none',
      reason:        '',
      alternatives:  [],
      needs_review:  true,
    }

    // ── Stage 1: trgm pre-filter ───────────────────────────────
    // word_similarity + FTS gives us high-recall shortlist.
    const candidates = await trgmSearch(item.item_name, cats)

    // ── Stage 2: Auto-commit if trgm is highly confident ──────
    if (candidates.length > 0 && candidates[0].similarity >= SKU_AUTO_COMMIT) {
      const top = candidates[0]
      results.push({
        ...base,
        sku_id:       top.sku_id,
        sku_name:     top.item_name,
        unit:         top.unit || item.unit,
        confidence:   Math.round(top.similarity * 100),
        match_source: 'trgm',
        reason:       `High-confidence trgm+FTS match (${Math.round(top.similarity * 100)}%)`,
        needs_review: top.similarity < SKU_CLEAN_MATCH,
        alternatives: candidates.slice(1, 4).map(c => ({
          sku_id:     c.sku_id,
          sku_name:   c.item_name,
          confidence: Math.round(c.similarity * 100),
        })),
      })
      continue
    }

    // ── Stage 3: LLM re-ranks the trgm shortlist ──────────────
    // If trgm found some candidates (even low-score), let GPT pick.
    // If trgm found nothing, GPT gets the top-10 SKUs from the full
    // category list as a fallback (same as old behaviour but bounded).
    let llmCandidates = candidates
    if (llmCandidates.length === 0) {
      // Fallback: use first 10 SKUs from the relevant category
      const fallback = skus
        .filter(s => !cats || cats.includes(s.category))
        .slice(0, 10)
        .map(s => ({
          sku_id:     s.sku_id,
          item_name:  skuDisplayName(s),
          category:   s.category,
          unit:       s.standard_unit,
          aliases:    (s.aliases ?? []).join(', '),
          similarity: 0,
        }))
      llmCandidates = fallback
    }

    if (llmCandidates.length === 0) {
      results.push({ ...base, reason: 'No SKU candidates found in directory' })
      continue
    }

    try {
      const ranked = await reRankCandidates(item, llmCandidates, validIds)
      const matchedUnit = ranked.sku_id
        ? (llmCandidates.find(c => c.sku_id === ranked.sku_id)?.unit ?? item.unit)
        : item.unit
      const effectiveSource = candidates.length > 0 && ranked.match_source === 'cohere_rerank'
        ? 'trgm+cohere'
        : ranked.match_source as MatchedItem['match_source']
      results.push({
        ...base,
        ...ranked,
        unit:         matchedUnit || item.unit,
        match_source: effectiveSource,
      })
    } catch (err) {
      console.error('Rerank error (Cohere + LLM both failed) for item:', item.item_name, err)
      // Fall back to best trgm candidate if LLM errors
      if (candidates.length > 0) {
        const top = candidates[0]
        results.push({
          ...base,
          sku_id:       top.sku_id,
          sku_name:     top.item_name,
          unit:         top.unit || item.unit,
          confidence:   Math.round(top.similarity * 100),
          match_source: 'trgm',
          reason:       'LLM unavailable; best trgm match',
          needs_review: true,
          alternatives: candidates.slice(1, 3).map(c => ({
            sku_id:     c.sku_id,
            sku_name:   c.item_name,
            confidence: Math.round(c.similarity * 100),
          })),
        })
      } else {
        results.push({ ...base, reason: 'LLM error and no trgm candidates' })
      }
    }
  }

  return results
}

// ── Web-Inference & Sibling Ingestion (New Flow) ──────────────────────

async function generateStructuredSkuWithContext(req: SKUMatcherRequest, skus: SKURow[]): Promise<any> {
  const text = req.text || '';
  const vendorCat = req.vendor_category || '';
  const siblings = req.documentSiblingItems || [];
  
  // 1. Web-Inference Search via Serper
  let webContext = '';
  const serperKey = Deno.env.get('SERPER_API_KEY');
  if (serperKey && text) {
    try {
      const searchRes = await fetch('https://google.serper.dev/search', {
        method: 'POST',
        headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
        body: JSON.stringify({ q: `${text} ${vendorCat} construction material specifications india` })
      });
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        const snippets = (searchData.organic || []).slice(0, 3).map((r: any) => r.snippet).join(' | ');
        webContext = snippets ? `\nLIVE WEB INFERENCE CONTEXT:\n${snippets}` : '';
      }
    } catch (e) {
      console.error('Serper search failed', e);
    }
  }

  const siblingContextString = siblings.length > 0 ? `\nSIBLING CONTEXT:\n[${siblings.join(', ')}]` : '';
  const fewShotFamilyContext = skus.length > 0 ? skus.slice(0, 5).map(s => `- ${s.sku_id}: ${s.sub_category} ${s.dimension || ''} ${s.variant || ''} ${s.grade || ''}`).join('\n') : '';

  // 2. OpenAI Extraction using Context and Web data
  const prompt = `You are a construction materials procurement expert working across India.
You work daily with supervisors, masons, plumbers, electricians, and vendors who
communicate in Telugu, Hindi, Tamil, Kannada, Marathi, and English — often mixing
languages in the same sentence.

YOUR PRIMARY SKILL: You understand construction site vernacular across Indian
languages. When a supervisor says "2 bag siminti" you know that's cement. When
they say "kankara" you know that's aggregate / gravel / crushed stone — NOT sand.
When they say "isaka" you know that's sand. You understand the distinction
between similar-sounding materials because you've worked on Indian construction
sites. Bring that comprehension to the input below — do not look up a fixed
dictionary, REASON from your knowledge of the language and the trade.

YOU MUST DISTINGUISH between commonly-confused materials:
- Sand (fine, plastering/mortar) vs Aggregate / Gravel (coarse, crushed stone, concrete)
- OPC Cement vs PPC Cement (different compositions, different uses)
- Different pipe materials (PVC vs CPVC vs PPR vs GI vs uPVC — each is a distinct product)
- Different steel forms (TMT bar vs MS plate vs angle vs channel vs binding wire)

EXTRACTION RULES:

1. CANONICAL NAME (ai_suggested_name)
   - Generic product type in English. No quantities, no units, no measurements.
   - No brand names. No unidentified abbreviations or garbage tokens.
   - Wrong: "1 TONNE CONSTRUCTION SAND (GVBGU)"  → Right: "Construction Sand"
   - Wrong: "Ashirvad CPVC Pipe"                  → Right: "CPVC Pipe"

2. QUANTITIES vs DIMENSIONS
   - Quantities (HOW MUCH) → detected_quantity + standard_unit
   - Dimensions (WHAT SIZE) → stays in dimension
   - "1 tonne isaka"            → name: "Construction Sand", detected_quantity: 1,  standard_unit: "TONNE"
   - "12mm TMT"                 → name: "TMT Bar",           dimension: "12mm",     detected_quantity: null
   - "2 bag 53 grade siminti"   → name: "OPC 53 Cement",     detected_quantity: 2,  standard_unit: "BAG"

3. UNKNOWN TOKENS
   - If a word or abbreviation cannot be confidently identified as a product,
     grade, dimension, or material — DROP IT entirely. Never carry it in any field.

4. PLACEHOLDERS
   - Never use "Standard", "Generic", "Default", "Normal", "Regular", "Common",
     "Basic", "Ordinary" as dimension/variant/grade. Use null instead.

5. BRAND NAMES — strictly excluded from every field
   - Strip every manufacturer/brand token. The variant field MAY hold a material /
     colour / composition marker (e.g. "White", "Teflon") but MUST NOT hold a brand.
   - Indian construction brands to ALWAYS strip include (non-exhaustive):
     Ashirvad, Supreme, Finolex, Prince, Astral, Asian Paints, Berger, Nerolac,
     Dulux, Ultratech, ACC, Ambuja, JK, Birla, Dalmia, Shree, JSW, Tata, SAIL,
     Jindal, Kajaria, Somany, Orient, Johnson, RAK, Cera, Parryware, Hindware,
     Jaquar, Havells, Anchor, Polycab, KEI, RR Kabel, Syska, Philips, Crompton,
     Bajaj, Godrej, Hettich, Ebco, Dorset, Yale, Europa, Pidilite, Fevicol,
     Dr. Fixit, Sika, BASF, Fosroc, MYK Laticrete, Weber, Greenply, Century,
     Kitply, Archid, Merino, Sundek, National, Sintex, Sheetal, Texmo, CRI,
     Kirloskar, Grundfos.
   - If the input contains ONLY a brand with no product description (e.g. just
     "Ashirvad"), set passes_shop_floor_test to false and list "product_type"
     in missing_parameters — do NOT guess a product.

6. UNIT DETECTION (standard_unit)
   - Derive the unit from the MATERIAL TYPE, not just the input text.
   - Sand, aggregate, gravel, murram, earth, timber: CFT or TONNE
   - Cement: BAG (default) or MT
   - Steel, binding wire: KG or MT
   - Bricks, blocks, fittings, valves, fixtures: NOS
   - Pipe, wire, cable: MTR
   - Paint, primer, chemicals: LTR or KG
   - Tiles, plywood, glass: SFT or SQM
   - Water: TANKER or KL
   - NEVER default to NOS for bulk materials like sand, cement, or steel.

7. ALIASES
   - The FIRST alias MUST be the original input term verbatim.
   - Add 2–3 more regional-language or trade-shorthand terms you know for this product.
   - FORBIDDEN: generic noise words ("hardware", "material", "supply", "product").
   - These aliases are stored back into the catalog and reused for instant matching.

8. SHOP-FLOOR TEST
   - Can a supplier fulfill this item instantly without asking follow-up questions?
   - If an essential parameter (size, grade, product_type) is absent, set
     passes_shop_floor_test false and list missing parameters.

INPUT:
Item Typed: "${text}"
VENDOR MASTER CATEGORY: ${vendorCat || 'Unknown'}${siblingContextString}${webContext}
${fewShotFamilyContext ? `\nEXISTING DIRECTORY STYLE REFERENCE:\n${fewShotFamilyContext}` : ''}

Return ONLY a valid JSON object matching this schema (no markdown):
{
  "ai_suggested_name": "Generic English product name (no qty, no unit, no brand)",
  "category": "One of: Cement|Steel|Aggregate|Sand|Brick|Block|Paint|Tile|Plumbing|Electrical|Hardware|Plywood|Waterproofing|Admixture|Chemical|Glass|Windows|Doors",
  "extracted_attributes": {
    "sub_category": "Canonical product family node (e.g. 'Pipe', 'Ball Valve', 'Plumbing Putty')",
    "dimension":    "Size/rating/capacity string, or null",
    "variant":      "Material/colour/composition marker (NO BRAND), or null",
    "grade":        "Quality tier, pressure class, schedule, or null"
  },
  "aliases": ["original_input_verbatim", "regional_term", "trade_shorthand"],
  "standard_unit":     "BAG|MT|KG|NOS|MTR|SFT|SQM|CFT|LTR|TONNE|TANKER|KL",
  "detected_quantity": null_or_number,
  "confidence":        0.0_to_1.0,
  "validation_metrics": {
    "passes_shop_floor_test": true_or_false,
    "missing_parameters":     []
  }${webContext ? `,
  "available_variants": [
    { "attribute": "dimension", "description": "Standard sizes this material comes in",
      "options": [{"value": "example_value", "hint": "optional_context"}] }
  ]` : ''}
}${webContext ? `

The "available_variants" field MUST be populated using the LIVE WEB INFERENCE CONTEXT above. List every distinct specification axis (e.g. dimension, grade, variant/type) the web context suggests this product family comes in. Each axis is one object with attribute (lowercase snake_case), description (one line), and options (2–6 common values with optional hints). Omit axes with only one known value.` : ''}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini', temperature: 0, max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const raw = response.choices[0].message.content?.trim() ?? '{}';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');
  let parsed: any;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    parsed = { ai_suggested_name: text, extracted_attributes: { sub_category: text, dimension: null, variant: null, grade: null }, aliases: [] };
  }

  // ── Deterministic post-processor ──────────────────────────────────
  // Strips quantity prefixes, unit words, parentheticals, placeholders,
  // brand names; ensures original input is the first alias; title-cases
  // ALL CAPS; auto-fixes the unit when GPT defaulted to NOS for a bulk
  // material. See cleanExtractionResult for the full set of rules.
  cleanExtractionResult(parsed, text);

  const attrs = parsed.extracted_attributes || (parsed.extracted_attributes = {});
  let suggestedName: string = parsed.ai_suggested_name || text;
  const aliases: string[] = Array.isArray(parsed.aliases) ? parsed.aliases : [];

  // 3. The 4-Factor Family Lookback Matrix
  let missing = [];
  if (!attrs.dimension) missing.push('dimension');
  if (!attrs.variant) missing.push('variant');
  if (!attrs.grade) missing.push('grade');

  // Check aliases
  const aliasMatch = skus.find(s => 
    s.aliases && s.aliases.some(a => a.toLowerCase() === suggestedName.toLowerCase() || a.toLowerCase() === text.toLowerCase())
  );
  if (aliasMatch) {
    // Exact alias hit → the item is a known catalog entry, so mark it complete.
    // Do NOT overwrite suggestedName with skuDisplayName(aliasMatch): that returns
    // the full member name (sub_category + dimension + variant + grade), which would
    // poison ai_suggested_name and make "Did you mean?" show a dimensioned variant
    // (e.g. "AAC Block 600×200×200mm Standard Grade A") instead of the clean product
    // type. Keep the AI's clean canonical name. The matched catalog SKU is still
    // surfaced separately via the DB re-search payload (db_family / db_trgm_matches).
    missing = [];
  } else {
    // Check Dimensional Sibling
    const hasSibling = skus.some(s => 
      s.sub_category.toLowerCase() === (attrs.sub_category || '').toLowerCase() &&
      (s.variant || '').toLowerCase() === (attrs.variant || '').toLowerCase() &&
      (s.grade || '').toLowerCase() === (attrs.grade || '').toLowerCase() &&
      s.dimension !== attrs.dimension
    );
    if (hasSibling && !attrs.dimension) {
      // It belongs to a family that requires dimensions, but dimension is missing!
      if (!missing.includes('dimension')) missing.push('dimension');
    }
  }

  // Shop-Floor Test Rule: If any key 4-Factor property is absent, passes_shop_floor_test is false.
  // We'll consider it failed if it lacks ANY parameter that its category usually requires,
  // but for a generic strict rule, if missing array is not empty, it fails.
  const passesShopFloorTest = missing.length === 0 || !!aliasMatch;

  // ── DB re-search with AI's canonical name ─────────────────────────
  // The AI just translated vernacular ("safeda") into a generic English
  // product name ("Plumbing Putty"). Before showing the AI chip — which
  // would create a new dictionary entry — check whether that canonical
  // name already exists in the catalog. If it does, return the DB match
  // and let the frontend short-circuit the AI flow.
  const DB_RESEARCH_THRESHOLD = 0.75;
  const cats = vendorCat ? (VENDOR_TO_SKU_CATEGORIES[vendorCat] ?? null) : null;
  let dbMatch: { kind: 'family' | 'trgm'; data: any } | null = null;

  if (suggestedName && suggestedName.trim().length >= 2) {
    try {
      const familyParams: Record<string, unknown> = {
        p_search_term:    suggestedName,
        p_limit:          3,
        p_min_similarity: 0.5,
      };
      if (cats && cats.length === 1)        familyParams.p_category   = cats[0];
      else if (cats && cats.length > 1)     familyParams.p_categories = cats;

      const { data: familyMatches } = await supabase.rpc('search_alias_family', familyParams as any);

      if (familyMatches && familyMatches.length > 0 && familyMatches[0].similarity >= DB_RESEARCH_THRESHOLD) {
        const top = familyMatches[0];
        const [membersRes, profileRes] = await Promise.all([
          supabase.rpc('get_family_members',      { p_category: top.category, p_sub_category: top.sub_category }),
          supabase.rpc('get_sku_family_profile',  { p_category: top.category, p_sub_category: top.sub_category }),
        ]);
        const members = (membersRes.data || []) as any[];
        if (members.length > 0) {
          dbMatch = { kind: 'family', data: { family: top, members, profile: profileRes.data ?? null } };
        }
      }
    } catch (err) {
      console.error('DB re-search (alias family) failed:', err);
    }

    // Skip trgm entirely when the caller has rejected fuzzy suggestions.
    // Alias index above always runs (exact matches are always trustworthy);
    // if it missed, the item is genuinely new and trgm would only resurface
    // the same wrong fuzzy hit (e.g. "Ball Valve" for "Check Valve").
    if (!dbMatch && !req.skip_trgm) {
      try {
        const trgmParams: Record<string, unknown> = {
          p_search_term: suggestedName,
          p_limit:       5,
          p_threshold:   0.5,
        };
        if (cats && cats.length === 1)        trgmParams.p_category   = cats[0];
        else if (cats && cats.length > 1)     trgmParams.p_categories = cats;

        const { data: trgmMatches } = await supabase.rpc('trgm_match_sku', trgmParams as any);

        if (trgmMatches && trgmMatches.length > 0 && trgmMatches[0].similarity >= DB_RESEARCH_THRESHOLD) {
          dbMatch = { kind: 'trgm', data: { matches: trgmMatches } };
        }
      } catch (err) {
        console.error('DB re-search (trgm) failed:', err);
      }
    }
  }

  // Generate the dense floating-point coordinate array directly from the standardized canonical name
  const canonicalVector = await generateVectorEmbedding(openai, suggestedName);

  // ── Vector-based orphan fallback (Gap 6) ──────────────────────────
  // When neither the alias index nor trgm matched, ask the catalog whether
  // anything is *semantically* close. If the embedding lands within the
  // threshold, surface that family as a "suggested" tap-to-confirm pill on
  // the frontend instead of leaving the item totally orphaned.
  let suggestedFamily: any = null;
  if (!dbMatch && canonicalVector && canonicalVector.length > 0) {
    try {
      const { data: vec } = await supabase.rpc('suggest_sku_family', {
        p_embedding: canonicalVector as any,
      });
      if (vec && vec.suggestion_found) {
        const { data: vecProfile } = await supabase.rpc('get_sku_family_profile', {
          p_category:     vec.suggested_category,
          p_sub_category: vec.suggested_sub_category,
        });
        suggestedFamily = {
          category:     vec.suggested_category,
          sub_category: vec.suggested_sub_category,
          distance:     vec.distance,
          profile:      vecProfile ?? null,
        };
      }
    } catch (err) {
      console.error('suggest_sku_family failed:', err);
    }
  }

  const basePayload = {
    sku_id: null,
    match_source: "ai_auto_match",
    needs_review: true,
    ai_suggested_name: suggestedName,
    category:          parsed.category || null,
    extracted_attributes: {
      sub_category: attrs.sub_category || "Unknown Items",
      dimension:    attrs.dimension    || null,
      variant:      attrs.variant      || null,
      grade:        attrs.grade        || null
    },
    // First alias preserves the original input verbatim — required for the
    // alias-learning loop. Subsequent aliases are upper-cased and deduped.
    aliases: (() => {
      const out: string[] = [];
      const seen = new Set<string>();
      aliases.forEach((a, i) => {
        const v = i === 0 ? String(a).trim() : String(a).toUpperCase().trim();
        const k = v.toLowerCase();
        if (v && !seen.has(k)) { seen.add(k); out.push(v); }
      });
      return out.slice(0, 4);
    })(),
    standard_unit:     parsed.standard_unit ? String(parsed.standard_unit).toUpperCase() : null,
    detected_quantity: typeof parsed.detected_quantity === 'number' ? parsed.detected_quantity : null,
    confidence:        typeof parsed.confidence        === 'number' ? parsed.confidence        : null,
    validation_metrics: {
      passes_shop_floor_test: passesShopFloorTest,
      missing_parameters:     passesShopFloorTest ? [] : missing
    },
    // SECURE HANDOFF: Pass the generated vector float array explicitly up to the client context
    p_embedding: canonicalVector && canonicalVector.length > 0 ? canonicalVector : null,
    available_variants: Array.isArray(parsed.available_variants) ? parsed.available_variants : [],
    suggested_family: suggestedFamily,
  };

  if (dbMatch?.kind === 'family') {
    return {
      ...basePayload,
      db_match_found: true,
      db_family:      dbMatch.data.family,
      db_members:     dbMatch.data.members,
      db_profile:     dbMatch.data.profile,
    };
  }
  if (dbMatch?.kind === 'trgm') {
    return {
      ...basePayload,
      db_match_found:    true,
      db_trgm_matches:   dbMatch.data.matches,
    };
  }
  return { ...basePayload, db_match_found: false };
}

// ── Main handler ──────────────────────────────────────────────────────

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }
  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ error: 'POST only' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }

  try {
    const body = await req.json() as SKUMatcherRequest

    // ── identifyProduct: isolated Serper + LLM product identification ──────
    // Powers the parallel "Did you mean?" on the PO line. Serper web search +
    // one LLM call turns vernacular/garbled input ("ituka") into a CLEAN
    // generic product name ("Clay Brick"). Touches NO DB — no alias/trgm/family
    // lookup, no insert — and shares nothing with generateStructuredSkuWithContext.
    // Returns { name, confidence }. Handled BEFORE fetchSKUs so it never even
    // reads the catalog. Serper failure is non-fatal (LLM runs without context).
    if (body.action === 'identifyProduct') {
      const query = (body.query || body.text || '').trim()
      if (query.length < 2) {
        return new Response(JSON.stringify({ name: null, confidence: 0 }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const vendorCat = body.vendor_category || ''
      try {
        // Step 1 — Serper web context (non-fatal)
        let webContext = ''
        const serperKey = Deno.env.get('SERPER_API_KEY')
        if (serperKey) {
          try {
            const r = await fetch('https://google.serper.dev/search', {
              method: 'POST',
              headers: { 'X-API-KEY': serperKey, 'Content-Type': 'application/json' },
              body: JSON.stringify({ q: `${query} ${vendorCat} construction material india`.trim(), num: 5 }),
            })
            if (r.ok) {
              const d = await r.json()
              webContext = (d.organic || []).slice(0, 5)
                .map((o: any) => `${o.title}: ${o.snippet}`).join('\n')
            }
          } catch (e) {
            console.warn('identifyProduct Serper failed, LLM-only:', e)
          }
        }

        // Step 2 — LLM extraction → clean product type
        const systemPrompt = `You are the master counter-clerk at a construction hardware shop in coastal Andhra
Pradesh. For thirty years you've heard every mason, plumber, electrician and contractor
say what they need — in Telugu, Hindi, Tamil, Kannada, broken English, all mixed in one
breath. You have NEVER once asked a customer to spell a word. You hear the SOUND and you
know the product.

The text you receive was typed by someone spelling phonetically, by ear, with no concern
for correct English. Recover what they MEANT, then name it in the standard trade English
a supplier writes on an invoice.

HEAR IT FIRST (reconstruct the sound, then the meaning):
- Read the input ALOUD in an Indian-English accent before deciding anything.
- v↔w (walve=valve); retroflex l/r/d/t swap; dropped or added vowels; schwa insertion
  (filim=film); softened final consonants; ph=f.
- English plural/spelling welded onto a loanword: jales=jali, nallahs=nali, saryas=saria.
- Worked example of the REASONING (not a lookup): "laking jales" → aloud → "locking
  jali" → a floor-drain jali/grating. Do this reconstruction for every input.

CODE-MIXING: one phrase often carries a regional noun + an English qualifier ("4 inch
nali", "white saria"). Separate the material from the qualifier; name the material.

REGIONAL VOCABULARY (one product, many local names — know them all):
- TMT bar: saria/sariya, tor/tor steel, kambi, rod.
- Aggregate (coarse, NOT sand): kankara, jelly, metal, chips, gitti.
- Sand (fine, NOT aggregate): isaka, retti, ravva.
- Cement: siminti; "53"/"43 grade" → OPC; PPC is distinct.
- Clay brick (NOT AAC block): ituka/itika, eet/eent.
- Jali: grating/mesh/perforated cover — in plumbing, a floor-drain jali.
- safeda = plumbing putty / joint sealant — NOT white paint, NOT white cement.

WEB CONTEXT (Google results, may be empty): these are REAL pages from Indian suppliers
and marketplaces, and Google has ALREADY auto-corrected the spelling — the titles and
snippets show what the product is genuinely called in the trade. This is your STRONGEST
signal. If the snippets consistently point to a product, use that exact trade term over
your own guess. Only fall back to your ear when the web is empty or off-topic.

NEVER collapse confusable materials: sand≠aggregate, OPC≠PPC, PVC≠CPVC≠uPVC≠GI,
clay brick≠AAC block, TMT bar≠MS angle, putty≠paint.

OUTPUT: one product, standard trade English, no size/grade/brand/quantity unless it IS
the product's identity. First write what you HEARD, then the product, then honest
confidence.

CONFIDENCE (a downstream gate drops anything below 0.5):
- 0.9-1.0: already standard, or unambiguous known term, or web strongly confirms it.
- 0.6-0.85: confident single reconstruction; ear and/or web agree.
- 0.4-0.55: plausible but thin — ambiguous, or web silent and ear unsure.
- 0.0: no real product recoverable (pure garbage).

Reply JSON ONLY:
{"heard_as":"your phonetic reconstruction","name":"Trade Name" or null,"confidence":0.0-1.0}`

        const userMsg = webContext
          ? `User typed: "${query}"\n\nWeb search results:\n${webContext}\n\nWhat product is this? JSON only.`
          : `User typed: "${query}"\n\nWhat construction material is this? JSON only.`

        const completion = await openai.chat.completions.create({
          model: 'gpt-4o-mini',
          temperature: 0.1,
          max_tokens: 60,
          response_format: { type: 'json_object' },
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user',   content: userMsg },
          ],
        })

        const rawContent = completion.choices[0]?.message?.content || ''
        let parsed: { name: string | null; confidence: number }
        try {
          parsed = JSON.parse(rawContent.replace(/```json|```/g, '').trim())
        } catch {
          parsed = { name: rawContent.trim().replace(/^["'`]|["'`]$/g, '') || null, confidence: 0.5 }
        }

        // Defensive clean: strip any dimensions/qty/placeholder the model may add.
        let name = parsed.name ? String(parsed.name) : ''
        if (name && name.toUpperCase() !== 'UNKNOWN' && name.toLowerCase() !== 'null') {
          name = name
            .replace(/\d+\s*(?:mm|cm|inch|"|ft|kg|bags?|nos)\b/gi, '')
            .replace(/\b(?:standard|generic|default)\b/gi, '')
            .replace(/\s+/g, ' ')
            .trim()
          name = titleCaseWithAcronyms(name)
        } else {
          name = ''
        }

        return new Response(
          JSON.stringify({ name: name || null, confidence: name ? (parsed.confidence ?? 0.5) : 0, query }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      } catch (err) {
        console.error('identifyProduct error:', err)
        return new Response(
          JSON.stringify({ name: null, confidence: 0, error: String((err as any)?.message || err) }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
        )
      }
    }

    // Fetch SKUs relevant to vendor category (or all if unknown)
    const skus = await fetchSKUs(body.vendor_category)

    if (body.action === 'generateStructuredSkuWithContext') {
      const payload = await generateStructuredSkuWithContext(body, skus)
      return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── didYouMean: ultra-light canonical-name lookup ─────────────────────
    // Powers the Google-style "Did you mean?" chip. Deliberately minimal — no
    // Serper, no structuring, no DB, no post-processing — just one short, cheap
    // model call that returns ONE canonical product name as plain text. Built
    // to lead the catalog search (~300–600ms) rather than the 1–3s structuring
    // call. Returns { name: string|null }; null when nothing identifiable.
    if (body.action === 'didYouMean') {
      const raw = (body.text || '').trim()
      if (raw.length < 2) {
        return new Response(JSON.stringify({ name: null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const vendorCat = body.vendor_category || ''
      const prompt = `You are a construction-materials naming expert for India. You understand site
vernacular across Telugu, Hindi, Tamil, Kannada, Marathi and English
(e.g. "siminti"=cement, "kankara"=aggregate/gravel, "isaka"=sand,
"tor bar"=TMT bar, "jelly"=coarse aggregate).

Given a vendor's raw item text, reply with ONLY the canonical generic English
product name — nothing else, no explanation, no punctuation around it.

Rules:
- No brands, no quantities, no units, no sizes/grades (those go elsewhere).
- Distinguish commonly-confused materials: sand vs aggregate, OPC vs PPC,
  PVC vs CPVC vs GI, TMT bar vs MS angle.
- Drop unidentifiable/garbage tokens.
- If the text is already a clean product name, return it unchanged.
- If you cannot identify a real product, reply exactly: UNKNOWN

Vendor trade (hint, may be empty): ${vendorCat}

Examples:
angel valls            -> Angle Valve
2 bag 53 grade siminti -> OPC 53 Cement
jelly 20mm             -> Coarse Aggregate
ashirvad cpvc 1 inch   -> CPVC Pipe
asdf qwer              -> UNKNOWN

Item: ${raw}`
      try {
        const r = await openai.chat.completions.create({
          model: 'gpt-4.1-mini', temperature: 0, max_tokens: 16,
          messages: [{ role: 'user', content: prompt }],
        })
        let name = (r.choices[0].message.content ?? '')
          .split('\n')[0]
          .replace(/^["'`]|["'`]$/g, '')
          .trim()
        if (!name || name.toUpperCase() === 'UNKNOWN') name = ''
        return new Response(JSON.stringify({ name: name || null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      } catch (e) {
        console.error('didYouMean failed', e)
        return new Response(JSON.stringify({ name: null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
    }

    // ── classifyForDictionary: build a sku_directory record for an item ──
    // Replaces the browser-direct OpenAI call previously made by
    // autoAddItemToDictionary's LLM fallback path. Same prompt, same output
    // shape, but runs server-side so no API key ships to the client.
    if (body.action === 'classifyForDictionary') {
      const itemName  = (body.item_name || body.text || '').trim()
      const vendorCat = body.vendor_category || 'unknown'
      const spec      = (body.specification || 'none').trim()
      if (!itemName) {
        return new Response(JSON.stringify({ error: 'item_name is required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const prompt = `You are a construction materials procurement expert for Indian building projects.

An item was entered in a Purchase Order but could NOT be found in the SKU dictionary.
Your task: generate a proper sku_directory record for it AND explain the gap.

Item name   : "${itemName}"
Specification: "${spec || 'none'}"
Vendor type : "${vendorCat}"

Return ONLY valid JSON (no markdown):
{
  "sku_id": "CATEGORY-SHORT_SUBCAT-DIM-VARIANT-GRADE (uppercase, hyphens only, max 45 chars, e.g. STEEL-TMT-16MM-BAR-FE415)",
  "category": "one of: Cement|Steel|Aggregate|Sand|Brick|Block|Paint|Tile|Plumbing|Electrical|Hardware|Plywood|Waterproofing|Admixture",
  "sub_category": "full descriptive name e.g. TMT Bar, OPC 53 Cement",
  "dimension": "size string e.g. 12mm or null",
  "variant": "type variant e.g. Bar, Bag or null",
  "grade": "grade/standard e.g. Fe500D, IS303 or null",
  "aliases": ["regional", "trade", "shorthand", "names", "vendors", "commonly", "use"],
  "standard_unit": "one of: BAG|MT|KG|NOS|RMT|SQFT|LTR|CFT|SQM|SET|LS|PAIR (UPPERCASE)",
  "reason_missing": "one sentence: what gap in the dictionary caused this miss"
}`
      const completion = await openai.chat.completions.create({
        model: 'gpt-4.1-mini', max_tokens: 500, temperature: 0,
        messages: [{ role: 'user', content: prompt }],
      })
      const raw     = completion.choices[0].message.content?.trim() ?? ''
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      let parsed: any
      try { parsed = JSON.parse(cleaned) }
      catch { return new Response(JSON.stringify({ error: 'classification failed' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }

      // Strip brand names from sub_category, variant, and aliases.
      if (parsed.sub_category) parsed.sub_category = stripBrandNames(String(parsed.sub_category)) || parsed.sub_category
      if (parsed.variant)      parsed.variant      = stripBrandNames(String(parsed.variant))      || null
      if (Array.isArray(parsed.aliases)) {
        parsed.aliases = parsed.aliases
          .map((a: any) => stripBrandNames(String(a)))
          .filter((a: string) => a && a.length >= 2)
      }

      return new Response(JSON.stringify(parsed),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── extractWorkOrderBoQ: BOQ extraction from a work-order image ──
    // Replaces the browser-direct call in NewWorkOrder.tsx handleFileUpload.
    if (body.action === 'extractWorkOrderBoQ') {
      if (!body.image_base64 && !body.image_url) {
        return new Response(JSON.stringify({ error: 'image_base64 or image_url required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const systemPrompt = `You are a construction BOQ (Bill of Quantities) extraction assistant for Indian construction work orders and quotations.

Extract the document header fields AND each work stage/line item. Determine if each stage is MEASURED (qty × rate) or LUMP SUM.

DETECTION RULES:
MEASURED — all three present: Unit (Sqft, Cum, Rmt etc.), Quantity, Rate. Amount should equal qty × rate.
LUMP SUM — when: LS / L.S. / Lump Sum / Lumpsum / Fixed / Package mentioned, OR only amount given, OR work described as "complete job".
AMBIGUOUS — Amount present but qty × rate doesn't match, OR unit present but qty/rate missing.

INDIAN UNITS:
Sqft, Sft, sq.ft → Sqft | Sqm, sq.m → Sqm | Cum, Cu.m, cmt → Cum | Cft, cu.ft → Cft
Rmt, RM, rft → Rmt | Nos, No., Nrs → Nos | Kg, KG → Kg | MT, M.T. → MT
Per point, point → Per Point | Per flat → Per Flat | Per floor → Per Floor | LS, L.S. → LS

AMOUNT VERIFICATION: if qty and rate both extracted, compute expected = qty × rate. If |extracted - expected| / expected > 0.02, set arithmetic_mismatch: true.

Return ONLY this JSON object, no other text:
{
  "worker_name_fuzzy": "contractor name or null",
  "scope_of_work": "overall scope or null",
  "order_value": totalValueOrNull,
  "date_issued": "YYYY-MM-DD or null",
  "stages": [
    {
      "name": "string", "mode": "measured | lumpsum | ambiguous",
      "unit_type": "string or null", "qty": "number or null",
      "rate": "number or null", "amount": "number",
      "amount_verified": "boolean", "arithmetic_mismatch": "boolean",
      "mismatch_note": "string or null",
      "confidence": "HIGH | MEDIUM | LOW", "confidence_reason": "string"
    }
  ]
}`
      // A contract can arrive as a PHOTO or a PDF. GPT-4o's vision `image_url` cannot read a
      // PDF — it must go in as a `file` content part (file_data), which gpt-4o parses natively.
      // `any[]` because the `file` part isn't in the pinned openai@4 esm.sh types yet.
      const mime = body.image_mime || ''
      const isPdf = /pdf/i.test(mime) || (!!body.image_url && /\.pdf($|\?)/i.test(body.image_url))
      const userContent: any[] = []
      if (body.image_base64) {
        if (isPdf) {
          userContent.push({
            type: 'file',
            file: { filename: 'contract.pdf', file_data: `data:application/pdf;base64,${body.image_base64}` },
          })
        } else {
          userContent.push({
            type: 'image_url',
            image_url: { url: `data:${mime || 'image/jpeg'};base64,${body.image_base64}`, detail: 'high' },
          })
        }
      } else if (body.image_url) {
        userContent.push(isPdf
          ? { type: 'file', file: { filename: 'contract.pdf', file_url: body.image_url } }
          : { type: 'image_url', image_url: { url: body.image_url, detail: 'high' } })
      }
      userContent.push({ type: 'text', text: 'Extract all details from this construction document.' })

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o',
        temperature: 0.1,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user',   content: userContent },
        ],
      })
      const raw     = completion.choices[0].message.content?.trim() ?? '{}'
      const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
      let parsed: any
      try { parsed = JSON.parse(cleaned) }
      catch { return new Response(JSON.stringify({ error: 'BOQ extraction failed' }),
        { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }) }
      return new Response(JSON.stringify(parsed),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // ── suggestCostCode: classify a payment remark into a cost code ──
    // Replaces the browser-direct calls in NewTransaction + QuickTransactionSheet.
    if (body.action === 'suggestCostCode') {
      const remark    = (body.remark || '').trim()
      const codeList  = (body.cost_codes || []).map(c => `${c.code}: ${c.name}`).join('\n')
      if (!remark || !codeList) {
        return new Response(JSON.stringify({ code: 'NONE' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', max_tokens: 15, temperature: 0,
        messages: [
          { role: 'system', content: 'You classify Indian construction payment remarks into cost codes. Return ONLY the single best matching code (e.g. "WRK-07-02") or "NONE" if ambiguous. Nothing else.' },
          { role: 'user',   content: `Remark: "${remark}"\n\nCost codes:\n${codeList}` },
        ],
      })
      const code = (completion.choices[0].message.content || 'NONE').trim().replace(/["'.]/g, '').toUpperCase()
      return new Response(JSON.stringify({ code }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    if (body.action === 'classifyStakeholderTrade') {
      // Infer a type (Worker/Vendor/Client) + trade for each NEW party in a bulk import, reading the
      // notes across all of that party's rows. The client passes the trade_vocab (its trades.ts) and
      // SNAPS the answer back onto it (importClassify.ts) — so a hallucinated trade cannot survive.
      // We only PROPOSE here; the model is asked to pick from the given lists, best-effort.
      const parties = Array.isArray(body.parties) ? body.parties : []
      const vocab   = body.trade_vocab
      if (!parties.length || !vocab) {
        return new Response(JSON.stringify({ results: [] }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
      }
      const vocabText = (['Worker', 'Vendor', 'Client'] as const)
        .map((t) => `${t}: ${(vocab[t] || []).join(', ')}`).join('\n')
      const partiesText = parties.map((p, i) =>
        `${i + 1}. "${p.name}" — notes: ${(p.notes || []).slice(0, 15).join(' | ') || '(none)'}`).join('\n')

      const completion = await openai.chat.completions.create({
        model: 'gpt-4o-mini', temperature: 0,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content:
            'You classify parties in an Indian construction ledger. For each party, using its name and ' +
            'the notes describing what money was paid for, choose the single best TYPE (Worker, Vendor, or ' +
            'Client) and the single best TRADE from ONLY the lists provided for that type. If nothing fits, ' +
            'use the type\'s "Other (specify)". Return STRICT JSON: {"results":[{"name":<verbatim>,"type":..,"trade":..}]}. ' +
            'Never invent a trade that is not in the lists.' },
          { role: 'user', content: `Trades by type:\n${vocabText}\n\nParties:\n${partiesText}` },
        ],
      })
      let results: unknown = []
      try { results = JSON.parse(completion.choices[0].message.content || '{}').results ?? [] } catch { results = [] }
      return new Response(JSON.stringify({ results }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
    }

    // Pass 1: Extract items from document (clean, no SKU list in context)
    const extractedItems = await extractItems(body)
    if (extractedItems.length === 0) {
      return new Response(
        JSON.stringify({
          items: [], total: 0, auto_matched: 0,
          needs_review: 0, trgm_resolved: 0,
          caller: body.caller ?? 'unknown',
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Pass 2: trgm pre-filter → LLM re-rank per item
    const matched = await matchItems(extractedItems, skus, body.vendor_category)

    const autoMatched   = matched.filter(m => !m.needs_review).length
    const needsReview   = matched.filter(m => m.needs_review).length
    const trgmResolved  = matched.filter(m => m.match_source === 'trgm').length

    return new Response(
      JSON.stringify({
        items:         matched,
        total:         matched.length,
        auto_matched:  autoMatched,
        needs_review:  needsReview,
        trgm_resolved: trgmResolved,
        caller:        body.caller ?? 'unknown',
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (err) {
    console.error('sku-matcher error:', err)
    return new Response(
      JSON.stringify({ error: String(err) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})
