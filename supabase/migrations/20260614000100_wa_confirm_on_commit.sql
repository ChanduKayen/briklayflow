-- ===========================================================================
-- WhatsApp -- Confirm-on-Commit, Explicit-on-Failure.
--
-- Two things land here:
--   1. wa_failed_writes -- parsed values for a write that DID NOT commit, held so
--      the user can replay it with one tap ([Try again]) instead of re-typing.
--      Server-internal (RLS on, no policies -> only service_role touches it),
--      TTL ~24h, swept by the EXISTING purge cron (purge_wa_conversations).
--   2. stage_entry_v2 gains p_reaction: the clean-entry ✓ reaction is enqueued
--      INSIDE the staging transaction, alongside the rough_entries insert + the
--      confirmation -- so it can only send if the entry actually committed.
-- ===========================================================================

-- -- wa_failed_writes ----------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.wa_failed_writes (
  replay_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id     uuid NOT NULL,
  sender     text NOT NULL,
  parsed     jsonb NOT NULL,              -- the extracted values + raw_text + lang
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '24 hours'
);
CREATE INDEX IF NOT EXISTS wa_failed_writes_expires_idx ON public.wa_failed_writes (expires_at);
CREATE INDEX IF NOT EXISTS wa_failed_writes_org_sender_idx ON public.wa_failed_writes (org_id, sender);

-- Server-internal: RLS on, zero policies -> anon/authenticated can never read it;
-- the service-role webhook (RLS-bypassing) is the only writer/reader.
ALTER TABLE public.wa_failed_writes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wa_failed_writes FROM anon, authenticated;

-- -- Sweep on the existing cron -------------------------------------------------
-- purge_wa_conversations() is already scheduled; fold the failed-writes TTL sweep
-- in so no new cron entry is needed.
CREATE OR REPLACE FUNCTION public.purge_wa_conversations()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE n int;
BEGIN
  DELETE FROM public.wa_conversations WHERE purge_at IS NOT NULL AND purge_at < now();
  GET DIAGNOSTICS n = ROW_COUNT;
  DELETE FROM public.wa_failed_writes WHERE expires_at < now();
  RETURN n;
END $$;

-- -- stage_entry_v2 + commit-gated reaction -------------------------------------
-- Drop the 11-arg version and recreate with p_reaction (a fully-rendered WA
-- reaction body). When present, a second outbox row is enqueued in the SAME
-- transaction as the entry -- the reaction is as commit-gated as the card.
DROP FUNCTION IF EXISTS public.stage_entry_v2(uuid,text,text,text,text,text,text,jsonb,jsonb,jsonb,text);

CREATE OR REPLACE FUNCTION public.stage_entry_v2(
  p_org_id uuid, p_sender text, p_wamid text, p_status text, p_source text,
  p_sender_name text, p_raw_text text, p_ai jsonb,
  p_payload jsonb, p_rendered jsonb,
  p_link_base text DEFAULT 'https://briklayflow.vercel.app/logbook',
  p_reaction jsonb DEFAULT NULL
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

  -- Clean-entry ✓ reaction: commit-gated (same tx as the row + confirmation).
  IF p_reaction IS NOT NULL THEN
    INSERT INTO public.outbox (org_id, target, payload, rendered, wamid)
    VALUES (p_org_id, p_sender, jsonb_build_object('kind','reaction'), p_reaction, p_wamid);
  END IF;

  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.stage_entry_v2(uuid,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb) FROM public;
GRANT EXECUTE ON FUNCTION public.stage_entry_v2(uuid,text,text,text,text,text,text,jsonb,jsonb,jsonb,text,jsonb) TO service_role;
