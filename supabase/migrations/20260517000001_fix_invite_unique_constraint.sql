-- Fix: unique_active_invite constrained (org_id, email, status) which prevents
-- having more than one revoked/accepted invite per email per org.
-- Replace with a partial unique index that only enforces uniqueness on pending.

ALTER TABLE public.org_invites
  DROP CONSTRAINT IF EXISTS unique_active_invite;

-- One pending invite per (org, email) at a time — all other statuses are history.
CREATE UNIQUE INDEX IF NOT EXISTS unique_pending_invite
  ON public.org_invites (org_id, lower(email))
  WHERE status = 'pending';
