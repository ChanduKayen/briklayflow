-- PO approval workflow ───────────────────────────────────────────────────────
-- Drafts vs Live are tracked by purchase_orders.approval_status (NOT the
-- fulfillment `status`). A new PO is PENDING (a "draft waiting for approval")
-- unless its creator is management/principal, who auto-approve their own PO.
-- Only management/principal may approve; rejecting "sends it back" (stays
-- PENDING with a logged remark). Every action is audited in po_approvals.
--
-- The authoritative role is the PER-ORG role on org_memberships — current_user_role()
-- reads the single global user_profiles.role and is unsafe for multi-org.

-- 1) Grandfather existing POs ─────────────────────────────────────────────────
--    They predate this gate, so treat them as approved or they'd vanish from Live.
UPDATE public.purchase_orders
SET approval_status = 'APPROVED',
    approved_at     = COALESCE(approved_at, date_issued::timestamptz, created_at, now())
WHERE approval_status IS NULL OR approval_status = 'PENDING';

-- 2) Normalise the column ─────────────────────────────────────────────────────
ALTER TABLE public.purchase_orders
  ALTER COLUMN approval_status SET DEFAULT 'PENDING';

ALTER TABLE public.purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_approval_status_check;
ALTER TABLE public.purchase_orders
  ADD  CONSTRAINT purchase_orders_approval_status_check
  CHECK (approval_status IN ('PENDING', 'APPROVED', 'REJECTED'));

CREATE INDEX IF NOT EXISTS idx_purchase_orders_approval_status
  ON public.purchase_orders (org_id, approval_status);

-- 3) create_purchase_order — set approval_status from the creator's ORG role ───
--    (auto-approve management/principal; everyone else starts PENDING). Also
--    coerces any legacy/invalid status (e.g. 'DRAFT') to the valid 'ORDERED'.
CREATE OR REPLACE FUNCTION public.create_purchase_order(
  p_po_data    jsonb,   -- purchase_order fields WITHOUT po_id
  p_line_items jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id     uuid;
  v_project_id text;
  v_po_id      text;
  v_li         jsonb;
  v_role       text;
  v_status     text;
  v_approval   text;
  v_approver   uuid;
  v_approon    timestamptz;
BEGIN
  v_org_id     := (p_po_data->>'org_id')::uuid;
  v_project_id := p_po_data->>'project_id';

  IF v_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  -- per-org role drives auto-approval
  SELECT role::text INTO v_role
  FROM public.org_memberships
  WHERE user_id = auth.uid() AND org_id = v_org_id AND status = 'active'
  LIMIT 1;

  IF v_role IN ('management', 'principal') THEN
    v_approval := 'APPROVED'; v_approver := auth.uid(); v_approon := now();
  ELSE
    v_approval := 'PENDING';  v_approver := NULL;       v_approon := NULL;
  END IF;

  -- never trust a client-supplied draft/invalid status for the fulfillment field
  v_status := CASE
    WHEN p_po_data->>'status' IN ('ORDERED','BILLED','PARTIAL','PAID','CANCELLED','RFQ')
      THEN p_po_data->>'status'
    ELSE 'ORDERED'
  END;

  v_po_id := public.generate_document_id(v_org_id, v_project_id, 'PO');

  INSERT INTO public.purchase_orders (
    po_id, org_id, project_id, stakeholder_id,
    items, order_value, total_value, gst_value, status,
    approval_status, approved_by, approved_at,
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
    v_status,
    v_approval, v_approver, v_approon,
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
      discount_percent, discount_amount, gst_rate, cgst, sgst, igst, total_amount
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
      (v_li->>'total_amount')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'po_id', v_po_id, 'approval_status', v_approval);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- 4) approve_purchase_order — approve or send back, management/principal only ──
CREATE OR REPLACE FUNCTION public.approve_purchase_order(
  p_po_id   text,
  p_action  text,            -- 'APPROVE' | 'SEND_BACK'
  p_remarks text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_role   text;
BEGIN
  SELECT org_id INTO v_org_id FROM public.purchase_orders WHERE po_id = p_po_id;
  IF v_org_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Purchase order not found');
  END IF;
  IF v_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  SELECT role::text INTO v_role
  FROM public.org_memberships
  WHERE user_id = auth.uid() AND org_id = v_org_id AND status = 'active'
  LIMIT 1;

  IF v_role NOT IN ('management', 'principal') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Only management or principal can approve purchase orders');
  END IF;

  IF p_action = 'APPROVE' THEN
    UPDATE public.purchase_orders
    SET approval_status = 'APPROVED', approved_by = auth.uid(), approved_at = now()
    WHERE po_id = p_po_id;
    INSERT INTO public.po_approvals (po_id, approver_user_id, action, remarks)
    VALUES (p_po_id, auth.uid(), 'APPROVED', NULLIF(p_remarks, ''));

  ELSIF p_action = 'SEND_BACK' THEN
    UPDATE public.purchase_orders
    SET approval_status = 'PENDING', approved_by = NULL, approved_at = NULL
    WHERE po_id = p_po_id;
    INSERT INTO public.po_approvals (po_id, approver_user_id, action, remarks)
    VALUES (p_po_id, auth.uid(), 'SENT_BACK', NULLIF(p_remarks, ''));

  ELSE
    RETURN jsonb_build_object('success', false, 'error', 'Unknown action: ' || COALESCE(p_action, 'null'));
  END IF;

  RETURN jsonb_build_object('success', true, 'po_id', p_po_id, 'action', p_action);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_purchase_order(jsonb, jsonb)        TO authenticated;
GRANT EXECUTE ON FUNCTION public.approve_purchase_order(text, text, text)   TO authenticated;
