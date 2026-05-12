-- Add vendor_bill_amount column to purchase_orders
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_bill_amount numeric DEFAULT 0;
