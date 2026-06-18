-- ── General-expense heads (Type C : GEN) ────────────────────────────────────────
-- A "general expense" is a running/overhead cost with NO payee (stakeholder_id null).
-- It is filed under one of these GEN heads, chosen by the LLM from the description.
-- These extend the existing cost_codes lookup with a third type, 'GEN'. The frontend
-- mirrors this list in src/lib/costCodes.ts — keep the two in sync.
--
-- Idempotent: re-running updates the name/sort_order, never duplicates (code is UNIQUE).

INSERT INTO public.cost_codes (code, type, division_code, division_name, name, sort_order) VALUES
  ('GEN-01','GEN','GEN','General Expenses','Transport & logistics',                       90001),
  ('GEN-02','GEN','GEN','General Expenses','Fuel & diesel',                                90002),
  ('GEN-03','GEN','GEN','General Expenses','Site utilities (power, water, internet)',       90003),
  ('GEN-04','GEN','GEN','General Expenses','Tools & consumables',                           90004),
  ('GEN-05','GEN','GEN','General Expenses','Food & refreshments',                           90005),
  ('GEN-06','GEN','GEN','General Expenses','Site accommodation & stay',                     90006),
  ('GEN-07','GEN','GEN','General Expenses','Office & administration',                       90007),
  ('GEN-08','GEN','GEN','General Expenses','Professional & consultant fees',                90008),
  ('GEN-09','GEN','GEN','General Expenses','Government, taxes & statutory fees',            90009),
  ('GEN-10','GEN','GEN','General Expenses','Repairs & maintenance',                         90010),
  ('GEN-11','GEN','GEN','General Expenses','Safety & PPE',                                  90011),
  ('GEN-12','GEN','GEN','General Expenses','Equipment & machinery rental',                  90012),
  ('GEN-13','GEN','GEN','General Expenses','Bank & finance charges',                        90013),
  ('GEN-14','GEN','GEN','General Expenses','Medical & first-aid',                           90014),
  ('GEN-15','GEN','GEN','General Expenses','Security & watchman',                           90015),
  ('GEN-99','GEN','GEN','General Expenses','Miscellaneous / uncategorised',                90099)
ON CONFLICT (code) DO UPDATE
  SET type          = EXCLUDED.type,
      division_code = EXCLUDED.division_code,
      division_name = EXCLUDED.division_name,
      name          = EXCLUDED.name,
      sort_order    = EXCLUDED.sort_order;
