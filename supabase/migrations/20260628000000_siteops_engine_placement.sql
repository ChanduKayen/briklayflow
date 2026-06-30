-- ===========================================================================
-- SiteOps constraint engine — persistence columns (additive, reversible, RLS-safe).
--
-- The dependency engine (src/lib/siteOps/engine) writes a topo-sorted concrete graph into
-- site_tasks and reconciles re-instantiations WITHOUT clobbering human work. That needs a stable
-- per-node identity + provenance + ordering ownership:
--
--   node_key         the engine's concrete NodeId ("conduit@First#First-UnitA-dry"); the key the
--                    reconciler matches on across re-instantiation.
--   task_type_id     the library task-type ('conduit', 'plaster', 'user_<slug>' for classified).
--   zone_id          the kinded zone the node sits in (null for per-floor / building tasks).
--   placement_source 'authored' (known trade from the library) | 'classified' (user task placed
--                    by the M4 classifier).
--   order_source     'auto' (engine-defaulted seq_no) | 'manual' (a human dragged it). order_source
--                    ='manual' is NEVER re-defaulted by re-instantiation — same stickiness model as
--                    owner_source in 20260626000004, now applied to ORDER.
--   needs_review     the classifier's honesty-valve flag (loosely-attached / low-confidence task).
--   binding          immediate hard-predecessor metadata [{node_key,task_type_id,nature,reason}]
--                    so the UI can render "why blocked" without recomputing the graph.
--
-- All columns are nullable or defaulted, so existing generated rows remain valid. RLS is inherited
-- from site_tasks (org_id IN (SELECT get_my_org_ids())); no policy change needed. Safe to re-run.
-- ===========================================================================

ALTER TABLE public.site_tasks
  ADD COLUMN IF NOT EXISTS node_key         text,
  ADD COLUMN IF NOT EXISTS task_type_id     text,
  ADD COLUMN IF NOT EXISTS zone_id          text,
  ADD COLUMN IF NOT EXISTS placement_source text    NOT NULL DEFAULT 'authored'
                                                     CHECK (placement_source IN ('authored','classified')),
  ADD COLUMN IF NOT EXISTS order_source     text    NOT NULL DEFAULT 'auto'
                                                     CHECK (order_source IN ('auto','manual')),
  ADD COLUMN IF NOT EXISTS needs_review     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS binding          jsonb   NOT NULL DEFAULT '[]'::jsonb;

-- one engine node per project (authored + classified rows carry a node_key; legacy/hand-typed
-- rows leave it null and are excluded from the constraint).
CREATE UNIQUE INDEX IF NOT EXISTS site_tasks_project_node_key_uniq
  ON public.site_tasks (project_id, node_key)
  WHERE node_key IS NOT NULL;

-- reconciliation lookup path
CREATE INDEX IF NOT EXISTS site_tasks_node_key_idx
  ON public.site_tasks (project_id, node_key);

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback, if ever needed):
--   DROP INDEX IF EXISTS public.site_tasks_node_key_idx;
--   DROP INDEX IF EXISTS public.site_tasks_project_node_key_uniq;
--   ALTER TABLE public.site_tasks
--     DROP COLUMN IF EXISTS binding, DROP COLUMN IF EXISTS needs_review,
--     DROP COLUMN IF EXISTS order_source, DROP COLUMN IF EXISTS placement_source,
--     DROP COLUMN IF EXISTS zone_id, DROP COLUMN IF EXISTS task_type_id,
--     DROP COLUMN IF EXISTS node_key;
-- ---------------------------------------------------------------------------
