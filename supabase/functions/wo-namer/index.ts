// wo-namer — turn a detailed work-order scope into a short, human header that names
// the contract (e.g. "RCC structure including foundation, columns…" → "RCC Structure").
//
// The OpenAI key NEVER reaches the client — it's read here from function secrets
// (OPENAI_API_KEY), the same setup as the other functions. Returns a deterministic
// fallback header if the key isn't configured or the call fails, so the hub never blocks.
//
// Request  : { scope: string, trade?: string|null, project?: string|null }
// Response : { title: string }

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL   = Deno.env.get('SUPABASE_URL')!
const ANON_KEY       = Deno.env.get('SUPABASE_ANON_KEY')!
const OPENAI_API_KEY = Deno.env.get('OPENAI_API_KEY')

// Deterministic fallback: first clause of the scope, tidied and capped — never blank.
function fallbackTitle(scope: string): string {
  const first = String(scope || '').replace(/^e\.g\.\s*/i, '').split(/[—,.;\n]/)[0].trim();
  const t = first || 'Contract';
  return t.length > 48 ? t.slice(0, 46).trimEnd() + '…' : t;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } })

  let scope = '', trade: string | null = null, project: string | null = null
  try {
    const b = await req.json()
    scope = String(b?.scope ?? '')
    trade = b?.trade != null ? String(b.trade) : null
    project = b?.project != null ? String(b.project) : null
  } catch { /* keep defaults */ }

  if (!scope.trim()) return json({ title: 'Contract' })

  // Require an authenticated caller — don't let anonymous traffic burn API spend.
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ title: fallbackTitle(scope) })
  const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ title: fallbackTitle(scope) })

  if (!OPENAI_API_KEY) return json({ title: fallbackTitle(scope) })

  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${OPENAI_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        max_tokens: 24,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: 'You name construction subcontracts. Given a scope, reply with ONLY a short title a site team would recognise: 2–5 words, Title Case, no quotes, no trailing punctuation, no project name.',
          },
          {
            role: 'user',
            content:
              (trade ? `Trade: ${trade}\n` : '') +
              (project ? `Project: ${project}\n` : '') +
              `Scope: ${scope}`,
          },
        ],
      }),
    })
    const data = await res.json()
    const raw = String(data?.choices?.[0]?.message?.content ?? '').trim().replace(/^["'\s]+|["'.\s]+$/g, '')
    const title = raw.split('\n')[0].slice(0, 60).trim()
    return json({ title: title || fallbackTitle(scope) })
  } catch {
    return json({ title: fallbackTitle(scope) })
  }
})
