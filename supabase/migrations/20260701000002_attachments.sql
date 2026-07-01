-- ===========================================================================
-- attachments — one shared, polymorphic image/media store for SiteOps.
--
-- Purpose: make images first-class across note/snag/issue/task by REUSING the
-- existing WhatsApp ingest + storage, linking each stored object here (one-to-many)
-- instead of proliferating per-object image columns.
--
-- SCOPE (Step 1): the TABLE ONLY. No SITEOPS agent changes, no vision branch yet.
-- Payment is NOT touched — transactions.proof_document_url stays exactly as it is;
-- this table is for the new SiteOps flows.
--
-- parent_type — DB-HONEST names (the frontend "snag" is the `todos` table; the
-- rename is deferred, so the schema uses the real table name and never lies):
--     'problem'           → an Issue     (public.problems)
--     'todo'              → a Snag        (public.todos)          -- DB-honest, not 'snag'
--     'site_task'         → a Task        (public.site_tasks)
--     'site_task_comment' → a Note        (public.site_task_comments)
-- parent_id is polymorphic (no single FK — the parent table varies); integrity is
-- enforced by the app + parent_type. All four parents have uuid PKs.
--
-- role — HOW the attachment arrived, orthogonal to WHAT owns it. An image that
-- ANSWERS a pending question is NOT a new parent kind — it still hangs off the
-- 'problem'/'todo' it answers — but the feed chip renders "photo added" (creation)
-- differently from "photo submitted as answer", and Step 3's activity-log write
-- branches on it. Kept a constrained enum, default 'creation'.
--
-- storage — SPLIT into bucket + object_path, deliberately NOT a single url. The
-- WhatsApp media bucket (`rough-entry-media`) is PRIVATE, so there is no durable
-- URL: a signed URL is minted at READ time (Step 2/3) and expires. Persisting a
-- signed url would rot; a path wearing a "url" name would lie. Store the reference
-- honestly (bucket + path); mint the URL on read. (UI photos use `documents`.)
--
-- Additive + reversible. No backfill.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.attachments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id       uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  parent_type  text NOT NULL CHECK (parent_type IN ('problem', 'todo', 'site_task', 'site_task_comment')),
  parent_id    uuid NOT NULL,
  role         text NOT NULL DEFAULT 'creation' CHECK (role IN ('creation', 'answer')),
  bucket       text NOT NULL,
  object_path  text NOT NULL,
  caption      text,
  created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- RLS — the CANONICAL org policy used by todos / problems / followup_events
-- (org_id IN (SELECT public.get_my_org_ids())). Deliberately NOT a raw subquery on
-- org_memberships: get_my_org_ids() is the SECURITY DEFINER helper that avoids the
-- RLS-recursion this multi-tenant setup has hit before. A new org-scoped table needs
-- this or a cross-org read leaks (and RLS-enabled-but-policyless returns zero rows to
-- everyone).
ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.attachments
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

-- Lookups: "all media for this parent" (the chip/lens + the feed).
CREATE INDEX IF NOT EXISTS attachments_parent_idx ON public.attachments(parent_type, parent_id);
CREATE INDEX IF NOT EXISTS attachments_org_idx    ON public.attachments(org_id);

-- Realtime so a newly-attached photo lands on an open chip/feed without a reload,
-- mirroring problems/todos/followup_events. Idempotent guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'attachments'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attachments;
  END IF;
END $$;

-- ROLLBACK:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.attachments;
--   DROP TABLE IF EXISTS public.attachments;
