-- ===========================================================================
-- WhatsApp PHOTO batch — one confirmation, one ack, for a burst of photos.
--
-- A supervisor photographs a materials list across several pages and sends them
-- together. WhatsApp delivers each image as its own webhook POST, so today the
-- sender sees the product acknowledge the SAME upload three times ("Got your
-- photo…" ×3) and confirm the request in three fragments ("Materials requested"
-- then "Added 10 more" then "Added 6 more") — it reads as broken, even though
-- the pages correctly fold into ONE request.
--
-- Fix: DEBOUNCE the photos, the same shape as wa_burst_messages does for text.
-- Every inbound photo lands here. Only the FIRST of a burst acks. Each photo
-- stages/folds its items SILENTLY and tags its row with the request it landed in
-- (pr_id). The LAST photo of the burst (no newer unconsumed sibling after a short
-- quiet window) CLAIMS the whole set and sends ONE confirmation per distinct
-- request — so a single list is one card, and a rare two-vendor batch is still a
-- card each.
--
-- Service-role only (the edge function): RLS on, no policy → clients can't read
-- another sender's in-flight photos. bigint IDENTITY `id` gives the burst its
-- order and the "am I the last photo?" test (no unconsumed row with a greater id).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.wa_photo_batch (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  org_id      uuid,
  sender      text NOT NULL,
  wamid       text,
  pr_id       uuid,                                   -- the request this photo folded into (set after staging)
  created_at  timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

-- The hot path: the newest UNCONSUMED photo per sender (both the last-photo test
-- and the finalize claim read this).
CREATE INDEX IF NOT EXISTS wa_photo_batch_sender_open_idx
  ON public.wa_photo_batch (sender, id)
  WHERE consumed_at IS NULL;

-- Look a photo's row up by its wamid (the agent tags pr_id by wamid).
CREATE INDEX IF NOT EXISTS wa_photo_batch_wamid_idx
  ON public.wa_photo_batch (wamid);

-- Housekeeping seam — a sweeper can delete long-consumed rows by time.
CREATE INDEX IF NOT EXISTS wa_photo_batch_created_idx
  ON public.wa_photo_batch (created_at);

ALTER TABLE public.wa_photo_batch ENABLE ROW LEVEL SECURITY;
-- No policy on purpose: only the service role (which bypasses RLS) ever touches it.

NOTIFY pgrst, 'reload schema';
