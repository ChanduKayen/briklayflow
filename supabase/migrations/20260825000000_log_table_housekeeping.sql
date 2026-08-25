-- ===========================================================================
-- Log-table housekeeping — keep pg_net + pg_cron exhaust from filling the disk.
--
-- WHY: every scheduled job (wa-outbox-drain @10s, wa-watchdog @30s, the siteops
-- ticks) writes ONE row to cron.job_run_details per run, and each net.http_post
-- it fires writes ONE row to net._http_response. At ~11.5k cron runs/day these
-- two log tables grew to ~1 GB (543 MB + 461 MB) and pushed the Free-plan project
-- OVER its disk cap → read-only mode → auth.flow_state INSERTs failed → Google
-- sign-in returned 500 "Error creating flow state". Neither table holds business
-- data; both are pure telemetry. This schedules a daily prune so they stay bounded.
--
-- NOTE: this is retention, not the one-time cleanup. If the tables are already
-- huge, TRUNCATE them ONCE by hand first (DELETE won't reclaim a full disk):
--   set default_transaction_read_only = 'off';
--   truncate table net._http_response;
--   truncate table cron.job_run_details;
-- Then run this migration so they never balloon again.
--
-- RETENTION: net._http_response 2 days, cron.job_run_details 3 days. Daily DELETE
-- keeps steady-state volume low enough that autovacuum reclaims the churn.
--
-- IDEMPOTENT: unschedules any existing 'log-table-housekeeping' first.
--
-- ROLLBACK:  SELECT cron.unschedule('log-table-housekeeping');
-- ===========================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION 'pg_cron must be enabled (Dashboard → Database → Extensions) before scheduling housekeeping.';
  END IF;

  PERFORM cron.unschedule('log-table-housekeeping')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'log-table-housekeeping');

  -- 03:17 daily — off-peak, and offset from the other crons' round-minute schedules.
  PERFORM cron.schedule('log-table-housekeeping', '17 3 * * *', $cron$
    DELETE FROM cron.job_run_details WHERE end_time < now() - interval '3 days';
    DELETE FROM net._http_response   WHERE created  < now() - interval '2 days';
  $cron$);

  RAISE NOTICE 'Scheduled log-table-housekeeping (daily 03:17): prunes cron.job_run_details >3d and net._http_response >2d.';
END $$;

-- Verify:     SELECT jobname, schedule, active FROM cron.job WHERE jobname = 'log-table-housekeeping';
-- Watch runs: SELECT * FROM cron.job_run_details WHERE command LIKE '%job_run_details%' ORDER BY start_time DESC LIMIT 5;
-- Sizes:      SELECT pg_size_pretty(pg_total_relation_size('net._http_response')),
--                    pg_size_pretty(pg_total_relation_size('cron.job_run_details'));
