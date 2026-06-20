-- ===========================================================================
-- Procurement v1 — Purchase Requests (Part 1: schema, plural-shaped, v1 asserts N=1)
--
-- Structural twin of transactions/txn_allocations: a purchase_request is the PR
-- header (one vendor, one site), purchase_request_items are its lines. Built
-- plural-shaped from day one — `request_index` + the partial-unique idempotency
-- key mirror stage_entry_v3's (org_id, wa_message_id, entry_index), and
-- `site_override` on items is the future per-item seam (v1 leaves it null).
--
-- RLS mirrors the transactions "org member access" policy (get_my_org_ids()).
-- The stage_purchase_request RPC lands in the agent milestone (Part 3), keyed the
-- same way with ON CONFLICT -> return existing as committed (never null).
-- ===========================================================================

-- ── enums ───────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.procurement_sourcing_mode AS ENUM ('direct', 'rfq', 'defer');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- All lifecycle values declared now so the deferred states never need an enum
-- ALTER on live data; v1 only ever writes 'draft' | 'sent_for_approval' | 'approved'.
DO $$ BEGIN
  CREATE TYPE public.purchase_request_status AS ENUM
    ('draft', 'sent_for_approval', 'approved', 'placed', 'fulfilled', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ── purchase_requests (the PR header) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.purchase_requests (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id        uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  created_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,    -- raiser (null for WA-only senders)
  sender_number text,                                                  -- WA provenance (mirrors rough_entries)
  sender_name   text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz,

  wa_message_id text,                                                  -- the source WhatsApp message
  request_index int NOT NULL DEFAULT 0,                                -- plural seam; v1 always 0

  site_id       text REFERENCES public.projects(project_id),           -- nullable -> flagged for review if missing
  site_raw      text,
  vendor_id     text REFERENCES public.stakeholders(stakeholder_id),   -- request-level vendor (never item-level)
  vendor_raw    text,
  sourcing_mode public.procurement_sourcing_mode,                      -- direct | rfq | defer (null until sourced)
  title         text,                                                  -- LLM header for 3+ item lists

  status        public.purchase_request_status NOT NULL DEFAULT 'draft',
  approver_id   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at   timestamptz,

  -- Promotion seam: a purchase_request is to material_requests what rough_entries
  -- is to the transaction ledger — a capture/review buffer that promotes into the
  -- procurement system of record on approval. The promotion is post-approval
  -- (DEFERRED); v1 just records the link target. NULL until promoted.
  material_request_id uuid REFERENCES public.material_requests(id) ON DELETE SET NULL
);

-- idempotency seam: one PR per (org, wa message, request_index) — mirrors stage_entry_v3
CREATE UNIQUE INDEX IF NOT EXISTS purchase_requests_wamid_uq
  ON public.purchase_requests (org_id, wa_message_id, request_index)
  WHERE wa_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS purchase_requests_org_created_idx
  ON public.purchase_requests (org_id, created_at DESC);

-- ── purchase_request_items (the PR lines) ───────────────────────────────────
-- org_id denormalised (like txn_allocations) so RLS is a plain org check.
CREATE TABLE IF NOT EXISTS public.purchase_request_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES public.purchase_requests(id) ON DELETE CASCADE,
  org_id              uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  item_index          int  NOT NULL DEFAULT 0,
  item_name           text NOT NULL,
  quantity            numeric,
  unit                text,
  site_override       text REFERENCES public.projects(project_id),     -- plural seam; v1 null (inherits PR site)
  note                text,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS purchase_request_items_pr_idx
  ON public.purchase_request_items (purchase_request_id, item_index);

-- ── RLS — mirror the transactions "org member access" policy ────────────────
ALTER TABLE public.purchase_requests      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchase_request_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org member access" ON public.purchase_requests;
CREATE POLICY "org member access" ON public.purchase_requests
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

DROP POLICY IF EXISTS "org member access" ON public.purchase_request_items;
CREATE POLICY "org member access" ON public.purchase_request_items
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

-- ── reviewer / approver settings (Part 7 governance primitive) ──────────────
-- Per-member: may they approve procurement, and up to what amount (null = no limit).
-- Zero members with can_approve_procurement => "solo mode" (no approval routing).
ALTER TABLE public.org_memberships
  ADD COLUMN IF NOT EXISTS can_approve_procurement     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS procurement_approval_limit  numeric;
