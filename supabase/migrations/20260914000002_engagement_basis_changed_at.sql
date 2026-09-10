-- ===========================================================================
-- "Put on contract" cutover date.
--
-- When a daily-wage crew/worker is put on a contract, the switch is now a dated
-- CUTOVER, not a retroactive rewrite. basis_changed_at records the day the
-- engagement became contract-based. Past daily wages are handled at conversion
-- (the "keep as wages" choice snapshots them as a fixed certified credit via
-- party_adjustments; "fold" discards them) — so flipping accrual_basis no longer
-- silently erases a crew's whole wage history. This column is provenance today
-- and the hook for a future per-day view-cutover if we ever want per-day detail.
-- ===========================================================================

ALTER TABLE public.labour_crews          ADD COLUMN IF NOT EXISTS basis_changed_at date;
ALTER TABLE public.labour_direct_workers ADD COLUMN IF NOT EXISTS basis_changed_at date;
