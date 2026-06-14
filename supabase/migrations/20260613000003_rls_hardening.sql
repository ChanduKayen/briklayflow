-- ── RLS hardening (Sprint 0.5 incident, S0.5-C) ───────────────────────────────
-- Surfaced while auditing every table the client touches after removing the
-- service-role key from the browser. These two findings are pre-existing holes,
-- not regressions from that change.
--
-- Fixed here (both safe — a correct, already-established alternative exists):
--   1. sku_alias_family_index had RLS DISABLED → readable/writable by anyone
--      with the anon key. Enable RLS + authenticated read (matches sku_directory).
--      Writes happen only via SECURITY DEFINER rebuild/refresh functions and
--      statement-level triggers, so no client write policy is needed.
--   2. wo_milestones carried permissive `USING (true)` policies for any
--      authenticated user (cross-org leak) alongside the correct org-scoped
--      "org member access" policy. Drop the permissive ones; org scoping + the
--      "Principal full access" policy already cover legitimate access.
--
-- Flagged for HUMAN REVIEW (NOT changed here — see PR note):
--   • org_invites "public read invite by token" USING (true) exposes every
--     invite token to anon. Likely should be admin-only SELECT + the existing
--     validate_invite_token() SECURITY DEFINER RPC for the public accept page —
--     but that risks the accept flow, so it needs a human decision.
--   • po_approvals is role-based only (no org_id) — not org-scoped. Needs a
--     schema decision before multi-org.
--   • storage bucket "documents" is public-read.

-- ── 1. sku_alias_family_index: enable RLS + authenticated read ─────────────────
ALTER TABLE public.sku_alias_family_index ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated read alias family index"
  ON public.sku_alias_family_index;
CREATE POLICY "Authenticated read alias family index"
  ON public.sku_alias_family_index
  FOR SELECT
  TO authenticated
  USING (true);

-- ── 2. wo_milestones: drop cross-org permissive policies ───────────────────────
-- "org member access" (org_id IN get_my_org_ids()) + "Principal full access"
-- remain and correctly scope all access for every role.
DROP POLICY IF EXISTS "Authenticated users can view wo_milestones"   ON public.wo_milestones;
DROP POLICY IF EXISTS "Authenticated users can insert wo_milestones" ON public.wo_milestones;
DROP POLICY IF EXISTS "Authenticated users can update wo_milestones" ON public.wo_milestones;
