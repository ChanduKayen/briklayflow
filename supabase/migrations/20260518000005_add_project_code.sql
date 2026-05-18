-- Block 1: Add project_code to projects table

-- 1a. Add nullable column
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS project_code text;

-- 1b. Backfill from name (strips common stop words, takes first 4 alpha chars, uppercase)
UPDATE public.projects
SET project_code = upper(
  substring(
    regexp_replace(
      regexp_replace(
        name,
        '\y(villa|flat|building|project|new|phase|the|and|of|for|at|in|a|an|dr|mr|mrs)\y',
        '', 'gi'
      ),
      '[^a-zA-Z]', '', 'g'
    ),
    1, 4
  )
)
WHERE project_code IS NULL
  AND name IS NOT NULL;

-- 1b-fallback: still blank after stop-word stripping → use all alpha chars from name
UPDATE public.projects
SET project_code = upper(substring(regexp_replace(name, '[^a-zA-Z]', '', 'g'), 1, 4))
WHERE (project_code IS NULL OR project_code = '')
  AND name IS NOT NULL;

-- 1b-last-resort: blank name → derive from project_id slug
UPDATE public.projects
SET project_code = upper(substring(
  regexp_replace(regexp_replace(project_id, '^PRJ-', ''), '[^A-Z0-9]', '', 'g'),
  1, 4))
WHERE (project_code IS NULL OR project_code = '');

-- ─── STOP AND VERIFY BEFORE 1f ────────────────────────────────────────────
-- Run these in the Supabase SQL editor and review results:
--
--   SELECT project_id, name, project_code
--   FROM public.projects
--   ORDER BY created_at;
--
--   SELECT org_id, project_code, count(*), array_agg(name) AS projects
--   FROM public.projects
--   GROUP BY org_id, project_code
--   HAVING count(*) > 1;
--   -- Zero rows → safe to run 1f.
--   -- Any rows  → fix duplicates manually, then run 1f.
--
-- ─── 1f. Tighten constraints (run only after verify is clean) ─────────────
ALTER TABLE public.projects
  ALTER COLUMN project_code SET NOT NULL;

ALTER TABLE public.projects
  ADD CONSTRAINT uq_project_code_per_org
  UNIQUE (org_id, project_code);

ALTER TABLE public.projects
  ADD CONSTRAINT chk_project_code_format
  CHECK (project_code ~ '^[A-Z0-9]{2,6}$');
