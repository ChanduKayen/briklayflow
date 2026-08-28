-- Photo proof for a goods receipt (GRN). Each entry: { url, taken_at, stale } — taken_at is the
-- photo's own capture date (from EXIF, or the file's modified date as a fallback); stale = true when
-- that date is BEFORE the PO was raised, which is worth a second look (an old photo reused as proof).
ALTER TABLE public.po_grn
  ADD COLUMN IF NOT EXISTS receipt_photos jsonb NOT NULL DEFAULT '[]'::jsonb;
