-- ===========================================================================
-- Recurring / fixed payments — the standing lines a weekly run always includes
-- (watchman, office rent, a utility, a supervisor's weekly). They surface as
-- pay-rows on the Payments page each week; paying one records a real transaction
-- exactly like any other row. Org-scoped with the standard policy + trigger.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.recurring_payments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id     text NOT NULL REFERENCES public.projects(project_id) ON DELETE CASCADE,
  stakeholder_id text REFERENCES public.stakeholders(stakeholder_id) ON DELETE SET NULL,  -- null = a non-party line (e.g. a utility)
  party_name     text NOT NULL,                          -- display name
  label          text,                                   -- what it's for (rent, watchman, …)
  amount         numeric NOT NULL DEFAULT 0 CHECK (amount >= 0),
  cadence        text NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('weekly','monthly')),
  category       text NOT NULL DEFAULT 'Recurring',
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.recurring_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.recurring_payments
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER recurring_payments_touch BEFORE UPDATE ON public.recurring_payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX recurring_payments_org_idx     ON public.recurring_payments(org_id) WHERE active;
CREATE INDEX recurring_payments_project_idx ON public.recurring_payments(project_id);
