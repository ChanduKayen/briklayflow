-- ===========================================================================
-- Payment → bill allocation.
--
-- Attaching a bill to a payment is now a recorded fact, not virtual FIFO: a
-- txn_allocations row can point at a BILL (bill_id), so a bill's paid/unpaid is
-- SUM(allocations to it), one transaction at a time, as a side effect of normal
-- use. A payment can clear several bills (many allocation rows), pay one
-- partially, or leave a remainder unallocated (the without_bills bucket —
-- order_type NULL, bill_id NULL, unchanged).
--
-- The vendor NET balance is untouched (v_party_balance already nets billed vs
-- paid at the party level); bill_id only makes the PER-BILL settlement real.
-- ===========================================================================

ALTER TABLE public.txn_allocations
  ADD COLUMN IF NOT EXISTS bill_id uuid REFERENCES public.bills(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS txn_allocations_bill_idx ON public.txn_allocations(bill_id);

-- The inert "towards PO-xxx" advance memo — pure tracking on the payment when it precedes any bill.
-- Financially inert: NOT an order_ref money link, just a note that keeps the intent visible.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS advance_po_ref text;

-- set_txn_allocations — now carries bill_id per part. Complete-set replace, must sum to the txn total
-- (a remainder part with no bill/order = the advance / without-bills bucket).
CREATE OR REPLACE FUNCTION public.set_txn_allocations(
  p_txn_id  text,
  p_org_id  uuid,
  p_parts   jsonb   -- [{project_id, order_type, order_ref, milestone_id, bill_id, allocated_amount}]
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
      txn_id, project_id, order_type, order_ref, milestone_id, bill_id, allocated_amount, org_id
    ) VALUES (
      p_txn_id,
      NULLIF(v_p->>'project_id', ''),
      NULLIF(v_p->>'order_type', '')::public.order_type_enum,
      NULLIF(v_p->>'order_ref', ''),
      NULLIF(v_p->>'milestone_id', '')::uuid,
      NULLIF(v_p->>'bill_id', '')::uuid,
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
