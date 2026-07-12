-- ===========================================================================
-- WA spine — schedule the outbox DRAINER + WATCHDOG from a migration (Sprint 1 · T4).
--
-- WHY A MIGRATION: these two crons were previously scheduled only by hand from
-- docs/wa_outbox_drainer_cron.sql / docs/wa_spine_cron.sql — the repo could not
-- prove what prod runs. Worse, the docs file carried a literal
-- REPLACE_WITH_WA_DRAINER_SECRET placeholder: pasted verbatim, it stores the
-- placeholder ITSELF in Vault, so every drainer tick sends a bogus bearer, the
-- edge function 403s, and the outbox + wa_message_map (the substrate under every
-- undo tap and late-answer recovery — constitution clause 5, "resolves carry
-- undo") stall silently while cron.job looks perfectly healthy.
--
-- This migration is the repo's source of truth for both schedules. It is
-- IDEMPOTENT (unschedule-then-schedule), so it applies identically as a FIX
-- (probe showed the crons dead/missing) or as a FORMALIZATION (probe showed
-- them healthy — a no-op re-registration replacing the docs file).
--
-- Mirrors 20260702000003 (siteops-reanalyze-hourly): pg_cron + pg_net, bearer
-- read from Vault AT RUN TIME, and guards that FAIL LOUDLY if the Vault secret
-- is absent — extended here to ALSO fail if the secret still equals the docs
-- placeholder. We never schedule a job whose bearer would 403 forever silently.
--
-- PREREQUISITES (do these BEFORE running this migration):
--   1. Function deployed:     supabase functions deploy wa-outbox-drainer
--   2. Generate the secret:   openssl rand -hex 32
--   3. Function env:          supabase secrets set WA_DRAINER_SECRET=<hex>
--   4. The SAME value in Vault — pick exactly one:
--        fresh install:
--          SELECT vault.create_secret('<hex>', 'wa_drainer_secret');
--        overwrite (placeholder found by the T4 probe, or a rotation):
--          SELECT vault.update_secret(
--            (SELECT id FROM vault.secrets WHERE name = 'wa_drainer_secret'),
--            '<hex>');
--   (wa_watchdog needs NO secret — it is a direct SQL call to the function
--    defined in 20260613000010; it sweeps stuck processing_job rows.)
--
-- ROLLBACK:
--   SELECT cron.unschedule('wa-outbox-drain');
--   SELECT cron.unschedule('wa-watchdog');
-- ===========================================================================

DO $$
BEGIN
  -- Extensions
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     OR NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    RAISE EXCEPTION 'pg_cron and pg_net must both be enabled (Dashboard → Database → Extensions) before scheduling the drainer/watchdog.';
  END IF;

  -- LOUD GUARD 1: the bearer secret must exist in Vault (prerequisite step 4).
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'wa_drainer_secret') THEN
    RAISE EXCEPTION 'Vault secret "wa_drainer_secret" not found. Set it first (must match the WA_DRAINER_SECRET function env): SELECT vault.create_secret(''<hex>'', ''wa_drainer_secret'');';
  END IF;

  -- LOUD GUARD 2 (the T4 landmine): the secret must not be the docs placeholder —
  -- a placeholder bearer 403s every tick while cron.job looks healthy.
  IF EXISTS (SELECT 1 FROM vault.decrypted_secrets
             WHERE name = 'wa_drainer_secret'
               AND decrypted_secret = 'REPLACE_WITH_WA_DRAINER_SECRET') THEN
    RAISE EXCEPTION 'Vault secret "wa_drainer_secret" still holds the docs placeholder — every drainer tick would 403. Overwrite it: SELECT vault.update_secret((SELECT id FROM vault.secrets WHERE name = ''wa_drainer_secret''), ''<hex>'');';
  END IF;

  -- Idempotent refresh (no-op if absent).
  PERFORM cron.unschedule('wa-outbox-drain')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-outbox-drain');
  PERFORM cron.unschedule('wa-watchdog')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-watchdog');

  -- Drainer: every 10 seconds (matches the docs cadence). Bearer resolved from
  -- Vault at RUN time, so a later rotation needs no re-schedule.
  PERFORM cron.schedule('wa-outbox-drain', '10 seconds', $cron$
    SELECT net.http_post(
      url     := 'https://momzyincivvpngazvfgq.functions.supabase.co/wa-outbox-drainer',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'wa_drainer_secret')
      ),
      body    := '{}'::jsonb
    );
  $cron$);

  -- Watchdog: prefer 30s (matches its 30s processing timeout); fall back to
  -- 1 minute if this pg_cron build rejects sub-minute schedules — the same
  -- fallback the docs file used.
  BEGIN
    PERFORM cron.schedule('wa-watchdog', '30 seconds', $cron$ SELECT public.wa_watchdog(30); $cron$);
  EXCEPTION WHEN OTHERS THEN
    PERFORM cron.schedule('wa-watchdog', '* * * * *', $cron$ SELECT public.wa_watchdog(30); $cron$);
  END;

  RAISE NOTICE 'Scheduled wa-outbox-drain (every 10s) + wa-watchdog (30s, or 1m fallback).';
END $$;

-- Verify:  SELECT jobname, schedule, active FROM cron.job WHERE jobname IN ('wa-outbox-drain', 'wa-watchdog');
-- Watch:   SELECT * FROM cron.job_run_details ORDER BY start_time DESC LIMIT 20;
