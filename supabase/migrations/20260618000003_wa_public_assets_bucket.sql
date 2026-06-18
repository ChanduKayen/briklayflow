-- ===========================================================================
-- Public bucket for WhatsApp template assets (e.g. the teammate-welcome header
-- image). Meta fetches a template's header media ANONYMOUSLY at send time, so
-- the asset must live behind a public URL — the private `documents` bucket can't
-- serve it. This bucket holds only non-sensitive, intentionally-public brand
-- assets; nothing user/tenant data ever goes here.
-- ===========================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'wa-public',
  'wa-public',
  true,
  5242880,                                   -- 5 MB is plenty for a header image
  ARRAY['image/png','image/jpeg','image/webp']
)
ON CONFLICT (id) DO UPDATE SET public = true;

-- NOTE: a public bucket serves objects through the public path
-- (/storage/v1/object/public/...), which bypasses RLS — so NO SELECT policy is
-- needed for reads, and adding one only lets clients LIST the bucket (flagged by
-- the security linter). We deliberately omit it. Writes are still gated below.
DROP POLICY IF EXISTS "wa_public_write" ON storage.objects;
CREATE POLICY "wa_public_write"
  ON storage.objects FOR INSERT
  WITH CHECK (
    bucket_id = 'wa-public'
    AND EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role IN ('management','principal')
    )
  );
