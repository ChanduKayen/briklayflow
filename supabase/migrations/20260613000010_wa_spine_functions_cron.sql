-- ===========================================================================
-- WhatsApp Sprint 1 -- spine functions + sweeps (T1.3 claim, T1.4 watchdog/purge,
-- T1.5 per-sender lock).
--
-- All functions are SECURITY DEFINER with a locked search_path. The webhook
-- (service-role) calls wa_try_lock / wa_release_lock; the drainer edge function
-- calls outbox_claim; pg_cron calls wa_watchdog / purge_wa_conversations.
-- ===========================================================================

-- -- T1.5: per-sender lock (pooler-safe, stale-reclaim) -------------------------
-- Atomic acquire: insert if free, OR reclaim if the existing lock has expired.
-- Returns true iff the caller now holds the lock.
CREATE OR REPLACE FUNCTION public.wa_try_lock(p_sender text, p_wamid text, p_ttl_seconds int DEFAULT 60)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE got boolean;
BEGIN
  INSERT INTO public.wa_sender_locks (sender_number, wamid, locked_at, expires_at)
  VALUES (p_sender, p_wamid, now(), now() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (sender_number) DO UPDATE
    SET wamid = EXCLUDED.wamid, locked_at = now(), expires_at = EXCLUDED.expires_at
    WHERE public.wa_sender_locks.expires_at < now()   -- only reclaim an EXPIRED lock
  RETURNING true INTO got;
  RETURN COALESCE(got, false);
END $$;

-- Release only our own lock (matched by wamid) so we never free a lock a later
-- message already reclaimed.
CREATE OR REPLACE FUNCTION public.wa_release_lock(p_sender text, p_wamid text)
RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  DELETE FROM public.wa_sender_locks WHERE sender_number = p_sender AND wamid = p_wamid;
$$;

-- -- T1.3: outbox claim (atomic, concurrency-safe) ------------------------------
-- Claims up to p_limit due PENDING rows by flipping them to SENDING and bumping
-- attempts, returning them to the drainer. FOR UPDATE SKIP LOCKED + the status
-- guard mean two concurrent drainers never claim the same row (no double-send).
CREATE OR REPLACE FUNCTION public.outbox_claim(p_limit int DEFAULT 20)
RETURNS SETOF public.outbox
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN QUERY
  UPDATE public.outbox o
    SET status = 'SENDING', attempts = o.attempts + 1, updated_at = now()
  WHERE o.id IN (
    SELECT id FROM public.outbox
    WHERE status = 'PENDING' AND next_attempt_at <= now()
    ORDER BY next_attempt_at
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  RETURNING o.*;
END $$;

-- -- T1.4: watchdog -- "no silent failure" for crashes/timeouts -----------------
-- Flip PROCESSING jobs older than the timeout to FAILED and enqueue ONE failure
-- message. Idempotent: acts only on PROCESSING (never terminal), guards on
-- failure_notified, and the outbox enqueue is deduped by dedup_key. Returns the
-- number of jobs failed this run (0 on a healthy system).
CREATE OR REPLACE FUNCTION public.wa_watchdog(p_timeout_seconds int DEFAULT 30)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int := 0; j record;
BEGIN
  FOR j IN
    SELECT id, org_id, sender_number
    FROM public.processing_job
    WHERE status = 'PROCESSING'
      AND failure_notified = false
      AND processing_at < now() - make_interval(secs => p_timeout_seconds)
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.processing_job
      SET status = 'FAILED',
          error = COALESCE(error, 'watchdog: processing timeout'),
          failure_notified = true,
          terminal_at = now(),
          updated_at = now()
      WHERE id = j.id;

    INSERT INTO public.outbox (org_id, target, payload, dedup_key)
    VALUES (
      j.org_id, j.sender_number,
      jsonb_build_object('type','text','text',
        'Sorry, we could not process your last message. Please try sending it again.'),
      'job-fail:' || j.id::text
    )
    ON CONFLICT (dedup_key) DO NOTHING;

    n := n + 1;
  END LOOP;
  RETURN n;
END $$;

-- -- T1.4: purge closed conversations -------------------------------------------
CREATE OR REPLACE FUNCTION public.purge_wa_conversations()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM public.wa_conversations WHERE purge_at IS NOT NULL AND purge_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

-- -- Grants ---------------------------------------------------------------------
REVOKE ALL ON FUNCTION public.wa_try_lock(text, text, int)        FROM public;
REVOKE ALL ON FUNCTION public.wa_release_lock(text, text)         FROM public;
REVOKE ALL ON FUNCTION public.outbox_claim(int)                   FROM public;
REVOKE ALL ON FUNCTION public.wa_watchdog(int)                    FROM public;
REVOKE ALL ON FUNCTION public.purge_wa_conversations()            FROM public;
GRANT EXECUTE ON FUNCTION public.wa_try_lock(text, text, int)     TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_release_lock(text, text)      TO service_role;
GRANT EXECUTE ON FUNCTION public.outbox_claim(int)               TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_watchdog(int)                TO service_role, postgres;
GRANT EXECUTE ON FUNCTION public.purge_wa_conversations()        TO service_role, postgres;

-- -- pg_cron schedules (pure-SQL sweeps) ----------------------------------------
-- Watchdog every 30s (matches the 30s timeout) and purge every 2 min. The OUTBOX
-- DRAINER cron lives in docs/wa_outbox_drainer_cron.sql (it needs pg_net + the
-- function URL + a Vault-stored key). Guarded so it no-ops if pg_cron is absent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron not installed -- skipping schedule. Functions still callable manually.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('wa-watchdog')             WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='wa-watchdog');
  PERFORM cron.unschedule('wa-purge-conversations')  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname='wa-purge-conversations');

  PERFORM cron.schedule('wa-watchdog', '30 seconds', $cron$ SELECT public.wa_watchdog(30); $cron$);
  PERFORM cron.schedule('wa-purge-conversations', '*/2 * * * *', $cron$ SELECT public.purge_wa_conversations(); $cron$);
  RAISE NOTICE 'Scheduled wa-watchdog (30s) and wa-purge-conversations (2m).';
END $$;
