-- Add proof_document_url to transactions (idempotent)
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS proof_document_url text;

-- Update RPC to write proof_document_url from the p_txn payload.
-- Previously the INSERT only listed bill_doc_url; proof_document_url
-- was passed in the payload but silently ignored by the DB.
CREATE OR REPLACE FUNCTION public.insert_transaction_with_allocations(
  p_txn jsonb,
  p_allocations jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_txn_id text;
  v_alloc jsonb;
BEGIN
  INSERT INTO public.transactions (
    txn_id, stakeholder_id, date, total_amount, payment_mode,
    category, remarks, bill_doc_url, proof_document_url,
    ai_flag_status, ai_flag_data, entered_by
  ) VALUES (
    p_txn->>'txn_id',
    p_txn->>'stakeholder_id',
    (p_txn->>'date')::date,
    (p_txn->>'total_amount')::numeric,
    (p_txn->>'payment_mode')::public.payment_mode,
    p_txn->>'category',
    p_txn->>'remarks',
    p_txn->>'bill_doc_url',
    p_txn->>'proof_document_url',
    (p_txn->>'ai_flag_status')::public.ai_flag_status,
    COALESCE(p_txn->'ai_flag_data', '{}'::jsonb),
    auth.uid()
  ) RETURNING txn_id INTO v_txn_id;

  FOR v_alloc IN SELECT * FROM jsonb_array_elements(p_allocations)
  LOOP
    INSERT INTO public.txn_allocations (
      txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount
    ) VALUES (
      v_txn_id,
      v_alloc->>'project_id',
      NULLIF(v_alloc->>'order_type', '')::public.order_type_enum,
      NULLIF(v_alloc->>'order_ref', ''),
      NULLIF(v_alloc->>'milestone_id', '')::uuid,
      (v_alloc->>'allocated_amount')::numeric
    );
  END LOOP;

  RETURN jsonb_build_object('success', true, 'txn_id', v_txn_id);
END;
$$;
