-- ================================================================
-- T-03: org_invites table
-- Invite tokens are the ONLY way a new user gets a pre-assigned
-- role. Without a valid token, a new user lands in pending state.
-- Token is single-use, expiry-enforced, role-carrying.
-- ================================================================

-- ── TABLE ────────────────────────────────────────────────────────

create table if not exists public.org_invites (
  invite_id       uuid          primary key default gen_random_uuid(),
  org_id          uuid          not null
                                references public.organizations(org_id)
                                on delete cascade,
  email           text          not null,
  role            public.member_role  not null,
  token           text          not null unique
                                default encode(gen_random_bytes(32), 'hex'),
  invited_by      uuid          not null
                                references auth.users(id)
                                on delete restrict,
  status          text          not null default 'pending'
                                check (status in (
                                  'pending',    -- waiting for recipient
                                  'accepted',   -- used successfully
                                  'revoked',    -- cancelled by admin
                                  'expired'     -- past expires_at
                                )),
  expires_at      timestamptz   not null
                                default now() + interval '7 days',
  accepted_at     timestamptz   null,
  accepted_by     uuid          null
                                references auth.users(id)
                                on delete set null,
  created_at      timestamptz   not null default now(),

  -- one active invite per email per org at a time
  constraint unique_active_invite unique (org_id, email, status)
);

-- ── INDEXES ──────────────────────────────────────────────────────

-- token lookup (every invite accept hits this)
create unique index if not exists idx_invites_token
  on public.org_invites(token)
  where status = 'pending';

-- email lookup (auth resolver checks this on every new login)
create index if not exists idx_invites_email
  on public.org_invites(lower(email))
  where status = 'pending';

-- org → all invites (admin panel list)
create index if not exists idx_invites_org
  on public.org_invites(org_id);

-- ── AUTO-EXPIRE FUNCTION ─────────────────────────────────────────

-- Mark expired invites automatically.
-- Called by T-05 auth resolver before checking invite validity.
-- Also safe to run as a scheduled job (pg_cron if available).
create or replace function public.expire_old_invites()
returns void
language sql security definer as $$
  update public.org_invites
  set status = 'expired'
  where status = 'pending'
    and expires_at < now();
$$;

-- ── CORE FUNCTIONS ───────────────────────────────────────────────

-- Validate a token and return invite details.
-- Used in /invite/[token] accept flow (T-07).
create or replace function public.validate_invite_token(
  p_token text
)
returns table (
  invite_id   uuid,
  org_id      uuid,
  org_name    text,
  org_slug    text,
  email       text,
  role        public.member_role,
  expires_at  timestamptz,
  is_valid    boolean,
  fail_reason text
)
language plpgsql security definer as $$
begin
  -- expire stale ones first
  perform public.expire_old_invites();

  return query
  select
    i.invite_id,
    i.org_id,
    o.name          as org_name,
    o.slug          as org_slug,
    i.email,
    i.role,
    i.expires_at,
    case
      when i.invite_id is null    then false
      when i.status = 'accepted'  then false
      when i.status = 'revoked'   then false
      when i.status = 'expired'   then false
      when i.expires_at < now()   then false
      else true
    end             as is_valid,
    case
      when i.invite_id is null    then 'Token not found'
      when i.status = 'accepted'  then 'Invite already used'
      when i.status = 'revoked'   then 'Invite was revoked'
      when i.status = 'expired'   then 'Invite has expired'
      when i.expires_at < now()   then 'Invite has expired'
      else null
    end             as fail_reason
  from public.org_invites i
  left join public.organizations o on o.org_id = i.org_id
  where i.token = p_token;
end;
$$;

-- Check if an email has a pending invite anywhere.
-- Used by T-05 auth resolver immediately after Google sign-in.
create or replace function public.find_invite_by_email(
  p_email text
)
returns table (
  invite_id  uuid,
  org_id     uuid,
  org_name   text,
  role       public.member_role,
  token      text,
  expires_at timestamptz
)
language plpgsql security definer as $$
begin
  perform public.expire_old_invites();

  return query
  select
    i.invite_id,
    i.org_id,
    o.name   as org_name,
    i.role,
    i.token,
    i.expires_at
  from public.org_invites i
  join public.organizations o on o.org_id = i.org_id
  where lower(i.email) = lower(p_email)
    and i.status = 'pending'
    and i.expires_at > now()
  order by i.created_at desc
  limit 1;
end;
$$;

-- Accept an invite — atomic.
-- Creates membership + marks invite accepted in one transaction.
-- Used in T-07 accept flow.
create or replace function public.accept_invite(
  p_token   text,
  p_user_id uuid
)
returns table (
  success       boolean,
  membership_id uuid,
  role          public.member_role,
  org_id        uuid,
  org_slug      text,
  error         text
)
language plpgsql security definer as $$
declare
  v_invite    public.org_invites%rowtype;
  v_org_slug  text;
  v_mem_id    uuid;
begin
  -- lock the invite row
  select * into v_invite
  from public.org_invites
  where token = p_token
  for update;

  -- validate
  if not found then
    return query select false, null::uuid, null::public.member_role,
                        null::uuid, null::text, 'Token not found';
    return;
  end if;

  if v_invite.status != 'pending' then
    return query select false, null::uuid, null::public.member_role,
                        null::uuid, null::text,
                        'Invite already ' || v_invite.status;
    return;
  end if;

  if v_invite.expires_at < now() then
    update public.org_invites
    set status = 'expired' where invite_id = v_invite.invite_id;
    return query select false, null::uuid, null::public.member_role,
                        null::uuid, null::text, 'Invite has expired';
    return;
  end if;

  -- get org slug for redirect
  select slug into v_org_slug
  from public.organizations
  where org_id = v_invite.org_id;

  -- create membership
  insert into public.org_memberships
    (org_id, user_id, role, status, invited_by, invite_id, joined_at)
  values
    (v_invite.org_id, p_user_id, v_invite.role,
     'active', v_invite.invited_by, v_invite.invite_id, now())
  on conflict (user_id, org_id) do update
    set role      = excluded.role,
        status    = 'active',
        joined_at = now()
  returning membership_id into v_mem_id;

  -- mark invite consumed
  update public.org_invites
  set status      = 'accepted',
      accepted_at = now(),
      accepted_by = p_user_id
  where invite_id = v_invite.invite_id;

  return query
  select true, v_mem_id, v_invite.role,
         v_invite.org_id, v_org_slug, null::text;
end;
$$;

-- ── RLS ──────────────────────────────────────────────────────────

alter table public.org_invites enable row level security;

-- anyone can read an invite by token (needed for accept page,
-- user may not be logged in yet when they click the link)
drop policy if exists "public read invite by token" on public.org_invites;
create policy "public read invite by token"
  on public.org_invites
  for select
  using (true);

-- principal/management can see all invites for their org
drop policy if exists "admin reads org invites" on public.org_invites;
create policy "admin reads org invites"
  on public.org_invites
  for select
  using (
    exists (
      select 1 from public.org_memberships m
      where m.user_id = auth.uid()
        and m.org_id  = org_invites.org_id
        and m.role    in ('principal', 'management')
        and m.status  = 'active'
    )
  );

-- principal/management can create invites
drop policy if exists "admin creates invites" on public.org_invites;
create policy "admin creates invites"
  on public.org_invites
  for insert
  with check (
    exists (
      select 1 from public.org_memberships m
      where m.user_id = auth.uid()
        and m.org_id  = org_invites.org_id
        and m.role    in ('principal', 'management')
        and m.status  = 'active'
    )
  );

-- principal/management can revoke (update status only)
drop policy if exists "admin revokes invites" on public.org_invites;
create policy "admin revokes invites"
  on public.org_invites
  for update
  using (
    exists (
      select 1 from public.org_memberships m
      where m.user_id = auth.uid()
        and m.org_id  = org_invites.org_id
        and m.role    in ('principal', 'management')
        and m.status  = 'active'
    )
  );

-- no hard deletes
drop policy if exists "no client deletes invites" on public.org_invites;
create policy "no client deletes invites"
  on public.org_invites
  for delete
  using (false);

-- ── LINK BACK TO T-02 ────────────────────────────────────────────

-- Now that org_invites exists, add the FK constraint
-- that T-02 left as null (invite_id column already exists)
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fk_membership_invite'
      and conrelid = 'public.org_memberships'::regclass
  ) then
    alter table public.org_memberships
      add constraint fk_membership_invite
      foreign key (invite_id)
      references public.org_invites(invite_id)
      on delete set null;
  end if;
end $$;
