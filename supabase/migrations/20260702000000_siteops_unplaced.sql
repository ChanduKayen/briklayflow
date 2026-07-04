-- ===========================================================================
-- siteops_unplaced — the durable "to place" store: observations/evidence that
-- couldn't be placed on an object, kept RECOVERABLE instead of silently dropped.
--
-- WHY: a SITEOPS disambiguation pick is opened BECAUSE classification was
-- ambiguous. When the user's next message interrupts that pick, committing the
-- item to its best guess commits a probably-wrong guess (which then chases the
-- wrong person). So on interrupt SITEOPS PARKS the raw observation here — never
-- auto-commits a guess, never drops it (see commitInterrupted in _agents/
-- siteops.ts). The governing principle: the item is ground truth and must
-- survive; the pick/interpretation is best-effort. "No object" is fine; "no
-- evidence" never is.
--
-- This is ALSO the backing store the image-flow "to place" queue reads (its UI
-- is deferred): the FLOOR case (a photo that maps to nothing and observes
-- nothing) lands here too as bare evidence. One store, several producers,
-- distinguished by `reason`.
--
-- A row represents an unplaced OBSERVATION (jsonb item/items) OR unplaced
-- EVIDENCE (a photo: bucket + object_path) — at least one must be present (the
-- CHECK enforces it). Photo lives in the private rough-entry-media bucket, so we
-- store bucket + object_path (NOT a url) and mint a signed url at read, exactly
-- like `attachments`.
--
-- DB-HONEST names (frontend "snag" = the `todos` table; rename deferred).
-- Additive + reversible. No backfill.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.siteops_unplaced (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id         uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  project_id     text REFERENCES public.projects(project_id) ON DELETE SET NULL,  -- null = project also unresolved

  -- what landed here + why it couldn't place. `reason` is the producer: the pick
  -- kind it was parked from, or 'floor' (image flow: mapped nothing, observed nothing).
  -- NOTE: this migration is APPLIED; the v2 park reasons are added by 20260703000002 (ALTER), not here.
  reason         text NOT NULL CHECK (reason IN ('disambig', 'typed_pick', 'project', 'photo_pick', 'batch_collision', 'floor')),
  observation    jsonb,                    -- the SiteItem / {items:[...]} that couldn't be placed (null for pure-evidence rows)
  candidates     jsonb,                    -- the shortlist it was ambiguous over — reused to rank the one-tap placement later

  -- photo evidence (nullable): private rough-entry-media, signed at read.
  bucket         text,
  object_path    text,
  caption        text,

  narration_id   uuid REFERENCES public.site_narrations(id) ON DELETE SET NULL,
  sender_number  text,

  -- The wamid of the QUESTION message (the pick we sent) this row was parked from.
  -- LATE-ANSWER RECOVERY (Step 5): a quoted-reply whose Cloud-API context.id matches this
  -- locates the parked row and applies the answer as a placement — parked = recoverable, not
  -- shelved. Spent now (spend-the-line) though it stays NULL until Step 4 captures outbound
  -- send wamids (today send() stores only the inbound wamid); the column is the durable hook.
  question_wamid text,

  -- lifecycle: an INBOX to be emptied. placed → what it became (for the queue's action + audit).
  status             text NOT NULL DEFAULT 'unplaced' CHECK (status IN ('unplaced', 'placed', 'dismissed')),
  placed_parent_type text CHECK (placed_parent_type IS NULL OR placed_parent_type IN ('problem', 'todo', 'site_task')),
  placed_parent_id   uuid,

  created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  resolved_at    timestamptz,

  -- a row must carry SOMETHING — an observation or evidence. Never an empty park.
  CONSTRAINT siteops_unplaced_has_payload CHECK (observation IS NOT NULL OR object_path IS NOT NULL)
);

-- RLS — the CANONICAL org policy (get_my_org_ids(), the SECURITY DEFINER helper
-- that avoids RLS-recursion), same as attachments / todos / problems.
ALTER TABLE public.siteops_unplaced ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.siteops_unplaced
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

-- The queue's driving read: "unplaced items for this org" (a count to drive to zero + the list).
CREATE INDEX IF NOT EXISTS siteops_unplaced_org_status_idx ON public.siteops_unplaced(org_id, status);
CREATE INDEX IF NOT EXISTS siteops_unplaced_project_idx    ON public.siteops_unplaced(project_id);

-- Realtime so the Site Desk unplaced-count updates live as photos park / get placed,
-- mirroring attachments / problems / todos. Idempotent guard.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'siteops_unplaced'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.siteops_unplaced;
  END IF;
END $$;

-- ROLLBACK:
--   ALTER PUBLICATION supabase_realtime DROP TABLE public.siteops_unplaced;
--   DROP TABLE IF EXISTS public.siteops_unplaced;
