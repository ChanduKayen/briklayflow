-- ===========================================================================
-- promote_purchase_request_to_po — authorize by ROLE, not only the approver flag.
--
-- The office turns a purchase request into a PO / quote request. That is a management, principal or
-- accountant job; a supervisor raises and edits requests but never places the order. The original
-- authority gate accepted ONLY org_memberships.can_approve_procurement = true, so a manager without
-- that flag set got "Not authorized to approve procurement" and the Create-PO / Request-quotes buttons
-- did nothing. This widens the gate to those three roles OR the explicit flag — nothing else changes.
-- (Full body re-emitted because Postgres has no partial-patch for a function.)
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.promote_purchase_request_to_po(
  p_pr_id       uuid,
  p_approver_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pr      public.purchase_requests%ROWTYPE;
  v_caller  uuid := auth.uid();
  v_is_appr boolean;
  v_po_id   text;
  v_li      jsonb;
  v_line    int := 1;
BEGIN
  SELECT * INTO v_pr FROM public.purchase_requests WHERE id = p_pr_id;
  IF v_pr.id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  -- Idempotent: already promoted -> return the existing PO.
  IF v_pr.converted_po_id IS NOT NULL THEN
    RETURN jsonb_build_object('success', true, 'po_id', v_pr.converted_po_id, 'already', true);
  END IF;

  -- Authority: an active management / principal / accountant member here, OR anyone explicitly flagged
  -- can_approve_procurement. A supervisor is neither, so they cannot place the order (they still edit/save).
  SELECT EXISTS(
    SELECT 1 FROM public.org_memberships
    WHERE user_id = p_approver_id AND org_id = v_pr.org_id
      AND status = 'active'
      AND (can_approve_procurement = true OR role IN ('management','principal','accountant'))
  ) INTO v_is_appr;
  IF NOT v_is_appr THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to approve procurement');
  END IF;

  -- In-app callers may only act as themselves; service-role (NULL) trusts the param.
  IF v_caller IS NOT NULL AND v_caller <> p_approver_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Approver mismatch');
  END IF;

  -- PO preconditions.
  IF v_pr.vendor_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'No vendor selected');
  END IF;
  IF v_pr.site_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Set a site before approving');
  END IF;

  -- PO number (raises if the project lacks a project_code -> surface gracefully).
  BEGIN
    v_po_id := public.generate_document_id(v_pr.org_id, v_pr.site_id, 'PO');
  EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
  END;

  -- Header: live (APPROVED), price-less.
  INSERT INTO public.purchase_orders (
    po_id, org_id, project_id, stakeholder_id,
    items, order_value, total_value, gst_value, status,
    approval_status, approved_by, approved_at,
    date_issued, payment_terms_days, ordered_by, internal_notes, created_by
  ) VALUES (
    v_po_id, v_pr.org_id, v_pr.site_id, v_pr.vendor_id,
    '[]'::jsonb, 0, 0, 0, 'ORDERED',
    'APPROVED', p_approver_id, now(),
    (now() AT TIME ZONE 'Asia/Kolkata')::date, 30,
    NULLIF(v_pr.sender_name, ''),
    'Raised via WhatsApp request', v_pr.created_by
  );

  -- Line items from the request items (price-less; rates filled in-app).
  FOR v_li IN
    SELECT to_jsonb(i) FROM public.purchase_request_items i
    WHERE i.purchase_request_id = p_pr_id
    ORDER BY i.item_index
  LOOP
    INSERT INTO public.po_line_items (
      po_id, org_id, line_number, item_name, unit, quantity_ordered,
      unit_rate, basic_amount, gst_rate, cgst, sgst, igst, total_amount
    ) VALUES (
      v_po_id, v_pr.org_id, v_line,
      v_li->>'item_name',
      COALESCE(NULLIF(v_li->>'unit', ''), 'Nos'),
      COALESCE((v_li->>'quantity')::numeric, 1),
      0, 0, 0, 0, 0, 0, 0
    );
    v_line := v_line + 1;
  END LOOP;

  -- Mark the request placed + linked.
  UPDATE public.purchase_requests
  SET status = 'placed', approver_id = p_approver_id, approved_at = now(), converted_po_id = v_po_id
  WHERE id = p_pr_id;

  -- Audit trail (same table the in-app PO approval writes).
  INSERT INTO public.po_approvals (org_id, po_id, approver_user_id, action, remarks)
  VALUES (v_pr.org_id, v_po_id, p_approver_id, 'APPROVED', 'Promoted from purchase request');

  RETURN jsonb_build_object('success', true, 'po_id', v_po_id);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

REVOKE ALL ON FUNCTION public.promote_purchase_request_to_po(uuid, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.promote_purchase_request_to_po(uuid, uuid) TO authenticated, service_role;
