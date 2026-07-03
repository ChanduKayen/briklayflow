-- ===========================================================================
-- Step 5 — DISMISSED status for retraction ("ignore that" / a 👎 on a readback).
--
-- Retraction must NEVER hard-delete (the photo/evidence stays; a mis-log is
-- recoverable and auditable). So it flips the object to a terminal DISMISSED state
-- instead. problems (OPEN/ADDRESSING/RESOLVED) and todos (OPEN/DONE) had no such
-- state — widen both status CHECKs. The defining migration (20260626000003) is long
-- since applied, so this is a new drop+re-add of the auto-named inline constraints.
--
-- COUPLED CORRECTNESS: a DISMISSED issue must not keep getting chased or surfaced as
-- an open item. The WhatsApp read paths that used `status <> 'RESOLVED'` are updated
-- in the same change (siteops-chase loadDueIssues, _siteops_candidates loadCandidates)
-- to also exclude DISMISSED. Todos already filter `status = 'OPEN'`, so they're clean.
-- (UI list queries may still show DISMISSED until they add the same filter — a visible,
-- non-chasing state there is acceptable; the destructive path is the chase, fixed here.)
--
-- ROLLBACK (only safe once no rows are DISMISSED):
--   ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_status_check;
--   ALTER TABLE public.problems ADD CONSTRAINT problems_status_check CHECK (status IN ('OPEN','ADDRESSING','RESOLVED'));
--   ALTER TABLE public.todos DROP CONSTRAINT IF EXISTS todos_status_check;
--   ALTER TABLE public.todos ADD CONSTRAINT todos_status_check CHECK (status IN ('OPEN','DONE'));
-- ===========================================================================

ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_status_check;
ALTER TABLE public.problems ADD CONSTRAINT problems_status_check
  CHECK (status IN ('OPEN', 'ADDRESSING', 'RESOLVED', 'DISMISSED'));

ALTER TABLE public.todos DROP CONSTRAINT IF EXISTS todos_status_check;
ALTER TABLE public.todos ADD CONSTRAINT todos_status_check
  CHECK (status IN ('OPEN', 'DONE', 'DISMISSED'));

-- Keep the chase partial index honest: a DISMISSED issue should not sit in the
-- "needs follow-up" index. Rebuild it to exclude both terminal states.
DROP INDEX IF EXISTS problems_followup_idx;
CREATE INDEX problems_followup_idx ON public.problems(next_followup_at)
  WHERE status NOT IN ('RESOLVED', 'DISMISSED');
