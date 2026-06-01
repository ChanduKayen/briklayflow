-- Briklay — ROOT CAUSE FIX: search_alias_family returned alphabetically-first families,
-- not the most-similar ones. DISTINCT ON (category, sub_category) forced ORDER BY to lead
-- with category/sub_category, so the score DESC only broke per-family ties; LIMIT then took
-- the alphabetically-first families that cleared the permissive >=0.1 bar. The correct family
-- (e.g. "Modular Electrical Box", similarity 1.0) was computed then dropped by LIMIT because
-- it sorts late alphabetically. Fix: dedupe-to-best-term in a subquery, THEN rank families by
-- similarity DESC in the outer query before LIMIT.
--
-- Supersedes the ordering of 20260531000000 (which fixed the SET/0A000 + 42501 errors).
-- Signature, params, return columns, threshold, and SECURITY DEFINER are all PRESERVED.
-- Only the result ORDERING is corrected. Still no SET anywhere (the 0.1 cutoff is inline).

CREATE OR REPLACE FUNCTION public.search_alias_family(
  p_search_term     text,
  p_category        text   DEFAULT NULL::text,
  p_categories      text[] DEFAULT NULL::text[],
  p_limit           integer DEFAULT 5,
  p_min_similarity  double precision DEFAULT 0.3
)
 RETURNS TABLE(matched_term text, category text, sub_category text, source text,
               family_size integer, similarity double precision)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
AS $function$
DECLARE
  p_normalized text;
BEGIN
  p_normalized := lower(trim(public.sku_normalize_query(p_search_term)));

  RETURN QUERY
  SELECT
    ranked.matched_term,
    ranked.category,
    ranked.sub_category,
    ranked.source,
    ranked.family_size,
    ranked.similarity
  FROM (
    -- Inner: one row per family = its best-scoring term. (DISTINCT ON dictates this ORDER BY.)
    SELECT DISTINCT ON (afi.category, afi.sub_category)
      afi.term        AS matched_term,
      afi.category     AS category,
      afi.sub_category AS sub_category,
      afi.source       AS source,
      afi.family_size  AS family_size,
      GREATEST(
        similarity(afi.term, p_normalized),
        word_similarity(p_normalized, afi.term)
      )::float         AS similarity
    FROM public.sku_alias_family_index afi
    WHERE (p_category   IS NULL OR afi.category = p_category)
      AND (p_categories IS NULL OR afi.category = ANY(p_categories))
      AND (
        similarity(afi.term, p_normalized) >= 0.1
        OR word_similarity(p_normalized, afi.term) >= p_min_similarity
      )
    ORDER BY afi.category, afi.sub_category,
             GREATEST(similarity(afi.term, p_normalized),
                      word_similarity(p_normalized, afi.term)) DESC
  ) ranked
  -- Outer: NOW rank families against each other by score, THEN limit.
  ORDER BY ranked.similarity DESC
  LIMIT p_limit;
END;
$function$;

-- ── Verify immediately after applying ────────────────────────────────────────
-- Expect "Modular Electrical Box" as the #1 row at similarity ~1.0:
--   select * from search_alias_family('modular electrical box');
--   select * from search_alias_family('Modular Electrical Box 2 * 3');
-- Spot-check a few other families to confirm catalog-wide correctness:
--   select * from search_alias_family('cpvc pipe 1 inch');
--   select * from search_alias_family('tmt 12mm');
