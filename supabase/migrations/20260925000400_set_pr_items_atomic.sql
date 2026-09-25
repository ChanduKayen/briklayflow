-- ===========================================================================
-- Replace a purchase request's items ATOMICALLY.
--
-- The review card edits items by "delete all, then re-insert". As two separate
-- client calls that is unsafe: if the insert fails (e.g. a column the client
-- writes does not exist yet, or a bad value), the DELETE has already committed
-- and the request is left with ZERO items — the "edit an item and it vanishes"
-- bug. This function does both in ONE transaction, so any failure rolls the
-- delete back and the items are preserved. item_name is coalesced so a blank
-- name can never violate NOT NULL (and never silently drops the row).
--
-- Requires 20260924000100 (spec columns) + 20260925000200 to have run first.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.set_purchase_request_items(
  p_pr_id uuid,
  p_items jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org  uuid;
  v_item jsonb;
  v_idx  int := 0;
BEGIN
  SELECT org_id INTO v_org FROM public.purchase_requests WHERE id = p_pr_id;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  -- The caller must belong to the request's org (mirrors the table's RLS intent).
  IF NOT (
    EXISTS (SELECT 1 FROM public.org_memberships m
            WHERE m.user_id = auth.uid() AND m.org_id = v_org AND m.status = 'active')
    OR EXISTS (SELECT 1 FROM public.user_profiles up
            WHERE up.id = auth.uid() AND (up.org_id = v_org OR up.org_id IS NULL))
    OR auth.uid() IS NULL   -- service role
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  DELETE FROM public.purchase_request_items WHERE purchase_request_id = p_pr_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.purchase_request_items
      (purchase_request_id, org_id, item_index, item_name, quantity, unit,
       width_mm, height_mm, spec, brand, note, source_line, read_fields)
    VALUES (
      p_pr_id, v_org, v_idx,
      COALESCE(NULLIF(v_item->>'item_name', ''), 'Item'),          -- never NULL, never drops the row
      NULLIF(v_item->>'quantity', '')::numeric,
      NULLIF(v_item->>'unit', ''),
      NULLIF(v_item->>'width_mm', '')::numeric,
      NULLIF(v_item->>'height_mm', '')::numeric,
      NULLIF(v_item->>'spec', ''),
      NULLIF(v_item->>'brand', ''),
      NULLIF(v_item->>'note', ''),
      NULLIF(v_item->>'source_line', ''),
      COALESCE(v_item->'read_fields', '{}'::jsonb)
    );
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object('success', true, 'count', v_idx);
END $$;

REVOKE ALL ON FUNCTION public.set_purchase_request_items(uuid, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.set_purchase_request_items(uuid, jsonb) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';
