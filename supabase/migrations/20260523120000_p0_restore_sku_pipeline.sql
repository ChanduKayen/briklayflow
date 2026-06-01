-- ============================================================
-- P0 FIX 1: Restore trgm_match_sku to full 5-param hybrid.
--   Migration 20260523101320_flatten_sku_aliases.sql introduced a new 2-param
--   overload (text, integer) that makes every call with p_search_term + p_limit
--   ambiguous between the two overloads. Drop the 2-param overload; restore the
--   full 5-param version (identical logic to 20260522000001_trgm_match_hybrid).
--
-- P0 FIX 2: Persist sku_id through the purchase order save path.
--   SKU resolution lived only in React state. Add sku_id column to
--   po_line_items, and wire it through create_purchase_order so every resolved
--   SKU is written to the database.
-- ============================================================

BEGIN;

-- ============================================================
-- FIX 1: Drop the ambiguous 2-param overload; restore 5-param hybrid
-- ============================================================

DROP FUNCTION IF EXISTS public.trgm_match_sku(text, integer);

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
  aliases    text,     -- comma-separated string; matches TrgmCandidate.aliases in Edge Function
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
      -- Evaluate sku_build_name once per row (performance)
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
        -- Signal A: full-string trgm on raw query and normalised query
        similarity(s.item_name,                                               p_search_term),
        similarity(coalesce(public.sku_aliases_text(s.aliases), ''),          p_search_term),
        similarity(s.item_name,                                               (SELECT q FROM norm)),
        similarity(coalesce(public.sku_aliases_text(s.aliases), ''),          (SELECT q FROM norm)),
        -- Signal B: word_similarity — catches short query inside long alias string
        word_similarity(p_search_term,         s.item_name || ' ' || coalesce(public.sku_aliases_text(s.aliases), '')),
        word_similarity((SELECT q FROM norm),  s.item_name || ' ' || coalesce(public.sku_aliases_text(s.aliases), '')),
        -- Signal C: reverse word_similarity — SKU name as phrase inside long query
        word_similarity(s.item_name, (SELECT q FROM norm))
      ) AS trgm_score,

      -- Signal D: structural FTS rank — handles word-order inversion natively.
      -- 'simple' dictionary matches the fts_vector index config from 20260519000003;
      -- preserves numeric tokens (12mm, 53, 1HP) that 'english' would strip.
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
  -- Final score: best of character/word trgm OR structural FTS, capped at 1.0
  LEAST(1.0, GREATEST(trgm_score, fts_score))::float AS similarity
FROM scored
WHERE trgm_score > p_threshold OR fts_score > p_threshold
ORDER BY similarity DESC
LIMIT p_limit;
$$;

-- ============================================================
-- FIX 2: Add sku_id to po_line_items
-- ============================================================

ALTER TABLE public.po_line_items
  ADD COLUMN IF NOT EXISTS sku_id text REFERENCES public.sku_directory(sku_id);

CREATE INDEX IF NOT EXISTS idx_po_line_items_sku_id
  ON public.po_line_items(sku_id);

-- ============================================================
-- FIX 2 (continued): Wire sku_id through create_purchase_order RPC
-- ============================================================

CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_po_data    jsonb,
  p_line_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_org_id     uuid;
  v_project_id text;
  v_po_id      text;
  v_li         jsonb;
BEGIN
  v_org_id     := (p_po_data->>'org_id')::uuid;
  v_project_id := p_po_data->>'project_id';

  IF v_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  v_po_id := public.generate_document_id(v_org_id, v_project_id, 'PO');

  INSERT INTO public.purchase_orders (
    po_id, org_id, project_id, stakeholder_id,
    items, order_value, total_value, gst_value, status,
    date_issued, expected_delivery, delivery_location,
    payment_terms_days, ordered_by, vendor_notes, internal_notes, created_by
  ) VALUES (
    v_po_id,
    v_org_id,
    v_project_id,
    p_po_data->>'stakeholder_id',
    p_po_data->'items',
    (p_po_data->>'order_value')::numeric,
    (p_po_data->>'total_value')::numeric,
    (p_po_data->>'gst_value')::numeric,
    p_po_data->>'status',
    (p_po_data->>'date_issued')::date,
    NULLIF(p_po_data->>'expected_delivery', '')::date,
    NULLIF(p_po_data->>'delivery_location', ''),
    (p_po_data->>'payment_terms_days')::int,
    NULLIF(p_po_data->>'ordered_by', ''),
    NULLIF(p_po_data->>'vendor_notes', ''),
    NULLIF(p_po_data->>'internal_notes', ''),
    (p_po_data->>'created_by')::uuid
  );

  FOR v_li IN SELECT * FROM jsonb_array_elements(p_line_items)
  LOOP
    INSERT INTO public.po_line_items (
      po_id, org_id, line_number, category_id, item_name, specification,
      unit, quantity_ordered, unit_rate, basic_amount,
      discount_percent, discount_amount, gst_rate, cgst, sgst, igst, total_amount,
      sku_id
    ) VALUES (
      v_po_id,
      v_org_id,
      (v_li->>'line_number')::int,
      NULLIF(v_li->>'category_id', ''),
      v_li->>'item_name',
      NULLIF(v_li->>'specification', ''),
      v_li->>'unit',
      (v_li->>'quantity_ordered')::numeric,
      (v_li->>'unit_rate')::numeric,
      (v_li->>'basic_amount')::numeric,
      (v_li->>'discount_percent')::numeric,
      (v_li->>'discount_amount')::numeric,
      (v_li->>'gst_rate')::numeric,
      (v_li->>'cgst')::numeric,
      (v_li->>'sgst')::numeric,
      (v_li->>'igst')::numeric,
      (v_li->>'total_amount')::numeric,
      NULLIF(v_li->>'sku_id', '')   -- null if not resolved; FK allows null
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'po_id', v_po_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

COMMIT;
