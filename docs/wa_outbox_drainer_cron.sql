-- ===========================================================================
-- WhatsApp Sprint 1 -- outbox drainer cron (pg_cron + pg_net -> edge function)
--
-- The drainer is the `wa-outbox-drainer` edge function (it reuses the existing
-- WhatsApp send path). pg_cron can't call HTTP directly, so it uses pg_net to
-- POST to the function on a schedule. Run this ONCE in the SQL editor after
-- deploying the function. Requires pg_cron + pg_net (you confirmed both enabled).
--
-- Auth: the drainer checks a DEDICATED shared secret (WA_DRAINER_SECRET), NOT the
-- service-role key. Generate it yourself so it's never "lost":
--     openssl rand -hex 32
-- then set the SAME value in two places:
--   (a) function secret:  supabase secrets set WA_DRAINER_SECRET=<value>
--   (b) Vault below (so cron can send it as the bearer).
-- ===========================================================================

-- 1) Store the drainer secret in Vault ONCE (replace the placeholder with the
--    SAME value you set as the WA_DRAINER_SECRET function secret).
SELECT vault.create_secret('REPLACE_WITH_WA_DRAINER_SECRET', 'wa_drainer_secret')
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'wa_drainer_secret');
-- To rotate later (update both the function secret AND this):
--   SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='wa_drainer_secret'), 'NEW_VALUE');

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
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='wa_drainer_secret')
      ),
      body    := '{}'::jsonb
    );
  $cron$);
  RAISE NOTICE 'Scheduled wa-outbox-drain (every 10s).';
END $$;

-- To verify:  SELECT jobname, schedule, active FROM cron.job;
-- To watch:   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
