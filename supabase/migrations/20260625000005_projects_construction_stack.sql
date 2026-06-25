-- ===========================================================================
-- Block 0 write-path prep: projects seed → level/zone STACK.
-- Drop the floor-count model (floors_above + basement/stilt flags) — the stack replaces it.
-- The three capture inputs DEFAULT the stack; construction_stack (jsonb) stores the
-- RESOLVED full level/zone structure — exactly what the expander reads, and what a future
-- plan-upload overwrites with the same shape. Idempotent (IF EXISTS / IF NOT EXISTS).
-- ===========================================================================
ALTER TABLE public.projects
  DROP COLUMN IF EXISTS floors_above,
  DROP COLUMN IF EXISTS has_basement,
  DROP COLUMN IF EXISTS has_stilt,
  ADD COLUMN IF NOT EXISTS dedicated_parking  text    NOT NULL DEFAULT 'none', -- none|stilt|cellar (app-validated)
  ADD COLUMN IF NOT EXISTS habitable_floors   integer NOT NULL DEFAULT 1,      -- Ground + (n-1) uppers
  ADD COLUMN IF NOT EXISTS construction_stack jsonb;                           -- the resolved stack (see COMMENT)
-- kept from 20260625000003: project_type, units_per_floor, has_common_areas,
-- footing_type, builtup_area_sqft, sequence_model.

COMMENT ON COLUMN public.projects.construction_stack IS
  'Resolved level/zone stack the expander reads: {"levels":[{"label","kind":"parking|habitable","zones":[{"use":"parking|habitable|semi_residential","units"}]}]} (bottom→top). Defaulted from dedicated_parking/habitable_floors/units_per_floor at creation; a plan-upload overwrites this same shape.';
