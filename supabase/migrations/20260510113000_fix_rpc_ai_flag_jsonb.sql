-- Fix: ai_flag_data column is jsonb but the RPC was extracting it as text using ->>
-- Changed p_txn->>'ai_flag_data' to p_txn->'ai_flag_data' to preserve jsonb type

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
  -- Insert transaction
  INSERT INTO public.transactions (
    txn_id, stakeholder_id, date, total_amount, payment_mode, category, remarks, ai_flag_status, ai_flag_data, entered_by
  ) VALUES (
    p_txn->>'txn_id',
    p_txn->>'stakeholder_id',
    (p_txn->>'date')::date,
    (p_txn->>'total_amount')::numeric,
    (p_txn->>'payment_mode')::public.payment_mode,
    p_txn->>'category',
    p_txn->>'remarks',
    (p_txn->>'ai_flag_status')::public.ai_flag_status,
    COALESCE(p_txn->'ai_flag_data', '{}'::jsonb),
    auth.uid()
  ) RETURNING txn_id INTO v_txn_id;

  -- Insert allocations
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
