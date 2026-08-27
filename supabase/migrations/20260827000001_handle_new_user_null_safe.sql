-- Make the auth.users signup trigger tolerate PHONE signups (and any missing metadata).
--
-- THE BUG: phone signup fails with "Database error saving new user". The trigger that mirrors a new
-- auth user into public.user_profiles inserts `name` (NOT NULL) and `role` (NOT NULL). A phone user has
-- no email and — if they signed up without typing a name, or in sign-in mode — no full_name in metadata,
-- so `name` comes out NULL and the whole auth.users insert is rolled back.
--
-- FIX: fill both columns with safe fallbacks and never throw. Replacing the FUNCTION updates whatever
-- trigger already calls it, so no trigger surgery is needed IF your trigger's function is public.handle_new_user
-- (the standard name — CONFIRM with the query at the bottom; if it's different, rename here to match).

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.user_profiles (id, name, role)
  VALUES (
    NEW.id,
    -- name: full_name → name → email local-part → phone → a last-resort label. Never NULL.
    COALESCE(
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'full_name'), ''),
      NULLIF(btrim(NEW.raw_user_meta_data ->> 'name'), ''),
      NULLIF(split_part(COALESCE(NEW.email, ''), '@', 1), ''),
      NULLIF(NEW.phone, ''),
      'Member'
    ),
    -- role: honour an explicit metadata role if it's a valid enum value, else default to management
    -- (a fresh self-signup owns their new workspace). The invited-teammate's ACTUAL role is set on
    -- org_memberships by accept_phone_invite — this legacy column just needs a non-null value.
    COALESCE(
      (SELECT (NEW.raw_user_meta_data ->> 'role')::public.user_role
        WHERE NEW.raw_user_meta_data ->> 'role' = ANY (enum_range(NULL::public.user_role)::text[])),
      'management'::public.user_role
    )
  )
  ON CONFLICT (id) DO NOTHING;   -- idempotent: a retry / duplicate trigger can't fail the signup
  RETURN NEW;
END;
$$;

-- Confirm which function your auth.users trigger actually calls (should be handle_new_user):
--   SELECT tgname, tgfoid::regproc AS calls
--   FROM pg_trigger
--   WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
-- If it calls a DIFFERENTLY-named function, re-run this CREATE OR REPLACE with that name instead.
