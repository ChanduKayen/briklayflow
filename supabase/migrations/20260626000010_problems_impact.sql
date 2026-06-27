-- ===========================================================================
-- Phase 2.3 — LLM impact scoping (blast radius). The gated, grounded "may delay …"
-- suggestion is stored on the issue as `impact` jsonb:
--   { threatened: [{ task_id, name, due, reason }], implication: "may delay 2F slab (Fri)" }
-- A SUGGESTION (correctable/dismissable in the UI), null when not scoped (far work,
-- project-level issue, weather/auspicious, or nothing neighboring is blocked).
-- Idempotent — safe to re-run in the SQL editor.
-- ===========================================================================
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS impact jsonb;
