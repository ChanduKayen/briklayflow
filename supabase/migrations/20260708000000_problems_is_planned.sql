-- ===========================================================================
-- #1 (live probe 2026-07-08) — PLANNED WORK as a snag. "ASM lo tap issues vachayi,
-- Monday kalla resolve avvali" ("tap issues in ASM, resolve by Monday") was DROPPED
-- as "didn't catch": the v2 two-axis contract only knows (a) update an existing item
-- and (b) report a NEW problem — it has no home for ASSIGNED / TO-DO work, so the
-- cautious model returned both-false.
--
-- Fix (owner's ruling): a to-do IS a snag, marked PLANNED. If it names a deadline the
-- date rides problems.deadline (already present, computed by computeTiming from the
-- user's L1 date); a high-confidence planned snag is chased near that date like any
-- issue. This column is the only new storage: a boolean flag so the snag list can
-- separate PLANNED work from reported defects.
--
-- Idempotent — safe to re-run in the SQL editor.
-- ROLLBACK:
--   DROP INDEX IF EXISTS problems_planned_open_idx;
--   ALTER TABLE public.problems DROP COLUMN IF EXISTS is_planned;
-- ===========================================================================

ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS is_planned boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.problems.is_planned IS
  'true = PLANNED/assigned work captured as a snag (a to-do), not a reported defect. The deadline (if any) rides problems.deadline; chased near it when confidence is high.';

-- The snag-list surface reads "open planned work" (a to-do view); a partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS problems_planned_open_idx
  ON public.problems (org_id, deadline)
  WHERE is_planned AND status <> 'RESOLVED';
