-- accept_phone_invite() — carry the invited NAME onto the profile.
--
-- THE BUG: an admin invites a teammate via Day Book "Manage team". The typed name is stored on
-- wa_registered_numbers.name, but handle_new_user (which fires at auth.users insert) only reads
-- auth metadata — a phone signup with no full_name falls back to the raw phone digits (or 'Member').
-- accept_phone_invite then created the org_memberships row but never copied the invited name across,
-- so the teammate showed in the Team page / Manage-team list as their phone number or "Unnamed".
--
-- THE FIX: this RPC already has the wa_registered_numbers row (with its name) in scope and runs on
-- the teammate's first resolve. Backfill user_profiles.name from wa_name — but ONLY when the current
-- profile name is a placeholder (empty, 'Member', or the phone digits). A teammate who chose their
-- own name on the signup form keeps it. Everything else is verbatim from
-- 20260827000002_accept_phone_invite_verified_owner.sql.

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
  SELECT n.org_id, n.role, n.name AS wa_name, n.user_id AS prev_user_id, o.name AS org_name
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

  -- Carry the invited name onto the profile, but never clobber a real, self-chosen name. A name is a
  -- placeholder when it's blank, the literal 'Member' fallback, or just the phone digits that
  -- handle_new_user stamps for a nameless phone signup.
  IF nullif(btrim(coalesce(v_row.wa_name, '')), '') IS NOT NULL THEN
    UPDATE public.user_profiles up
       SET name = btrim(v_row.wa_name)
     WHERE up.id = v_uid
       AND (
         nullif(btrim(coalesce(up.name, '')), '') IS NULL
         OR up.name = 'Member'
         OR regexp_replace(up.name, '\D', '', 'g') = v_phone
       );
  END IF;

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

-- One-time backfill for teammates who ALREADY joined before this fix — repair placeholder names now,
-- rather than waiting for each to log in again.
UPDATE public.user_profiles up
   SET name = btrim(n.name)
  FROM public.wa_registered_numbers n
 WHERE n.user_id = up.id
   AND nullif(btrim(coalesce(n.name, '')), '') IS NOT NULL
   AND (
     nullif(btrim(coalesce(up.name, '')), '') IS NULL
     OR up.name = 'Member'
     OR regexp_replace(up.name, '\D', '', 'g') = regexp_replace(coalesce(n.phone_number, ''), '\D', '', 'g')
   );
