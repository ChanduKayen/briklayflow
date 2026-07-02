-- ===========================================================================
-- Step 3 (2/2) — schedule the site-ops RE-ANALYSE / HARVEST sweep (pg_cron + pg_net → edge fn).
--
-- Fires the `siteops-reanalyze` edge function on a schedule; it finds the
-- `pending_reanalysis` markers Step 2 left on followup_events (description_added /
-- possible_photo_followup), re-decomposes each enrichment text, and conservatively
-- fills a MISSING cause/deadline on the object it was trailed onto (never overwrites,
-- never auto-resolves), then clears the marker. Mirrors the siteops-chase cron.
--
-- SCHEDULE: hourly at :15 (offset from the chase/drainer/watchdog minutes). Enrichment
-- isn't time-critical, but hourly lands it same-day; low volume (only photo-follow-ups
-- create markers). Tune the cron expression freely — it's a background backfill.
--
-- IDEMPOTENT: unschedules any existing 'siteops-reanalyze-hourly' first.
--
-- PREREQUISITES (do these BEFORE running this migration):
--   1. Deploy the function:     supabase functions deploy siteops-reanalyze
--   2. Set the function secret:  supabase secrets set SITEOPS_REANALYZE_SECRET=<hex>
--        (generate once with:    openssl rand -hex 32)
--   3. Store the SAME value in Vault so cron can send it as the bearer:
--        SELECT vault.create_secret('<the same hex>', 'siteops_reanalyze_secret');
--   4. Enable pg_cron + pg_net (Dashboard → Database → Extensions) — already on if the
--      chase/drainer crons run.
--   5. The function also needs an AI key (OPENAI_API_KEY / ANTHROPIC_API_KEY) to
--      re-decompose; without one it no-ops and leaves markers pending (safe).
-- This migration REQUIRES step 3 (the Vault secret) and fails loudly if it's missing —
-- so we never schedule cron with a bearer that would 403 forever silently.
--
-- ROLLBACK:  SELECT cron.unschedule('siteops-reanalyze-hourly');
-- ===========================================================================

DO $$
BEGIN
  -- Extensions
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_cron and pg_net must both be enabled (Dashboard → Database → Extensions) before scheduling the re-analyse sweep.';
  END IF;

  -- The bearer secret must already be in Vault (prerequisite step 3). Fail loudly
  -- rather than schedule a job whose Authorization header would 403 every run.
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'siteops_reanalyze_secret') THEN
    RAISE EXCEPTION 'Vault secret "siteops_reanalyze_secret" not found. Set it first (must match the SITEOPS_REANALYZE_SECRET function env): SELECT vault.create_secret(''<hex>'', ''siteops_reanalyze_secret'');';
  END IF;

  -- Refresh idempotently.
  PERFORM cron.unschedule('siteops-reanalyze-hourly')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'siteops-reanalyze-hourly');

  PERFORM cron.schedule('siteops-reanalyze-hourly', '15 * * * *', $cron$
    SELECT net.http_post(
      url     := 'https://momzyincivvpngazvfgq.functions.supabase.co/siteops-reanalyze',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'siteops_reanalyze_secret')
      ),
      body    := '{}'::jsonb
    );
  $cron$);

  RAISE NOTICE 'Scheduled siteops-reanalyze-hourly (:15 every hour).';
END $$;

-- Verify:      SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'siteops-reanalyze-hourly';
-- Watch runs:  SELECT * FROM cron.job_run_details WHERE command LIKE '%siteops-reanalyze%' ORDER BY start_time DESC LIMIT 20;
