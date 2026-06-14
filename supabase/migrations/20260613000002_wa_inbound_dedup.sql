-- ── WhatsApp inbound idempotency gate (Sprint 0, T0.3) ────────────────────────
-- Meta retries delivery on timeout/non-200, so the same `wamid` can arrive more
-- than once. This table is the DB-enforced dedup gate: the webhook attempts an
-- insert keyed by `wamid` before any processing, and the unique-violation IS the
-- duplicate signal (no read-then-write race).
--
-- Kept deliberately minimal and self-contained. Sprint 1 introduces a
-- `processing_job` table (also `wamid`-keyed) that will subsume this gate.

CREATE TABLE IF NOT EXISTS wa_inbound_dedup (
  wamid        TEXT        PRIMARY KEY,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_inbound_dedup_received_at_idx
  ON wa_inbound_dedup(received_at);

-- Service role only — the webhook writes with the service key (bypasses RLS).
ALTER TABLE wa_inbound_dedup ENABLE ROW LEVEL SECURITY;

-- ── Purge old rows ────────────────────────────────────────────────────────────
-- Meta won't retry beyond a few days, so rows older than ~7 days are dead weight.
-- Enable pg_cron and uncomment to keep the table from growing forever.
--
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
--
-- SELECT cron.schedule(
--   'purge-wa-inbound-dedup',
--   '0 3 * * *',  -- daily at 03:00 UTC
--   $$ DELETE FROM wa_inbound_dedup WHERE received_at < NOW() - INTERVAL '7 days' $$
-- );
