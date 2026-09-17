-- ===========================================================================
-- WhatsApp demo concierge — the 23rd-hour NUDGE (columns + pg_cron → edge fn).
--
-- A landing prospect who ran the live demo (lead_status='engaged') but hasn't
-- signed up gets ONE warm re-hook at ~23h — still inside the 24h WhatsApp window,
-- so it's a free-form message (no approved template needed). The `wa-demo-nudge`
-- edge function finds them, references the record they filed, offers to set up
-- their real site, and stamps demo_nudged_at so it fires exactly once.
--
-- This migration does TWO things:
--   1. Adds wa_prospects.demo_entry / demo_nudged_at (always safe — no prereqs).
--   2. Schedules the cron IF it's provisioned; otherwise it SKIPS scheduling with
--      a NOTICE (so the columns still apply and you can re-run after setup).
--
-- PREREQUISITES for the cron half (the columns apply regardless):
--   1. Deploy the function:     supabase functions deploy wa-demo-nudge
--   2. Set the function secret:  supabase secrets set DEMO_NUDGE_SECRET=<hex>
--        (generate once with:    openssl rand -hex 32)
--        The function also uses WA_APP_URL / WA_SIGNUP_LINK / WA_ACCESS_TOKEN /
--        WA_PHONE_NUMBER_ID (already set for the webhook) and an AI key is NOT needed.
--   3. Store the SAME hex in Vault so cron can send it as the bearer:
--        SELECT vault.create_secret('<the same hex>', 'demo_nudge_secret');
--   4. Enable pg_cron + pg_net (Dashboard → Database → Extensions) — already on if
--      the chase / drainer / watchdog crons run.
--
-- ROLLBACK:  SELECT cron.unschedule('wa-demo-nudge-30min');
-- ===========================================================================

-- 1. Columns (idempotent, no prerequisites) ---------------------------------
ALTER TABLE public.wa_prospects
  ADD COLUMN IF NOT EXISTS demo_entry     JSONB,        -- the last entry we filed in the demo (for the nudge copy)
  ADD COLUMN IF NOT EXISTS demo_nudged_at TIMESTAMPTZ;  -- set once, when the 23h nudge is sent

-- 2. Schedule the cron, or skip loudly if not yet provisioned ----------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE NOTICE 'pg_cron/pg_net not enabled — columns added, SKIPPING the nudge schedule. Enable them and re-run.';
    RETURN;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'demo_nudge_secret') THEN
    RAISE NOTICE 'Vault secret "demo_nudge_secret" not found — columns added, SKIPPING the nudge schedule. Set it (must match the DEMO_NUDGE_SECRET function env) then re-run: SELECT vault.create_secret(''<hex>'', ''demo_nudge_secret'');';
    RETURN;
  END IF;

  PERFORM cron.unschedule('wa-demo-nudge-30min')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-demo-nudge-30min');

  PERFORM cron.schedule('wa-demo-nudge-30min', '*/30 * * * *', $cron$
    SELECT net.http_post(
      url     := 'https://momzyincivvpngazvfgq.functions.supabase.co/wa-demo-nudge',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'demo_nudge_secret')
      ),
      body    := '{}'::jsonb
    );
  $cron$);

  RAISE NOTICE 'Scheduled wa-demo-nudge-30min (every 30 minutes).';
END $$;

-- Verify:      SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'wa-demo-nudge-30min';
-- Watch runs:  SELECT * FROM cron.job_run_details WHERE command LIKE '%wa-demo-nudge%' ORDER BY start_time DESC LIMIT 20;
