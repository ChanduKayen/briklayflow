-- ===========================================================================
-- Block B2 — site-ops CHASE scheduler cron (pg_cron + pg_net -> edge function)
--
-- Fires the `siteops-chase` edge function once a day. It finds issues/todos
-- whose follow-up clock has arrived, BATCHES each owner's due items into ONE
-- WhatsApp digest, enqueues it on the outbox (the wa-outbox-drainer delivers
-- it), records a `chase_sent` trail event per item, and advances each issue's
-- next_followup_at by its cause cadence. pg_cron can't call HTTP directly, so
-- pg_net POSTs to the function. Run this ONCE in the SQL editor AFTER deploying
-- the function. Requires pg_cron + pg_net (already enabled for the drainer).
--
-- SCHEDULE: 03:30 UTC = 09:00 IST — a morning glance, one digest to start the
-- day. Day-grained on purpose: cadences are in DAYS, and a daily run is what
-- keeps one owner to at most one message per day (the anti-muting guarantee).
-- Adjust the cron expression for your site's timezone if needed.
--
-- Auth: the function checks a DEDICATED shared secret (SITEOPS_CHASE_SECRET),
-- NOT the service-role key. Generate it yourself so it's never "lost":
--     openssl rand -hex 32
-- then set the SAME value in two places:
--   (a) function secret:  supabase secrets set SITEOPS_CHASE_SECRET=<value>
--   (b) Vault below (so cron can send it as the bearer).
-- ===========================================================================

-- 1) Store the chase secret in Vault ONCE (replace the placeholder with the
--    SAME value you set as the SITEOPS_CHASE_SECRET function secret).
SELECT vault.create_secret('REPLACE_WITH_SITEOPS_CHASE_SECRET', 'siteops_chase_secret')
WHERE NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'siteops_chase_secret');
-- To rotate later (update both the function secret AND this):
--   SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name='siteops_chase_secret'), 'NEW_VALUE');

-- 2) Schedule the chase digest daily at 03:30 UTC (09:00 IST).
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname='pg_net') THEN
    RAISE EXCEPTION 'pg_cron and pg_net must both be enabled (Dashboard -> Database -> Extensions)';
  END IF;

  PERFORM cron.unschedule('siteops-chase-daily') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='siteops-chase-daily');

  PERFORM cron.schedule('siteops-chase-daily', '30 3 * * *', $cron$
    SELECT net.http_post(
      url     := 'https://momzyincivvpngazvfgq.functions.supabase.co/siteops-chase',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='siteops_chase_secret')
      ),
      body    := '{}'::jsonb
    );
  $cron$);
  RAISE NOTICE 'Scheduled siteops-chase-daily (03:30 UTC / 09:00 IST).';
END $$;

-- To verify:        SELECT jobname, schedule, active FROM cron.job;
-- To watch runs:    SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
--
-- DRY RUN (the B2 STOP test — render real digests WITHOUT sending/advancing):
--   curl -s -X POST 'https://momzyincivvpngazvfgq.functions.supabase.co/siteops-chase?preview=1' \
--        -H "Authorization: Bearer $SITEOPS_CHASE_SECRET" | jq .
--   → returns { owners, issues, todos, digests:[{phone,name,items,text}] } with
--     each owner's batched, project-grouped digest text. Nothing is sent.
