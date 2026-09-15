-- ===========================================================================
-- My Wallet — the HOLDER's own view (/mywallet), correct for ANY role.
--
-- Why an RPC and not the v_wallet_balance / v_wallet_ledger_line views:
-- those views are security_invoker, so they only sum the transaction rows the
-- CALLER can read. A supervisor (or a phone teammate whose org link is thin)
-- can end up seeing the wallet row but not its float/spend rows — so the
-- balance reads ₹0 and the cash book looks empty, even though the money is real.
--
-- These two SECURITY DEFINER functions compute over ALL of the caller's own
-- wallet rows, scoped strictly to `holder_user_id = auth.uid()` (and, for the
-- ledger, an ownership EXISTS check). A definer bypasses RLS, but it can only
-- ever return the caller's OWN wallet — never anyone else's — so there is no
-- leak. Managers keep using the views/RLS path in the wallet rail unchanged.
-- ===========================================================================

-- The caller's own wallets with DERIVED balances (mirrors v_wallet_balance's math).
create or replace function public.my_wallets()
returns table (
  wallet_id     uuid,
  org_id        uuid,
  holder_name   text,
  active        boolean,
  balance       numeric,
  total_in      numeric,
  total_out     numeric,
  last_activity date
)
language sql
security definer
stable
set search_path = public
as $function$
  select
    w.wallet_id, w.org_id, w.holder_name, w.active,
    coalesce(sum(case when t.wallet_dir = 'in'  then t.total_amount
                      when t.wallet_dir = 'out' then -t.total_amount else 0 end), 0)::numeric as balance,
    coalesce(sum(case when t.wallet_dir = 'in'  then t.total_amount else 0 end), 0)::numeric as total_in,
    coalesce(sum(case when t.wallet_dir = 'out' then t.total_amount else 0 end), 0)::numeric as total_out,
    max(t.date) as last_activity
  from public.wallets w
  left join public.transactions t
    on t.wallet_id = w.wallet_id and t.status is distinct from 'Voided'
  where w.holder_user_id = auth.uid()
    and w.active
  group by w.wallet_id, w.org_id, w.holder_name, w.active
  order by w.holder_name;
$function$;

revoke all     on function public.my_wallets() from public, anon;
grant  execute on function public.my_wallets() to authenticated;

-- The caller's own wallet cash book (mirrors v_wallet_ledger_line), but only for a
-- wallet they actually hold — the EXISTS guard makes p_wallet un-spoofable.
create or replace function public.my_wallet_ledger(p_wallet uuid)
returns table (
  txn_id         text,
  line_date      date,
  kind           text,
  category       text,
  remarks        text,
  stakeholder_id text,
  project_id     uuid,
  debit          numeric,
  credit         numeric
)
language sql
security definer
stable
set search_path = public
as $function$
  select
    t.txn_id, t.date as line_date,
    case when t.wallet_dir = 'in' then 'float'
         when t.is_transfer      then 'return'
         else 'spend' end as kind,
    t.category, t.remarks, t.stakeholder_id,
    (select ta.project_id from public.txn_allocations ta
      where ta.txn_id = t.txn_id order by ta.allocated_amount desc nulls last limit 1) as project_id,
    case when t.wallet_dir = 'in'  then t.total_amount else 0 end as debit,
    case when t.wallet_dir = 'out' then t.total_amount else 0 end as credit
  from public.transactions t
  where t.wallet_id = p_wallet
    and t.status is distinct from 'Voided'
    and exists (select 1 from public.wallets w
                 where w.wallet_id = p_wallet and w.holder_user_id = auth.uid())
  order by t.date desc, t.txn_id desc;
$function$;

revoke all     on function public.my_wallet_ledger(uuid) from public, anon;
grant  execute on function public.my_wallet_ledger(uuid) to authenticated;

NOTIFY pgrst, 'reload schema';
