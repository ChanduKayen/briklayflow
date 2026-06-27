-- ===========================================================================
-- P1.2 — FOLLOW-UP RULES (org-tunable layer over the cause taxonomy)
--
-- Per-ORG override of the timing baked into cause_taxonomy (P1.1). One row per
-- (org, cause) the org has tuned. Issue-timing (P2.2) resolves as:
--     org override row if present  →  else the cause_taxonomy default.
--
-- Orgs TUNE timing; orgs do NOT add causes. The taxonomy is the fixed contract —
-- a user-added cause the LLM can't classify into would be dead/noisy. `other` is
-- the catch-all pressure valve. So this table keys to cause_taxonomy(cause_key)
-- with a FK; an override can only exist for a real built-in cause.
--
-- Canonical org RLS (get_my_org_ids), mirroring site_tasks / problems / todos.
-- A row is an OVERRIDE: clock/cadence are nullable so an org can explicitly say
-- "do not chase this cause" by overriding with NULLs, independent of the default.
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.follow_up_rules (
  org_id       uuid NOT NULL REFERENCES public.organizations(org_id) ON DELETE CASCADE,
  cause_key    text NOT NULL REFERENCES public.cause_taxonomy(cause_key) ON DELETE CASCADE,
  clock_days   integer,   -- org override for "how soon we follow up"  (NULL = don't chase)
  cadence_days integer,   -- org override for "how often after"        (NULL = don't chase)
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (org_id, cause_key)
);

ALTER TABLE public.follow_up_rules ENABLE ROW LEVEL SECURITY;
CREATE POLICY "org member access" ON public.follow_up_rules
  FOR ALL
  USING      (org_id IN (SELECT public.get_my_org_ids()))
  WITH CHECK (org_id IN (SELECT public.get_my_org_ids()));

CREATE TRIGGER follow_up_rules_touch BEFORE UPDATE ON public.follow_up_rules
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE INDEX follow_up_rules_org_idx ON public.follow_up_rules(org_id);
