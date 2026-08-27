-- accept_phone_invite() — let an invited teammate JOIN by phone.
--
-- The team-invite flow registers the invitee's number against the org in
-- wa_registered_numbers (org_id set by trigger; user_id NULL until they join). The
-- WhatsApp invite sends them to a static signup page where they sign up with that
-- number over OTP. This RPC is the missing last step: on that phone signup it turns
-- the pending number into an ACTIVE org_membership, so the auth resolver lands them
-- in the inviter's org instead of "create your own workspace".
--
-- SECURITY: matches on the caller's OWN verified phone from the JWT (auth.jwt()->>'phone'),
-- NOT a client-supplied value — so nobody can claim an org by passing someone else's number.
-- The number is verified by Supabase's OTP, and was registered by an admin who invited them.

CREATE OR REPLACE FUNCTION public.accept_phone_invite()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid   uuid := auth.uid();
  v_phone text := regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g');
  v_row   record;
  v_role  public.member_role;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in');
  END IF;
  IF length(v_phone) < 11 THEN
    -- No verified phone (an email/Google user) → nothing to do.
    RETURN jsonb_build_object('ok', false, 'error', 'no verified phone');
  END IF;

  -- The pending phone invite: a number registered to an org, not yet linked to a user (or already ours).
  -- phone_number is UNIQUE, so at most one org — no ambiguity.
  SELECT n.org_id, n.role, o.name AS org_name
    INTO v_row
  FROM public.wa_registered_numbers n
  JOIN public.organizations o ON o.org_id = n.org_id
  WHERE n.phone_number = v_phone
    AND n.org_id IS NOT NULL
    AND (n.user_id IS NULL OR n.user_id = v_uid)
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no pending invite for this number');
  END IF;

  -- Map the WA role text ('Supervisor' etc.) to the membership enum; anything unknown → supervisor.
  v_role := (CASE lower(coalesce(v_row.role, ''))
    WHEN 'principal'  THEN 'principal'
    WHEN 'management' THEN 'management'
    WHEN 'accountant' THEN 'accountant'
    ELSE 'supervisor'
  END)::public.member_role;

  INSERT INTO public.org_memberships (org_id, user_id, role, status, joined_at)
  VALUES (v_row.org_id, v_uid, v_role, 'active', now())
  ON CONFLICT (user_id, org_id) DO UPDATE SET
    status    = 'active',
    joined_at = COALESCE(public.org_memberships.joined_at, now());

  UPDATE public.wa_registered_numbers
     SET user_id = v_uid, is_active = true, invite_status = 'active'
   WHERE phone_number = v_phone;

  RETURN jsonb_build_object('ok', true, 'org_id', v_row.org_id, 'org_name', v_row.org_name);
END;
$$;

REVOKE ALL     ON FUNCTION public.accept_phone_invite() FROM public;
GRANT  EXECUTE ON FUNCTION public.accept_phone_invite() TO authenticated;

-- Verify:
--   SELECT public.accept_phone_invite();   -- as a signed-in phone user with a pending invite
