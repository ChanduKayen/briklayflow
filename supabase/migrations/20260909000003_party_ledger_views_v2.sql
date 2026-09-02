-- ===========================================================================
-- Phase 1 — repoint the single-source party views onto the CONFIRMATION layer:
--   · wage lines now key off the engagement's DECLARED basis (accrual_basis='day'),
--     not the old is_contract/wo_id inference.
--   · certified lines now come from APPROVED work_certifications (measured/piece =
--     Σ incremental, lump = latest per milestone), not raw attendance stage readings
--     — so only governed, approved obligations count.
--   · v_party_balance applies the org LEDGER CUTOVER: when organizations.ledger_start_date
--     is set, only lines on/after it count (before = settled via opening balances);
--     NULL = count everything (unchanged for orgs that haven't cut over).
-- Supersedes 20260908000000 (CREATE OR REPLACE); runs after work_certifications exists.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_party_ledger_line
WITH (security_invoker = true) AS
-- PO bills (vendor payable side).
SELECT po.org_id, po.stakeholder_id, po.project_id,
       COALESCE(po.vendor_bill_date, po.bill_recorded_at::date, po.date_issued) AS line_date,
       'po_bill'::text AS kind, po.po_id AS ref_id,
       'Bill ' || COALESCE(po.vendor_bill_number, po.po_id) AS label,
       po.vendor_bill_amount::numeric AS billed, 0::numeric AS paid
  FROM public.purchase_orders po
 WHERE po.stakeholder_id IS NOT NULL AND po.vendor_bill_amount IS NOT NULL AND po.vendor_bill_amount > 0
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
-- CERTIFIED — approved measured/piece certifications (each an incremental credit).
SELECT wc.org_id, wc.stakeholder_id, wc.project_id, wc.reading_date, 'certified'::text, wc.id::text,
       'Certified work'::text, wc.computed_amount, 0::numeric
  FROM public.work_certifications wc
 WHERE wc.status = 'approved' AND wc.reading_kind IN ('measured','piece') AND wc.stakeholder_id IS NOT NULL
UNION ALL
-- CERTIFIED — approved LUMP certifications: only the latest per milestone (cumulative %). Wrapped in a
-- subquery so DISTINCT ON + ORDER BY scope to THIS select, not the whole UNION.
SELECT * FROM (
  SELECT DISTINCT ON (wc.milestone_id)
         wc.org_id, wc.stakeholder_id, wc.project_id, wc.reading_date, 'certified'::text AS kind, wc.id::text AS ref_id,
         'Certified work'::text AS label, wc.computed_amount AS billed, 0::numeric AS paid
    FROM public.work_certifications wc
   WHERE wc.status = 'approved' AND wc.reading_kind = 'lump' AND wc.stakeholder_id IS NOT NULL
   ORDER BY wc.milestone_id, wc.reading_date DESC
) lump_latest;

GRANT SELECT ON public.v_party_ledger_line TO authenticated;


CREATE OR REPLACE VIEW public.v_party_balance
WITH (security_invoker = true) AS
WITH lines AS (
  -- Vendors + workers, and the ledger cutover: when an org has cut over, only count lines on/after the
  -- boundary (before it is captured by opening balances). The opening line itself always counts.
  SELECT l.* FROM public.v_party_ledger_line l
    JOIN public.stakeholders s ON s.stakeholder_id = l.stakeholder_id AND s.type IN ('Vendor', 'Worker')
    LEFT JOIN public.organizations o ON o.org_id = l.org_id
   WHERE o.ledger_start_date IS NULL OR l.line_date >= o.ledger_start_date OR l.kind = 'opening'
),
agg AS (
  SELECT org_id, stakeholder_id, SUM(billed) AS billed, SUM(paid) AS paid
    FROM lines GROUP BY org_id, stakeholder_id
),
without AS (
  SELECT t.org_id, t.stakeholder_id, SUM(t.total_amount) AS without_bills
    FROM public.transactions t
    JOIN public.stakeholders s ON s.stakeholder_id = t.stakeholder_id AND s.type = 'Vendor'
   WHERE t.status IS DISTINCT FROM 'Voided'
     AND NOT EXISTS (SELECT 1 FROM public.txn_allocations ta WHERE ta.txn_id = t.txn_id AND ta.order_type IN ('PO','WO'))
     AND NOT EXISTS (SELECT 1 FROM public.consolidated_bills cb WHERE cb.stakeholder_id = t.stakeholder_id AND t.date BETWEEN cb.period_from AND cb.period_to)
   GROUP BY t.org_id, t.stakeholder_id
)
SELECT
  a.org_id, a.stakeholder_id, a.billed, a.paid,
  COALESCE(w.without_bills, 0)                                  AS without_bills,
  GREATEST(0, a.billed - a.paid)                               AS to_pay,
  GREATEST(0, a.paid - a.billed - COALESCE(w.without_bills,0)) AS advance,
  (a.paid - a.billed)                                          AS net_ahead
FROM agg a
LEFT JOIN without w ON w.org_id = a.org_id AND w.stakeholder_id = a.stakeholder_id;

GRANT SELECT ON public.v_party_balance TO authenticated;
