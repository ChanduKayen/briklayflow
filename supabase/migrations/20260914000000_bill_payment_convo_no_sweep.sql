-- A staged BILL that is awaiting its OPTIONAL "did you pay this?" answer opens an OPEN, TRANSACTION-owned
-- wa_conversation (pending_question='AWAIT_BILL_PAYMENT'). The 5-minute abandoned-conversation sweep
-- (wa_commit_abandoned_conversations) treated EVERY open TRANSACTION conversation as an incomplete
-- transaction and fired "Saved — some details not set. Add anytime." at it — but the bill is ALREADY saved;
-- the payment answer is optional. The supervisor sent a clean bill and, five minutes later, got told his
-- entry was missing details. Wrong entry, wrong message.
--
-- Fix: the sweep SKIPS bill-payment conversations. When one ages out, it is closed QUIETLY (the bill stays a
-- record — payment simply left unanswered), with NO outbox nudge. Everything else is unchanged.

CREATE OR REPLACE FUNCTION public.wa_commit_abandoned_conversations(
  p_ttl_minutes int DEFAULT 5, p_link_base text DEFAULT 'https://briklay.app/logbook'
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; n int := 0; v_body text; v_payee text; v_amount text; v_link text;
BEGIN
  -- Bill-payment questions are not incomplete transactions: close them quietly, never nudge. The answer is
  -- optional, so give it a grace period (15 min) before the silent close — long enough that the "Not paid
  -- yet" tap and a late amount reply still land, short enough that it neither nags nor lingers as an open
  -- question that would swallow the sender's next unrelated text as its answer.
  UPDATE public.wa_conversations
    SET status='CLOSED', closed_at=now(), purge_at=now()+interval '2 minutes',
        last_action_summary='Bill saved — payment not answered'
  WHERE status='OPEN' AND owning_agent='TRANSACTION'
    AND pending_question='AWAIT_BILL_PAYMENT'
    AND opened_at < now() - interval '15 minutes';

  FOR c IN
    SELECT * FROM public.wa_conversations
    WHERE status='OPEN' AND owning_agent='TRANSACTION'
      AND COALESCE(pending_question,'') <> 'AWAIT_BILL_PAYMENT'
      AND opened_at < now() - make_interval(mins => p_ttl_minutes)
    FOR UPDATE SKIP LOCKED
  LOOP
    v_payee  := COALESCE(c.slots_so_far->>'payee', c.slots_so_far->>'payee_raw', '');
    v_amount := COALESCE(c.slots_so_far->>'amount', '');
    IF c.staged_entry_id IS NOT NULL THEN
      v_link := p_link_base || '?entry=' || c.staged_entry_id::text;
      v_body := 'Saved'
                || CASE WHEN v_payee<>'' THEN ' '||v_payee ELSE '' END
                || CASE WHEN v_amount<>'' THEN ' Rs '||v_amount ELSE '' END
                || ' -- some details not set. Add anytime.';
      INSERT INTO public.outbox (org_id, target, payload, rendered, wamid, dedup_key)
      VALUES (c.org_id, c.sender_number,
              jsonb_build_object('kind','cta','body',v_body,'cta',jsonb_build_object('text','Edit','url',v_link)),
              public._wa_cta_body(c.sender_number, v_body, 'Edit', v_link),
              c.last_message_id, 'convo-abandon:'||c.id::text)
      ON CONFLICT (dedup_key) DO NOTHING;
      UPDATE public.wa_conversations
        SET status='CLOSED', closed_at=now(), purge_at=now()+interval '2 minutes',
            last_action_summary='Saved '||v_payee||' '||v_amount||' (incomplete)'
        WHERE id=c.id;
    ELSE
      v_body := 'Could not log that -- I did not catch an amount. Try: paid 5000 to ramu.';
      INSERT INTO public.outbox (org_id, target, payload, rendered, wamid, dedup_key)
      VALUES (c.org_id, c.sender_number, jsonb_build_object('kind','text','body',v_body),
              public._wa_text_body(c.sender_number, v_body), c.last_message_id, 'convo-abandon:'||c.id::text)
      ON CONFLICT (dedup_key) DO NOTHING;
      UPDATE public.wa_conversations SET status='ABANDONED', closed_at=now() WHERE id=c.id;
    END IF;
    n := n + 1;
  END LOOP;
  RETURN n;
END $$;
