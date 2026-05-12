-- Add vendor bill document URL to purchase_orders
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS vendor_bill_doc_url text;
