import { supabase } from '../supabase'

export type MembershipContext = {
  orgId:        string
  orgName:      string
  orgSlug:      string
  membershipId: string
  role:         'principal' | 'management' | 'supervisor' | 'accountant'
  status:       'active' | 'pending' | 'suspended'
  joinedAt:     string | null
}

export type AuthRoute =
  | { destination: 'dashboard';        context: MembershipContext }
  | { destination: 'accept-invite';    token: string; orgName: string }
  | { destination: 'create-workspace' }
  | { destination: 'pending';          orgName: string }

export async function resolveAuthDestination(
  userId: string,
  email:  string,
): Promise<AuthRoute> {

  // ── Step 1: active membership? ──────────────────────────────────
  const { data: ctx, error: ctxErr } = await supabase
    .rpc('get_membership_context', { p_user_id: userId })
    .single()

  if (ctxErr && ctxErr.code !== 'PGRST116') {
    // PGRST116 = no rows — not a real error
    console.error('[resolver] membership check failed:', ctxErr)
  }

  if (ctx && ctx.status === 'active') {
    return {
      destination: 'dashboard',
      context: {
        orgId:        ctx.org_id,
        orgName:      ctx.org_name,
        orgSlug:      ctx.org_slug,
        membershipId: ctx.membership_id,
        role:         ctx.role,
        status:       ctx.status,
        joinedAt:     ctx.joined_at,
      },
    }
  }
  // pending: don't return yet — a pending invite takes priority

  // ── Step 2: pending invite for this email? ───────────────────────
  const { data: invite, error: inviteErr } = await supabase
    .rpc('find_invite_by_email', { p_email: email })
    .single()

  if (inviteErr && inviteErr.code !== 'PGRST116') {
    console.error('[resolver] invite check failed:', inviteErr)
  }

  if (invite) {
    return {
      destination: 'accept-invite',
      token:       invite.token,
      orgName:     invite.org_name,
    }
  }

  // No invite — honour existing pending membership if present
  if (ctx && ctx.status === 'pending') {
    return {
      destination: 'pending',
      orgName:     ctx.org_name,
    }
  }

  // ── Step 3: does any org exist? ──────────────────────────────────
  const { count, error: orgErr } = await supabase
    .from('organizations')
    .select('*', { count: 'exact', head: true })

  if (orgErr) {
    console.error('[resolver] org count failed:', orgErr)
  }

  if (!count || count === 0) {
    return { destination: 'create-workspace' }
  }

  // ── Step 4: org exists, no invite, no membership → pending ───────
  const { data: org } = await supabase
    .from('organizations')
    .select('name')
    .eq('status', 'active')
    .single()

  // create pending membership if one doesn't exist yet
  const { data: existingPending } = await supabase
    .from('org_memberships')
    .select('membership_id')
    .eq('user_id', userId)
    .eq('status', 'pending')
    .single()

  if (!existingPending) {
    const { data: orgRow } = await supabase
      .from('organizations')
      .select('org_id')
      .eq('status', 'active')
      .single()

    if (orgRow) {
      await supabase.from('org_memberships').insert({
        org_id:  orgRow.org_id,
        user_id: userId,
        role:    'accountant', // lowest role — principal will change it
        status:  'pending',
      })
    }
  }

  return {
    destination: 'pending',
    orgName:     org?.name ?? 'your organization',
  }
}
