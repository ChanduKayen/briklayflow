// wo-stage-drafter — Draft Work-Order stages from a free-text scope (B4 feature).
//
// Deterministic: trade templates + regex extraction of explicitly-quantified
// items. No DB, no LLM, no secrets. All guarantees live in ./logic.ts. sku-matcher
// and the SKU pipeline are untouched (this is a separate, new function).
//
// Request  : { scope_text, trade, contract_value | null, existing_stage_names[] }
// Response : { stages: [{ name, weight_pct | (quantity, unit_type, rate), mode }], rationale }
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { draftStages } from './logic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const body = await req.json().catch(() => ({}))
    const scope_text = String(body?.scope_text ?? '')
    const trade = body?.trade != null ? String(body.trade) : null
    const contract_value =
      typeof body?.contract_value === 'number' && body.contract_value > 0 ? body.contract_value : null
    const existing_stage_names = Array.isArray(body?.existing_stage_names)
      ? body.existing_stage_names.map((x: unknown) => String(x))
      : []

    const result = draftStages({ scope_text, trade, contract_value, existing_stage_names })

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (e) {
    return new Response(
      JSON.stringify({ error: String((e as Error)?.message ?? e), stages: [], rationale: '' }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  }
})
