-- ===========================================================================
-- followup_events.type += 'reopened' — LANDMINE #3, caught by the CHECK-enforcing fake (go-order step 2).
--
-- The undo path trails the reopen (`trailEvent(…, 'reopened', 'Reopened — you tapped "Not resolved"')`,
-- _agents/siteops.ts:477 — Layer 2b, adopted in 906f5ba) but no migration ever admitted 'reopened' into
-- the type CHECK. In prod the reopen itself WORKS (problems.status update) while its trail line throws
-- 23514 and is swallowed — the feed shows a resolve with no reopen after an undo. Same class as the
-- v2-park-reasons and bare_ack landmines; this one was surfaced RED by the migration-parsed fake the
-- moment enforcement landed (test U-active), not by a prod probe — the gate working as ratified.
--
-- Found immediately after 20260704000000 was reviewed+applied, so it must be its own ALTER (the applied
-- file cannot be edited). One word, purely additive, idempotent.
-- ===========================================================================

ALTER TABLE public.followup_events DROP CONSTRAINT IF EXISTS followup_events_type_check;
ALTER TABLE public.followup_events ADD CONSTRAINT followup_events_type_check CHECK (type IN (
  'chase_sent', 'reply_received', 'status_changed', 'escalated', 'blocker_noted', 'comment',
  'description_added',        -- STEP 2: an in-window RELATED photo follow-up (enrichment)
  'possible_photo_followup',  -- STEP 2: an uncertain→unrelated follow-up, stamped for re-analysis
  'reanalyzed',               -- STEP 3 (2/2): the harvest filled a missing cause/deadline
  'bare_ack',                 -- STAGE 1: cardinality fast path — a bare "sari"/"ok" against a lone chase
  'reopened'                  -- UNDO (2b): "Not resolved" tapped — the resolve was reopened to ADDRESSING
));

-- ROLLBACK:
--   ALTER TABLE public.followup_events DROP CONSTRAINT IF EXISTS followup_events_type_check;
--   ALTER TABLE public.followup_events ADD CONSTRAINT followup_events_type_check CHECK (type IN (
--     'chase_sent','reply_received','status_changed','escalated','blocker_noted','comment',
--     'description_added','possible_photo_followup','reanalyzed','bare_ack'));
