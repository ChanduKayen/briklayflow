-- ─────────────────────────────────────────────────────────────────────────────
-- P0 · Access-control hotfix  (role-remediation plan, phase 0)
--
-- Closes three live holes found in the access audit, independent of the wider
-- role model. Safe to apply on its own. Verified against the live capture:
--   • the five write RPCs are granted to anon/public and take org_id from the
--     payload with no check;
--   • user_profiles has NO triggers, so its self-update policy lets any user set
--     their own role to 'principal';
--   • org_memberships' insert policy has a bare "user_id = auth.uid()" branch that
--     lets a user self-join any org as management/supervisor/accountant;
--   • org_invites still exposes "public read invite by token" to anon.
--
-- NOT included here: the in-body org guard for the five RPCs (needs their current
-- source) — that lands in a follow-up migration. Revoking anon/public already
-- removes the unauthenticated path, which is the urgent part.
--
-- ROLLBACK (paste to undo):
--   drop trigger if exists guard_profile_role_edit on public.user_profiles;
--   drop function if exists public.guard_profile_role_edit();
--   -- re-grant only if you must restore the prior (unsafe) state:
--   -- grant execute on function public.insert_transaction_with_allocations(jsonb,jsonb) to anon;
--   -- (…and the other four…)
--   -- restore the old org_memberships insert policy and org_invites token-read policy
--   --   from 20260516000001 / 20260516000002 if you need to revert.
-- ─────────────────────────────────────────────────────────────────────────────

-- 0.1 ── Take the money-write RPCs off the anon/public key (authenticated keeps them)
revoke execute on function public.insert_transaction_with_allocations(jsonb, jsonb) from anon, public;
revoke execute on function public.insert_split_transactions(jsonb, jsonb)            from anon, public;
revoke execute on function public.import_transactions(jsonb, text)                   from anon, public;
revoke execute on function public.void_import_batch(text)                            from anon, public;
revoke execute on function public.set_txn_allocations(text, uuid, jsonb)             from anon, public;

grant execute on function public.insert_transaction_with_allocations(jsonb, jsonb) to authenticated;
grant execute on function public.insert_split_transactions(jsonb, jsonb)            to authenticated;
grant execute on function public.import_transactions(jsonb, text)                   to authenticated;
grant execute on function public.void_import_batch(text)                            to authenticated;
grant execute on function public.set_txn_allocations(text, uuid, jsonb)             to authenticated;

-- 0.2 ── Stop role self-escalation on user_profiles.
-- A user may edit their own profile, but not their own role or project assignment
-- unless they are management/principal in the org. RLS can't do column-level rules,
-- so this is a trigger (fires even for the change_member_role RPC, which has already
-- checked the caller's role, so it passes there).
create or replace function public.guard_profile_role_edit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.role is distinct from old.role
      or new.assigned_projects is distinct from old.assigned_projects)
     and not public.has_role(auth.uid(), new.org_id, 'management') then
    raise exception 'Only management or principal may change a member''s role or project assignment';
  end if;
  return new;
end;
$$;

drop trigger if exists guard_profile_role_edit on public.user_profiles;
create trigger guard_profile_role_edit
  before update on public.user_profiles
  for each row execute function public.guard_profile_role_edit();

-- 0.3 ── Close the org self-join. Legitimate joins run through the SECURITY DEFINER
-- invite RPCs (accept_invite / accept_phone_invite / create_workspace), which bypass
-- RLS — so removing the bare self-insert branch does not affect them.
drop policy if exists "principal inserts memberships" on public.org_memberships;
create policy "principal inserts memberships" on public.org_memberships
  for insert
  with check (public.has_role(auth.uid(), org_id, 'principal'));

-- 0.4 ── Stop leaking invite tokens to anon. Token validation stays in the
-- validate_invite_token / accept_invite RPCs (used by InviteAccept.tsx); admins
-- still read invites through the "admin reads org invites" policy.
drop policy if exists "public read invite by token" on public.org_invites;
