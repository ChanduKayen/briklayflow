-- The Day Book's Filed and "Not a transaction" tabs should sort by WHEN an entry was
-- filed / binned, not by message arrival (created_at). rough_entries had no such
-- timestamp, so add updated_at (touched on every update) and order the tabs by it.
ALTER TABLE public.rough_entries
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Seed existing rows so they aren't all "now".
UPDATE public.rough_entries SET updated_at = created_at WHERE updated_at IS NULL OR updated_at = now();

CREATE OR REPLACE FUNCTION public.touch_rough_entries_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS rough_entries_set_updated_at ON public.rough_entries;
CREATE TRIGGER rough_entries_set_updated_at
  BEFORE UPDATE ON public.rough_entries
  FOR EACH ROW EXECUTE FUNCTION public.touch_rough_entries_updated_at();
