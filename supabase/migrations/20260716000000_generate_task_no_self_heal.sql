-- generate_task_no() — SELF-HEALING.
--
-- THE BUG IT KILLS: `insert tasks: duplicate key value violates unique constraint
-- "site_tasks_task_no_key"`. task_no is ALWAYS the DB default (no code path ever sets it — see
-- persist.ts / generateTasks.ts), so a duplicate can mean ONLY one thing: the global sequence
-- `site_task_seq` has fallen BEHIND the task_no values already in the table. That happens whenever
-- rows arrive ahead of the sequence — a restore, a data import, a manual reset — after which the next
-- nextval() lands on a number a row already owns, and the UNIQUE constraint rejects the insert.
--
-- The old function trusted nextval() blindly. This one checks, and heals itself:
--
--   FAST PATH (the normal case): nextval() is ahead of the table → the candidate is free → return it.
--     The only extra cost is ONE lookup on the task_no UNIQUE index — effectively free.
--
--   HEAL PATH (only when a collision would actually happen): jump the sequence PAST the highest number
--     in use, once, under a transaction-scoped advisory lock so concurrent inserts agree on the new
--     high-water mark — then recompute. Every call after the heal is back on the fast path.
--
-- After this, an out-of-sync sequence can never produce a duplicate again: the function repairs the
-- sequence the first time it would have collided, for good.

CREATE OR REPLACE FUNCTION public.generate_task_no()
RETURNS text LANGUAGE plpgsql SECURITY DEFINER AS $$
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
    -- HEAL: serialize the repair (xact lock is held to COMMIT, so a waiter re-reads the max only after
    -- the healer's rows are visible — no two sessions can settle on the same next number).
    PERFORM pg_advisory_xact_lock(hashtext('public.site_task_seq'));
    SELECT COALESCE(MAX(split_part(task_no, '-', 3)::int), 0) INTO v_max
    FROM public.site_tasks
    WHERE task_no ~ '^ST-[0-9]{4}-[0-9]+$';   -- only the numbers we actually mint
    IF v_seq <= v_max THEN
      -- setval(..,N) → last_value=N, is_called=true → THIS call uses N (free: past the max), the next
      -- nextval() returns N+1. One jump repairs the sequence for every future insert.
      v_seq  := setval('public.site_task_seq', v_max + 1);
      v_cand := 'ST-' || v_year || '-' || lpad(v_seq::text, 4, '0');
    END IF;
  END IF;

  RETURN v_cand;
END; $$;

-- Repair the sequence NOW, so the very next insert already lands on the fast path (the function would
-- heal it on first collision anyway; doing it here means no insert has to pay for the first heal). Only
-- when there ARE rows to sync against — on an empty table setval(..,0) would be below the sequence's
-- MINVALUE of 1, and leaving the sequence untouched keeps the first task at ST-YYYY-0001.
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
