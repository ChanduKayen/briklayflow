-- ===========================================================================
-- Block 0 REBUILD — step B: project construction meta folded into projects.
-- Captured ONCE in the create-project flow; editable later → re-expand. These are
-- the expander's input (the "seed"). project_type / sequence_model are plain text,
-- app-validated (no DB enum — same philosophy as the rest of site-ops).
-- All ADD COLUMN IF NOT EXISTS → idempotent; existing projects get the defaults.
-- ===========================================================================
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_type      text,                                   -- villa|apartment|commercial|industrial|renovation (app-validated)
  ADD COLUMN IF NOT EXISTS floors_above      integer,                                -- above ground (ground counted by the expander)
  ADD COLUMN IF NOT EXISTS has_basement      boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_stilt         boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS units_per_floor   integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS has_common_areas  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS footing_type      text,                                   -- free text; informational only (no branch logic)
  ADD COLUMN IF NOT EXISTS builtup_area_sqft numeric,                                -- nullable
  ADD COLUMN IF NOT EXISTS sequence_model    text NOT NULL DEFAULT 'rcc_residential';-- which sequence file/model the expander reads
