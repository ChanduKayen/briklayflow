-- ============================================================
-- suggest_sku_family RPC — vector-based fallback for orphan items.
--
-- When the alias index and trgm match both return nothing for a user's
-- input, the Edge Function generates an embedding for the AI-cleaned
-- canonical name and calls this RPC. If the embedding lands close to
-- an existing family in vector space (cosine distance < threshold),
-- the family becomes a "suggested" pill on the frontend — the user
-- can confirm with a tap. If everything is far away, the item is
-- treated as a true orphan.
--
-- Depends on:
--   - public.sku_directory.embedding vector(1536)   (added in 20260522000002)
--   - vector extension                              (added in 20260522000002)
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.suggest_sku_family(
  p_embedding          vector(1536),
  p_distance_threshold float DEFAULT 0.25
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category     text;
  v_sub_category text;
  v_distance     float;
BEGIN
  IF p_embedding IS NULL THEN
    RETURN jsonb_build_object('suggestion_found', false, 'is_orphan', true);
  END IF;

  SELECT s.category, s.sub_category, (s.embedding <=> p_embedding)
    INTO v_category, v_sub_category, v_distance
    FROM public.sku_directory s
   WHERE s.is_active = true
     AND s.embedding IS NOT NULL
   ORDER BY s.embedding <=> p_embedding
   LIMIT 1;

  IF v_category IS NULL OR v_distance > p_distance_threshold THEN
    RETURN jsonb_build_object(
      'suggestion_found', false,
      'is_orphan',        true
    );
  END IF;

  RETURN jsonb_build_object(
    'suggestion_found',       true,
    'is_orphan',              false,
    'distance',               round(v_distance::numeric, 4),
    'suggested_category',     v_category,
    'suggested_sub_category', v_sub_category
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.suggest_sku_family(vector, float)
  TO anon, authenticated, service_role;

COMMIT;
