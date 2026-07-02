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

-- WIDEN THE type CHECK — the original followup_events CHECK (20260627000000) allows only the B1/B2/B3
-- trail types; it was never widened for the photo-enrichment feature. But Step 2's two producers write
-- type='description_added' and type='possible_photo_followup', and Step 3 (2/2)'s harvest writes
-- type='reanalyzed'. Without this, EVERY one of those inserts violates the CHECK and the enrichment is
-- silently lost — so the whole harvest arm has nothing to harvest. Drop the auto-named inline CHECK and
-- re-add it with the photo types included. Runs AFTER 20260627000000 (higher timestamp) so the table +
-- original constraint already exist; IF EXISTS keeps it idempotent on re-run.
ALTER TABLE public.followup_events DROP CONSTRAINT IF EXISTS followup_events_type_check;
ALTER TABLE public.followup_events ADD CONSTRAINT followup_events_type_check CHECK (type IN (
  'chase_sent', 'reply_received', 'status_changed', 'escalated', 'blocker_noted', 'comment',
  'description_added',        -- STEP 2: an in-window RELATED photo follow-up (enrichment)
  'possible_photo_followup',  -- STEP 2: an uncertain→unrelated follow-up, stamped for re-analysis
  'reanalyzed'                -- STEP 3 (2/2): the harvest filled a missing cause/deadline
));

-- Step 3's harvest query is "the still-pending ones" — a partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS followup_events_pending_reanalysis_idx
  ON public.followup_events(org_id) WHERE pending_reanalysis;

-- ROLLBACK:
--   DROP INDEX IF EXISTS followup_events_pending_reanalysis_idx;
--   ALTER TABLE public.followup_events DROP COLUMN IF EXISTS pending_reanalysis;
--   ALTER TABLE public.followup_events DROP CONSTRAINT IF EXISTS followup_events_type_check;
--   ALTER TABLE public.followup_events ADD CONSTRAINT followup_events_type_check CHECK (type IN (
--     'chase_sent','reply_received','status_changed','escalated','blocker_noted','comment'));
