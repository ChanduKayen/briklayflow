-- ============================================================
-- SKU DIRECTORY
-- FORMAT: CATEGORY-SUBCATEGORY-DIMENSION-VARIANT-GRADE
-- ============================================================

-- STEP 1: DROP AND RECREATE TABLE
DROP TABLE IF EXISTS sku_directory;

CREATE TABLE sku_directory (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Canonical ID — 5 parts, full words
  -- FORMAT: CATEGORY-SUBCATEGORY-DIMENSION-VARIANT-GRADE
  sku_id            text UNIQUE NOT NULL,

  -- The 5 canonical columns
  category          text NOT NULL,
  sub_category      text NOT NULL,
  dimension         text,
  variant           text,
  grade             text,

  -- Discovery — real world names
  aliases           text[],

  -- How it is measured and transacted
  standard_unit     text NOT NULL,

  -- Meta
  is_active         boolean DEFAULT true,
  notes             text,
  created_at        timestamptz DEFAULT now(),
  updated_at        timestamptz DEFAULT now()
);

CREATE INDEX idx_sku_aliases
  ON sku_directory USING GIN(aliases);

CREATE INDEX idx_sku_category
  ON sku_directory(category, sub_category);

ALTER TABLE sku_directory
  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated read SKUs"
  ON sku_directory FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "Management manage SKUs"
  ON sku_directory FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
      AND role IN ('management','principal')
    )
  );

-- ============================================================
-- STEP 2: SKU ID GENERATION FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION generate_sku_id(
  p_category     text,
  p_sub_category text,
  p_dimension    text DEFAULT NULL,
  p_variant      text DEFAULT NULL,
  p_grade        text DEFAULT NULL
) RETURNS text AS $$
  SELECT string_agg(part, '-')
  FROM (
    VALUES
      (UPPER(REGEXP_REPLACE(p_category,     '[^A-Z0-9]', '', 'gi'))),
      (UPPER(REGEXP_REPLACE(p_sub_category, '[^A-Z0-9]', '', 'gi'))),
      (COALESCE(
        NULLIF(UPPER(REGEXP_REPLACE(p_dimension, '\s+', '', 'g')), ''),
        'STD'
      )),
      (COALESCE(
        NULLIF(UPPER(REGEXP_REPLACE(p_variant,   '[^A-Z0-9]', '', 'gi')), ''),
        'STD'
      )),
      (COALESCE(
        NULLIF(UPPER(REGEXP_REPLACE(p_grade,     '[^A-Z0-9]', '', 'gi')), ''),
        'STD'
      ))
  ) AS t(part)
$$ LANGUAGE sql IMMUTABLE;

-- ============================================================
-- STEP 3: ALIAS SEARCH FUNCTION
-- ============================================================

CREATE OR REPLACE FUNCTION find_sku_by_alias(search_term text)
RETURNS TABLE(
  sku_id        text,
  category      text,
  sub_category  text,
  dimension     text,
  variant       text,
  grade         text,
  standard_unit text,
  confidence    text
) AS $$
BEGIN
  RETURN QUERY

  -- Exact alias match → HIGH
  SELECT
    s.sku_id, s.category, s.sub_category,
    s.dimension, s.variant, s.grade,
    s.standard_unit, 'HIGH'::text
  FROM sku_directory s
  WHERE LOWER(search_term) = ANY(
    SELECT LOWER(a)
    FROM UNNEST(s.aliases) a
  )
  AND s.is_active = true

  UNION ALL

  -- Partial alias match → MEDIUM
  SELECT
    s.sku_id, s.category, s.sub_category,
    s.dimension, s.variant, s.grade,
    s.standard_unit, 'MEDIUM'::text
  FROM sku_directory s
  WHERE EXISTS (
    SELECT 1 FROM UNNEST(s.aliases) a
    WHERE LOWER(a) LIKE '%' || LOWER(search_term) || '%'
    OR LOWER(search_term) LIKE '%' || LOWER(a) || '%'
  )
  AND s.is_active = true

  UNION ALL

  -- Category / sub-category name match → LOW
  SELECT
    s.sku_id, s.category, s.sub_category,
    s.dimension, s.variant, s.grade,
    s.standard_unit, 'LOW'::text
  FROM sku_directory s
  WHERE (
    LOWER(s.category) LIKE '%' || LOWER(search_term) || '%'
    OR LOWER(s.sub_category) LIKE '%' || LOWER(search_term) || '%'
  )
  AND s.is_active = true

  ORDER BY confidence DESC
  LIMIT 5;
END;
$$ LANGUAGE plpgsql;
