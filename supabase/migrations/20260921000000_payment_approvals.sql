-- ===========================================================================
-- Weekly payment approvals — the middle stage of the run.
--
-- A weekly run is a pipeline: approve → pay → paid. The last stage has always
-- been real (a transaction stamped ai_flag_data.weekly_run + row_key); the first
-- two were the same thing, because "approved but not yet paid" had nowhere to
-- live. It lives here.
--
-- One row per (org, week, run row). The amount is what was agreed — which is not
-- always the computed figure, so it is stored rather than recomputed. Paying is
-- still the transaction; this table only says "this much, for this row, was
-- agreed, by whom, when". Deleting the row sends it back to Approve.
--
-- ADDITIVE ONLY: nothing reads it unless the Payables page asks, and a run with
-- no rows here behaves exactly as it does today.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.payment_approvals (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id           uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  week             date NOT NULL,                 -- the run's Monday
  row_key          text NOT NULL,                 -- PayRow.key — the same key the paid stamp uses
  amount           numeric NOT NULL,              -- what was agreed, not what was computed
  via              text,                          -- the mode chosen at approval, if one was
  party_name       text,                          -- a snapshot, so a settled week still reads
  approved_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by_name text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.payment_approvals ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.payment_approvals
  FOR ALL USING (org_id IN (SELECT public.get_my_org_ids())) WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER payment_approvals_touch BEFORE UPDATE ON public.payment_approvals
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- One approval per row per week: approving twice updates the agreed amount.
CREATE UNIQUE INDEX IF NOT EXISTS payment_approvals_row_uidx
  ON public.payment_approvals(org_id, week, row_key);
CREATE INDEX IF NOT EXISTS payment_approvals_week_idx
  ON public.payment_approvals(org_id, week);
