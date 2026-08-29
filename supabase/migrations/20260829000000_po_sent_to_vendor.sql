-- Track when a PO was sent to its vendor over WhatsApp. Set by the send-po-to-vendor edge
-- function on a successful send; drives the "PO sent" state in the PO list's Delivery column
-- (POListSheet) — the step between "not received" and "received".
alter table public.purchase_orders
  add column if not exists sent_to_vendor_at timestamptz;

comment on column public.purchase_orders.sent_to_vendor_at is
  'When the PO was last WhatsApped to the vendor (send-po-to-vendor). NULL = never sent.';
