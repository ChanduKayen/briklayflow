-- ===========================================================================
-- Procurement v1 — RFQ fan-out intent on the PR (capture-layer, no new table).
--
-- The WhatsApp "Get quotes" flow returns {mode:"rfq", selected_vendors[]}. We
-- persist that intent on the purchase_request itself (the capture/review buffer),
-- NOT in the rfqs/rfq_quotes system-of-record — promotion into that module stays
-- deferred (see 20260620000000_purchase_requests.sql). Cold-vendor sending reads
-- this list later; for now we only record WHICH vendors were picked to quote.
--
--   single-vendor flow  -> vendor_id set, status 'sent_for_approval' (needs-approval)
--   rfq flow            -> sourcing_mode 'rfq', selected_vendor_ids set, status stays
--                          'draft' (no amount yet, so nothing to approve — see the
--                          parked auto-approve-under-threshold note)
--
-- Shape: a JSON array of stakeholder_ids (text, matching stakeholders.stakeholder_id),
-- e.g. ["stk_123","stk_456"]. NULL until an RFQ flow completes against this PR.
-- ===========================================================================

ALTER TABLE public.purchase_requests
  ADD COLUMN IF NOT EXISTS selected_vendor_ids jsonb;

COMMENT ON COLUMN public.purchase_requests.selected_vendor_ids IS
  'RFQ fan-out intent: JSON array of stakeholders.stakeholder_id picked to quote, '
  'set by the WhatsApp rfq_pick_vendors flow. NULL for direct/single-vendor PRs. '
  'Cold-vendor RFQ send (deferred) reads this list.';
