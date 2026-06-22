-- decide_purchase_order — the single approval gate for a PRICED purchase order.
-- Supersedes approve_purchase_order. One path for in-app and (later) WhatsApp.
--
--   APPROVE   → APPROVED (live), gated by the caller's GST-inclusive amount limit.
--   SEND_BACK → stays PENDING, returns to the creator with a note (for edits).
--   REJECT    → REJECTED (terminal), leaves the queue.
--
-- Amount = total_value (GST-inclusive). NULL procurement_approval_limit = unlimited.
-- Over limit → denied with escalate_to = the caller's higher_approver_id (route up).
-- Idempotent: only acts on a PENDING PO. Writes po_approvals (the audit log).
--
-- Run AFTER 20260621000005 (needs higher_approver_id).

CREATE OR REPLACE FUNCTION public.decide_purchase_order(
  p_po_id    text,
  p_action   text,   -- 'APPROVE' | 'SEND_BACK' | 'REJECT'
  p_remarks  text DEFAULT NULL,
  p_actor_id uuid DEFAULT NULL   -- service-role (WhatsApp) acts AS this resolved user
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_po     public.purchase_orders%ROWTYPE;
  -- In-app calls carry auth.uid(); service-role (WhatsApp edge fn) is NULL and trusts the
  -- param (the webhook already resolved the sender's phone -> user). An in-app caller may
  -- only act as themselves.
  v_uid    uuid := COALESCE(auth.uid(), p_actor_id);
  v_can    boolean;
  v_limit  numeric;
  v_higher uuid;
  v_amount numeric;
BEGIN
  IF auth.uid() IS NOT NULL AND p_actor_id IS NOT NULL AND auth.uid() <> p_actor_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'Approver mismatch');
  END IF;
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not signed in');
  END IF;

  SELECT * INTO v_po FROM public.purchase_orders WHERE po_id = p_po_id;
  IF v_po.po_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'PO not found');
  END IF;

  SELECT can_approve_procurement, procurement_approval_limit, higher_approver_id
    INTO v_can, v_limit, v_higher
  FROM public.org_memberships
  WHERE user_id = v_uid AND org_id = v_po.org_id AND status = 'active';

  IF NOT COALESCE(v_can, false) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized to approve procurement');
  END IF;

  -- Idempotent: only a PENDING PO can be decided.
  IF v_po.approval_status IS DISTINCT FROM 'PENDING' THEN
    RETURN jsonb_build_object('success', true, 'already', true, 'approval_status', v_po.approval_status);
  END IF;

  IF p_action = 'APPROVE' THEN
    v_amount := COALESCE(v_po.total_value, v_po.order_value, 0);  -- GST-inclusive
    IF v_limit IS NOT NULL AND v_amount > v_limit THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'above_limit',
        'amount', v_amount, 'limit', v_limit, 'escalate_to', v_higher
      );
    END IF;
    UPDATE public.purchase_orders
      SET approval_status = 'APPROVED', approved_by = v_uid, approved_at = now()
      WHERE po_id = p_po_id;
    INSERT INTO public.po_approvals (org_id, po_id, approver_user_id, action, remarks)
      VALUES (v_po.org_id, p_po_id, v_uid, 'APPROVED', p_remarks);
    RETURN jsonb_build_object('success', true, 'approval_status', 'APPROVED');

  ELSIF p_action = 'SEND_BACK' THEN
    INSERT INTO public.po_approvals (org_id, po_id, approver_user_id, action, remarks)
      VALUES (v_po.org_id, p_po_id, v_uid, 'SENT_BACK', p_remarks);
    RETURN jsonb_build_object('success', true, 'approval_status', 'PENDING', 'sent_back', true);

  ELSIF p_action = 'REJECT' THEN
    UPDATE public.purchase_orders
      SET approval_status = 'REJECTED'
      WHERE po_id = p_po_id;
    INSERT INTO public.po_approvals (org_id, po_id, approver_user_id, action, remarks)
      VALUES (v_po.org_id, p_po_id, v_uid, 'REJECTED', p_remarks);
    RETURN jsonb_build_object('success', true, 'approval_status', 'REJECTED');
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'Unknown action');

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

REVOKE ALL     ON FUNCTION public.decide_purchase_order(text, text, text, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.decide_purchase_order(text, text, text, uuid) TO authenticated, service_role;
