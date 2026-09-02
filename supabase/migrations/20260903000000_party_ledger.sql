-- ===========================================================================
-- Party ledger extras — the two things the redesigned party page needs that the
-- ledger can't derive from transactions/attendance:
--   • stakeholder_opening_balances : where your old books left off for a party
--     (as-of date, direction, total, optional per-site split, a note/photo).
--   • party_adjustments            : manual credit/debit notes against a party
--     (a waiver, a damage deduction, a correction) — appear as ledger rows.
-- Org-scoped, standard "org member access" + tg_touch_updated_at.
-- ===========================================================================

-- One opening balance per party. by_site splits the total across projects (jsonb
-- { project_id: amount }); empty = a single whole-party opening. direction says which
-- way it runs: 'paid_ahead' (we've paid more than certified) | 'work_owed' (we owe them).
CREATE TABLE IF NOT EXISTS public.stakeholder_opening_balances (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  stakeholder_id text NOT NULL REFERENCES public.stakeholders(stakeholder_id) ON DELETE CASCADE,
  as_of          date NOT NULL,
  direction      text NOT NULL DEFAULT 'paid_ahead' CHECK (direction IN ('paid_ahead','work_owed')),
  total_amount   numeric NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  by_site        jsonb NOT NULL DEFAULT '{}'::jsonb,
  note           text,
  photo_url      text,
  confirmed      boolean NOT NULL DEFAULT false,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.stakeholder_opening_balances ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.stakeholder_opening_balances
  FOR ALL USING (org_id IN (SELECT public.get_my_org_ids())) WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER stakeholder_opening_balances_touch BEFORE UPDATE ON public.stakeholder_opening_balances
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE UNIQUE INDEX stakeholder_opening_balances_party_idx ON public.stakeholder_opening_balances(org_id, stakeholder_id);

-- Manual adjustments. side='paid' behaves like a payment (raises "paid ahead");
-- side='certified' behaves like certified work (lowers it). project_id optional.
CREATE TABLE IF NOT EXISTS public.party_adjustments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  stakeholder_id text NOT NULL REFERENCES public.stakeholders(stakeholder_id) ON DELETE CASCADE,
  project_id     text REFERENCES public.projects(project_id) ON DELETE SET NULL,
  adj_date       date NOT NULL DEFAULT current_date,
  side           text NOT NULL CHECK (side IN ('paid','certified')),
  amount         numeric NOT NULL CHECK (amount >= 0),
  note           text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.party_adjustments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.party_adjustments
  FOR ALL USING (org_id IN (SELECT public.get_my_org_ids())) WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER party_adjustments_touch BEFORE UPDATE ON public.party_adjustments
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
CREATE INDEX party_adjustments_party_idx ON public.party_adjustments(org_id, stakeholder_id);
