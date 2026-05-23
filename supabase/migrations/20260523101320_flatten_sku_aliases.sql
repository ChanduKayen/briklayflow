CREATE OR REPLACE FUNCTION public.sku_aliases_to_clean_text(aliases_array text[])
RETURNS text AS $$
BEGIN
  RETURN coalesce(array_to_string(aliases_array, ' '), '');
END;
$$ LANGUAGE plpgsql IMMUTABLE;

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
