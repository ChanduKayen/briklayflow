-- ===========================================================================
-- Step C2 — schedule the 2-MINUTE HELD-FLUSH (pg_cron + pg_net → edge fn).
--
-- Fires the `siteops-held-flush` edge function ~every 2 minutes. It delivers any
-- HELD readback summary (Step C1) whose which_item ask got no reply within the idle
-- window (SITEOPS_HELD_IDLE_MINUTES, default 2): send what's SURE + name the pending
-- as saved-for-review, park the pending item, abandon the convo. So a supervisor whose
-- batch auto-resolved 3 items and got asked about 1 hears "your 3 landed" in ~2 min,
-- instead of waiting the 24h abandon sweep. NO SILENT DROP. Idempotent (it abandons the
-- convo), and the same flush also rides the hourly siteops-reanalyze tick as a belt.
--
-- SCHEDULE: every 2 minutes. Cheap (the OPEN-siteops-with-held set is tiny); tune freely.
--
-- IDEMPOTENT: unschedules any existing 'siteops-held-flush-2min' first.
--
-- PREREQUISITES (do these BEFORE running this migration):
--   1. Deploy the function:     supabase functions deploy siteops-held-flush
--   2. Reuses the SAME secret as siteops-reanalyze (same cron trust domain):
--        the function reads SITEOPS_REANALYZE_SECRET; the Vault secret
--        'siteops_reanalyze_secret' must already exist (set for the reanalyze cron).
--   3. pg_cron + pg_net enabled (already on if the reanalyze/chase crons run).
-- Fails loudly if the Vault secret is missing — never schedule a bearer that 403s forever.
--
-- ROLLBACK:  SELECT cron.unschedule('siteops-held-flush-2min');
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_cron and pg_net must both be enabled (Dashboard → Database → Extensions) before scheduling the held-flush.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'siteops_reanalyze_secret') THEN
    RAISE EXCEPTION 'Vault secret "siteops_reanalyze_secret" not found. Set it first (must match the SITEOPS_REANALYZE_SECRET function env): SELECT vault.create_secret(''<hex>'', ''siteops_reanalyze_secret'');';
  END IF;

  PERFORM cron.unschedule('siteops-held-flush-2min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'siteops-held-flush-2min');

  PERFORM cron.schedule('siteops-held-flush-2min', '*/2 * * * *', $cron$
    SELECT net.http_post(
      url     := 'https://momzyincivvpngazvfgq.functions.supabase.co/siteops-held-flush',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'siteops_reanalyze_secret')
      ),
      body    := '{}'::jsonb
    );
  $cron$);

  RAISE NOTICE 'Scheduled siteops-held-flush-2min (every 2 minutes).';
END $$;

-- Verify:      SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'siteops-held-flush-2min';
-- Watch runs:  SELECT * FROM cron.job_run_details WHERE command LIKE '%siteops-held-flush%' ORDER BY start_time DESC LIMIT 20;
