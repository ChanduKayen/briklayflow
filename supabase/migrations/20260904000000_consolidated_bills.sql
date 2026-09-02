-- ===========================================================================
-- Consolidated bills — one vendor bill that covers a period's payments that
-- never got their own bill ("paid without bills"). It cleans the books: the
-- covered payments become billed, and the figure goes on the ledger + statement.
-- A payment is "covered" when it's an un-PO'd vendor payment inside [from, to].
-- doc_type records what backs the figure (a real bill / a kacha note / nothing).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.consolidated_bills (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  stakeholder_id text NOT NULL REFERENCES public.stakeholders(stakeholder_id) ON DELETE CASCADE,
  period_from    date NOT NULL,
  period_to      date NOT NULL,
  amount         numeric NOT NULL CHECK (amount >= 0),
  doc_type       text NOT NULL DEFAULT 'none' CHECK (doc_type IN ('vendor','kacha','none')),
  note           text,
  photo_url      text,
  confirmed      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  CHECK (period_to >= period_from)
);
ALTER TABLE public.consolidated_bills ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.consolidated_bills
  FOR ALL USING (org_id IN (SELECT public.get_my_org_ids())) WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER consolidated_bills_touch BEFORE UPDATE ON public.consolidated_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX consolidated_bills_party_idx ON public.consolidated_bills(org_id, stakeholder_id);
