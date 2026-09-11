-- ===========================================================================
-- "Settle attendance to contract" — a contracted crew's day-wages, once applied
-- to the contract's phases, must stop counting as a separate day-wage credit or
-- the worker would be owed the same work twice (once as day-wages, once as the
-- phase certification).
--
-- labour_attendance.settled_at records the day a row's wage was folded into the
-- contract (via a governed work_certification against a phase). The day-wage
-- ledger unions in v_party_ledger_line now skip settled rows, so the ONLY credit
-- that survives is the phase certification. Non-destructive: the muster row and
-- its value stay for the record; it simply no longer mints a wage credit.
-- ===========================================================================

ALTER TABLE public.labour_attendance ADD COLUMN IF NOT EXISTS settled_at date;

-- Restate v_party_ledger_line: identical to 20260914000001 EXCEPT the two day-wage
-- unions gain `AND a.settled_at IS NULL`. Columns are unchanged, so v_party_balance
-- and v_party_site_balance (which read this view) stay valid.
CREATE OR REPLACE VIEW public.v_party_ledger_line
WITH (security_invoker = true) AS
-- Bills (first-class). The vendor payable side — every bills row is billed.
SELECT b.org_id, b.stakeholder_id, b.project_id,
       COALESCE(b.bill_date, b.created_at::date) AS line_date,
       'po_bill'::text AS kind, b.id::text AS ref_id,
       'Bill ' || COALESCE(b.bill_no, left(b.id::text, 8)) AS label,
       b.amount::numeric AS billed, 0::numeric AS paid
  FROM public.bills b
 WHERE b.stakeholder_id IS NOT NULL AND b.amount > 0
UNION ALL
-- PO fallback: a PO's own recorded bill, ONLY when no bills row names that PO (so each bill counts once).
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
-- Opening balance, exploded per site. by_site → one line per project…
SELECT ob.org_id, ob.stakeholder_id, bs.key AS project_id, ob.as_of, 'opening'::text,
       ob.id::text || ':' || bs.key AS ref_id, 'Opening balance'::text,
       CASE WHEN ob.direction = 'work_owed'  THEN bs.value::numeric ELSE 0 END,
       CASE WHEN ob.direction = 'paid_ahead' THEN bs.value::numeric ELSE 0 END
  FROM public.stakeholder_opening_balances ob
  CROSS JOIN LATERAL jsonb_each_text(COALESCE(ob.by_site, '{}'::jsonb)) AS bs(key, value)
 WHERE bs.value::numeric <> 0
UNION ALL
-- …plus the unassigned remainder (total − Σ by_site) as a NULL-project line.
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
-- Payments (debit) — never a voided one.
SELECT t.org_id, t.stakeholder_id,
       (SELECT ta.project_id FROM public.txn_allocations ta WHERE ta.txn_id = t.txn_id ORDER BY ta.allocated_amount DESC NULLS LAST LIMIT 1),
       t.date, 'payment'::text, t.txn_id, COALESCE(t.category, 'Payment'), 0::numeric, t.total_amount
  FROM public.transactions t
 WHERE t.stakeholder_id IS NOT NULL AND t.status IS DISTINCT FROM 'Voided'
UNION ALL
-- Worker WAGE — crew, day basis. Settled rows (folded into a contract phase) no longer accrue a wage.
SELECT c.org_id, c.stakeholder_id, c.project_id, a.work_date, 'wage'::text, c.crew_id::text, 'Wages'::text,
       (a.value * cc.rate)::numeric, 0::numeric
  FROM public.labour_crews c
  JOIN public.labour_crew_categories cc ON cc.crew_id = c.crew_id
  JOIN public.labour_attendance a ON a.category_id = cc.id AND a.subject_type = 'crew_category'
 WHERE c.stakeholder_id IS NOT NULL AND c.accrual_basis = 'day' AND a.value > 0 AND a.settled_at IS NULL
UNION ALL
-- Worker WAGE — direct workers, day basis. Same settled-row exclusion.
SELECT d.org_id, d.stakeholder_id, d.project_id, a.work_date, 'wage'::text, d.id::text, 'Wages'::text,
       (a.value * d.rate)::numeric, 0::numeric
  FROM public.labour_direct_workers d
  JOIN public.labour_attendance a ON a.direct_worker_id = d.id AND a.subject_type = 'direct'
 WHERE d.stakeholder_id IS NOT NULL AND d.accrual_basis = 'day' AND a.value > 0 AND a.settled_at IS NULL
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

NOTIFY pgrst, 'reload schema';
