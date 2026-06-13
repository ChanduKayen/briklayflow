-- ── P1: close org_invites public-read hole (Sprint 0.5 follow-up) ─────────────
-- org_invites had a `USING (true)` SELECT policy ("public read invite by token")
-- so ANYONE with the anon key (shipped in every browser bundle) could read every
-- pending invite's token, email, role, and org_id. Token + the accept endpoint =
-- an attacker joins an org with the invited role (possibly management) →
-- privilege escalation, not just exposure.
--
-- Safe to drop: verified every reader. The public, possibly-unauthenticated
-- accept page (InviteAccept.tsx) and the auth resolver go through SECURITY
-- DEFINER RPCs (validate_invite_token / accept_invite / decline_invite /
-- find_invite_by_email), which bypass RLS and never needed this policy. All
-- direct SELECTs are admin-only (/team, ManageTeam) and stay covered by
-- "admin reads org invites". Writes stay covered by "admin creates/revokes".

DROP POLICY IF EXISTS "public read invite by token" ON public.org_invites;

-- Make the anon execute path explicit: the accept page validates a token before
-- the user is logged in, so anon must be able to call the definer validator.
-- (accept/decline require an authenticated session.) These are SECURITY DEFINER
-- so they read org_invites regardless of the table's RLS.
GRANT EXECUTE ON FUNCTION public.validate_invite_token(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.decline_invite(text)        TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.accept_invite(text, uuid)   TO authenticated;
