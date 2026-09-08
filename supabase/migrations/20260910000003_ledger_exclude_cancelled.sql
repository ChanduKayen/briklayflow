-- ===========================================================================
-- Keep cancelled / unapproved obligations OUT of the ledger.
--
-- v_party_ledger_line leaked three kinds of dead obligation into the balance:
--   1. CANCELLED purchase orders  — a cancelled PO's bill still counted as billed.
--   2. UNAPPROVED purchase orders — a PENDING/REJECTED PO's bill counted too,
--      even though the vendor payables list only ever counts APPROVED POs
--      (loadVendorRows), so the ledger and that list diverged.
--   3. Certifications on a CANCELLED work order — approved certs stayed owed
--      after the contract they belong to was cancelled.
-- (Voided payments were already excluded — that stays.)
--
-- Rule: a line is a real obligation only if the document behind it is live.
--   · PO bill      → approval_status = 'APPROVED' AND status <> 'CANCELLED'
--   · certification→ its work order is not 'Cancelled'
-- Closed / Settled work orders are NOT excluded — work certified on them is
-- still genuinely owed until it's paid; only Cancelled means "never happened".
--
-- Only v_party_ledger_line is rewritten (CREATE OR REPLACE); v_party_balance
-- reads it unchanged. Every other branch is carried over verbatim.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_party_ledger_line
WITH (security_invoker = true) AS
-- PO bills (vendor payable side) — APPROVED and not CANCELLED only.
SELECT po.org_id, po.stakeholder_id, po.project_id,
       COALESCE(po.vendor_bill_date, po.bill_recorded_at::date, po.date_issued) AS line_date,
       'po_bill'::text AS kind, po.po_id AS ref_id,
       'Bill ' || COALESCE(po.vendor_bill_number, po.po_id) AS label,
       po.vendor_bill_amount::numeric AS billed, 0::numeric AS paid
  FROM public.purchase_orders po
 WHERE po.stakeholder_id IS NOT NULL AND po.vendor_bill_amount IS NOT NULL AND po.vendor_bill_amount > 0
   AND COALESCE(po.approval_status, 'APPROVED') = 'APPROVED'
   AND COALESCE(upper(po.status), '') <> 'CANCELLED'
UNION ALL
SELECT cb.org_id, cb.stakeholder_id, NULL::text, cb.period_to, 'consolidated'::text, cb.id::text,
       'Consolidated bill'::text, cb.amount, 0::numeric
  FROM public.consolidated_bills cb
UNION ALL
SELECT ob.org_id, ob.stakeholder_id, NULL::text, ob.as_of, 'opening'::text, ob.id::text, 'Opening balance'::text,
       CASE WHEN ob.direction = 'work_owed'  THEN ob.total_amount ELSE 0 END,
       CASE WHEN ob.direction = 'paid_ahead' THEN ob.total_amount ELSE 0 END
  FROM public.stakeholder_opening_balances ob
UNION ALL
SELECT adj.org_id, adj.stakeholder_id, adj.project_id, adj.adj_date, 'adjustment'::text, adj.id::text,
       COALESCE(adj.note, 'Adjustment'),
       CASE WHEN adj.side = 'certified' THEN adj.amount ELSE 0 END,
       CASE WHEN adj.side = 'paid'      THEN adj.amount ELSE 0 END
  FROM public.party_adjustments adj
UNION ALL
-- Payments (debit) — never a voided one.
SELECT t.org_id, t.stakeholder_id,
       (SELECT ta.project_id FROM public.txn_allocations ta WHERE ta.txn_id = t.txn_id ORDER BY ta.allocated_amount DESC NULLS LAST LIMIT 1),
       t.date, 'payment'::text, t.txn_id, COALESCE(t.category, 'Payment'), 0::numeric, t.total_amount
  FROM public.transactions t
 WHERE t.stakeholder_id IS NOT NULL AND t.status IS DISTINCT FROM 'Voided'
UNION ALL
-- Worker WAGE (day-basis engagements only — declared, not inferred). Crew skill rows.
SELECT c.org_id, c.stakeholder_id, c.project_id, a.work_date, 'wage'::text, c.crew_id::text, 'Wages'::text,
       (a.value * cc.rate)::numeric, 0::numeric
  FROM public.labour_crews c
  JOIN public.labour_crew_categories cc ON cc.crew_id = c.crew_id
  JOIN public.labour_attendance a ON a.category_id = cc.id AND a.subject_type = 'crew_category'
 WHERE c.stakeholder_id IS NOT NULL AND c.accrual_basis = 'day' AND a.value > 0
UNION ALL
-- Worker WAGE — direct workers on a day basis.
SELECT d.org_id, d.stakeholder_id, d.project_id, a.work_date, 'wage'::text, d.id::text, 'Wages'::text,
       (a.value * d.rate)::numeric, 0::numeric
  FROM public.labour_direct_workers d
  JOIN public.labour_attendance a ON a.direct_worker_id = d.id AND a.subject_type = 'direct'
 WHERE d.stakeholder_id IS NOT NULL AND d.accrual_basis = 'day' AND a.value > 0
UNION ALL
-- CERTIFIED — approved measured/piece certifications, contract not cancelled.
SELECT wc.org_id, wc.stakeholder_id, wc.project_id, wc.reading_date, 'certified'::text, wc.id::text,
       'Certified work'::text, wc.computed_amount, 0::numeric
  FROM public.work_certifications wc
 WHERE wc.status = 'approved' AND wc.reading_kind IN ('measured','piece') AND wc.stakeholder_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.work_orders wo WHERE wo.wo_id = wc.wo_id AND wo.status = 'Cancelled')
UNION ALL
-- CERTIFIED — approved LUMP certifications: latest per milestone, contract not cancelled.
SELECT * FROM (
  SELECT DISTINCT ON (wc.milestone_id)
         wc.org_id, wc.stakeholder_id, wc.project_id, wc.reading_date, 'certified'::text AS kind, wc.id::text AS ref_id,
         'Certified work'::text AS label, wc.computed_amount AS billed, 0::numeric AS paid
    FROM public.work_certifications wc
   WHERE wc.status = 'approved' AND wc.reading_kind = 'lump' AND wc.stakeholder_id IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.work_orders wo WHERE wo.wo_id = wc.wo_id AND wo.status = 'Cancelled')
   ORDER BY wc.milestone_id, wc.reading_date DESC
) lump_latest;

GRANT SELECT ON public.v_party_ledger_line TO authenticated;
