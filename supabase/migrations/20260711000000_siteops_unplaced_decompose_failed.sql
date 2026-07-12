-- ===========================================================================
-- siteops_unplaced.reason — admit 'decompose_failed'.
--
-- THE LIVE FAILURE (2026-07-11, 12:50). A nine-item, three-site voice note arrived; the decompose model
-- call died (timeout / unreadable response). The narration then fell through the branch written for a
-- genuinely contentless note, and the supervisor was told:
--
--     "Noted 👍 — nothing updated, since I couldn't tell which work you meant."
--
-- Our outage, billed to him — and the message was neither parked nor replayable. resolveInbound already
-- parks ITS model failures ('llm_unreadable'); decompose had no such floor, because it never got to park:
-- it failed one layer above. It parks now, and it needs its own reason to say WHICH model died — an
-- 'llm_unreadable' row would claim the resolution model failed on a message the resolver never saw.
--
-- Reasons are a VOCABULARY, not a bucket: a review queue that cannot tell "we couldn't read your message"
-- from "we read it and couldn't place it" cannot be triaged. Hence a distinct value, not a re-use.
--
-- Additive + idempotent (DROP + re-ADD the auto-named constraint — safe on the live table).
--
-- This re-ADDs the WHOLE set (a CHECK cannot be extended in place), so it must carry every value the
-- constraint has accumulated — including 'pending_stage2' from 20260704000000. Dropping one silently would
-- make its park bounce and its observation vanish, which is exactly the bug 20260703000002 was written for.
--
-- ROLLBACK:
--   ALTER TABLE public.siteops_unplaced DROP CONSTRAINT IF EXISTS siteops_unplaced_reason_check;
--   ALTER TABLE public.siteops_unplaced ADD CONSTRAINT siteops_unplaced_reason_check
--     CHECK (reason IN ('disambig','typed_pick','project','photo_pick','batch_collision','floor',
--                       'llm_unreadable','evidence_await_placement','v2_effect_failed',
--                       'v2_unhandled_terminal','non_batch_target','pending_stage2'));
-- ===========================================================================

ALTER TABLE public.siteops_unplaced DROP CONSTRAINT IF EXISTS siteops_unplaced_reason_check;

ALTER TABLE public.siteops_unplaced ADD CONSTRAINT siteops_unplaced_reason_check
  CHECK (reason IN (
    -- conversation-era pick reasons (unchanged)
    'disambig', 'typed_pick', 'project', 'photo_pick', 'batch_collision', 'floor',
    -- v2 Unified Inbound Resolution park reasons
    'llm_unreadable', 'evidence_await_placement', 'v2_effect_failed', 'v2_unhandled_terminal', 'non_batch_target',
    -- Stage-2 interim park (20260704000000)
    'pending_stage2',
    -- Stage-1: the DECOMPOSE model died (our outage). The raw narration is kept in full and is replayable.
    'decompose_failed'
  ));
