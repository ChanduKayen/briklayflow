// SiteOps generate — DRY-RUN view-model endpoint (Step 3 of the engine→UI cut).
//
// Loads a project's construction_stack + current completion state and returns the engine's
// ProjectVM. It WRITES NOTHING. This is the authored path only — NO classifier, NO LLM. It is the
// first time the real engine touches real geometry; the output is inspected before persistence is
// ever enabled.
//
//   POST { project_id }              → 200 { ok:true, vm: ProjectVM }   (dryRun:true)
//   POST { project_id } ?persist=true → flag is ACCEPTED BUT IGNORED for now (wired in Step 5).
//
// House style mirrors siteops-enrich: std@0.168.0 serve, CORS + OPTIONS. Uses the CALLER's auth so
// org RLS (org_id IN (SELECT get_my_org_ids())) scopes every read — no service-role needed for a
// read-only dry run.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
// The engine, bundled for Deno (scripts/build-engine-bundle.mjs). Single source of truth.
import { buildProjectVM, persistGraph, instantiate, stackToGeometry } from '../_shared/siteops-engine.js'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const url = new URL(req.url)
    const persist = url.searchParams.get('persist') === 'true' // Step-5 flag — IGNORED for now
    const { project_id } = await req.json()
    if (!project_id) throw new Error('project_id required')

    // Caller-auth client → RLS applies to every read (and to the Step-5 write).
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } },
    )

    // 1. load the project's resolved stack + name + capability flags
    let pRes = await supabase
      .from('projects')
      .select('project_id, org_id, name, construction_stack, has_common_areas, common_systems, suppressed_tasks')
      .eq('project_id', project_id)
      .single()
    if (pRes.error) pRes = await supabase
      .from('projects')
      .select('project_id, org_id, name, construction_stack, has_common_areas')
      .eq('project_id', project_id)
      .single()
    const project = pRes.data as (Record<string, unknown> & { construction_stack?: unknown; name?: string; has_common_areas?: boolean; common_systems?: string[]; suppressed_tasks?: string[]; org_id?: string; project_id?: string }) | null
    const pErr = pRes.error
    if (pErr || !project) throw new Error(`project not found / not visible: ${project_id}${pErr ? ` (${pErr.message})` : ''}`)
    if (!project.construction_stack) throw new Error(`project ${project_id} has no construction_stack — configure the build type first`)

    // 2. derive completion state from existing engine rows (node_key → status); empty if fresh /
    //    legacy (rows without node_key never match the fresh graph — an honest all-blocked dry run).
    const { data: existing, error: tErr } = await supabase
      .from('site_tasks')
      .select('node_key, status')
      .eq('project_id', project_id)
    if (tErr) throw new Error(`load tasks: ${tErr.message}`)
    const completionState = new Map<string, 'not_started' | 'active' | 'done'>()
    for (const r of existing ?? []) {
      if (r.node_key && (r.status === 'active' || r.status === 'done')) completionState.set(r.node_key, r.status)
    }

    // 3. build the view-model (dry-run — nothing written)
    const vm = buildProjectVM(project_id, project.construction_stack, completionState, {
      name: project.name ?? project_id,
      dryRun: !persist,
      generatedAt: new Date().toISOString(),
      hasCommonAreas: !!project.has_common_areas,
      hasExternalWorks: !!project.has_common_areas,
      commonSystems: project.common_systems ?? [],
      suppressedTasks: project.suppressed_tasks ?? [],
    })

    // 4. PERSIST is gated until the dry-run is inspected (Step 5). The flag is wired but disabled.
    let persisted: unknown = null
    if (persist) {
      // INTENTIONALLY DISABLED until Step 5 sign-off. To enable, uncomment:
      // const graph = instantiate(stackToGeometry(project.construction_stack, { hasCommonAreas: !!project.has_common_areas, hasExternalWorks: !!project.has_common_areas }))
      // persisted = await persistGraph(supabase, { project_id: project.project_id, org_id: project.org_id }, graph)
      // vm.dryRun = false
      void persistGraph; void instantiate; void stackToGeometry // keep imports live; see Step 5
      persisted = { skipped: 'persist is gated until the dry-run is inspected (Step 5)' }
    }

    return new Response(JSON.stringify({ ok: true, vm, persisted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('siteops-generate error:', err)
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
