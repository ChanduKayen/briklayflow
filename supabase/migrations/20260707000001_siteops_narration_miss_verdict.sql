-- SPRINT 2 · T7 (clause 6: a didn't-catch miss must be LOGGED + auditable after the fact, not in-memory).
--
-- The narration is already captured (site_narrations, capture-first). What's missing is the RESOLUTION
-- VERDICT for a BOTH-FALSE miss: decompose extracted items and a project resolved, yet the ladder matched
-- nothing (acked_didnt_catch) — so a reviewer sees a normal-looking narration with no object and can't tell
-- WHY it produced nothing. This adds a queryable home for that verdict on the row it already belongs to.
--
--   miss_verdict jsonb  — {reason, contract} for a both-false miss; {reason:'nothing_extracted'} for a
--                         contentless miss (uniformity: `miss_verdict IS NOT NULL` finds EVERY miss in one
--                         query). Distinct from `decomposed` (extract OUTPUT) — this is the resolution
--                         verdict (why nothing matched). Nullable; a successful narration leaves it null.
--
-- ADDITIVE: nullable jsonb, no CHECK, no backfill — existing rows stay null (they weren't misses, or their
-- miss predates the column). No consumer reads it as actionable.

ALTER TABLE public.site_narrations ADD COLUMN IF NOT EXISTS miss_verdict jsonb;

-- ROLLBACK (manual):
--   ALTER TABLE public.site_narrations DROP COLUMN IF EXISTS miss_verdict;
