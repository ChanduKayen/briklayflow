-- revoke_member(p_user_id, p_org_id) — the SYMMETRIC counterpart to accept_phone_invite.
--
-- WHY: access is coupled — registering a number for Day Book WhatsApp is what grants app
-- membership (via phone OTP + accept_phone_invite). For that coupling to be safe, REVOKE must be
-- coupled too. Today it isn't: "Remove member" hard-deletes the auth user (org_memberships cascades
-- away) but wa_registered_numbers.user_id is ON DELETE SET NULL, so the WhatsApp row survives with
-- is_active=true / invite_status='active'. The same phone then re-signs-up over OTP and
-- accept_phone_invite auto-rejoins them — removal undone. (This is exactly how a stale-but-live row
-- stranded a prior signup.)
--
-- This RPC revokes BOTH sides atomically, admin-gated: suspend the app membership (record kept — the
-- member_status enum's 'suspended' literally means "access revoked, record kept") AND revoke the
-- WhatsApp grant so accept_phone_invite refuses any re-join. It is the one primitive both "Remove
-- member" (called before the delete, while user_id still links the row) and any future soft "Suspend"
-- action route through.

CREATE OR REPLACE FUNCTION public.revoke_member(p_user_id uuid, p_org_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller      uuid := auth.uid();
  v_target_role public.member_role;
  v_memberships int := 0;
  v_numbers     int := 0;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in');
  END IF;

  -- Only a management/principal admin OF THIS ORG may revoke.
  IF NOT public.has_role(v_caller, p_org_id, 'management') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not authorized');
  END IF;

  -- Guard against foot-guns: you can't revoke yourself, and the org OWNER/principal is untouchable
  -- through this path — revoking them would orphan the workspace. Protect by IDENTITY (the
  -- organizations.owner_id that create_workspace stamps) AND by role, so an edited role label can't
  -- expose the owner.
  IF p_user_id = v_caller THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You cannot revoke your own access');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.organizations
    WHERE org_id = p_org_id AND owner_id = p_user_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The workspace owner cannot be revoked');
  END IF;

  SELECT role INTO v_target_role
  FROM public.org_memberships
  WHERE user_id = p_user_id AND org_id = p_org_id;

  IF v_target_role = 'principal' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'The principal (owner) cannot be revoked');
  END IF;

  -- 1) Suspend the app membership (kept as a record, not deleted).
  UPDATE public.org_memberships
     SET status = 'suspended', updated_at = now()
   WHERE user_id = p_user_id AND org_id = p_org_id AND status <> 'suspended';
  GET DIAGNOSTICS v_memberships = ROW_COUNT;

  -- 2) Revoke the WhatsApp grant so an OTP re-login can't auto-rejoin. accept_phone_invite gates on
  --    invite_status <> 'revoked', so this is what actually holds the door shut.
  UPDATE public.wa_registered_numbers
     SET is_active = false, invite_status = 'revoked'
   WHERE user_id = p_user_id AND org_id = p_org_id;
  GET DIAGNOSTICS v_numbers = ROW_COUNT;

  RETURN jsonb_build_object('ok', true, 'memberships', v_memberships, 'numbers', v_numbers);
END;
$$;

REVOKE ALL     ON FUNCTION public.revoke_member(uuid, uuid) FROM public;
GRANT  EXECUTE ON FUNCTION public.revoke_member(uuid, uuid) TO authenticated;

-- Verify (as a management/principal admin of the org):
--   SELECT public.revoke_member('<user-uuid>', '<org-uuid>');
--   -- expect {"ok": true, "memberships": 1, "numbers": 1}
