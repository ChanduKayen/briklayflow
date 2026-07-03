-- ===========================================================================
-- Fix 3 — allow VOICE AUDIO in the rough-entry-media bucket.
--
-- The bucket's allowed_mime_types (20260513200000) was image-only, so WhatsApp voice
-- notes (audio/ogg, opus) were REJECTED on upload — storeMedia threw, the voice branch
-- caught it best-effort, the transcript flowed on, and the audio was silently dropped.
--
-- That is not a skipped nice-to-have: it's a silent evidence drop on a declared
-- exception path. This week proved why it matters — when a transcript-borne blocker
-- was eaten by the chase matcher (Fix 1), the audio would have been the ONLY surviving
-- proof the supervisor ever reported it. Evidence is what survives when interpretation
-- fails; store both the transcript (interpretation) AND the audio (evidence).
--
-- Idempotent: sets the full allowed list (re-runnable). Covers the WhatsApp audio
-- family (voice = ogg/opus; document-audio / forwarded clips may be mp3/mp4/amr/aac).
-- ===========================================================================

UPDATE storage.buckets
SET allowed_mime_types = ARRAY[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic',
  'audio/ogg', 'audio/mpeg', 'audio/mp4', 'audio/amr', 'audio/aac'
]
WHERE id = 'rough-entry-media';

-- ROLLBACK:
--   UPDATE storage.buckets
--   SET allowed_mime_types = ARRAY['image/jpeg','image/png','image/webp','image/gif','image/heic']
--   WHERE id = 'rough-entry-media';
