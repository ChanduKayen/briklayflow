-- ===========================================================================
-- Procurement — a purchase request captured from a WhatsApp PHOTO.
--
-- A supervisor photographs a to-buy list / handwritten materials order and sends
-- it on WhatsApp. That image becomes a DRAFT purchase request (the reviewable
-- capture buffer, exactly like a rough_entry) and the photo rides ON the request
-- so the reviewer sees the paper it came from — the same "show the source" that
-- payment proofs get. Images already live as a PUBLIC url in the rough-entry-media
-- bucket (downloadAndStoreImage → publicUrl), so one text column holds it.
--
-- stage_purchase_request gains an OPTIONAL p_image_url (DEFAULT NULL) so the
-- existing TEXT caller (13 args) is unaffected — it simply omits it.
-- ===========================================================================

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS image_url text;   -- WhatsApp photo the request was read from (public url)

-- Replace the staging RPC with a 14th, optional image-url parameter. Dropping the
-- 13-arg signature first keeps ONE function of this name (no ambiguous overload);
-- the DEFAULT lets the text path keep calling it with 13 args.
DROP FUNCTION IF EXISTS public.stage_purchase_request(uuid, text, text, text, int, text, text, text, text, text, text, text, jsonb);

CREATE OR REPLACE FUNCTION public.stage_purchase_request(
  p_org_id        uuid,
  p_sender        text,
  p_sender_name   text,
  p_wamid         text,
  p_request_index int,
  p_status        text,
  p_site_id       text,
  p_site_raw      text,
  p_vendor_id     text,
  p_vendor_raw    text,
  p_sourcing_mode text,
  p_title         text,
  p_items         jsonb,          -- [{ item_name, quantity, unit, note }]
  p_image_url     text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id       uuid;
  v_existing uuid;
  v_item     jsonb;
  v_idx      int := 0;
BEGIN
  INSERT INTO public.purchase_requests
    (org_id, sender_number, sender_name, wa_message_id, request_index, status,
     site_id, site_raw, vendor_id, vendor_raw, sourcing_mode, title, image_url)
  VALUES
    (p_org_id, p_sender, p_sender_name, p_wamid, COALESCE(p_request_index, 0),
     COALESCE(NULLIF(p_status, ''), 'draft')::public.purchase_request_status,
     NULLIF(p_site_id, ''), NULLIF(p_site_raw, ''),
     NULLIF(p_vendor_id, ''), NULLIF(p_vendor_raw, ''),
     NULLIF(p_sourcing_mode, '')::public.procurement_sourcing_mode,
     NULLIF(p_title, ''), NULLIF(p_image_url, ''))
  ON CONFLICT (org_id, wa_message_id, request_index) WHERE wa_message_id IS NOT NULL
  DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    -- already landed (this or a prior execution) -> idempotent SUCCESS, never null
    SELECT id INTO v_existing FROM public.purchase_requests
      WHERE org_id = p_org_id AND wa_message_id = p_wamid
        AND request_index = COALESCE(p_request_index, 0);
    RETURN jsonb_build_object('id', v_existing, 'committed', true, 'conflict', true);
  END IF;

  -- items only on the fresh insert (the conflict path already has them)
  FOR v_item IN SELECT * FROM jsonb_array_elements(COALESCE(p_items, '[]'::jsonb))
  LOOP
    INSERT INTO public.purchase_request_items
      (purchase_request_id, org_id, item_index, item_name, quantity, unit, note)
    VALUES
      (v_id, p_org_id, v_idx,
       v_item->>'item_name',
       NULLIF(v_item->>'quantity', '')::numeric,
       NULLIF(v_item->>'unit', ''),
       NULLIF(v_item->>'note', ''));
    v_idx := v_idx + 1;
  END LOOP;

  RETURN jsonb_build_object('id', v_id, 'committed', true, 'conflict', false);
END $$;

REVOKE ALL ON FUNCTION public.stage_purchase_request(uuid, text, text, text, int, text, text, text, text, text, text, text, jsonb, text) FROM public;
GRANT EXECUTE ON FUNCTION public.stage_purchase_request(uuid, text, text, text, int, text, text, text, text, text, text, text, jsonb, text) TO service_role, authenticated;

NOTIFY pgrst, 'reload schema';
