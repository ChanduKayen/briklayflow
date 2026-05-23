-- ============================================================
-- SKU SMART MATCH — Parametric Family Classifier Matrix
-- ============================================================

CREATE OR REPLACE FUNCTION public.classify_sku_family_relationship(
  p_sub_category text,
  p_dimension    text,
  p_variant      text,
  p_grade        text
)
RETURNS TABLE (
  relationship_type text,
  inherited_sku_id  text,
  style_template    text
) 
LANGUAGE plpgsql STABLE AS $$
DECLARE
  v_match_count int;
  v_sibling_id  text;
  v_template    text;
BEGIN
  -- Search for an existing exact structural anchor match inside this family branch
  SELECT s.sku_id, public.sku_build_name(s.sub_category, s.dimension, s.variant, s.grade)
  INTO v_sibling_id, v_template
  FROM public.sku_directory s
  WHERE s.sub_category = p_sub_category
    AND s.is_active = true
  LIMIT 1;

  -- If absolutely no items exist in this subcategory, it is an absolute Structural Orphan
  IF v_sibling_id IS NULL THEN
    RETURN QUERY SELECT 'STRUCTURAL_ORPHAN'::text, NULL::text, NULL::text;
    RETURN;
  END IF;

  -- Check Scenario A: The Variant Child (Subcategory + Dimension + Grade Match)
  SELECT s.sku_id, s.dimension INTO v_sibling_id, v_template
  FROM public.sku_directory s
  WHERE s.sub_category = p_sub_category AND coalesce(s.dimension,'') = coalesce(p_dimension,'') AND coalesce(s.grade,'') = coalesce(p_grade,'') AND s.is_active = true LIMIT 1;
  IF v_sibling_id IS NOT NULL THEN
    RETURN QUERY SELECT 'VARIANT_CHILD'::text, v_sibling_id, v_template;
    RETURN;
  END IF;

  -- Check Scenario B: The Dimensional Sibling (Subcategory + Variant + Grade Match)
  SELECT s.sku_id, s.dimension INTO v_sibling_id, v_template
  FROM public.sku_directory s
  WHERE s.sub_category = p_sub_category AND coalesce(s.variant,'') = coalesce(p_variant,'') AND coalesce(s.grade,'') = coalesce(p_grade,'') AND s.is_active = true LIMIT 1;
  IF v_sibling_id IS NOT NULL THEN
    RETURN QUERY SELECT 'DIMENSIONAL_SIBLING'::text, v_sibling_id, v_template;
    RETURN;
  END IF;

  -- Check Scenario C: The Grade Variation (Subcategory + Variant + Dimension Match)
  SELECT s.sku_id, s.grade INTO v_sibling_id, v_template
  FROM public.sku_directory s
  WHERE s.sub_category = p_sub_category AND coalesce(s.variant,'') = coalesce(p_variant,'') AND coalesce(s.dimension,'') = coalesce(p_dimension,'') AND s.is_active = true LIMIT 1;
  IF v_sibling_id IS NOT NULL THEN
    RETURN QUERY SELECT 'GRADE_VARIATION'::text, v_sibling_id, v_template;
    RETURN;
  END IF;

  -- Scenario D: Subcategory is shared, but multiple individual elements vary
  RETURN QUERY SELECT 'SUBCATEGORY_MEMBER'::text, v_sibling_id, v_template;
END;
$$;
