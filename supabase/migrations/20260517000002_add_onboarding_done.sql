-- T-12: track whether principal has completed the onboarding wizard
alter table public.user_profiles
  add column if not exists onboarding_done boolean not null default false;

-- Backfill: existing users have already been using the app — mark them done
-- so the wizard never pops up for them unexpectedly.
update public.user_profiles
set onboarding_done = true
where onboarding_done = false;

-- Verify
select column_name, data_type, column_default
from information_schema.columns
where table_schema = 'public'
  and table_name   = 'user_profiles'
  and column_name  = 'onboarding_done';
