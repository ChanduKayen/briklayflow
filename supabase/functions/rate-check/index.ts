// rate-check — for the billed line items a user PICKS on a PO, fetch live market prices from Serper
// (Google Shopping, region-scoped) and have the LLM (OpenAI) judge each billed rate against ONLY those
// listings — a grounded verdict with an honest confidence. Pure read; writes nothing.
//
// Retrieval (Serper) is kept separate from judgment (LLM): the LLM never searches, it only reasons over
// the listings we pass, and must say "no_benchmark" rather than invent a number. The raw listings are
// returned too, so a flag is auditable.
//
// DEPLOY: supabase functions deploy rate-check · needs SERPER_API_KEY + OPENAI_API_KEY.
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

interface InItem { id: string; name: string; unit: string; rate: number; qty: number }
interface Listing { title: string; price: string; source: string; link?: string }

// Serper Google Shopping (region-scoped). Falls back to organic snippets when Shopping is empty.
async function serperListings(key: string, item: InItem, region: string): Promise<Listing[]> {
  const q = `${item.name} ${item.unit} price ${region}`.replace(/\s+/g, ' ').trim();
  try {
    const shop = await fetch('https://google.serper.dev/shopping', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'in', location: region, num: 12 }),
    });
    if (shop.ok) {
      const d = await shop.json();
      const rows = (d?.shopping ?? []) as any[];
      const out = rows.filter((r) => r?.price).slice(0, 10).map((r) => ({ title: String(r.title ?? '').slice(0, 160), price: String(r.price), source: String(r.source ?? r.seller ?? ''), link: r.link }));
      if (out.length) return out;
    }
  } catch { /* fall through to organic */ }
  try {
    const org = await fetch('https://google.serper.dev/search', {
      method: 'POST',
      headers: { 'X-API-KEY': key, 'Content-Type': 'application/json' },
      body: JSON.stringify({ q, gl: 'in', location: region, num: 10 }),
    });
    if (org.ok) {
      const d = await org.json();
      const rows = (d?.organic ?? []) as any[];
      return rows.slice(0, 8).map((r) => ({ title: `${String(r.title ?? '')} — ${String(r.snippet ?? '')}`.slice(0, 220), price: '', source: String(r.link ?? '').replace(/^https?:\/\/(www\.)?/, '').split('/')[0] }));
    }
  } catch { /* none */ }
  return [];
}

async function judge(openaiKey: string, item: InItem, listings: Listing[], region: string): Promise<any> {
  if (listings.length === 0) {
    return { verdict: 'no_benchmark', market_low: null, market_high: null, confidence: 'low', reasoning: 'No usable market listings came back for this item.', sources: [] };
  }
  const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
  const prompt = `You are a procurement rate auditor for a construction firm in ${region}, India. Today is ${today}.

Line item on a vendor bill: "${item.name}" — billed at ₹${item.rate} per ${item.unit}, quantity ${item.qty}, bought from a LOCAL hardware / building-materials shop (retail, small quantity, cash-and-carry).

Live Google results for this item (ONLINE retail — treat as a rough UPPER bound; a local cash-and-carry shop is usually cheaper, and pack sizes / MOQs vary):
${listings.map((l, i) => `${i + 1}. ${l.title}${l.price ? ` — ${l.price}` : ''} [${l.source}]`).join('\n')}

Judge the billed rate using ONLY the listings above.
- Normalize every listing to a per-${item.unit} price; if a listing is a pack/set of unknown size, say so and lower confidence.
- Online retail carries shipping a local shop doesn't → an upper bound, not like-for-like.
- If the listings are the wrong item, too few, or too inconsistent to defend a range, verdict = "no_benchmark". NEVER invent numbers not supported by the listings.
- A billed rate within ~25% of a weak benchmark is "fair", not flagged. Only call "high" on a clear, consistent, close-spec gap.

Respond with ONLY a JSON object:
{"verdict":"fair"|"high"|"low"|"no_benchmark","market_low":number|null,"market_high":number|null,"confidence":"high"|"medium"|"low","reasoning":"max 2 short sentences, plain language for a builder","sources":["site or seller names, max 3"]}`;
  try {
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'gpt-4o', max_tokens: 500, temperature: 0.1, response_format: { type: 'json_object' }, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) throw new Error('llm');
    const d = await res.json();
    const j = JSON.parse(d.choices?.[0]?.message?.content || '{}');
    return {
      verdict: ['fair', 'high', 'low', 'no_benchmark'].includes(j.verdict) ? j.verdict : 'no_benchmark',
      market_low: j.market_low != null && Number(j.market_low) > 0 ? Number(j.market_low) : null,
      market_high: j.market_high != null && Number(j.market_high) > 0 ? Number(j.market_high) : null,
      confidence: ['high', 'medium', 'low'].includes(j.confidence) ? j.confidence : 'low',
      reasoning: j.reasoning ? String(j.reasoning) : '',
      sources: Array.isArray(j.sources) ? j.sources.slice(0, 3).map(String) : [],
    };
  } catch {
    return { verdict: 'error', market_low: null, market_high: null, confidence: 'low', reasoning: '', sources: [] };
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader) return json({ error: 'Missing authorization' }, 401);
    const userClient = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userErr } = await userClient.auth.getUser();
    if (userErr || !user) return json({ error: 'Invalid session' }, 401);

    const serperKey = Deno.env.get('SERPER_API_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    if (!serperKey || !openaiKey) return json({ ok: false, error: 'Rate check is not configured (SERPER/OPENAI key missing)' });

    const body = await req.json() as { region?: string; items?: InItem[] };
    const region = (body.region || 'India').trim();
    const items = (body.items ?? []).filter((i) => i?.name && Number(i.rate) > 0).slice(0, 25);
    if (!items.length) return json({ ok: false, error: 'No items to check' });

    // Sequential — keeps within Serper/LLM rate limits and is easy to reason about.
    const results: any[] = [];
    for (const it of items) {
      const listings = await serperListings(serperKey, it, region);
      const j = await judge(openaiKey, it, listings, region);
      results.push({ id: it.id, name: it.name, unit: it.unit, rate: it.rate, qty: it.qty, ...j, listings: listings.slice(0, 5) });
    }
    return json({ ok: true, results });
  } catch (err) {
    return json({ ok: false, error: (err as Error)?.message ?? 'Rate check failed' });
  }
});
