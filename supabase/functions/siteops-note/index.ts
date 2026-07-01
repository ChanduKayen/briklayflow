// siteops-note — the note→Snag/Issue entry point for the UI. Reuses the SAME classifier
// (decompose) and act step (createProblem/createTodo) as the WhatsApp pipeline, so ONE
// classifier serves both entry points — nothing in the shared _siteops_* code changes.
//
// Two actions:
//   POST ?action=classify  { text, project_id }
//        → { items }  — the decompose() suggestion (progress→note / issue / todo→snag). No writes.
//   POST ?action=spawn     { task_id, project_id, note_id, note_kind, type, item }
//        → { id, kind } — creates the first-class object, stamps source_note_id/kind provenance.
//
// AUTH: user-invoked → verify_jwt stays ON (the gateway validates the caller's Supabase JWT).
// We re-derive the caller from the JWT, verify org membership, then write with the service role.
//
// REUSE TRICK (zero change to the shared WhatsApp code): createProblem/createTodo run their normal
// creation-notify with a self-skip of `owner.phone === RouteCtx.byLabel`. We pass the ACTOR's phone
// as byLabel, so a UI spawn self-assigned to the creator is skipped exactly like the WhatsApp path.
// createProblem/createTodo don't take source_note_id, so we stamp it with a post-create UPDATE.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { decompose, type SiteItem } from '../whatsapp-webhook/_siteops_extract.ts'
import { createProblem, createTodo, type OrgMember, type RouteCtx } from '../whatsapp-webhook/_siteops_route.ts'
import { loadCadenceMap } from '../whatsapp-webhook/_siteops_timing.ts'
import { ownerPhone } from '../whatsapp-webhook/_siteops_assign.ts'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SB = any

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SVC_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

function json(b: unknown, status = 200): Response {
  return new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  try {
    const supabase: SB = createClient(SUPABASE_URL, SVC_KEY, { auth: { autoRefreshToken: false, persistSession: false } })

    // caller identity from the JWT — authoritative, never client-supplied
    let actorId: string | null = null
    const authHeader = req.headers.get('Authorization')
    if (authHeader) {
      const u = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
      actorId = (await u.auth.getUser()).data.user?.id ?? null
    }
    if (!actorId) return json({ ok: false, error: 'unauthenticated' }, 401)

    const body = await req.json().catch(() => ({}))
    // action from body (frontend uses functions.invoke with a body) or ?action= query.
    const action = body.action ?? new URL(req.url).searchParams.get('action')
    const taskId = body.task_id ? String(body.task_id) : null

    // Notes live on a task → resolve project + org from the task (falls back to an explicit project_id).
    let projectId = String(body.project_id ?? '')
    if (taskId) {
      const { data: t } = await supabase.from('site_tasks').select('project_id').eq('task_id', taskId).maybeSingle()
      if (t?.project_id) projectId = t.project_id
    }
    if (!projectId) return json({ ok: false, error: 'task_id or project_id required' }, 400)

    // resolve org from the project + verify the caller belongs to it
    const { data: proj } = await supabase.from('projects').select('org_id, name').eq('project_id', projectId).maybeSingle()
    if (!proj) return json({ ok: false, error: 'project not found' }, 404)
    const orgId = proj.org_id as string
    const { data: membership } = await supabase.from('user_profiles').select('id').eq('id', actorId).eq('org_id', orgId).maybeSingle()
    if (!membership) return json({ ok: false, error: 'forbidden' }, 403)

    // ── CLASSIFY (no writes) ──────────────────────────────────────────────
    if (action === 'classify') {
      const text = String(body.text ?? '').trim()
      if (!text) return json({ ok: false, error: 'text required' }, 400)
      const result = await decompose(text, proj.name ? [proj.name] : [])
      // progress → "keep as note"; issue / todo(→snag) → the spawn suggestion.
      return json({ ok: true, items: result.items })
    }

    // ── SPAWN (create the first-class object) ─────────────────────────────
    if (action === 'spawn') {
      const type = body.type as 'issue' | 'todo'
      const item = body.item as SiteItem
      const noteId = body.note_id ? String(body.note_id) : null
      const noteKind = (body.note_kind === 'narration' ? 'narration' : 'comment') as 'comment' | 'narration'
      if (type !== 'issue' && type !== 'todo') return json({ ok: false, error: 'type must be issue|todo' }, 400)
      if (!item?.text) return json({ ok: false, error: 'item.text required' }, 400)

      // owner-resolution context (mirrors _agents/siteops.ts ownerCtx, inlined)
      const [{ data: mem }, { data: sup }, { data: prin }] = await Promise.all([
        supabase.from('user_profiles').select('id, name').eq('org_id', orgId),
        supabase.from('projects').select('supervisor_id').eq('project_id', projectId).maybeSingle(),
        supabase.from('user_profiles').select('id').eq('org_id', orgId).eq('role', 'principal').limit(1).maybeSingle(),
      ])
      const members = (mem ?? []) as OrgMember[]
      const supervisorId = (sup?.supervisor_id ?? null) as string | null
      const principalId = (prin?.id ?? null) as string | null
      // actor's phone → byLabel so createProblem's "skip notifying the creator" self-check works for UI too
      const byLabel = (await ownerPhone(supabase, actorId)) ?? `user:${actorId}`

      const rc: RouteCtx = {
        supabase, orgId, projectId, byLabel, members, supervisorId, principalId,
        narrationId: null, now: new Date(),
      }

      let id: string | null = null
      if (type === 'issue') {
        const cadence = await loadCadenceMap(supabase, orgId)
        id = (await createProblem(rc, item, taskId, cadence)).id
      } else {
        id = (await createTodo(rc, item, taskId)).id
      }
      if (!id) return json({ ok: false, error: 'spawn failed' }, 500)

      // provenance stamp — createProblem/createTodo don't accept these, so post-create UPDATE
      // (keeps the shared WhatsApp act-step untouched). The feed uses this to hide the raw note.
      const tbl = type === 'issue' ? 'problems' : 'todos'
      await supabase.from(tbl).update({ source_note_id: noteId, source_note_kind: noteKind }).eq('id', id)

      return json({ ok: true, id, kind: type })
    }

    return json({ ok: false, error: 'unknown action — use ?action=classify or ?action=spawn' }, 400)
  } catch (err) {
    console.error('[siteops-note] error:', err)
    return json({ ok: false, error: (err as Error).message }, 500)
  }
})
