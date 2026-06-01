-- ============================================================
-- Alias-Index + Tree Depth + Statement-Level Trigger (v2)
--
-- Parts:
--   1. pg_trgm similarity threshold (explicit)
--   2. sku_alias_family_index table + indexes
--   3. rebuild_alias_family_index() — full rebuild from scratch
--   4. refresh_alias_families(jsonb) — partial rebuild for trigger
--   5. Statement-level triggers (INSERT + UPDATE) — fires ONCE per batch
--   6. search_alias_family() RPC
--   7. get_family_members() RPC
--   8. get_sku_family_profile() RPC (replaces any prior version)
-- ============================================================

BEGIN;

-- 1. Explicit trigram threshold set inside search_alias_family (ALTER DATABASE
--    is not permitted in Supabase migrations; SET LOCAL is used instead).

-- ============================================================
-- 2. Alias-to-family index table
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sku_alias_family_index (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  term        text    NOT NULL,
  category    text    NOT NULL,
  sub_category text   NOT NULL,
  source      text    NOT NULL DEFAULT 'alias',  -- 'alias' | 'sub_category' | 'built_name'
  family_size integer NOT NULL DEFAULT 1,
  UNIQUE(term, category, sub_category)
);

CREATE INDEX IF NOT EXISTS idx_alias_family_trgm
  ON public.sku_alias_family_index USING gin(term gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_alias_family_term
  ON public.sku_alias_family_index(term);
CREATE INDEX IF NOT EXISTS idx_alias_family_cat_sub
  ON public.sku_alias_family_index(category, sub_category);

-- ============================================================
-- 3. Full rebuild function
-- ============================================================

CREATE OR REPLACE FUNCTION public.rebuild_alias_family_index()
RETURNS void AS $$
BEGIN
  TRUNCATE public.sku_alias_family_index;

  -- Source 1: Explicit aliases
  INSERT INTO public.sku_alias_family_index (term, category, sub_category, source, family_size)
  SELECT DISTINCT
    lower(trim(a)), s.category, s.sub_category, 'alias',
    COUNT(*) OVER (PARTITION BY s.category, s.sub_category)
  FROM public.sku_directory s, unnest(s.aliases) a
  WHERE s.is_active = true AND trim(a) != ''
  ON CONFLICT (term, category, sub_category) DO UPDATE
    SET family_size = EXCLUDED.family_size;

  -- Source 2: sub_category itself (canonical name IS a search term)
  INSERT INTO public.sku_alias_family_index (term, category, sub_category, source, family_size)
  SELECT DISTINCT
    lower(trim(s.sub_category)), s.category, s.sub_category, 'sub_category',
    COUNT(*) OVER (PARTITION BY s.category, s.sub_category)
  FROM public.sku_directory s WHERE s.is_active = true
  ON CONFLICT (term, category, sub_category) DO UPDATE
    SET family_size = EXCLUDED.family_size, source = 'sub_category';

  -- Source 3: Built names ("TMT 12mm Fe500" style)
  INSERT INTO public.sku_alias_family_index (term, category, sub_category, source, family_size)
  SELECT DISTINCT
    lower(trim(public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade))),
    s.category, s.sub_category, 'built_name',
    COUNT(*) OVER (PARTITION BY s.category, s.sub_category)
  FROM public.sku_directory s
  WHERE s.is_active = true
    AND public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade) != s.sub_category
  ON CONFLICT (term, category, sub_category) DO UPDATE
    SET family_size = EXCLUDED.family_size;
END;
$$ LANGUAGE plpgsql;

SELECT public.rebuild_alias_family_index();

-- ============================================================
-- 4. Partial rebuild helper (used by triggers)
-- ============================================================

CREATE OR REPLACE FUNCTION public.refresh_alias_families(p_families jsonb)
RETURNS void AS $$
DECLARE
  v_family record;
BEGIN
  FOR v_family IN SELECT * FROM jsonb_to_recordset(p_families) AS x(category text, sub_category text)
  LOOP
    DELETE FROM public.sku_alias_family_index
    WHERE category = v_family.category AND sub_category = v_family.sub_category;

    -- aliases
    INSERT INTO public.sku_alias_family_index (term, category, sub_category, source, family_size)
    SELECT DISTINCT lower(trim(a)), s.category, s.sub_category, 'alias',
      COUNT(*) OVER (PARTITION BY s.category, s.sub_category)
    FROM public.sku_directory s, unnest(s.aliases) a
    WHERE s.is_active = true AND s.category = v_family.category
      AND s.sub_category = v_family.sub_category AND trim(a) != ''
    ON CONFLICT (term, category, sub_category) DO UPDATE SET family_size = EXCLUDED.family_size;

    -- sub_category
    INSERT INTO public.sku_alias_family_index (term, category, sub_category, source, family_size)
    SELECT DISTINCT lower(trim(s.sub_category)), s.category, s.sub_category, 'sub_category',
      COUNT(*) OVER (PARTITION BY s.category, s.sub_category)
    FROM public.sku_directory s
    WHERE s.is_active = true AND s.category = v_family.category AND s.sub_category = v_family.sub_category
    ON CONFLICT (term, category, sub_category) DO UPDATE SET family_size = EXCLUDED.family_size;

    -- built names
    INSERT INTO public.sku_alias_family_index (term, category, sub_category, source, family_size)
    SELECT DISTINCT
      lower(trim(public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade))),
      s.category, s.sub_category, 'built_name',
      COUNT(*) OVER (PARTITION BY s.category, s.sub_category)
    FROM public.sku_directory s
    WHERE s.is_active = true AND s.category = v_family.category AND s.sub_category = v_family.sub_category
      AND public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade) != s.sub_category
    ON CONFLICT (term, category, sub_category) DO UPDATE SET family_size = EXCLUDED.family_size;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- ============================================================
-- 5. Statement-level triggers
--    Two separate functions to avoid transition table scoping issues:
--    INSERT fn uses only new_rows; UPDATE fn uses both old_rows + new_rows.
-- ============================================================

-- Drop any existing row-level trigger from prior migrations
DROP TRIGGER IF EXISTS trg_update_alias_family_index ON public.sku_directory;
DROP TRIGGER IF EXISTS trg_alias_index_after_insert  ON public.sku_directory;
DROP TRIGGER IF EXISTS trg_alias_index_after_update  ON public.sku_directory;

-- INSERT trigger function (new_rows only)
CREATE OR REPLACE FUNCTION public.trg_alias_index_after_insert_fn()
RETURNS trigger AS $$
DECLARE
  v_affected_families jsonb;
BEGIN
  SELECT jsonb_agg(DISTINCT jsonb_build_object('category', category, 'sub_category', sub_category))
  INTO v_affected_families
  FROM new_rows;

  IF v_affected_families IS NOT NULL THEN
    PERFORM public.refresh_alias_families(v_affected_families);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- UPDATE trigger function (old_rows + new_rows)
CREATE OR REPLACE FUNCTION public.trg_alias_index_after_update_fn()
RETURNS trigger AS $$
DECLARE
  v_new_families jsonb;
  v_old_families jsonb;
  v_affected_families jsonb;
BEGIN
  SELECT jsonb_agg(DISTINCT jsonb_build_object('category', category, 'sub_category', sub_category))
  INTO v_new_families
  FROM new_rows;

  -- Include old families whose category/sub_category changed and aren't already in new_families
  SELECT jsonb_agg(DISTINCT jsonb_build_object('category', category, 'sub_category', sub_category))
  INTO v_old_families
  FROM old_rows
  WHERE NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(v_new_families, '[]'::jsonb)) e
    WHERE e->>'category' = old_rows.category AND e->>'sub_category' = old_rows.sub_category
  );

  v_affected_families := COALESCE(v_new_families, '[]'::jsonb);
  IF v_old_families IS NOT NULL THEN
    v_affected_families := v_affected_families || v_old_families;
  END IF;

  IF jsonb_array_length(v_affected_families) > 0 THEN
    PERFORM public.refresh_alias_families(v_affected_families);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Statement-level INSERT trigger
CREATE TRIGGER trg_alias_index_after_insert
  AFTER INSERT ON public.sku_directory
  REFERENCING NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_alias_index_after_insert_fn();

-- Statement-level UPDATE trigger
-- Column-list filters are incompatible with REFERENCING transition tables in Postgres,
-- so this fires on all UPDATE statements; the function itself is cheap.
CREATE TRIGGER trg_alias_index_after_update
  AFTER UPDATE ON public.sku_directory
  REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.trg_alias_index_after_update_fn();

-- ============================================================
-- 6. search_alias_family RPC
-- ============================================================

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
) AS $$
DECLARE
  p_normalized text;
BEGIN
  SET LOCAL pg_trgm.similarity_threshold = 0.1;
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
      afi.term % p_normalized
      OR word_similarity(p_normalized, afi.term) >= p_min_similarity
    )
  ORDER BY afi.category, afi.sub_category,
    GREATEST(similarity(afi.term, p_normalized), word_similarity(p_normalized, afi.term)) DESC
  LIMIT p_limit;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 7. get_family_members RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.get_family_members(
  p_category     text,
  p_sub_category text
)
RETURNS TABLE (
  sku_id    text,
  item_name text,
  dimension text,
  variant   text,
  grade     text,
  unit      text,
  aliases   text
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    s.sku_id,
    public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade) AS item_name,
    s.dimension,
    s.variant,
    s.grade,
    s.standard_unit AS unit,
    public.sku_aliases_text(s.aliases)  AS aliases
  FROM public.sku_directory s
  WHERE s.is_active = true
    AND s.category     = p_category
    AND s.sub_category = p_sub_category
  ORDER BY s.dimension, s.variant, s.grade;
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

-- ============================================================
-- 8. get_sku_family_profile RPC (replaces prior version)
-- ============================================================

DROP FUNCTION IF EXISTS public.get_sku_family_profile(text, text, integer);

CREATE OR REPLACE FUNCTION public.get_sku_family_profile(
  p_category         text,
  p_sub_category     text,
  p_min_family_size  integer DEFAULT 3
)
RETURNS jsonb AS $$
DECLARE
  v_family_size  integer;
  v_dim_count    integer;
  v_var_count    integer;
  v_grade_count  integer;
  v_dim_values   text[];
  v_var_values   text[];
  v_grade_values text[];
  v_unit_mode    text;
  v_siblings     jsonb;
  v_tree_depth   jsonb;
  PLACEHOLDERS   constant text[] := ARRAY['n/a','generic','standard','none','default','-',''];
BEGIN
  SELECT COUNT(*) INTO v_family_size
  FROM public.sku_directory
  WHERE is_active = true AND category = p_category AND sub_category = p_sub_category;

  IF v_family_size < p_min_family_size THEN
    RETURN jsonb_build_object(
      'family_exists', false, 'family_size', v_family_size,
      'category', p_category, 'sub_category', p_sub_category,
      'tree_depth', '[]'::jsonb
    );
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE dimension IS NOT NULL AND lower(trim(dimension)) != ALL(PLACEHOLDERS)),
    COUNT(*) FILTER (WHERE variant   IS NOT NULL AND lower(trim(variant))   != ALL(PLACEHOLDERS)),
    COUNT(*) FILTER (WHERE grade     IS NOT NULL AND lower(trim(grade))     != ALL(PLACEHOLDERS))
  INTO v_dim_count, v_var_count, v_grade_count
  FROM public.sku_directory
  WHERE is_active = true AND category = p_category AND sub_category = p_sub_category;

  SELECT array_agg(DISTINCT dimension ORDER BY dimension) INTO v_dim_values
  FROM public.sku_directory
  WHERE is_active = true AND category = p_category AND sub_category = p_sub_category
    AND dimension IS NOT NULL AND lower(trim(dimension)) != ALL(PLACEHOLDERS);

  SELECT array_agg(DISTINCT variant ORDER BY variant) INTO v_var_values
  FROM public.sku_directory
  WHERE is_active = true AND category = p_category AND sub_category = p_sub_category
    AND variant IS NOT NULL AND lower(trim(variant)) != ALL(PLACEHOLDERS);

  SELECT array_agg(DISTINCT grade ORDER BY grade) INTO v_grade_values
  FROM public.sku_directory
  WHERE is_active = true AND category = p_category AND sub_category = p_sub_category
    AND grade IS NOT NULL AND lower(trim(grade)) != ALL(PLACEHOLDERS);

  SELECT standard_unit INTO v_unit_mode
  FROM public.sku_directory
  WHERE is_active = true AND category = p_category AND sub_category = p_sub_category
  GROUP BY standard_unit ORDER BY COUNT(*) DESC LIMIT 1;

  SELECT jsonb_agg(sub.nm) INTO v_siblings
  FROM (
    SELECT public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade) AS nm
    FROM public.sku_directory s
    WHERE s.is_active = true AND s.category = p_category AND s.sub_category = p_sub_category
    ORDER BY s.created_at DESC LIMIT 6
  ) sub;

  -- Tree depth: attributes with >80% coverage AND ≥2 distinct values, ordered by distinct_count DESC
  WITH dc AS (
    SELECT attr_name, cov, dcnt, vals FROM (VALUES
      ('dimension',
        round((v_dim_count::float / v_family_size * 100)::numeric, 0),
        COALESCE(array_length(v_dim_values, 1), 0),
        COALESCE(to_jsonb(v_dim_values), '[]'::jsonb)),
      ('variant',
        round((v_var_count::float / v_family_size * 100)::numeric, 0),
        COALESCE(array_length(v_var_values, 1), 0),
        COALESCE(to_jsonb(v_var_values), '[]'::jsonb)),
      ('grade',
        round((v_grade_count::float / v_family_size * 100)::numeric, 0),
        COALESCE(array_length(v_grade_values, 1), 0),
        COALESCE(to_jsonb(v_grade_values), '[]'::jsonb))
    ) AS t(attr_name, cov, dcnt, vals)
    WHERE cov > 80 AND dcnt >= 2
    ORDER BY dcnt DESC
  )
  SELECT jsonb_agg(jsonb_build_object(
    'attribute',      attr_name,
    'coverage',       cov,
    'distinct_count', dcnt,
    'values',         vals
  )) INTO v_tree_depth FROM dc;

  RETURN jsonb_build_object(
    'family_exists',  true,
    'family_size',    v_family_size,
    'category',       p_category,
    'sub_category',   p_sub_category,
    'unit',           v_unit_mode,
    'siblings',       COALESCE(v_siblings, '[]'::jsonb),
    'tree_depth',     COALESCE(v_tree_depth, '[]'::jsonb),
    'fields', jsonb_build_object(
      'dimension', jsonb_build_object(
        'expected',      (v_dim_count::float / v_family_size) > 0.8 AND COALESCE(array_length(v_dim_values, 1), 0) >= 2,
        'coverage',      round((v_dim_count::float / v_family_size * 100)::numeric, 0),
        'common_values', COALESCE(to_jsonb(v_dim_values), '[]'::jsonb)
      ),
      'variant', jsonb_build_object(
        'expected',      (v_var_count::float / v_family_size) > 0.8 AND COALESCE(array_length(v_var_values, 1), 0) >= 2,
        'coverage',      round((v_var_count::float / v_family_size * 100)::numeric, 0),
        'common_values', COALESCE(to_jsonb(v_var_values), '[]'::jsonb)
      ),
      'grade', jsonb_build_object(
        'expected',      (v_grade_count::float / v_family_size) > 0.8 AND COALESCE(array_length(v_grade_values, 1), 0) >= 2,
        'coverage',      round((v_grade_count::float / v_family_size * 100)::numeric, 0),
        'common_values', COALESCE(to_jsonb(v_grade_values), '[]'::jsonb)
      )
    )
  );
END;
$$ LANGUAGE plpgsql STABLE SECURITY DEFINER;

COMMIT;
