-- ===========================================================================
-- Task Manager — per-task proposed duration (in days). Combined with the
-- project's start_date and the seq_no order, this rolls up into a computed
-- schedule (each task starts when the previous ends). Editable per task.
-- Idempotent — safe to re-run in the SQL editor.
-- ===========================================================================
ALTER TABLE public.site_tasks
  ADD COLUMN IF NOT EXISTS duration_days integer NOT NULL DEFAULT 1
    CHECK (duration_days >= 1);
