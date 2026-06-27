-- ===========================================================================
-- P1.1 — CAUSE TAXONOMY (the contract)
--
-- The fixed vocabulary of WHY work stalls. One row per cause. This is the
-- CONTRACT shared by three consumers:
--   • the extraction LLM   — classifies a narration INTO a cause (reads `definition`)
--   • the timing logic      — when/how often to follow up (`default_clock_days`,
--                             `default_cadence_days`, tempered later by idle_cost/contextual)
--   • the impact LLM (P2.3) — blast-radius reasoning grounded in the cause's nature
--
-- So each cause carries a DEFINITION an LLM can classify into — not just a label.
--
-- GLOBAL table (NOT org-scoped): it is the shared vocabulary. Authenticated-read,
-- service-role-write (no authenticated write policy → only service_role mutates;
-- service_role bypasses RLS). Orgs do NOT add causes — they only TUNE timing via
-- the per-org follow_up_rules override layer (P1.2). `other` is the pressure valve.
--
-- idle_cost values: yes | partial | no | if_blocking
--   (the spec names yes/partial/no; design & client are "idle IF blocking imminent
--    work" — captured as if_blocking, paired with contextual=true.)
-- A NULL clock/cadence (weather, auspicious) means "recorded, not chased".
-- ===========================================================================

CREATE TABLE IF NOT EXISTS public.cause_taxonomy (
  cause_key            text PRIMARY KEY,
  label                text NOT NULL,
  definition           text NOT NULL,                 -- LLM grounding: what this cause MEANS
  default_clock_days   integer,                        -- when first follow-up fires (NULL = not chased)
  default_cadence_days integer,                        -- how often after (NULL = not chased)
  idle_cost            text NOT NULL DEFAULT 'no'
                         CHECK (idle_cost IN ('yes','partial','no','if_blocking')),
  contextual           boolean NOT NULL DEFAULT false, -- only urgent if blocking imminent work
  is_other             boolean NOT NULL DEFAULT false, -- the unclassifiable catch-all
  sort_order           integer NOT NULL DEFAULT 0,     -- deterministic UI ordering
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.cause_taxonomy ENABLE ROW LEVEL SECURITY;

-- Authenticated-read: every signed-in user shares the vocabulary.
CREATE POLICY "Authenticated read cause taxonomy"
  ON public.cause_taxonomy FOR SELECT
  TO authenticated USING (true);
-- (No authenticated write policy → writes are service-role only.)

CREATE TRIGGER cause_taxonomy_touch BEFORE UPDATE ON public.cause_taxonomy
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

CREATE INDEX cause_taxonomy_sort_idx ON public.cause_taxonomy(sort_order);

-- ── SEED — 12 built-in causes (universal + India-specific) ────────────────────
-- Idempotent: ON CONFLICT refreshes the definition/timing/flags so re-running the
-- migration keeps the contract in sync without duplicating rows.
INSERT INTO public.cause_taxonomy
  (cause_key, label, definition, default_clock_days, default_cadence_days, idle_cost, contextual, is_other, sort_order)
VALUES
  ('material',   'Material',
    'Shortage, delay, or non-arrival of materials needed to proceed — cement, steel, bricks, fittings, etc. The physical inputs to work are missing or late.',
    1, 1, 'yes', false, false, 10),

  ('labour',    'Labour',
    'Worker absence or shortage — the crew, mason, or specialist needed is not present or is under-staffed, so work cannot be done at the planned pace.',
    1, 1, 'yes', false, false, 20),

  ('rework',    'Rework',
    'A quality-control failure that must be redone — work was completed but failed inspection/QC and has to be torn out, corrected, or repeated before progress continues.',
    1, 1, 'partial', false, false, 30),

  ('design',    'Design / Drawing',
    'A drawing, dimension, specification, or clarification is needed from the architect/engineer before work can proceed correctly. The intent is unclear or missing.',
    2, 2, 'if_blocking', true, false, 40),

  ('client',    'Client decision',
    'An owner/client decision is pending — a choice, approval, or selection only the client can make (finish, fixture, scope, layout). Distinct from payment.',
    3, 3, 'if_blocking', true, false, 50),

  ('payment',   'Payment',
    'Funds or contractor/labour payment is blocking progress — money owed, an advance not released, or a vendor withholding supply until paid. A cash-flow stall, not a decision.',
    2, 2, 'no', true, false, 60),

  ('equipment', 'Equipment',
    'Machinery or tool failure/unavailability — mixer, crane, pump, vibrator, scaffolding, or hired plant broken down or not on site.',
    1, 2, 'partial', false, false, 70),

  ('weather',   'Weather',
    'Rain, monsoon, heat, or other weather physically stopping outdoor work (concreting, plastering, excavation). An external force — recorded for the timeline, not chased.',
    NULL, NULL, 'no', false, false, 80),

  ('statutory', 'Statutory / Approval',
    'A panchayat, municipal, or local-body approval, permit, inspection, or NOC is pending — a government/regulatory gate outside the team''s control.',
    3, 3, 'no', true, false, 90),

  ('access',    'Site access / Logistics',
    'Site access, road, transport, or logistics problem — blocked approach, vehicle/delivery cannot reach site, material stranded in transit, or a right-of-way dispute.',
    2, 2, 'partial', false, false, 100),

  ('auspicious','Auspicious timing',
    'Work deliberately scheduled around a muhurtham or auspicious date/time (foundation pour, housewarming, first work). A real, distinct cultural cause — NOT a client decision and NOT a delay to chase.',
    NULL, NULL, 'no', true, false, 110),

  ('other',     'Other',
    'Unclassifiable catch-all — a genuine cause that fits none of the above. The pressure valve; recurring use is a signal to add a proper built-in cause with its own definition.',
    2, 3, 'no', false, true, 999)
ON CONFLICT (cause_key) DO UPDATE SET
  label                = EXCLUDED.label,
  definition           = EXCLUDED.definition,
  default_clock_days   = EXCLUDED.default_clock_days,
  default_cadence_days = EXCLUDED.default_cadence_days,
  idle_cost            = EXCLUDED.idle_cost,
  contextual           = EXCLUDED.contextual,
  is_other             = EXCLUDED.is_other,
  sort_order           = EXCLUDED.sort_order,
  updated_at           = now();
