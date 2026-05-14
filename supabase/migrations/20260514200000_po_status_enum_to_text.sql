-- po_status is a Postgres enum; convert to text so we can use new status strings freely.
-- This replaces the intent of 20260514100000_po_status_simplify.sql which used DROP CONSTRAINT
-- (only valid for CHECK constraints, not enum types).

-- Step 1: Cast enum column to text (all existing string values are preserved as-is)
ALTER TABLE purchase_orders
  ALTER COLUMN status TYPE text;

-- Step 2: Migrate old enum values to the new simplified set
UPDATE purchase_orders SET status = 'ORDERED'
  WHERE status IN ('Draft', 'Pending Approval', 'Approved', 'Ordered', 'Issued', 'DRAFT', 'SENT');

UPDATE purchase_orders SET status = 'BILLED'
  WHERE status IN ('Partially Delivered', 'Delivered', 'Received', 'AT_SITE', 'Tallied', 'Disputed', 'TALLIED', 'INVOICED');

UPDATE purchase_orders SET status = 'PAID'
  WHERE status IN ('Closed', 'SETTLED', 'CLOSED');

-- Catch anything else
UPDATE purchase_orders SET status = 'ORDERED'
  WHERE status NOT IN ('ORDERED', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED');

-- Step 3: Add CHECK constraint on the text column
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('ORDERED', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED'));

-- Set column default to ORDERED for all future inserts
ALTER TABLE purchase_orders
  ALTER COLUMN status SET DEFAULT 'ORDERED';
