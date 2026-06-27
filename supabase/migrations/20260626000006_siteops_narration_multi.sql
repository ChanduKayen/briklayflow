-- ===========================================================================
-- Multi-project narration — one WhatsApp message can now name several sites and
-- file each item against its OWN project (mirrors the transaction agent's
-- per-item project handling). When that happens the audit row spans no single
-- project (project_id stays null) and records resolved_project_via = 'multi'.
-- Widen the CHECK so the agent can stamp that honestly.
-- ===========================================================================

ALTER TABLE public.site_narrations
  DROP CONSTRAINT IF EXISTS site_narrations_resolved_project_via_check;

ALTER TABLE public.site_narrations
  ADD CONSTRAINT site_narrations_resolved_project_via_check
  CHECK (resolved_project_via IN ('named','selected','auto','unresolved','multi'));
