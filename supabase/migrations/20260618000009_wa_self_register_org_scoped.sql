-- ===========================================================================
-- WhatsApp Sprint 6.2.1 — make self-registration ORG-SCOPED.
--
-- Bug: a self-registered number wasn't showing in Day Book → "Manage who can
-- send". Root cause: the org the row landed in could differ from the org the app
-- is viewing. `wa_self_register` picked the caller's earliest ACTIVE membership,
-- while the app's current org comes from `get_membership_context` (no status
-- filter, no ordering). For anyone with more than one membership row (e.g. a
-- teammate with a pending invite alongside an active org), the two disagree — the
-- number registers into org A while the team panel reads org B, so it never shows.
--
-- Fix: the client already knows which org it's acting in (useOrgId) — pass it in.
--   • wa_self_register(p_phone, p_org_id) registers into p_org_id when the caller
--     is an active member of it (else falls back to the old pick).
--   • wa_my_registration(p_org_id) only reports "registered" for a row IN that org,
--     so the button re-registers per org instead of treating an other-org row as done.
-- Both keep p_org_id optional (default null → previous behaviour).
-- ===========================================================================

DROP FUNCTION IF EXISTS public.wa_self_register(text);
CREATE OR REPLACE FUNCTION public.wa_self_register(p_phone text, p_org_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_uid  uuid := auth.uid();
  v_org  uuid;
  v_name text;
  v_role text;
  v_to   text;
  v_existing record;
  v_needs_welcome boolean := true;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Not signed in');
  END IF;

  v_to := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF length(v_to) = 10 THEN v_to := '91' || v_to; END IF;
  IF length(v_to) < 11 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enter a 10-digit WhatsApp number');
  END IF;

  -- Prefer the org the app is acting in, as long as the caller belongs to it.
  IF p_org_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.org_memberships
    WHERE user_id = v_uid AND org_id = p_org_id AND status = 'active'
  ) THEN
    v_org := p_org_id;
  ELSE
    SELECT m.org_id INTO v_org
    FROM public.org_memberships m
    WHERE m.user_id = v_uid AND m.status = 'active'
    ORDER BY m.joined_at NULLS LAST LIMIT 1;
  END IF;
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No active organisation for this account');
  END IF;

  SELECT name, role INTO v_name, v_role FROM public.user_profiles WHERE id = v_uid;
  v_name := nullif(btrim(coalesce(v_name, '')), '');
  v_role := initcap(coalesce(nullif(btrim(v_role), ''), 'Supervisor'));

  -- Already welcomed on this number? Then don't re-send — just confirm they're set.
  SELECT * INTO v_existing FROM public.wa_registered_numbers WHERE phone_number = v_to;
  IF FOUND AND v_existing.welcomed_at IS NOT NULL THEN v_needs_welcome := false; END IF;

  INSERT INTO public.wa_registered_numbers
    (phone_number, name, role, is_active, invite_status, org_id, user_id)
  VALUES (v_to, v_name, v_role, true, 'active', v_org, v_uid)
  ON CONFLICT (phone_number) DO UPDATE SET
    is_active     = true,
    invite_status = 'active',
    org_id        = EXCLUDED.org_id,
    user_id       = EXCLUDED.user_id,
    name          = COALESCE(public.wa_registered_numbers.name, EXCLUDED.name);

  RETURN jsonb_build_object(
    'ok', true,
    'phone', v_to,
    'name', coalesce(nullif(split_part(coalesce(v_name, ''), ' ', 1), ''), 'there'),
    'needs_welcome', v_needs_welcome
  );
END $$;
REVOKE ALL  ON FUNCTION public.wa_self_register(text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_self_register(text, uuid) TO authenticated;

DROP FUNCTION IF EXISTS public.wa_my_registration();
CREATE OR REPLACE FUNCTION public.wa_my_registration(p_org_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('has_number', false); END IF;

  -- Scope to the requested org so the button registers per org (a row in a
  -- different org doesn't count as "already on WhatsApp" here).
  SELECT phone_number, welcomed_at, name, is_active INTO v_row
  FROM public.wa_registered_numbers
  WHERE user_id = v_uid
    AND (p_org_id IS NULL OR org_id = p_org_id)
  ORDER BY is_active DESC, (welcomed_at IS NOT NULL) DESC, created_at DESC
  LIMIT 1;
  IF NOT FOUND THEN RETURN jsonb_build_object('has_number', false); END IF;

  RETURN jsonb_build_object(
    'has_number', true,
    'phone',      v_row.phone_number,
    'welcomed',   v_row.welcomed_at IS NOT NULL,
    'name',       coalesce(nullif(split_part(coalesce(v_row.name, ''), ' ', 1), ''), 'there')
  );
END $$;
REVOKE ALL  ON FUNCTION public.wa_my_registration(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_my_registration(uuid) TO authenticated;
