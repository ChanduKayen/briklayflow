-- ============================================================
-- Fix: search_alias_family could never run.
-- ============================================================
-- The original (20260524000000) was declared STABLE but ran
--   SET LOCAL pg_trgm.similarity_threshold = 0.1;
-- in its body → SQLSTATE 0A000 ("SET is not allowed in a
-- non-volatile function") on EVERY call → HTTP 400. So the fast
-- alias-index path never worked; resolution always fell through
-- to trgm / AI.
--
-- Moving the GUC to the function's SET clause then failed with
--   42501: permission denied to set parameter "pg_trgm.similarity_threshold"
-- because the Supabase migration role can't set that extension GUC.
--
-- Correct fix: don't touch the GUC at all. The only reason it was
-- lowered to 0.1 was to make the `%` operator more permissive, and
-- `a % b` is BY DEFINITION `similarity(a, b) >= pg_trgm.similarity_threshold`.
-- So we replace `afi.term % p_normalized` with an explicit
-- `similarity(afi.term, p_normalized) >= 0.1` — identical matching
-- behaviour at a 0.1 cutoff, with no SET and no special privileges.
-- (Trade-off: the explicit comparison doesn't use the trgm GIN index
-- the way `%` can; fine for this small alias-index table, and the
-- WHERE already OR's in a non-indexable word_similarity term anyway.)

CREATE OR REPLACE FUNCTION public.search_alias_family(
  p_search_term   text,
  p_category      text     DEFAULT NULL,
  p_categories    text[]   DEFAULT NULL,
  p_limit         integer  DEFAULT 5,
  p_min_similarity float   DEFAULT 0.3
)
RETURNS TABLE (
  matched_term text,
  category     text,
  sub_category text,
  source       text,
  family_size  integer,
  similarity   float
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
AS $$
DECLARE
  p_normalized text;
BEGIN
  -- No SET anywhere: the 0.1 cutoff is applied inline below.
  p_normalized := lower(trim(public.sku_normalize_query(p_search_term)));

  RETURN QUERY
  SELECT DISTINCT ON (afi.category, afi.sub_category)
    afi.term        AS matched_term,
    afi.category,
    afi.sub_category,
    afi.source,
    afi.family_size,
    GREATEST(
      similarity(afi.term, p_normalized),
      word_similarity(p_normalized, afi.term)
    )::float AS similarity
  FROM public.sku_alias_family_index afi
  WHERE (p_category IS NULL OR afi.category = p_category)
    AND (p_categories IS NULL OR afi.category = ANY(p_categories))
    AND (
      similarity(afi.term, p_normalized) >= 0.1
      OR word_similarity(p_normalized, afi.term) >= p_min_similarity
    )
  ORDER BY afi.category, afi.sub_category,
    GREATEST(similarity(afi.term, p_normalized), word_similarity(p_normalized, afi.term)) DESC
  LIMIT p_limit;
END;
$$;
