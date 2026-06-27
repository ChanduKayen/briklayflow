-- ===========================================================================
-- Surfacing UI block — ownership model + QC provenance.
--   projects.supervisor_id : the project's supervisor (an app user). Owner
--                            resolution prefers them over the principal.
--   site_tasks.owner_id / owner_source : per-task owner + whether it was set
--   problems.owner_source                by the engine ('auto') or a human
--                            ('manual'). owner_source='manual' is NEVER
--                            overwritten by re-defaulting (block-0 manual-task
--                            preservation discipline, applied to ownership).
--   site_task_qc.source_narration_id / answered_at : provenance for an answered
--                            QC ("✓ … — from narration, 2h ago").
-- All idempotent; safe to re-run in the SQL editor.
-- ===========================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS supervisor_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.site_tasks
  ADD COLUMN IF NOT EXISTS owner_id     uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS owner_source text NOT NULL DEFAULT 'auto' CHECK (owner_source IN ('auto','manual'));

ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS owner_source text NOT NULL DEFAULT 'auto' CHECK (owner_source IN ('auto','manual'));

ALTER TABLE public.site_task_qc
  ADD COLUMN IF NOT EXISTS source_narration_id uuid REFERENCES public.site_narrations(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS answered_at         timestamptz;
