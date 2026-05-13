-- Add AWAIT_PAYEE_CHOICE state, remove unused AWAIT_CONFIRM
DO $$
BEGIN
  EXECUTE (
    SELECT 'ALTER TABLE wa_sessions DROP CONSTRAINT ' || quote_ident(conname)
    FROM pg_constraint
    WHERE conrelid = 'wa_sessions'::regclass AND contype = 'c' AND conname LIKE '%state%'
    LIMIT 1
  );
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

ALTER TABLE wa_sessions
  ADD CONSTRAINT wa_sessions_state_check
  CHECK (state IN ('IDLE', 'AWAIT_PAYEE', 'AWAIT_AMOUNT', 'AWAIT_PAYEE_CHOICE', 'AWAIT_PROJECT'));
