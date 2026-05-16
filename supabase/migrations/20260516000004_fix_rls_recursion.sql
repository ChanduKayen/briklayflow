-- ================================================================
-- Fix: RLS infinite recursion on org_memberships
-- Root cause: policies on core tables query org_memberships, which
-- has a self-referential "admin reads org memberships" policy.
-- Fix: SECURITY DEFINER helpers bypass RLS → no recursion.
-- ================================================================

-- ── 1. SECURITY DEFINER helper for org-scoped row visibility ─────

create or replace function public.get_my_org_ids()
returns setof uuid
language sql security definer stable as $$
  select org_id from public.org_memberships
  where user_id = auth.uid()
    and status = 'active'
$$;

-- ── 2. Fix self-referential policies on org_memberships ───────────
-- All three policies (select admin, insert principal, update principal)
-- queried org_memberships from within org_memberships → recursion.
-- Replace with has_role() which is already SECURITY DEFINER (T-02).

drop policy if exists "admin reads org memberships"  on public.org_memberships;
create policy "admin reads org memberships"
  on public.org_memberships
  for select
  using (
    user_id = auth.uid()
    or
    public.has_role(auth.uid(), org_memberships.org_id, 'management')
  );

drop policy if exists "member reads own membership"  on public.org_memberships;
-- (consolidated into the policy above — drop the old narrower one)

drop policy if exists "principal inserts memberships" on public.org_memberships;
create policy "principal inserts memberships"
  on public.org_memberships
  for insert
  with check (
    user_id = auth.uid()
    or
    public.has_role(auth.uid(), org_memberships.org_id, 'principal')
  );

drop policy if exists "self insert on workspace creation" on public.org_memberships;
-- (consolidated into principal inserts memberships above)

drop policy if exists "principal updates memberships" on public.org_memberships;
create policy "principal updates memberships"
  on public.org_memberships
  for update
  using (
    public.has_role(auth.uid(), org_memberships.org_id, 'principal')
  );

-- ── 3. Fix org member access on all core tables ───────────────────
-- Old policy used direct subquery on org_memberships → recursion.
-- New policy calls get_my_org_ids() (SECURITY DEFINER) → safe.

do $$
declare
  v_tables text[] := array[
    'projects',
    'work_orders',
    'purchase_orders',
    'transactions',
    'stakeholders',
    'txn_allocations',
    'wo_milestones'
  ];
  v_table text;
begin
  foreach v_table in array v_tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public' and table_name = v_table
    ) then
      execute format(
        'drop policy if exists "org member access" on public.%I', v_table
      );
      execute format($p$
        create policy "org member access"
        on public.%I
        for all
        using  (org_id in (select public.get_my_org_ids()))
        with check (org_id in (select public.get_my_org_ids()))
      $p$, v_table, v_table);
      raise notice 'Patched org member access on %', v_table;
    end if;
  end loop;
end $$;

-- ── 4. Fix user_profiles policy ───────────────────────────────────

drop policy if exists "profile self access" on public.user_profiles;
create policy "profile self access"
  on public.user_profiles
  for all
  using (
    id = auth.uid()
    or
    public.has_role(auth.uid(), user_profiles.org_id, 'management')
  )
  with check (
    id = auth.uid()
    or
    public.has_role(auth.uid(), user_profiles.org_id, 'management')
  );

-- ── 5. Fix organizations member-read policy ───────────────────────

drop policy if exists "member reads own org" on public.organizations;
create policy "member reads own org"
  on public.organizations
  for select
  using (
    org_id in (select public.get_my_org_ids())
  );

-- ── 6. Backfill all existing users into org_memberships ───────────
-- session_replication_role = replica disables triggers so
-- enforce_one_principal does not block the batch.
-- Migrations run as postgres → RLS is bypassed automatically.

set local session_replication_role = 'replica';

do $$
declare
  v_org_id    uuid;
  v_owner_id  uuid;
  v_inserted  int;
begin
  select org_id, owner_id
  into v_org_id, v_owner_id
  from public.organizations
  where status = 'active'
  limit 1;

  if v_org_id is null then
    raise notice 'No active org found — skipping membership backfill';
    return;
  end if;

  -- Owner → principal (upsert; keeps joined_at if already set)
  insert into public.org_memberships (org_id, user_id, role, status, joined_at)
  values (v_org_id, v_owner_id, 'principal', 'active', now())
  on conflict (user_id, org_id) do update
    set role      = 'principal',
        status    = 'active',
        joined_at = coalesce(org_memberships.joined_at, now());

  raise notice 'Owner % set as principal for org %', v_owner_id, v_org_id;

  -- All other users → map role from user_profiles.
  -- Duplicate principals from old system demoted to management.
  insert into public.org_memberships (org_id, user_id, role, status, joined_at)
  select
    v_org_id,
    up.id,
    case
      when up.role::text = 'principal' then 'management'::public.member_role
      else up.role::text::public.member_role
    end,
    'active',
    now()
  from public.user_profiles up
  where up.id != v_owner_id
  on conflict (user_id, org_id) do update
    set status    = 'active',
        joined_at = coalesce(org_memberships.joined_at, now());

  get diagnostics v_inserted = row_count;
  raise notice 'Backfilled % other members for org %', v_inserted, v_org_id;
end $$;

reset session_replication_role;
