// Admin user management — runs the privileged auth.admin operations that used to
// live in the browser via the service-role key (see Sprint 0.5 incident).
//
// The service-role key NEVER reaches the client. It is read here from function
// secrets (SUPABASE_SERVICE_ROLE_KEY is injected automatically by the Supabase
// runtime). Every call is authenticated (caller JWT) and authorized (caller must
// be an active principal/management member of the org the action targets).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_KEY  = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY     = Deno.env.get('SUPABASE_ANON_KEY')!

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  try {
    // ── Authenticate caller ─────────────────────────────────────────────────
    const authHeader = req.headers.get('Authorization') ?? ''
    if (!authHeader) return json({ error: 'Missing authorization' }, 401)

    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: userErr } = await userClient.auth.getUser()
    if (userErr || !user) return json({ error: 'Invalid session' }, 401)

    // ── Authorize: caller must be an active admin of an org ──────────────────
    const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const { data: membership } = await admin
      .from('org_memberships')
      .select('org_id, role')
      .eq('user_id', user.id)
      .eq('status', 'active')
      .in('role', ['principal', 'management'])
      .maybeSingle()

    if (!membership) return json({ error: 'Forbidden: admin role required' }, 403)
    const orgId = membership.org_id as string

    const { action, ...payload } = await req.json()

    // ── Create user ──────────────────────────────────────────────────────────
    if (action === 'create') {
      const { email, password, name, role } = payload
      if (!email || !password || !name || !role) {
        return json({ error: 'Missing required fields' }, 400)
      }

      // One principal per org.
      if (role === 'principal') {
        const { count } = await admin
          .from('org_memberships')
          .select('*', { count: 'exact', head: true })
          .eq('org_id', orgId)
          .eq('role', 'principal')
          .eq('status', 'active')
        if ((count ?? 0) > 0) {
          return json({ error: 'Only one Principal is allowed per organisation.' }, 400)
        }
      }

      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email, password, email_confirm: true, user_metadata: { full_name: name },
      })
      if (createErr) return json({ error: createErr.message }, 400)

      // Atomically sync user_profiles.role + upsert org_memberships.
      const { data: finalize, error: finErr } = await admin.rpc('finalize_new_member', {
        p_user_id: created.user.id,
        p_org_id:  orgId,
        p_role:    role,
      })
      if (finErr || !finalize?.success) {
        // Roll back the auth user so we don't orphan a half-created account.
        await admin.auth.admin.deleteUser(created.user.id)
        return json({ error: finErr?.message ?? finalize?.error ?? 'Failed to set up user account' }, 400)
      }

      return json({ success: true, user_id: created.user.id })
    }

    // ── Delete user ──────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { userId } = payload
      if (!userId) return json({ error: 'Missing userId' }, 400)
      if (userId === user.id) return json({ error: 'You cannot delete your own account' }, 400)

      // Only allow deleting members of the caller's own org.
      const { data: target } = await admin
        .from('org_memberships')
        .select('org_id')
        .eq('user_id', userId)
        .eq('org_id', orgId)
        .maybeSingle()
      if (!target) return json({ error: 'User not found in your organisation' }, 404)

      const { error: delErr } = await admin.auth.admin.deleteUser(userId)
      if (delErr) return json({ error: delErr.message }, 400)

      return json({ success: true })
    }

    return json({ error: 'Unknown action' }, 400)
  } catch (e) {
    return json({ error: (e as Error)?.message ?? String(e) }, 500)
  }
})
