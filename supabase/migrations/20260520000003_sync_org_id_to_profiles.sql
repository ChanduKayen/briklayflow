-- ================================================================
-- Sync org_id into user_profiles so the sidebar and other UI
-- components that read user_profiles.org_id always see the
-- correct workspace, even after workspace deletion + recreation.
--
-- Root cause: create_workspace and finalize_new_member both
-- write to org_memberships but never updated user_profiles.org_id.
-- The sidebar was reading the stale org_id and showing the old
-- workspace name even when the auth resolver had the correct one.
-- ================================================================

-- ── 1. Fix create_workspace to also update org_id ────────────────

drop function if exists public.create_workspace(uuid, text, text) cascade;

create or replace function public.create_workspace(
  p_user_id uuid,
  p_name    text,
  p_slug    text
)
returns table (success boolean, error text)
language plpgsql security definer as $$
declare
  v_org_id uuid;
begin
  if exists (
    select 1
    from public.org_memberships m
    join public.organizations   o on o.org_id = m.org_id
    where m.user_id = p_user_id
      and m.status  = 'active'
      and o.status  = 'active'
  ) then
    return query select false, 'You already belong to a workspace'::text;
    return;
  end if;

  if exists (
    select 1 from public.organizations
    where slug = p_slug and status = 'active'
  ) then
    return query select false, 'That workspace URL is already taken'::text;
    return;
  end if;

  insert into public.organizations (name, slug, owner_id, status)
  values (p_name, p_slug, p_user_id, 'active')
  returning org_id into v_org_id;

  insert into public.org_memberships (org_id, user_id, role, status, joined_at)
  values (v_org_id, p_user_id, 'principal', 'active', now())
  on conflict (user_id, org_id)
  do update set role = 'principal', status = 'active', joined_at = now();

  -- Sync role AND org_id in user_profiles
  update public.user_profiles
  set role = 'principal', org_id = v_org_id
  where id = p_user_id;

  return query select true, null::text;

exception when others then
  return query select false, sqlerrm::text;
end;
$$;

-- ── 2. Fix finalize_new_member to also update org_id ─────────────

CREATE OR REPLACE FUNCTION public.finalize_new_member(
  p_user_id uuid,
  p_org_id  uuid,
  p_role    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  -- Sync role + org_id to user_profiles
  UPDATE public.user_profiles
  SET role = CASE WHEN p_role != 'supervisor' THEN p_role::public.user_role ELSE role END,
      org_id = p_org_id
  WHERE id = p_user_id;

  INSERT INTO public.org_memberships (org_id, user_id, role, status, joined_at)
  VALUES (p_org_id, p_user_id, p_role::public.member_role, 'active', now())
  ON CONFLICT (user_id, org_id)
  DO UPDATE SET role = EXCLUDED.role, status = 'active', joined_at = EXCLUDED.joined_at;

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;

-- ── 3. Backfill user_profiles.org_id for existing users ──────────
-- For each user, find their active membership in an active org and
-- write that org_id into user_profiles if it's missing or stale.

update public.user_profiles up
set org_id = m.org_id
from (
  select distinct on (m.user_id)
    m.user_id,
    m.org_id
  from public.org_memberships m
  join public.organizations   o on o.org_id = m.org_id
  where m.status = 'active'
    and o.status = 'active'
  order by m.user_id, m.joined_at desc nulls last
) m
where up.id = m.user_id
  and (up.org_id is null or up.org_id != m.org_id);
