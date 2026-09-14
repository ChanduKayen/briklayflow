-- ===========================================================================
-- "Certify from payment" — a payment made against a contract can BE the accepted
-- work. On a running-account contract you don't pay unless the work justifies it,
-- so a contract-linked payment may stand as its own certification — no muster
-- reading needed. This is the honest fix for the phantom "paid ahead of recorded
-- work" that shows when payments run ahead of what's been recorded on site.
--
-- Two triggers (user decision "(b)+imports"):
--   · MANUAL  — a row-wise toggle in the party ledger (set_payment_certified RPC).
--   · AUTO    — imported / pre-system contract payments (no muster to reconcile,
--               the payment IS the record) are certified by the one-time backfill.
--
-- Safety rails (so we never fabricate accepted work or double-count):
--   · Only for a contract with NO muster stage readings — a muster-tracked contract
--     already auto-certifies from its readings (20260918000000), so a payment-cert
--     there would double-count. Refused.
--   · Capped: Σ(payment-certs for a WO) ≤ the contract value. Paying BEYOND the
--     contract still shows the excess as a genuine advance (not hidden).
--   · Reversible: each payment-cert is linked to its payment by txn_id; toggling
--     off deletes it; deleting the payment cascades it away.
-- ===========================================================================

-- Link a certification to the payment it certifies (1:1). Cascade so a removed payment removes its cert.
ALTER TABLE public.work_certifications
  ADD COLUMN IF NOT EXISTS txn_id text REFERENCES public.transactions(txn_id) ON DELETE CASCADE;
CREATE UNIQUE INDEX IF NOT EXISTS work_certifications_txn_uidx
  ON public.work_certifications(txn_id) WHERE txn_id IS NOT NULL;

-- Widen the source vocabulary to include payment-derived certs.
ALTER TABLE public.work_certifications DROP CONSTRAINT IF EXISTS work_certifications_source_check;
ALTER TABLE public.work_certifications
  ADD CONSTRAINT work_certifications_source_check
  CHECK (source IN ('wizard','legacy','party_page','payment'));

-- ── the contract value + guards, as a helper the RPC and backfill share ───────────────────────────
-- Returns the WO a payment is linked to, its value, and whether it is muster-tracked (has readings).
CREATE OR REPLACE FUNCTION public._payment_contract(p_txn_id text)
RETURNS TABLE(wo_id text, org_id uuid, project_id text, stakeholder_id text, amount numeric, value numeric, tracked boolean, cancelled boolean)
LANGUAGE sql STABLE AS $$
  SELECT wo.wo_id, t.org_id,
         COALESCE(ta.project_id, wo.project_id) AS project_id,
         t.stakeholder_id, t.total_amount::numeric AS amount,
         COALESCE(wo.order_value, (SELECT COALESCE(SUM(m.planned_amount),0) FROM public.wo_milestones m WHERE m.wo_id = wo.wo_id))::numeric AS value,
         EXISTS (SELECT 1 FROM public.wo_milestones m JOIN public.labour_attendance a
                   ON a.milestone_id = m.milestone_id AND a.subject_type = 'stage'
                  WHERE m.wo_id = wo.wo_id) AS tracked,
         (wo.status = 'Cancelled') AS cancelled
    FROM public.transactions t
    JOIN public.txn_allocations ta ON ta.txn_id = t.txn_id AND ta.order_type = 'WO'
    JOIN public.work_orders wo ON wo.wo_id = ta.order_ref
   WHERE t.txn_id = p_txn_id AND t.status IS DISTINCT FROM 'Voided'
   LIMIT 1;
$$;

-- ── the toggle — mint (capped) or remove a payment's certification ────────────────────────────────
CREATE OR REPLACE FUNCTION public.set_payment_certified(p_txn_id text, p_on boolean)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE c record; v_used numeric; v_room numeric; v_amt numeric;
BEGIN
  SELECT * INTO c FROM public._payment_contract(p_txn_id);
  IF NOT FOUND THEN RETURN jsonb_build_object('success', false, 'error', 'Payment is not linked to a contract'); END IF;
  IF c.org_id NOT IN (SELECT public.get_my_org_ids()) THEN RETURN jsonb_build_object('success', false, 'error', 'Access denied'); END IF;

  IF NOT p_on THEN
    DELETE FROM public.work_certifications WHERE txn_id = p_txn_id AND source = 'payment';
    RETURN jsonb_build_object('success', true, 'on', false);
  END IF;

  IF c.cancelled THEN RETURN jsonb_build_object('success', false, 'error', 'Contract is cancelled'); END IF;
  IF c.tracked   THEN RETURN jsonb_build_object('success', false, 'error', 'This contract is tracked on the muster — its work is certified from site readings.'); END IF;

  -- Cap: Σ payment-certs for the WO must not exceed the contract value.
  SELECT COALESCE(SUM(computed_amount), 0) INTO v_used
    FROM public.work_certifications
   WHERE wo_id = c.wo_id AND source = 'payment' AND status = 'approved' AND COALESCE(txn_id,'') <> p_txn_id;
  v_room := GREATEST(0, c.value - v_used);
  v_amt  := LEAST(c.amount, v_room);
  IF v_amt <= 0 THEN RETURN jsonb_build_object('success', false, 'error', 'Contract value already fully certified'); END IF;

  INSERT INTO public.work_certifications (
    org_id, project_id, wo_id, milestone_id, stakeholder_id,
    reading_kind, reading_value, computed_amount, reading_date, status, source, approved_at, txn_id
  )
  SELECT c.org_id, NULLIF(c.project_id,''), c.wo_id, NULL, c.stakeholder_id,
         'measured', 0, v_amt, COALESCE(t.date, current_date), 'approved', 'payment', now(), p_txn_id
    FROM public.transactions t WHERE t.txn_id = p_txn_id
  ON CONFLICT (txn_id) WHERE txn_id IS NOT NULL
  DO UPDATE SET computed_amount = EXCLUDED.computed_amount, wo_id = EXCLUDED.wo_id,
                stakeholder_id = EXCLUDED.stakeholder_id, project_id = EXCLUDED.project_id,
                status = 'approved', source = 'payment', updated_at = now();

  RETURN jsonb_build_object('success', true, 'on', true, 'amount', v_amt);
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END $$;

REVOKE ALL     ON FUNCTION public.set_payment_certified(text, boolean) FROM public;
GRANT  EXECUTE ON FUNCTION public.set_payment_certified(text, boolean) TO authenticated;

-- ── AUTO backfill — imported / pre-system contract payments on untracked contracts ────────────────
-- Ordered oldest-first per WO, capped cumulatively at the contract value. Idempotent (skips a payment
-- that already has a payment-cert).
INSERT INTO public.work_certifications (
  org_id, project_id, wo_id, milestone_id, stakeholder_id,
  reading_kind, reading_value, computed_amount, reading_date, status, source, approved_at, txn_id
)
SELECT p.org_id, NULLIF(p.project_id,''), p.wo_id, NULL, p.stakeholder_id,
       'measured', 0, p.grant_amt, p.date, 'approved', 'payment', now(), p.txn_id
  FROM (
    SELECT t.txn_id, t.org_id, t.stakeholder_id, t.date,
           ta.order_ref AS wo_id, COALESCE(ta.project_id, wo.project_id) AS project_id,
           t.total_amount::numeric AS amount,
           COALESCE(wo.order_value, (SELECT COALESCE(SUM(m.planned_amount),0) FROM public.wo_milestones m WHERE m.wo_id = wo.wo_id))::numeric AS value,
           LEAST(
             t.total_amount::numeric,
             GREATEST(0, COALESCE(wo.order_value, (SELECT COALESCE(SUM(m.planned_amount),0) FROM public.wo_milestones m WHERE m.wo_id = wo.wo_id))::numeric
               - COALESCE(SUM(t.total_amount::numeric) OVER (PARTITION BY ta.order_ref ORDER BY t.date, t.txn_id
                          ROWS BETWEEN UNBOUNDED PRECEDING AND 1 PRECEDING), 0))
           ) AS grant_amt
      FROM public.transactions t
      JOIN public.txn_allocations ta ON ta.txn_id = t.txn_id AND ta.order_type = 'WO'
      JOIN public.work_orders wo ON wo.wo_id = ta.order_ref
     WHERE t.status IS DISTINCT FROM 'Voided'
       AND t.stakeholder_id IS NOT NULL
       AND (t.txn_id LIKE 'IMP-%' OR t.ai_flag_data->>'source' = 'import')
       AND wo.status IS DISTINCT FROM 'Cancelled'
       AND NOT EXISTS (SELECT 1 FROM public.wo_milestones m JOIN public.labour_attendance a
                         ON a.milestone_id = m.milestone_id AND a.subject_type = 'stage'
                        WHERE m.wo_id = wo.wo_id)
       AND NOT EXISTS (SELECT 1 FROM public.work_certifications wc WHERE wc.txn_id = t.txn_id AND wc.source = 'payment')
  ) p
 WHERE p.grant_amt > 0.5
ON CONFLICT (txn_id) WHERE txn_id IS NOT NULL DO NOTHING;

NOTIFY pgrst, 'reload schema';
