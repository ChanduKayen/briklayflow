-- Add 'principal' to the user_role enum
-- Must run BEFORE any INSERT/UPDATE that uses the new value.
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'principal';
