// Site-ops Pass-2 enrichment — edge function (stage 2c).
//
// Wraps the block-0 enrich logic (src/lib/siteOps/enrich.ts) so the task view can fire it LIVE
// with the user's auth: enrich needs the LLM key, so it can't run client-side. The shared
// enrichProject does one LLM call per phase and WRITES each phase's description + 3 QC rows as
// it returns (replace discipline) — so realtime pushes the result to the watching client in
// phase-sized waves. Re-runnable; never touches task structure or source='manual'.
//
// House style: serve from std@0.168.0, service-role client, ANTHROPIC/OPENAI key from Deno.env,
// CORS + OPTIONS. Mirrors ai-extract-entry. Default verify_jwt (the client invokes with auth).
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { enrichProject } from '../../../src/lib/siteOps/enrich.ts'
// The one canonical sequence document — same file the CLI runner and the expander read.
import sequence from '../../../docs/site-ops/sequence.json' with { type: 'json' }

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ENRICH_MODEL_ANTHROPIC = Deno.env.get('SITEOPS_ENRICH_MODEL') ?? 'claude-sonnet-4-20250514'
const ENRICH_MODEL_OPENAI = Deno.env.get('SITEOPS_ENRICH_MODEL_OPENAI') ?? 'gpt-4.1'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { project_id } = await req.json()
    if (!project_id) throw new Error('project_id required')

    const ANTHROPIC = Deno.env.get('ANTHROPIC_API_KEY')
    const OPENAI = Deno.env.get('OPENAI_API_KEY')
    if (!ANTHROPIC && !OPENAI) throw new Error('No AI API key configured (ANTHROPIC_API_KEY / OPENAI_API_KEY)')

    // Service-role client: enrich writes across the org's tasks (RLS-exempt, server-only key).
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    // Raw-text LLM caller — Anthropic preferred, OpenAI fallback, temp 0, strict JSON. Mirrors
    // the CLI runner (scripts/siteops-enrich.mjs) and ai-extract-entry's house pattern.
    const llm = async (system: string, user: string): Promise<string> => {
      if (ANTHROPIC) {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: ENRICH_MODEL_ANTHROPIC, max_tokens: 3000, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
        })
        const d = await r.json()
        return d.content?.[0]?.text ?? ''
      }
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: ENRICH_MODEL_OPENAI, max_tokens: 3000, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      })
      const d = await r.json()
      return d.choices?.[0]?.message?.content ?? ''
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- imported JSON ↔ Sequence type
    const report = await enrichProject(supabase, llm, project_id, sequence as any)

    return new Response(JSON.stringify({ ok: true, report }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (err) {
    console.error('siteops-enrich error:', err)
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
