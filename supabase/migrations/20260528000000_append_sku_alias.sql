-- ============================================================
-- append_sku_alias RPC — the auto-alias learning loop
--
-- Called from the frontend on every confirmed AI resolution. The
-- original user input ("isaka", "kankara", "siminti") is written
-- back as an alias on the SKU it resolved to, so the NEXT time
-- anyone types the same vernacular it hits the alias index
-- directly with zero AI cost.
--
-- Dedup is case-insensitive. The function is a no-op when the
-- alias already exists. The sku_directory UPDATE trigger from
-- migration 20260524000000 then rebuilds the alias-family index
-- for the affected family.
-- ============================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.append_sku_alias(
  p_sku_id text,
  p_alias  text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text := nullif(trim(p_alias), '');
BEGIN
  IF p_sku_id IS NULL OR v_clean IS NULL OR length(v_clean) < 2 THEN
    RETURN;
  END IF;

  UPDATE public.sku_directory
  SET aliases    = (
        SELECT array_agg(DISTINCT a)
        FROM (
          SELECT unnest(COALESCE(aliases, ARRAY[]::text[])) AS a
          UNION ALL
          SELECT v_clean
        ) sub
        WHERE trim(a) != ''
      ),
      updated_at = now()
  WHERE sku_id = p_sku_id
    AND NOT EXISTS (
      SELECT 1
      FROM unnest(COALESCE(aliases, ARRAY[]::text[])) existing_alias
      WHERE lower(trim(existing_alias)) = lower(v_clean)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.append_sku_alias(text, text) TO anon, authenticated, service_role;

COMMIT;
