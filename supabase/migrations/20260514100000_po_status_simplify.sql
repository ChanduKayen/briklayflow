-- STEP 1: Simplify PO statuses to 5 clear states
-- ORDERED → BILLED → PARTIAL/PAID → CANCELLED

-- Drop old constraint
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_status_check;

-- Migrate existing values first (before adding constraint)
UPDATE purchase_orders SET status = 'ORDERED'
  WHERE status IN ('Draft', 'Pending Approval', 'Approved', 'Ordered', 'Issued', 'DRAFT', 'SENT');

UPDATE purchase_orders SET status = 'BILLED'
  WHERE status IN ('Partially Delivered', 'Delivered', 'Received', 'AT_SITE', 'Tallied', 'Disputed', 'TALLIED', 'INVOICED');

UPDATE purchase_orders SET status = 'PAID'
  WHERE status IN ('Closed', 'SETTLED', 'CLOSED');

-- Catch anything that slipped through
UPDATE purchase_orders SET status = 'ORDERED'
  WHERE status NOT IN ('ORDERED', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED');

-- Add new simplified constraint
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN (
    'ORDERED',    -- PO sent to vendor
    'BILLED',     -- Vendor bill recorded
    'PARTIAL',    -- Partially paid
    'PAID',       -- Fully settled
    'CANCELLED'   -- Cancelled
  ));
