-- Add p_categories text[] to trgm_match_sku for multi-category filtering
-- (backward-compatible: old callers using p_category still work)

create or replace function public.trgm_match_sku(
  p_search_term text,
  p_category    text    default null,
  p_limit       int     default 5,
  p_threshold   float   default 0.2,
  p_categories  text[]  default null
)
returns table (
  sku_id     text,
  item_name  text,
  category   text,
  unit       text,
  aliases    text,
  similarity float
)
language sql security definer stable as $$
  select
    s.sku_id,
    public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade) as item_name,
    s.category,
    s.standard_unit                                                         as unit,
    array_to_string(s.aliases, ', ')                                        as aliases,
    greatest(
      similarity(public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade), p_search_term),
      similarity(coalesce(public.sku_aliases_text(s.aliases), ''), p_search_term)
    ) as similarity
  from public.sku_directory s
  where
    s.is_active = true
    and (
      (p_category is null and p_categories is null)
      or (p_category is not null and s.category = p_category)
      or (p_categories is not null and s.category = any(p_categories))
    )
    and greatest(
      similarity(public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade), p_search_term),
      similarity(coalesce(public.sku_aliases_text(s.aliases), ''), p_search_term)
    ) > p_threshold
  order by similarity desc
  limit p_limit;
$$;
