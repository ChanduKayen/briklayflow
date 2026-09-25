-- ===========================================================================
-- WhatsApp message COALESCING — the burst buffer.
--
-- People type one thought across several quick bubbles: a forwarded materials
-- list, then "need iron for shyam site"; or "Ramu 5000", then "cash". Each bubble
-- is its own webhook POST → its own job, so today they route independently — two
-- PRs for one order, a duplicate "Got it" ack, or one fragment grabbed as the
-- answer to a pending question (live mess, 2026-09-25).
--
-- Fix: DEBOUNCE. Every inbound text lands here first; the webhook waits a short
-- quiet window, and only the LAST bubble of the burst DRAINS the whole set and
-- routes the combined text ONCE. The array-returning extractors still split a
-- genuine multi-order / multi-payment back into N — so coalescing never merges
-- two real transactions, it only reunites one thought.
--
-- Service-role only (the edge function): RLS on, no policy → clients can't read
-- another sender's in-flight text. bigserial `id` gives the burst its order and
-- the "am I the last bubble?" test (no unconsumed row with a greater id).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.wa_burst_messages (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid,
  sender      text NOT NULL,
  wamid       text,
  body        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

-- The hot path: the newest UNCONSUMED bubble per sender (both the last-bubble test
-- and the drain read this).
CREATE INDEX IF NOT EXISTS wa_burst_messages_sender_open_idx
  ON public.wa_burst_messages (sender, id)
  WHERE consumed_at IS NULL;

-- Housekeeping seam — a sweeper can delete long-consumed rows by time.
CREATE INDEX IF NOT EXISTS wa_burst_messages_created_idx
  ON public.wa_burst_messages (created_at);

ALTER TABLE public.wa_burst_messages ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: only the service role (which bypasses RLS) ever touches it.

-- ── Atomic DRAIN — claim every unconsumed bubble for a sender and return them in
--    order. SECURITY DEFINER + a single UPDATE…RETURNING so two racing "last"
--    bubbles can never both claim the same row (row locks settle it); each row is
--    handed to exactly one caller. Returns id + body, oldest first. ──
CREATE OR REPLACE FUNCTION public.wa_drain_burst(p_sender text)
RETURNS TABLE (id bigint, body text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  UPDATE public.wa_burst_messages b
     SET consumed_at = now()
   WHERE b.sender = p_sender
     AND b.consumed_at IS NULL
  RETURNING b.id, b.body;
$$;

REVOKE ALL ON FUNCTION public.wa_drain_burst(text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_drain_burst(text) TO service_role;

NOTIFY pgrst, 'reload schema';
