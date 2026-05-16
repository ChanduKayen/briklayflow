-- T-11: create_invite helper
-- Returns JSONB (not RETURNS TABLE) so PL/pgSQL has no implicit output
-- variables — eliminates "column reference invite_id is ambiguous".

-- Must DROP first — PostgreSQL won't allow changing return type via CREATE OR REPLACE.
drop function if exists public.create_invite(uuid, text, public.member_role, uuid);

create or replace function public.create_invite(
  p_org_id     uuid,
  p_email      text,
  p_role       public.member_role,
  p_invited_by uuid
)
returns jsonb
language plpgsql security definer as $$
declare
  v_invite_id uuid;
  v_token     text;
begin
  -- inviter must be management or above
  if not public.has_role(p_invited_by, p_org_id, 'management') then
    return jsonb_build_object(
      'success', false,
      'error',   'Only management or principal can invite members',
      'invite_id', null, 'token', null
    );
  end if;

  -- reject if already an active member
  if exists (
    select 1
    from   public.org_memberships m
    join   auth.users u on u.id = m.user_id
    where  m.org_id       = p_org_id
      and  lower(u.email) = lower(p_email)
      and  m.status       = 'active'
  ) then
    return jsonb_build_object(
      'success', false,
      'error',   'This person is already a member',
      'invite_id', null, 'token', null
    );
  end if;

  -- revoke any existing pending invite for this email + org
  update public.org_invites
  set    status = 'revoked'
  where  org_id       = p_org_id
    and  lower(email) = lower(p_email)
    and  status       = 'pending';

  -- insert new invite
  insert into public.org_invites
    (org_id, email, role, invited_by, expires_at)
  values
    (p_org_id, lower(p_email), p_role,
     p_invited_by, now() + interval '7 days')
  returning
    invite_id,
    token
  into
    v_invite_id,
    v_token;

  return jsonb_build_object(
    'success',   true,
    'error',     null,
    'invite_id', v_invite_id,
    'token',     v_token
  );
end;
$$;

-- verify
select routine_name
from   information_schema.routines
where  routine_schema = 'public'
  and  routine_name   = 'create_invite';
