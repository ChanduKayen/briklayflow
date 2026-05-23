-- ============================================================
-- SKU SMART MATCH — FTS Structural Rank Hybrid
-- ============================================================

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
  aliases    text,
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
      s.standard_unit AS unit,
      s.aliases,
      array_to_string(s.aliases, ', ') AS raw_aliases,
      
      -- PERFORMANCE FIX: Evaluate sku_build_name once per row
      public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade) AS item_name,
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
        similarity(s.item_name, p_search_term),
        similarity(coalesce(public.sku_aliases_text(s.aliases), ''), p_search_term),
        similarity(s.item_name, (SELECT q FROM norm)),
        similarity(coalesce(public.sku_aliases_text(s.aliases), ''), (SELECT q FROM norm)),
        word_similarity(p_search_term, s.item_name || ' ' || coalesce(public.sku_aliases_text(s.aliases), '')),
        word_similarity((SELECT q FROM norm), s.item_name || ' ' || coalesce(public.sku_aliases_text(s.aliases), '')),
        word_similarity(s.item_name, (SELECT q FROM norm))
      ) AS trgm_score,

      -- NEW: Structural FTS Score handling word order inversion natively.
      -- NOTE: We use the 'simple' dictionary to exactly match the index configuration from the column `fts_vector`.
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
  -- NEW: Final score takes the maximum of character/word trgm algorithms OR structural FTS
  LEAST(1.0, GREATEST(trgm_score, fts_score))::float AS similarity
FROM scored
WHERE trgm_score > p_threshold OR fts_score > p_threshold
ORDER BY similarity DESC
LIMIT p_limit;
$$;
