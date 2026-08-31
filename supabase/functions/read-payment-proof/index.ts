// read-payment-proof — read a payment screenshot (UPI app / bank / card receipt) and pull the
// transaction reference details, so they can be attached to the transaction's notes. Returns
// { ok, platform, mode, ref_no, utr, amount, date, payee, bank }. Pure read — writes nothing.
//
// Uses whichever AI key is configured — ANTHROPIC_API_KEY (Claude Haiku) first, else OPENAI_API_KEY
// (GPT-4o) — mirroring ai-extract-entry / split-daybook-entry.
//
// DEPLOY: supabase functions deploy read-payment-proof
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

const SYSTEM_PROMPT = `You read a PAYMENT PROOF screenshot — a UPI app (GPay, PhonePe, Paytm, CRED, BHIM…), a bank transfer/NEFT/IMPS/RTGS receipt, or a card/cheque receipt — and extract the transaction reference details.

Return ONLY valid JSON, no other text:
{
  "platform": string|null,   // the app/bank shown, e.g. "CRED", "Google Pay", "PhonePe", "HDFC Bank", "SBI"
  "mode": "UPI"|"NEFT"|"IMPS"|"RTGS"|"Cash"|"Cheque"|"Card"|null,
  "ref_no": string|null,     // the transaction / reference / order id shown (UPI ref, txn id, order no)
  "utr": string|null,        // the UTR / bank RRN number if shown (often 12 digits)
  "amount": number|null,     // rupee amount as a plain number (no symbols/commas)
  "date": "YYYY-MM-DD"|null, // the payment date if shown
  "payee": string|null,      // who was paid (the recipient name/handle), transliterate native script to Latin
  "bank": string|null        // recipient bank if shown
}

Rules:
- Only what the screenshot actually shows; NEVER invent a number. Unknown → null.
- Prefer the exact reference string as printed (keep digits/letters verbatim).
- If the image is not a payment proof, return all nulls.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Invalid session' }, 401);

    const body = await req.json() as { image_url?: string | null };
    const imageUrl = body.image_url || null;
    if (!imageUrl) return json({ error: 'image_url is required' }, 400);

    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY');
    if (!ANTHROPIC_KEY && !OPENAI_KEY) return json({ ok: false, error: 'No AI API key configured' });

    const userText = 'Read this payment proof and return the reference details as JSON.';
    let parsed: any = {};

    if (ANTHROPIC_KEY) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001', max_tokens: 500, system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: [{ type: 'image', source: { type: 'url', url: imageUrl } }, { type: 'text', text: userText }] }],
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const raw = (d.content?.[0]?.text || '{}').replace(/^```json\n?|\n?```$/g, '').trim();
        try { parsed = JSON.parse(raw); } catch { /* keep empty */ }
      }
    } else if (OPENAI_KEY) {
      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o', max_tokens: 500, temperature: 0.1, response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: SYSTEM_PROMPT }, { role: 'user', content: [{ type: 'image_url', image_url: { url: imageUrl } }, { type: 'text', text: userText }] }],
        }),
      });
      if (res.ok) {
        const d = await res.json();
        try { parsed = JSON.parse(d.choices?.[0]?.message?.content || '{}'); } catch { /* keep empty */ }
      }
    }

    const s = (v: any) => (v != null && String(v).trim() ? String(v).trim() : null);
    return json({
      ok: true,
      platform: s(parsed?.platform),
      mode: s(parsed?.mode),
      ref_no: s(parsed?.ref_no),
      utr: s(parsed?.utr),
      amount: parsed?.amount != null && Number(parsed.amount) > 0 ? Number(parsed.amount) : null,
      date: s(parsed?.date),
      payee: s(parsed?.payee),
      bank: s(parsed?.bank),
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error)?.message ?? 'Could not read the proof' });
  }
});
