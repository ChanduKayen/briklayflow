-- ===========================================================================
-- Block A — narration capture + the structured rows it produces.
--   site_narrations : every raw site message + its decomposed JSON (the audit
--                     trail; also the data that calibrates Block B's restraint).
--   problems        : tracked work problems (cause + owner + follow-up clock).
--   todos           : lightweight action items (no cause, no follow-up engine).
-- site_task_qc already carries the answer-slots Block A fills (answer text,
-- qc_status text CHECK pending|confirmed|failed) from 20260625000004 — nothing
-- to add there; this migration only adds the three new tables.
-- Modern org RLS (get_my_org_ids) on all three, mirroring site_tasks.
-- ===========================================================================

-- ── site_narrations — the capture row (created first; problems references it) ──
CREATE TABLE IF NOT EXISTS public.site_narrations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id               uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id           text REFERENCES public.projects(project_id) ON DELETE SET NULL,  -- null = parked/unresolved
  raw_text             text NOT NULL,
  decomposed           jsonb,                       -- Stage-1 output (null until decomposed)
  resolved_project_via text NOT NULL DEFAULT 'unresolved'
                         CHECK (resolved_project_via IN ('named','selected','auto','unresolved')),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_narrations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.site_narrations
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER site_narrations_touch BEFORE UPDATE ON public.site_narrations
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX site_narrations_org_idx     ON public.site_narrations(org_id, created_at);
CREATE INDEX site_narrations_project_idx ON public.site_narrations(project_id);

-- ── problems — tracked work problems (cause + owner + follow-up clock) ─────────
CREATE TABLE IF NOT EXISTS public.problems (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id          text REFERENCES public.projects(project_id) ON DELETE SET NULL,
  task_id             uuid REFERENCES public.site_tasks(task_id) ON DELETE SET NULL,   -- null = project-level
  source_narration_id uuid REFERENCES public.site_narrations(id) ON DELETE SET NULL,
  cause               text,                          -- taxonomy: material|labour|design|client|payment|...
  title               text NOT NULL,
  owner_id            uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status              text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','ADDRESSING','RESOLVED')),
  next_followup_at    timestamptz,
  status_history      jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.problems ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.problems
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER problems_touch BEFORE UPDATE ON public.problems
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX problems_org_idx       ON public.problems(org_id);
CREATE INDEX problems_project_idx   ON public.problems(project_id);
CREATE INDEX problems_followup_idx  ON public.problems(next_followup_at) WHERE status <> 'RESOLVED';

-- ── todos — lightweight action items (no cause, no follow-up engine) ───────────
CREATE TABLE IF NOT EXISTS public.todos (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id  text REFERENCES public.projects(project_id) ON DELETE SET NULL,
  task_id     uuid REFERENCES public.site_tasks(task_id) ON DELETE SET NULL,
  text        text NOT NULL,
  owner_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  due_date    date,
  status      text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','DONE')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.todos ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.todos
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER todos_touch BEFORE UPDATE ON public.todos
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX todos_org_idx     ON public.todos(org_id);
CREATE INDEX todos_project_idx ON public.todos(project_id);
