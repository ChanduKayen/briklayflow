-- Opt-in common-area / amenity systems per project. Holds the enabled engine task-type ids
-- (ca_parking, ca_lift, ca_fire, ca_solar, …) chosen in the construction config. The engine
-- surfaces only the ticked systems as a "Common areas" stage; empty = none. has_common_areas stays
-- as the master boolean (true when any system is enabled) for back-compat.
ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS common_systems text[] NOT NULL DEFAULT '{}';
