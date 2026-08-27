-- set_txn_allocations — atomically replace ALL of a transaction's allocations, ACROSS PROJECTS,
-- in a single DB transaction. This generalises replace_txn_allocations (which is scoped to one
-- project): here each part carries its own project_id, so one payment can be split across several
-- sites at once. The schema validates that a transaction's allocations sum to its total; doing this
-- per-project from the client would trip that check between calls, so the whole set is rewritten in
-- one deferred-constraint transaction.
--
-- The caller passes the COMPLETE desired set for the transaction; p_parts must sum to the
-- transaction's total_amount. MONEY ONLY — only touches txn_allocations.
--
-- Used by the transactions "Attach bill" flow, which books one payment across N sites/POs.

CREATE OR REPLACE FUNCTION public.set_txn_allocations(
  p_txn_id  text,
  p_org_id  uuid,
  p_parts   jsonb   -- [{project_id, order_type, order_ref, milestone_id, allocated_amount}]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_p jsonb;
BEGIN
  IF p_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  SET CONSTRAINTS ALL DEFERRED;

  DELETE FROM public.txn_allocations
  WHERE txn_id = p_txn_id AND org_id = p_org_id;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_parts)
  LOOP
    INSERT INTO public.txn_allocations (
      txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id
    ) VALUES (
      p_txn_id,
      NULLIF(v_p->>'project_id', ''),
      NULLIF(v_p->>'order_type', '')::public.order_type_enum,
      NULLIF(v_p->>'order_ref', ''),
      NULLIF(v_p->>'milestone_id', '')::uuid,
      (v_p->>'allocated_amount')::numeric,
      p_org_id
    );
  END LOOP;

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL     ON FUNCTION public.set_txn_allocations(text, uuid, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.set_txn_allocations(text, uuid, jsonb) TO authenticated;
