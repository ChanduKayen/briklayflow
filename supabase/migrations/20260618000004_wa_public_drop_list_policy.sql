-- ===========================================================================
-- Drop the broad SELECT policy on the wa-public bucket.
--
-- A public bucket serves reads via /storage/v1/object/public/... which bypasses
-- RLS, so the SELECT policy was never needed for the header image to load. Its
-- only effect was letting API clients enumerate every object in the bucket — the
-- "Clients can list all files in this bucket" security-linter warning. Removing
-- it closes that listing surface; public object reads are unaffected.
-- IF EXISTS so this is a no-op on fresh setups (where 0003 no longer creates it).
-- ===========================================================================

DROP POLICY IF EXISTS "wa_public_read" ON storage.objects;
