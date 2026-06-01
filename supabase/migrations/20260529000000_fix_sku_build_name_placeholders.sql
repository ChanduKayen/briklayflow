-- ============================================================
-- sku_build_name: filter placeholder values out of the built name
--
-- The original definition (20260519000001) was a plain concat:
--   coalesce(sub_category,'') || ' ' || coalesce(dimension,'') || ' ' || ...
-- That meant SKUs with variant='Standard' or grade='Generic' surfaced
-- those placeholders in:
--   - the display name (item_name in trgm_match_sku and get_family_members)
--   - the sku_alias_family_index 'built_name' entries (so users could
--     match against "Plumbing Putty Standard" instead of "Plumbing Putty")
--
-- This migration replaces the function with one that drops any
-- dimension/variant/grade whose lowercased trim is in the PLACEHOLDERS
-- list. sub_category is always included (it's the family identity).
--
-- The function stays IMMUTABLE so it can still be used in the trigram
-- index expression on sku_directory.
-- ============================================================

BEGIN;

DROP INDEX IF EXISTS idx_sku_trgm_name;

CREATE OR REPLACE FUNCTION public.sku_build_name(
  sub_category text,
  dimension    text,
  variant      text,
  grade        text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  PLACEHOLDERS constant text[] := ARRAY[
    'n/a','na','generic','standard','none','default','-','',
    'nil','normal','regular','common','basic','ordinary','null'
  ];
  v_parts text[] := ARRAY[]::text[];
BEGIN
  IF sub_category IS NOT NULL AND trim(sub_category) != '' THEN
    v_parts := v_parts || trim(sub_category);
  END IF;

  IF dimension IS NOT NULL
     AND trim(dimension) != ''
     AND lower(trim(dimension)) != ALL(PLACEHOLDERS) THEN
    v_parts := v_parts || trim(dimension);
  END IF;

  IF variant IS NOT NULL
     AND trim(variant) != ''
     AND lower(trim(variant)) != ALL(PLACEHOLDERS) THEN
    v_parts := v_parts || trim(variant);
  END IF;

  IF grade IS NOT NULL
     AND trim(grade) != ''
     AND lower(trim(grade)) != ALL(PLACEHOLDERS) THEN
    v_parts := v_parts || trim(grade);
  END IF;

  RETURN array_to_string(v_parts, ' ');
END;
$$;

-- Re-create the trigram index on the cleaned built name.
CREATE INDEX IF NOT EXISTS idx_sku_trgm_name
  ON public.sku_directory
  USING gin(public.sku_build_name(sub_category, dimension, variant, grade) gin_trgm_ops);

-- Rebuild the alias-family index so the built_name source entries no
-- longer contain "Standard" / "Generic" / etc.
SELECT public.rebuild_alias_family_index();

COMMIT;
