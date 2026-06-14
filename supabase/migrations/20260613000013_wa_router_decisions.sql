-- ===========================================================================
-- WhatsApp Sprint 3 -- router decision log + ABANDONED conversation state
-- ===========================================================================

-- Decision log: one row per router call, in production. The data the eval/tuning
-- run on (catches real misroutes). Server-internal: RLS on, no client policies.
CREATE TABLE IF NOT EXISTS public.wa_router_decisions (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid        REFERENCES public.organizations(org_id) ON DELETE SET NULL,
  sender       text        NOT NULL,
  wamid        text,
  input_text   text,
  decision     text,
  intent_agent text,
  confidence   numeric,
  slot_hints   jsonb,
  chosen_agent text,
  convo_state  text,            -- OPEN | LINGERING | FRESH (what the router read)
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wa_router_decisions_created ON public.wa_router_decisions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wa_router_decisions_org     ON public.wa_router_decisions(org_id);

ALTER TABLE public.wa_router_decisions ENABLE ROW LEVEL SECURITY;
-- No policies: server-internal (service-role writes bypass RLS; client denied).

-- Allow wa_conversations to be parked ABANDONED on interruption (kept slots, not
-- lingering for reference). The original CHECK only allowed OPEN | CLOSED.
DO $$
DECLARE cname text;
BEGIN
  SELECT conname INTO cname
  FROM pg_constraint
  WHERE conrelid = 'public.wa_conversations'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%status%';
  IF cname IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.wa_conversations DROP CONSTRAINT %I', cname);
  END IF;
  ALTER TABLE public.wa_conversations
    ADD CONSTRAINT wa_conversations_status_check
    CHECK (status IN ('OPEN','CLOSED','ABANDONED'));
END $$;
