-- Fix: "column reference \"org_id\" is ambiguous" when accepting an invite.
--
-- accept_invite() returns a table with an OUT column named org_id (and
-- membership_id). Inside the body those names are in scope as variables, so a
-- bare `where org_id = ...` (against public.organizations, whose PK is also
-- org_id) is ambiguous between the table column and the OUT column — Postgres
-- aborts the accept. Same trap on `returning membership_id`.
--
-- Fix is purely qualifying those two column references by table name. Signature,
-- return shape, and logic are otherwise identical to the original.
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

  -- get org slug for redirect (qualify org_id: table column, not the OUT column)
  select slug into v_org_slug
  from public.organizations
  where public.organizations.org_id = v_invite.org_id;

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
  returning public.org_memberships.membership_id into v_mem_id;

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
