-- ===========================================================================
-- WhatsApp Sprint 1 -- outbox drainer cron (pg_cron + pg_net -> edge function)
--
-- The drainer is the `wa-outbox-drainer` edge function (it reuses the existing
-- WhatsApp send path). pg_cron can't call HTTP directly, so it uses pg_net to
-- POST to the function on a schedule. Run this ONCE in the SQL editor after
-- deploying the function. Requires pg_cron + pg_net (you confirmed both enabled).
--
-- Why Vault: the call needs the service-role key as a bearer; we read it from
-- Supabase Vault instead of hardcoding it (and it's being rotated).
-- ===========================================================================

-- 1) Store the service-role key in Vault ONCE (replace the placeholder; re-run
--    after each rotation). Safe to run repeatedly -- updates if it exists.
SELECT vault.create_secret('REPLACE_WITH_SERVICE_ROLE_KEY', 'wa_service_role_key')
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'wa_service_role_key');
-- To rotate later:
--   SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='wa_service_role_key'), 'NEW_KEY');

-- 2) Schedule the drainer every 10 seconds.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE EXCEPTION 'pg_cron and pg_net must both be enabled (Dashboard -> Database -> Extensions)';
  END IF;

  PERFORM cron.unschedule('wa-outbox-drain') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='wa-outbox-drain');

  PERFORM cron.schedule('wa-outbox-drain', '10 seconds', $cron$
    SELECT net.http_post(
      url     := 'https://momzyincivvpngazvfgq.functions.supabase.co/wa-outbox-drainer',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='wa_service_role_key')
      ),
      body    := '{}'::jsonb
    );
  $cron$);
  RAISE NOTICE 'Scheduled wa-outbox-drain (every 10s).';
END $$;

-- To verify:  SELECT jobname, schedule, active FROM cron.job;
-- To watch:   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
