-- ===========================================================================
-- Phase 1B — the Works Approver authority, mirroring the procurement approver.
--
-- org_memberships already carries the procurement approver primitive
-- (can_approve_procurement / procurement_approval_limit / higher_approver_id).
-- Work certification is the same governance family (it MINTS a payable), but a
-- DIFFERENT authority — site work is signed off by the project's engineer/PM, not
-- the procurement approver. So:
--   · can_certify_work / work_certification_limit  — the per-member power (+ ₹ cap)
--   · projects.works_approver_id                    — the site's certification owner
--
-- Escalation resolves PROJECT-FIRST, MEMBER-FALLBACK:
--     approver = project.works_approver_id  ??  submitter.higher_approver_id
-- A submitter who holds can_certify_work AND whose event is within the limit
-- auto-approves; otherwise it routes to that approver as Pending.
-- ===========================================================================

ALTER TABLE public.org_memberships
  ADD COLUMN IF NOT EXISTS can_certify_work        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS work_certification_limit numeric;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS works_approver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.projects.works_approver_id IS
  'The site''s Work Certification owner. Work certifications above a submitter''s limit route here (falling back to the submitter''s org_memberships.higher_approver_id).';
