-- ===========================================================================
-- WhatsApp Sprint 4 -- Transaction agent: transactional staging + outbox.
--
-- The commit-always contract needs the rough_entries write and its WhatsApp
-- acknowledgment to be ONE atomic DB transaction (T1.3 transactional outbox):
-- never a committed entry without a reply, nor a reply without an entry. These
-- SECURITY DEFINER RPCs do both inserts (or update + insert) in one statement
-- and build the deep link from the generated entry id.
-- ===========================================================================

-- Build the rendered WhatsApp text body for a plain text reply.
CREATE OR REPLACE FUNCTION public._wa_text_body(p_to text, p_text text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'messaging_product','whatsapp','recipient_type','individual','to',p_to,
    'type','text','text', jsonb_build_object('preview_url',false,'body',p_text))
$$;

-- Stage a rough_entries draft (+ optionally enqueue the ack) atomically.
-- p_message NULL -> entry only (used when the caller will send a consolidated
-- message elsewhere). Otherwise the deep link "<base>?entry=<id>" is appended to
-- p_message and the outbox row is enqueued in the SAME transaction.
CREATE OR REPLACE FUNCTION public.stage_rough_entry(
  p_org_id uuid, p_sender text, p_wamid text, p_status text, p_source text,
  p_sender_name text, p_raw_text text, p_ai_extracted jsonb,
  p_message text DEFAULT NULL, p_link_base text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_body text;
BEGIN
  INSERT INTO public.rough_entries (org_id, source, raw_text, sender_name, sender_number, ai_extracted, status)
  VALUES (p_org_id, p_source, p_raw_text, p_sender_name, p_sender, p_ai_extracted, p_status)
  RETURNING id INTO v_id;

  IF p_message IS NOT NULL THEN
    v_body := p_message || CASE WHEN p_link_base IS NOT NULL
                THEN E'\n' || p_link_base || '?entry=' || v_id::text ELSE '' END;
    INSERT INTO public.outbox (org_id, target, payload, rendered, wamid)
    VALUES (p_org_id, p_sender, jsonb_build_object('kind','text','body',v_body),
            public._wa_text_body(p_sender, v_body), p_wamid);
  END IF;
  RETURN v_id;
END $$;

-- Update an existing draft (patch ai_extracted, optional status) + enqueue a
-- reply, atomically. Used to resolve a slot (e.g. project) on the next turn.
CREATE OR REPLACE FUNCTION public.update_rough_entry_reply(
  p_entry_id uuid, p_patch jsonb, p_status text,
  p_org_id uuid, p_sender text, p_wamid text,
  p_message text, p_link_base text DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_body text;
BEGIN
  UPDATE public.rough_entries
    SET ai_extracted = COALESCE(ai_extracted,'{}'::jsonb) || COALESCE(p_patch,'{}'::jsonb),
        status = COALESCE(p_status, status)
  WHERE id = p_entry_id;

  v_body := p_message || CASE WHEN p_link_base IS NOT NULL
              THEN E'\n' || p_link_base || '?entry=' || p_entry_id::text ELSE '' END;
  INSERT INTO public.outbox (org_id, target, payload, rendered, wamid)
  VALUES (p_org_id, p_sender, jsonb_build_object('kind','text','body',v_body),
          public._wa_text_body(p_sender, v_body), p_wamid);
END $$;

-- Discard a staged draft (cancel) + enqueue the confirmation, atomically.
CREATE OR REPLACE FUNCTION public.discard_rough_entry(
  p_entry_id uuid, p_org_id uuid, p_sender text, p_wamid text, p_message text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF p_entry_id IS NOT NULL THEN
    UPDATE public.rough_entries SET status = 'DISMISSED' WHERE id = p_entry_id;
  END IF;
  INSERT INTO public.outbox (org_id, target, payload, rendered, wamid)
  VALUES (p_org_id, p_sender, jsonb_build_object('kind','text','body',p_message),
          public._wa_text_body(p_sender, p_message), p_wamid);
END $$;

-- Abandoned-conversation sweep (the timeout commit trigger). For OPEN TRANSACTION
-- conversations older than the TTL:
--   * with a staged_entry_id (amount was present, draft already committed) ->
--     "Saved ... <missing> not set, edit anytime" + CLOSE (lingering).
--   * without a staged_entry_id (awaiting amount, gate 1) -> "couldn't log, no
--     amount" + ABANDONED (no commit). Idempotent; enqueue deduped per convo.
CREATE OR REPLACE FUNCTION public.wa_commit_abandoned_conversations(
  p_ttl_minutes int DEFAULT 5, p_link_base text DEFAULT 'https://briklay.app/logbook'
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; n int := 0; v_body text; v_payee text; v_amount text;
BEGIN
  FOR c IN
    SELECT * FROM public.wa_conversations
    WHERE status='OPEN' AND owning_agent='TRANSACTION'
      AND opened_at < now() - make_interval(mins => p_ttl_minutes)
    FOR UPDATE SKIP LOCKED
  LOOP
    v_payee  := COALESCE(c.slots_so_far->>'payee', c.slots_so_far->>'payee_raw', '');
    v_amount := COALESCE(c.slots_so_far->>'amount', '');
    IF c.staged_entry_id IS NOT NULL THEN
      v_body := 'Saved' || CASE WHEN v_payee<>'' THEN ' '||v_payee ELSE '' END
                || CASE WHEN v_amount<>'' THEN ' Rs '||v_amount ELSE '' END
                || ' -- some details not set, edit anytime.'
                || E'\n' || p_link_base || '?entry=' || c.staged_entry_id::text;
      INSERT INTO public.outbox (org_id, target, payload, rendered, wamid, dedup_key)
      VALUES (c.org_id, c.sender_number, jsonb_build_object('kind','text','body',v_body),
              public._wa_text_body(c.sender_number, v_body), c.last_message_id, 'convo-abandon:'||c.id::text)
      ON CONFLICT (dedup_key) DO NOTHING;
      UPDATE public.wa_conversations
        SET status='CLOSED', closed_at=now(), purge_at=now()+interval '2 minutes',
            last_action_summary='Saved '||v_payee||' '||v_amount||' (incomplete)'
        WHERE id=c.id;
    ELSE
      v_body := 'Could not log that -- no amount. Try "paid 5000 to ramu".';
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

REVOKE ALL ON FUNCTION public.stage_rough_entry(uuid,text,text,text,text,text,text,jsonb,text,text) FROM public;
REVOKE ALL ON FUNCTION public.update_rough_entry_reply(uuid,jsonb,text,uuid,text,text,text,text) FROM public;
REVOKE ALL ON FUNCTION public.discard_rough_entry(uuid,uuid,text,text,text) FROM public;
REVOKE ALL ON FUNCTION public.wa_commit_abandoned_conversations(int,text) FROM public;
GRANT EXECUTE ON FUNCTION public.stage_rough_entry(uuid,text,text,text,text,text,text,jsonb,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_rough_entry_reply(uuid,jsonb,text,uuid,text,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.discard_rough_entry(uuid,uuid,text,text,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.wa_commit_abandoned_conversations(int,text) TO service_role, postgres;
