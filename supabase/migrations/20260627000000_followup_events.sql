-- ===========================================================================
-- Block B1 — THE FOLLOW-UP TRAIL.
-- A chronological event log per ISSUE (problems) and per TODO (todos). This is
-- the item's COMPLETE STORY — system events (chases, status flips, escalations)
-- and human events (comments, noted blockers) interleaved in time. It is the
-- audit log, the human-readable history shown when an item is expanded, AND the
-- substrate the chase scheduler (B2) and reply matcher (B3) write to and the
-- QC-gap calibration (B2-deferred) later reads.
--
-- It REALIZES the "follow-up thread structure" Stage 2 carried empty inside
-- problems.status_history (a JSONB array) — promoting it to a first-class table
-- so todos get a trail too (todos had no history column) and so chases/replies
-- have a durable place to write. The legacy status_history is backfilled below
-- and then superseded; reads switch to this table.
--
-- Mirrors the modern org RLS (get_my_org_ids) used by problems / todos /
-- site_task_comments. Idempotent — safe to re-run in the SQL editor.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.followup_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  -- exactly ONE parent — an event belongs to an issue XOR a todo (enforced below)
  problem_id  uuid REFERENCES public.problems(id) ON DELETE CASCADE,
  todo_id     uuid REFERENCES public.todos(id)    ON DELETE CASCADE,
  type        text NOT NULL CHECK (type IN (
                'chase_sent',      -- B2: a follow-up went out to the owner
                'reply_received',  -- B3: the owner answered a chase
                'status_changed',  -- open → addressing → resolved, re-timings, assignee/cause edits
                'escalated',       -- B3: bounded chases exhausted → pushed up
                'blocker_noted',   -- a reply/comment naming a blocker; item stays open, re-times
                'comment'          -- a human note typed into the trail
              )),
  body        text,                                 -- the event's human-readable line
  actor_kind  text NOT NULL DEFAULT 'system' CHECK (actor_kind IN ('system','user')),
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,   -- who, when actor_kind = 'user'
  created_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT followup_events_one_parent CHECK (
    (problem_id IS NOT NULL)::int + (todo_id IS NOT NULL)::int = 1
  )
);

ALTER TABLE public.followup_events ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org member access" ON public.followup_events;
CREATE POLICY "org member access" ON public.followup_events
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

-- read paths: a single item's trail in chronological order (issues, todos)
CREATE INDEX IF NOT EXISTS followup_events_problem_idx ON public.followup_events(problem_id, created_at);
CREATE INDEX IF NOT EXISTS followup_events_todo_idx    ON public.followup_events(todo_id, created_at);
-- scheduler/calibration scans by org
CREATE INDEX IF NOT EXISTS followup_events_org_idx     ON public.followup_events(org_id, created_at);

-- ── Backfill: lift the legacy problems.status_history JSONB into the trail so
--    no recorded history is lost. Runs ONCE (skipped if the table already holds
--    events), so re-running the migration in the SQL editor is harmless. The
--    synthetic "Issue opened" genesis line was never stored (the UI prepends it
--    from created_at), so it is intentionally not backfilled here.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.followup_events) THEN
    INSERT INTO public.followup_events (org_id, problem_id, type, body, actor_kind, actor_id, created_at)
    SELECT
      p.org_id,
      p.id,
      CASE e->>'type'
        WHEN 'chase'      THEN 'chase_sent'
        WHEN 'reply'      THEN 'reply_received'
        WHEN 'escalation' THEN 'escalated'
        ELSE                   'status_changed'
      END,
      COALESCE(e->>'event', e->>'detail'),
      CASE WHEN u.id IS NOT NULL THEN 'user' ELSE 'system' END,
      u.id,
      COALESCE(NULLIF(e->>'at','')::timestamptz, p.created_at)
    FROM public.problems p
    CROSS JOIN LATERAL jsonb_array_elements(COALESCE(p.status_history, '[]'::jsonb)) AS e
    LEFT JOIN auth.users u
      ON u.id = (CASE WHEN e->>'by' ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
                      THEN (e->>'by')::uuid END)
    WHERE jsonb_typeof(p.status_history) = 'array'
      AND jsonb_array_length(p.status_history) > 0;
  END IF;
END $$;

-- ── Live trail: an expanded issue/todo updates without a manual reload when a
--    chase (B2) or reply (B3) appends an event. Mirrors the problems/todos
--    publication (20260626000005); clients also refetch on their own writes.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'followup_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.followup_events;
  END IF;
END $$;
