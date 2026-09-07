-- ===========================================================================
-- Cutover helper — each party's CARRIED (closing) balance as of a cutover date.
--
-- The ledger cutover (organizations.ledger_start_date) treats everything BEFORE
-- the boundary as settled and counts live accrual only on/after it. That is only
-- safe if the genuine amount each party carried across the boundary is captured
-- as a stakeholder_opening_balance — otherwise pre-cutover dues silently vanish
-- (the "daily worker shows no carry-forward" bug).
--
-- This function computes, from the SAME single source the ledger uses
-- (v_party_ledger_line), what every worker/vendor was owed (or held in advance)
-- strictly BEFORE p_cutover, so the cutover screen can propose each party's
-- opening balance for the owner to confirm. Existing 'opening' lines are excluded
-- (we are computing what the opening should be, not folding a prior one in).
--   net > 0  → we owe them        (direction 'work_owed')
--   net < 0  → advance with them  (direction 'paid_ahead')
-- security_invoker: the underlying view is invoker too, so a caller only ever
-- sees their own org's rows via the existing RLS.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.party_balances_before(p_cutover date)
RETURNS TABLE (
  stakeholder_id text,
  name           text,
  type           text,
  category       text,
  billed         numeric,
  paid           numeric,
  net            numeric   -- billed − paid; >0 = we owe them, <0 = advance with them
)
LANGUAGE sql
STABLE
SECURITY INVOKER
AS $$
  SELECT l.stakeholder_id,
         s.name, s.type, s.category,
         SUM(l.billed)::numeric        AS billed,
         SUM(l.paid)::numeric          AS paid,
         SUM(l.billed - l.paid)::numeric AS net
    FROM public.v_party_ledger_line l
    JOIN public.stakeholders s
      ON s.stakeholder_id = l.stakeholder_id
     AND s.type IN ('Vendor', 'Worker')
   WHERE l.line_date < p_cutover
     AND l.kind <> 'opening'
   GROUP BY l.stakeholder_id, s.name, s.type, s.category
  HAVING ABS(SUM(l.billed - l.paid)) >= 1;
$$;

GRANT EXECUTE ON FUNCTION public.party_balances_before(date) TO authenticated;
