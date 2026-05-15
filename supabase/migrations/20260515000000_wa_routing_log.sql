-- Routing telemetry: one row per inbound WhatsApp message
-- Used to tune arbitration thresholds and debug intent misclassifications.

CREATE TABLE IF NOT EXISTS wa_routing_log (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wa_message_id     text,
  phone_number      text        NOT NULL,
  had_session       boolean     NOT NULL DEFAULT false,
  session_state     text,
  session_score     integer     NOT NULL DEFAULT 0,
  new_intent_score  integer     NOT NULL DEFAULT 0,
  classified_intent text        NOT NULL,
  selected_handler  text        NOT NULL,
  outcome           text,
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_routing_log_phone
  ON wa_routing_log(phone_number, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_wa_routing_log_created
  ON wa_routing_log(created_at DESC);
