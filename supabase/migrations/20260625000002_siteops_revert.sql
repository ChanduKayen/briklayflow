-- ===========================================================================
-- Block 0 REBUILD — step A: revert the over-built model-as-data machinery.
-- The construction sequence now lives in docs/site-ops/sequence.json (ONE editable
-- file), not a DB catalog. Project meta folds into the projects table. site_tasks is
-- KEPT (rebuilt simpler in 20260625000004). Idempotent + safe (IF EXISTS).
--
-- NOTE: these tables were never successfully applied to cloud (the earlier seed failed
-- because construction_models did not exist), so on your DB these DROPs are no-ops —
-- they make the revert explicit and safe regardless of partial state.
-- ===========================================================================
DROP TABLE IF EXISTS public.project_construction_meta CASCADE;  -- folded into projects
DROP TABLE IF EXISTS public.construction_models      CASCADE;   -- replaced by sequence.json
