-- ===========================================================================
-- Attribute a WORKER payment to a contract PHASE — "settle that stage".
--
-- The user picks a phase of the worker's OWN contract (the one the attendance sheet already
-- measures/certifies) and attributes this payment to it. Per the design decision:
--   · The MONEY effect is CONTRACT-LEVEL and identical to the proven set_payment_certified:
--     one capped, muster-guarded, WO-level 'payment' work_certification (milestone_id = NULL).
--     No per-phase certified figure is touched, so a 'lump' phase that already carries certified
--     work can never be double-counted or overwritten. Overall balance is correct.
--   · The PHASE is recorded for DISPLAY only — on the payment's WO allocation (milestone_id, the
--     paid side) and on the cert (attributed_milestone_id) — so the contract page can show the
--     payment phase-wise. Nothing here feeds the certified/billed side per phase.
--
-- Attribution is a convenience, never an accounting gate: skipping it still files the payment and
-- the balance still nets. Safe to run repeatedly; reversible (p_on = false).
-- ===========================================================================

-- Display-only pointer: which phase this payment-cert was attributed to. NOT used in any balance
-- or certified aggregation — those stay WO-level. Purely for the contract page's phase-wise view.
ALTER TABLE public.work_certifications
  ADD COLUMN IF NOT EXISTS attributed_milestone_id uuid REFERENCES public.wo_milestones(milestone_id) ON DELETE SET NULL;

-- A contract has TWO formats, and a payment attributes to a phase in both — but the money differs:
--   · WORK-DONE  (p_certify = true):  the payment BECOMES accepted work — a capped, muster-guarded,
--     WO-level 'payment' certification (as set_payment_certified), plus the allocation carries the
--     phase for display.
--   · WAGES       (p_certify = false): the wages are already certified via the muster→contract
--     settlement, so a payment must NOT mint another cert (double-count). We ONLY point the
--     allocation at the WO + phase, so the payment shows on the contract page / txn detail. No
--     billed change — money is unchanged, this is display-only.
DROP FUNCTION IF EXISTS public.attribute_worker_payment(text, text, text, boolean);
CREATE OR REPLACE FUNCTION public.attribute_worker_payment(
  p_txn_id text, p_wo_id text, p_milestone_id text, p_on boolean, p_certify boolean DEFAULT true
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  t         record;
  wo        record;
  v_used    numeric;
  v_room    numeric;
  v_amt     numeric;
  v_ms      uuid;
BEGIN
  -- Cast inside BEGIN so a malformed id is caught by the handler, not raised at block entry.
  v_ms := NULLIF(p_milestone_id, '')::uuid;

  SELECT txn_id, org_id, stakeholder_id, total_amount::numeric AS amount, date, status
    INTO t FROM public.transactions WHERE txn_id = p_txn_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Payment not found'); END IF;
  IF t.org_id NOT IN (SELECT public.get_my_org_ids()) THEN RETURN jsonb_build_object('success', false, 'error', 'Access denied'); END IF;

  -- OFF: undo the attribution entirely — remove any payment-cert and un-name the phase on the allocation.
  IF NOT p_on THEN
    DELETE FROM public.work_certifications WHERE txn_id = p_txn_id AND source = 'payment';
    UPDATE public.txn_allocations
       SET order_type = NULL, order_ref = NULL, milestone_id = NULL
     WHERE txn_id = p_txn_id AND order_ref = p_wo_id AND order_type = 'WO';
    RETURN jsonb_build_object('success', true, 'on', false);
  END IF;

  SELECT wo_id, project_id, stakeholder_id, status,
         COALESCE(order_value, (SELECT COALESCE(SUM(m.planned_amount),0) FROM public.wo_milestones m WHERE m.wo_id = work_orders.wo_id))::numeric AS value
    INTO wo FROM public.work_orders WHERE wo_id = p_wo_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Contract not found'); END IF;
  IF wo.status = 'Cancelled' THEN RETURN jsonb_build_object('success', false, 'error', 'Contract is cancelled'); END IF;
  IF t.stakeholder_id IS DISTINCT FROM wo.stakeholder_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'This payment is not to the contract''s party');
  END IF;
  -- If a phase was named, it must belong to this contract.
  IF v_ms IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.wo_milestones m WHERE m.milestone_id = v_ms AND m.wo_id = p_wo_id) THEN
    RETURN jsonb_build_object('success', false, 'error', 'That phase is not on this contract');
  END IF;

  -- The MONEY guards apply only when we would mint a certification.
  IF p_certify THEN
    -- Muster-tracked contracts certify from site readings; a payment-cert there would double-count.
    IF EXISTS (SELECT 1 FROM public.wo_milestones m JOIN public.labour_attendance a
                 ON a.milestone_id = m.milestone_id AND a.subject_type = 'stage'
                WHERE m.wo_id = p_wo_id) THEN
      RETURN jsonb_build_object('success', false, 'error', 'This contract is tracked on the muster — its work is certified from site readings.');
    END IF;
    -- Cap: Σ payment-certs for the WO must not exceed the contract value.
    SELECT COALESCE(SUM(computed_amount), 0) INTO v_used
      FROM public.work_certifications
     WHERE wo_id = p_wo_id AND source = 'payment' AND status = 'approved' AND COALESCE(txn_id,'') <> p_txn_id;
    v_room := GREATEST(0, wo.value - v_used);
    v_amt  := LEAST(t.amount, v_room);
    IF v_amt <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Contract value already fully certified'); END IF;
  END IF;

  -- DISPLAY side (BOTH formats): point ONE unspoken-for allocation of this payment at the WO + phase,
  -- so the contract page and txn detail list it phase-wise. Amounts are untouched (sum invariant holds).
  UPDATE public.txn_allocations
     SET order_type = 'WO', order_ref = p_wo_id, milestone_id = v_ms
   WHERE ctid = (
     SELECT ctid FROM public.txn_allocations
      WHERE txn_id = p_txn_id AND order_type IS NULL AND bill_id IS NULL
      ORDER BY (project_id = wo.project_id) DESC
      LIMIT 1
   );

  IF NOT p_certify THEN
    -- WAGES format: display link only, no cert. The wage settlement owns certification.
    RETURN jsonb_build_object('success', true, 'on', true, 'certified', false);
  END IF;

  -- MONEY side (WORK-DONE): the proven WO-level accepted-work cert (milestone_id NULL).
  -- attributed_milestone_id carries the phase for display only.
  INSERT INTO public.work_certifications (
    org_id, project_id, wo_id, milestone_id, attributed_milestone_id, stakeholder_id,
    reading_kind, reading_value, computed_amount, reading_date, status, source, approved_at, txn_id
  )
  VALUES (
    t.org_id, NULLIF(wo.project_id,''), p_wo_id, NULL, v_ms, t.stakeholder_id,
    'measured', 0, v_amt, COALESCE(t.date, current_date), 'approved', 'payment', now(), p_txn_id
  )
  ON CONFLICT (txn_id) WHERE txn_id IS NOT NULL
  DO UPDATE SET computed_amount = EXCLUDED.computed_amount, wo_id = EXCLUDED.wo_id,
                attributed_milestone_id = EXCLUDED.attributed_milestone_id,
                stakeholder_id = EXCLUDED.stakeholder_id, project_id = EXCLUDED.project_id,
                status = 'approved', source = 'payment', updated_at = now();

  RETURN jsonb_build_object('success', true, 'on', true, 'certified', true, 'amount', v_amt);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

REVOKE ALL     ON FUNCTION public.attribute_worker_payment(text, text, text, boolean, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION public.attribute_worker_payment(text, text, text, boolean, boolean) TO authenticated;

NOTIFY pgrst, 'reload schema';
