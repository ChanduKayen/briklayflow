-- ===========================================================================
-- WhatsApp Sprint 1 -- the durable spine (tables)
--
-- processing_job (the promise-to-respond), outbox (transactional outbox),
-- wa_conversations (router state, populated in a later sprint), and
-- wa_sender_locks (pooler-safe per-sender serialization).
--
-- Tenancy: these are SERVER-INTERNAL. The webhook writes them as service-role
-- (which bypasses RLS). RLS is ENABLED with NO policies = deny-by-default for
-- anon/authenticated (the client must not read them). If any is later surfaced
-- to the client, org-scope it with the foundation helpers (get_my_org_ids /
-- has_role_in_org). No RLS-off, no USING(true).
-- ===========================================================================

-- -- processing_job ------------------------------------------------------------
-- One row per inbound wamid. State machine:
--   RECEIVED -> PROCESSING -> (WRITTEN | FAILED) -> (CONFIRMED | CONFIRM_PENDING)
-- wamid UNIQUE makes job creation idempotent alongside wa_inbound_dedup.
CREATE TABLE IF NOT EXISTS public.processing_job (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  wamid            text        NOT NULL UNIQUE,
  org_id           uuid        NOT NULL REFERENCES public.organizations(org_id) ON DELETE RESTRICT,
  sender_number    text        NOT NULL,
  message_type     text,
  status           text        NOT NULL DEFAULT 'RECEIVED'
                               CHECK (status IN ('RECEIVED','PROCESSING','WRITTEN','FAILED','CONFIRMED','CONFIRM_PENDING')),
  error            text,
  -- watchdog idempotency: once a timeout failure is flipped + enqueued, never re-fire.
  failure_notified boolean     NOT NULL DEFAULT false,
  received_at      timestamptz NOT NULL DEFAULT now(),
  processing_at    timestamptz,
  terminal_at      timestamptz,
  updated_at       timestamptz NOT NULL DEFAULT now()
);

-- Partial index: the watchdog only ever scans PROCESSING rows.
CREATE INDEX IF NOT EXISTS idx_processing_job_inflight
  ON public.processing_job (processing_at)
  WHERE status = 'PROCESSING';
CREATE INDEX IF NOT EXISTS idx_processing_job_org ON public.processing_job (org_id);

ALTER TABLE public.processing_job ENABLE ROW LEVEL SECURITY;
-- No policies: server-internal (service-role writes bypass RLS; client denied).

-- -- outbox ---------------------------------------------------------------------
-- Transactional outbox: a domain write enqueues its outbound reply in the SAME
-- transaction (commit-coupled), and the drainer sends it. Idempotent enqueue via
-- dedup_key; backoff via next_attempt_at/attempts.
CREATE TABLE IF NOT EXISTS public.outbox (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id          uuid        REFERENCES public.organizations(org_id) ON DELETE SET NULL,
  target          text        NOT NULL,                 -- recipient phone number
  payload         jsonb       NOT NULL,                  -- e.g. {"type":"text","text":"..."}
  status          text        NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING','SENDING','SENT','FAILED')),
  attempts        int         NOT NULL DEFAULT 0,
  max_attempts    int         NOT NULL DEFAULT 6,
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error      text,
  wamid           text,                                  -- source wamid (traceability)
  dedup_key       text        UNIQUE,                    -- idempotent enqueue key (nullable)
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Drainer scans due PENDING rows.
CREATE INDEX IF NOT EXISTS idx_outbox_due
  ON public.outbox (next_attempt_at)
  WHERE status = 'PENDING';

ALTER TABLE public.outbox ENABLE ROW LEVEL SECURITY;
-- No policies: server-internal.

-- -- wa_conversations -----------------------------------------------------------
-- Router/orchestrator state. SCHEMA ONLY this sprint -- the 4-way router populates
-- it later. The purge sweep (migration C) deletes rows past purge_at.
CREATE TABLE IF NOT EXISTS public.wa_conversations (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES public.organizations(org_id) ON DELETE RESTRICT,
  sender_number       text        NOT NULL,
  owning_agent        text,
  status              text        NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','CLOSED')),
  pending_question    text,
  slots_so_far        jsonb       NOT NULL DEFAULT '{}',
  staged_entry_id     uuid        REFERENCES public.rough_entries(id) ON DELETE SET NULL,
  last_action_summary text,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  closed_at           timestamptz,
  purge_at            timestamptz,
  last_message_id     text
);

CREATE INDEX IF NOT EXISTS idx_wa_conversations_open
  ON public.wa_conversations (org_id, sender_number)
  WHERE status = 'OPEN';
CREATE INDEX IF NOT EXISTS idx_wa_conversations_purge
  ON public.wa_conversations (purge_at)
  WHERE purge_at IS NOT NULL;

ALTER TABLE public.wa_conversations ENABLE ROW LEVEL SECURITY;
-- No policies: server-internal (this sprint). Org-scope if surfaced to client later.

-- -- wa_sender_locks ------------------------------------------------------------
-- Per-sender serialization. Postgres session advisory locks are unreliable over
-- Supabase's pooled connections, so we use a tiny lock table with stale reclaim
-- (see wa_try_lock / wa_release_lock in migration C).
CREATE TABLE IF NOT EXISTS public.wa_sender_locks (
  sender_number text        PRIMARY KEY,
  wamid         text,
  locked_at     timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL DEFAULT now() + interval '60 seconds'
);

ALTER TABLE public.wa_sender_locks ENABLE ROW LEVEL SECURITY;
-- No policies: server-internal.
