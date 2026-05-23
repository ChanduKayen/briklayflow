-- Add RFQ status to purchase_orders check constraint
ALTER TABLE public.purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_status_check;
ALTER TABLE public.purchase_orders ADD CONSTRAINT purchase_orders_status_check CHECK (status IN ('ORDERED', 'BILLED', 'PARTIAL', 'PAID', 'CANCELLED', 'RFQ'));
