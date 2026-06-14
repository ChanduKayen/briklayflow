-- ===========================================================================
-- WhatsApp Sprint 1 -- schedule the watchdog + purge sweeps (pg_cron).
--
-- Run AFTER migration 20260613000010 (which defines wa_watchdog /
-- purge_wa_conversations). Kept out of the migration so a cron quirk can't roll
-- back the function DDL. Resilient: each schedule is independent and the watchdog
-- falls back to a 1-minute cron if this pg_cron rejects sub-minute schedules.
-- (Outbox drainer cron is separate: docs/wa_outbox_drainer_cron.sql.)
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron not enabled. Enable it in Dashboard -> Database -> Extensions, then re-run.';
  END IF;

  -- Clean up any previous schedules (no-op if absent).
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-watchdog') THEN
    PERFORM cron.unschedule('wa-watchdog');
  END IF;
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-purge-conversations') THEN
    PERFORM cron.unschedule('wa-purge-conversations');
  END IF;

  -- Watchdog: prefer every 30s (matches the 30s timeout); fall back to 1 min.
  BEGIN
    PERFORM cron.schedule('wa-watchdog', '30 seconds', $cron$ SELECT public.wa_watchdog(30); $cron$);
    RAISE NOTICE 'Scheduled wa-watchdog every 30s.';
  EXCEPTION WHEN OTHERS THEN
    PERFORM cron.schedule('wa-watchdog', '* * * * *', $cron$ SELECT public.wa_watchdog(30); $cron$);
    RAISE NOTICE 'Sub-minute cron unsupported; scheduled wa-watchdog every 1 min instead.';
  END;

  -- Purge closed conversations every 2 minutes.
  PERFORM cron.schedule('wa-purge-conversations', '*/2 * * * *', $cron$ SELECT public.purge_wa_conversations(); $cron$);
  RAISE NOTICE 'Scheduled wa-purge-conversations every 2 min.';

  -- Sprint 4: commit/close abandoned OPEN transaction conversations (timeout
  -- trigger) every 1 minute; default TTL 5 min (see wa_commit_abandoned_conversations).
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname='wa-commit-abandoned') THEN
    PERFORM cron.unschedule('wa-commit-abandoned');
  END IF;
  PERFORM cron.schedule('wa-commit-abandoned', '* * * * *', $cron$ SELECT public.wa_commit_abandoned_conversations(5); $cron$);
  RAISE NOTICE 'Scheduled wa-commit-abandoned every 1 min (TTL 5 min).';
END $$;

-- Verify:  SELECT jobname, schedule, active FROM cron.job WHERE jobname LIKE 'wa-%';
