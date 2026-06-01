/**
 * SKU matching threshold constants.
 * Single source of truth for the frontend — do NOT hardcode these values elsewhere.
 *
 * IMPORTANT: The edge function (supabase/functions/sku-matcher/index.ts) maintains
 * a matching set of constants at the top of the file. If you change a value here,
 * update BOTH files.
 */

// Auto-commit: at or above this similarity score, the match is accepted without user review
export const SKU_AUTO_COMMIT = 0.82;

// Clean match: at or above this score, needs_review is false (high-confidence match)
export const SKU_CLEAN_MATCH = 0.92;

// Chip display: above this score, a candidate appears as a clickable chip in the PO form
export const SKU_CHIP_DISPLAY = 0.60;

// Low-confidence display floor: when the alias index found NOTHING, trgm is the only
// signal we have, so show and bridge results down to this floor (rendered dim, with a
// "?") instead of hiding them. Frontend-only — the edge function does not use this.
export const SKU_LOW_DISPLAY = 0.25;

// "Did you mean?" only surfaces an AI guess at or above this confidence. Frontend-only.
export const DYM_CONFIDENCE_FLOOR = 0.5;

// Default trgm query threshold: minimum similarity the RPC returns (filters noise)
export const SKU_QUERY_THRESHOLD = 0.10;

// Semantic dedup distance: cosine distance below this = near-duplicate (used by guardrail RPC)
export const SKU_SEMANTIC_DEDUP_DISTANCE = 0.15;

// Reranker review boundary: Cohere/LLM confidence % below this sets needs_review = true
export const SKU_RERANK_REVIEW_THRESHOLD = 70;
