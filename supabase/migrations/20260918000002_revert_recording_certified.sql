-- ===========================================================================
-- REVERT 20260918000000 (recording-is-certified). That change made v_party_ledger_line
-- count raw muster stage readings as certified. But the LIVE (legacy) party engine
-- reads "certified" from the work_certifications TABLE while it reads "to pay" from
-- this VIEW — so a view-only change split the two: the header (to_pay) jumped to
-- include every reading while the certified figure stayed put. Restoring the view to
-- the 20260915000000 definition realigns them (certified table == view again).
--
-- certify-from-payment (20260918000001) is KEPT: those certs live in work_certifications,
-- which BOTH the table-reader and the view see, so they stay consistent.
--
-- This is byte-for-byte the 20260915000000 body: the day-wage unions keep the
-- `settled_at IS NULL` exclusion; the certified unions are the plain work_certifications
-- ones with NO reading unions and NO stage-reading de-dup guard.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_party_ledger_line
WITH (security_invoker = true) AS
SELECT b.org_id, b.stakeholder_id, b.project_id,
       COALESCE(b.bill_date, b.created_at::date) AS line_date,
       'po_bill'::text AS kind, b.id::text AS ref_id,
       'Bill ' || COALESCE(b.bill_no, left(b.id::text, 8)) AS label,
       b.amount::numeric AS billed, 0::numeric AS paid
  FROM public.bills b
 WHERE b.stakeholder_id IS NOT NULL AND b.amount > 0
UNION ALL
SELECT po.org_id, po.stakeholder_id, po.project_id,
       COALESCE(po.vendor_bill_date, po.bill_recorded_at::date, po.date_issued) AS line_date,
       'po_bill'::text AS kind, po.po_id AS ref_id,
       'Bill ' || COALESCE(po.vendor_bill_number, po.po_id) AS label,
       po.vendor_bill_amount::numeric AS billed, 0::numeric AS paid
  FROM public.purchase_orders po
 WHERE po.stakeholder_id IS NOT NULL AND po.vendor_bill_amount IS NOT NULL AND po.vendor_bill_amount > 0
   AND COALESCE(po.approval_status, 'APPROVED') = 'APPROVED'
   AND COALESCE(upper(po.status), '') <> 'CANCELLED'
   AND NOT EXISTS (SELECT 1 FROM public.bills b WHERE b.po_id = po.po_id)
UNION ALL
SELECT cb.org_id, cb.stakeholder_id, NULL::text, cb.period_to, 'consolidated'::text, cb.id::text,
       'Consolidated bill'::text, cb.amount, 0::numeric
  FROM public.consolidated_bills cb
UNION ALL
SELECT ob.org_id, ob.stakeholder_id, bs.key AS project_id, ob.as_of, 'opening'::text,
       ob.id::text || ':' || bs.key AS ref_id, 'Opening balance'::text,
       CASE WHEN ob.direction = 'work_owed'  THEN bs.value::numeric ELSE 0 END,
       CASE WHEN ob.direction = 'paid_ahead' THEN bs.value::numeric ELSE 0 END
  FROM public.stakeholder_opening_balances ob
  CROSS JOIN LATERAL jsonb_each_text(COALESCE(ob.by_site, '{}'::jsonb)) AS bs(key, value)
 WHERE bs.value::numeric <> 0
UNION ALL
SELECT ob.org_id, ob.stakeholder_id, NULL::text, ob.as_of, 'opening'::text, ob.id::text, 'Opening balance'::text,
       CASE WHEN ob.direction = 'work_owed'  THEN rem.amt ELSE 0 END,
       CASE WHEN ob.direction = 'paid_ahead' THEN rem.amt ELSE 0 END
  FROM public.stakeholder_opening_balances ob
  CROSS JOIN LATERAL (
    SELECT ob.total_amount - COALESCE((SELECT SUM(v::numeric) FROM jsonb_each_text(COALESCE(ob.by_site, '{}'::jsonb)) AS x(k, v)), 0) AS amt
  ) rem
 WHERE rem.amt <> 0
UNION ALL
SELECT adj.org_id, adj.stakeholder_id, adj.project_id, adj.adj_date, 'adjustment'::text, adj.id::text,
       COALESCE(adj.note, 'Adjustment'),
       CASE WHEN adj.side = 'certified' THEN adj.amount ELSE 0 END,
       CASE WHEN adj.side = 'paid'      THEN adj.amount ELSE 0 END
  FROM public.party_adjustments adj
UNION ALL
SELECT t.org_id, t.stakeholder_id,
       (SELECT ta.project_id FROM public.txn_allocations ta WHERE ta.txn_id = t.txn_id ORDER BY ta.allocated_amount DESC NULLS LAST LIMIT 1),
       t.date, 'payment'::text, t.txn_id, COALESCE(t.category, 'Payment'), 0::numeric, t.total_amount
  FROM public.transactions t
 WHERE t.stakeholder_id IS NOT NULL AND t.status IS DISTINCT FROM 'Voided'
UNION ALL
SELECT c.org_id, c.stakeholder_id, c.project_id, a.work_date, 'wage'::text, c.crew_id::text, 'Wages'::text,
       (a.value * cc.rate)::numeric, 0::numeric
  FROM public.labour_crews c
  JOIN public.labour_crew_categories cc ON cc.crew_id = c.crew_id
  JOIN public.labour_attendance a ON a.category_id = cc.id AND a.subject_type = 'crew_category'
 WHERE c.stakeholder_id IS NOT NULL AND c.accrual_basis = 'day' AND a.value > 0 AND a.settled_at IS NULL
UNION ALL
SELECT d.org_id, d.stakeholder_id, d.project_id, a.work_date, 'wage'::text, d.id::text, 'Wages'::text,
       (a.value * d.rate)::numeric, 0::numeric
  FROM public.labour_direct_workers d
  JOIN public.labour_attendance a ON a.direct_worker_id = d.id AND a.subject_type = 'direct'
 WHERE d.stakeholder_id IS NOT NULL AND d.accrual_basis = 'day' AND a.value > 0 AND a.settled_at IS NULL
UNION ALL
SELECT wc.org_id, wc.stakeholder_id, wc.project_id, wc.reading_date, 'certified'::text, wc.id::text,
       'Certified work'::text, wc.computed_amount, 0::numeric
  FROM public.work_certifications wc
 WHERE wc.status = 'approved' AND wc.reading_kind IN ('measured','piece') AND wc.stakeholder_id IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.work_orders wo WHERE wo.wo_id = wc.wo_id AND wo.status = 'Cancelled')
UNION ALL
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

NOTIFY pgrst, 'reload schema';
