-- RFQ · record which PO(s) an enquiry was awarded to, so a closed comparison page
-- can show the outcome and stay read-only. One entry per PO (split orders → several).
--   awarded = [{ po_id, recipient_id, vendor_name }]
alter table public.rfqs add column if not exists awarded jsonb not null default '[]'::jsonb;
