-- ================================================================
-- T-04: org_id on core tables (corrected)
-- Tables: confirmed from codebase grep + SQL checks
-- Skips non-existent tables safely
-- Note: user_profiles PK is "id" not "user_id" — policy uses id.
-- ================================================================

-- ── PHASE 1: ADD org_id AS NULLABLE ──────────────────────────────

do $$
declare
  v_tables text[] := array[
    'user_profiles',
    'projects',
    'work_orders',
    'purchase_orders',
    'transactions',
    'stakeholders',
    'txn_allocations',
    'wo_milestones',
    'project_budgets'  -- skipped gracefully if table does not exist
  ];
  v_table text;
begin
  foreach v_table in array v_tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public'
        and table_name = v_table
    ) then
      if not exists (
        select 1 from information_schema.columns
        where table_schema = 'public'
          and table_name   = v_table
          and column_name  = 'org_id'
      ) then
        execute format(
          'alter table public.%I
           add column org_id uuid
           references public.organizations(org_id)
           on delete restrict',
          v_table
        );
        raise notice 'Phase 1: added org_id to %', v_table;
      else
        raise notice 'Phase 1: org_id already exists on %, skipping', v_table;
      end if;
    else
      raise notice 'Phase 1: table % does not exist, skipping', v_table;
    end if;
  end loop;
end $$;

-- ── PHASE 2: BACKFILL ─────────────────────────────────────────────
-- Disable triggers during bulk backfill so no pending trigger events
-- remain when Phase 3 runs ALTER TABLE in the same transaction.

set local session_replication_role = 'replica';

do $$
declare
  v_org_id  uuid;
  v_tables  text[] := array[
    'user_profiles',
    'projects',
    'work_orders',
    'purchase_orders',
    'transactions',
    'stakeholders',
    'txn_allocations',
    'wo_milestones',
    'project_budgets'  -- skipped gracefully if table does not exist
  ];
  v_table  text;
  v_count  int;
begin
  select org_id into v_org_id
  from public.organizations
  where status = 'active'
  limit 1;

  if v_org_id is null then
    raise exception 'No active org found. T-01 must run first.';
  end if;

  raise notice 'Phase 2: backfilling org_id = %', v_org_id;

  foreach v_table in array v_tables loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = v_table
        and column_name  = 'org_id'
    ) then
      execute format(
        'update public.%I set org_id = $1 where org_id is null',
        v_table
      ) using v_org_id;

      get diagnostics v_count = row_count;
      raise notice 'Phase 2: backfilled % rows in %', v_count, v_table;
    end if;
  end loop;
end $$;

reset session_replication_role;

-- ── PHASE 3: NOT NULL + INDEX ─────────────────────────────────────

do $$
declare
  v_tables text[] := array[
    'user_profiles',
    'projects',
    'work_orders',
    'purchase_orders',
    'transactions',
    'stakeholders',
    'txn_allocations',
    'wo_milestones',
    'project_budgets'  -- skipped gracefully if table does not exist
  ];
  v_table      text;
  v_null_count int;
begin
  foreach v_table in array v_tables loop
    if exists (
      select 1 from information_schema.columns
      where table_schema = 'public'
        and table_name   = v_table
        and column_name  = 'org_id'
    ) then
      -- safety: confirm zero nulls before adding constraint
      execute format(
        'select count(*) from public.%I where org_id is null',
        v_table
      ) into v_null_count;

      if v_null_count > 0 then
        raise exception
          'Phase 3: % has % null org_id rows. Backfill failed.',
          v_table, v_null_count;
      end if;

      execute format(
        'alter table public.%I alter column org_id set not null',
        v_table
      );

      execute format(
        'create index if not exists idx_%s_org_id on public.%I(org_id)',
        replace(v_table, '.', '_'), v_table
      );

      raise notice 'Phase 3: NOT NULL + index done on %', v_table;
    end if;
  end loop;
end $$;

-- ── PHASE 4: RLS POLICIES ─────────────────────────────────────────

do $$
declare
  v_tables text[] := array[
    'projects',
    'work_orders',
    'purchase_orders',
    'transactions',
    'stakeholders',
    'txn_allocations',
    'wo_milestones',
    'project_budgets'  -- skipped gracefully if table does not exist
  ];
  v_table text;
begin
  foreach v_table in array v_tables loop
    if exists (
      select 1 from information_schema.tables
      where table_schema = 'public'
        and table_name = v_table
    ) then
      execute format(
        'alter table public.%I enable row level security',
        v_table
      );

      execute format(
        'drop policy if exists "org member access" on public.%I',
        v_table
      );

      execute format($policy$
        create policy "org member access"
        on public.%I
        for all
        using (
          org_id in (
            select m.org_id
            from public.org_memberships m
            where m.user_id = auth.uid()
              and m.status  = 'active'
          )
        )
        with check (
          org_id in (
            select m.org_id
            from public.org_memberships m
            where m.user_id = auth.uid()
              and m.status  = 'active'
          )
        )
      $policy$, v_table, v_table);

      raise notice 'Phase 4: RLS applied to %', v_table;
    end if;
  end loop;
end $$;

-- ── user_profiles: special policy (guarded) ───────────────────────
-- NOTE: user_profiles PK column is "id" (not "user_id").
-- The self-access check uses "id = auth.uid()".

do $$
begin
  if exists (
    select 1 from information_schema.tables
    where table_schema = 'public'
      and table_name   = 'user_profiles'
  ) then
    alter table public.user_profiles
      enable row level security;

    drop policy if exists "org member access"   on public.user_profiles;
    drop policy if exists "profile self access" on public.user_profiles;

    create policy "profile self access"
      on public.user_profiles
      for all
      using (
        -- own profile
        id = auth.uid()
        or
        -- or admin in same org
        exists (
          select 1
          from public.org_memberships m
          where m.user_id = auth.uid()
            and m.org_id  = user_profiles.org_id
            and m.role    in ('principal', 'management')
            and m.status  = 'active'
        )
      )
      with check (
        id = auth.uid()
        or
        exists (
          select 1
          from public.org_memberships m
          where m.user_id = auth.uid()
            and m.org_id  = user_profiles.org_id
            and m.role    in ('principal', 'management')
            and m.status  = 'active'
        )
      );

    raise notice 'Phase 4: special RLS applied to user_profiles';
  else
    raise notice 'Phase 4: user_profiles not found, skipping';
  end if;
end $$;
