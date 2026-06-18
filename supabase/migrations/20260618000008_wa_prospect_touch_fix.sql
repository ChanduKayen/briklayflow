-- ===========================================================================
-- Fix: wa_prospect_touch raised 42702 "column reference reply_count is ambiguous".
--
-- The function's OUT parameter was named `reply_count`, the same as the
-- wa_prospects.reply_count COLUMN — so the bare `reply_count` references in the
-- UPDATE were ambiguous and the prospect path crashed. The webhook only consumes
-- first_touch + capped, so we drop reply_count from the return entirely (the
-- column is still incremented in the table). Changing the return shape needs a
-- DROP first (CREATE OR REPLACE can't alter a function's return type).
-- ===========================================================================

DROP FUNCTION IF EXISTS public.wa_prospect_touch(text, text);

CREATE FUNCTION public.wa_prospect_touch(p_phone text, p_text text)
RETURNS TABLE (first_touch boolean, capped boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_to      text;
  v_cap     constant integer := 8;   -- max concierge replies per number per day
  v_existed boolean;
BEGIN
  v_to := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  IF length(v_to) = 10 THEN v_to := '91' || v_to; END IF;

  SELECT TRUE INTO v_existed FROM public.wa_prospects WHERE phone_number = v_to;
  v_existed := COALESCE(v_existed, FALSE);

  INSERT INTO public.wa_prospects AS p (
    phone_number, first_message_text, last_message_text,
    reply_window_date, replies_today, reply_count, nudged_at
  )
  VALUES (v_to, left(p_text, 2000), left(p_text, 2000), current_date, 1, 1, now())
  ON CONFLICT (phone_number) DO UPDATE SET
    last_seen_at      = now(),
    last_message_text = left(p_text, 2000),
    -- roll the daily window over at date change
    replies_today     = CASE WHEN p.reply_window_date = current_date THEN p.replies_today ELSE 0 END,
    reply_window_date = current_date
  RETURNING (NOT v_existed), (p.replies_today >= v_cap)
  INTO first_touch, capped;

  -- Returning, uncapped touch → charge one reply (first touch already counted 1).
  IF v_existed AND NOT capped THEN
    UPDATE public.wa_prospects
       SET replies_today = replies_today + 1,
           reply_count   = reply_count + 1
     WHERE phone_number = v_to;
  END IF;

  RETURN NEXT;
END $$;

REVOKE ALL  ON FUNCTION public.wa_prospect_touch(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.wa_prospect_touch(text, text) TO service_role;
