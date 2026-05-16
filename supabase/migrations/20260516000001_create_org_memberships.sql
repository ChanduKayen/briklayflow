-- ================================================================
-- T-02: org_memberships table
-- Identity ↔ Organization ↔ Role bridge.
-- A user exists in auth.users (who they are).
-- A membership defines what they can access and as what role.
-- One user can belong to one org in Briklay v1.
--
-- Notes from codebase read:
--   - Existing public.user_role enum ('management','accountant',
--     'supervisor','principal') is a separate type from the new
--     public.member_role enum below — no conflict.
--   - User identity: session.user.id → auth.users.id
--   - All role checks currently use user_profiles.role; T-05
--     will migrate these to org_memberships.role.
-- ================================================================

-- ── ENUMS ────────────────────────────────────────────────────────

do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_role' and typnamespace = 'public'::regnamespace) then
    create type public.member_role as enum (
      'principal',    -- org owner. full access. one per org.
      'management',   -- directors, PMs. all except org settings.
      'supervisor',   -- site supervisors. WO + site + read txns.
      'accountant'    -- finance only. txns + reports.
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'member_status' and typnamespace = 'public'::regnamespace) then
    create type public.member_status as enum (
      'active',       -- full access
      'pending',      -- awaiting admin approval
      'suspended'     -- access revoked, record kept
    );
  end if;
end $$;

-- ── TABLE ────────────────────────────────────────────────────────

create table if not exists public.org_memberships (
  membership_id   uuid                  primary key default gen_random_uuid(),
  org_id          uuid                  not null
                                        references public.organizations(org_id)
                                        on delete cascade,
  user_id         uuid                  not null
                                        references auth.users(id)
                                        on delete cascade,
  role            public.member_role    not null,
  status          public.member_status  not null default 'pending',
  invited_by      uuid                  references auth.users(id)
                                        on delete set null,
  invite_id       uuid                  null,     -- linked to org_invites (T-03)
  joined_at       timestamptz           null,     -- null until status = active
  created_at      timestamptz           not null  default now(),
  updated_at      timestamptz           not null  default now(),

  -- one user, one org (Briklay v1: single-org per user)
  constraint unique_user_org unique (user_id, org_id)
);

-- ── INDEXES ──────────────────────────────────────────────────────

-- primary lookup: user → their membership
create index if not exists idx_memberships_user
  on public.org_memberships(user_id);

-- org → all its members (admin panel)
create index if not exists idx_memberships_org
  on public.org_memberships(org_id);

-- pending approvals queue
create index if not exists idx_memberships_pending
  on public.org_memberships(org_id, status)
  where status = 'pending';

-- ── TRIGGERS ─────────────────────────────────────────────────────

-- reuse handle_updated_at from T-01
drop trigger if exists memberships_updated_at on public.org_memberships;
create trigger memberships_updated_at
  before update on public.org_memberships
  for each row execute function public.handle_updated_at();

-- auto-set joined_at when status flips to active
create or replace function public.handle_membership_activated()
returns trigger language plpgsql as $$
begin
  if new.status = 'active' and old.status != 'active' then
    new.joined_at = now();
  end if;
  return new;
end;
$$;

drop trigger if exists membership_activated on public.org_memberships;
create trigger membership_activated
  before update on public.org_memberships
  for each row execute function public.handle_membership_activated();

-- enforce one principal per org
create or replace function public.enforce_one_principal()
returns trigger language plpgsql as $$
begin
  if new.role = 'principal' then
    if exists (
      select 1 from public.org_memberships
      where org_id = new.org_id
        and role = 'principal'
        and status = 'active'
        and membership_id != coalesce(new.membership_id, gen_random_uuid())
    ) then
      raise exception 'Organization already has a principal. '
                      'Transfer ownership before assigning a new one.';
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists one_principal_per_org on public.org_memberships;
create trigger one_principal_per_org
  before insert or update on public.org_memberships
  for each row execute function public.enforce_one_principal();

-- ── RLS ──────────────────────────────────────────────────────────

alter table public.org_memberships enable row level security;

-- member can read their own membership
drop policy if exists "member reads own membership" on public.org_memberships;
create policy "member reads own membership"
  on public.org_memberships
  for select
  using (user_id = auth.uid());

-- principal/management can read all memberships in their org
drop policy if exists "admin reads org memberships" on public.org_memberships;
create policy "admin reads org memberships"
  on public.org_memberships
  for select
  using (
    exists (
      select 1 from public.org_memberships m
      where m.user_id = auth.uid()
        and m.org_id = org_memberships.org_id
        and m.role in ('principal', 'management')
        and m.status = 'active'
    )
  );

-- principal can insert new memberships (invite flow)
drop policy if exists "principal inserts memberships" on public.org_memberships;
create policy "principal inserts memberships"
  on public.org_memberships
  for insert
  with check (
    exists (
      select 1 from public.org_memberships m
      where m.user_id = auth.uid()
        and m.org_id = org_memberships.org_id
        and m.role = 'principal'
        and m.status = 'active'
    )
  );

-- system can insert own membership during workspace creation
-- (user_id = auth.uid() means they're creating their own record)
-- NOTE: T-05 will tighten this via application-layer invite validation.
drop policy if exists "self insert on workspace creation" on public.org_memberships;
create policy "self insert on workspace creation"
  on public.org_memberships
  for insert
  with check (user_id = auth.uid());

-- principal can update memberships in their org (approve, suspend, change role)
drop policy if exists "principal updates memberships" on public.org_memberships;
create policy "principal updates memberships"
  on public.org_memberships
  for update
  using (
    exists (
      select 1 from public.org_memberships m
      where m.user_id = auth.uid()
        and m.org_id = org_memberships.org_id
        and m.role = 'principal'
        and m.status = 'active'
    )
  );

-- no hard deletes — use status = suspended
drop policy if exists "no client deletes memberships" on public.org_memberships;
create policy "no client deletes memberships"
  on public.org_memberships
  for delete
  using (false);

-- ── UPDATE organizations RLS (placeholder from T-01) ─────────────

-- Members can now read their org (promised in T-01 comment)
drop policy if exists "member reads own org" on public.organizations;
create policy "member reads own org"
  on public.organizations
  for select
  using (
    exists (
      select 1 from public.org_memberships m
      where m.user_id = auth.uid()
        and m.org_id = organizations.org_id
        and m.status = 'active'
    )
  );

-- ── HELPER FUNCTIONS (used by T-05 auth resolver) ────────────────

-- Get a user's full membership context in one call.
-- Called on every auth check — keep it fast.
create or replace function public.get_membership_context(
  p_user_id uuid
)
returns table (
  org_id        uuid,
  org_name      text,
  org_slug      text,
  membership_id uuid,
  role          public.member_role,
  status        public.member_status,
  joined_at     timestamptz
)
language sql security definer stable as $$
  select
    o.org_id,
    o.name        as org_name,
    o.slug        as org_slug,
    m.membership_id,
    m.role,
    m.status,
    m.joined_at
  from public.org_memberships m
  join public.organizations o on o.org_id = m.org_id
  where m.user_id = p_user_id
    and o.status  = 'active'
  limit 1;
$$;

-- Check if user has a specific role or above.
-- Role hierarchy: principal > management > supervisor > accountant
create or replace function public.has_role(
  p_user_id uuid,
  p_org_id  uuid,
  p_min_role text
)
returns boolean
language sql security definer stable as $$
  select exists (
    select 1
    from public.org_memberships m
    where m.user_id = p_user_id
      and m.org_id  = p_org_id
      and m.status  = 'active'
      and case p_min_role
            when 'accountant'  then m.role in ('accountant','supervisor','management','principal')
            when 'supervisor'  then m.role in ('supervisor','management','principal')
            when 'management'  then m.role in ('management','principal')
            when 'principal'   then m.role = 'principal'
            else false
          end
  );
$$;

-- ── BACKFILL existing principal as org member ─────────────────────

do $$
declare
  v_org_id   uuid;
  v_owner_id uuid;
begin
  -- get the org created in T-01
  select org_id, owner_id
  into v_org_id, v_owner_id
  from public.organizations
  limit 1;

  if v_org_id is not null and v_owner_id is not null then
    insert into public.org_memberships
      (org_id, user_id, role, status, joined_at)
    values
      (v_org_id, v_owner_id, 'principal', 'active', now())
    on conflict (user_id, org_id) do nothing;

    raise notice 'Backfilled principal membership for org %', v_org_id;
  else
    raise notice 'No org found — skipping backfill. Run T-01 first.';
  end if;
end $$;
