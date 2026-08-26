-- RE-APPLY the self-healing generate_task_no() + resync the sequence.
--
-- WHY THIS EXISTS AGAIN (2026-08-26): the live DB was still throwing
--   `insert tasks: duplicate key value violates unique constraint "site_tasks_task_no_key"`
-- even after 20260716000000. The only way that error survives is if the OLD, naive generate_task_no()
-- (a blind nextval, from 20260625000004) is what's actually installed — e.g. the self-heal migration
-- was never applied to this database, or the original site_tasks migration was re-run afterwards and
-- CREATE OR REPLACE clobbered the self-heal back to the naive version.
--
-- This migration is idempotent and safe to run anytime. Run it in the Supabase SQL editor. After it,
-- generate_task_no() repairs the sequence itself the first time a collision WOULD happen, so an
-- out-of-sync sequence can never produce a duplicate again — no matter how the rows got ahead of it.
--
-- (task_no is ALWAYS the DB default; no client code sets it — see persist.ts / generateTasks.ts /
--  desk/live.ts. The client also now retries this specific collision, but this is the real fix.)

CREATE SEQUENCE IF NOT EXISTS public.site_task_seq START 1;

CREATE OR REPLACE FUNCTION public.generate_task_no()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_year text := to_char(now(), 'YYYY');
  v_seq  bigint;
  v_max  bigint;
  v_cand text;
BEGIN
  v_seq  := nextval('public.site_task_seq');
  v_cand := 'ST-' || v_year || '-' || lpad(v_seq::text, 4, '0');

  -- FAST PATH: an indexed existence check on the very constraint we must not violate. Ahead of the
  -- table (the normal state) this is false and we return immediately.
  IF EXISTS (SELECT 1 FROM public.site_tasks WHERE task_no = v_cand) THEN
    -- HEAL: serialize the repair (the xact lock is held to COMMIT, so a waiter re-reads the max only
    -- after the healer's rows are visible — no two sessions can settle on the same next number).
    PERFORM pg_advisory_xact_lock(hashtext('public.site_task_seq'));
    SELECT COALESCE(MAX(split_part(task_no, '-', 3)::int), 0) INTO v_max
    FROM public.site_tasks
    WHERE task_no ~ '^ST-[0-9]{4}-[0-9]+$';   -- only the numbers we actually mint
    IF v_seq <= v_max THEN
      v_seq  := setval('public.site_task_seq', v_max + 1);
      v_cand := 'ST-' || v_year || '-' || lpad(v_seq::text, 4, '0');
    END IF;
  END IF;

  RETURN v_cand;
END; $$;

-- Resync the sequence NOW to the highest number in use, so the very next insert is already on the fast
-- path. Only when there ARE rows (on an empty table setval(..,0) is below MINVALUE 1; leaving it keeps
-- the first task at ST-YYYY-0001).
DO $$
DECLARE v_max bigint;
BEGIN
  SELECT COALESCE(MAX(split_part(task_no, '-', 3)::int), 0) INTO v_max
  FROM public.site_tasks
  WHERE task_no ~ '^ST-[0-9]{4}-[0-9]+$';
  IF v_max > 0 THEN
    PERFORM setval('public.site_task_seq', v_max);
  END IF;
END $$;

-- Verify:
--   SELECT public.generate_task_no();          -- returns the next free ST-YYYY-NNNN
--   SELECT last_value FROM public.site_task_seq;
