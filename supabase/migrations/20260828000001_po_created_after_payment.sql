-- Mark POs that were created AFTER the purchase + payment (the transactions "Attach bill" flow),
-- as opposed to a purchase order raised and approved in advance. The PO detail page reads this to
-- state plainly that the order documents a completed purchase, not a pre-placed / pre-approved order.
ALTER TABLE public.purchase_orders
  ADD COLUMN IF NOT EXISTS created_after_payment boolean NOT NULL DEFAULT false;
