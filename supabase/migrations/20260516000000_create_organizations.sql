-- ================================================================
-- T-01: organizations table
-- Workspace / tenant root. Every resource in Briklay belongs
-- to exactly one organization.
--
-- Adapted from spec:
--   "principals" table does not exist in this project.
--   User identity lives in public.user_profiles:
--     id         uuid  (FK → auth.users.id)
--     name       text
--     role       user_role enum (management | accountant | supervisor | principal)
--   Seed uses user_profiles.id and user_profiles.name accordingly.
-- ================================================================

create table if not exists public.organizations (
  org_id        uuid          primary key default gen_random_uuid(),
  name          text          not null,
  slug          text          not null unique,
  owner_id      uuid          not null references auth.users(id) on delete restrict,
  plan          text          not null default 'free'
                              check (plan in ('free', 'pro', 'enterprise')),
  status        text          not null default 'active'
                              check (status in ('active', 'suspended', 'deleted')),
  created_at    timestamptz   not null default now(),
  updated_at    timestamptz   not null default now()
);

-- slug must be lowercase, alphanumeric + hyphens only
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'slug_format'
      and conrelid = 'public.organizations'::regclass
  ) then
    alter table public.organizations
      add constraint slug_format
      check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$');
  end if;
end $$;

-- index on slug (used in every workspace URL lookup)
create index if not exists idx_organizations_slug
  on public.organizations(slug);

-- index on owner_id (used in auth resolver)
create index if not exists idx_organizations_owner
  on public.organizations(owner_id);

-- auto-update updated_at
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists organizations_updated_at on public.organizations;
create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.handle_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────

alter table public.organizations enable row level security;

-- Owner can read their own org
drop policy if exists "owner can read own org" on public.organizations;
create policy "owner can read own org"
  on public.organizations
  for select
  using (owner_id = auth.uid());

-- Members can read org they belong to
-- (org_memberships created in T-02 — policy added in T-02 migration)
-- Placeholder comment so T-02 knows to add here.

-- Owner can update their own org
drop policy if exists "owner can update own org" on public.organizations;
create policy "owner can update own org"
  on public.organizations
  for update
  using (owner_id = auth.uid());

-- Anyone authenticated can insert (creating new workspace)
-- Restricted further by application logic (T-05 auth resolver)
drop policy if exists "authenticated can create org" on public.organizations;
create policy "authenticated can create org"
  on public.organizations
  for insert
  with check (auth.uid() = owner_id);

-- No deletes via client — only via service role
drop policy if exists "no client deletes" on public.organizations;
create policy "no client deletes"
  on public.organizations
  for delete
  using (false);

-- ── HELPER FUNCTION ──────────────────────────────────────────────

-- Used in T-05 auth resolver: does any org exist for this owner?
create or replace function public.get_user_org(p_user_id uuid)
returns table (
  org_id    uuid,
  name      text,
  slug      text,
  is_owner  boolean
)
language sql security definer as $$
  select
    o.org_id,
    o.name,
    o.slug,
    (o.owner_id = p_user_id) as is_owner
  from public.organizations o
  where o.owner_id = p_user_id
    and o.status = 'active'
  limit 1;
$$;

-- ── SEED: backfill from user_profiles ────────────────────────────
--
-- NOTE: spec referenced public.principals (p.user_id, p.company_name).
-- That table does not exist. This project uses public.user_profiles:
--   id   uuid  → maps to spec's p.user_id
--   name text  → maps to spec's p.company_name
-- Owner is the first user with role 'management' or 'principal'.
-- Only runs if user_profiles has rows and organizations is still empty.

do $$
declare
  v_user_id   uuid;
  v_name      text;
  v_slug      text;
begin
  if not exists (select 1 from public.organizations) then
    select id, name
    into v_user_id, v_name
    from public.user_profiles
    where role::text in ('management', 'principal')
    order by created_at asc
    limit 1;

    if v_user_id is not null then
      -- build slug: lowercase, replace non-alphanumeric runs with hyphens,
      -- trim leading/trailing hyphens, truncate to 48 chars
      v_slug := lower(coalesce(v_name, 'briklay-workspace'));
      v_slug := regexp_replace(v_slug, '[^a-z0-9]+', '-', 'g');
      v_slug := trim(both '-' from v_slug);
      v_slug := left(v_slug, 48);
      -- ensure minimum length of 3 (constraint requires [a-z0-9]{2,50})
      if length(v_slug) < 3 then
        v_slug := v_slug || '-ws';
      end if;

      insert into public.organizations (name, slug, owner_id)
      values (coalesce(v_name, 'Briklay Workspace'), v_slug, v_user_id);
    end if;
  end if;
end $$;
