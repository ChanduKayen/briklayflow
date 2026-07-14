-- ===========================================================================
-- SITE DESK — a task you can EDIT, DELETE and REORDER by hand.
--
-- The desk could only ever change a task's STATE. It could not rename one, could not remove one,
-- and its drag handle was hidden because the reorder had nowhere to persist to. Three columns
-- close that, and each one exists because a human's intent has to survive the engine.
--
-- The engine re-instantiates the graph on every read (reconcile-at-read) and re-asserts what it
-- owns. So "the human edited this" cannot live in the app — it has to live in the row, or the next
-- page load silently undoes it. That is the same stickiness model as order_source (20260628000000)
-- and owner_source (20260626000004), now applied to the NAME and to EXISTENCE.
--
--   projects.suppressed_nodes   node_keys deleted from THIS project's plan. Distinct from
--                               suppressed_tasks (20260630000002), which suppresses a task TYPE
--                               everywhere in the project: deleting "Wiring — Fourth · Unit 2" must
--                               not delete wiring on every other floor. Per-NODE is the only grain
--                               a per-ROW delete can honestly use. The engine skips these when it
--                               instantiates, so dependents reflow and nothing is re-created.
--                               Restorable: remove the key from the array.
--
--   projects.task_synonyms      { task_type_id: [names it used to have] }. Renaming a task changes
--                               what the WhatsApp resolver SEES: the candidate line it matches on
--                               IS the task name (_siteops_resolution_llm.ts). Rename "Conduiting"
--                               to "Pipe pulling" and a supervisor still saying "conduiting done"
--                               would stop resolving. The old word is kept here and appended to the
--                               candidate's `saidAs` list, so both words keep working, forever.
--
--   site_tasks.name_source      'engine' | 'manual'. reconcile() refreshes an engine row's name
--                               from the library on every read (persist.ts). A renamed row says so,
--                               and the refresh skips its name — while STILL owning its binding, its
--                               node_key and its place in the graph. A rename is cosmetic, and it
--                               must not cost the task its engine identity.
--
-- Additive, defaulted, safe to re-run. RLS unchanged (both tables inherit org scoping).
-- ===========================================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS suppressed_nodes text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS task_synonyms    jsonb  NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.site_tasks
  ADD COLUMN IF NOT EXISTS name_source text NOT NULL DEFAULT 'engine'
                                            CHECK (name_source IN ('engine','manual'));

-- ---------------------------------------------------------------------------
-- DOWN (manual rollback, if ever needed):
--   ALTER TABLE public.site_tasks DROP COLUMN IF EXISTS name_source;
--   ALTER TABLE public.projects
--     DROP COLUMN IF EXISTS task_synonyms, DROP COLUMN IF EXISTS suppressed_nodes;
-- ---------------------------------------------------------------------------
