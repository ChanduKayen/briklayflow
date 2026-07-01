-- ===========================================================================
-- Block B2 — schedule the site-ops CHASE sweep (pg_cron + pg_net → edge fn).
--
-- Promoted from docs/siteops_chase_cron.sql into a real migration so the schedule
-- can't be lost. Fires the `siteops-chase` edge function daily; it finds issues/
-- todos whose follow-up clock has arrived, batches each owner's due items into ONE
-- WhatsApp digest, enqueues it on the outbox, records a `chase_sent` trail event
-- per item, and advances each issue's next_followup_at by its cause cadence.
--
-- SCHEDULE: 03:30 UTC = 09:00 IST — a morning glance, one digest to start the day.
-- Day-grained on purpose (cadences are in days; ≤ one message per owner per day).
--
-- IDEMPOTENT: unschedules any existing 'siteops-chase-daily' first, so re-running
-- this migration just refreshes the schedule.
--
-- PREREQUISITES (do these BEFORE running this migration — see the ticket steps):
--   1. Deploy the function:   supabase functions deploy siteops-chase
--   2. Set the function secret: supabase secrets set SITEOPS_CHASE_SECRET=<hex>
--        (generate once with:  openssl rand -hex 32)
--   3. Store the SAME value in Vault so cron can send it as the bearer:
--        SELECT vault.create_secret('<the same hex>', 'siteops_chase_secret');
--   4. Enable pg_cron + pg_net (Dashboard → Database → Extensions).
-- This migration REQUIRES step 3 (the Vault secret) to exist and will fail loudly
-- if it doesn't — so we never schedule cron with a placeholder bearer that 403s
-- forever silently.
--
-- ROLLBACK:  SELECT cron.unschedule('siteops-chase-daily');
-- ===========================================================================

DO $$
BEGIN
  -- Extensions
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_cron and pg_net must both be enabled (Dashboard → Database → Extensions) before scheduling the chase sweep.';
  END IF;

  -- The bearer secret must already be in Vault (prerequisite step 3). Fail loudly
  -- rather than schedule a job whose Authorization header would 403 every run.
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'siteops_chase_secret') THEN
    RAISE EXCEPTION 'Vault secret "siteops_chase_secret" not found. Set it first (must match the SITEOPS_CHASE_SECRET function env): SELECT vault.create_secret(''<hex>'', ''siteops_chase_secret'');';
  END IF;

  -- Refresh idempotently.
  PERFORM cron.unschedule('siteops-chase-daily')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'siteops-chase-daily');

  PERFORM cron.schedule('siteops-chase-daily', '30 3 * * *', $cron$
    SELECT net.http_post(
      url     := 'https://momzyincivvpngazvfgq.functions.supabase.co/siteops-chase',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'siteops_chase_secret')
      ),
      body    := '{}'::jsonb
    );
  $cron$);

  RAISE NOTICE 'Scheduled siteops-chase-daily (03:30 UTC / 09:00 IST).';
END $$;

-- Verify:      SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'siteops-chase-daily';
-- Watch runs:  SELECT * FROM cron.job_run_details WHERE command LIKE '%siteops-chase%' ORDER BY start_time DESC LIMIT 20;
