-- Per-project "not applicable here" list: engine task-type ids the builder has hidden from this
-- project (× on a task in the timeline). The engine skips them when instantiating, so dependents
-- reflow; fully restorable (remove from the list). Empty = nothing suppressed.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS suppressed_tasks text[] NOT NULL DEFAULT '{}';
