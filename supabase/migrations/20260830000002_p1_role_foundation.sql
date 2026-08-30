-- ─────────────────────────────────────────────────────────────────────────────
-- P1 · Role foundation  (role-remediation plan, phase 1)
--
-- Makes org_memberships the single source of truth for role and routes role
-- changes through one guarded RPC. MUST run before any P2/P3 role enforcement,
-- because enforcement reads org_memberships and two live rows disagree with
-- user_profiles:
--   • a25c4f81-32db-4b5b-a3c1-4bd0c83d745f — profile=management, membership=supervisor
--     → intended role is management (confirmed); align the membership.
--   • f7c2e9d8-d079-42b0-9be2-3877abdd97f8 — profile=supervisor, NO membership row
--     → give them an active membership (derived from their profile's org) so they
--       aren't locked out the moment get_my_org_ids() drives access.
--
-- The single-principal invariant is already enforced by the live
-- one_principal_per_org trigger, so nothing here re-implements it.
--
-- ROLLBACK:
--   drop function if exists public.change_member_role(uuid, uuid, member_role);
--   -- the two data fixes below are corrective; reverting them re-opens the mismatch.
-- ─────────────────────────────────────────────────────────────────────────────

-- 1.1 ── Reconcile the two mismatched users into org_memberships (the authoritative store)
update public.org_memberships
   set role = 'management'
 where user_id = 'a25c4f81-32db-4b5b-a3c1-4bd0c83d745f';

-- Add the missing membership from the user's own profile org (no-op if org is null,
-- or if a row already exists). status/role match their profile: active supervisor.
insert into public.org_memberships (user_id, org_id, role, status)
select up.id, up.org_id, 'supervisor'::member_role, 'active'::member_status
  from public.user_profiles up
 where up.id = 'f7c2e9d8-d079-42b0-9be2-3877abdd97f8'
   and up.org_id is not null
   and not exists (
     select 1 from public.org_memberships m
      where m.user_id = up.id and m.org_id = up.org_id);

-- 1.2 ── One guarded RPC for changing a member's role.
-- • management or principal may change roles;
-- • only a principal may grant the principal role;
-- • the one_principal_per_org trigger keeps "exactly one principal per org";
-- • updates BOTH stores during the transition so nothing drifts while the client
--   is migrated off writing user_profiles.role directly (P6).
create or replace function public.change_member_role(
  p_org_id  uuid,
  p_user_id uuid,
  p_new_role member_role
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.has_role(auth.uid(), p_org_id, 'management') then
    raise exception 'Only management or principal can change roles';
  end if;

  if p_new_role = 'principal' and not public.has_role(auth.uid(), p_org_id, 'principal') then
    raise exception 'Only a principal can grant the principal role';
  end if;

  update public.org_memberships
     set role = p_new_role
   where user_id = p_user_id and org_id = p_org_id;

  if not found then
    raise exception 'No membership for that user in this org';
  end if;

  -- keep the mirror in sync until the client stops reading user_profiles.role (P6)
  update public.user_profiles
     set role = p_new_role::text::user_role
   where id = p_user_id;
end;
$$;

revoke execute on function public.change_member_role(uuid, uuid, member_role) from anon, public;
grant  execute on function public.change_member_role(uuid, uuid, member_role) to authenticated;
