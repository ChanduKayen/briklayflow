-- ===========================================================================
-- An opening balance carries a SITE, and the site is now first-class.
--
-- stakeholder_opening_balances.by_site ({project_id: amount}) has stored the
-- split since 20260903, but v_party_ledger_line emitted the opening as ONE line
-- with project_id = NULL — so the attribution was written and then thrown away.
-- Nothing downstream could show a site-wise opening balance or carry it forward
-- per site in Payables.
--
-- This rewrites the opening branch to EXPLODE by_site into one line per project,
-- plus a single NULL-project line for whatever is left unassigned (the remainder
-- = total − Σ by_site). The remainder line means the total can never drift when a
-- split is partial or empty — an empty by_site still yields exactly the old
-- single whole-party line.
--
-- It also adds v_party_site_balance: the same billed/paid/to_pay/advance rollup as
-- v_party_balance but grouped by (party, project), so Payables and the party page
-- can read a true per-site position. Per-site advance ignores without_bills
-- (unallocated vendor cash isn't attributable to a site).
--
-- Both v_party_ledger_line (from 20260910000003, cancelled-exclusion) and
-- v_party_balance (from 20260910000002, cutover-only-with-opening) are restated in
-- full so the result is deterministic regardless of which pending migrations ran.
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
-- Opening balance, exploded per site. by_site → one line per project…
SELECT ob.org_id, ob.stakeholder_id, bs.key AS project_id, ob.as_of, 'opening'::text,
       ob.id::text || ':' || bs.key AS ref_id, 'Opening balance'::text,
       CASE WHEN ob.direction = 'work_owed'  THEN bs.value::numeric ELSE 0 END,
       CASE WHEN ob.direction = 'paid_ahead' THEN bs.value::numeric ELSE 0 END
  FROM public.stakeholder_opening_balances ob
  CROSS JOIN LATERAL jsonb_each_text(COALESCE(ob.by_site, '{}'::jsonb)) AS bs(key, value)
 WHERE bs.value::numeric <> 0
UNION ALL
-- …plus the unassigned remainder (total − Σ by_site) as a NULL-project line. Empty by_site → this is
-- the whole opening (exactly the pre-explosion behaviour); fully split → 0 and dropped.
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


-- v_party_balance — unchanged from 20260910000002 (cutover-only-with-opening); restated so this
-- migration is self-contained.
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


-- v_party_site_balance — the per-SITE position for a party (same cutover rule as v_party_balance,
-- grouped by project). This is the surface Payables reads to show and carry a site-wise balance. Only
-- lines that carry a project_id contribute; unassigned opening remainder / consolidated bills sit
-- outside any site and are intentionally not counted here.
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
