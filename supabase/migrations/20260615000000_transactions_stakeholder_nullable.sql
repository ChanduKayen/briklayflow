-- General expenses have no party. The Day Book "General expense" path files a
-- transaction with stakeholder_id = NULL, which the NOT NULL constraint rejected
-- (23502). Drop NOT NULL — the existing FK already permits NULL, so a payee-less
-- transaction is allowed while a present value still has to reference a real party.
ALTER TABLE public.transactions ALTER COLUMN stakeholder_id DROP NOT NULL;
