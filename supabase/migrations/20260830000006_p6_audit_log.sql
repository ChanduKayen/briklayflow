-- ─────────────────────────────────────────────────────────────────────────────
-- P6 · Audit trail
--
-- An append-only log of privileged actions, readable only by management/principal.
-- Coverage: transaction void + amend (trigger, so it's captured no matter which
-- path made the change) and member role changes (inside change_member_role).
-- PO approvals/rejections already land in po_approvals.
--
-- ROLLBACK:
--   drop trigger if exists audit_transaction_change on public.transactions;
--   drop function if exists public.audit_transaction_change();
--   drop function if exists public.log_audit(uuid,text,text,text,jsonb,text);
--   drop table if exists public.audit_log;
-- ─────────────────────────────────────────────────────────────────────────────

create table if not exists public.audit_log (
  id          bigint generated always as identity primary key,
  org_id      uuid not null,
  actor_id    uuid,
  action      text not null,      -- 'role_change' | 'txn_void' | 'txn_amend' | …
  target_type text,               -- 'member' | 'transaction' | …
  target_id   text,
  detail      jsonb not null default '{}'::jsonb,
  reason      text,
  at          timestamptz not null default now()
);
create index if not exists audit_log_org_at_idx on public.audit_log (org_id, at desc);

alter table public.audit_log enable row level security;

-- read: management/principal of the org · write: only through the SECURITY DEFINER
-- helpers below (no client insert policy exists, so RLS default-denies direct writes)
drop policy if exists "audit read admins" on public.audit_log;
create policy "audit read admins" on public.audit_log for select
  using (org_id in (select public.get_my_org_ids())
         and public.has_role_in_org(org_id, variadic array['management'::text,'principal'::text]));

grant select on public.audit_log to authenticated;

-- Generic writer (actor is always the caller — cannot be spoofed).
create or replace function public.log_audit(
  p_org uuid, p_action text, p_target_type text, p_target_id text,
  p_detail jsonb default '{}'::jsonb, p_reason text default null
) returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail, reason)
  values (p_org, auth.uid(), p_action, p_target_type, p_target_id, coalesce(p_detail, '{}'::jsonb), p_reason);
$$;
revoke execute on function public.log_audit(uuid,text,text,text,jsonb,text) from anon, public;
grant  execute on function public.log_audit(uuid,text,text,text,jsonb,text) to authenticated;

-- Auto-log transaction voids and amendments — captured no matter which code path acts.
create or replace function public.audit_transaction_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'Voided' and old.status is distinct from 'Voided' then
    insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
    values (new.org_id, coalesce(new.voided_by, auth.uid()), 'txn_void', 'transaction', new.txn_id,
            jsonb_build_object('amount', new.total_amount));
  end if;
  if new.amendments is distinct from old.amendments then
    insert into public.audit_log (org_id, actor_id, action, target_type, target_id, detail)
    values (new.org_id, auth.uid(), 'txn_amend', 'transaction', new.txn_id,
            jsonb_build_object('amendments', jsonb_array_length(coalesce(new.amendments, '[]'::jsonb))));
  end if;
  return new;
end $$;

drop trigger if exists audit_transaction_change on public.transactions;
create trigger audit_transaction_change
  after update on public.transactions
  for each row execute function public.audit_transaction_change();

-- Log role changes from inside change_member_role (redefine to add the audit line).
create or replace function public.change_member_role(
  p_org_id uuid, p_user_id uuid, p_new_role member_role
) returns void language plpgsql security definer set search_path = public as $$
declare v_old member_role;
begin
  if not public.has_role(auth.uid(), p_org_id, 'management') then
    raise exception 'Only management or principal can change roles';
  end if;
  if p_new_role = 'principal' and not public.has_role(auth.uid(), p_org_id, 'principal') then
    raise exception 'Only a principal can grant the principal role';
  end if;

  select role into v_old from public.org_memberships where user_id = p_user_id and org_id = p_org_id;

  update public.org_memberships set role = p_new_role where user_id = p_user_id and org_id = p_org_id;
  if not found then raise exception 'No membership for that user in this org'; end if;

  update public.user_profiles set role = p_new_role::text::user_role where id = p_user_id;

  perform public.log_audit(p_org_id, 'role_change', 'member', p_user_id::text,
                           jsonb_build_object('from', v_old, 'to', p_new_role), null);
end;
$$;
revoke execute on function public.change_member_role(uuid, uuid, member_role) from anon, public;
grant  execute on function public.change_member_role(uuid, uuid, member_role) to authenticated;
