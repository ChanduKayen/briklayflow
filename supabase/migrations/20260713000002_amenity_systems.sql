-- AMENITY SYSTEMS — an amenity is a SYSTEM, not a task.
--
-- Until now every one of the 14 ca_* amenities was a single `building` task-type with one edge
-- ("after foundation"): no place, no per-floor work, no commissioning. So there was no row for
-- "lift landing door, 3rd floor" — nobody could report it, and the lift showed no progress until
-- someone flipped the whole thing done. The engine now expands each system into its real
-- components (sited plant / per-floor parts / one commissioning step); this migration adds the two
-- columns those components need.
--
-- Both are ADDITIVE and defaulted, so an un-migrated project keeps working: the engine falls back to
-- each type's `sitedDefault` when amenity_levels is absent, and site_tasks.system is simply null on
-- rows that predate this.

-- 1. WHERE the plant stands. { "ca_generator": "Stilt", "ca_oht": "Second" } — system id → floor label.
--    Absent, or naming a level that doesn't exist, falls back to the type's default (lowest / top),
--    so a bad value can never DROP a task, only mis-place it.
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS amenity_levels jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.projects.amenity_levels IS
  'Amenity system id → the floor label its `sited` plant stands on (the DG on the stilt, the OHT on the roof). Falls back to the task type''s sitedDefault when a system is absent.';

-- 2. WHICH system a task row belongs to. Lets the task list and the amenities view group the SAME rows
--    two ways — by floor, and by system — without a second task tree that could drift out of sync.
ALTER TABLE public.site_tasks
  ADD COLUMN IF NOT EXISTS system text;

COMMENT ON COLUMN public.site_tasks.system IS
  'The amenity system this task is a component of (ca_lift, ca_fire, …). NULL for core building work. Populated by the engine (persist.toPersistRows); the grouping key for the amenities view.';

CREATE INDEX IF NOT EXISTS site_tasks_project_system_idx
  ON public.site_tasks (project_id, system)
  WHERE system IS NOT NULL;

-- 3. THE TRADE PASS, split out of the name.
--    An electrician crosses the same wall three times. That pass used to be glued into the label
--    ("Electrical — wire pulling (2nd fix)"), so the task list read as a column of parentheticals.
--    It is a PROPERTY of the task, not part of its name: the list renders it as a chip, and the
--    WhatsApp resolver re-attaches it (qualifiedName) because "second fix is done" must still land on
--    wire-pulling rather than conduiting.
--
--    NOT to be confused with site_tasks.phase, which holds the LAYER (structure/services/finishes).
ALTER TABLE public.site_tasks
  ADD COLUMN IF NOT EXISTS trade_phase text;

COMMENT ON COLUMN public.site_tasks.trade_phase IS
  'The trade pass: 1st fix / 2nd fix / final fix. Split out of `name` so the UI can chip it. NULL for work that has no pass. Distinct from `phase`, which holds the layer.';

-- Rollback:
--   ALTER TABLE public.site_tasks DROP COLUMN IF EXISTS trade_phase;
--   DROP INDEX IF EXISTS public.site_tasks_project_system_idx;
--   ALTER TABLE public.site_tasks DROP COLUMN IF EXISTS system;
--   ALTER TABLE public.projects  DROP COLUMN IF EXISTS amenity_levels;
