-- ===========================================================================
-- Day Book — make the WhatsApp welcome fire on FIRST enable, reliably.
--
-- The welcome used to be gated on "did we just INSERT this sender row?". That
-- missed every teammate whose wa_registered_numbers row already existed — e.g.
-- the invite flow inserts one (is_active = true) up front, and legacy/phone-only
-- rows pre-exist too. For those, enabling only UPDATEs the row, so the welcome
-- never sent and send-template was never even called (empty function logs).
--
-- `welcomed_at` is the durable marker instead: NULL = never welcomed. The client
-- sends the approved `teammate_welcome` template on the first enable of a row
-- whose welcomed_at IS NULL, then stamps welcomed_at so re-enabling never
-- re-sends. Existing rows start NULL, so the next enable greets them once.
-- ===========================================================================

ALTER TABLE public.wa_registered_numbers
  ADD COLUMN IF NOT EXISTS welcomed_at TIMESTAMPTZ;
