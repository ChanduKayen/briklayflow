-- Custom per-unit display names (smart unit naming). Maps floor label → array of unit names by
-- index, e.g. {"Ground":["101","102"],"First":["201","202"]}. DISPLAY-ONLY: the engine keeps its
-- stable "Unit A" keys, so node_keys / materialized rows / status are unaffected; the UI overlays
-- these labels. Empty = the default "Unit A / B …" naming.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS unit_labels jsonb NOT NULL DEFAULT '{}';
