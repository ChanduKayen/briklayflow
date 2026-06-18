-- ===========================================================================
-- Day Book — WhatsApp welcome message on grant of send-access.
--
-- When an admin makes a teammate eligible to send on WhatsApp (the Manage-team
-- slide-over), we greet them with a one-time welcome. The client cannot write to
-- `outbox` (server-internal, RLS deny-all), so this SECURITY DEFINER RPC enqueues
-- the message; the existing drainer sends it through Meta.
--
-- Idempotent: dedup_key 'welcome:<intl-number>' + ON CONFLICT DO NOTHING means a
-- number is welcomed at most once, so re-enabling never double-sends.
--
-- DELIVERY CAVEAT: a free-form text only delivers inside Meta's 24h customer-
-- service window (i.e. if the person has messaged Briklay recently). Outside it,
-- Meta rejects until an approved template is used — the enqueue still happens and
-- the rejection is now visible in the drainer's [wa-send] log.
-- ===========================================================================

CREATE OR REPLACE FUNCTION public.wa_send_welcome(p_phone text, p_name text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org  uuid;
  v_to   text;
  v_name text;
  v_body text;
BEGIN
  -- Only management/principal may trigger an outbound message.
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('management','principal')
  ) THEN
    RAISE EXCEPTION 'not authorized to send WhatsApp messages';
  END IF;

  -- Normalise to an international, digits-only MSISDN (local 10-digit -> +91).
  v_to := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  IF length(v_to) = 10 THEN v_to := '91' || v_to; END IF;
  IF length(v_to) < 11 THEN RAISE EXCEPTION 'invalid phone number'; END IF;

  v_name := nullif(btrim(coalesce(p_name,'')), '');

  -- Caller's active org; fall back to the single active org.
  SELECT m.org_id INTO v_org
  FROM public.org_memberships m
  WHERE m.user_id = auth.uid() AND m.status = 'active'
  ORDER BY m.joined_at NULLS LAST
  LIMIT 1;
  IF v_org IS NULL THEN
    SELECT org_id INTO v_org FROM public.organizations
    WHERE status = 'active' ORDER BY created_at LIMIT 1;
  END IF;

  v_body :=
    '👋 Welcome' || CASE WHEN v_name IS NOT NULL THEN ', ' || v_name ELSE '' END || '!' || E'\n\n' ||
    'We''re excited to have you on board.' || E'\n\n' ||
    'Starting today, you can submit transactions directly through WhatsApp.' || E'\n\n' ||
    'Simply send:' || E'\n' ||
    '🎤 Voice notes' || E'\n' ||
    '💬 Text messages' || E'\n' ||
    '📷 Bill photos' || E'\n' ||
    '📄 Documents' || E'\n\n' ||
    'No special formats. No extra steps.' || E'\n\n' ||
    'Just share the information the way you normally would, and Briklay will take care of the rest.' || E'\n\n' ||
    'Welcome to the team.' || E'\n\n' ||
    '— Briklay';

  INSERT INTO public.outbox (org_id, target, payload, rendered, dedup_key)
  VALUES (
    v_org,
    v_to,
    jsonb_build_object('kind','text','body',v_body),
    public._wa_text_body(v_to, v_body),
    'welcome:' || v_to
  )
  ON CONFLICT (dedup_key) DO NOTHING;
END $$;

REVOKE ALL  ON FUNCTION public.wa_send_welcome(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_send_welcome(text, text) TO authenticated;
