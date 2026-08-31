// split-daybook-entry — read a Day Book capture (original WhatsApp text and/or the proof image) and
// break it into the SEPARATE payments it describes, so the "split into multiple transactions" editor
// can seed one row per payment. Returns { splits: [{ payee_name, amount, project_name?, description? }] }.
// A single payment returns one element. Pure read — writes nothing.
//
// Uses whichever AI key is configured — ANTHROPIC_API_KEY (Claude Haiku) first, else OPENAI_API_KEY
// (GPT-4o) — mirroring ai-extract-entry, so it works with the same setup.
//
// DEPLOY: supabase functions deploy split-daybook-entry
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SYSTEM_PROMPT = `You read an informal construction site payment note (often Indian English / Hindi / Telugu, may be a WhatsApp message or a photo of a handwritten note) and break it into the SEPARATE payments it describes.

Return ONLY valid JSON, no other text:
{ "splits": [ { "payee_name": string|null, "amount": number|null, "project_name": string|null, "description": string|null } ] }

Rules:
- One element per distinct payment. A single payment → exactly one element.
- payee_name: the person/vendor paid for that slice (e.g. "Ramesh", "Suri labour"). Transliterate native-script names to Latin, never translate. null if not stated.
- amount: rupees for that slice as a plain number, no symbols/commas. "50k"→50000, "1.5L"/"1.5 lakh"→150000, "ఐదు వేలు"→5000. null if not stated.
- project_name / description: the site and what-for for that slice, in plain English, if stated; else null. Translate descriptive words (ప్లాస్టరింగ్ → "Plastering"); keep names/digits verbatim.
- Do NOT invent names, amounts, or sites. Only what the note actually says.
- Amounts should add up to the stated grand total when one is given.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    // Authenticate the caller (an org member splitting their own capture).
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Invalid session' }, 401);

    const body = await req.json() as { text?: string; image_url?: string | null; total?: number };
    const text = (body.text ?? '').trim();
    const total = Number(body.total) || 0;
    const imageUrl = body.image_url || null;
    if (!text && !imageUrl) return json({ error: 'Nothing to read' }, 400);

    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!ANTHROPIC_KEY && !OPENAI_KEY) return json({ ok: false, error: 'No AI API key configured', splits: [] });

    const userText = `Payment note:\n"""${text || '(see attached image)'}"""\n${total > 0 ? `\nStated grand total: ₹${total}. The amounts should sum to this.` : ''}\n\nReturn the splits as JSON.`;

    let parsed: any = {};

    if (ANTHROPIC_KEY) {
      const content: any[] = imageUrl
        ? [{ type: 'image', source: { type: 'url', url: imageUrl } }, { type: 'text', text: userText }]
        : [{ type: 'text', text: userText }];
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({ model: 'claude-haiku-4-5-20251001', max_tokens: 900, system: SYSTEM_PROMPT, messages: [{ role: 'user', content }] }),
      });
      if (res.ok) {
        const d = await res.json();
        const raw = (d.content?.[0]?.text || '{}').replace(/^```json\n?|\n?```$/g, '').trim();
        try { parsed = JSON.parse(raw); } catch { /* keep empty */ }
      }
    } else if (OPENAI_KEY) {
      const userMsg: any = imageUrl
        ? { role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }, { type: 'text', text: userText }] }
        : { role: 'user', content: userText };
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'gpt-4o', max_tokens: 900, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: SYSTEM_PROMPT }, userMsg] }),
      });
      if (res.ok) {
        const d = await res.json();
        try { parsed = JSON.parse(d.choices?.[0]?.message?.content || '{}'); } catch { /* keep empty */ }
      }
    }

    const splits = Array.isArray(parsed?.splits) ? parsed.splits : [];
    const clean = splits
      .map((s: any) => ({
        payee_name: s?.payee_name ? String(s.payee_name).trim() : null,
        amount: s?.amount != null && Number(s.amount) > 0 ? Number(s.amount) : null,
        project_name: s?.project_name ? String(s.project_name).trim() : null,
        description: s?.description ? String(s.description).trim() : null,
      }))
      .filter((s: any) => s.payee_name || s.amount);

    return json({ ok: true, splits: clean });
  } catch (err) {
    return json({ ok: false, error: (err as Error)?.message ?? 'Could not split the entry', splits: [] });
  }
});
