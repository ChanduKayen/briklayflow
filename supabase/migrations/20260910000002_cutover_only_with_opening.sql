-- ===========================================================================
-- Make the cutover SAFE: it takes effect for a party only via that party's own
-- opening balance — never as a silent org-wide filter.
--
-- The bug it fixes: with an org ledger_start_date set but NO opening for a party,
-- the old filter dropped that party's pre-cutover lines — including their PAYMENTS.
-- A worker paid ₹1,79,000 against ₹35,000 of work (paid AHEAD ₹1,44,000) then read
-- as "₹11,000 to pay" (only the post-cutover wage days survived; the advance that
-- covers them was thrown away). Dropping history you haven't captured as an opening
-- invents money.
--
-- New rule — "opening IS the cutover, per party":
--   · party has an opening balance → floor at its as_of (opening + everything on/
--     after it; before is settled by the figure). Set ₹0 to deliberately start a
--     party clean at a date.
--   · party has NO opening → count ALL their history (nothing is silently dropped;
--     the balance is the honest paid-vs-owed position).
-- The org ledger_start_date is no longer a filter here — it only supplies the
-- DEFAULT as_of the opening editor pre-fills (see StakeholderDetail). Only
-- v_party_balance's line filter changes; every other clause is carried over.
-- ===========================================================================

CREATE OR REPLACE VIEW public.v_party_balance
WITH (security_invoker = true) AS
WITH lines AS (
  -- A line counts if it is the opening row, or the party has no opening at all (count everything),
  -- or it is dated on/after that party's opening as_of. The org date is intentionally NOT a filter.
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
