-- ===========================================================================
-- Restore the BILLS-table source to the party ledger (a regression fix).
--
-- 20260911000000_bills.sql made the first-class `bills` table the vendor-credit
-- source in v_party_ledger_line (every bills row is billed; a PO's own
-- vendor_bill_amount counts only as a FALLBACK when no bills row names that PO).
-- The later 20260913000001_opening_by_site.sql restated the whole view from the
-- PRE-bills (20260910000003) version — dropping the `bills` union entirely and
-- reverting the vendor source to purchase_orders. Result: a standalone bill
-- (bills.po_id NULL, no PO carrying vendor_bill_amount) produced NO credit line,
-- so it was invisible as owed in v_party_ledger_line / v_party_balance and the
-- old-engine vendor statement. Bills WITHOUT a PO simply weren't credits.
--
-- This restates v_party_ledger_line combining BOTH intents: the bills-first
-- vendor source (+ PO fallback when unnamed) AND the opening-by-site explosion +
-- v_party_site_balance. It also closes a related gap: a payment settled against a
-- first-class bill via txn_allocations.bill_id is no longer counted as
-- "without_bills" (it IS allocated to a bill), so the vendor advance/to_pay math
-- stays consistent with the restored bills source.
--
-- All three views are restated in full so the result is deterministic regardless
-- of which pending migrations ran.
-- ===========================================================================

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
-- Worker WAGE — crew, day basis.
SELECT c.org_id, c.stakeholder_id, c.project_id, a.work_date, 'wage'::text, c.crew_id::text, 'Wages'::text,
       (a.value * cc.rate)::numeric, 0::numeric
  FROM public.labour_crews c
  JOIN public.labour_crew_categories cc ON cc.crew_id = c.crew_id
  JOIN public.labour_attendance a ON a.category_id = cc.id AND a.subject_type = 'crew_category'
 WHERE c.stakeholder_id IS NOT NULL AND c.accrual_basis = 'day' AND a.value > 0
UNION ALL
-- Worker WAGE — direct workers, day basis.
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


-- v_party_balance — same as 20260910000002/20260913000001, but the without_bills bucket now also excludes a
-- payment allocated to a first-class bill via txn_allocations.bill_id (it IS against a bill, so it is not
-- "unallocated vendor cash"). Otherwise settling a standalone bill would inflate both billed and without_bills.
CREATE OR REPLACE VIEW public.v_party_balance
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT l.*
    FROM public.v_party_ledger_line l
    JOIN public.stakeholders s
      ON s.stakeholder_id = l.stakeholder_id AND s.type IN ('Vendor', 'Worker')
    LEFT JOIN public.stakeholder_opening_balances ob
      ON ob.stakeholder_id = l.stakeholder_id AND ob.org_id = l.org_id
   WHERE l.kind = 'opening'
      OR ob.as_of IS NULL
      OR l.line_date >= ob.as_of
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
     AND NOT EXISTS (SELECT 1 FROM public.txn_allocations ta
                      WHERE ta.txn_id = t.txn_id AND (ta.order_type IN ('PO','WO') OR ta.bill_id IS NOT NULL))
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


-- v_party_site_balance — unchanged from 20260913000001; restated for self-containment.
CREATE OR REPLACE VIEW public.v_party_site_balance
WITH (security_invoker = true) AS
WITH lines AS (
  SELECT l.*
    FROM public.v_party_ledger_line l
    JOIN public.stakeholders s
      ON s.stakeholder_id = l.stakeholder_id AND s.type IN ('Vendor', 'Worker')
    LEFT JOIN public.stakeholder_opening_balances ob
      ON ob.stakeholder_id = l.stakeholder_id AND ob.org_id = l.org_id
   WHERE l.project_id IS NOT NULL
     AND (l.kind = 'opening' OR ob.as_of IS NULL OR l.line_date >= ob.as_of)
)
SELECT org_id, stakeholder_id, project_id,
       SUM(billed) AS billed, SUM(paid) AS paid,
       GREATEST(0, SUM(billed) - SUM(paid)) AS to_pay,
       GREATEST(0, SUM(paid) - SUM(billed)) AS advance
  FROM lines
 GROUP BY org_id, stakeholder_id, project_id;

GRANT SELECT ON public.v_party_site_balance TO authenticated;
