-- ===========================================================================
-- Block 0 REBUILD — step D: site_tasks (simplified) + site_task_qc (new).
-- Drops the model_version/branch/scope columns from the earlier draft. site_tasks
-- has no data yet (the expander never ran), so a clean drop+recreate is safe and
-- gives the exact simpler shape. Modern org RLS (get_my_org_ids) on both.
-- ===========================================================================

-- shared helpers (idempotent; reused from the earlier draft)
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

CREATE SEQUENCE IF NOT EXISTS public.site_task_seq START 1;
CREATE OR REPLACE FUNCTION public.generate_task_no()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_year text; v_seq int;
BEGIN
  v_year := to_char(now(), 'YYYY');
  v_seq  := nextval('public.site_task_seq');
  RETURN 'ST-' || v_year || '-' || lpad(v_seq::text, 4, '0');
END; $$;

DROP TABLE IF EXISTS public.site_task_qc CASCADE;
DROP TABLE IF EXISTS public.site_tasks   CASCADE;

-- ── site_tasks — the spine ──────────────────────────────────────────────────
CREATE TABLE public.site_tasks (
  task_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_no        text UNIQUE NOT NULL DEFAULT public.generate_task_no(),  -- ST-YYYY-NNNN
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id     text NOT NULL REFERENCES public.projects(project_id)   ON DELETE CASCADE,

  phase          text NOT NULL,          -- sequence.json phase key
  trade          text NOT NULL,          -- sequence.json trade key
  floor_label    text,                   -- null for once/common
  unit_label     text,                   -- null for villa / once / common
  name           text NOT NULL,          -- human task name (from the trade label)
  description    text,                   -- LLM Pass-2 (nullable; skeleton valid before enrichment)
  seq_no         integer NOT NULL,       -- monotonic order within the project

  status         text NOT NULL DEFAULT 'not_started' CHECK (status IN ('not_started','active','done')),
  source         text NOT NULL DEFAULT 'generated'  CHECK (source IN ('generated','manual')),
  status_history jsonb NOT NULL DEFAULT '[]'::jsonb,  -- {status,at,by}[]
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.site_tasks
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER site_tasks_touch BEFORE UPDATE ON public.site_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX site_tasks_project_order_idx ON public.site_tasks(project_id, seq_no);
CREATE INDEX site_tasks_org_idx           ON public.site_tasks(org_id);

-- ── site_task_qc — the judgment layer (3 per task, exactly 1 critical) ──────
CREATE TABLE public.site_task_qc (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_id     uuid NOT NULL REFERENCES public.site_tasks(task_id) ON DELETE CASCADE,
  org_id      uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  question    text NOT NULL,
  is_critical boolean NOT NULL DEFAULT false,
  seq         integer NOT NULL,
  -- future follow-up loop — nullable, no logic built now:
  answer      text,
  qc_status   text CHECK (qc_status IS NULL OR qc_status IN ('pending','confirmed','failed')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.site_task_qc ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.site_task_qc
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER site_task_qc_touch BEFORE UPDATE ON public.site_task_qc
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX site_task_qc_task_idx ON public.site_task_qc(task_id);
-- enforce the "exactly ONE critical" half at the DB (≤1 critical per task);
-- "exactly 3 rows per task" is enforced by the enrich function, not DDL.
CREATE UNIQUE INDEX site_task_qc_one_critical ON public.site_task_qc(task_id) WHERE is_critical;
