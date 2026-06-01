-- ============================================================
-- Add per-alias MAX similarity as a scoring signal in trgm_match_sku.
--
-- Problem: the prior version concatenates all aliases into one string before
-- calling similarity(). A short vernacular term like "safeda" scores ~0.17
-- against "SAFEDA PLUMBING PUTTY JOINT SEALANT" — falling below the 0.60
-- chip-display threshold even though it is an exact alias match.
--
-- Fix: unnest the aliases array and take the MAX per-alias similarity
-- (both full string and word_similarity). This lets "safeda" score 1.0
-- against the alias "SAFEDA" in the array.
--
-- Return columns are IDENTICAL to the P0 version (no breaking changes):
--   sku_id, item_name, category, unit, aliases (text, comma-sep), similarity
-- ============================================================

BEGIN;

-- Drop the current 5-param overload before replacing it.
DROP FUNCTION IF EXISTS public.trgm_match_sku(text, text, int, float, text[]);

CREATE OR REPLACE FUNCTION public.trgm_match_sku(
  p_search_term text,
  p_category    text    DEFAULT NULL,
  p_limit       int     DEFAULT 6,
  p_threshold   float   DEFAULT 0.10,
  p_categories  text[]  DEFAULT NULL
)
RETURNS TABLE (
  sku_id     text,
  item_name  text,
  category   text,
  unit       text,
  aliases    text,      -- comma-separated; matches TrgmCandidate.aliases in Edge Function
  similarity float
)
LANGUAGE sql SECURITY DEFINER STABLE AS $$
WITH
  norm AS (
    SELECT public.sku_normalize_query(p_search_term) AS q
  ),
  fts_q AS (
    SELECT plainto_tsquery('simple', (SELECT q FROM norm)) AS query
  ),
  filtered_skus AS (
    SELECT
      s.sku_id,
      s.category,
      s.standard_unit                                                           AS unit,
      s.aliases,
      array_to_string(s.aliases, ', ')                                          AS raw_aliases,
      public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade)   AS item_name,
      s.fts_vector
    FROM public.sku_directory s
    WHERE s.is_active = true
      AND (
        (p_category IS NULL AND p_categories IS NULL)
        OR (p_category IS NOT NULL AND s.category = p_category)
        OR (p_categories IS NOT NULL AND s.category = ANY(p_categories))
      )
  ),
  scored AS (
    SELECT
      s.sku_id,
      s.item_name,
      s.category,
      s.unit,
      s.aliases,
      s.raw_aliases,

      greatest(
        -- Signal A: full-string trgm on raw and normalised query vs item name + alias blob
        similarity(s.item_name,                                               p_search_term),
        similarity(coalesce(public.sku_aliases_text(s.aliases), ''),          p_search_term),
        similarity(s.item_name,                                               (SELECT q FROM norm)),
        similarity(coalesce(public.sku_aliases_text(s.aliases), ''),          (SELECT q FROM norm)),
        -- Signal B: word_similarity — catches short query inside long alias string
        word_similarity(p_search_term,         s.item_name || ' ' || coalesce(public.sku_aliases_text(s.aliases), '')),
        word_similarity((SELECT q FROM norm),  s.item_name || ' ' || coalesce(public.sku_aliases_text(s.aliases), '')),
        -- Signal C: reverse word_similarity — SKU name as phrase inside long query
        word_similarity(s.item_name, (SELECT q FROM norm)),
        -- Signal D: per-alias MAX — "safeda" vs alias["SAFEDA"] → 1.0 instead of ~0.17
        COALESCE(
          (SELECT MAX(GREATEST(
                    similarity(lower(a), lower(p_search_term)),
                    similarity(lower(a), lower((SELECT q FROM norm))),
                    word_similarity(lower(p_search_term), lower(a)),
                    word_similarity(lower((SELECT q FROM norm)), lower(a))
                  ))
           FROM unnest(s.aliases) a),
          0.0
        )
      ) AS trgm_score,

      -- Signal E: structural FTS rank
      CASE WHEN s.fts_vector @@ (SELECT query FROM fts_q)
           THEN LEAST(1.0, 0.70 + (ts_rank_cd(s.fts_vector, (SELECT query FROM fts_q), 32) * 2.0))
           ELSE 0.0
      END AS fts_score

    FROM filtered_skus s
  )
SELECT
  sku_id,
  item_name,
  category,
  unit,
  raw_aliases AS aliases,
  LEAST(1.0, GREATEST(trgm_score, fts_score))::float AS similarity
FROM scored
WHERE trgm_score > p_threshold
   OR fts_score  > p_threshold
   -- Low-threshold alias gate: pass rows where any alias is an exact or very-close match
   -- even if other signals are weak (avoids filtering out perfect alias hits).
   OR EXISTS (
        SELECT 1 FROM unnest(aliases) a
        WHERE similarity(lower(a), lower(p_search_term)) >= 0.4
           OR similarity(lower(a), lower((SELECT q FROM norm))) >= 0.4
      )
ORDER BY similarity DESC
LIMIT p_limit;
$$;

COMMIT;
