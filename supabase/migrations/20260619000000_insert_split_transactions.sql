-- ===========================================================================
-- Split a payment across projects → SEPARATE transactions (one ledger entry each).
--
-- Mirrors insert_transaction_with_allocations, but creates N independent
-- transactions in ONE DB transaction (atomic — all or nothing, so a split never
-- lands half-written). Shared fields (party, date, mode, docs, remarks…) come in
-- p_base; each split carries its own txn_id, amount, project and optional WO/PO
-- link. Every split gets exactly one allocation for its full amount.
--
-- The client generates the txn_ids (same as the single-insert path) and must make
-- them distinct across the splits; the PK on transactions.txn_id is the backstop.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.insert_split_transactions(
  p_base   jsonb,
  p_splits jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org_id uuid;
  v_split  jsonb;
  v_txn_id text;
  v_ids    text[] := '{}';
BEGIN
  v_org_id := (p_base->>'org_id')::uuid;

  IF p_splits IS NULL OR jsonb_array_length(p_splits) = 0 THEN
    RAISE EXCEPTION 'no splits provided';
  END IF;

  FOR v_split IN SELECT * FROM jsonb_array_elements(p_splits)
  LOOP
    v_txn_id := v_split->>'txn_id';

    INSERT INTO public.transactions (
      txn_id, stakeholder_id, date, total_amount, payment_mode,
      category, remarks, bill_doc_url, proof_document_url,
      ai_flag_status, ai_flag_data, entered_by, org_id
    ) VALUES (
      v_txn_id,
      NULLIF(p_base->>'stakeholder_id', ''),
      (p_base->>'date')::date,
      (v_split->>'total_amount')::numeric,
      (p_base->>'payment_mode')::public.payment_mode,
      p_base->>'category',
      p_base->>'remarks',
      p_base->>'bill_doc_url',
      p_base->>'proof_document_url',
      (p_base->>'ai_flag_status')::public.ai_flag_status,
      COALESCE(p_base->'ai_flag_data', '{}'::jsonb),
      auth.uid(),
      v_org_id
    );

    INSERT INTO public.txn_allocations (
      txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id
    ) VALUES (
      v_txn_id,
      v_split->>'project_id',
      NULLIF(v_split->>'order_type', '')::public.order_type_enum,
      NULLIF(v_split->>'order_ref', ''),
      NULLIF(v_split->>'milestone_id', '')::uuid,
      (v_split->>'total_amount')::numeric,
      v_org_id
    );

    v_ids := array_append(v_ids, v_txn_id);
  END LOOP;

  RETURN jsonb_build_object('success', true, 'txn_ids', to_jsonb(v_ids));
END;
$$;

REVOKE ALL  ON FUNCTION public.insert_split_transactions(jsonb, jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.insert_split_transactions(jsonb, jsonb) TO authenticated;
