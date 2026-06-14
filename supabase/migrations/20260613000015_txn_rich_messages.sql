-- ===========================================================================
-- WhatsApp Sprint 5 -- rich-message staging + abandoned CTA.
--
-- The Transaction agent now sends interactive messages (LIST / reply BUTTONS /
-- CTA), not plain text. The agent builds the full rendered WhatsApp body in TS and
-- passes it as jsonb; these RPCs insert the rough_entries row AND enqueue that
-- rendered body in ONE transaction. For Edit-CTA links the entry id only exists
-- after insert, so the agent embeds the placeholder '__ENTRY_LINK__' and the RPC
-- substitutes "<link_base>?entry=<id>".
-- ===========================================================================

-- Interactive CTA-URL body (used by the abandoned sweep, which builds in SQL).
CREATE OR REPLACE FUNCTION public._wa_cta_body(p_to text, p_body text, p_cta_text text, p_url text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
  SELECT jsonb_build_object(
    'messaging_product','whatsapp','recipient_type','individual','to',p_to,'type','interactive',
    'interactive', jsonb_build_object(
      'type','cta_url',
      'body', jsonb_build_object('text', p_body),
      'action', jsonb_build_object('name','cta_url',
        'parameters', jsonb_build_object('display_text', p_cta_text, 'url', p_url))))
$$;

-- Stage a draft + enqueue a pre-rendered interactive reply, atomically.
CREATE OR REPLACE FUNCTION public.stage_entry_v2(
  p_org_id uuid, p_sender text, p_wamid text, p_status text, p_source text,
  p_sender_name text, p_raw_text text, p_ai jsonb,
  p_payload jsonb, p_rendered jsonb,
  p_link_base text DEFAULT 'https://briklayflow.vercel.app/logbook'
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid; v_link text; v_rendered jsonb; v_payload jsonb;
BEGIN
  INSERT INTO public.rough_entries (org_id, source, raw_text, sender_name, sender_number, ai_extracted, status)
  VALUES (p_org_id, p_source, p_raw_text, p_sender_name, p_sender, p_ai, p_status)
  RETURNING id INTO v_id;

  IF p_rendered IS NOT NULL THEN
    v_link     := p_link_base || '?entry=' || v_id::text;
    v_rendered := replace(p_rendered::text, '__ENTRY_LINK__', v_link)::jsonb;
    v_payload  := replace(COALESCE(p_payload, '{}'::jsonb)::text, '__ENTRY_LINK__', v_link)::jsonb;
    INSERT INTO public.outbox (org_id, target, payload, rendered, wamid)
    VALUES (p_org_id, p_sender, v_payload, v_rendered, p_wamid);
  END IF;
  RETURN v_id;
END $$;

-- Update an existing draft + enqueue a pre-rendered reply, atomically.
CREATE OR REPLACE FUNCTION public.update_entry_v2(
  p_entry_id uuid, p_patch jsonb, p_status text,
  p_org_id uuid, p_sender text, p_wamid text,
  p_payload jsonb, p_rendered jsonb,
  p_link_base text DEFAULT 'https://briklayflow.vercel.app/logbook'
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_link text; v_rendered jsonb; v_payload jsonb;
BEGIN
  UPDATE public.rough_entries
    SET ai_extracted = COALESCE(ai_extracted,'{}'::jsonb) || COALESCE(p_patch,'{}'::jsonb),
        status = COALESCE(p_status, status)
  WHERE id = p_entry_id;

  v_link     := p_link_base || '?entry=' || p_entry_id::text;
  v_rendered := replace(p_rendered::text, '__ENTRY_LINK__', v_link)::jsonb;
  v_payload  := replace(COALESCE(p_payload, '{}'::jsonb)::text, '__ENTRY_LINK__', v_link)::jsonb;
  INSERT INTO public.outbox (org_id, target, payload, rendered, wamid)
  VALUES (p_org_id, p_sender, v_payload, v_rendered, p_wamid);
END $$;

-- A1 FIX: abandoned sweep now enqueues a rich CTA message (was plain text), still
-- atomic with the conversation close. Staged-entry case -> "Saved ... not set" + Edit
-- CTA; no-entry case -> failure text. Idempotent (dedup_key per convo).
CREATE OR REPLACE FUNCTION public.wa_commit_abandoned_conversations(
  p_ttl_minutes int DEFAULT 5, p_link_base text DEFAULT 'https://briklayflow.vercel.app/logbook'
) RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE c record; n int := 0; v_body text; v_payee text; v_amount text; v_link text;
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

REVOKE ALL ON FUNCTION public.stage_entry_v2(uuid,text,text,text,text,text,text,jsonb,jsonb,jsonb,text) FROM public;
REVOKE ALL ON FUNCTION public.update_entry_v2(uuid,jsonb,text,uuid,text,text,jsonb,jsonb,text) FROM public;
GRANT EXECUTE ON FUNCTION public.stage_entry_v2(uuid,text,text,text,text,text,text,jsonb,jsonb,jsonb,text) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_entry_v2(uuid,jsonb,text,uuid,text,text,jsonb,jsonb,text) TO service_role;
