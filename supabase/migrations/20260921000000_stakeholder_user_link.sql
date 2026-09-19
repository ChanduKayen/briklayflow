-- ===========================================================================
-- Party ↔ member link — a stakeholder IS a team member (durable, name-independent).
--
-- A supervisor is one human in two records: a member who signs in + holds a site-cash wallet
-- (auth.users, wallets.holder_user_id) and a party who can be paid (a stakeholders row). Until now
-- the ONLY bridge was wa_registered_numbers (phone-keyed), and the Day Book "top up their wallet"
-- match fell back to an EXACT-name string compare — which missed the wallet whenever the two records'
-- names had drifted (spelling, a middle name, an un-healed snapshot). The toggle then never showed.
--
-- This adds a hard link: stakeholders.user_id → the member that party is. The resolver matches a
-- payee's wallet by this id (name-independent); the phone bridge and the exact name stay only as
-- fallbacks. Additive and backward compatible: the column is nullable, existing reads/writes are
-- unaffected, and the client tolerates its absence (falls back) until this migration is applied.
-- ===========================================================================

ALTER TABLE public.stakeholders
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS stakeholders_user_id_idx
  ON public.stakeholders(org_id, user_id) WHERE user_id IS NOT NULL;

-- Backfill the UNAMBIGUOUS links already implied by the phone bridge: a party that maps to exactly
-- one member. Ambiguous ones (a shared number) are left null — the resolver still has its fallbacks.
UPDATE public.stakeholders s
SET user_id = m.uid
FROM (
  SELECT stakeholder_id, org_id, min(user_id::text)::uuid AS uid, count(DISTINCT user_id) AS n
    FROM public.wa_registered_numbers
   WHERE user_id IS NOT NULL AND stakeholder_id IS NOT NULL
   GROUP BY stakeholder_id, org_id
) m
WHERE s.stakeholder_id = m.stakeholder_id
  AND s.org_id = m.org_id
  AND m.n = 1
  AND s.user_id IS NULL;

notify pgrst, 'reload schema';
