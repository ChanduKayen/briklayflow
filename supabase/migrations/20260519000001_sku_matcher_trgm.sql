-- ============================================================
-- SKU MATCHER: pg_trgm setup + trgm_match_sku function
-- Called by the sku-matcher Edge Function.
--
-- Schema note: sku_directory has no item_name column.
-- Display name is built from sub_category, dimension, variant, grade.
-- aliases is text[] — trgm index uses array_to_string expression.
-- ============================================================

-- Enable trigram extension
create extension if not exists pg_trgm;

-- IMMUTABLE helpers ────────────────────────────────────────────
-- concat_ws and array_to_string are both STABLE in PG (their element
-- output functions may vary), so they cannot appear in index expressions.
-- These wrappers assert IMMUTABLE for the specific text-only signatures
-- we use, which is safe and correct for text input.

create or replace function public.sku_build_name(
  sub_category text, dimension text, variant text, grade text
)
returns text language sql immutable as $$
  select coalesce(sub_category, '') || ' ' || coalesce(dimension, '') || ' ' || coalesce(variant, '') || ' ' || coalesce(grade, '')
$$;

create or replace function public.sku_aliases_text(aliases text[])
returns text language sql immutable as $$
  select array_to_string(aliases, ' ')
$$;

-- Trigram index on constructed item name
create index if not exists idx_sku_trgm_name
  on public.sku_directory
  using gin(public.sku_build_name(sub_category, dimension, variant, grade) gin_trgm_ops);

-- Trigram index on aliases array
create index if not exists idx_sku_trgm_aliases
  on public.sku_directory
  using gin(public.sku_aliases_text(aliases) gin_trgm_ops);

-- idx_sku_category on (category, sub_category) already exists from sku_directory migration

-- ── trgm_match_sku ────────────────────────────────────────────
-- Returns top candidates per search term.
-- Called from Edge Function via supabase.rpc() to avoid round-trips.

create or replace function public.trgm_match_sku(
  p_search_term text,
  p_category    text    default null,
  p_limit       int     default 5,
  p_threshold   float   default 0.2
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
    and (p_category is null or s.category = p_category)
    and greatest(
      similarity(public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade), p_search_term),
      similarity(coalesce(public.sku_aliases_text(s.aliases), ''), p_search_term)
    ) > p_threshold
  order by similarity desc
  limit p_limit;
$$;
