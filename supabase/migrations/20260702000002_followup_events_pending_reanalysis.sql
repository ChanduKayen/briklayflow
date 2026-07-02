-- ===========================================================================
-- followup_events.pending_reanalysis — mark pre-Step-3 photo enrichments.
--
-- STEP 2 ships a CONSERVATIVE merge: a text that follows a site photo is trailed
-- onto the photo's object (feed shows "description added") but is NOT re-decomposed
-- into new observations — rich re-analyze + dedup are Step 3. Two Step-2 writes carry
-- this marker so Step 3 can find and harvest them later:
--   type='description_added'        → an in-window RELATED follow-up (enrichment).
--   type='possible_photo_followup'  → an UNCERTAIN→unrelated follow-up that was routed
--                                     fresh (fail-safe), stamped so the pair can be reunited.
-- Without the marker these enrichments would be permanently second-class — attached but
-- never harvested, and nobody would remember which objects they were on.
--
-- Additive + idempotent. Existing rows default false (not pending).
-- ===========================================================================

ALTER TABLE public.followup_events
  ADD COLUMN IF NOT EXISTS pending_reanalysis boolean NOT NULL DEFAULT false;

-- Step 3's harvest query is "the still-pending ones" — a partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS followup_events_pending_reanalysis_idx
  ON public.followup_events(org_id) WHERE pending_reanalysis;

-- ROLLBACK:
--   DROP INDEX IF EXISTS followup_events_pending_reanalysis_idx;
--   ALTER TABLE public.followup_events DROP COLUMN IF EXISTS pending_reanalysis;
