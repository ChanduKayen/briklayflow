-- Add AWAIT_IMAGE_CONTEXT session state
ALTER TABLE wa_sessions DROP CONSTRAINT IF EXISTS wa_sessions_state_check;

ALTER TABLE wa_sessions
  ADD CONSTRAINT wa_sessions_state_check
  CHECK (state IN (
    'IDLE',
    'AWAIT_PAYEE',
    'AWAIT_AMOUNT',
    'AWAIT_PAYEE_CHOICE',
    'AWAIT_PROJECT',
    'AWAIT_IMAGE_CONTEXT'
  ));
