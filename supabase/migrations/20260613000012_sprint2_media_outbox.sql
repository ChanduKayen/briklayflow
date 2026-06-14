-- ===========================================================================
-- WhatsApp Sprint 2 -- media bucket privacy + outbox rendered payload
-- ===========================================================================

-- -- Outbox: carry any message type ----------------------------------------------
-- Additive, non-breaking. send() stores the FULL rendered WhatsApp Cloud API body
-- here; the drainer POSTs it as-is. Existing rows (watchdog / job-failure) have
-- rendered = NULL and fall back to the text-render path -- unchanged.
ALTER TABLE public.outbox ADD COLUMN IF NOT EXISTS rendered jsonb;

-- -- rough-entry-media: make private + signed-URL access -------------------------
-- Media storage lands this sprint, so close the deferred public-read hole. Mirror
-- the documents-bucket fix: private bucket + authenticated read (so clients can
-- mint short-lived signed URLs); the webhook keeps uploading as service-role.
UPDATE storage.buckets SET public = false WHERE id = 'rough-entry-media';

DROP POLICY IF EXISTS "public_read_rough_entry_media"        ON storage.objects;
DROP POLICY IF EXISTS "Authenticated read rough-entry-media" ON storage.objects;
CREATE POLICY "Authenticated read rough-entry-media"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'rough-entry-media' AND auth.role() = 'authenticated');
-- (service_upload_rough_entry_media INSERT policy is unchanged; service-role
--  uploads bypass RLS anyway.)
