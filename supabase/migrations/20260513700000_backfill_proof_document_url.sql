-- Backfill proof_document_url on transactions that were posted from
-- a WhatsApp Logbook entry (rough_entries) with an image.
--
-- The link exists: transactions.source_re_id → rough_entries.id
-- The image URL lives on: rough_entries.raw_image_url
--
-- Only updates rows where proof_document_url is currently NULL
-- and the source rough entry had an image — safe to re-run.

UPDATE public.transactions t
SET    proof_document_url = re.raw_image_url
FROM   public.rough_entries re
WHERE  t.source_re_id      = re.id
  AND  re.raw_image_url    IS NOT NULL
  AND  re.raw_image_url    <> ''
  AND  (t.proof_document_url IS NULL OR t.proof_document_url = '');
