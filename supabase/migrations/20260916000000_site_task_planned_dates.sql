-- ===========================================================================
-- Manual planned dates on a task.
--
-- site_tasks already has duration_days (+ started_at for the actual start), from
-- which the desk COMPUTES a rolling schedule. But a supervisor wants to set a
-- task's own start and end by hand on the plan list, and have the next task's
-- start default to this one's end (still editable). planned_start / planned_end
-- hold those hand-set dates; the desk prefers them over the computed pair when
-- present, and the row date editors write them.
--
-- Both nullable: a task with neither keeps showing the computed start→end.
-- ===========================================================================

ALTER TABLE public.site_tasks ADD COLUMN IF NOT EXISTS planned_start date;
ALTER TABLE public.site_tasks ADD COLUMN IF NOT EXISTS planned_end   date;

NOTIFY pgrst, 'reload schema';
