-- ================================================================
-- Allow an invited user to decline (revoke) their own invite.
-- SECURITY DEFINER bypasses the org_invites RLS which only allows
-- principal/management to update invites. The invitee has no update
-- policy, so the existing client-side .update() call silently fails
-- and the invite stays 'pending', causing the auth resolver to loop.
--
-- Safety:
--   - If caller is authenticated: verifies invite.email matches
--     auth.users.email for the current session.
--   - If caller is anonymous: allows decline by token alone (the
--     invite token is a 64-char hex secret — possession is proof).
-- ================================================================

create or replace function public.decline_invite(p_token text)
returns table (success boolean, error text)
language plpgsql security definer as $$
declare
  v_invite       public.org_invites%rowtype;
  v_caller_email text;
begin
  -- get the invite row and lock it
  select * into v_invite
  from public.org_invites
  where token = p_token
  for update;

  if not found then
    return query select false, 'Invite not found'::text;
    return;
  end if;

  if v_invite.status != 'pending' then
    return query select false, ('Invite is already ' || v_invite.status)::text;
    return;
  end if;

  -- if the caller is authenticated, verify it is their invite
  if auth.uid() is not null then
    select email into v_caller_email
    from auth.users
    where id = auth.uid();

    if lower(v_invite.email) != lower(coalesce(v_caller_email, '')) then
      return query select false,
        'You can only decline an invite sent to your own email address'::text;
      return;
    end if;
  end if;

  -- mark revoked
  update public.org_invites
  set status = 'revoked'
  where invite_id = v_invite.invite_id;

  return query select true, null::text;
end;
$$;
