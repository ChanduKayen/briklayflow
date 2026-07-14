-- SITE DESK — the remaining columns the UI needs, and the resolution record.
-- Additive only: new columns, one new table. Nothing renamed, nothing repurposed.

-- ── 1. WHERE a problem is ────────────────────────────────────────────────────────────────────
-- The capture pipeline ALREADY computes a structure slot (floor/unit) for every item — the
-- vision pass and decompose both emit one, and the task pin consumes it. It was simply never
-- persisted on the row. Without it a snag cannot say "1st floor · bedroom 2", and a unit chip
-- cannot count the problems logged against that flat (there is nothing to count them BY).
-- `area` is the room/zone within the unit ("master bath"), which the slot also carries.
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS floor_label text;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS unit_label  text;
ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS area_label  text;

CREATE INDEX IF NOT EXISTS problems_place_idx
  ON public.problems(project_id, floor_label, unit_label)
  WHERE status NOT IN ('RESOLVED', 'DISMISSED');

-- ── 2. The task↔problem link — DELIBERATELY NO NEW COLUMN ────────────────────────────────────
-- "Blocked by {DSR-19}" is the most load-bearing line in the Work Plan, and the first draft of
-- this migration added `site_tasks.blocked_by_problem_id` for it. That column was WRONG, and is
-- gone: the link already exists.
--
-- `problems.task_id` IS the blocked task. The pipeline says so itself — createProblem calls
-- computeBlockedTaskEnd(supabase, taskId) and the timing engine tempers the chase clock against
-- "the blocked task's schedule" (_siteops_route.ts). `problems.impact` records the further tasks
-- it threatens. So a task is blocked by exactly the OPEN issues whose task_id points at it.
--
-- Deriving it (rather than storing a second, redundant edge) means:
--   · no new write path — nothing can forget to set it, and nothing can set it wrongly;
--   · no stale flag — the block EVAPORATES the moment the problem closes, because there was
--     never anything to clean up;
--   · one source of truth. Two edges that mean the same thing will disagree eventually.
-- The index below is what makes that derivation cheap.
CREATE INDEX IF NOT EXISTS problems_blocking_task_idx
  ON public.problems(task_id)
  WHERE task_id IS NOT NULL AND status NOT IN ('RESOLVED', 'DISMISSED');

-- ── 3. "day 3 of 4" ──────────────────────────────────────────────────────────────────────────
-- site_tasks has duration_days but no anchor to count from, so the Y existed and the X did not.
-- Stamped when a task goes active; cleared when it goes back to not-started.
ALTER TABLE public.site_tasks ADD COLUMN IF NOT EXISTS started_at timestamptz;

-- ── 4. THE RESOLUTION RECORD ─────────────────────────────────────────────────────────────────
-- Closing an item is a FACT, with a reason and an author, and it outlives the close: a reopen
-- keeps the record (that is the whole audit floor). Today closure is only a status transition —
-- the reason he closed it, and who closed it, are simply not stored anywhere.
--
-- History, not state: one row per close. A reopened item keeps its old row and gets a new one if
-- it is closed again. The current resolution is the newest row with reopened_at IS NULL.
CREATE TABLE IF NOT EXISTS public.problem_resolutions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  problem_id   uuid NOT NULL REFERENCES public.problems(id) ON DELETE CASCADE,

  -- The four closing reasons, in the founder's words. Stored as keys; the UI owns the wording.
  outcome      text NOT NULL CHECK (outcome IN ('fixed', 'client_ok', 'not_a_problem', 'duplicate')),
  note         text,
  duplicate_of text,                       -- the ref it duplicates, when outcome = 'duplicate'

  -- WHO closed it. NULL = Babai closed it himself off the confidence ladder (an auto-close),
  -- which is exactly the distinction the UI draws ("Closed by you" vs "Babai — auto-closed").
  closed_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  auto_closed  boolean NOT NULL DEFAULT false,
  closed_at    timestamptz NOT NULL DEFAULT now(),

  -- Set on reopen. The row STAYS. Never delete a resolution.
  reopened_at  timestamptz,
  reopened_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS problem_resolutions_problem_idx ON public.problem_resolutions(problem_id, closed_at DESC);

ALTER TABLE public.problem_resolutions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.problem_resolutions
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

-- ROLLBACK:
--   DROP TABLE IF EXISTS public.problem_resolutions;
--   DROP INDEX IF EXISTS public.problems_blocking_task_idx;
--   ALTER TABLE public.site_tasks DROP COLUMN IF EXISTS started_at;
--   ALTER TABLE public.problems   DROP COLUMN IF EXISTS area_label;
--   ALTER TABLE public.problems   DROP COLUMN IF EXISTS unit_label;
--   ALTER TABLE public.problems   DROP COLUMN IF EXISTS floor_label;
