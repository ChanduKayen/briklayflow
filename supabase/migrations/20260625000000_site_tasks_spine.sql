-- ===========================================================================
-- Block 0 — light spine for the construction-model-driven task generator.
-- Three tables: construction_models (data-driven model catalog),
-- project_construction_meta (the persisted seed), site_tasks (the spine).
-- NO model data populated here (rcc_residential spec is authored separately
-- against these columns). NO expander/enrich logic — author-side schema only.
--
-- ID conventions (verified against the live model):
--   · domain rows use TEXT human ids (project_id, wo_id) — NOT uuid
--   · capture/infra rows use uuid PK + a human number (re_number style)
--   · org_id is uuid (organizations.org_id); tenant RLS via get_my_org_ids()
-- ===========================================================================

-- ── shared: bump updated_at on write (idempotent) ──────────────────────────
CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;


-- ===========================================================================
-- 1. construction_models — model definitions as DATA, not code.
--    GLOBAL catalog (like sku_directory): no org_id, authenticated read,
--    writes service-role only. One row per model; the ordered buckets + trades
--    + scope rules + branch points + per-trade reference_notes live in `spec`.
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.construction_models (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  model_key   text UNIQUE NOT NULL,                 -- 'rcc_residential'
  name        text NOT NULL,                        -- 'RCC Residential'
  description text,
  version     integer NOT NULL DEFAULT 1,           -- bump on spec change (re-structure traceability)
  status      text NOT NULL DEFAULT 'active'
                CHECK (status IN ('active','draft','retired')),
  spec        jsonb NOT NULL,                       -- the ordered buckets contract (see COMMENT)
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- The `spec` contract the expander (Pass 1) + enricher (Pass 2) read:
--   {
--     "buckets": [
--       {
--         "key": "foundation", "label": "Foundation",
--         "cardinality": "once" | "per_floor" | "per_floor_unit",
--         "include_when": { "scope": ["structure_only","structure_finishing","full"] },  -- optional; omit = all scopes
--         "requires": ["has_basement"],          -- optional; seed bool flags that must all be true to emit
--         "trades": ["excavation","pcc","footing"],            -- ordered; used when no branch
--         "reference_notes": { "excavation": "...", "pcc": "..." },   -- per-trade grounding for Pass 2
--         "branch": {                            -- optional; overrides trades/reference_notes
--           "on": "footing_type",                -- a project_construction_meta field
--           "default": "isolated",
--           "variants": { "isolated": { "trades": [...], "reference_notes": {...} },
--                         "raft":     { "trades": [...], "reference_notes": {...} } }
--         }
--       }
--     ]
--   }
COMMENT ON COLUMN public.construction_models.spec IS
  'Ordered buckets[]: {key,label,cardinality(once|per_floor|per_floor_unit),include_when{scope[]},requires[],trades[],reference_notes{trade:note},branch{on,default,variants{name:{trades[],reference_notes{}}}}}';

ALTER TABLE public.construction_models ENABLE ROW LEVEL SECURITY;
-- Global reference data: any authenticated user reads; only service_role writes
-- (no write policy -> RLS denies authenticated writes, service_role bypasses RLS).
CREATE POLICY "construction_models read" ON public.construction_models
  FOR SELECT USING (auth.uid() IS NOT NULL);

CREATE TRIGGER construction_models_touch BEFORE UPDATE ON public.construction_models
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();


-- ===========================================================================
-- 2. project_construction_meta — the persisted SEED (source of the skeleton).
--    1:1 with a project; org-scoped (carries project data). model_key is the
--    SELECTED model (nullable -> industrial/renovation stub to manual).
-- ===========================================================================
CREATE TABLE IF NOT EXISTS public.project_construction_meta (
  project_id        text PRIMARY KEY REFERENCES public.projects(project_id) ON DELETE CASCADE,
  org_id            uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  model_key         text REFERENCES public.construction_models(model_key),  -- null = stubbed type (manual)
  project_type      text NOT NULL
                      CHECK (project_type IN ('villa','apartment','commercial','industrial','renovation')),
  has_basement      boolean NOT NULL DEFAULT false,
  basement_count    integer NOT NULL DEFAULT 0,
  has_stilt         boolean NOT NULL DEFAULT false,
  floors_above      integer NOT NULL DEFAULT 0,     -- above ground (ground counted in the expander)
  footing_type      text,                           -- branch input (e.g. isolated|raft|pile)
  builtup_area_sqft numeric,                        -- nullable
  scope             text NOT NULL,                 -- MODEL-DEFINED vocab (answer #3): NO DB enum.
                                                    -- Validated in the app against the selected model's
                                                    -- spec.scopes (residential: structure_only|
                                                    -- structure_finishing|full; commercial/industrial differ).
  units_per_floor   integer NOT NULL DEFAULT 1,     -- uniform default; per-band override is a later table
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.project_construction_meta ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.project_construction_meta
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

CREATE TRIGGER project_construction_meta_touch BEFORE UPDATE ON public.project_construction_meta
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();


-- ===========================================================================
-- 3. site_tasks — the spine. uuid PK + human task_no (ST-YYYY-NNNN).
--    Pass-1 fills structure; Pass-2 fills the three text fields (nullable, so a
--    skeleton is valid BEFORE enrichment). Modern org RLS (get_my_org_ids).
-- ===========================================================================
CREATE SEQUENCE IF NOT EXISTS public.site_task_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_task_no()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_year text; v_seq int;
BEGIN
  v_year := to_char(now(), 'YYYY');
  v_seq  := nextval('public.site_task_seq');
  RETURN 'ST-' || v_year || '-' || lpad(v_seq::text, 4, '0');
END; $$;

CREATE TABLE IF NOT EXISTS public.site_tasks (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  task_no           text UNIQUE NOT NULL DEFAULT public.generate_task_no(),

  org_id            uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id        text NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
  wo_id             text REFERENCES public.work_orders(wo_id) ON DELETE SET NULL,  -- nullable link

  -- ── Pass 1 (deterministic structure) ──
  model_key         text,                 -- stamped by the expander: the model that generated this task
  model_version     integer,              -- stamped by the expander: model version at generation time
  bucket            text NOT NULL,        -- model bucket key ('foundation','frame',…)
  trade             text NOT NULL,        -- trade tag ('excavation','rcc','plastering',…)
  floor_label       text,                 -- null for 'once' buckets (no floor); 'Ground'/'Floor 1'/'Basement 1' otherwise
  unit_label        text,                 -- null for villa / non per_floor_unit; 'Unit A' otherwise
  seq_no            integer NOT NULL,     -- GLOBAL running order within the project (total order)

  -- ── lifecycle ──
  status            text NOT NULL DEFAULT 'not_started'
                      CHECK (status IN ('not_started','active','done')),
  status_history    jsonb NOT NULL DEFAULT '[]'::jsonb,   -- {status,at,by}[] (mirrors work_orders)
  blocks_note       text,

  -- ── Pass 2 (LLM enrichment) — nullable; skeleton usable before enrichment ──
  description       text,
  work_included     text,
  done_definition   text,
  enrichment_status text NOT NULL DEFAULT 'pending'
                      CHECK (enrichment_status IN ('pending','enriched')),

  source            text NOT NULL DEFAULT 'generated'
                      CHECK (source IN ('generated','manual')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.site_tasks ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.site_tasks
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

CREATE TRIGGER site_tasks_touch BEFORE UPDATE ON public.site_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE INDEX IF NOT EXISTS site_tasks_project_order_idx ON public.site_tasks(project_id, seq_no);
CREATE INDEX IF NOT EXISTS site_tasks_org_idx           ON public.site_tasks(org_id);
CREATE INDEX IF NOT EXISTS site_tasks_wo_idx            ON public.site_tasks(wo_id);
CREATE INDEX IF NOT EXISTS site_tasks_enrich_idx        ON public.site_tasks(project_id, enrichment_status);
CREATE INDEX IF NOT EXISTS site_tasks_status_idx        ON public.site_tasks(project_id, status);
