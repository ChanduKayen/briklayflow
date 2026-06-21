-- replace_txn_allocations — atomically re-split a transaction's allocations for ONE
-- project in a single DB transaction. Needed because the schema validates that a
-- transaction's allocations sum to its total; doing update-then-insert from the client
-- (two separate transactions) trips that check after the first write. Here the delete +
-- inserts happen together, and SET CONSTRAINTS ALL DEFERRED pushes the (deferrable)
-- sum check to commit, against the final state.
--
-- The caller passes the COMPLETE desired set for (txn, project); p_parts must sum to the
-- transaction's amount for that project. MONEY ONLY — only touches txn_allocations.
--
-- Run AFTER 20260621000002 (needs the 'ADVANCE' order_type value).

CREATE OR REPLACE FUNCTION public.replace_txn_allocations(
  p_txn_id     text,
  p_project_id text,
  p_org_id     uuid,
  p_parts      jsonb   -- [{order_type, order_ref, milestone_id, allocated_amount}]
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
  WHERE txn_id = p_txn_id AND project_id = p_project_id AND org_id = p_org_id;

  FOR v_p IN SELECT * FROM jsonb_array_elements(p_parts)
  LOOP
    INSERT INTO public.txn_allocations (
      txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id
    ) VALUES (
      p_txn_id,
      p_project_id,
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

REVOKE ALL     ON FUNCTION public.replace_txn_allocations(text, text, uuid, jsonb) FROM public;
GRANT  EXECUTE ON FUNCTION public.replace_txn_allocations(text, text, uuid, jsonb) TO authenticated;
