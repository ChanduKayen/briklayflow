// split-daybook-entry — read a Day Book capture (the original WhatsApp text and/or the proof image)
// and break it into the SEPARATE payments it describes, so the "split into multiple transactions"
// editor can seed one row per payment. Returns { splits: [{ payee_name, amount, project_name?,
// description? }] }. A single payment returns one element. Pure read — writes nothing.
//
// Same LLM as the other AI functions (OpenAI GPT-4o). Text is primary; the proof image is used as a
// fallback when there's little/no text and a directly-fetchable URL is supplied.
//
// DEPLOY: supabase functions deploy split-daybook-entry · needs OPENAI_API_KEY.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import OpenAI from 'https://esm.sh/openai@4';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const openai = new OpenAI({ apiKey: Deno.env.get('OPENAI_API_KEY') });

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SYSTEM_PROMPT = `You read an informal construction site payment note (often in Indian English / Hindi / Telugu, may be a WhatsApp message or a photo of a handwritten note) and break it into the SEPARATE payments it describes.

Return STRICT JSON: { "splits": [ { "payee_name": string|null, "amount": number|null, "project_name": string|null, "description": string|null } ] }

Rules:
- One element per distinct payment. If the note describes a single payment, return exactly one element.
- payee_name: the person/vendor paid for that slice (e.g. "Ramesh", "Suri labour"). null if not stated.
- amount: the rupee amount for that slice as a plain number (no symbols/commas). Interpret "50k" as 50000, "1.5L"/"1.5 lakh" as 150000. null if not stated.
- project_name / description: the site and what-for for that slice, if stated; else null.
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

    if (!text && !body.image_url) return json({ error: 'Nothing to read' }, 400);

    const parts: any[] = [];
    // The proof image, when there's little text and a fetchable URL is given.
    if (body.image_url && text.length < 12) {
      try {
        const resp = await fetch(body.image_url);
        if (resp.ok) {
          const buf = new Uint8Array(await resp.arrayBuffer());
          let bin = ''; const chunk = 8192;
          for (let i = 0; i < buf.length; i += chunk) bin += String.fromCharCode(...buf.subarray(i, i + chunk));
          const mime = resp.headers.get('content-type') || 'image/jpeg';
          parts.push({ type: 'image_url', image_url: { url: `data:${mime};base64,${btoa(bin)}` } });
        }
      } catch { /* fall back to text-only */ }
    }
    parts.push({
      type: 'text',
      text: `Payment note:\n"""${text || '(see attached image)'}"""\n${total > 0 ? `\nStated grand total: ₹${total}. The amounts should sum to this.` : ''}\n\nReturn the splits as JSON.`,
    });

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      max_tokens: 900,
      temperature: 0.1,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: parts as any },
      ],
    });

    const raw = completion.choices[0]?.message?.content?.trim() ?? '';
    let parsed: any = {};
    try { parsed = JSON.parse(raw); } catch { parsed = {}; }
    const splits = Array.isArray(parsed?.splits) ? parsed.splits : [];
    // Normalise numbers and drop empty rows.
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
    return json({ ok: false, error: (err as Error)?.message ?? 'Could not split the entry', splits: [] }, 200);
  }
});
