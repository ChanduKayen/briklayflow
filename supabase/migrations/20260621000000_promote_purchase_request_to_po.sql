-- ===========================================================================
-- promote_purchase_request_to_po — turn an approved purchase_request into a real,
-- LIVE (APPROVED) purchase_order, mirroring create_purchase_order.
--
-- Flow (decided 2026-06-21):
--   * A WhatsApp request is captured as a purchase_request (draft -> sourced).
--   * Direct (single-vendor) requests that are sent_for_approval surface in the
--     /purchase-orders?status=draft queue. Approving one promotes it here.
--   * If the RAISER already has approval authority, the WhatsApp agent calls this
--     directly the moment the vendor is picked (auto-approve -> live PO).
--
-- The PO is PRICE-LESS (qty captured, rates 0) — prices are filled in-app later;
-- a draft PO with ₹0 totals is acceptable. project_id (site) IS required because
-- purchase_orders.project_id is NOT NULL and the PO number needs the site's
-- project_code (see generate_document_id) — a site-less request returns an error
-- so the caller can prompt "set a site first".
--
-- Authority model: p_approver_id must be an active procurement approver for the
-- request's org. In-app calls carry auth.uid() and may only act AS themselves;
-- service-role calls (WhatsApp edge fn, auth.uid() IS NULL) trust the param (the
-- agent has already verified the sender is an approver). Idempotent: a request
-- already linked to a PO returns that PO.
-- ===========================================================================

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS converted_po_id text REFERENCES public.purchase_orders(po_id);

COMMENT ON COLUMN public.purchase_requests.converted_po_id IS
  'The purchase_orders.po_id this request was promoted into (NULL until approved). '
  'Set by promote_purchase_request_to_po; status moves to ''placed'' alongside it.';

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

  -- Authority: the named approver must be an active procurement approver here.
  SELECT EXISTS(
    SELECT 1 FROM public.org_memberships
    WHERE user_id = p_approver_id AND org_id = v_pr.org_id
      AND status = 'active' AND can_approve_procurement = true
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
