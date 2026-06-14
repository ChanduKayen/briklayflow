-- ── P2: make the documents bucket private (Sprint 0.5 follow-up) ──────────────
-- The documents bucket (client bills & invoices) was public-read: the "Public
-- Access" policy let ANYONE with the object URL read a client's financial
-- documents, no auth required. Flip it to private; clients now fetch via
-- short-lived signed URLs (createSignedUrl), which require an authenticated
-- session. See src/lib/storage.ts (resolveDocUrl / useSignedDocUrl / openDoc).
--
-- Scope: the documents bucket only. The rough-entry-media bucket (WhatsApp
-- images, raw_image_url) stays public for now and is consumed by the AI vision
-- functions by URL — flagged separately as a follow-up.

UPDATE storage.buckets SET public = false WHERE id = 'documents';

-- Remove world-readable access (this policy was documents-only).
DROP POLICY IF EXISTS "Public Access" ON storage.objects;

-- Authenticated users may read documents objects — required so the client can
-- mint signed URLs via createSignedUrl. (Upload/update/delete policies for
-- authenticated users are unchanged.)
DROP POLICY IF EXISTS "Authenticated read documents" ON storage.objects;
CREATE POLICY "Authenticated read documents"
ON storage.objects FOR SELECT
USING ( bucket_id = 'documents' AND auth.role() = 'authenticated' );
