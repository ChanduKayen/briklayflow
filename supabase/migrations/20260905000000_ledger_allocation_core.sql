-- ===========================================================================
-- The Allocation Ledger — Phase 1 core (schema only; no UI, no live writes yet).
--
-- Replaces the netted "paid − certified" model with explicit allocations. Two
-- new tables sit ALONGSIDE the existing txn_allocations (which stays as-is):
--
--   ledger_credits      — a credit is now a first-class dated row, not a figure
--                         computed on the fly. Every credit-creating event of
--                         principle §2 lands here.
--   ledger_allocations  — binds a payment (a transaction, the debit) to what it
--                         settles: a specific credit, or a contract advance pool.
--                         Many-to-many, partial allowed (§1.3).
--
-- Derived states (to pay / advance / ahead / paid-without-bills) are queries over
-- these rows — never stored flags. Invariants INV-2 / INV-3 are enforced here at
-- the table layer by trigger, not left to app politeness (Resolution D).
--
-- Nothing reads or writes these tables from the UI yet. Phase 1 backfills them and
-- diffs the derivation against today's netting (the parity gate) before anything
-- a user sees changes.
-- ===========================================================================

-- ── Credits — every §2 credit-creating event ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.ledger_credits (
  credit_id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  stakeholder_id  text NOT NULL REFERENCES public.stakeholders(stakeholder_id) ON DELETE CASCADE,
  project_id      text REFERENCES public.projects(project_id) ON DELETE SET NULL,  -- PRJ-… slug; NULL = explicit "no site"
  -- which §2 event minted this credit
  kind            text NOT NULL CHECK (kind IN (
                    'vendor_bill',   -- 2.1
                    'consolidated',  -- 2.2
                    'plan',          -- 2.3  weekly plan accrual
                    'certified',     -- 2.4  measured contract stage
                    'self_settle',   -- 2.5  "work done / goods received, no bill"
                    'opening',       -- 2.6
                    'adjustment'     -- 3.3  (certified-side correction)
                  )),
  amount          numeric NOT NULL CHECK (amount >= 0),
  entry_date      date NOT NULL,
  -- provenance (§8.2): who/what created it
  source          text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual','plan','attendance','import','whatsapp','backfill','cutover')),
  -- contract linkage for certified stages / bills against an order
  contract_ref    text,              -- wo_id or po_id
  milestone_id    uuid,              -- certified stage
  -- §2.5 self-settled credits are CHILDREN of their payment (INV-6): void cascades
  parent_payment_id text REFERENCES public.transactions(txn_id) ON DELETE CASCADE,
  -- §7.5 documentation quality: vendor-side credits carry what backs them
  doc_flag        text CHECK (doc_flag IN ('vendor','kacha','none')),
  note            text,
  confirmed       boolean NOT NULL DEFAULT false,   -- party-confirmed (opening, consolidated, settlements)
  legacy          boolean NOT NULL DEFAULT false,   -- frozen historical row from the cutover (§7 / Res. A)
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- a self-settled credit's amount is fixed by its payment; only self_settle may carry a parent
  CHECK (parent_payment_id IS NULL OR kind = 'self_settle')
);

-- ── Allocations — payment (debit) → credit, or → a contract advance pool ────
CREATE TABLE IF NOT EXISTS public.ledger_allocations (
  allocation_id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  payment_id      text NOT NULL REFERENCES public.transactions(txn_id) ON DELETE CASCADE,  -- the debit
  target_kind     text NOT NULL CHECK (target_kind IN ('credit','pool')),
  credit_id       uuid REFERENCES public.ledger_credits(credit_id) ON DELETE CASCADE,      -- when target_kind='credit'
  contract_ref    text,               -- the pool key (wo_id / po_id) when target_kind='pool' (§3.2)
  project_id      text REFERENCES public.projects(project_id) ON DELETE SET NULL,  -- PRJ-… slug
  amount          numeric NOT NULL CHECK (amount > 0),
  source          text NOT NULL DEFAULT 'manual'
                    CHECK (source IN ('manual','plan','attendance','import','whatsapp','backfill','cutover')),
  created_by      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  -- exactly one target shape: a credit XOR a pool
  CHECK (
    (target_kind = 'credit' AND credit_id IS NOT NULL AND contract_ref IS NULL) OR
    (target_kind = 'pool'   AND contract_ref IS NOT NULL AND credit_id IS NULL)
  )
);

-- ── INV-2 / INV-3 enforcement (Resolution D: at the table, not the app) ─────
-- INV-2  Σ allocations of a payment ≤ the payment amount   (no over-payment)
-- INV-3  Σ allocations against a credit ≤ the credit amount (no over-settlement)
-- AFTER trigger so the just-written row is included in the sums; a violation
-- raises and rolls back the whole statement.
CREATE OR REPLACE FUNCTION public.fn_ledger_alloc_guard()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  v_payment   text  := COALESCE(NEW.payment_id, OLD.payment_id);
  v_credit    uuid  := COALESCE(NEW.credit_id, OLD.credit_id);
  v_pay_total numeric;
  v_credit_amt numeric;
  v_sum       numeric;
BEGIN
  -- INV-2
  SELECT total_amount INTO v_pay_total FROM public.transactions WHERE txn_id = v_payment;
  SELECT COALESCE(sum(amount),0) INTO v_sum FROM public.ledger_allocations WHERE payment_id = v_payment;
  IF v_pay_total IS NOT NULL AND v_sum > v_pay_total + 0.005 THEN
    RAISE EXCEPTION 'INV-2: allocations of payment % (%) exceed the payment (%)', v_payment, v_sum, v_pay_total;
  END IF;
  -- INV-3
  IF v_credit IS NOT NULL THEN
    SELECT amount INTO v_credit_amt FROM public.ledger_credits WHERE credit_id = v_credit;
    SELECT COALESCE(sum(amount),0) INTO v_sum FROM public.ledger_allocations WHERE credit_id = v_credit;
    IF v_credit_amt IS NOT NULL AND v_sum > v_credit_amt + 0.005 THEN
      RAISE EXCEPTION 'INV-3: allocations against credit % (%) exceed it (%)', v_credit, v_sum, v_credit_amt;
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

CREATE TRIGGER ledger_alloc_guard
  AFTER INSERT OR UPDATE OR DELETE ON public.ledger_allocations
  FOR EACH ROW EXECUTE FUNCTION public.fn_ledger_alloc_guard();

-- ── updated_at touch ───────────────────────────────────────────────────────
CREATE TRIGGER ledger_credits_touch BEFORE UPDATE ON public.ledger_credits
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

-- ── RLS — org-scoped, same policy as every other table ─────────────────────
ALTER TABLE public.ledger_credits     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ledger_allocations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.ledger_credits
  FOR ALL USING (org_id IN (SELECT public.get_my_org_ids())) WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE POLICY "org member access" ON public.ledger_allocations
  FOR ALL USING (org_id IN (SELECT public.get_my_org_ids())) WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

-- ── Indexes — the read paths the derivation walks ──────────────────────────
CREATE INDEX ledger_credits_party_idx  ON public.ledger_credits(org_id, stakeholder_id, project_id);
CREATE INDEX ledger_credits_parent_idx ON public.ledger_credits(parent_payment_id) WHERE parent_payment_id IS NOT NULL;
CREATE INDEX ledger_credits_contract_idx ON public.ledger_credits(contract_ref) WHERE contract_ref IS NOT NULL;
CREATE INDEX ledger_alloc_payment_idx  ON public.ledger_allocations(payment_id);
CREATE INDEX ledger_alloc_credit_idx   ON public.ledger_allocations(credit_id) WHERE credit_id IS NOT NULL;
CREATE INDEX ledger_alloc_pool_idx     ON public.ledger_allocations(org_id, contract_ref) WHERE contract_ref IS NOT NULL;

-- Note: the per-party×site PROJECTION (INV-12) and its maintenance trigger land in
-- Phase 2, when the first live writes appear. Phase 1 runs the derivation live to
-- diff against today's netting (the parity gate); there is nothing to project yet.
