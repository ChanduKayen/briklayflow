-- ===========================================================================
-- Live Issues & To-dos. The project Issues view subscribes to problems + todos
-- so a WhatsApp narration that creates a problem/to-do shows up LIVE (INSERT),
-- and status/owner edits land without a manual reload (UPDATE) — mirroring the
-- site_tasks publication added in 20260626000000. The client also has a poll
-- fallback, so the page still works if this publication change isn't applied.
-- Idempotent — safe to re-run in the SQL editor.
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'problems'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.problems;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'todos'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.todos;
  END IF;
END $$;
