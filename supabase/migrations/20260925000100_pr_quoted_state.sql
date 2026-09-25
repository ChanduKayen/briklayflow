-- ===========================================================================
-- A purchase request that has gone out for quotes leaves the review inbox — the
-- same way a placed one does — and carries a link to its enquiry so the request
-- screen can say "quotes requested" and offer to open it.
--
-- Run the two statements separately in the SQL editor: Postgres will not let a
-- freshly ADDed enum value be USED in the same transaction, but nothing here
-- uses 'quoted' at migration time, so a normal run is fine.
-- ===========================================================================

ALTER TYPE public.purchase_request_status ADD VALUE IF NOT EXISTS 'quoted';

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS rfq_id text;

COMMENT ON COLUMN public.purchase_requests.rfq_id IS
  'The enquiry this request was sent out as (send-rfq). Set alongside status = ''quoted''; the request then leaves the draft inbox and its screen links to the enquiry.';
