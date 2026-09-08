-- Bill identity is the DOCUMENT, not the party row it got linked to.
--
-- A bill genuinely arrives through two doors (site engineer WhatsApps the photo; you attach the same
-- paper to a PO) and the two doors can resolve DIFFERENT vendor rows for the same paper — a fat-finger
-- link, a near-duplicate vendor, an unmatched name. The old dedupe was scoped to one stakeholder_id, so
-- those two never got compared and both minted. Two fixes:
--
--   1. Persist the vendor NAME as printed on the bill (bills.vendor_name) — the header is a stable part
--      of the document's fingerprint, independent of which party we linked it to.
--   2. Dedupe org-wide (not per-vendor). New indexes support the org-wide lookup by number and by
--      amount+date.
ALTER TABLE public.bills ADD COLUMN IF NOT EXISTS vendor_name text;

-- Backfill the printed name from the linked stakeholder for existing rows, so the header signal has
-- something to match on until the doors start storing the read name.
UPDATE public.bills b
   SET vendor_name = s.name
  FROM public.stakeholders s
 WHERE b.vendor_name IS NULL AND s.stakeholder_id = b.stakeholder_id;

-- Org-wide duplicate lookup surfaces (NOT unique — a genuine re-bill can share a number; the UI warns
-- before minting and lets the user proceed deliberately).
CREATE INDEX IF NOT EXISTS bills_org_no_idx   ON public.bills(org_id, lower(bill_no));
CREATE INDEX IF NOT EXISTS bills_org_amt_idx  ON public.bills(org_id, amount, bill_date);
