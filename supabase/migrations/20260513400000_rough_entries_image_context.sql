-- Add image context columns and AWAITING_CONTEXT status to rough_entries

-- image_type: distinguishes invoice/bill images from general site photos etc.
ALTER TABLE rough_entries
  ADD COLUMN IF NOT EXISTS image_type text,
  ADD COLUMN IF NOT EXISTS context_deadline timestamptz,
  ADD COLUMN IF NOT EXISTS parent_image_entry_id uuid REFERENCES rough_entries(id) ON DELETE SET NULL;

-- Extend the status CHECK constraint to include AWAITING_CONTEXT
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT conname INTO v_conname
  FROM pg_constraint
  WHERE conrelid = 'rough_entries'::regclass
    AND contype = 'c'
    AND conname LIKE '%status%'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE rough_entries DROP CONSTRAINT %I', v_conname);
  END IF;
END $$;

ALTER TABLE rough_entries
  ADD CONSTRAINT rough_entries_status_check
  CHECK (status IN ('PENDING', 'POSTED', 'DISMISSED', 'AWAITING_CONTEXT'));

-- Index for finding child entries by parent
CREATE INDEX IF NOT EXISTS idx_rough_entries_parent_image_entry_id
  ON rough_entries(parent_image_entry_id)
  WHERE parent_image_entry_id IS NOT NULL;

-- Index for context_deadline so we can query overdue entries
CREATE INDEX IF NOT EXISTS idx_rough_entries_context_deadline
  ON rough_entries(context_deadline)
  WHERE context_deadline IS NOT NULL;
