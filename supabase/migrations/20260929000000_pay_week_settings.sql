-- ─────────────────────────────────────────────────────────────────────────────
-- Pay week — the org chooses which weekday its labour week starts on, and which day
-- (if any) is the default weekly off. Until now the whole app assumed a Monday→Sunday
-- week with Sunday off, hardcoded on the client. These two org-level preferences make
-- that a setting (surfaced in the Attendance "Settings" gear), read on the client via
-- get_membership_context exactly like org name/slug.
--
--   week_start_day : 0 = Sunday … 6 = Saturday (JS getDay convention). DEFAULT 1 = Monday,
--                    so every existing org keeps today's Monday-start behaviour untouched.
--   weekly_off_day : the default day-off pre-filled on the muster. DEFAULT 0 = Sunday.
--                    NULL means "no weekly off" (all seven days are working days).
-- ─────────────────────────────────────────────────────────────────────────────

alter table public.organizations
  add column if not exists week_start_day smallint not null default 1,
  add column if not exists weekly_off_day smallint default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'organizations_week_start_day_range') then
    alter table public.organizations
      add constraint organizations_week_start_day_range check (week_start_day between 0 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'organizations_weekly_off_day_range') then
    alter table public.organizations
      add constraint organizations_weekly_off_day_range check (weekly_off_day is null or weekly_off_day between 0 and 6);
  end if;
end$$;

-- get_membership_context carries the two preferences to the client (resolver.ts maps them
-- into MembershipContext). Must list them in BOTH the returns-table signature and the select.
create or replace function public.get_membership_context(
  p_user_id uuid
)
returns table (
  org_id         uuid,
  org_name       text,
  org_slug       text,
  membership_id  uuid,
  role           public.member_role,
  status         public.member_status,
  joined_at      timestamptz,
  week_start_day smallint,
  weekly_off_day smallint
)
language sql security definer stable as $$
  select
    o.org_id,
    o.name           as org_name,
    o.slug           as org_slug,
    m.membership_id,
    m.role,
    m.status,
    m.joined_at,
    o.week_start_day,
    o.weekly_off_day
  from public.org_memberships m
  join public.organizations o on o.org_id = m.org_id
  where m.user_id = p_user_id
    and o.status  = 'active'
  limit 1;
$$;

-- Owner + management may change the pay week. The generic "owner can update own org" RLS
-- policy is owner-only (and would expose name/slug/plan to management too), so the write goes
-- through a SECURITY DEFINER RPC that checks the caller is an active principal/management member
-- of that org and touches only these two columns.
create or replace function public.set_pay_week(
  p_org_id        uuid,
  p_week_start    smallint,
  p_weekly_off    smallint
)
returns void
language plpgsql security definer as $$
begin
  if p_week_start is null or p_week_start < 0 or p_week_start > 6 then
    raise exception 'week_start_day must be between 0 and 6';
  end if;
  if p_weekly_off is not null and (p_weekly_off < 0 or p_weekly_off > 6) then
    raise exception 'weekly_off_day must be between 0 and 6, or null';
  end if;
  if not exists (
    select 1 from public.org_memberships m
    where m.user_id = auth.uid()
      and m.org_id  = p_org_id
      and m.status  = 'active'
      and m.role in ('principal', 'management')
  ) then
    raise exception 'not authorised to change the pay week for this organisation';
  end if;

  update public.organizations
     set week_start_day = p_week_start,
         weekly_off_day = p_weekly_off
   where org_id = p_org_id;
end$$;

grant execute on function public.set_pay_week(uuid, smallint, smallint) to authenticated;
