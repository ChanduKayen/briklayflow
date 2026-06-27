-- ===========================================================================
-- Phase 2.2 — issue follow-up timing. The three-layer engine (computeTiming)
-- writes next_followup_at (the chase clock, already on the table) AND a DEADLINE:
-- the real date the blocked work is due = min(user date L1, blocked-task date L3).
-- A target DAY, nullable (not always derivable), and correctable in the UI.
-- Idempotent — safe to re-run in the SQL editor.
-- ===========================================================================
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS deadline date;
