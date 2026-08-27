-- accept_phone_invite() — phone-VERIFIED ownership wins over a stale user_id stamp.
--
-- THE BUG: a returning phone user was treated as brand-new on every login (routed to
-- "create your own workspace" instead of the org they belong to). Cause: the number's
-- wa_registered_numbers row was already stamped with a DIFFERENT, stale user_id — a prior
-- signup for the same number (a deleted test account, or a member an admin connected in
-- Manage-team, which writes user_id = the member's profile id). The old guard
--     (n.user_id IS NULL OR n.user_id = v_uid)
-- then refused to convert the invite for the CURRENT auth user, so no membership was ever
-- created and the resolver fell through to create-workspace.
--
-- THE PRINCIPLE: the number in v_phone comes from auth.jwt()->>'phone' — OTP-verified, so
-- the caller has cryptographically PROVEN they own it. That proof out-ranks the user_id
-- column, which is only a cache of "who last claimed it". phone_number is UNIQUE (at most
-- one org → no ambiguity), so matching on the verified phone + a non-null org is sufficient,
-- and we always (re)point the row to the verified caller. This is the same possession-of-
-- number-is-identity model OTP itself is built on; it cannot be abused because a foreign
-- caller can never verify a number they don't control.

CREATE OR REPLACE FUNCTION public.accept_phone_invite()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid       uuid := auth.uid();
  v_phone     text := regexp_replace(coalesce(auth.jwt() ->> 'phone', ''), '\D', '', 'g');
  v_row       record;
  v_role      public.member_role;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in');
  END IF;
  IF length(v_phone) < 11 THEN
    -- No verified phone (an email/Google user) → nothing to do.
    RETURN jsonb_build_object('ok', false, 'error', 'no verified phone');
  END IF;

  -- The number registered to an org. We DELIBERATELY do not filter on user_id: the caller's
  -- ownership of v_phone is OTP-verified, so a stale/foreign user_id must not block them.
  -- phone_number is UNIQUE → at most one row/org, no ambiguity.
  --
  -- BUT we DO gate on the grant still being live. Access is coupled: registering a number for
  -- Day Book WhatsApp is what grants app membership — so a REVOKED/DISABLED number must NOT
  -- auto-join, or "remove this person" would be undone by their next OTP login. A live grant is
  -- an active member (is_active) or a not-yet-activated invite (invite_status='invited');
  -- anything 'revoked', or disabled (is_active=false) without being a pending invite, is refused.
  SELECT n.org_id, n.role, n.user_id AS prev_user_id, o.name AS org_name
    INTO v_row
  FROM public.wa_registered_numbers n
  JOIN public.organizations o ON o.org_id = n.org_id
  WHERE n.phone_number = v_phone
    AND n.org_id IS NOT NULL
    AND n.invite_status <> 'revoked'
    AND (n.is_active = true OR n.invite_status = 'invited')
  LIMIT 1;

  IF NOT FOUND THEN
    -- Distinguish "never registered" from "registered but access revoked" so the caller (and logs)
    -- can tell a genuine new user apart from someone whose access an admin pulled.
    IF EXISTS (SELECT 1 FROM public.wa_registered_numbers WHERE phone_number = v_phone) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'access revoked for this number');
    END IF;
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

  -- Re-point the number to the verified caller (this is what clears a stale prev_user_id).
  UPDATE public.wa_registered_numbers
     SET user_id = v_uid, is_active = true, invite_status = 'active'
   WHERE phone_number = v_phone;

  RETURN jsonb_build_object(
    'ok', true,
    'org_id', v_row.org_id,
    'org_name', v_row.org_name,
    -- surfaced for observability: whether we superseded a prior (stale/foreign) claim.
    'reclaimed_from', CASE WHEN v_row.prev_user_id IS DISTINCT FROM v_uid
                          THEN v_row.prev_user_id ELSE NULL END
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.accept_phone_invite() FROM public;
GRANT  EXECUTE ON FUNCTION public.accept_phone_invite() TO authenticated;

-- Verify (as the signed-in phone user 55ef3f03 with number 919063677779):
--   SELECT public.accept_phone_invite();
--   -- expect {"ok": true, "org_id": "...", "reclaimed_from": "dfaf8739-..."}
