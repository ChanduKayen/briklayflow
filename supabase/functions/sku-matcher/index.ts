import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import OpenAI from 'https://esm.sh/openai@4'

const openai  = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') })
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
)

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
  match_source:  'trgm' | 'openai' | 'trgm+openai' | 'none'
  reason:        string
  alternatives:  { sku_id: string; sku_name: string; confidence: number }[]
  needs_review:  boolean
}

interface SKUMatcherRequest {
  text?:            string
  image_base64?:    string
  image_url?:       string
  vendor_category?: string
  org_id?:          string
  caller?:          string
  action?:          string
  documentSiblingItems?: string[]
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

async function reRankWithLLM(
  item:       ExtractedRaw,
  candidates: TrgmCandidate[],
  validIds:   Set<string>
): Promise<Pick<MatchedItem, 'sku_id' | 'sku_name' | 'confidence' | 'reason' | 'needs_review' | 'alternatives'>> {
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
    needs_review: !skuValid || (result.confidence ?? 0) < 70,
    alternatives: (result.alternatives ?? []).filter((a: any) => validIds.has(a.sku_id)),
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
    if (candidates.length > 0 && candidates[0].similarity >= 0.82) {
      const top = candidates[0]
      results.push({
        ...base,
        sku_id:       top.sku_id,
        sku_name:     top.item_name,
        unit:         top.unit || item.unit,
        confidence:   Math.round(top.similarity * 100),
        match_source: 'trgm',
        reason:       `High-confidence trgm+FTS match (${Math.round(top.similarity * 100)}%)`,
        needs_review: top.similarity < 0.92,
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
      const ranked = await reRankWithLLM(item, llmCandidates, validIds)
      const matchedUnit = ranked.sku_id
        ? (llmCandidates.find(c => c.sku_id === ranked.sku_id)?.unit ?? item.unit)
        : item.unit
      results.push({
        ...base,
        ...ranked,
        unit:         matchedUnit || item.unit,
        match_source: candidates.length > 0 ? 'trgm+openai' : 'openai',
      })
    } catch (err) {
      console.error('LLM re-rank error for item:', item.item_name, err)
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
  const prompt = `You are a Principal Master Data Management (MDM) Ontological Engineer specializing in localized global supply chain procurement.
Convert this raw, unstructured purchase order text into a highly precise, clean parametric SKU record.

Item Typed: "${text}"
VENDOR MASTER CATEGORY: ${vendorCat || 'Unknown'}${siblingContextString}${webContext}
${fewShotFamilyContext ? `\nEXISTING DIRECTORY STYLE REFERENCE:\n${fewShotFamilyContext}` : ''}

CRITICAL EXECUTION PROTOCOLS:

1. TRANSLATE REGIONAL VERNACULAR & TRADE SLANG:
   - Identify localized trade naming conventions, regional slang, or site-level shorthand (e.g., "Safeda" -> "Plumbing Putty / Joint Sealant", "Dhaga" -> "Threading Twine", "M-Seal" -> "Epoxy Compound").
   - Translate the core item concept into its standard global commercial English industrial name *before* performing parametric splitting.

2. DYNAMIC PARAMETRIC SPLITTING (THE 4-FACTOR MATRIX):
   Map the translated item into these exact structural properties:
   - "sub_category": The canonical product family node (e.g., "Pipe", "Ball Valve", "Plumbing Putty", "Thread Seal Tape").
     *ANTI-POLLUTION GUARD:* If the item is a consumable, sealant, tape, or chemical, classify its sub_category precisely by its compound type. NEVER force consumables into structural hardware families (e.g., a sealant tape or putty is NEVER a "Pipe" or a "Fitting").
   - "dimension": Size, diameter, rating, volume, or weight capacity (e.g., "2 INCH", "500 ML", "100 GRAM"). Maximize standardization based on sibling patterns.
   - "variant": Brand, manufacturer, color, or material composition (e.g., "Supreme", "Astral", "White", "Teflon").
   - "grade": Quality tier, pressure class, schedule rating, or execution path specification (e.g., "Class C", "Sch 40", "Heavy Duty", "1 Way").

3. STRATEGIC ALIAS HARVESTING (3-4 TARGETED ELEMENTS):
   Generate exactly 3 to 4 clean alternate search phrases. Include the original regional vernacular term, commercial trade shorthand, and common industry abbreviations.
   - FORBIDDEN: Do not use generic noise words like "hardware", "material", "supply", "product".

4. THE SHOP-FLOOR TEST:
   Can a supplier fulfill this item instantly without asking follow-up questions? If an essential parameter (like brand or size) is absent from the input text, mark "passes_shop_floor_test" as false and list it in "missing_parameters".

Return a valid JSON object matching this schema precisely without exception:
{
  "ai_suggested_name": "A perfectly standardized, clean, uppercase string: [Dimension/Volume] [Grade] [Sub-Category] ([Variant/Brand])",
  "extracted_attributes": {
    "sub_category": "The corrected English product family family string",
    "dimension": "Size, rating, or capacity string, or null",
    "variant": "Brand or material marker string, or null",
    "grade": "Tier, class, or execution specification string, or null"
  },
  "aliases": ["Original Vernacular Term", "Alternate Trade Shorthand", "Industry Abbreviation Code"],
  "validation_metrics": {
    "passes_shop_floor_test": true,
    "missing_parameters": []
  }
}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4.1-mini', temperature: 0, max_tokens: 350,
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
  
  const attrs = parsed.extracted_attributes || {};
  let suggestedName = parsed.ai_suggested_name || text;
  const aliases = Array.isArray(parsed.aliases) ? parsed.aliases : [];

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
    suggestedName = skuDisplayName(aliasMatch);
    // If it perfectly matches an alias, it's considered valid
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

  // Generate the dense floating-point coordinate array directly from the standardized canonical name
  const canonicalVector = await generateVectorEmbedding(openai, suggestedName);

  // Update your type-safe return payload contract to pass the completed array block to the UI layer
  return {
    sku_id: null,
    match_source: "ai_auto_match",
    needs_review: true,
    ai_suggested_name: suggestedName,
    extracted_attributes: {
      sub_category: parsed.extracted_attributes?.sub_category || "Unknown Items",
      dimension:    parsed.extracted_attributes?.dimension    || null,
      variant:      parsed.extracted_attributes?.variant      || null,
      grade:        parsed.extracted_attributes?.grade        || null
    },
    aliases: Array.isArray(parsed.aliases) 
             ? parsed.aliases.map((a: string) => String(a).toUpperCase().trim()).filter(Boolean).slice(0, 4) 
             : [],
    validation_metrics: {
      passes_shop_floor_test: passesShopFloorTest,
      missing_parameters:     passesShopFloorTest ? [] : missing
    },
    // SECURE HANDOFF: Pass the generated vector float array explicitly up to the client context
    p_embedding: canonicalVector && canonicalVector.length > 0 ? canonicalVector : null
  };
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

    // Fetch SKUs relevant to vendor category (or all if unknown)
    const skus = await fetchSKUs(body.vendor_category)

    if (body.action === 'generateStructuredSkuWithContext') {
      const payload = await generateStructuredSkuWithContext(body, skus)
      return new Response(JSON.stringify(payload), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
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
