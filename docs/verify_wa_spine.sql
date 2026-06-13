-- ===========================================================================
-- WhatsApp Sprint 1 spine -- verification (run in SQL editor; ROLLBACKs, no data
-- persists). Proves: watchdog fails a stuck job + enqueues exactly one outbox
-- failure (idempotent), and the new tables deny client (authenticated) reads.
-- ===========================================================================

BEGIN;

DO $$
DECLARE
  a_org   uuid;
  job_id  uuid;
  fixed   int;
  fixed2  int;
  ob_cnt  int;
  job_status text;
  authed_can_read int;
  u_test  uuid := gen_random_uuid();
BEGIN
  SELECT org_id INTO a_org FROM public.organizations WHERE status='active' ORDER BY created_at LIMIT 1;
  IF a_org IS NULL THEN RAISE EXCEPTION 'no active org'; END IF;

  -- -- Watchdog: a job stuck in PROCESSING past the 30s timeout --
  INSERT INTO public.processing_job (wamid, org_id, sender_number, message_type, status, processing_at)
  VALUES ('wamid.TEST.'||u_test::text, a_org, '910000000000', 'text', 'PROCESSING', now() - interval '40 seconds')
  RETURNING id INTO job_id;

  fixed := public.wa_watchdog(30);
  IF fixed < 1 THEN RAISE EXCEPTION 'watchdog did not fail the stuck job'; END IF;

  SELECT status INTO job_status FROM public.processing_job WHERE id = job_id;
  IF job_status <> 'FAILED' THEN RAISE EXCEPTION 'job not FAILED (got %)', job_status; END IF;

  SELECT count(*) INTO ob_cnt FROM public.outbox WHERE dedup_key = 'job-fail:'||job_id::text;
  IF ob_cnt <> 1 THEN RAISE EXCEPTION 'expected exactly 1 outbox failure msg, got %', ob_cnt; END IF;

  -- Idempotent: a second run must NOT re-fail or re-enqueue this job.
  fixed2 := public.wa_watchdog(30);
  SELECT count(*) INTO ob_cnt FROM public.outbox WHERE dedup_key = 'job-fail:'||job_id::text;
  IF ob_cnt <> 1 THEN RAISE EXCEPTION 'watchdog double-enqueued (% outbox rows)', ob_cnt; END IF;
  RAISE NOTICE 'watchdog OK: stuck job -> FAILED + 1 outbox failure; idempotent on re-run (refixed=%).', fixed2;

  -- A healthy in-flight job (just started) must NOT be touched.
  INSERT INTO public.processing_job (wamid, org_id, sender_number, status, processing_at)
  VALUES ('wamid.HEALTHY.'||u_test::text, a_org, '910000000001', 'PROCESSING', now())
  RETURNING id INTO job_id;
  PERFORM public.wa_watchdog(30);
  SELECT status INTO job_status FROM public.processing_job WHERE id = job_id;
  IF job_status <> 'PROCESSING' THEN RAISE EXCEPTION 'watchdog false-positived a healthy job (% )', job_status; END IF;
  RAISE NOTICE 'watchdog correctly left a fresh in-flight job alone.';

  -- -- RLS: client (authenticated) must NOT read the server-internal tables --
  PERFORM set_config('request.jwt.claims', json_build_object('sub', u_test::text, 'role','authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  authed_can_read := 0;
  authed_can_read := authed_can_read + (SELECT count(*) FROM public.processing_job);
  authed_can_read := authed_can_read + (SELECT count(*) FROM public.outbox);
  authed_can_read := authed_can_read + (SELECT count(*) FROM public.wa_conversations);
  authed_can_read := authed_can_read + (SELECT count(*) FROM public.wa_sender_locks);
  RESET ROLE;
  IF authed_can_read <> 0 THEN RAISE EXCEPTION 'RLS LEAK: authenticated read % server-internal rows', authed_can_read; END IF;
  RAISE NOTICE 'RLS OK: authenticated sees 0 rows in processing_job/outbox/wa_conversations/wa_sender_locks.';

  RAISE NOTICE '------------------------------------------------------------';
  RAISE NOTICE 'WA SPINE VERIFICATION PASSED.';
END $$;

ROLLBACK;
