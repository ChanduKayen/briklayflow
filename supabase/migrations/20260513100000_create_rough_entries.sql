-- ── Rough Entries (Inbox) ────────────────────────────────────────────────────

-- Sequence for RE numbers (global, not reset yearly for simplicity)
CREATE SEQUENCE IF NOT EXISTS rough_entry_seq START 1;

-- RE number generator: RE-YYYY-NNNN
CREATE OR REPLACE FUNCTION generate_re_number()
RETURNS TEXT AS $$
DECLARE
  v_year TEXT;
  v_seq  INT;
BEGIN
  v_year := TO_CHAR(NOW(), 'YYYY');
  v_seq  := NEXTVAL('rough_entry_seq');
  RETURN 'RE-' || v_year || '-' || LPAD(v_seq::TEXT, 4, '0');
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Main table
CREATE TABLE IF NOT EXISTS rough_entries (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  re_number        TEXT        UNIQUE NOT NULL DEFAULT generate_re_number(),
  source           TEXT        NOT NULL CHECK (source IN (
                                 'WHATSAPP_TEXT', 'WHATSAPP_IMAGE',
                                 'WHATSAPP_VOICE', 'UI_TEXT', 'UI_IMAGE'
                               )),
  raw_text         TEXT,
  raw_image_url    TEXT,
  raw_audio_url    TEXT,
  transcribed_text TEXT,
  sender_name      TEXT,
  sender_number    TEXT,
  ai_extracted     JSONB       NOT NULL DEFAULT '{}',
  status           TEXT        NOT NULL DEFAULT 'PENDING'
                               CHECK (status IN ('PENDING', 'POSTED', 'DISMISSED')),
  resolved_txn_id  TEXT        REFERENCES transactions(txn_id) ON DELETE SET NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by       UUID        REFERENCES auth.users(id) ON DELETE SET NULL
);

-- Index for common queries
CREATE INDEX IF NOT EXISTS rough_entries_status_idx     ON rough_entries(status);
CREATE INDEX IF NOT EXISTS rough_entries_created_at_idx ON rough_entries(created_at DESC);
CREATE INDEX IF NOT EXISTS rough_entries_created_by_idx ON rough_entries(created_by);

-- Link from transactions back to the rough entry that spawned it
ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS source_re_id UUID REFERENCES rough_entries(id) ON DELETE SET NULL;

-- ── Row-Level Security ────────────────────────────────────────────────────────

ALTER TABLE rough_entries ENABLE ROW LEVEL SECURITY;

-- Management / Principal / Accountant: full read access
CREATE POLICY "staff_read_rough_entries"
  ON rough_entries FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('management', 'principal', 'accountant')
    )
  );

-- Supervisor: read own entries only (created by them or their sender_number)
CREATE POLICY "supervisor_read_own_rough_entries"
  ON rough_entries FOR SELECT
  USING (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid() AND role = 'supervisor'
    )
  );

-- All authenticated users can insert
CREATE POLICY "authenticated_insert_rough_entries"
  ON rough_entries FOR INSERT
  WITH CHECK (auth.uid() IS NOT NULL);

-- Management / Principal / Accountant: can update (to post / dismiss)
CREATE POLICY "staff_update_rough_entries"
  ON rough_entries FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('management', 'principal', 'accountant')
    )
  );

-- Supervisors can update their own entries (for status transitions)
CREATE POLICY "supervisor_update_own_rough_entries"
  ON rough_entries FOR UPDATE
  USING (created_by = auth.uid());

-- ── Realtime ─────────────────────────────────────────────────────────────────

-- Enable realtime for live updates (WhatsApp entries + AI extraction updates)
ALTER PUBLICATION supabase_realtime ADD TABLE rough_entries;
