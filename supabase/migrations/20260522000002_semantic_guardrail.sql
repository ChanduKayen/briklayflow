-- ============================================================
-- SKU SMART MATCH — Semantic Guardrail & Vector Setup
-- ============================================================

CREATE EXTENSION IF NOT EXISTS vector;
ALTER TABLE public.sku_directory ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Fast distance threshold guardrail function and insert in one atomic transaction
CREATE OR REPLACE FUNCTION public.safely_insert_sku_with_guardrail(
  p_sku_id text,
  p_category text,
  p_sub_category text,
  p_dimension text,
  p_variant text,
  p_grade text,
  p_aliases text[],
  p_standard_unit text,
  p_embedding vector(1536)
)
RETURNS text AS $$
DECLARE
  v_existing_sku_id text;
  v_new_sku_id text;
BEGIN
  -- 1. Run the server-side semantic proximity validation check
  SELECT sku_id INTO v_existing_sku_id
  FROM public.sku_directory
  WHERE embedding <=> p_embedding < 0.15
  ORDER BY embedding <=> p_embedding ASC
  LIMIT 1;

  -- 2. If a semantic ghost duplicate exists, exit early and return its ID
  IF v_existing_sku_id IS NOT NULL THEN
    RETURN v_existing_sku_id;
  END IF;

  -- 3. Otherwise, safely run the canonical insertion logic
  BEGIN
    INSERT INTO public.sku_directory (
      sku_id, category, sub_category, dimension, variant, grade, aliases, standard_unit, embedding, is_active
    )
    VALUES (
      p_sku_id, p_category, p_sub_category, p_dimension, p_variant, p_grade, p_aliases, p_standard_unit, p_embedding, true
    )
    RETURNING sku_id INTO v_new_sku_id;
  EXCEPTION WHEN unique_violation THEN
    -- Fallback safety for exact string collisions not caught by distance
    RETURN p_sku_id; 
  END;

  RETURN v_new_sku_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
