-- ===========================================================================
-- Step 4a — OUTBOUND-WAMID CAPTURE SPINE.
--
-- Sends go through the async outbox, so the wamid WhatsApp assigns OUR message is
-- only known when the drainer POSTs and reads the response — after send() returned.
-- This wires the recovery of that wamid into a durable wamid→object MAP, so a later
-- inbound whose reaction.message_id / quoted context.id points at one of our messages
-- can resolve back to the objects it was about (Step 4b readback corrections; Step 5
-- reactions / late-answer / retraction).
--
--   1. outbox.capture_ref — a ref send() carries (what the message was + what it was
--      about), read by the drainer when it learns the wamid. Nullable; only readbacks/
--      picks set it, so every other send is byte-identical to today.
--   2. wa_message_map — the durable outbound_wamid → {refs} map the drainer writes.
--      SEPARATE from outbox on purpose: outbox is the transient send QUEUE; the map must
--      survive for late-answer recovery (a quoted reply can arrive days later).
--   3. outbox_claim — re-created (identical body) so its SETOF public.outbox return type
--      picks up the new capture_ref column and the drainer receives it on the claimed row.
--
-- Additive + idempotent. Server-internal (RLS on, no policies — like outbox); the
-- service-role drainer writes it and the service-role webhook reads it.
--
-- ROLLBACK:
--   DROP TABLE IF EXISTS public.wa_message_map;
--   ALTER TABLE public.outbox DROP COLUMN IF EXISTS capture_ref;
--   (outbox_claim keeps working — the re-create is a no-op refresh.)
-- ===========================================================================

ALTER TABLE public.outbox
  ADD COLUMN IF NOT EXISTS capture_ref jsonb;   -- {ref_kind, convo_id?, project_id?, object_refs?}

CREATE TABLE IF NOT EXISTS public.wa_message_map (
  outbound_wamid text PRIMARY KEY,               -- the wamid WhatsApp assigned to our SENT message
  org_id         uuid REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  ref_kind       text NOT NULL,                  -- 'readback' | 'pick' — what the message was
  convo_id       uuid,                           -- the open conversation, when the message was a pick (loose; no FK)
  project_id     text REFERENCES public.projects(project_id) ON DELETE SET NULL,
  object_refs    jsonb,                          -- [{kind,id}] the objects a readback was about
  created_at     timestamptz NOT NULL DEFAULT now()
);

-- Consumers look up by the inbound reaction.message_id / context.id → the PK (outbound_wamid), so the
-- PK index is the only one needed. org scan for retention/audit is cheap at this size.
CREATE INDEX IF NOT EXISTS wa_message_map_org_idx ON public.wa_message_map(org_id, created_at);

ALTER TABLE public.wa_message_map ENABLE ROW LEVEL SECURITY;
-- No policies: server-internal (service-role only), mirroring public.outbox.

-- Refresh outbox_claim so RETURNING o.* surfaces the new capture_ref column to the drainer. Body is
-- IDENTICAL to 20260613000010 — this is a type-refresh, not a behaviour change.
CREATE OR REPLACE FUNCTION public.outbox_claim(p_limit int DEFAULT 20)
RETURNS SETOF public.outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.outbox o
    SET status = 'SENDING', attempts = o.attempts + 1, updated_at = now()
  WHERE o.id IN (
    SELECT id FROM public.outbox
    WHERE status = 'PENDING' AND next_attempt_at <= now()
    ORDER BY next_attempt_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING o.*;
END $$;

REVOKE ALL ON FUNCTION public.outbox_claim(int) FROM public;
GRANT EXECUTE ON FUNCTION public.outbox_claim(int) TO service_role;
