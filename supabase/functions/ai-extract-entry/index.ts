import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ── Levenshtein distance ──────────────────────────────────────────────────────
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) {
    dp[i] = new Array(n + 1).fill(0);
    dp[i][0] = i;
  }
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function getInitials(name: string): string {
  return name.split(/[\s'-]+/).map(w => w[0] || '').join('').toUpperCase();
}

// ── Types ─────────────────────────────────────────────────────────────────────
type Conf = 'HIGH' | 'MEDIUM' | 'LOW';
interface StakeholderRow { stakeholder_id: string; name: string; type: string; category: string; }
interface ProjectRow { project_id: string; name: string; }
interface MatchEntry { id: string; name: string; type: string; category: string; confidence: Conf; score: number; }

// ── Stakeholder fuzzy matching ────────────────────────────────────────────────
function matchPayee(raw: string, stakeholders: StakeholderRow[]): {
  matched: boolean; confidence: Conf;
  bestId?: string; bestName?: string;
  closest: Array<{ id: string; name: string; type: string; category: string }>;
} {
  if (!raw?.trim() || !stakeholders.length) return { matched: false, confidence: 'LOW', closest: [] };

  const q = raw.toLowerCase().trim();
  const candidates: MatchEntry[] = [];

  for (const s of stakeholders) {
    const sn = s.name.toLowerCase();
    let score = Infinity;
    let conf: Conf = 'LOW';

    if (sn === q) {
      score = 0; conf = 'HIGH';
    } else if (sn.includes(q) && q.length >= 3) {
      score = 1; conf = 'HIGH';
    } else if (q.includes(sn) && sn.length >= 3) {
      score = 1; conf = 'HIGH';
    } else {
      const snFirst = sn.split(/\s+/)[0];
      const qFirst = q.split(/\s+/)[0];
      if (snFirst === qFirst && snFirst.length > 2) {
        score = 2; conf = 'MEDIUM';
      } else {
        const dist = levenshtein(q, sn);
        if (dist <= 2) {
          score = dist + 3; conf = 'MEDIUM';
        } else if (dist / Math.max(q.length, sn.length) <= 0.4) {
          score = dist + 6; conf = 'LOW';
        } else {
          const abbr = getInitials(s.name);
          const qClean = q.replace(/\s+/g, '').toUpperCase();
          if (abbr === qClean && qClean.length >= 2) {
            score = 4; conf = 'MEDIUM';
          } else if (sn.split(/\s+/).some((w: string) => w.startsWith(q) && q.length >= 3)) {
            score = 5; conf = 'MEDIUM';
          }
        }
      }
    }
    if (score < Infinity) {
      candidates.push({ id: s.stakeholder_id, name: s.name, type: s.type, category: s.category, confidence: conf, score });
    }
  }

  candidates.sort((a, b) => a.score - b.score);
  let top = candidates.slice(0, 2);

  if (top.length === 0) {
    const all = stakeholders.map(s => ({
      id: s.stakeholder_id, name: s.name, type: s.type, category: s.category,
      confidence: 'LOW' as Conf,
      score: levenshtein(q, s.name.toLowerCase()),
    }));
    all.sort((a, b) => a.score - b.score);
    top = all.slice(0, 2);
    return { matched: false, confidence: 'LOW', closest: top.map(c => ({ id: c.id, name: c.name, type: c.type, category: c.category })) };
  }

  const best = top[0];
  const mapped = top.map(c => ({ id: c.id, name: c.name, type: c.type, category: c.category }));
  if (best.confidence === 'HIGH') return { matched: true, confidence: 'HIGH', bestId: best.id, bestName: best.name, closest: mapped };
  if (best.confidence === 'MEDIUM') return { matched: true, confidence: 'MEDIUM', bestId: best.id, bestName: best.name, closest: mapped };
  return { matched: false, confidence: 'LOW', closest: mapped };
}

// ── Project fuzzy matching ────────────────────────────────────────────────────
function matchProject(raw: string, projects: ProjectRow[]): {
  matched: boolean; confidence: Conf;
  id?: string; name?: string;
  closest: Array<{ id: string; name: string }>;
} {
  if (!raw?.trim() || !projects.length) return { matched: false, confidence: 'LOW', closest: [] };
  const q = raw.toLowerCase().trim();

  for (const p of projects) {
    const pn = p.name.toLowerCase();
    if (pn === q || (pn.includes(q) && q.length >= 3) || (q.includes(pn) && pn.length >= 3)) {
      return { matched: true, confidence: 'HIGH', id: p.project_id, name: p.name, closest: [{ id: p.project_id, name: p.name }] };
    }
    const abbr = getInitials(p.name);
    const qClean = q.replace(/\s+/g, '').toUpperCase();
    if (abbr === qClean && qClean.length >= 2) {
      return { matched: true, confidence: 'MEDIUM', id: p.project_id, name: p.name, closest: [{ id: p.project_id, name: p.name }] };
    }
  }

  const all = projects.map(p => ({ id: p.project_id, name: p.name, score: levenshtein(q, p.name.toLowerCase()) }));
  all.sort((a, b) => a.score - b.score);
  return { matched: false, confidence: 'LOW', closest: all.slice(0, 2).map(p => ({ id: p.id, name: p.name })) };
}

// ── Category inference ────────────────────────────────────────────────────────
const CATEGORY_MAP: Array<{ kw: string[]; code: string; name: string }> = [
  { kw: ['plastering', 'plaster', 'render', 'pointing'],              code: 'WRK-06', name: 'Plastering' },
  { kw: ['cement', 'opc', 'ppc', 'concrete', 'bag'],                  code: 'MAT-04', name: 'Cement' },
  { kw: ['labour', 'labor', 'coolie', 'mason', 'worker', 'muzdoor'], code: 'WRK-01', name: 'Labour' },
  { kw: ['sand', 'river sand', 'msand', 'm-sand', 'psand'],           code: 'MAT-02', name: 'Sand' },
  { kw: ['steel', 'rebar', 'tmt', 'iron rod'],                        code: 'MAT-03', name: 'Steel' },
  { kw: ['brick', 'block', 'aac', 'fly ash'],                          code: 'MAT-01', name: 'Bricks' },
  { kw: ['tile', 'flooring', 'granite', 'marble'],                    code: 'WRK-09', name: 'Flooring' },
  { kw: ['paint', 'painting', 'primer', 'putty'],                     code: 'WRK-08', name: 'Painting' },
  { kw: ['electric', 'wiring', 'mcb', 'switchboard'],                 code: 'WRK-04', name: 'Electrical' },
  { kw: ['plumbing', 'sanitary', 'fitting', 'tap'],                   code: 'WRK-05', name: 'Plumbing' },
  { kw: ['shuttering', 'formwork', 'centering'],                      code: 'WRK-02', name: 'Shuttering' },
  { kw: ['excavation', 'earthwork', 'digging', 'jcb'],               code: 'WRK-03', name: 'Excavation' },
  { kw: ['transport', 'lorry', 'tipper', 'diesel'],                   code: 'GEN-04', name: 'Transport' },
  { kw: ['carpenter', 'woodwork', 'door', 'window frame'],           code: 'WRK-07', name: 'Carpentry' },
];

function inferCategory(desc: string, txnType?: string | null): { code: string | null; name: string | null } {
  if (!desc) return { code: null, name: null };
  const d = desc.toLowerCase();
  for (const c of CATEGORY_MAP) {
    if (c.kw.some(k => d.includes(k))) return { code: c.code, name: c.name };
  }
  if (txnType === 'Worker Payment') return { code: 'WRK-01', name: 'Labour' };
  if (txnType === 'Material Purchase') return { code: 'MAT-99', name: 'Materials (Other)' };
  return { code: null, name: null };
}

function calcOverall(payeeConf: Conf, amountConf: Conf, projConf: Conf | null, descConf: Conf): Conf {
  const vals: Conf[] = [payeeConf, amountConf, descConf];
  if (projConf) vals.push(projConf);
  if (vals.includes('LOW')) return 'LOW';
  if (vals.includes('MEDIUM')) return 'MEDIUM';
  return 'HIGH';
}

// ── Description builder (server-side fallback) ───────────────────────────────
function buildDescription(e: {
  work_type?: string | null; floor_or_area?: string | null;
  material_name?: string | null; material_quantity?: string | null;
  material_unit?: string | null; payee_raw?: string | null;
}): string {
  if (e.work_type && e.floor_or_area) return `${e.work_type} - ${e.floor_or_area}`;
  if (e.work_type) return e.work_type;
  if (e.material_name && e.material_quantity) return `${e.material_name} - ${e.material_quantity} ${e.material_unit || ''}`.trim();
  if (e.material_name) return e.material_name;
  if (e.payee_raw) return `Payment to ${e.payee_raw}`;
  return '';
}

// ── Main handler ──────────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { entry_id } = await req.json();
    if (!entry_id) throw new Error('entry_id required');

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    );

    const { data: entry, error: entryErr } = await supabase
      .from('rough_entries').select('*').eq('id', entry_id).single();
    if (entryErr || !entry) throw new Error('Entry not found');

    const [{ data: stakeholders }, { data: projects }] = await Promise.all([
      supabase.from('stakeholders').select('stakeholder_id, name, type, category').order('name'),
      supabase.from('projects').select('project_id, name').eq('status', 'Active'),
    ]);

    const inputText = entry.transcribed_text || entry.raw_text || '';
    if (!inputText && !entry.raw_image_url) {
      await supabase.from('rough_entries').update({ ai_extracted: { processed: true } }).eq('id', entry_id);
      return new Response(JSON.stringify({ ok: true }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY');
    const OPENAI_KEY = Deno.env.get('OPENAI_API_KEY');

    if (!ANTHROPIC_KEY && !OPENAI_KEY) {
      await supabase.from('rough_entries')
        .update({ ai_extracted: { processed: true, error: 'No AI API key configured' } })
        .eq('id', entry_id);
      return new Response(JSON.stringify({ ok: false, error: 'No API key' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // ── STEP 1: AI extracts raw strings ───────────────────────────────────────
    const today = new Date().toLocaleDateString('en-IN', { day: '2-digit', month: '2-digit', year: 'numeric' });
    const systemPrompt = `You are a construction accounting assistant (Briklay Engineering, Kakinada, AP).
Extract raw transaction details from the input. Input may be English, Telugu, Hindi, or mixed.

Amount rules: 5k/5K→5000, 1.5L→150000, fifty thousand→50000, ఐదు వేలు→5000, 5,000→5000
Telugu: icchanu/iccham→paid, konnam→bought, ki/ku→to, nakit→Cash
Today: ${today}

description_raw rules — build from extracted parts, NEVER copy raw input:
- Worker Payment with work_type + floor_or_area: "[work_type] - [floor_or_area]"
- Worker Payment with only work_type: "[work_type]"
- Material Purchase: "[material_name] - [material_quantity] [material_unit]"
- Fallback: category name or "Payment to [payee_raw]"

Examples:
"ramu 5000 cash plastering 2nd floor" → {"payee_raw":"ramu","amount":5000,"mode":"Cash","transaction_type":"Worker Payment","work_type":"Plastering","floor_or_area":"2nd floor","description_raw":"Plastering - 2nd floor","material_name":null,"material_quantity":null,"material_unit":null,"project_raw":null,"date_raw":null}
"cement 50 bags lakshmi 7000" → {"payee_raw":"lakshmi","amount":7000,"mode":null,"transaction_type":"Material Purchase","work_type":null,"floor_or_area":null,"material_name":"Cement","material_quantity":"50","material_unit":"bags","description_raw":"Cement - 50 bags","project_raw":null,"date_raw":null}
"suresh electrician 3rd floor 15000 neft" → {"payee_raw":"suresh","amount":15000,"mode":"NEFT","transaction_type":"Worker Payment","work_type":"Electrical wiring","floor_or_area":"3rd floor","description_raw":"Electrical wiring - 3rd floor","material_name":null,"material_quantity":null,"material_unit":null,"project_raw":null,"date_raw":null}
"paid 100 to raju" → {"payee_raw":"raju","amount":100,"mode":null,"transaction_type":"Worker Payment","work_type":null,"floor_or_area":null,"description_raw":"Payment to Raju","material_name":null,"material_quantity":null,"material_unit":null,"project_raw":null,"date_raw":null}

Return ONLY valid JSON, no other text:
{
  "payee_raw": string | null,
  "amount": number | null,
  "project_raw": string | null,
  "description_raw": string | null,
  "mode": "Cash"|"NEFT"|"UPI"|"Cheque"|null,
  "transaction_type": "Worker Payment"|"Material Purchase"|"General Expense"|null,
  "work_type": string | null,
  "floor_or_area": string | null,
  "material_name": string | null,
  "material_quantity": string | null,
  "material_unit": string | null,
  "date_raw": string | null
}`;

    let aiRaw: Record<string, unknown> = {};

    if (ANTHROPIC_KEY) {
      const userContent: any[] = entry.raw_image_url
        ? [{ type: 'image', source: { type: 'url', url: entry.raw_image_url } }, { type: 'text', text: inputText || 'Extract transaction details from this image.' }]
        : [{ type: 'text', text: inputText }];

      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'x-api-key': ANTHROPIC_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: 'user', content: userContent }],
        }),
      });
      if (res.ok) {
        const d = await res.json();
        const raw = (d.content?.[0]?.text || '{}').replace(/^```json\n?|\n?```$/g, '').trim();
        try { aiRaw = JSON.parse(raw); } catch { /* keep empty */ }
      }
    } else if (OPENAI_KEY) {
      const userMsg: any = entry.raw_image_url
        ? { role: 'user', content: [{ type: 'image_url', image_url: { url: entry.raw_image_url } }, { type: 'text', text: inputText || 'Extract transaction details.' }] }
        : { role: 'user', content: inputText };

      const res = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${OPENAI_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: 'gpt-4o',
          max_tokens: 300,
          messages: [{ role: 'system', content: systemPrompt }, userMsg],
          response_format: { type: 'json_object' },
        }),
      });
      if (res.ok) {
        const d = await res.json();
        try { aiRaw = JSON.parse(d.choices?.[0]?.message?.content || '{}'); } catch { /* keep empty */ }
      }
    }

    // ── STEP 2: Server-side payee matching ────────────────────────────────────
    const payeeRaw = (aiRaw.payee_raw as string | null) ?? null;
    let payeeId: string | null = null;
    let payeeName: string | null = null;
    let payeeMatched = false;
    let payeeUnmatched = false;
    let payeeConf: Conf = 'LOW';
    let payeeClosest: Array<{ id: string; name: string; type: string; category: string }> = [];

    if (payeeRaw && (stakeholders as StakeholderRow[])?.length) {
      const r = matchPayee(payeeRaw, stakeholders as StakeholderRow[]);
      payeeMatched = r.matched;
      payeeUnmatched = !r.matched;
      payeeConf = r.confidence;
      payeeClosest = r.closest;
      if (r.matched) { payeeId = r.bestId ?? null; payeeName = r.bestName ?? null; }
    }

    // ── STEP 3: Server-side project matching ─────────────────────────────────
    const projectRaw = (aiRaw.project_raw as string | null) ?? null;
    let projectId: string | null = null;
    let projectName: string | null = null;
    let projectMatched = false;
    let projectUnmatched = false;
    let projConf: Conf | null = null;
    let projectClosest: Array<{ id: string; name: string }> = [];

    if (projectRaw && (projects as ProjectRow[])?.length) {
      const r = matchProject(projectRaw, projects as ProjectRow[]);
      projectMatched = r.matched;
      projectUnmatched = !r.matched;
      projConf = r.confidence;
      projectClosest = r.closest;
      if (r.matched) { projectId = r.id ?? null; projectName = r.name ?? null; }
    }

    // ── STEP 4: Work / material fields + description ──────────────────────────
    const amount = typeof aiRaw.amount === 'number' ? aiRaw.amount : null;
    const txnType = (aiRaw.transaction_type as string | null) ?? null;
    const workType = (aiRaw.work_type as string | null) ?? null;
    const floorOrArea = (aiRaw.floor_or_area as string | null) ?? null;
    const materialName = (aiRaw.material_name as string | null) ?? null;
    const materialQty = (aiRaw.material_quantity as string | null) ?? null;
    const materialUnit = (aiRaw.material_unit as string | null) ?? null;
    const descRaw = (aiRaw.description_raw as string | null) ||
      buildDescription({
        work_type: workType, floor_or_area: floorOrArea,
        material_name: materialName, material_quantity: materialQty,
        material_unit: materialUnit, payee_raw: payeeRaw,
      }) || null;
    const { code: catCode, name: catName } = inferCategory(
      descRaw ?? workType ?? materialName ?? '', txnType,
    );

    // ── STEP 5: Confidence ────────────────────────────────────────────────────
    const amountConf: Conf = amount != null ? 'HIGH' : 'LOW';
    const descConf: Conf = descRaw ? 'HIGH' : 'MEDIUM';
    const overallConf = calcOverall(
      payeeRaw ? payeeConf : 'LOW',
      amountConf,
      projectRaw ? projConf : null,
      descConf,
    );

    const extracted = {
      processed: true,
      payee_raw: payeeRaw,
      project_raw: projectRaw,
      payee_id: payeeId,
      payee_name: payeeName ?? payeeRaw,
      payee_matched: payeeMatched,
      payee_unmatched: payeeUnmatched,
      payee_confidence: payeeRaw ? payeeConf : null,
      payee_closest_match: payeeClosest,
      project_id: projectId,
      project_name: projectName,
      project_matched: projectMatched,
      project_unmatched: projectUnmatched,
      project_confidence: projConf,
      project_closest_match: projectClosest,
      amount,
      date: aiRaw.date_raw ?? null,
      mode: aiRaw.mode ?? null,
      transaction_type: txnType,
      work_type: workType,
      floor_or_area: floorOrArea,
      material_name: materialName,
      material_quantity: materialQty,
      material_unit: materialUnit,
      description_raw: descRaw,
      description: descRaw,
      category_code: catCode,
      category_name: catName,
      amount_confidence: amountConf,
      description_confidence: descConf,
      overall_confidence: overallConf,
    };

    await supabase.from('rough_entries').update({ ai_extracted: extracted }).eq('id', entry_id);

    return new Response(JSON.stringify({ ok: true, extracted }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err: any) {
    console.error('ai-extract-entry error:', err);
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
