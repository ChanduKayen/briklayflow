# SKU Pipeline Audit Report

**Date:** 2026-05-23  
**Auditor:** Claude Code (read-only, no files modified)  
**Codebase:** `C:\Users\koppi\OneDrive\Desktop\Briklay Fly`

---

## 1. Component Inventory

### Database Layer

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| `sku_directory` table | ✅ BUILT | `20260515000000_sku_directory.sql` | Full schema: id, sku_id, category, sub_category, dimension, variant, grade, aliases (text[]), standard_unit, is_active, notes, created_at, updated_at |
| `fts_vector` tsvector column | ✅ BUILT | `20260519000003_sku_smart_match.sql` | Added via ALTER TABLE; maintained by trigger |
| `embedding` vector(1536) column | ✅ BUILT | `20260522000002_semantic_guardrail.sql` | Requires pgvector extension; populated by Edge Function |
| `pg_trgm` extension | ✅ BUILT | `20260519000001_sku_matcher_trgm.sql` | `CREATE EXTENSION IF NOT EXISTS pg_trgm` |
| `vector` extension (pgvector) | ✅ BUILT | `20260522000002_semantic_guardrail.sql` | `CREATE EXTENSION IF NOT EXISTS vector` |
| GIN index on aliases array | ✅ BUILT | `20260515000000_sku_directory.sql` | `idx_sku_aliases` using GIN(aliases) |
| GIN trgm index on item name | ✅ BUILT | `20260519000001_sku_matcher_trgm.sql` | `idx_sku_trgm_name` using gin(sku_build_name(...) gin_trgm_ops) |
| GIN trgm index on aliases | ✅ BUILT | `20260519000001_sku_matcher_trgm.sql` | `idx_sku_trgm_aliases` using gin(sku_aliases_text(aliases) gin_trgm_ops) |
| GIN index on fts_vector | ✅ BUILT | `20260519000003_sku_smart_match.sql` | `idx_sku_fts_vector` |
| `trgm_match_sku` RPC | ✅ BUILT (v5) | `20260523101320_flatten_sku_aliases.sql` | **CRITICAL: final migration drops all params except p_search_term + p_limit — breaks callers passing p_category/p_categories/p_threshold** |
| `find_sku_by_alias` RPC | 🔌 UNWIRED | `20260515000000_sku_directory.sql` | Built, never called from frontend or edge functions |
| `generate_sku_id` function | 🔌 UNWIRED | `20260515000000_sku_directory.sql` | Built, never called anywhere |
| `sku_build_name` helper | ✅ BUILT | `20260519000001_sku_matcher_trgm.sql` | Used internally by trgm_match_sku |
| `sku_aliases_text` helper | ✅ BUILT | `20260519000001_sku_matcher_trgm.sql` | Used internally by trgm_match_sku |
| `sku_aliases_to_clean_text` helper | 🔌 UNWIRED | `20260523101320_flatten_sku_aliases.sql` | Duplicate of sku_aliases_text with different implementation; only used by the v5 flatten migration |
| `sku_normalize_query` synonym expander | ✅ BUILT | `20260519000003_sku_smart_match.sql` | Maps regional Indian construction slang to canonical terms |
| `sku_fts_trigger` | ✅ BUILT | `20260519000003_sku_smart_match.sql` | Maintains fts_vector on INSERT/UPDATE |
| `safely_insert_sku_with_guardrail` RPC | 🔌 UNWIRED | `20260522000002_semantic_guardrail.sql` | Semantic duplicate detection; never called from frontend — frontend bypasses this and inserts directly |
| `classify_sku_family_relationship` | 🔌 UNWIRED | `20260522000004_classify_sku_family_relationship.sql` | Parametric family classifier; never called from frontend or edge functions |
| FTS config (`to_tsvector`, `ts_rank`) | ✅ BUILT | `20260519000003_sku_smart_match.sql`, `20260522000001_trgm_match_hybrid.sql` | Uses 'simple' dictionary; trigger auto-updates |
| Seed data | ✅ BUILT | `supabase/seed_sku.sql` | ~60 SKU entries covering Cement, Steel, Aggregate, Sand, Brick, Block, Paint, Tile, Plumbing, Electrical, Plywood, Hardware, Admixture, Glass, Doors, Windows |
| `po_line_items` table | ✅ BUILT | `20260512160000_po_overhaul.sql` | Has sku_id? — **NO**: no sku_id column on po_line_items. SKU association exists only in memory during PO creation, not persisted to line items. |

### Edge Functions / API

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| `sku-matcher` Edge Function | ✅ BUILT | `supabase/functions/sku-matcher/index.ts` | Main SKU pipeline: trgm pre-filter + GPT-4.1 extraction + GPT-4.1-mini re-rank + Serper web search |
| Default extraction flow | ✅ BUILT | `sku-matcher/index.ts` L612-648 | Calls `extractItems` (GPT-4.1) then `matchItems` (trgm → LLM re-rank) |
| `generateStructuredSkuWithContext` action | ✅ BUILT | `sku-matcher/index.ts` L435-584 | Called by frontend's `runAIAutoMatch`; uses Serper + GPT-4.1-mini; returns extracted_attributes, validation_metrics, p_embedding |
| Serper web search | 🔶 PARTIAL | `sku-matcher/index.ts` L443-458 | Calls `https://google.serper.dev/search`; conditional on `SERPER_API_KEY` — silently skipped if key absent |
| OpenAI embeddings (text-embedding-3-small) | 🔶 PARTIAL | `sku-matcher/index.ts` L95-113 | Used inside `generateStructuredSkuWithContext` to produce p_embedding vector; not used in main extraction flow |
| `ai-extract-entry` Edge Function | ✅ BUILT | `supabase/functions/ai-extract-entry/index.ts` | Rough entry extraction using Claude Haiku or GPT-4o; for WhatsApp transaction log, NOT the PO SKU pipeline |
| `reconcile-po-bill` Edge Function | ✅ BUILT | `supabase/functions/reconcile-po-bill/index.ts` | Claude Haiku PO vs. bill comparison; standalone audit tool |
| `whatsapp-webhook` Edge Function | ✅ BUILT | `supabase/functions/whatsapp-webhook/index.ts` | WhatsApp financial entry routing; unrelated to SKU pipeline |
| Cohere / Hugging Face / cross-encoder | ❌ MISSING | — | No references to Cohere, Hugging Face, or cross-encoder anywhere in codebase |
| GPT-4.1 (extraction pass) | ✅ BUILT | `sku-matcher/index.ts` L273 | `model: 'gpt-4.1'`, max_tokens 2000, temperature 0 |
| GPT-4.1-mini (re-rank pass) | ✅ BUILT | `sku-matcher/index.ts` L293 | `model: 'gpt-4.1-mini'`, max_tokens 400, temperature 0 |
| VENDOR_TO_SKU_CATEGORIES map | ⚠️ DUPLICATED | `sku-matcher/index.ts` L68-91 AND `NewPurchaseOrder.tsx` L33-56 | **Same constant defined twice** — divergence risk |

### Frontend

| Component | Status | Location | Notes |
|-----------|--------|----------|-------|
| `NewPurchaseOrder.tsx` | ✅ BUILT | `src/pages/NewPurchaseOrder.tsx` | 2271-line main PO creation page; orchestrates entire SKU resolution UX |
| `ParametricReviewPanel.tsx` | ✅ BUILT | `src/components/ParametricReviewPanel.tsx` | Red-bordered review card for missing-parameter items; accepts/rejects AI extraction |
| `SKUDirectory.tsx` | ✅ BUILT | `src/pages/SKUDirectory.tsx` | Admin CRUD for sku_directory; includes trgm test panel |
| `src/lib/skuMatcher.ts` | ✅ BUILT | `src/lib/skuMatcher.ts` | Thin wrapper: `matchSKUs`, `matchSKUsFromText`, `matchSKUsFromFile` |
| `searchSKUs` (inline trgm search) | ✅ BUILT | `NewPurchaseOrder.tsx` L338-374 | Debounced 350ms; calls `trgm_match_sku` with p_limit:3; triggers `runAIAutoMatch` if no high-confidence match |
| `autoMatchSKU` (submit-time match) | ✅ BUILT | `NewPurchaseOrder.tsx` L392-430 | Called after document extraction; auto-commits if similarity ≥ 0.82 |
| `runAIAutoMatch` | ✅ BUILT | `NewPurchaseOrder.tsx` L432-478 | Calls `sku-matcher` action `generateStructuredSkuWithContext`; sends sibling items as context |
| `autoAddItemToDictionary` | ✅ BUILT | `NewPurchaseOrder.tsx` L552-680 | Two paths: (1) explicit SKU data from UI, (2) GPT-4.1-mini via direct OpenAI API call; inserts to `sku_directory` then re-links via trgm |
| `addMissingToDictionary` | ✅ BUILT | `NewPurchaseOrder.tsx` L682-779 | Batch variant of autoAddItemToDictionary; manual "Add to Dictionary" button |
| `handleApproveParametricSku` | ✅ BUILT | `NewPurchaseOrder.tsx` L490-550 | Called when ParametricReviewPanel submits; inserts directly into `sku_directory` with embedding; bypasses `safely_insert_sku_with_guardrail` |
| `aiJustMatchedIds` state | ✅ BUILT | `NewPurchaseOrder.tsx` L264 | Tracks items just AI-matched (for green flash animation) |
| `isRedbox` / redbox trigger | ✅ BUILT | `NewPurchaseOrder.tsx` L1616 | `const isRedbox = li.needs_review || li.expandedReview` |
| `handleDocumentUpload` | ✅ BUILT | `NewPurchaseOrder.tsx` L1000-1034 | Calls `matchSKUsFromFile` (→ sku-matcher Edge Function); then `autoAddItemToDictionary` for unmatched |
| `extractFromDocument` | ✅ BUILT | `NewPurchaseOrder.tsx` L904-969 | **Calls OpenAI directly** from browser using `VITE_OPENAI_API_KEY`; separate from `handleDocumentUpload` |
| `applyExtractedItems` | ✅ BUILT | `NewPurchaseOrder.tsx` L971-998 | Applies items from extraction review panel; triggers `autoMatchSKU` then `autoAddItemToDictionary` after 3s delay |
| `explicitSkuData` flow | ✅ BUILT | `NewPurchaseOrder.tsx` L639-656 | When `autoAddItemToDictionary` called with explicit data, skips OpenAI call |
| `validation_metrics` / shop floor test | ✅ BUILT | `ParametricReviewPanel.tsx` L50 | `passes_shop_floor_test` and `missing_parameters` displayed in panel |
| `needs_review` flag | ✅ BUILT | `NewPurchaseOrder.tsx` L1616, `sku-matcher/index.ts` L53 | Used throughout; affects redbox state and submission gate |
| `sku_alternatives` chips | ✅ BUILT | `NewPurchaseOrder.tsx` L1718-1804 | Renders DB candidates (similarity > 0.60) and AI chip side by side |
| `aiSuggestion` state on line items | ✅ BUILT | `NewPurchaseOrder.tsx` L93-108 | Holds the full `generateStructuredSkuWithContext` payload |
| Submission validation gate | 🔶 PARTIAL | `NewPurchaseOrder.tsx` L1036-1085 | `handleSubmit` runs trgm on unlinked items; expands redbox if no match ≥ 0.82, but **does not hard-block submission** — user can still dismiss warnings |

---

## 2. Data Flow Trace

### Path A: Manual typing in PO line item

```
User types in item_name input
  → onChange: updateLine(...) + searchSKUs(itemId, query)  [NewPurchaseOrder.tsx L1661-1663]
    → debounced 350ms
    → supabase.rpc('trgm_match_sku', {p_search_term, p_limit:3, [p_category|p_categories]})
      INPUT: search string, optional category filter
      OUTPUT: [{sku_id, item_name, category, unit, aliases, similarity}]
    → IF any result has similarity > 0.75:
        updateLine({sku_alternatives: results, isGeneratingAiChip: false})
        → UI renders "DB Matches:" chips (similarity > 0.60) [L1726-1744]
    → IF no high-confidence match (< 0.75):
        updateLine({isGeneratingAiChip: true})
        → runAIAutoMatch(itemId) [L371-374]
          → supabase.functions.invoke('sku-matcher', {action:'generateStructuredSkuWithContext', text, vendor_category, documentSiblingItems})
            → sku-matcher Edge Function:
                [optional] Serper web search for context
                → GPT-4.1-mini: extract sub_category, dimension, variant, grade, aliases, validation_metrics
                → generateVectorEmbedding(openai, suggestedName) → float[1536]
                OUTPUT: {ai_suggested_name, extracted_attributes, validation_metrics, aliases, p_embedding}
          → updateLine({aiSuggestion: payload, isGeneratingAiChip: false})
          → UI renders AI chip button with canonical name [L1753-1801]

User clicks AI chip:
  IF passes_shop_floor_test:
    → autoAddItemToDictionary(itemId, true, finalData) [L1773]
      → supabase.from('sku_directory').insert({sku_id (client-generated), category, sub_category, ...})
      → supabase.rpc('trgm_match_sku', {p_search_term, p_limit:1}) [re-validate after insert]
      → updateLine({sku_id, item_name, unit, confidence:100, needs_review:false})
  ELSE (shop floor test fails):
    → updateLine({expandedReview: true})
    → UI shows ParametricReviewPanel with missing fields highlighted [L1939-1944]

User fills ParametricReviewPanel and clicks "Save & Link SKU":
  → handleApproveParametricSku(lineItemId, formValues, aliases) [L490-550]
    → supabase.from('sku_directory').insert({sku_id: crypto.randomUUID(), embedding: p_embedding, ...})
    → updateLine({sku_id: newSkuId, item_name: canonicalName, needs_review:false, expandedReview:false})
```

### Path B: Document upload (handleDocumentUpload)

```
User uploads file → handleDocumentUpload(e) [L1000]
  → matchSKUsFromFile(file, 'po_creation', vendorCategory) [from skuMatcher.ts L51]
    → base64-encodes file
    → supabase.functions.invoke('sku-matcher', {image_base64, caller, vendor_category})
      → sku-matcher Edge Function (default flow, NOT generateStructuredSkuWithContext):
          fetchSKUs(vendorCategory): SELECT from sku_directory filtered by category
          extractItems(): GPT-4.1 with EXTRACT_PROMPT → [{item_raw, item_name, spec, qty, unit, category_hint}]
          matchItems():
            for each extracted item:
              trgmSearch(item_name, cats, limit=8)
              IF candidates[0].similarity >= 0.82:
                AUTO-COMMIT: match_source='trgm', needs_review=(similarity < 0.92)
              ELSE IF candidates > 0:
                reRankWithLLM(item, candidates, validIds) → GPT-4.1-mini
                returns {sku_id, sku_name, confidence, reason, needs_review, alternatives}
                needs_review: true if confidence < 70 [L308]
              ELSE (no trgm candidates):
                fallback: first 10 SKUs from category → GPT re-rank
          OUTPUT: {items: MatchedItem[], auto_matched, needs_review, trgm_resolved}
    → setLineItems: new lines with sku_id, needs_review, confidence from response
    → for unmatched items (no sku_id): setTimeout → autoAddItemToDictionary(li.id, 500ms delay)
```

### Path C: AI Document Extraction (extractFromDocument — SEPARATE FLOW)

```
User uploads to Section 03 drop zone → extractFromDocument(file) [L904]
  → Calls OpenAI directly from browser:
      fetch('https://api.openai.com/v1/chat/completions', {model:'gpt-4.1', EXTRACT_PROMPT})
      Uses VITE_OPENAI_API_KEY (exposed in browser)
      OUTPUT: {vendor_name, items:[{item_raw, item_name, spec, unit, qty, unit_rate, gst_rate, confidence}]}
  → setPendingItems() → user reviews and selects items
  → applyExtractedItems():
      creates line items WITHOUT sku_id
      for each: autoMatchSKU(id, item_name)
        → supabase.rpc('trgm_match_sku', {p_search_term, p_limit:8})
        IF top.similarity >= 0.82: auto-commit
        ELSE: show sku_alternatives chips
      after 3s: autoAddItemToDictionary for still-unmatched items
```

### Path D: Submit validation gate

```
handleSubmit(status) [L1036]
  → for each line item WITHOUT sku_id:
      supabase.rpc('trgm_match_sku', {p_search_term, p_limit:8, p_threshold:0.10})
      IF top.similarity >= 0.82: auto-commit → sku_id set
      ELSE: hasUnresolved = true, expandedReview = true (shows redbox)
  → IF hasUnresolved:
      showSnackbar('Action Required: Please resolve missing SKUs...')
      return early — PO NOT saved
  → ELSE: saveMutation.mutate(status)
      → supabase.rpc('create_purchase_order', {p_po_data, p_line_items})
      NOTE: p_line_items does NOT include sku_id — SKU linkage is NOT persisted to po_line_items table
```

---

## 3. Gap Analysis

### Fully wired (end-to-end working):

- `trgm_match_sku` → called from frontend inline search, autoMatchSKU, handleSubmit, and Edge Function
- `sku-matcher` Edge Function default flow (extract → trgm → LLM re-rank) → called by `handleDocumentUpload`
- `generateStructuredSkuWithContext` action → called by `runAIAutoMatch` in frontend
- `ParametricReviewPanel` → rendered, submitted, triggers `handleApproveParametricSku`
- `autoAddItemToDictionary` → triggered from multiple paths, inserts to sku_directory
- `SKUDirectory` CRUD page → full add/edit/deactivate with trgm test panel
- Seed data → 60+ SKUs covering major construction material categories
- FTS trigger (`sku_fts_trigger`) → auto-populates fts_vector on insert/update
- `needs_review` flag propagation → affects redbox rendering and submission gate

### Built but not wired (code exists, never called):

- `safely_insert_sku_with_guardrail` — semantic duplicate check via cosine distance. Frontend inserts directly to `sku_directory` bypassing this function entirely. Duplicate SKUs with embeddings < 0.15 apart CAN be inserted.
- `classify_sku_family_relationship` — parametric family classification (VARIANT_CHILD, DIMENSIONAL_SIBLING, etc.). Built in migration, never imported or called anywhere.
- `find_sku_by_alias` — original alias-based lookup. Superseded by trgm approach; never called.
- `generate_sku_id` — canonical ID generator from 5-part format. Frontend generates IDs with ad-hoc string concatenation instead.
- `sku_aliases_to_clean_text` (v5 migration helper) — duplicate of `sku_aliases_text`; only used within the same migration.

### Partially implemented:

- **Serper web search** — code exists and runs in Edge Function, but silently no-ops if `SERPER_API_KEY` is unset (which it likely is — not in `.env.local`, not in `.env.example`). Web context enrichment is dead without the key.
- **Vector embeddings** — `p_embedding` is generated by `generateVectorEmbedding` in Edge Function and returned to frontend. Frontend passes it through `handleApproveParametricSku` and `autoAddItemToDictionary`. However, `safely_insert_sku_with_guardrail` (which uses the embedding for duplicate detection) is never called — the embedding is stored but its deduplication purpose is bypassed.
- **`trgm_match_sku` parameter contract** — the last migration (`20260523101320_flatten_sku_aliases.sql`) **drops the full-featured version** and replaces it with a simplified 2-parameter signature `(p_search_term, p_limit)`. This BREAKS all callers that pass `p_category`, `p_categories`, or `p_threshold`. This includes: frontend `searchSKUs` (passes p_category/p_categories), `autoMatchSKU`, `handleSubmit`, the SKU Directory test panel, and the Edge Function's `trgmSearch`.
- **SKU ID not persisted to po_line_items** — `sku_id` is resolved in frontend state and used for UX validation, but the `create_purchase_order` RPC call passes `p_line_items` without a `sku_id` column. The `po_line_items` table schema also has no `sku_id` column. SKU resolution is UI-only and NOT stored.

### Completely missing:

- **`sku_id` column on `po_line_items`** — no way to trace which SKU was matched to a PO line item after save. No persistent linkage.
- **Reranking with Cohere/HuggingFace cross-encoder** — zero code for external reranking services beyond OpenAI.
- **SERPER_API_KEY** — not set in any .env file. Serper path always silently skips.
- **`ANTHROPIC_API_KEY`** in Edge Function env — not in `.env.local`. The `reconcile-po-bill` function (which uses Anthropic) would fail unless set in Supabase Edge Function secrets.
- **Inventory deduction or GRN SKU linkage** — `grn_items` table has no sku_id; no reconciliation of received quantities against SKU catalog.

---

## 4. Critical Missing Links

### 1. BREAKING: `trgm_match_sku` signature mismatch (highest priority)

Migration `20260523101320_flatten_sku_aliases.sql` replaces the full-featured `trgm_match_sku` with a stripped 2-parameter version:

```sql
-- NEW (breaking) signature in flatten_sku_aliases.sql:
CREATE OR REPLACE FUNCTION public.trgm_match_sku(
  p_search_term text,
  p_limit integer DEFAULT 3
)
```

All existing callers pass `p_category`, `p_categories`, and/or `p_threshold` which this version silently ignores (Postgres will error on unknown named params or use positional mismatch). This means:
- Category filtering in `searchSKUs` is broken
- Threshold control is broken
- The Edge Function's `trgmSearch` call with named params fails

**The hybrid/smart versions from `20260522000001_trgm_match_hybrid.sql` were the working production function. The flatten migration overwrites them.**

### 2. SKU ID not persisted to po_line_items

The entire SKU resolution UI exists purely in React state. When a PO is saved via `create_purchase_order` RPC, `p_line_items` contains: `line_number, category_id, item_name, specification, unit, quantity_ordered, unit_rate, ...` — but no `sku_id`. The `po_line_items` table has no `sku_id` column. This means:
- Analytics on material consumption by SKU is impossible
- GRN reconciliation against SKU catalog cannot happen
- The PO detail view cannot show which SKU was matched

### 3. `safely_insert_sku_with_guardrail` bypassed

The semantic deduplication function (which checks `embedding <=> p_embedding < 0.15` before inserting) is never called. Both `handleApproveParametricSku` and `autoAddItemToDictionary` insert directly with `supabase.from('sku_directory').insert(...)`. The `23505` unique_violation catch only handles exact `sku_id` collisions — not semantic duplicates with different IDs.

### 4. SERPER_API_KEY not provisioned

Serper web search context enrichment (which feeds the `generateStructuredSkuWithContext` flow) silently skips when the key is absent. The Edge Function logs the error and continues without web context. The system is degraded without it.

### 5. VITE_OPENAI_API_KEY exposed in browser

`extractFromDocument` and `autoAddItemToDictionary` call `https://api.openai.com/v1/chat/completions` directly from the browser with `import.meta.env.VITE_OPENAI_API_KEY`. This key is publicly readable in the browser bundle — anyone inspecting network requests or the compiled JS can extract it. These calls should go through an Edge Function.

---

## 5. Key Code Excerpts

### `trgm_match_sku` — final (BREAKING) version

```sql
-- supabase/migrations/20260523101320_flatten_sku_aliases.sql
CREATE OR REPLACE FUNCTION public.trgm_match_sku(
  p_search_term text,
  p_limit integer DEFAULT 3
)
RETURNS TABLE (
  sku_id text,
  item_name text,
  category text,
  sub_category text,
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    s.sku_id,
    s.sub_category::text as item_name,
    s.category,
    s.sub_category,
    GREATEST(
      similarity(lower(s.sub_category), lower(p_search_term)),
      similarity(lower(public.sku_aliases_to_clean_text(s.aliases)), lower(p_search_term)),
      ts_rank_cd(s.fts_vector, plainto_tsquery('english', p_search_term))
    ) as final_similarity
  FROM public.sku_directory s
  WHERE s.is_active = true
    AND (
      s.sub_category % p_search_term
      OR public.sku_aliases_to_clean_text(s.aliases) % p_search_term
      OR s.fts_vector @@ plainto_tsquery('english', p_search_term)
    )
  ORDER BY final_similarity DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;
```

**Note:** Also returns `sub_category` column which previous versions did not. Callers expecting only `{sku_id, item_name, category, unit, aliases, similarity}` will get `undefined` for `unit` and `aliases`. The `unit` field (standard_unit) is not in the SELECT at all.

### `trgm_match_sku` — working production version (v4, hybrid)

```sql
-- supabase/migrations/20260522000001_trgm_match_hybrid.sql
-- Key scoring logic:
CASE WHEN s.fts_vector @@ (SELECT query FROM fts_q)
     THEN LEAST(1.0, 0.70 + (ts_rank_cd(s.fts_vector, (SELECT query FROM fts_q), 32) * 2.0))
     ELSE 0.0
END AS fts_score

-- Final score: max of trgm OR structural FTS
LEAST(1.0, GREATEST(trgm_score, fts_score))::float AS similarity
```

### `autoAddItemToDictionary` signature

```typescript
// src/pages/NewPurchaseOrder.tsx L552-555
async function autoAddItemToDictionary(itemId: string, viaAI: boolean = false, explicitSkuData?: any) {
  const li = lineItemsRef.current.find(l => l.id === itemId);
  if (!li || li.sku_id || li.item_name.trim().length < 2) return;
  if (dictAddingIds.has(itemId)) return;
```

### Confidence threshold constants (hardcoded magic numbers)

```typescript
// NewPurchaseOrder.tsx L347, L361, L410, L419, L1056 — trgm auto-commit threshold
if (candidates[0].similarity >= 0.82) { /* auto-commit */ }
if (top.similarity >= 0.82) { /* auto-commit */ }

// NewPurchaseOrder.tsx L362, L419 — needs_review boundary  
needs_review: top.similarity < 0.92   // in searchSKUs path
needs_review: top.similarity < 0.85   // in autoMatchSKU path (INCONSISTENT)

// NewPurchaseOrder.tsx L1726 — chip display threshold
dbCandidates.filter(c => c.similarity > 0.60)

// sku-matcher/index.ts L347 — Edge Function auto-commit
if (candidates.length > 0 && candidates[0].similarity >= 0.82) { /* auto-commit */ }

// sku-matcher/index.ts L308 — LLM confidence threshold
needs_review: !skuValid || (result.confidence ?? 0) < 70

// SKUDirectory.tsx L139 — test panel uses p_threshold: 0.05
```

**Summary of magic numbers:** `0.82` (auto-commit), `0.92` (clean/review split), `0.85` (inconsistent in autoMatchSKU), `0.75` (chip display threshold in PO list), `0.60` (chip render filter), `0.10` (default p_threshold), `0.15` (semantic distance for guardrail), `70` (LLM confidence needs_review boundary).

### Redbox trigger logic

```typescript
// NewPurchaseOrder.tsx L1615-1617
const needsReview = !li.sku_id && (li.validation_metrics || li.ai_suggested_name || li.needs_review || li.expandedReview);
const isRedbox = li.needs_review || li.expandedReview;
const isSuccess = aiJustMatchedIds.has(li.id);
```

### `sku_directory` full schema

```sql
-- supabase/migrations/20260515000000_sku_directory.sql
CREATE TABLE sku_directory (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku_id            text UNIQUE NOT NULL,          -- FORMAT: CATEGORY-SUBCATEGORY-DIMENSION-VARIANT-GRADE
  category          text NOT NULL,
  sub_category      text NOT NULL,
  dimension         text,
  variant           text,
  grade             text,
  aliases           text[],                        -- GIN indexed
  standard_unit     text NOT NULL,
  is_active         boolean DEFAULT true,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
  -- Added later via ALTER TABLE:
  -- fts_vector      tsvector                      (migration 20260519000003)
  -- embedding       vector(1536)                  (migration 20260522000002)
);
```

### `safely_insert_sku_with_guardrail` — built but never called

```sql
-- supabase/migrations/20260522000002_semantic_guardrail.sql
-- Semantic duplicate check:
SELECT sku_id INTO v_existing_sku_id
FROM public.sku_directory
WHERE embedding <=> p_embedding < 0.15   -- cosine distance threshold
ORDER BY embedding <=> p_embedding ASC
LIMIT 1;
IF v_existing_sku_id IS NOT NULL THEN
  RETURN v_existing_sku_id;   -- return existing instead of inserting duplicate
END IF;
```

---

## 6. Environment Dependencies

### Required environment variables

| Variable | Used In | Status | Notes |
|----------|---------|--------|-------|
| `VITE_SUPABASE_URL` | `src/lib/supabase.ts` | ✅ Set in `.env.local` | `https://momzyincivvpngazvfgq.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `src/lib/supabase.ts` | ✅ Set in `.env.local` | Publishable key present |
| `VITE_SUPABASE_SERVICE_ROLE_KEY` | `src/lib/supabase-admin.ts` | ⚠️ Set in `.env.local` | **CRITICAL SECURITY ISSUE: service role key in browser bundle** |
| `VITE_OPENAI_API_KEY` | `NewPurchaseOrder.tsx` L558, L688, L908 | ⚠️ Set in `.env.local` | **CRITICAL SECURITY ISSUE: OpenAI key exposed in browser** |
| `OPENAI_API_KEY` | `sku-matcher/index.ts` L5 | Set in Supabase Edge Function secrets (not in local .env) | Required for Edge Function |
| `SUPABASE_URL` | All Edge Functions | Set automatically by Supabase runtime | Not in local .env |
| `SUPABASE_SERVICE_ROLE_KEY` | All Edge Functions | Set automatically by Supabase runtime | Not in local .env |
| `SERPER_API_KEY` | `sku-matcher/index.ts` L442 | ❌ NOT SET anywhere | Serper web search silently disabled |
| `ANTHROPIC_API_KEY` | `ai-extract-entry/index.ts` L214, `reconcile-po-bill/index.ts` L122 | Must be set in Supabase secrets | Not in any local .env |
| `WA_VERIFY_TOKEN` | `whatsapp-webhook/index.ts` L15 | Must be set in Supabase secrets | Not in any local .env |

### Hardcoded credentials and values in code

1. **OpenAI API key in `.env.local`** — The `.env.local` file contains:
   - `VITE_OPENAI_API_KEY=sk-proj-lq0xeyNQXY0eWAyS6jn...` — live OpenAI production key
   - `VITE_SUPABASE_SERVICE_ROLE_KEY=sb_secret_GDch7xGb6nwCbONb...` — live Supabase service role key
   - Both are prefixed `VITE_` meaning they are bundled into the client-side JavaScript and visible to any browser user.

2. **Magic threshold numbers** — `0.82`, `0.92`, `0.85`, `0.75`, `0.60`, `0.10`, `0.15`, `70` — scattered across `NewPurchaseOrder.tsx` and `sku-matcher/index.ts` with no shared constants file.

3. **Model names hardcoded** — `'gpt-4.1'`, `'gpt-4.1-mini'`, `'text-embedding-3-small'`, `'claude-haiku-4-5-20251001'` — hardcoded strings; no central configuration.

4. **Duplicate `VENDOR_TO_SKU_CATEGORIES`** — identical Record<string, string[]> defined in both `sku-matcher/index.ts` (L68-91) and `NewPurchaseOrder.tsx` (L33-56). Any update must be made in both places.

---

## 7. Recommended Implementation Order

### Tier 1 — Fix breaking issues (prerequisite for everything else)

**1. Roll back or fix `trgm_match_sku` signature** (migration `20260523101320_flatten_sku_aliases.sql`)

The flatten migration BREAKS the working v4 hybrid function. Either:
- Write a new migration that restores the full 5-parameter signature with all signals (trgm + word_similarity + FTS) matching the hybrid version from `20260522000001_trgm_match_hybrid.sql`
- OR update all frontend callers to use the new 2-parameter signature and accept the loss of category filtering and threshold control

The v4 hybrid function (`20260522000001`) is the correct production version. The flatten migration should be treated as a bug.

**2. Add `sku_id` column to `po_line_items`** — without this, all SKU resolution is ephemeral.

```sql
ALTER TABLE public.po_line_items ADD COLUMN IF NOT EXISTS sku_id text REFERENCES public.sku_directory(sku_id);
```

Then update `create_purchase_order` RPC and the `lineItemRows` mapping in `NewPurchaseOrder.tsx` (L829-847) to include `sku_id`.

### Tier 2 — Security fixes

**3. Move OpenAI calls from browser to Edge Functions**

`extractFromDocument` (L904) and `autoAddItemToDictionary` (L602-617) call OpenAI directly from the browser with `VITE_OPENAI_API_KEY`. This key should be server-side only. These should call a new Edge Function or be routed through the existing `sku-matcher` function.

**4. Remove `VITE_SUPABASE_SERVICE_ROLE_KEY` from browser environment**

`src/lib/supabase-admin.ts` uses the service role key client-side. Service role keys bypass all RLS. This must be removed from the Vite VITE_ prefix namespace immediately.

### Tier 3 — Wire existing built-but-unwired components

**5. Wire `safely_insert_sku_with_guardrail`**

Replace direct `supabase.from('sku_directory').insert(...)` calls in `handleApproveParametricSku` (L505) and `autoAddItemToDictionary` (L621) with `supabase.rpc('safely_insert_sku_with_guardrail', {...})` to enable semantic deduplication.

**6. Wire `classify_sku_family_relationship`**

Call this from the `generateStructuredSkuWithContext` flow (in the Edge Function) after extracting attributes, to populate `inherited_sku_id` and `relationship_type`. This enables the parametric family matrix to suggest related SKUs.

**7. Provision `SERPER_API_KEY`**

Add to Supabase Edge Function secrets. This activates the web context enrichment path that currently always silently skips.

### Tier 4 — Deduplication and consolidation

**8. Consolidate `VENDOR_TO_SKU_CATEGORIES`**

Move to a shared location (e.g., a Supabase database table, or a shared TypeScript module imported by both the Edge Function and frontend). Currently defined identically in two places with divergence risk.

**9. Create a `SKU_THRESHOLDS` constants file**

```typescript
// src/lib/skuThresholds.ts
export const SKU_AUTO_COMMIT_THRESHOLD = 0.82;
export const SKU_CLEAN_MATCH_THRESHOLD = 0.92;
export const SKU_CHIP_DISPLAY_THRESHOLD = 0.60;
export const SKU_SEMANTIC_DEDUP_DISTANCE = 0.15;
export const LLM_CONFIDENCE_REVIEW_BOUNDARY = 70;
```

**10. Deprecate `find_sku_by_alias` and `generate_sku_id`**

These are dead code. `find_sku_by_alias` is superseded by `trgm_match_sku`. `generate_sku_id` is superseded by ad-hoc client-side string construction. Either wire them properly or drop them in a migration.

### Tier 5 — Downstream consumers

**11. Add SKU-aware GRN reconciliation**

`grn_items` receives goods against `po_items`. Once `po_line_items` has `sku_id`, the GRN can track inventory by SKU. This enables a `SELECT sku_id, SUM(qty_received) FROM grn_items JOIN po_line_items USING (po_item_id)` inventory ledger.

**12. Analytics: SKU consumption by project**

With `sku_id` on `po_line_items` and `project_id` on `po_items`, the procurement module can produce spend-by-material reports.

---

## Appendix: Migration Execution Order (Chronological)

All migrations are date-prefixed and apply in this order:

1. `20260515000000_sku_directory.sql` — base table + aliases GIN index + find_sku_by_alias + generate_sku_id
2. `20260519000001_sku_matcher_trgm.sql` — pg_trgm + trgm indexes + trgm_match_sku v1
3. `20260519000002_trgm_multicategory.sql` — trgm_match_sku v2 (adds p_categories)
4. `20260519000003_sku_smart_match.sql` — fts_vector + trigger + sku_normalize_query + trgm_match_sku v3 (word_similarity + FTS bonus, drops old single-param overload)
5. `20260521000001_procurement_module.sql` — po_items, grn_items, material_requests, rfqs (no SKU linkage)
6. `20260522000001_trgm_match_hybrid.sql` — trgm_match_sku v4 (structural FTS rank, performance fix, 0.70 FTS base)
7. `20260522000002_semantic_guardrail.sql` — pgvector + embedding column + safely_insert_sku_with_guardrail
8. `20260522000004_classify_sku_family_relationship.sql` — classify_sku_family_relationship (UNWIRED)
9. **`20260523101320_flatten_sku_aliases.sql` — trgm_match_sku v5 (BREAKING: strips to 2 params, drops unit/aliases from output, uses 'english' FTS dictionary instead of 'simple')**

The final migration (v5) is the active database state. All v4 callers are broken.
