-- Make trigger_condition nullable with a default so existing NOT NULL
-- constraint does not block WO milestone inserts.

ALTER TABLE public.wo_milestones
  ALTER COLUMN trigger_condition DROP NOT NULL;

ALTER TABLE public.wo_milestones
  ALTER COLUMN trigger_condition SET DEFAULT 'NONE';

UPDATE public.wo_milestones
SET trigger_condition = 'NONE'
WHERE trigger_condition IS NULL;
