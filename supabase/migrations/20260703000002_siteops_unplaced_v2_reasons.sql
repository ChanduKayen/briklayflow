-- ===========================================================================
-- siteops_unplaced.reason — widen the CHECK to admit the v2 Unified Inbound Resolution park reasons.
--
-- The table (20260702000000) is ALREADY APPLIED with the conversation-era CHECK:
--   ('disambig','typed_pick','project','photo_pick','batch_collision','floor').
-- The v2 engine parks with a NEW vocabulary that was added in code but never in the CHECK:
--   • 'llm_unreadable'          — model down / unparseable response (resolveInbound safety net)
--   • 'evidence_await_placement'— an image queued as evidence, awaiting a home
--   • 'v2_effect_failed'        — an effect threw (generic executor catch)
--   • 'v2_unhandled_terminal'   — a terminal kind the executor doesn't apply
--   • 'non_batch_target'        — a VALID candidate matched OUTSIDE the open batch (fresh path owns it,
--                                 unadopted — Phase 3). Distinguished + REPLAYABLE (payload in `candidates`).
--
-- Consequence of the gap: in prod every v2 park violated this CHECK, so the INSERT threw. On the executor's
-- best-effort path (`.catch(() => {})`) that meant the row was SILENTLY DROPPED — "saved for review" was a
-- lie and the observation was lost (the table has stayed empty because every v2 park bounces). The offline
-- gate stayed green because the test fake does not enforce CHECKs (a pure-green-while-broken trap). This is a
-- separate ALTER (not an edit of the applied base migration): DROP + re-ADD the auto-named constraint, so it
-- is safe to run on the live table. Spend-the-line: the FULL v2 reason set lands in one migration.
--
-- ROLLBACK:
--   ALTER TABLE public.siteops_unplaced DROP CONSTRAINT IF EXISTS siteops_unplaced_reason_check;
--   ALTER TABLE public.siteops_unplaced ADD CONSTRAINT siteops_unplaced_reason_check
--     CHECK (reason IN ('disambig','typed_pick','project','photo_pick','batch_collision','floor'));
-- ===========================================================================

ALTER TABLE public.siteops_unplaced DROP CONSTRAINT IF EXISTS siteops_unplaced_reason_check;

ALTER TABLE public.siteops_unplaced ADD CONSTRAINT siteops_unplaced_reason_check
  CHECK (reason IN (
    -- conversation-era pick reasons (unchanged)
    'disambig', 'typed_pick', 'project', 'photo_pick', 'batch_collision', 'floor',
    -- v2 Unified Inbound Resolution park reasons
    'llm_unreadable', 'evidence_await_placement', 'v2_effect_failed', 'v2_unhandled_terminal', 'non_batch_target'
  ));
