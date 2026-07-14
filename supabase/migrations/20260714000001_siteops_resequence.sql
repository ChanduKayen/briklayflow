-- ===========================================================================
-- SITE DESK — RESEQUENCE A PROJECT'S TASKS IN ONE STATEMENT.
--
-- Reordering by hand (a drag, a Move, or inserting a task into the middle of the run) renumbers
-- seq_no across the project. The client was doing that a row at a time: one UPDATE per changed row,
-- awaited in a loop. Drag a task to the top of a 1,500-task plan and that is 1,500 sequential
-- round-trips — slow enough to watch, and worse, NOT ATOMIC: a network blip halfway leaves the plan
-- half-renumbered, with two tasks claiming the same slot and the order silently wrong.
--
-- One statement instead. The client sends the task_ids in the order it wants them, and the array's
-- ordinality IS the new seq_no.
--
--   order_source = 'manual' on every row it touches — this is a human's sequence now, and
--   reconcile() must never re-default it back to the engine's (persist.ts). That flag is the whole
--   reason a drag survives the next page load.
--
-- SECURITY: not SECURITY DEFINER. It runs as the caller, so RLS on site_tasks ("org member access")
-- is what decides which rows may move — a member cannot resequence a project outside their org, and
-- we have not had to re-implement that check here. The org_id argument is belt AND braces: even a
-- caller who somehow held a foreign task_id could not smuggle it into another project's ordering.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.siteops_resequence(
  p_project_id text,
  p_task_ids   uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_n integer;
BEGIN
  UPDATE public.site_tasks t
     SET seq_no       = o.ord,
         order_source = 'manual'
    FROM unnest(p_task_ids) WITH ORDINALITY AS o(task_id, ord)
   WHERE t.task_id    = o.task_id
     AND t.project_id = p_project_id
     -- only write the rows that actually MOVED. A no-op UPDATE still fires the touch trigger and
     -- bumps updated_at, which would make every untouched task look freshly edited on the desk.
     AND t.seq_no IS DISTINCT FROM o.ord;

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

REVOKE ALL ON FUNCTION public.siteops_resequence(text, uuid[]) FROM public;
GRANT EXECUTE ON FUNCTION public.siteops_resequence(text, uuid[]) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- DOWN:  DROP FUNCTION IF EXISTS public.siteops_resequence(text, uuid[]);
-- ---------------------------------------------------------------------------
