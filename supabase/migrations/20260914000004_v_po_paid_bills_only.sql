-- ===========================================================================
-- v_po_paid — a PO's paid, rolled up STRICTLY from its bills.
--
-- The first cut (20260914000003) also summed direct order_type='PO' allocations.
-- But a payment recorded straight against a PO with no bill is an ADVANCE (it
-- belongs on the vendor's ledger), and counting it made a PO read "₹120 paid"
-- while its ₹200 bill sat fully due — the PO's paid, its per-bill balances, and
-- its status disagreed. A PO's paid is now ONLY what its bills were paid
-- (txn_allocations.bill_id → bills.po_id), non-voided. Advances live on the
-- party ledger, not here.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_po_paid
WITH (security_invoker = true) AS
SELECT b.po_id, SUM(ta.allocated_amount)::numeric AS paid
  FROM public.txn_allocations ta
  JOIN public.bills b ON b.id = ta.bill_id
  JOIN public.transactions t ON t.txn_id = ta.txn_id AND t.status IS DISTINCT FROM 'Voided'
 WHERE ta.bill_id IS NOT NULL AND b.po_id IS NOT NULL
 GROUP BY b.po_id;

GRANT SELECT ON public.v_po_paid TO authenticated;
