-- ===========================================================================
-- Task Manager — per-task comment diary. An append-only log of notes against a
-- site task (as many as you like), shown when a task is expanded. Mirrors the
-- modern org RLS (get_my_org_ids) used by site_tasks / site_task_qc.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.site_task_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES public.site_tasks(task_id)    ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations(org_id)  ON DELETE CASCADE,
  author_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- who wrote it (null for system)
  author_name text,                                               -- denormalized for display
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_task_comments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.site_task_comments
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE INDEX site_task_comments_task_idx ON public.site_task_comments(task_id, created_at);
