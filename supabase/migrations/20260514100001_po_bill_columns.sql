-- STEP 2: Add vendor bill columns to purchase_orders

ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_bill_number     text,
  ADD COLUMN IF NOT EXISTS vendor_bill_amount     decimal,
  ADD COLUMN IF NOT EXISTS vendor_bill_date       date,
  ADD COLUMN IF NOT EXISTS vendor_bill_url        text,
  ADD COLUMN IF NOT EXISTS bill_recorded_at       timestamptz,
  ADD COLUMN IF NOT EXISTS bill_recorded_by_name  text;

-- Migrate existing vendor_bill_no → vendor_bill_number (old column from previous migration)
UPDATE purchase_orders
  SET vendor_bill_number = vendor_bill_no
  WHERE vendor_bill_no IS NOT NULL
    AND vendor_bill_number IS NULL;

-- Migrate existing vendor_bill_doc_url → vendor_bill_url
UPDATE purchase_orders
  SET vendor_bill_url = vendor_bill_doc_url
  WHERE vendor_bill_doc_url IS NOT NULL
    AND vendor_bill_url IS NULL;

-- bill_variance as generated column (bill amount minus PO total value)
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS bill_variance decimal
    GENERATED ALWAYS AS (vendor_bill_amount - total_value) STORED;

-- received_at_site and received_by_name already exist from po_overhaul migration
-- Add received_by_name if missing
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS received_by_name    text,
  ADD COLUMN IF NOT EXISTS received_by_user_id uuid;
