-- ===========================================================================
-- WhatsApp Sprint 6.1 — tenant isolation + self-registration via claim token.
--
-- (A) FIX A CROSS-ORG LEAK. wa_registered_numbers RLS was ROLE-only: any
--     management/principal could read/write EVERY org's senders. The org_id
--     column already exists (Sprint 1) but RLS ignored it — so the Day Book
--     banner counted other orgs' numbers and "other senders" from other orgs
--     showed up. Re-scope read+write to the caller's own org.
--
-- (B) SELF-REGISTER FROM "START ON WHATSAPP". A signed-in user (any role) taps
--     "Start on WhatsApp" → we mint a short-lived, single-use claim token tied to
--     their org and pre-fill it into the WhatsApp message. When that number
--     messages Briklay, the webhook reads the token and registers the SENDER's
--     number into that org (active) — so a person redirected from the platform is
--     never met with "you're not registered". Token-gated and expiring (multi-use
--     within a 24h window, so one shared code can onboard a whole team).
-- ===========================================================================

-- ── (A) Org-scoped RLS on wa_registered_numbers ────────────────────────────
DROP POLICY IF EXISTS "staff_read_wa_registered_numbers"  ON public.wa_registered_numbers;
DROP POLICY IF EXISTS "staff_write_wa_registered_numbers" ON public.wa_registered_numbers;
DROP POLICY IF EXISTS "org_rw_wa_registered_numbers"      ON public.wa_registered_numbers;

-- One FOR ALL policy: visible + writable only for the caller's own org, and only
-- to management/principal (matches the prior role gate). The webhook uses the
-- service role and bypasses RLS, so inbound registration is unaffected.
CREATE POLICY "org_rw_wa_registered_numbers"
  ON public.wa_registered_numbers FOR ALL
  USING (
    org_id IN (SELECT public.get_my_org_ids())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('management','principal'))
  )
  WITH CHECK (
    org_id IN (SELECT public.get_my_org_ids())
    AND EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('management','principal'))
  );

-- ── (B) Claim tokens ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.wa_link_tokens (
  token         TEXT PRIMARY KEY,                 -- e.g. 'BK-1A2B3C4D'
  org_id        UUID NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  user_id       UUID REFERENCES auth.users(id) ON DELETE SET NULL,  -- who minted it (audit)
  name          TEXT,                             -- fallback display name
  role          TEXT NOT NULL DEFAULT 'Supervisor',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ NOT NULL DEFAULT now() + INTERVAL '24 hours',
  used_at       TIMESTAMPTZ,            -- last claim (a code may onboard several teammates)
  claimed_phone TEXT                    -- last number that claimed it
);
ALTER TABLE public.wa_link_tokens ENABLE ROW LEVEL SECURITY;
-- No client policies: only the SECURITY DEFINER RPCs below ever touch this table.

-- Mint a token for the current member's org. Returns the token string.
CREATE OR REPLACE FUNCTION public.wa_create_link_token()
RETURNS TEXT
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_org uuid; v_name text; v_role text; v_token text;
BEGIN
  SELECT m.org_id INTO v_org
  FROM public.org_memberships m
  WHERE m.user_id = auth.uid() AND m.status = 'active'
  ORDER BY m.joined_at NULLS LAST LIMIT 1;
  IF v_org IS NULL THEN RAISE EXCEPTION 'no active organisation for this user'; END IF;

  SELECT name, role INTO v_name, v_role FROM public.user_profiles WHERE id = auth.uid();
  v_token := 'BK-' || upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 8));

  INSERT INTO public.wa_link_tokens (token, org_id, user_id, name, role)
  VALUES (v_token, v_org, auth.uid(),
          nullif(btrim(coalesce(v_name, '')), ''),
          initcap(coalesce(nullif(btrim(v_role), ''), 'Supervisor')));
  RETURN v_token;
END $$;
REVOKE ALL  ON FUNCTION public.wa_create_link_token() FROM public;
GRANT EXECUTE ON FUNCTION public.wa_create_link_token() TO authenticated;

-- Claim a token for an inbound number (webhook / service role only). Registers the
-- number into the token's org as an active sender and consumes the token. The
-- inbound sender's WhatsApp profile name wins for display; org-link is what matters
-- (user_id is left for an admin to associate later, avoiding a shared-QR mis-link).
CREATE OR REPLACE FUNCTION public.wa_claim_link_token(p_phone text, p_token text, p_wa_name text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_to text; v_tok record; v_name text;
BEGIN
  v_to := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF length(v_to) = 10 THEN v_to := '91' || v_to; END IF;

  -- Multi-use within the 24h window: one code can onboard several teammates (shared
  -- QR). Low harm — a registered number can only submit entries for owner review.
  SELECT * INTO v_tok FROM public.wa_link_tokens
  WHERE token = upper(btrim(coalesce(p_token, ''))) AND expires_at > now()
  FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false); END IF;

  v_name := coalesce(nullif(btrim(coalesce(p_wa_name, '')), ''), v_tok.name);

  INSERT INTO public.wa_registered_numbers (phone_number, name, role, is_active, invite_status, org_id)
  VALUES (v_to, v_name, v_tok.role, true, 'active', v_tok.org_id)
  ON CONFLICT (phone_number) DO UPDATE SET
    is_active     = true,
    invite_status = 'active',
    org_id        = COALESCE(public.wa_registered_numbers.org_id, EXCLUDED.org_id),
    name          = COALESCE(public.wa_registered_numbers.name, EXCLUDED.name);

  UPDATE public.wa_link_tokens SET used_at = now(), claimed_phone = v_to WHERE token = v_tok.token;
  RETURN jsonb_build_object('ok', true, 'org_id', v_tok.org_id);
END $$;
REVOKE ALL  ON FUNCTION public.wa_claim_link_token(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_claim_link_token(text, text, text) TO service_role;
