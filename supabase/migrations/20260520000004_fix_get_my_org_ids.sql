-- ================================================================
-- Fix get_my_org_ids: also filter by org.status = 'active'.
--
-- Bug: after workspace deletion, org_memberships.status remains
-- 'active' (only organizations.status is set to 'deleted').
-- The old function returned the deleted org's ID, so all core-table
-- RLS policies continued to allow access to the deleted org's data.
-- ================================================================

create or replace function public.get_my_org_ids()
returns setof uuid
language sql security definer stable as $$
  select m.org_id
  from public.org_memberships m
  join public.organizations o on o.org_id = m.org_id
  where m.user_id = auth.uid()
    and m.status  = 'active'
    and o.status  = 'active'
$$;
