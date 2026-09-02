-- ===========================================================================
-- The Allocation Ledger — projection (INV-12 / INV-13). Project-on-write, at the table layer.
--
-- A per-party cache of the derived figures (to_pay / advance / unclassified_ahead / without_bills /
-- net), recomputed from scratch for the one affected party on every ledger write — including the
-- WhatsApp webhook and every other surface, because it's a trigger, not app politeness (Resolution D).
--
-- TWO safety rules, because triggers sit on the hot `transactions` table used by EVERY org:
--   1. Flag-gated: for an org that hasn't cut over, recompute returns immediately (and clears any
--      stale projection row). Off-orgs pay only a cheap flag lookup.
--   2. Error-isolated: each trigger swallows any exception, so a projection bug can NEVER roll back
--      a payment insert. Drift is repaired by re-running the recompute (the nightly consistency check).
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.ledger_projection (
  stakeholder_id      text PRIMARY KEY REFERENCES public.stakeholders(stakeholder_id) ON DELETE CASCADE,
  org_id              uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  to_pay              numeric NOT NULL DEFAULT 0,
  advance             numeric NOT NULL DEFAULT 0,
  unclassified_ahead  numeric NOT NULL DEFAULT 0,
  without_bills       numeric NOT NULL DEFAULT 0,
  net                 numeric NOT NULL DEFAULT 0,
  updated_at          timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ledger_projection ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.ledger_projection
  FOR ALL USING (org_id IN (SELECT public.get_my_org_ids())) WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE INDEX ledger_projection_org_idx ON public.ledger_projection(org_id);

-- ── recompute one party from scratch (mirrors ledgerDerive/readParty) ────────
CREATE OR REPLACE FUNCTION public.fn_recompute_party(p_stakeholder text)
RETURNS void LANGUAGE plpgsql AS $$
DECLARE
  v_org uuid; v_enabled boolean;
  v_total_paid numeric; v_credits_total numeric; v_open_credits numeric; v_unalloc numeric;
  v_advance numeric; v_without numeric; v_corr numeric;
  v_dir text; v_optotal numeric; v_has_opening_credit boolean; v_adjp numeric;
  v_topay numeric; v_ahead numeric; v_net numeric;
BEGIN
  SELECT org_id INTO v_org FROM public.stakeholders WHERE stakeholder_id = p_stakeholder;
  IF v_org IS NULL THEN RETURN; END IF;
  SELECT new_ledger_enabled INTO v_enabled FROM public.organizations WHERE org_id = v_org;
  IF NOT COALESCE(v_enabled, false) THEN
    DELETE FROM public.ledger_projection WHERE stakeholder_id = p_stakeholder;   -- clear stale
    RETURN;
  END IF;

  SELECT COALESCE(sum(total_amount), 0) INTO v_total_paid
    FROM public.transactions WHERE stakeholder_id = p_stakeholder AND status IS DISTINCT FROM 'Voided';

  SELECT COALESCE(sum(GREATEST(0, t.total_amount - COALESCE(al.a, 0))), 0),
         COALESCE(sum(CASE WHEN COALESCE(al.a, 0) < 0.005 THEN t.total_amount ELSE 0 END), 0)
    INTO v_unalloc, v_without
    FROM public.transactions t
    LEFT JOIN (SELECT payment_id, sum(amount) a FROM public.ledger_allocations GROUP BY payment_id) al ON al.payment_id = t.txn_id
   WHERE t.stakeholder_id = p_stakeholder AND t.status IS DISTINCT FROM 'Voided';

  SELECT COALESCE(sum(amount), 0) INTO v_credits_total FROM public.ledger_credits WHERE stakeholder_id = p_stakeholder;
  SELECT COALESCE(sum(GREATEST(0, c.amount - COALESCE(al.a, 0))), 0) INTO v_open_credits
    FROM public.ledger_credits c
    LEFT JOIN (SELECT credit_id, sum(amount) a FROM public.ledger_allocations GROUP BY credit_id) al ON al.credit_id = c.credit_id
   WHERE c.stakeholder_id = p_stakeholder;

  SELECT COALESCE(sum(a.amount), 0) INTO v_advance
    FROM public.ledger_allocations a JOIN public.transactions t ON t.txn_id = a.payment_id
   WHERE t.stakeholder_id = p_stakeholder AND a.target_kind = 'pool';

  SELECT direction, total_amount INTO v_dir, v_optotal FROM public.stakeholder_opening_balances WHERE stakeholder_id = p_stakeholder;
  SELECT COALESCE(sum(amount), 0) INTO v_adjp FROM public.party_adjustments WHERE stakeholder_id = p_stakeholder AND side = 'paid';
  v_corr := COALESCE(CASE WHEN v_dir = 'paid_ahead' THEN v_optotal ELSE 0 END, 0) + COALESCE(v_adjp, 0);
  SELECT EXISTS(SELECT 1 FROM public.ledger_credits WHERE stakeholder_id = p_stakeholder AND kind = 'opening') INTO v_has_opening_credit;
  IF v_dir = 'work_owed' AND NOT v_has_opening_credit THEN v_open_credits := v_open_credits + COALESCE(v_optotal, 0); END IF;

  v_unalloc := v_unalloc + v_corr;
  v_topay := GREATEST(0, v_open_credits - v_unalloc);
  v_ahead := GREATEST(0, v_unalloc - v_open_credits);
  v_net   := v_total_paid + v_corr - v_credits_total;

  INSERT INTO public.ledger_projection(stakeholder_id, org_id, to_pay, advance, unclassified_ahead, without_bills, net, updated_at)
  VALUES (p_stakeholder, v_org, v_topay, v_advance, v_ahead, v_without, v_net, now())
  ON CONFLICT (stakeholder_id) DO UPDATE SET
    org_id = EXCLUDED.org_id, to_pay = EXCLUDED.to_pay, advance = EXCLUDED.advance,
    unclassified_ahead = EXCLUDED.unclassified_ahead, without_bills = EXCLUDED.without_bills, net = EXCLUDED.net, updated_at = now();
END $$;

-- ── trigger shims (each swallows errors: a projection fault never breaks the DML) ──
CREATE OR REPLACE FUNCTION public.tg_ledgerproj_credit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN BEGIN PERFORM public.fn_recompute_party(COALESCE(NEW.stakeholder_id, OLD.stakeholder_id)); EXCEPTION WHEN OTHERS THEN NULL; END; RETURN COALESCE(NEW, OLD); END $$;
CREATE OR REPLACE FUNCTION public.tg_ledgerproj_alloc() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v_stk text; BEGIN
  SELECT stakeholder_id INTO v_stk FROM public.transactions WHERE txn_id = COALESCE(NEW.payment_id, OLD.payment_id);
  IF v_stk IS NOT NULL THEN BEGIN PERFORM public.fn_recompute_party(v_stk); EXCEPTION WHEN OTHERS THEN NULL; END; END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE OR REPLACE FUNCTION public.tg_ledgerproj_txn() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF COALESCE(NEW.stakeholder_id, OLD.stakeholder_id) IS NOT NULL THEN
    BEGIN PERFORM public.fn_recompute_party(COALESCE(NEW.stakeholder_id, OLD.stakeholder_id)); EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE OR REPLACE FUNCTION public.tg_ledgerproj_corr() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN BEGIN PERFORM public.fn_recompute_party(COALESCE(NEW.stakeholder_id, OLD.stakeholder_id)); EXCEPTION WHEN OTHERS THEN NULL; END; RETURN COALESCE(NEW, OLD); END $$;

CREATE TRIGGER ledgerproj_credit AFTER INSERT OR UPDATE OR DELETE ON public.ledger_credits     FOR EACH ROW EXECUTE FUNCTION public.tg_ledgerproj_credit();
CREATE TRIGGER ledgerproj_alloc  AFTER INSERT OR UPDATE OR DELETE ON public.ledger_allocations FOR EACH ROW EXECUTE FUNCTION public.tg_ledgerproj_alloc();
CREATE TRIGGER ledgerproj_txn    AFTER INSERT OR DELETE ON public.transactions                 FOR EACH ROW EXECUTE FUNCTION public.tg_ledgerproj_txn();
CREATE TRIGGER ledgerproj_txn_u  AFTER UPDATE OF total_amount, status, stakeholder_id ON public.transactions FOR EACH ROW EXECUTE FUNCTION public.tg_ledgerproj_txn();
CREATE TRIGGER ledgerproj_ob     AFTER INSERT OR UPDATE OR DELETE ON public.stakeholder_opening_balances FOR EACH ROW EXECUTE FUNCTION public.tg_ledgerproj_corr();
CREATE TRIGGER ledgerproj_adj    AFTER INSERT OR UPDATE OR DELETE ON public.party_adjustments  FOR EACH ROW EXECUTE FUNCTION public.tg_ledgerproj_corr();
