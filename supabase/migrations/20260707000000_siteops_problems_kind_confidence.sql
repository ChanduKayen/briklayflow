-- SPRINT 2 · T6 — KIND FIDELITY (clause 3) + NOTE FLOOR (clause 4) on public.problems.
--
-- Two additive columns so a found item is stored AS WHAT IT IS, in the SAME table (no fork):
--   • kind        — 'issue' | 'snag'. The planner already distinguishes them; the executor bridge
--                   flattened snag → issue on the way to the row. This lets the kind flow through.
--   • confidence  — 'high' | 'med' | 'low'. The ladder grades a NEW item; a low/med grade is a NOTE —
--                   recorded, but the chase/escalation is GATED on it (createProblem leaves
--                   next_followup_at NULL for a note, so the scheduler never chases an uncertain guess),
--                   with an upgrade offer in the readback. No separate note/comment object.
--
-- BACKFILL is implicit via the NOT NULL DEFAULTs: every existing row becomes a HIGH-confidence ISSUE,
-- which is exactly how it behaved before — nothing already stored changes meaning. Lifecycle consumers
-- (chase scheduler, Site Desk, RLS) read existing columns and are untouched; these are new, defaulted,
-- and independently indexed only if a future surface needs them.

ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'issue';
ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_kind_check;
ALTER TABLE public.problems ADD CONSTRAINT problems_kind_check CHECK (kind IN ('issue', 'snag'));

ALTER TABLE public.problems ADD COLUMN IF NOT EXISTS confidence text NOT NULL DEFAULT 'high';
ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_confidence_check;
ALTER TABLE public.problems ADD CONSTRAINT problems_confidence_check CHECK (confidence IN ('high', 'med', 'low'));

-- ROLLBACK (manual):
--   ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_kind_check;
--   ALTER TABLE public.problems DROP COLUMN IF EXISTS kind;
--   ALTER TABLE public.problems DROP CONSTRAINT IF EXISTS problems_confidence_check;
--   ALTER TABLE public.problems DROP COLUMN IF EXISTS confidence;
