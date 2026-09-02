-- ===========================================================================
-- Phase 1A — the engagement's DECLARED accrual basis + the ledger cutover.
--
-- Until now the ledger INFERRED how a worker is owed (labour_crews.is_contract /
-- wo_id). Inference is fragile and can silently mis-accrue money. Each engagement
-- (a crew or a direct worker on a project) now carries an explicit, human-confirmed
-- basis that DECLARES the obligation channel:
--   'day'         — owe by days present × rate (attendance auto-accrues a wage)
--   'work'        — owe by work certified against a contract (a certification event)
--   'measurement' — a contract measured by the muster itself (the day IS the reading)
--   'piece'       — owe by discrete agreed lump jobs (gutha)
-- basis_confirmed=false means "assumed from the old inference — confirm me".
--
-- LEDGER CUTOVER: turning accrual on must not resurrect months of history as fresh
-- dues. organizations.ledger_start_date is the go-live boundary (the standard
-- opening-balance cutover): everything BEFORE it is treated as settled (capture any
-- genuine carried amount as a stakeholder_opening_balance); live accrual counts only
-- from the cutover forward. NULL = no cutover set yet (accrue all history).
-- ===========================================================================

-- ── engagement basis ────────────────────────────────────────────────────────
ALTER TABLE public.labour_crews
  ADD COLUMN IF NOT EXISTS accrual_basis  text
    CHECK (accrual_basis IN ('day','work','measurement','piece')),
  ADD COLUMN IF NOT EXISTS basis_confirmed boolean NOT NULL DEFAULT false;

ALTER TABLE public.labour_direct_workers
  ADD COLUMN IF NOT EXISTS accrual_basis  text
    CHECK (accrual_basis IN ('day','work','measurement','piece')),
  ADD COLUMN IF NOT EXISTS basis_confirmed boolean NOT NULL DEFAULT false;

-- Backfill the ASSUMED basis from today's inference (confirmed stays false → the UI
-- shows an "assumed — confirm" chip). A WO-linked / contract crew is work-basis; a
-- plain gang and every direct worker is day-wage.
UPDATE public.labour_crews
   SET accrual_basis = CASE WHEN is_contract OR wo_id IS NOT NULL THEN 'work' ELSE 'day' END
 WHERE accrual_basis IS NULL;

UPDATE public.labour_direct_workers
   SET accrual_basis = 'day'
 WHERE accrual_basis IS NULL;

-- ── ledger cutover (opening boundary) ───────────────────────────────────────
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS ledger_start_date date;

COMMENT ON COLUMN public.organizations.ledger_start_date IS
  'Ledger go-live / opening cutover. Wage & certified accrual counts only on/after this date; before it is settled (see stakeholder_opening_balances). NULL = not set (accrue all).';
