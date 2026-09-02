-- ===========================================================================
-- Per-org cutover switch for the Allocation Ledger.
--
-- The party ledger reads the OLD netting model until an org's operator chooses to move to the new
-- allocation engine. This flag is that choice — default OFF, so every existing org is untouched.
-- Flipping it (after the org's backfill) makes the party ledger read from ledger_credits /
-- ledger_allocations instead. One org's decision never affects another.
-- ===========================================================================

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS new_ledger_enabled boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS ledger_cutover_at  date;   -- the line: entries before it are historical
