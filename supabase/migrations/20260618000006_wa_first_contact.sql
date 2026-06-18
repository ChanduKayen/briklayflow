-- ===========================================================================
-- WhatsApp Sprint 6 — first-contact & sender-relationship handling.
--
-- Models WHO a sender is and whether this is their FIRST touch, so the inbound
-- webhook can stop dead-ending unknown numbers and stop treating a brand-new
-- teammate's first message like a veteran's. Three additions:
--
--   1. wa_registered_numbers.oriented_at   — member first-touch idempotency
--      (NULL = never oriented; the webhook orients once, then stamps).
--
--   2. wa_registered_numbers.invite_status — distinguishes a row that should
--      SELF-ACTIVATE on first contact ('invited') from a normal active row
--      ('active') and from one a manager deliberately disabled ('revoked',
--      which must NEVER auto-reactivate). Lets a manager pre-register a phone
--      WITHOUT sending a proactive template: the teammate's first inbound
--      message opens the 24h window and flips them active.
--
--   3. wa_prospects + wa_prospect_touch() — unknown numbers (not registered):
--      greet warmly, capture as a lead, nudge to set up ONCE, and rate-limit
--      replies so a stranger (or abuse) can't run up LLM/Meta cost.
--
-- All purely additive. Existing rows default to invite_status='active' and
-- oriented_at=NULL, so current behaviour is unchanged except that an unoriented
-- member now gets one orientation on their next message.
-- ===========================================================================

-- ── 1 + 2. Sender-state columns ────────────────────────────────────────────
ALTER TABLE public.wa_registered_numbers
  ADD COLUMN IF NOT EXISTS oriented_at   TIMESTAMPTZ;

ALTER TABLE public.wa_registered_numbers
  ADD COLUMN IF NOT EXISTS invite_status TEXT NOT NULL DEFAULT 'active';

-- Constrain to the three states. Drop-then-add so re-running the migration is safe.
ALTER TABLE public.wa_registered_numbers
  DROP CONSTRAINT IF EXISTS wa_registered_numbers_invite_status_chk;
ALTER TABLE public.wa_registered_numbers
  ADD  CONSTRAINT wa_registered_numbers_invite_status_chk
       CHECK (invite_status IN ('active','invited','revoked'));

COMMENT ON COLUMN public.wa_registered_numbers.oriented_at IS
  'When the one-time first-contact orientation was sent; NULL = never oriented.';
COMMENT ON COLUMN public.wa_registered_numbers.invite_status IS
  'active = normal sender; invited = pre-registered, self-activates (is_active flips true) on first inbound; revoked = disabled, never auto-reactivates.';

-- ── 3. Prospects (unknown numbers — lead capture + nudge/rate-limit state) ──
CREATE TABLE IF NOT EXISTS public.wa_prospects (
  phone_number       TEXT PRIMARY KEY,        -- canonical '91' + 10 digits, as Meta delivers `from`
  first_seen_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  first_message_text TEXT,                     -- the very first thing they said (lead context)
  last_message_text  TEXT,
  reply_count        INTEGER NOT NULL DEFAULT 0,   -- lifetime concierge replies we've sent them
  reply_window_date  DATE,                     -- the day `replies_today` is counting
  replies_today      INTEGER NOT NULL DEFAULT 0,   -- replies sent within reply_window_date (daily cap)
  nudged_at          TIMESTAMPTZ,              -- when we sent the "set up Briklay" nudge (once)
  lead_status        TEXT NOT NULL DEFAULT 'new',  -- new | engaged | converted | ignored (manual triage)
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.wa_prospects IS
  'Unknown WhatsApp senders (not in wa_registered_numbers). Doubles as an inbound lead list. Service-role writes only; management may read.';

ALTER TABLE public.wa_prospects ENABLE ROW LEVEL SECURITY;

-- Lead data: management/principal may read it; nobody but the service role writes.
DROP POLICY IF EXISTS wa_prospects_mgmt_read ON public.wa_prospects;
CREATE POLICY wa_prospects_mgmt_read ON public.wa_prospects
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('management','principal')
  ));

-- ── wa_prospect_touch(): atomic per-number upsert + daily rate-limit gate ───
-- Called by the webhook (service role) on every inbound from an UNKNOWN number.
-- Reserves one reply slot under the daily cap and reports whether this is the
-- sender's first-ever touch — so the handler greets+nudges once, then keeps
-- replies minimal, and silently drops once the cap is hit. Everything is decided
-- in one statement so concurrent webhooks for the same number can't double-count.
CREATE OR REPLACE FUNCTION public.wa_prospect_touch(p_phone text, p_text text)
RETURNS TABLE (first_touch boolean, capped boolean, reply_count integer)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_to       text;
  v_cap      constant integer := 8;   -- max concierge replies per number per day
  v_existed  boolean;
BEGIN
  v_to := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  IF length(v_to) = 10 THEN v_to := '91' || v_to; END IF;

  SELECT TRUE INTO v_existed FROM public.wa_prospects WHERE phone_number = v_to;
  v_existed := COALESCE(v_existed, FALSE);

  INSERT INTO public.wa_prospects AS p (
    phone_number, first_message_text, last_message_text,
    reply_window_date, replies_today, reply_count, nudged_at
  )
  VALUES (
    v_to, left(p_text, 2000), left(p_text, 2000),
    current_date, 1, 1, now()           -- first touch: greeted + nudged now
  )
  ON CONFLICT (phone_number) DO UPDATE SET
    last_seen_at      = now(),
    last_message_text = left(p_text, 2000),
    -- roll the daily window over at date change
    replies_today     = CASE WHEN p.reply_window_date = current_date THEN p.replies_today ELSE 0 END,
    reply_window_date = current_date
  RETURNING (NOT v_existed), (p.replies_today >= v_cap), p.reply_count
    INTO first_touch, capped, reply_count;

  -- On a returning, uncapped touch, charge one reply slot. (First-touch already
  -- counted its reply in the INSERT branch above.)
  IF v_existed AND NOT capped THEN
    UPDATE public.wa_prospects
       SET replies_today = replies_today + 1,
           reply_count   = reply_count + 1
     WHERE phone_number = v_to
     RETURNING reply_count INTO reply_count;
  END IF;

  RETURN NEXT;
END $$;

REVOKE ALL ON FUNCTION public.wa_prospect_touch(text, text) FROM public;
-- service-role only (the webhook). Not granted to authenticated.

-- ── wa_invite_number(): pre-register a phone that self-activates on contact ──
-- A manager invites a teammate by PHONE without paying for / waiting on a
-- proactive template: insert is_active=false, invite_status='invited'. The
-- webhook flips it active on the teammate's first inbound message (which opens
-- Meta's 24h window) and orients them. If the number already exists we DON'T
-- silently re-arm a revoked/active row — we only (re)arm one that isn't active.
CREATE OR REPLACE FUNCTION public.wa_invite_number(p_phone text, p_name text, p_role text DEFAULT 'Supervisor')
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_org uuid;
  v_to  text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role IN ('management','principal')
  ) THEN
    RAISE EXCEPTION 'not authorized to invite WhatsApp numbers';
  END IF;

  v_to := regexp_replace(coalesce(p_phone,''), '\D', '', 'g');
  IF length(v_to) = 10 THEN v_to := '91' || v_to; END IF;
  IF length(v_to) < 11 THEN RAISE EXCEPTION 'invalid phone number'; END IF;

  SELECT m.org_id INTO v_org
  FROM public.org_memberships m
  WHERE m.user_id = auth.uid() AND m.status = 'active'
  ORDER BY m.joined_at NULLS LAST
  LIMIT 1;
  IF v_org IS NULL THEN
    SELECT org_id INTO v_org FROM public.organizations
    WHERE status = 'active' ORDER BY created_at LIMIT 1;
  END IF;

  INSERT INTO public.wa_registered_numbers (phone_number, name, role, is_active, invite_status, org_id)
  VALUES (v_to, nullif(btrim(coalesce(p_name,'')), ''), coalesce(nullif(btrim(p_role),''),'Supervisor'),
          FALSE, 'invited', v_org)
  ON CONFLICT (phone_number) DO UPDATE SET
    -- only re-arm a number that ISN'T currently active; never touch an active or
    -- deliberately-revoked row (a manager's disable must stick).
    invite_status = CASE WHEN public.wa_registered_numbers.is_active THEN public.wa_registered_numbers.invite_status
                         ELSE 'invited' END,
    name          = COALESCE(public.wa_registered_numbers.name, EXCLUDED.name),
    org_id        = COALESCE(public.wa_registered_numbers.org_id, EXCLUDED.org_id);
END $$;

REVOKE ALL  ON FUNCTION public.wa_invite_number(text, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_invite_number(text, text, text) TO authenticated;
