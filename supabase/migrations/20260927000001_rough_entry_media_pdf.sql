-- ===========================================================================
-- Allow PDF in the rough-entry-media bucket.
--
-- The bucket's allowed_mime_types (image + audio, last set in 20260703000001) rejected
-- application/pdf, so a vendor's / member's PDF (a bill, a quote, a materials list) was
-- refused on upload — storeMedia threw and the document was dropped ("Sorry, I can't
-- read that kind of file"). PDFs are a first-class inbound document now (the extractors
-- read them natively), so the store must accept them.
--
-- Idempotent: sets the full allowed list (re-runnable).
--
-- ROLLBACK:
--   UPDATE storage.buckets
--   SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic',
--     'audio/ogg','audio/mpeg','audio/mp4','audio/amr','audio/aac']
--   WHERE id = 'rough-entry-media';
-- ===========================================================================

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac',
  'application/pdf'
]
WHERE id = 'rough-entry-media';
