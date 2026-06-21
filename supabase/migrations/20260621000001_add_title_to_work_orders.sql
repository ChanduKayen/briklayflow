-- A short, human-friendly contract name (LLM-generated header) distinct from the
-- detailed scope_of_work. Nullable: existing WOs and WOs created elsewhere keep
-- using scope_of_work as their name; the contract hub sets this for new contracts.
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS title text;
