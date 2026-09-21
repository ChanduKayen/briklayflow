-- ===========================================================================
-- Adjust an OPEN contract payment onto stage(s) — "put this advance to work".
--
-- Two entry points create an OPEN payment on a contract: the txn wizard's "Advance"
-- and the contract page's "Link a payment". Both land the money as a WO allocation
-- with milestone_id = NULL — it reduces the contract's Outstanding but certifies
-- nothing (a recoverable advance). This RPC is the second step: the user distributes
-- that open money across the contract's stages, which does two things at once:
--
--   · MONEY / DISPLAY: the payment's WO allocation on THIS contract is rebuilt into
--     one part per stage (milestone_id set, the paid side), so each stage shows the
--     money against it. Any amount the user leaves undistributed stays as ONE open
--     WO part (milestone_id NULL) — still an advance, adjustable again later.
--
--   · CERTIFIED: the distributed portion BECOMES accepted work — a single WO-level
--     'payment' certification (milestone_id NULL, capped at contract value, muster-
--     guarded), exactly as attribute_worker_payment / set_payment_certified mint it.
--     Certified rises only by what was adjusted onto stages, never by the open rest.
--
-- The sum invariant holds: the txn's WO portion on this contract is only re-sliced,
-- never grown or shrunk, so total allocations still equal the txn total. Safe to run
-- repeatedly (re-slices from scratch each call); reversible by adjusting back to open.
-- ===========================================================================

DROP FUNCTION IF EXISTS public.adjust_contract_payment(text, text, jsonb);
CREATE OR REPLACE FUNCTION public.adjust_contract_payment(
  p_txn_id text,
  p_wo_id  text,
  p_parts  jsonb   -- [{milestone_id, amount}] — the money to put on each stage
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  t          record;
  wo         record;
  v_p        jsonb;
  v_ms       uuid;
  v_amt      numeric;
  v_wo_total numeric;   -- the txn's WO money on THIS contract, before re-slicing
  v_dist     numeric := 0;  -- Σ distributed onto stages
  v_leftover numeric;
  v_used     numeric;
  v_room     numeric;
  v_cert     numeric;
  v_single   uuid := NULL; -- the one stage, when exactly one — for display attribution
  v_nparts   int := 0;
BEGIN
  SELECT txn_id, org_id, stakeholder_id, total_amount::numeric AS amount, date, status
    INTO t FROM public.transactions WHERE txn_id = p_txn_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Payment not found'); END IF;
  IF t.org_id NOT IN (SELECT public.get_my_org_ids()) THEN RETURN jsonb_build_object('success', false, 'error', 'Access denied'); END IF;
  IF t.status = 'Voided' THEN RETURN jsonb_build_object('success', false, 'error', 'That payment is voided'); END IF;

  SELECT wo_id, project_id, stakeholder_id, status,
         COALESCE(order_value, (SELECT COALESCE(SUM(m.planned_amount),0) FROM public.wo_milestones m WHERE m.wo_id = work_orders.wo_id))::numeric AS value
    INTO wo FROM public.work_orders WHERE wo_id = p_wo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Contract not found'); END IF;
  IF wo.status = 'Cancelled' THEN RETURN jsonb_build_object('success', false, 'error', 'Contract is cancelled'); END IF;
  IF t.stakeholder_id IS DISTINCT FROM wo.stakeholder_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This payment is not to the contract''s party');
  END IF;

  -- Muster-tracked contracts certify from site readings; a payment-cert there would double-count.
  IF EXISTS (SELECT 1 FROM public.wo_milestones m JOIN public.labour_attendance a
               ON a.milestone_id = m.milestone_id AND a.subject_type = 'stage'
              WHERE m.wo_id = p_wo_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'This contract is tracked on the muster — its work is certified from site readings.');
  END IF;

  -- The WO money this txn currently has on this contract (whatever the slicing) — the pool we re-slice.
  SELECT COALESCE(SUM(allocated_amount), 0) INTO v_wo_total
    FROM public.txn_allocations
   WHERE txn_id = p_txn_id AND order_type = 'WO' AND order_ref = p_wo_id;
  IF v_wo_total <= 0.5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'This payment has nothing on this contract to adjust');
  END IF;

  -- Validate the requested slices: each stage must belong to this contract, each amount > 0.
  FOR v_p IN SELECT * FROM jsonb_array_elements(p_parts)
  LOOP
    v_ms  := NULLIF(v_p->>'milestone_id', '')::uuid;
    v_amt := ROUND(COALESCE((v_p->>'amount')::numeric, 0), 2);
    IF v_amt <= 0 THEN CONTINUE; END IF;
    IF v_ms IS NULL OR NOT EXISTS (SELECT 1 FROM public.wo_milestones m WHERE m.milestone_id = v_ms AND m.wo_id = p_wo_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'A chosen stage is not on this contract');
    END IF;
    v_dist   := v_dist + v_amt;
    v_nparts := v_nparts + 1;
    v_single := v_ms;
  END LOOP;

  IF v_dist > v_wo_total + 0.5 THEN
    RETURN jsonb_build_object('success', false, 'error', 'You are putting more on the stages than the payment has on this contract');
  END IF;
  IF v_nparts <> 1 THEN v_single := NULL; END IF;  -- attribution phase is display-only, only when unambiguous

  SET CONSTRAINTS ALL DEFERRED;

  -- Re-slice: drop this txn's WO parts on this contract, then lay down one per stage + the open rest.
  DELETE FROM public.txn_allocations
   WHERE txn_id = p_txn_id AND order_type = 'WO' AND order_ref = p_wo_id;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_parts)
  LOOP
    v_ms  := NULLIF(v_p->>'milestone_id', '')::uuid;
    v_amt := ROUND(COALESCE((v_p->>'amount')::numeric, 0), 2);
    IF v_amt <= 0 OR v_ms IS NULL THEN CONTINUE; END IF;
    INSERT INTO public.txn_allocations (txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id)
    VALUES (p_txn_id, NULLIF(wo.project_id, '')::text, 'WO', p_wo_id, v_ms, v_amt, t.org_id);
  END LOOP;

  v_leftover := ROUND(v_wo_total - v_dist, 2);
  IF v_leftover > 0.5 THEN
    INSERT INTO public.txn_allocations (txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id)
    VALUES (p_txn_id, NULLIF(wo.project_id, '')::text, 'WO', p_wo_id, NULL, v_leftover, t.org_id);
  END IF;

  -- Certify the distributed portion (WO-level, capped at contract value net of this txn's own prior cert).
  SELECT COALESCE(SUM(computed_amount), 0) INTO v_used
    FROM public.work_certifications
   WHERE wo_id = p_wo_id AND source = 'payment' AND status = 'approved' AND COALESCE(txn_id,'') <> p_txn_id;
  v_room := GREATEST(0, wo.value - v_used);
  v_cert := LEAST(v_dist, v_room);

  IF v_cert <= 0.5 THEN
    -- Nothing left as certified work (fully open, or contract already full) → no cert for this payment.
    DELETE FROM public.work_certifications WHERE txn_id = p_txn_id AND source = 'payment';
    RETURN jsonb_build_object('success', true, 'distributed', v_dist, 'open', v_leftover, 'certified', 0);
  END IF;

  INSERT INTO public.work_certifications (
    org_id, project_id, wo_id, milestone_id, attributed_milestone_id, stakeholder_id,
    reading_kind, reading_value, computed_amount, reading_date, status, source, approved_at, txn_id
  )
  VALUES (
    t.org_id, NULLIF(wo.project_id,''), p_wo_id, NULL, v_single, t.stakeholder_id,
    'measured', 0, v_cert, COALESCE(t.date, current_date), 'approved', 'payment', now(), p_txn_id
  )
  ON CONFLICT (txn_id) WHERE txn_id IS NOT NULL
  DO UPDATE SET computed_amount = EXCLUDED.computed_amount, wo_id = EXCLUDED.wo_id,
                attributed_milestone_id = EXCLUDED.attributed_milestone_id,
                stakeholder_id = EXCLUDED.stakeholder_id, project_id = EXCLUDED.project_id,
                milestone_id = NULL, status = 'approved', source = 'payment', updated_at = now();

  RETURN jsonb_build_object('success', true, 'distributed', v_dist, 'open', v_leftover, 'certified', v_cert);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

REVOKE ALL     ON FUNCTION public.adjust_contract_payment(text, text, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.adjust_contract_payment(text, text, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';
