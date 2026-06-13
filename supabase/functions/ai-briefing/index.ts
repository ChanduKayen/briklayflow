// Dashboard AI briefing — proxies the Anthropic call that used to run in the
// browser with VITE_ANTHROPIC_API_KEY (see Sprint 0.5 incident).
//
// The Anthropic key NEVER reaches the client. It is read here from function
// secrets (ANTHROPIC_API_KEY). The client sends the already-computed dashboard
// context; this function calls Anthropic and returns the text. If the key isn't
// configured, it returns a graceful fallback so the dashboard still renders.

import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL      = Deno.env.get('SUPABASE_URL')!
const ANON_KEY          = Deno.env.get('SUPABASE_ANON_KEY')!
const ANTHROPIC_API_KEY = Deno.env.get('ANTHROPIC_API_KEY')

const FALLBACK = 'Open items need your attention. Check the action items below.'

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })

  // Require an authenticated caller (don't let anonymous traffic burn API spend).
  const authHeader = req.headers.get('Authorization') ?? ''
  if (!authHeader) return json({ briefing: FALLBACK })
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
  })
  const { data: { user } } = await userClient.auth.getUser()
  if (!user) return json({ briefing: FALLBACK })

  if (!ANTHROPIC_API_KEY) return json({ briefing: FALLBACK })

  let context: unknown = {}
  try { context = (await req.json())?.context ?? {} } catch { /* keep {} */ }

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 120,
        messages: [{
          role: 'user',
          content: `You are a construction finance assistant for Briklay Engineering. Write a 2-3 line daily briefing based on this data. Be specific, actionable, and concise. No greetings. Just facts + actions. Data: ${JSON.stringify(context)}`,
        }],
      }),
    })
    const data = await res.json()
    return json({ briefing: data?.content?.[0]?.text || 'Everything looks on track today.' })
  } catch {
    return json({ briefing: FALLBACK })
  }
})
