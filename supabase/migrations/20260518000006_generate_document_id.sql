-- Block 2: generate_document_id helper
-- Called ONLY from create_work_order() and create_purchase_order().
-- Never called directly from the client.

CREATE OR REPLACE FUNCTION public.generate_document_id(
  p_org_id     uuid,
  p_project_id text,   -- text, not uuid (project_id is PRJ-... slug)
  p_doc_type   text    -- 'WO' or 'PO'
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_site_code text;
  v_date_part text;
  v_seq       int;
  v_new_id    text;
  v_exists    boolean;
BEGIN
  IF p_doc_type NOT IN ('WO', 'PO') THEN
    RAISE EXCEPTION 'doc_type must be WO or PO';
  END IF;

  -- Get project code (must exist before WO/PO can be created)
  SELECT project_code INTO v_site_code
  FROM public.projects
  WHERE project_id::text = p_project_id
    AND org_id = p_org_id;

  IF v_site_code IS NULL THEN
    RAISE EXCEPTION
      'Project not found or missing project code. Add a site code to this project first.';
  END IF;

  -- Date part: YYMMDD in IST (context only — not part of sequence key)
  v_date_part := to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYMMDD');

  -- Sequence: MAX+1 across ALL dates for this project, never resets.
  -- Uses MAX not COUNT so deleted records don't cause sequence collisions.
  -- Only counts IDs matching the new format pattern.
  IF p_doc_type = 'WO' THEN
    SELECT COALESCE(
      MAX(
        CASE WHEN wo_id ~ ('^WO-' || v_site_code || '-[0-9]{6}-[0-9]+$')
          THEN (split_part(wo_id, '-', 4))::int
          ELSE 0
        END
      ), 0) + 1
    INTO v_seq
    FROM public.work_orders
    WHERE org_id = p_org_id
      AND project_id::text = p_project_id
      AND wo_id LIKE 'WO-' || v_site_code || '-%';
  ELSE
    SELECT COALESCE(
      MAX(
        CASE WHEN po_id ~ ('^PO-' || v_site_code || '-[0-9]{6}-[0-9]+$')
          THEN (split_part(po_id, '-', 4))::int
          ELSE 0
        END
      ), 0) + 1
    INTO v_seq
    FROM public.purchase_orders
    WHERE org_id = p_org_id
      AND project_id::text = p_project_id
      AND po_id LIKE 'PO-' || v_site_code || '-%';
  END IF;

  -- Compose: TYPE-SITE-YYMMDD-NNN
  v_new_id :=
    p_doc_type
    || '-' || v_site_code
    || '-' || v_date_part
    || '-' || lpad(v_seq::text, 3, '0');

  -- Collision guard for rare concurrent inserts
  IF p_doc_type = 'WO' THEN
    SELECT EXISTS(SELECT 1 FROM public.work_orders WHERE wo_id = v_new_id) INTO v_exists;
  ELSE
    SELECT EXISTS(SELECT 1 FROM public.purchase_orders WHERE po_id = v_new_id) INTO v_exists;
  END IF;

  IF v_exists THEN
    v_seq    := v_seq + 1;
    v_new_id :=
      p_doc_type
      || '-' || v_site_code
      || '-' || v_date_part
      || '-' || lpad(v_seq::text, 3, '0');
  END IF;

  RETURN v_new_id;
END;
$$;
