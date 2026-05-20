-- ================================================================
-- Fix create_workspace: only block if the user already belongs
-- to an ACTIVE org. A membership row pointing at a deleted org
-- must not prevent the user from creating a new workspace.
-- ================================================================

-- Drop old version first (return type changed)
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
  -- Block only if user has an active membership in an active org
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

  -- Slug must be unique among active orgs
  if exists (
    select 1 from public.organizations
    where slug = p_slug and status = 'active'
  ) then
    return query select false, 'That workspace URL is already taken'::text;
    return;
  end if;

  -- Create the organisation
  insert into public.organizations (name, slug, owner_id, status)
  values (p_name, p_slug, p_user_id, 'active')
  returning org_id into v_org_id;

  -- Create principal membership
  insert into public.org_memberships (org_id, user_id, role, status, joined_at)
  values (v_org_id, p_user_id, 'principal', 'active', now())
  on conflict (user_id, org_id)
  do update set role = 'principal', status = 'active', joined_at = now();

  -- Sync role + org_id in user_profiles
  update public.user_profiles
  set role = 'principal', org_id = v_org_id
  where id = p_user_id;

  return query select true, null::text;

exception when others then
  return query select false, sqlerrm::text;
end;
$$;
