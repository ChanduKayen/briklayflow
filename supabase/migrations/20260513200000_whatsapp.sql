-- ── WhatsApp Integration ──────────────────────────────────────────────────────

-- Shared updated_at trigger function (idempotent)
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ── wa_sessions ───────────────────────────────────────────────────────────────
-- Tracks multi-turn WhatsApp conversations (10-minute TTL)

CREATE TABLE IF NOT EXISTS wa_sessions (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number   TEXT        NOT NULL,
  state          TEXT        NOT NULL DEFAULT 'IDLE'
                 CHECK (state IN (
                   'IDLE', 'AWAIT_PAYEE', 'AWAIT_AMOUNT',
                   'AWAIT_CONFIRM', 'AWAIT_PROJECT'
                 )),
  context        JSONB       NOT NULL DEFAULT '{}',
  rough_entry_id UUID        REFERENCES rough_entries(id) ON DELETE SET NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (phone_number)
);

CREATE TRIGGER wa_sessions_updated_at
  BEFORE UPDATE ON wa_sessions
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE INDEX IF NOT EXISTS wa_sessions_phone_idx   ON wa_sessions(phone_number);
CREATE INDEX IF NOT EXISTS wa_sessions_expires_idx ON wa_sessions(expires_at);

-- Service role only — no user-facing policies needed (service role bypasses RLS)
ALTER TABLE wa_sessions ENABLE ROW LEVEL SECURITY;

-- ── wa_message_log ─────────────────────────────────────────────────────────────
-- Full audit trail of every in/out WhatsApp message

CREATE TABLE IF NOT EXISTS wa_message_log (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number   TEXT        NOT NULL,
  direction      TEXT        NOT NULL CHECK (direction IN ('IN', 'OUT')),
  message_type   TEXT        NOT NULL CHECK (message_type IN ('text', 'image', 'audio', 'document')),
  content        TEXT,
  media_url      TEXT,
  wa_message_id  TEXT        UNIQUE,
  rough_entry_id UUID        REFERENCES rough_entries(id) ON DELETE SET NULL,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_message_log_phone_idx      ON wa_message_log(phone_number);
CREATE INDEX IF NOT EXISTS wa_message_log_created_at_idx ON wa_message_log(created_at DESC);

ALTER TABLE wa_message_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_read_wa_message_log"
  ON wa_message_log FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('management', 'principal')
    )
  );

-- ── wa_registered_numbers ──────────────────────────────────────────────────────
-- Whitelist of phones allowed to send entries via WhatsApp

CREATE TABLE IF NOT EXISTS wa_registered_numbers (
  id             UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  phone_number   TEXT        UNIQUE NOT NULL,
  -- NOTE: stakeholders PK is stakeholder_id TEXT, not UUID
  stakeholder_id TEXT        REFERENCES stakeholders(stakeholder_id) ON DELETE SET NULL,
  user_id        UUID        REFERENCES auth.users(id) ON DELETE SET NULL,
  name           TEXT        NOT NULL,
  role           TEXT        NOT NULL DEFAULT 'Supervisor',
  is_active      BOOLEAN     NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS wa_registered_numbers_phone_idx ON wa_registered_numbers(phone_number);

ALTER TABLE wa_registered_numbers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "staff_read_wa_registered_numbers"
  ON wa_registered_numbers FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('management', 'principal')
    )
  );

CREATE POLICY "staff_write_wa_registered_numbers"
  ON wa_registered_numbers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('management', 'principal')
    )
  );

-- ── Storage: WhatsApp media bucket ────────────────────────────────────────────
-- Separate from 'documents' to isolate WA-origin media

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'rough-entry-media',
  'rough-entry-media',
  true,
  10485760,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/heic']
)
ON CONFLICT (id) DO NOTHING;

CREATE POLICY "service_upload_rough_entry_media"
  ON storage.objects FOR INSERT
  TO service_role
  WITH CHECK (bucket_id = 'rough-entry-media');

CREATE POLICY "public_read_rough_entry_media"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'rough-entry-media');
