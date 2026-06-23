-- Backfill project_code for projects missing it
-- ──────────────────────────────────────────────
-- WO/PO id generation (generate_document_id) REQUIRES projects.project_code and raises
-- "missing project code" without it. Projects created via the OnboardingWizard never set
-- it (the New Project wizard does), so any onboarding-created project is stuck — no WO,
-- PO, or document id can be minted for it. This re-runs the derivation from
-- 20260518000005_add_project_code.sql for every still-blank row.
--
-- Same logic as the app: strip common words → first 4 alpha chars → uppercase; fall back
-- to all alpha chars from the name; last resort the project_id slug; final 'PROJ'.

UPDATE public.projects
SET project_code = COALESCE(
  -- 1) stop-words stripped, first 4 alpha chars
  NULLIF(upper(substring(
    regexp_replace(
      regexp_replace(name, '\y(villa|flat|building|project|new|phase|the|and|of|for|at|in|a|an|dr|mr|mrs)\y', '', 'gi'),
      '[^a-zA-Z]', '', 'g'),
    1, 4)), ''),
  -- 2) all alpha chars from the name
  NULLIF(upper(substring(regexp_replace(coalesce(name, ''), '[^a-zA-Z]', '', 'g'), 1, 4)), ''),
  -- 3) from the project_id slug (strip a leading PRJ-, keep A-Z0-9)
  NULLIF(upper(substring(regexp_replace(regexp_replace(project_id::text, '^PRJ-', ''), '[^A-Z0-9]', '', 'g'), 1, 4)), ''),
  -- 4) last resort
  'PROJ')
WHERE project_code IS NULL OR project_code = '';

-- ─── OPTIONAL: make this impossible to recur (run after verifying) ────────────
-- Step 1f of the original migration was gated behind manual verification and is still
-- not applied in production, which is why NULLs slip through silently instead of failing
-- at insert. After confirming the two checks below return clean, apply the constraints.
--
--   -- a) no remaining blanks:
--   SELECT project_id, name, project_code FROM public.projects
--   WHERE project_code IS NULL OR project_code !~ '^[A-Z0-9]{2,6}$';
--
--   -- b) no duplicate codes within an org (the UNIQUE constraint needs this):
--   SELECT org_id, project_code, count(*), array_agg(name)
--   FROM public.projects GROUP BY org_id, project_code HAVING count(*) > 1;
--
-- Then, only if both are clean:
--   ALTER TABLE public.projects ALTER COLUMN project_code SET NOT NULL;
--   ALTER TABLE public.projects ADD CONSTRAINT uq_project_code_per_org UNIQUE (org_id, project_code);
--   ALTER TABLE public.projects ADD CONSTRAINT chk_project_code_format CHECK (project_code ~ '^[A-Z0-9]{2,6}$');
