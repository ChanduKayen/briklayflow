-- v_vendor_balance — read-only vendor payable, summed from the ledger (never a cached or
-- parallel value). One row per (org_id, stakeholder_id, project_id):
--
--   owed = approved PO order totals  −  payments applied to those POs  −  advance credit
--
-- The vendor hub READS this; it must never recompute balance some other way.
-- security_invoker = true so the view runs under the CALLER's RLS (the underlying
-- org-scoped policies apply); without it a view bypasses RLS via the owner.
--
-- Run AFTER 20260621000002 (needs the 'ADVANCE' order_type value).

CREATE OR REPLACE VIEW public.v_vendor_balance
WITH (security_invoker = true) AS
WITH po_ordered AS (
  SELECT po.org_id, po.stakeholder_id, po.project_id,
         SUM(COALESCE(po.total_value, po.order_value, 0)) AS ordered
  FROM public.purchase_orders po
  WHERE po.approval_status = 'APPROVED'
    AND upper(po.status) <> 'CANCELLED'
    AND po.stakeholder_id IS NOT NULL
  GROUP BY po.org_id, po.stakeholder_id, po.project_id
),
po_paid AS (
  SELECT po.org_id, po.stakeholder_id, po.project_id,
         SUM(ta.allocated_amount) AS paid
  FROM public.txn_allocations ta
  JOIN public.purchase_orders po ON po.po_id = ta.order_ref
  WHERE ta.order_type = 'PO'
  GROUP BY po.org_id, po.stakeholder_id, po.project_id
),
advances AS (
  SELECT t.org_id, t.stakeholder_id, ta.project_id,
         SUM(ta.allocated_amount) AS credit
  FROM public.txn_allocations ta
  JOIN public.transactions t ON t.txn_id = ta.txn_id
  WHERE ta.order_type = 'ADVANCE'
    AND t.stakeholder_id IS NOT NULL
  GROUP BY t.org_id, t.stakeholder_id, ta.project_id
)
SELECT
  o.org_id,
  o.stakeholder_id,
  o.project_id,
  GREATEST(0, COALESCE(o.ordered, 0) - COALESCE(p.paid, 0) - COALESCE(a.credit, 0)) AS owed
FROM po_ordered o
LEFT JOIN po_paid  p ON p.org_id = o.org_id AND p.stakeholder_id = o.stakeholder_id AND p.project_id IS NOT DISTINCT FROM o.project_id
LEFT JOIN advances a ON a.org_id = o.org_id AND a.stakeholder_id = o.stakeholder_id AND a.project_id IS NOT DISTINCT FROM o.project_id;

GRANT SELECT ON public.v_vendor_balance TO authenticated;
