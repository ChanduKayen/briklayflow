-- ===========================================================================
-- Attendance / labour muster — the backend the Attendance page reads & writes.
--
-- Greenfield: no attendance, crew, or rate-card storage existed (markDailyWage was
-- a mock awaiting exactly this). Contract "stages" already live in work_orders +
-- wo_milestones (paid % computed from txn_allocations), so we DON'T duplicate them —
-- a crew links to its work order via wo_id and daily stage readings land in
-- labour_attendance with subject_type='stage', milestone_id = the wo_milestone.
--
-- Five tables, all org-scoped with the standard "org member access" policy +
-- tg_touch_updated_at + (org_id, …) indexes, mirroring site_narrations.
--   labour_rate_card       : current daily rate by worker type (trade × skilled/helper)
--   labour_crews           : a crew (contractor gang) deployed at a project
--   labour_crew_categories : per-crew worker-type rows (Mason, Helper·male, …) + rate
--   labour_direct_workers  : an individual worker deployed at a project (no crew)
--   labour_attendance      : the daily grid cell — one row per subject per work_date,
--                            carrying value + provenance (WhatsApp vs office).
-- ===========================================================================

-- ── labour_rate_card — current daily rate by worker type ──────────────────────
-- One row per (org, trade, kind). trade NULL + kind='hm'/'hf' = general unskilled;
-- trade='__supervisor__' + kind='skilled' = supervisor. A trade's skilled rate is
-- kind='skilled'; its helpers are 'hm' (male) / 'hf' (female). effective_from stamps
-- "changed today"; earlier attendance keeps the rate it was captured with (snapshot
-- on the crew-category / direct-worker rows), so this table is current values only.
CREATE TABLE IF NOT EXISTS public.labour_rate_card (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  trade          text NOT NULL DEFAULT '',                -- '' = unskilled; '__supervisor__' = supervisor; else a trade
  kind           text NOT NULL CHECK (kind IN ('skilled','hm','hf')),
  rate           numeric NOT NULL CHECK (rate >= 0),
  effective_from date NOT NULL DEFAULT current_date,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.labour_rate_card ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.labour_rate_card
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER labour_rate_card_touch BEFORE UPDATE ON public.labour_rate_card
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
-- One rate per worker type per org — a plain unique so it can be an upsert conflict target.
CREATE UNIQUE INDEX labour_rate_card_key_idx
  ON public.labour_rate_card(org_id, trade, kind);

-- ── labour_crews — a crew (contractor gang) deployed at a project ─────────────
CREATE TABLE IF NOT EXISTS public.labour_crews (
  crew_id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id     text NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
  stakeholder_id text REFERENCES public.stakeholders(stakeholder_id) ON DELETE SET NULL,  -- the party/contractor
  name           text NOT NULL,
  description    text,
  trade          text,                                   -- crew's primary trade (drives helper rates)
  is_contract    boolean NOT NULL DEFAULT false,         -- under a formal contract (offers the Contract/Labour toggle)
  basis          text NOT NULL DEFAULT 'labour' CHECK (basis IN ('contract','labour')),
  wo_id          text REFERENCES public.work_orders(wo_id) ON DELETE SET NULL,            -- stages come from here
  paid_through   date,                                   -- days up to here are settled (paid underline)
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.labour_crews ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.labour_crews
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER labour_crews_touch BEFORE UPDATE ON public.labour_crews
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX labour_crews_org_idx     ON public.labour_crews(org_id);
CREATE INDEX labour_crews_project_idx ON public.labour_crews(project_id);

-- ── labour_crew_categories — per-crew worker-type rows + snapshot rate ────────
CREATE TABLE IF NOT EXISTS public.labour_crew_categories (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id      uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  crew_id     uuid NOT NULL REFERENCES public.labour_crews(crew_id) ON DELETE CASCADE,
  category    text NOT NULL,                             -- 'Mason' | 'Helper · male' | 'Helper · female' | …
  rate        numeric NOT NULL DEFAULT 0 CHECK (rate >= 0),
  own_rate    boolean NOT NULL DEFAULT false,            -- rate was overridden off the card
  sort_order  int NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.labour_crew_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.labour_crew_categories
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER labour_crew_categories_touch BEFORE UPDATE ON public.labour_crew_categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX labour_crew_categories_crew_idx ON public.labour_crew_categories(crew_id);
CREATE UNIQUE INDEX labour_crew_categories_key_idx ON public.labour_crew_categories(crew_id, category);

-- ── labour_direct_workers — an individual worker deployed at a project ────────
CREATE TABLE IF NOT EXISTS public.labour_direct_workers (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id     text NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
  stakeholder_id text REFERENCES public.stakeholders(stakeholder_id) ON DELETE SET NULL,
  name           text NOT NULL,
  category       text NOT NULL,                          -- 'Supervisor' | 'Helper · female' | 'Mason' | …
  rate           numeric NOT NULL DEFAULT 0 CHECK (rate >= 0),
  own_rate       boolean NOT NULL DEFAULT false,
  sort_order     int NOT NULL DEFAULT 0,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.labour_direct_workers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.labour_direct_workers
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER labour_direct_workers_touch BEFORE UPDATE ON public.labour_direct_workers
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX labour_direct_workers_project_idx ON public.labour_direct_workers(project_id);

-- ── labour_attendance — the daily grid cell (value + provenance) ──────────────
-- One row per subject per work_date. Exactly ONE of crew_id / category_id /
-- direct_worker_id / milestone_id is set, matched by subject_type:
--   crew_head      → crew_id       : total headcount the crew sent that day
--   crew_category  → category_id   : headcount for one worker-type within the crew
--   direct         → direct_worker_id : 1 full / 0.5 half / 0 absent
--   stage          → milestone_id  : a progress reading (% for lump-sum, qty for measured)
-- subject_key is generated so a single unique(org_id, subject_key, work_date) supports
-- upsert (ON CONFLICT) regardless of which id column is populated.
CREATE TABLE IF NOT EXISTS public.labour_attendance (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id       text NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
  work_date        date NOT NULL,
  subject_type     text NOT NULL CHECK (subject_type IN ('crew_head','crew_category','direct','stage')),
  crew_id          uuid REFERENCES public.labour_crews(crew_id) ON DELETE CASCADE,
  category_id      uuid REFERENCES public.labour_crew_categories(id) ON DELETE CASCADE,
  direct_worker_id uuid REFERENCES public.labour_direct_workers(id) ON DELETE CASCADE,
  milestone_id     uuid REFERENCES public.wo_milestones(milestone_id) ON DELETE CASCADE,
  value            numeric NOT NULL,
  source           text NOT NULL DEFAULT 'office' CHECK (source IN ('wa','office')),
  recorded_by_name text,
  recorded_at      timestamptz NOT NULL DEFAULT now(),
  photo_url        text,
  rough_entry_id   uuid REFERENCES public.rough_entries(id) ON DELETE SET NULL,
  note             text,
  subject_key      text GENERATED ALWAYS AS (
                     subject_type || ':' ||
                     COALESCE(crew_id::text, category_id::text, direct_worker_id::text, milestone_id::text, '')
                   ) STORED,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.labour_attendance ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.labour_attendance
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER labour_attendance_touch BEFORE UPDATE ON public.labour_attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE UNIQUE INDEX labour_attendance_subject_day_idx
  ON public.labour_attendance(org_id, subject_key, work_date);
CREATE INDEX labour_attendance_project_day_idx
  ON public.labour_attendance(org_id, project_id, work_date);
