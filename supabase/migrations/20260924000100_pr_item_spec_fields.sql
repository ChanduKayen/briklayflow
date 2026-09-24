-- ===========================================================================
-- Purchase request items — the facts a quote actually carries.
--
-- A purchase request that arrives as a photo of a supplier's quote is read line
-- by line, and an aluminium/glass quote (the case this was built against) says
-- far more per line than a name and a count: the opening's width × height in mm,
-- the glass or section specification, sometimes a brand. The request detail page
-- shows and edits exactly those, so they need somewhere to live — until now the
-- table held only item_name / quantity / unit / note and the rest was dropped on
-- the floor.
--
-- `source_line` keeps the raw line the reader saw, verbatim, so a disagreement
-- between the screen and the paper can always be settled against the paper.
-- `read_fields` records WHICH of them the reader supplied rather than a person:
-- the page marks those "from the quote", and clears the mark the moment a human
-- edits that field. It is a small jsonb of 0/1 flags keyed by field name, not a
-- second copy of the values.
-- ===========================================================================
ALTER TABLE public.purchase_request_items
  ADD COLUMN IF NOT EXISTS width_mm    numeric,
  ADD COLUMN IF NOT EXISTS height_mm   numeric,
  ADD COLUMN IF NOT EXISTS brand       text,
  ADD COLUMN IF NOT EXISTS spec        text,
  ADD COLUMN IF NOT EXISTS source_line text,
  ADD COLUMN IF NOT EXISTS read_fields jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.purchase_request_items.width_mm    IS 'Opening/section width in mm, as printed on the quote.';
COMMENT ON COLUMN public.purchase_request_items.height_mm   IS 'Opening/section height in mm, as printed on the quote.';
COMMENT ON COLUMN public.purchase_request_items.spec        IS 'The line''s specification, e.g. "8mm clear glass · BS 45 (FW3B)".';
COMMENT ON COLUMN public.purchase_request_items.source_line IS 'The quote line verbatim, as the reader saw it.';
COMMENT ON COLUMN public.purchase_request_items.read_fields IS 'Which fields came from the quote rather than a person: {"w":1,"spec":1}. Cleared per field on edit.';
