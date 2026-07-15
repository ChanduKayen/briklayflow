-- ===========================================================================
-- followup_events.type += 'message_sent' — the AD-HOC MESSAGE (siteops-say).
--
-- The desk's Composer ("Send on WhatsApp") now delivers a founder-authored message to an item's assignee
-- (edge fn siteops-say). The outbound is trailed on the item's story as type='message_sent' so it survives
-- even when delivery can't happen (out of the 24h window). Without admitting the value into the type CHECK,
-- that trail insert throws 23514 in prod and is swallowed — the same silent-drop class as the 'reopened'
-- and 'bare_ack' landmines. Purely additive, idempotent.
-- ===========================================================================

ALTER TABLE public.followup_events DROP CONSTRAINT IF EXISTS followup_events_type_check;
ALTER TABLE public.followup_events ADD CONSTRAINT followup_events_type_check CHECK (type IN (
  'chase_sent', 'reply_received', 'status_changed', 'escalated', 'blocker_noted', 'comment',
  'description_added',        -- STEP 2: an in-window RELATED photo follow-up (enrichment)
  'possible_photo_followup',  -- STEP 2: an uncertain→unrelated follow-up, stamped for re-analysis
  'reanalyzed',               -- STEP 3 (2/2): the harvest filled a missing cause/deadline
  'bare_ack',                 -- STAGE 1: cardinality fast path — a bare "sari"/"ok" against a lone chase
  'reopened',                 -- UNDO (2b): "Not resolved" tapped — the resolve was reopened to ADDRESSING
  'message_sent'              -- siteops-say: a founder-authored ad-hoc message to the assignee
));

-- ROLLBACK:
--   ALTER TABLE public.followup_events DROP CONSTRAINT IF EXISTS followup_events_type_check;
--   ALTER TABLE public.followup_events ADD CONSTRAINT followup_events_type_check CHECK (type IN (
--     'chase_sent','reply_received','status_changed','escalated','blocker_noted','comment',
--     'description_added','possible_photo_followup','reanalyzed','bare_ack','reopened'));
