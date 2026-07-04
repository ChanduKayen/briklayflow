-- ===========================================================================
-- Stage-1 CHECK additions — two words, both additive (singular-first restructure, go-order step 1).
--
-- 1. followup_events.type += 'bare_ack' — RETRO-FIX of a LIVE silent drop (Phase-0 recon flag 1).
--    The cardinality fast path trails `bare_ack` (trailEvent caller sites in _agents/siteops.ts) but the
--    live constraint (probed 2026-07-04) admits only the chase/photo-enrichment types, so EVERY fast-path
--    ack since the adoption deploy has thrown 23514 and been swallowed by trailEvent's best-effort catch —
--    the trail line the fast path exists to leave was silently dropped. Same class as the
--    siteops_unplaced.reason landmine (20260703000002); the offline fake stayed green because it does not
--    enforce CHECKs (that fix is the next commit, gated before the Stage-1 journeys).
--    This ALTER retro-fixes the drop the moment it lands — independent of any code deploy.
--
-- 2. siteops_unplaced.reason += 'pending_stage2' — the interim compound rule's park. Stage 1 processes the
--    FIRST decomposed item through the singular unit and parks the remaining fragments honestly
--    (observation = the fragment SiteItems, candidates = replay payload per the non_batch_target
--    precedent, readback says both truths). Stage 2's loop replays these rows. No new column — the
--    existing shape carries the payload (Phase-0 decision E3, approved).
--
-- NOT here, by ruling (E4): no 'no_project' reason — an unanswered/interrupted project question already
-- parks as reason='project' with fuller machinery (question_wamid stamp, late-answer recovery). Journey
-- (c) asserts reason='project'.
--
-- Both live constraints were probed against prod on 2026-07-04 (Phase-0 section D); the lists below are
-- the probed sets plus exactly one word each. Drop + re-add, idempotent on re-run.
-- ===========================================================================

ALTER TABLE public.followup_events DROP CONSTRAINT IF EXISTS followup_events_type_check;
ALTER TABLE public.followup_events ADD CONSTRAINT followup_events_type_check CHECK (type IN (
  'chase_sent', 'reply_received', 'status_changed', 'escalated', 'blocker_noted', 'comment',
  'description_added',        -- STEP 2: an in-window RELATED photo follow-up (enrichment)
  'possible_photo_followup',  -- STEP 2: an uncertain→unrelated follow-up, stamped for re-analysis
  'reanalyzed',               -- STEP 3 (2/2): the harvest filled a missing cause/deadline
  'bare_ack'                  -- STAGE 1: cardinality fast path — a bare "sari"/"ok" against a lone chase
));

ALTER TABLE public.siteops_unplaced DROP CONSTRAINT IF EXISTS siteops_unplaced_reason_check;
ALTER TABLE public.siteops_unplaced ADD CONSTRAINT siteops_unplaced_reason_check CHECK (reason IN (
  -- conversation-era pick reasons (unchanged)
  'disambig', 'typed_pick', 'project', 'photo_pick', 'batch_collision', 'floor',
  -- v2 Unified Inbound Resolution park reasons (20260703000002, unchanged)
  'llm_unreadable', 'evidence_await_placement', 'v2_effect_failed', 'v2_unhandled_terminal', 'non_batch_target',
  -- STAGE 1: interim compound rule — fragments beyond the first item, parked with replay payload
  'pending_stage2'
));

-- ROLLBACK:
--   ALTER TABLE public.followup_events DROP CONSTRAINT IF EXISTS followup_events_type_check;
--   ALTER TABLE public.followup_events ADD CONSTRAINT followup_events_type_check CHECK (type IN (
--     'chase_sent','reply_received','status_changed','escalated','blocker_noted','comment',
--     'description_added','possible_photo_followup','reanalyzed'));
--   ALTER TABLE public.siteops_unplaced DROP CONSTRAINT IF EXISTS siteops_unplaced_reason_check;
--   ALTER TABLE public.siteops_unplaced ADD CONSTRAINT siteops_unplaced_reason_check CHECK (reason IN (
--     'disambig','typed_pick','project','photo_pick','batch_collision','floor',
--     'llm_unreadable','evidence_await_placement','v2_effect_failed','v2_unhandled_terminal','non_batch_target'));
