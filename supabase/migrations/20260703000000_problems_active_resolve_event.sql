-- v2 Unified Inbound Resolution — UNDO binding (Layer 2b).
--
-- The auto-resolve rung is only sound because a one-tap "Not resolved" can undo a wrong RESOLVE. That undo
-- must be bounded to the SPECIFIC resolve event it was attached to, so a later legitimate re-resolve makes a
-- stale old undo a no-op (never a blind reopen that clobbers the correct re-resolution).
--
-- active_resolve_event stamps the issue with the followup_events row of the resolve that is CURRENTLY active
-- (null = not resolved / reopened). The resolve readback carries that same event id in its wa_message_map
-- object_refs; handleUndoResolve reopens ONLY when the stamp still equals the bound id. ON DELETE SET NULL:
-- if the event row is ever removed, the binding nulls and any bound undo safely no-ops.
ALTER TABLE public.problems
  ADD COLUMN IF NOT EXISTS active_resolve_event uuid
    REFERENCES public.followup_events(id) ON DELETE SET NULL;
