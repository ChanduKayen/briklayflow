// Block A — platform-UI narration entry + confirmation-back (Part 1, UI channel).
//
// Same pipeline as the WhatsApp SITEOPS agent (decompose → resolveProject → routeItems →
// buildConfirm), but it RETURNS the readback to the caller (the UI shows it) instead of
// sending over WhatsApp. The engine builds the readback ONCE (buildConfirm in _siteops_route);
// delivery branches by channel — the WhatsApp agent sends it, this returns it.
//
// Two modes:
//   { project_id, text }        → run the narration; returns { confirm, ambiguous?[] }.
//   { project_id, pick:{item, task_id} } → resolve a disambiguation (apply progress to the
//                                 chosen task); returns the confirm. (UI's "which floor?" reply.)
//
// House style mirrors siteops-enrich: std@0.168.0 serve, service-role writes, default verify_jwt
// (the UI invokes with the user's auth; we read the caller to attribute the narration).

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decompose } from '../whatsapp-webhook/_siteops_extract.ts'
import { resolveProject } from '../whatsapp-webhook/_resolve.ts'
import { routeItems, applyProgress, buildConfirm, type RouteCtx, type SiteTaskRow, type OrgMember } from '../whatsapp-webhook/_siteops_route.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const TASK_COLS = 'task_id, phase, trade, floor_label, unit_label, name, status, owner_id, owner_source'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ownerCtx(svc: any, projectId: string) {
  // Resolve the real org from the project FIRST, then load members/principal scoped to it.
  const proj = await svc.from('projects').select('supervisor_id, org_id').eq('project_id', projectId).maybeSingle()
  const orgId = proj.data?.org_id ?? ''
  const [m, prin] = await Promise.all([
    svc.from('user_profiles').select('id, name').eq('org_id', orgId),
    svc.from('user_profiles').select('id').eq('org_id', orgId).eq('role', 'principal').limit(1).maybeSingle(),
  ])
  return {
    members: (m.data ?? []) as OrgMember[],
    supervisorId: proj.data?.supervisor_id ?? null,
    principalId: prin.data?.id ?? null,
    orgId,
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const body = await req.json()
    const projectId: string = body.project_id
    if (!projectId) throw new Error('project_id required')

    const svc = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
    // who's narrating (for attribution); best-effort from the caller's JWT
    let uid: string | null = null
    const auth = req.headers.get('Authorization')
    if (auth) {
      const u = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: auth } } })
      uid = (await u.auth.getUser()).data.user?.id ?? null
    }

    const oc = await ownerCtx(svc, projectId)
    const byLabel = uid ?? 'platform'

    // ── disambiguation resolve (UI "which floor?" reply) ──
    if (body.pick) {
      const { item, task_id } = body.pick
      const { data: rows } = await svc.from('site_tasks').select(TASK_COLS).eq('task_id', task_id)
      const task = (rows ?? [])[0] as SiteTaskRow | undefined
      const rc: RouteCtx = { supabase: svc, orgId: oc.orgId, projectId, byLabel, members: oc.members, supervisorId: oc.supervisorId, principalId: oc.principalId, narrationId: body.narration_id ?? null, now: new Date() }
      const pr = task ? [await applyProgress(rc, task, item)] : []
      return json({ ok: true, confirm: buildConfirm({ site: null, progress: pr, problems: [], todos: [], parked: 0, pendingPick: 0, ownerLabel: 'you', md: false }) })
    }

    // ── narrate ──
    const text: string = (body.text ?? '').trim()
    if (!text) throw new Error('text required')

    const { data: nrow } = await svc.from('site_narrations')
      .insert({ org_id: oc.orgId, project_id: projectId, raw_text: text, resolved_project_via: 'selected' })
      .select('id').single()
    const narrationId: string | null = nrow?.id ?? null

    // Hand the extractor the org's active project NAMES so project_hint comes back canonical
    // (semantic match), mirroring the transaction agent + the WhatsApp SITEOPS agent.
    const { data: projRows } = await svc.from('projects').select('name').eq('org_id', oc.orgId).eq('status', 'Active')
    const projectNames = ((projRows ?? []) as { name: string }[]).map((p) => p.name)

    let decomposed
    try { decomposed = await decompose(text, projectNames) } catch {
      return json({ ok: false, error: 'unreadable', confirm: "Didn't catch a site update in that — try again if you meant to send one." })
    }

    // Project is the selected one (the UI is project-scoped) — resolveProject confirms/labels it.
    const proj = await resolveProject(svc, oc.orgId, { narration: text, nameHint: decomposed.project_hint, selectedProjectId: projectId })
    await svc.from('site_narrations').update({ project_id: proj.projectId ?? projectId, decomposed: decomposed.items, resolved_project_via: proj.via }).eq('id', narrationId)

    const { data: taskRows } = await svc.from('site_tasks').select(TASK_COLS).eq('project_id', projectId)
    const tasks = (taskRows ?? []) as SiteTaskRow[]
    const rc: RouteCtx = { supabase: svc, orgId: oc.orgId, projectId, byLabel, members: oc.members, supervisorId: oc.supervisorId, principalId: oc.principalId, narrationId, now: new Date() }
    const out = await routeItems(rc, tasks, decomposed.items)

    const confirm = buildConfirm({
      site: proj.projectName,
      progress: out.progress, problems: out.problems, todos: out.todos,
      parked: out.parked.length, pendingPick: out.ambiguous.length ? out.ambiguous.length : 0, ownerLabel: 'you', md: false,
    })
    // Ambiguous progress items → UI shows a "which one?" picker; it calls back with { pick }.
    const ambiguous = out.ambiguous.map((a) => ({
      item: a.item,
      candidates: a.candidates.map((t) => ({ task_id: t.task_id, name: t.name, floor: t.floor_label, unit: t.unit_label })),
    }))
    return json({ ok: true, confirm, narration_id: narrationId, ambiguous })
  } catch (err) {
    console.error('siteops-narrate error:', err)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function json(b: any, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}
