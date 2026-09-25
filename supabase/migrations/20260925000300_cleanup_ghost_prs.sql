-- ===========================================================================
-- One-off cleanup of GHOST purchase requests — draft, never promoted, with NO
-- items. These were created from a caption/context line ("glass panel materials",
-- "Chakradhar site") rather than an actual materials list, and show as empty
-- "0 items" cards in the review inbox. The staging guard now prevents new ones;
-- this clears the ones already on the books. (No items to cascade — there are none.)
-- Safe to re-run.
-- ===========================================================================

DELETE FROM public.purchase_requests pr
WHERE pr.status = 'draft'
  AND pr.converted_po_id IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.purchase_request_items i WHERE i.purchase_request_id = pr.id
  );
