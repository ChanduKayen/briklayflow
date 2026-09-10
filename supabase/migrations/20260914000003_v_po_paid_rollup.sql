-- ===========================================================================
-- v_po_paid — a PO's paid amount, rolled up from its BILLS.
--
-- A PO's money is the sum of its bills; a bill's paid is the sum of its
-- txn_allocations.bill_id. A payment recorded against a bill that sits on a PO
-- must therefore count toward the PO — even when the payment has no direct PO
-- allocation. Legacy direct-PO payments (order_type='PO') still count.
--
-- Each allocation counts ONCE (a bill-settling payment may carry BOTH order_type
-- ='PO' and bill_id — see saveBillAllocations): the row is emitted once and its
-- po_id is the PO ref when present, else the bill's PO. Voided payments excluded.
-- One source of truth so PO list, PO detail, and the ledger agree.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_po_paid
WITH (security_invoker = true) AS
SELECT po_id, SUM(allocated_amount)::numeric AS paid
FROM (
  SELECT ta.allocation_id,
         CASE WHEN ta.order_type = 'PO' AND ta.order_ref IS NOT NULL THEN ta.order_ref ELSE b.po_id END AS po_id,
         ta.allocated_amount
    FROM public.txn_allocations ta
    JOIN public.transactions t ON t.txn_id = ta.txn_id AND t.status IS DISTINCT FROM 'Voided'
    LEFT JOIN public.bills b ON b.id = ta.bill_id
   WHERE (ta.order_type = 'PO' AND ta.order_ref IS NOT NULL)
      OR (ta.bill_id IS NOT NULL AND b.po_id IS NOT NULL)
) x
WHERE po_id IS NOT NULL
GROUP BY po_id;

GRANT SELECT ON public.v_po_paid TO authenticated;
