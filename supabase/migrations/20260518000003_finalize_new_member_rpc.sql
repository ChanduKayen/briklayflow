-- PR-101 D: atomically set user_profiles.role + org_memberships after auth user creation.
-- Auth user creation (supabaseAdmin.auth.admin.createUser) stays client-side;
-- this function wraps the two DB writes that must not partially commit.
CREATE OR REPLACE FUNCTION public.finalize_new_member(
  p_user_id uuid,
  p_org_id  uuid,
  p_role    text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_org_id NOT IN (SELECT public.get_my_org_ids()) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Access denied');
  END IF;

  -- Sync role to user_profiles (skip for supervisor — trigger sets its default)
  IF p_role != 'supervisor' THEN
    UPDATE public.user_profiles
    SET role = p_role::public.user_role
    WHERE id = p_user_id;
  END IF;

  -- Upsert org_membership so resolveAuthDestination() finds an active membership
  INSERT INTO public.org_memberships (org_id, user_id, role, status, joined_at)
  VALUES (p_org_id, p_user_id, p_role::public.member_role, 'active', now())
  ON CONFLICT (user_id, org_id)
  DO UPDATE SET role = EXCLUDED.role, status = 'active', joined_at = EXCLUDED.joined_at;

  RETURN jsonb_build_object('success', true);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;
