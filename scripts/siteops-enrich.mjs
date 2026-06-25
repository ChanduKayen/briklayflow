// Site-ops Pass-2 enrichment runner (admin CLI, service-role + real LLM).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ANTHROPIC_API_KEY=... \
//     node scripts/siteops-enrich.mjs <project_id>
//
// One LLM call per phase enriches the distinct (phase, trade) pairs; results fan onto every
// task instance (description + 3 QC rows, one critical). Re-runnable (replace discipline).
// Mirrors _extract.ts: Anthropic preferred, OpenAI fallback, temp 0, strict JSON.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
const ANTHROPIC = process.env.ANTHROPIC_API_KEY;
const OPENAI = process.env.OPENAI_API_KEY;
const projectId = process.argv[2];
if (!URL || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.'); process.exit(1); }
if (!ANTHROPIC && !OPENAI) { console.error('Set ANTHROPIC_API_KEY or OPENAI_API_KEY.'); process.exit(1); }
if (!projectId) { console.error('Usage: node scripts/siteops-enrich.mjs <project_id>'); process.exit(1); }

const out = buildSync({ entryPoints: ['src/lib/siteOps/enrich.ts'], bundle: true, format: 'esm', write: false, platform: 'neutral' }).outputFiles[0].text;
const tmp = 'scripts/_enrich.tmp.mjs'; writeFileSync(tmp, out);
const { enrichProject } = await import(pathToFileURL(tmp).href);
unlinkSync(tmp);

const sequence = JSON.parse(readFileSync('docs/site-ops/sequence.json', 'utf8'));
const sb = createClient(URL, KEY);

const ENRICH_MODEL_ANTHROPIC = process.env.SITEOPS_ENRICH_MODEL ?? 'claude-sonnet-4-20250514';
const ENRICH_MODEL_OPENAI = process.env.SITEOPS_ENRICH_MODEL_OPENAI ?? 'gpt-4.1';

const llm = async (system, user) => {
  if (ANTHROPIC) {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': ANTHROPIC, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: ENRICH_MODEL_ANTHROPIC, max_tokens: 3000, temperature: 0, system, messages: [{ role: 'user', content: user }] }),
    });
    const d = await r.json();
    return d.content?.[0]?.text ?? '';
  }
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${OPENAI}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ENRICH_MODEL_OPENAI, max_tokens: 3000, temperature: 0, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
  });
  const d = await r.json();
  return d.choices?.[0]?.message?.content ?? '';
};

try {
  const res = await enrichProject(sb, llm, projectId, sequence);
  console.log('RESULT →', JSON.stringify(res));

  // verify
  const { data: tasks } = await sb.from('site_tasks').select('task_id, phase, trade, description, source').eq('project_id', projectId).eq('source', 'generated');
  const ids = tasks.map((t) => t.task_id);
  const { data: qc } = await sb.from('site_task_qc').select('task_id, is_critical').in('task_id', ids);
  const byTask = {};
  for (const r of qc) (byTask[r.task_id] ||= []).push(r);
  const noDesc = tasks.filter((t) => !t.description).length;
  const bad3 = tasks.filter((t) => (byTask[t.task_id] || []).length !== 3).length;
  const bad1c = tasks.filter((t) => (byTask[t.task_id] || []).filter((r) => r.is_critical).length !== 1).length;
  console.log(`tasks: ${tasks.length}  | missing description: ${noDesc}  | not-exactly-3-QC: ${bad3}  | not-exactly-1-critical: ${bad1c}`);

  // print a sample (slab_pour / plastering / terrace_waterproofing if present)
  for (const key of ['slab_pour', 'plastering', 'terrace_waterproofing']) {
    const t = tasks.find((x) => x.trade === key);
    if (!t) continue;
    const rows = (await sb.from('site_task_qc').select('question, is_critical, seq').eq('task_id', t.task_id).order('seq')).data ?? [];
    console.log(`\n● ${key}\n  ${t.description}`);
    for (const r of rows) console.log(`  ${r.is_critical ? 'CRITICAL ▶' : 'qc       ·'} ${r.question}`);
  }
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exit(1);
}
