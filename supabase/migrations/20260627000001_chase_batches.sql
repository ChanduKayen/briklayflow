-- ===========================================================================
-- Block B3 — the OPEN BATCH. When the chase scheduler (B2) sends an owner their
-- digest, it opens ONE batch here holding the N items it just asked about (each
-- with its project, task, cause). The batch is a PATIENT background context, NOT
-- a modal pending question: every later message (text or voice) is decomposed
-- and matched against these items, in any order, across interruptions, until
-- they resolve or the next cycle re-chases them. One OPEN batch per (org, sender)
-- — the most recent digest. Items are carried as JSONB (the same shape the
-- matcher consumes), mirroring wa_conversations.slots_so_far.
--
-- Org RLS (get_my_org_ids); written by the service-role chase function + webhook.
-- Idempotent — safe to re-run in the SQL editor.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.chase_batches (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  sender_number text NOT NULL,                       -- the owner's WhatsApp number (E.164, no +)
  status        text NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  items         jsonb NOT NULL DEFAULT '[]'::jsonb,  -- BatchItem[] (kind,id,project,task,cause,…)
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  closed_at     timestamptz
);

ALTER TABLE public.chase_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "org member access" ON public.chase_batches;
CREATE POLICY "org member access" ON public.chase_batches
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

-- One OPEN batch per (org, sender) — the lookup the matcher does every message.
CREATE UNIQUE INDEX IF NOT EXISTS chase_batches_one_open
  ON public.chase_batches(org_id, sender_number) WHERE status = 'OPEN';
