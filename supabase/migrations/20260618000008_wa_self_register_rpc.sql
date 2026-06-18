-- ===========================================================================
-- WhatsApp Sprint 6.2 — "Start on WhatsApp" flips to OUTBOUND self-registration.
--
-- Old flow: the user messaged Briklay inbound and a webhook claimed a token.
-- New flow: the user types their OWN number on the card, we register it on the
-- spot AND send them the approved `teammate_welcome_to_whatsapp_utility` template
-- (a utility template delivers unprompted, no 24h window). They reply and they're
-- live. Smoother, and it works the same on mobile and desktop.
--
-- RLS on wa_registered_numbers is management/principal only (Sprint 6.1), so a
-- plain supervisor/accountant CANNOT insert their own row from the client. These
-- two SECURITY DEFINER RPCs let any signed-in member register THEIR OWN number
-- and stamp the one-time welcome — scoped to auth.uid(), never another person's.
-- ===========================================================================

-- Register the CALLER's own WhatsApp number into their org, active + linked to
-- their account. Returns whether a welcome still needs sending (so the client can
-- send the template once and never re-send). A number already registered to
-- another org is re-claimed to the caller — they control the number (they typed
-- it from their own session), mirroring wa_claim_link_token's claim semantics.
CREATE OR REPLACE FUNCTION public.wa_self_register(p_phone text)
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

  SELECT m.org_id INTO v_org
  FROM public.org_memberships m
  WHERE m.user_id = v_uid AND m.status = 'active'
  ORDER BY m.joined_at NULLS LAST LIMIT 1;
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
REVOKE ALL  ON FUNCTION public.wa_self_register(text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_self_register(text) TO authenticated;

-- Read-only: does the CALLER already have a number on file, and have they been
-- welcomed yet? Drives the "Start on WhatsApp" card — a registered user skips the
-- number form and goes straight to WhatsApp (greeted by the template on their first
-- time, plain "Hi Briklay" thereafter). RLS on wa_registered_numbers is admin-only,
-- so a plain member needs this SECURITY DEFINER read to see their own row. Prefers
-- an active, already-welcomed row when several exist.
CREATE OR REPLACE FUNCTION public.wa_my_registration()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_uid uuid := auth.uid(); v_row record;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('has_number', false); END IF;

  SELECT phone_number, welcomed_at, name, is_active INTO v_row
  FROM public.wa_registered_numbers
  WHERE user_id = v_uid
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
REVOKE ALL  ON FUNCTION public.wa_my_registration() FROM public;
GRANT EXECUTE ON FUNCTION public.wa_my_registration() TO authenticated;

-- Stamp the one-time welcome AFTER the client confirms the template went out.
-- Scoped to the caller's own row + only when still NULL, so a failed send (which
-- skips this call) leaves welcomed_at NULL and a retry still greets them.
CREATE OR REPLACE FUNCTION public.wa_mark_welcomed(p_phone text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_to text;
BEGIN
  v_to := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF length(v_to) = 10 THEN v_to := '91' || v_to; END IF;
  UPDATE public.wa_registered_numbers
     SET welcomed_at = now()
   WHERE phone_number = v_to AND user_id = auth.uid() AND welcomed_at IS NULL;
END $$;
REVOKE ALL  ON FUNCTION public.wa_mark_welcomed(text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_mark_welcomed(text) TO authenticated;
