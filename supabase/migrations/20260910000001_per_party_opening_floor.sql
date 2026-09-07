-- ===========================================================================
-- Opening balance = the party's own cutover.
--
-- Until now the accrual boundary was ONE org-wide date (organizations.
-- ledger_start_date). An opening balance was just a seed row; it did NOT stop
-- pre-opening lines from counting. So "₹1000 as of Aug 31 for Ramesh" did not
-- actually make Ramesh's books start on Aug 31 — his earlier attendance still
-- accrued.
--
-- This aligns us with how Tally / QuickBooks / Zoho work: a books-start date is
-- the DEFAULT boundary, and each ledger's opening balance carries its own "as of"
-- date that acts as THAT party's floor. So the boundary is now, per line:
--
--     floor = COALESCE(this party's opening as_of, org ledger_start_date, the line's own date)
--
-- • a party WITH an opening balance → counts its opening + everything on/after
--   the opening's as_of date; everything before is settled by the opening.
-- • a party WITHOUT one → falls back to the org books-start date (or all history
--   if that is unset too).
-- The opening line itself always counts.
--
-- Only v_party_balance's line filter changes; every other clause is carried over
-- verbatim from 20260909000003.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_party_balance
WITH (security_invoker = true) AS
WITH lines AS (
  -- Per-party cutover: a line counts if it is the opening row, or it is dated on/after this party's
  -- floor — the party's own opening as_of when set, else the org books-start date, else the line's own
  -- date (which makes the test always true → count everything).
  SELECT l.*
    FROM public.v_party_ledger_line l
    JOIN public.stakeholders s
      ON s.stakeholder_id = l.stakeholder_id AND s.type IN ('Vendor', 'Worker')
    LEFT JOIN public.organizations o
      ON o.org_id = l.org_id
    LEFT JOIN public.stakeholder_opening_balances ob
      ON ob.stakeholder_id = l.stakeholder_id AND ob.org_id = l.org_id
   WHERE l.kind = 'opening'
      OR l.line_date >= COALESCE(ob.as_of, o.ledger_start_date, l.line_date)
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
