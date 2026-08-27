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

type MembershipContextRow = {
  org_id: string
  org_name: string
  org_slug: string
  membership_id: string
  role: MembershipContext['role']
  status: MembershipContext['status']
  joined_at: string | null
}

type InviteRow = { token: string; org_name: string }

export async function resolveAuthDestination(
  userId: string,
  email:  string,
): Promise<AuthRoute> {

  // ── Step 1: active membership? ──────────────────────────────────
  const { data: ctx, error: ctxErr } = await supabase
    .rpc('get_membership_context', { p_user_id: userId })
    .single<MembershipContextRow>()

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
    .single<InviteRow>()

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

  // A SUSPENDED membership means access was revoked — not a fresh user. Route to the pending screen,
  // which renders the "Access denied / suspended" state; do NOT fall through to create-workspace
  // (that would silently invite a removed user to spin up a brand-new org).
  if (ctx && ctx.status === 'suspended') {
    return {
      destination: 'pending',
      orgName:     ctx.org_name,
    }
  }

  // ── Step 3: no active/pending/suspended membership, no invite → create their own ──
  return { destination: 'create-workspace' }
}
