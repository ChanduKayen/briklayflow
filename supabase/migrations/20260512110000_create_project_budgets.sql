-- ── project_budgets ───────────────────────────────────────────────────────────
-- One row per (project, cost_code) pair.
-- planned_amount is set by the user inline on the Budget tab.
-- Committed and Spent are derived at query time from WOs/POs and transactions.

CREATE TABLE IF NOT EXISTS public.project_budgets (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    text        NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
  cost_code     text        NOT NULL,          -- e.g. 'MAT-09-04'
  planned_amount numeric     NOT NULL DEFAULT 0,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  updated_by    uuid        REFERENCES auth.users(id),
  UNIQUE (project_id, cost_code)
);

CREATE INDEX IF NOT EXISTS idx_project_budgets_project ON public.project_budgets (project_id);

-- RLS
ALTER TABLE public.project_budgets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Read budgets" ON public.project_budgets FOR SELECT
  USING (public.current_user_role() IN ('management', 'accountant', 'supervisor'));

CREATE POLICY "Management and accountant can upsert budgets" ON public.project_budgets FOR ALL
  USING  (public.current_user_role() IN ('management', 'accountant'))
  WITH CHECK (public.current_user_role() IN ('management', 'accountant'));
