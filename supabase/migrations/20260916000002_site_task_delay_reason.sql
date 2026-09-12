-- ===========================================================================
-- A task's delay reason. Captured when the task's peek is closed while it is
-- running LATE (its live end has drifted past the approved baseline) — a short
-- reason ("waiting material", "rain", …) that answers the Gantt's "why delayed"
-- tooltip instead of "no reason on record yet". Free text; nullable.
-- ===========================================================================

ALTER TABLE public.site_tasks ADD COLUMN IF NOT EXISTS delay_reason text;

NOTIFY pgrst, 'reload schema';
