-- SITE DESK — FROZEN BASELINE for the Work Plan Gantt.
--
-- The redesigned Work Plan draws a dashed "promised plan" ghost behind every draggable green bar. That
-- ghost must NOT move when the supervisor re-schedules the work — it is the plan he committed to, frozen
-- the first time he touched the schedule. planned_start / planned_end (20260916000000) hold the LIVE,
-- editable window; these two hold the ONE-TIME snapshot taken the first time a task's planned dates are
-- persisted (see live.ts · setTaskDates "freeze-once"). Null until that first commit — the UI then falls
-- back to the auto-computed schedule for the ghost, so a plan that has never been dragged still shows one.
--
-- IF NOT EXISTS: the portal applies migrations by hand, and the desk soft-degrades if these columns are
-- absent (setTaskDates drops the baseline_* keys and still persists planned_*), so a partial apply never
-- blanks the plan.
ALTER TABLE public.site_tasks
  ADD COLUMN IF NOT EXISTS baseline_start date,
  ADD COLUMN IF NOT EXISTS baseline_end   date;

-- Reload PostgREST's schema cache so the new columns are selectable immediately.
NOTIFY pgrst, 'reload schema';
