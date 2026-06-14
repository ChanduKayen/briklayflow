-- ===========================================================================
-- WhatsApp Sprint 1 -- outbox TTL (stale-reply expiry)
--
-- A reply whose inbound is old (system was down, big backlog) must NOT be sent --
-- you never want to answer a 22:38 "Hi" at 07:14 the next morning. The drainer
-- calls outbox_expire() each tick to mark stale PENDING rows EXPIRED instead of
-- sending them. Uses the row's created_at (enqueue time) as the inbound-age proxy
-- -- for failure messages that's within ~1 min of the inbound.
-- ===========================================================================

-- Add EXPIRED to the status check (the original constraint was unnamed -> find it).
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.outbox'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.outbox DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.outbox
    ADD CONSTRAINT outbox_status_check
    CHECK (status IN ('PENDING','SENDING','SENT','FAILED','EXPIRED'));
END $$;

-- Expire stale PENDING replies (default TTL 15 min). Returns the number expired.
CREATE OR REPLACE FUNCTION public.outbox_expire(p_ttl_minutes int DEFAULT 15)
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  UPDATE public.outbox
    SET status = 'EXPIRED',
        last_error = 'ttl: inbound older than ' || p_ttl_minutes || ' min',
        updated_at = now()
  WHERE status = 'PENDING'
    AND created_at < now() - make_interval(mins => p_ttl_minutes);
  GET DIAGNOSTICS n = ROW_COUNT;
  RETURN n;
END $$;

REVOKE ALL     ON FUNCTION public.outbox_expire(int) FROM public;
GRANT  EXECUTE ON FUNCTION public.outbox_expire(int) TO service_role, postgres;
