-- accept_phone_invite() — sync user_profiles.org_id so org-mates can SEE the teammate.
--
-- THE BUG (invisible teammate): an admin invites a teammate; the teammate logs in by phone; a correct,
-- org-scoped org_memberships row is created — yet they never appear on the /team page. Cause is RLS,
-- not membership: the "user_profiles org read" policy is
--     USING (org_id IN (SELECT public.get_my_org_ids()))
-- but a phone teammate's profile is created by handle_new_user with only (id, name, role) — org_id is
-- LEFT NULL — and accept_phone_invite never set it. So the admin's org-read policy cannot return the
-- teammate's user_profiles row, and TeamAccess.tsx drops any membership whose profile it can't read
-- (the two-step join filters on pById.has). The email-invite / create-workspace paths already sync
-- org_id onto the profile (20260520000003); the phone-invite path was the one gap.
--
-- THE FIX: on accept, set user_profiles.org_id to the org being joined (this is what the org-read RLS
-- keys on), alongside the placeholder-name backfill from 20260827000004. Supersedes that function def.

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
    RETURN jsonb_build_object('ok', false, 'error', 'no verified phone');
  END IF;

  -- The number registered to an org. We DELIBERATELY do not filter on user_id: the caller's
  -- ownership of v_phone is OTP-verified, so a stale/foreign user_id must not block them.
  -- phone_number is UNIQUE → at most one row/org. Gate on the grant still being live: an active
  -- member (is_active) or a not-yet-activated invite ('invited'); revoked/disabled is refused.
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
    IF EXISTS (SELECT 1 FROM public.wa_registered_numbers WHERE phone_number = v_phone) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'access revoked for this number');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'no pending invite for this number');
  END IF;

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

  -- Make the profile READABLE to org-mates (org_id is what the org-read RLS keys on) and carry the
  -- invited name — but never clobber a real, self-chosen name (placeholder = blank / 'Member' / the
  -- phone digits handle_new_user stamps for a nameless phone signup).
  UPDATE public.user_profiles up
     SET org_id = v_row.org_id,
         name = CASE
                  WHEN nullif(btrim(coalesce(v_row.wa_name, '')), '') IS NOT NULL
                       AND ( nullif(btrim(coalesce(up.name, '')), '') IS NULL
                             OR up.name = 'Member'
                             OR regexp_replace(up.name, '\D', '', 'g') = v_phone )
                  THEN btrim(v_row.wa_name)
                  ELSE up.name
                END
   WHERE up.id = v_uid;

  RETURN jsonb_build_object(
    'ok', true,
    'org_id', v_row.org_id,
    'org_name', v_row.org_name,
    'reclaimed_from', CASE WHEN v_row.prev_user_id IS DISTINCT FROM v_uid
                          THEN v_row.prev_user_id ELSE NULL END
  );
END;
$$;

REVOKE ALL     ON FUNCTION public.accept_phone_invite() FROM public;
GRANT  EXECUTE ON FUNCTION public.accept_phone_invite() TO authenticated;

-- One-time repair for teammates who ALREADY joined but whose profile has no org_id (so they're
-- currently invisible to org-mates). Fill it from their active membership; only touch NULLs.
UPDATE public.user_profiles up
   SET org_id = m.org_id
  FROM public.org_memberships m
 WHERE m.user_id = up.id
   AND m.status  = 'active'
   AND up.org_id IS NULL;

-- And re-run the placeholder-name repair from 20260827000004 (idempotent) for good measure.
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
