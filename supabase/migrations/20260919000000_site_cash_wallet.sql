-- ===========================================================================
-- Site-Cash Wallet — PHASE 1: foundation (see docs/site-cash-wallet-spec.md).
--
-- A wallet is a supervisor's cash-in-hand: an ASSET account, not an expense.
-- Giving cash MOVES money (bank → wallet); it becomes cost only when spent.
-- Balances are DERIVED from transaction rows; nothing stores a mutable balance.
--
-- This migration is ADDITIVE ONLY and changes NO existing behaviour:
--   • new `wallets` table (one per team-member holder)
--   • three nullable/defaulted columns on `transactions` — existing rows and every
--     current write path keep wallet_id NULL / is_transfer FALSE, i.e. exactly a
--     plain bank/cash payment as today.
--   • two derived views (balance + cash-book ledger).
-- Money follows the existing convention: numeric rupees (NOT paise), same as
-- transactions.total_amount, so no representation conflict.
-- ===========================================================================

-- ── wallets — one per team member (the holder) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wallets (
  wallet_id      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  holder_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,  -- the member who holds the cash
  holder_name    text NOT NULL,                                      -- snapshot for display
  holder_phone   text,                                               -- resolves a WhatsApp sender → wallet
  active         boolean NOT NULL DEFAULT true,
  note           text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.wallets ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.wallets
  FOR ALL USING (org_id IN (SELECT public.get_my_org_ids())) WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));
CREATE TRIGGER wallets_touch BEFORE UPDATE ON public.wallets
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
-- One wallet per member per org (holder_user_id may be NULL for a phone-only holder).
CREATE UNIQUE INDEX wallets_holder_uidx ON public.wallets(org_id, holder_user_id) WHERE holder_user_id IS NOT NULL;
CREATE INDEX wallets_org_idx   ON public.wallets(org_id);
CREATE INDEX wallets_phone_idx ON public.wallets(org_id, holder_phone) WHERE holder_phone IS NOT NULL;

-- ── transactions — the wallet dimension (additive, behaviour-preserving) ──────
-- wallet_id   : the wallet a row touches (NULL = an ordinary bank/cash payment, as today).
-- wallet_dir  : 'in'  = money INTO the wallet (a float issue), 'out' = money OUT (a spend or a return).
-- is_transfer : TRUE for a movement that is NOT an expense (float issue, return, handover) — excluded
--               from every cost/P&L rollup. FALSE (default) = a real spend, exactly like today.
ALTER TABLE public.transactions
  ADD COLUMN IF NOT EXISTS wallet_id   uuid REFERENCES public.wallets(wallet_id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS wallet_dir  text CHECK (wallet_dir IN ('in','out')),
  ADD COLUMN IF NOT EXISTS is_transfer boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS transactions_wallet_idx ON public.transactions(wallet_id) WHERE wallet_id IS NOT NULL;

-- ── v_wallet_balance — cash still in each holder's hands (DERIVED) ────────────
-- balance = Σ(money in) − Σ(money out), over non-voided rows. Never stored.
CREATE OR REPLACE VIEW public.v_wallet_balance
WITH (security_invoker = true) AS
SELECT w.wallet_id, w.org_id, w.holder_name, w.holder_user_id, w.active,
       COALESCE(SUM(CASE WHEN t.wallet_dir = 'in'  THEN t.total_amount
                         WHEN t.wallet_dir = 'out' THEN -t.total_amount ELSE 0 END), 0)::numeric AS balance,
       COALESCE(SUM(CASE WHEN t.wallet_dir = 'in'  THEN t.total_amount ELSE 0 END), 0)::numeric AS total_in,
       COALESCE(SUM(CASE WHEN t.wallet_dir = 'out' THEN t.total_amount ELSE 0 END), 0)::numeric AS total_out,
       MAX(t.date) AS last_activity
  FROM public.wallets w
  LEFT JOIN public.transactions t
    ON t.wallet_id = w.wallet_id AND t.status IS DISTINCT FROM 'Voided'
 GROUP BY w.wallet_id, w.org_id, w.holder_name, w.holder_user_id, w.active;
GRANT SELECT ON public.v_wallet_balance TO authenticated;

-- ── v_wallet_ledger_line — the cash book: one row per wallet entry ────────────
-- kind: 'float' (in) | 'return' (out, transfer) | 'spend' (out, expense). Debit/credit are the
-- cash-book sense: money IN is a debit to the wallet asset, money OUT a credit.
CREATE OR REPLACE VIEW public.v_wallet_ledger_line
WITH (security_invoker = true) AS
SELECT t.wallet_id, t.org_id, t.txn_id, t.date AS line_date,
       CASE WHEN t.wallet_dir = 'in' THEN 'float'
            WHEN t.is_transfer      THEN 'return'
            ELSE 'spend' END AS kind,
       t.category, t.remarks, t.stakeholder_id,
       (SELECT ta.project_id FROM public.txn_allocations ta WHERE ta.txn_id = t.txn_id ORDER BY ta.allocated_amount DESC NULLS LAST LIMIT 1) AS project_id,
       CASE WHEN t.wallet_dir = 'in'  THEN t.total_amount ELSE 0 END AS debit,   -- money into the wallet
       CASE WHEN t.wallet_dir = 'out' THEN t.total_amount ELSE 0 END AS credit,  -- money out of the wallet
       t.status
  FROM public.transactions t
 WHERE t.wallet_id IS NOT NULL AND t.status IS DISTINCT FROM 'Voided';
GRANT SELECT ON public.v_wallet_ledger_line TO authenticated;

-- ── pass the wallet dimension through the txn-insert RPC (ADDITIVE) ───────────
-- Identical to 20260830000004 EXCEPT the INSERT now also reads wallet_id / wallet_dir /
-- is_transfer from p_txn. Callers that don't send them get NULL / NULL / false — i.e. a
-- plain bank/cash payment, exactly as before. No signature change, no guard change.
create or replace function public.insert_transaction_with_allocations(p_txn jsonb, p_allocations jsonb)
returns jsonb language plpgsql security definer as $function$
declare
  v_txn_id text;
  v_org_id uuid;
  v_alloc  jsonb;
begin
  v_org_id := (p_txn->>'org_id')::uuid;

  if v_org_id not in (select public.get_my_org_ids()) then
    raise exception 'Access denied: not a member of that org';
  end if;
  if not public.has_role_in_org(v_org_id, variadic array['accountant'::text,'management'::text,'principal'::text]) then
    raise exception 'Access denied: your role may not record money';
  end if;

  insert into public.transactions (
    txn_id, stakeholder_id, date, total_amount, payment_mode,
    category, remarks, bill_doc_url, proof_document_url,
    ai_flag_status, ai_flag_data, entered_by, org_id,
    wallet_id, wallet_dir, is_transfer
  ) values (
    p_txn->>'txn_id', p_txn->>'stakeholder_id', (p_txn->>'date')::date,
    (p_txn->>'total_amount')::numeric, (p_txn->>'payment_mode')::public.payment_mode,
    p_txn->>'category', p_txn->>'remarks', p_txn->>'bill_doc_url', p_txn->>'proof_document_url',
    (p_txn->>'ai_flag_status')::public.ai_flag_status, coalesce(p_txn->'ai_flag_data', '{}'::jsonb),
    auth.uid(), v_org_id,
    nullif(p_txn->>'wallet_id','')::uuid, nullif(p_txn->>'wallet_dir',''),
    coalesce((p_txn->>'is_transfer')::boolean, false)
  ) returning txn_id into v_txn_id;

  for v_alloc in select * from jsonb_array_elements(p_allocations)
  loop
    insert into public.txn_allocations (
      txn_id, project_id, order_type, order_ref, milestone_id, allocated_amount, org_id
    ) values (
      v_txn_id, v_alloc->>'project_id',
      nullif(v_alloc->>'order_type', '')::public.order_type_enum,
      nullif(v_alloc->>'order_ref', ''), nullif(v_alloc->>'milestone_id', '')::uuid,
      (v_alloc->>'allocated_amount')::numeric, v_org_id
    );
  end loop;

  return jsonb_build_object('success', true, 'txn_id', v_txn_id);
end;
$function$;

NOTIFY pgrst, 'reload schema';
