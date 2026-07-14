-- SITE DESK — PER-SITE REFERENCE NUMBERS (DSR-21).
--
-- THE CONTRACT: refs are forever. A number, once given, is never reassigned and never
-- renumbered. Everything below is built around that one rule.
--
-- ONE NUMBER SPACE PER SITE, SHARED BY PROBLEMS AND TASKS. The founder's prototype settles
-- this: DSR-21 is an issue and DSR-30 is a task, and no number is ever used twice at that site.
-- That is what lets a ref stand alone — in a WhatsApp message, in a "Blocked by {DSR-19}" line,
-- in a unit badge — and resolve to exactly one row without anyone saying which KIND it is.
--
-- WHY A COUNTER TABLE AND NOT A SEQUENCE: a Postgres sequence is global and gap-prone on
-- rollback; we need one counter PER PROJECT, and we need it to survive a deleted row without
-- ever handing the same number out twice. `UPDATE … RETURNING` is a single atomic statement, so
-- two concurrent inserts cannot collide — no advisory lock, no SELECT … FOR UPDATE, no retry loop.
--
-- WHY A TRIGGER AND NOT APPLICATION CODE: the WhatsApp pipeline creates problems from six
-- different call sites (createProblem, applyTerminals, the QC-failure path, the chase reply
-- path…). A ref assigned in a BEFORE INSERT trigger means every one of those keeps working with
-- ZERO edge-function changes, and no future call site can ever forget to ask for a number.
--
-- Additive only. Nothing is renamed, dropped or repurposed.

-- ── 1. The per-site counter ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.site_ref_counters (
  project_id text PRIMARY KEY REFERENCES public.projects(project_id) ON DELETE CASCADE,
  org_id     uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  next_val   bigint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_ref_counters ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.site_ref_counters
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

-- ── 2. The allocator ─────────────────────────────────────────────────────────────────────────
-- SECURITY DEFINER: the trigger must be able to bump the counter even when the caller is the
-- service role acting on behalf of a member, or a member whose RLS would not otherwise let them
-- write the counter row for a project they can only read.
CREATE OR REPLACE FUNCTION public.next_site_ref(p_project_id text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_code text;
  v_org  uuid;
  v_n    bigint;
BEGIN
  SELECT project_code, org_id INTO v_code, v_org
  FROM public.projects WHERE project_id = p_project_id;

  -- A project with no short code cannot have refs. Fail loudly: a silent NULL ref would be a
  -- row the whole Site Desk cannot address, and we would not find out until a supervisor did.
  IF v_code IS NULL OR v_code = '' THEN
    RAISE EXCEPTION 'project % has no project_code — cannot mint a site ref', p_project_id;
  END IF;

  -- ONE atomic statement. The INSERT path hands out 1 (and parks next_val at 2); the conflict
  -- path bumps and hands out the previous value. Two concurrent callers serialise on the row.
  INSERT INTO public.site_ref_counters AS c (project_id, org_id, next_val)
  VALUES (p_project_id, v_org, 2)
  ON CONFLICT (project_id) DO UPDATE SET next_val = c.next_val + 1
  RETURNING c.next_val - 1 INTO v_n;

  RETURN v_code || '-' || v_n::text;
END;
$$;

REVOKE ALL ON FUNCTION public.next_site_ref(text) FROM public;
GRANT EXECUTE ON FUNCTION public.next_site_ref(text) TO authenticated, service_role;

-- ── 3. The columns ───────────────────────────────────────────────────────────────────────────
ALTER TABLE public.problems   ADD COLUMN IF NOT EXISTS ref text;
ALTER TABLE public.site_tasks ADD COLUMN IF NOT EXISTS ref text;

-- ── 4. BACKFILL — one pass, in creation order, across BOTH tables ────────────────────────────
-- Ordered by created_at so the oldest item at a site gets the lowest number: the numbering then
-- reads like the site's own history. Idempotent: only rows with a NULL ref are touched, so
-- running this twice changes nothing and can never renumber anything.
WITH ordered AS (
  SELECT p.project_id, p.id::text AS pk, 'problem' AS kind, p.created_at
  FROM public.problems p
  WHERE p.ref IS NULL AND p.project_id IS NOT NULL
  UNION ALL
  SELECT t.project_id, t.task_id::text, 'task', t.created_at
  FROM public.site_tasks t
  WHERE t.ref IS NULL
),
numbered AS (
  SELECT o.*,
         pr.project_code,
         row_number() OVER (PARTITION BY o.project_id ORDER BY o.created_at, o.pk) AS n
  FROM ordered o
  JOIN public.projects pr ON pr.project_id = o.project_id
  WHERE pr.project_code IS NOT NULL AND pr.project_code <> ''
)
UPDATE public.problems p
SET ref = n.project_code || '-' || n.n::text
FROM numbered n
WHERE n.kind = 'problem' AND p.id::text = n.pk AND p.ref IS NULL;

WITH ordered AS (
  SELECT p.project_id, p.id::text AS pk, 'problem' AS kind, p.created_at
  FROM public.problems p
  WHERE p.project_id IS NOT NULL
  UNION ALL
  SELECT t.project_id, t.task_id::text, 'task', t.created_at
  FROM public.site_tasks t
),
numbered AS (
  SELECT o.*,
         pr.project_code,
         row_number() OVER (PARTITION BY o.project_id ORDER BY o.created_at, o.pk) AS n
  FROM ordered o
  JOIN public.projects pr ON pr.project_id = o.project_id
  WHERE pr.project_code IS NOT NULL AND pr.project_code <> ''
)
UPDATE public.site_tasks t
SET ref = n.project_code || '-' || n.n::text
FROM numbered n
WHERE n.kind = 'task' AND t.task_id::text = n.pk AND t.ref IS NULL;

-- Park each counter ABOVE everything just handed out, so the next mint can never collide with
-- a backfilled number. (The regexp pulls the trailing integer out of 'DSR-21'.)
INSERT INTO public.site_ref_counters (project_id, org_id, next_val)
SELECT x.project_id, x.org_id, MAX(x.n) + 1
FROM (
  SELECT p.project_id, p.org_id, (regexp_match(p.ref, '(\d+)$'))[1]::bigint AS n
  FROM public.problems p WHERE p.ref IS NOT NULL AND p.project_id IS NOT NULL
  UNION ALL
  SELECT t.project_id, t.org_id, (regexp_match(t.ref, '(\d+)$'))[1]::bigint
  FROM public.site_tasks t WHERE t.ref IS NOT NULL
) x
GROUP BY x.project_id, x.org_id
ON CONFLICT (project_id) DO UPDATE
  SET next_val = GREATEST(site_ref_counters.next_val, EXCLUDED.next_val);

-- ── 5. Uniqueness — the guarantee, enforced by the database ──────────────────────────────────
-- Per project, a ref is unique WITHIN each table; the shared counter is what makes it unique
-- ACROSS them. (A cross-table exclusion constraint is not expressible without a third table; the
-- allocator is the single source of numbers, and nothing else may write `ref`.)
CREATE UNIQUE INDEX IF NOT EXISTS problems_project_ref_uidx   ON public.problems(project_id, ref)   WHERE ref IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS site_tasks_project_ref_uidx ON public.site_tasks(project_id, ref) WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS problems_ref_idx   ON public.problems(ref)   WHERE ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS site_tasks_ref_idx ON public.site_tasks(ref) WHERE ref IS NOT NULL;

-- ── 6. Every future row gets a ref, from wherever it is created ──────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_assign_site_ref()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.ref IS NULL AND NEW.project_id IS NOT NULL THEN
    NEW.ref := public.next_site_ref(NEW.project_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS problems_assign_ref ON public.problems;
CREATE TRIGGER problems_assign_ref
  BEFORE INSERT ON public.problems
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_site_ref();

DROP TRIGGER IF EXISTS site_tasks_assign_ref ON public.site_tasks;
CREATE TRIGGER site_tasks_assign_ref
  BEFORE INSERT ON public.site_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_site_ref();

-- NOTE: a problem captured from WhatsApp before its project is known (project_id NULL — it parks
-- in siteops_unplaced) gets its ref when it is PLACED, not before. That is correct: an item with
-- no site cannot have a site's number.

-- ROLLBACK (before anyone has seen a ref; NEVER after):
--   DROP TRIGGER IF EXISTS problems_assign_ref   ON public.problems;
--   DROP TRIGGER IF EXISTS site_tasks_assign_ref ON public.site_tasks;
--   DROP FUNCTION IF EXISTS public.tg_assign_site_ref();
--   DROP FUNCTION IF EXISTS public.next_site_ref(text);
--   ALTER TABLE public.problems   DROP COLUMN IF EXISTS ref;
--   ALTER TABLE public.site_tasks DROP COLUMN IF EXISTS ref;
--   DROP TABLE IF EXISTS public.site_ref_counters;
