-- Make transactions.category optional.
--
-- The Day Book quick-file path posts a transaction straight from the reviewed
-- capture. The AI does not always extract a cost code, and forcing the owner to
-- pick one just to log a payment is the wrong friction — a category can be added
-- later from the Ledger. Drop the NOT NULL so a category-less entry can file.
--
-- (Older rows already carry a category; this only relaxes the constraint.)
ALTER TABLE public.transactions ALTER COLUMN category DROP NOT NULL;
