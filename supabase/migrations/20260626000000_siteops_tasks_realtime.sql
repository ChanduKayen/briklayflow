-- ===========================================================================
-- Stage 2c — live enrichment fill. The project task view subscribes to
-- site_tasks changes so Pass-2 enrichment (the siteops-enrich edge function)
-- fills descriptions + QC LIVE, in phase-sized waves, while the user watches.
-- Only site_tasks needs the publication: the client watches description
-- UPDATEs (QC is written first, so a refetch on the update has both). The
-- client also polls every ~2s while enrich is in flight as a safety net, so
-- the feature still works if this publication change hasn't been applied.
-- Idempotent — safe to re-run in the SQL editor.
-- ===========================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'site_tasks'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.site_tasks;
  END IF;
END $$;
