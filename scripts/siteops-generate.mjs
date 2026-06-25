// Site-ops task generator / confirmation harness (admin CLI, service-role).
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/siteops-generate.mjs <project_id> [--parking=none|stilt|cellar] \
//       [--habitable=N] [--units=N] [--common] [--replace] [--skip-config]
//
// Default run: builds the stack from the flags, stores it on the project (construction_stack
// + capture cols), generates site_tasks, prints a verification summary. Re-run with --replace
// to confirm manual-row preservation. --skip-config generates from the already-stored stack.
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { buildSync } from 'esbuild';
import { createClient } from '@supabase/supabase-js';

const URL = process.env.SUPABASE_URL;
const KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_KEY;
if (!URL || !KEY) { console.error('Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.'); process.exit(1); }

const args = process.argv.slice(2);
const projectId = args.find((a) => !a.startsWith('--'));
if (!projectId) { console.error('Usage: node scripts/siteops-generate.mjs <project_id> [flags]'); process.exit(1); }
const flag = (name) => args.includes(`--${name}`);
const opt = (name, d) => { const a = args.find((x) => x.startsWith(`--${name}=`)); return a ? a.split('=')[1] : d; };

const capture = {
  dedicated_parking: opt('parking', 'none'),
  habitable_floors: Number(opt('habitable', '1')),
  units_per_floor: Number(opt('units', '1')),
  has_common_areas: flag('common'),
};

// bundle the TS modules (expander + write path) to importable ESM via esbuild
function load(entry, names) {
  const out = buildSync({ entryPoints: [entry], bundle: true, format: 'esm', write: false, platform: 'neutral' }).outputFiles[0].text;
  const tmp = `scripts/_b_${names}.tmp.mjs`;
  writeFileSync(tmp, out);
  return { url: pathToFileURL(tmp).href, tmp };
}
const a = load('src/lib/siteOps/expander.ts', 'exp');
const b = load('src/lib/siteOps/generateTasks.ts', 'gen');
const { buildStack } = await import(a.url);
const { generateSiteTasks } = await import(b.url);
unlinkSync(a.tmp); unlinkSync(b.tmp);

const sequence = JSON.parse(readFileSync('docs/site-ops/sequence.json', 'utf8'));
const sb = createClient(URL, KEY);

try {
  if (!flag('skip-config')) {
    const stack = buildStack(capture);
    console.log('stack:', stack.levels.map((l) => `${l.label}(${l.kind})`).join(' → '));
    const { error } = await sb.from('projects').update({
      dedicated_parking: capture.dedicated_parking,
      habitable_floors: capture.habitable_floors,
      units_per_floor: capture.units_per_floor,
      has_common_areas: capture.has_common_areas,
      sequence_model: 'rcc_residential',
      construction_stack: stack,
    }).eq('project_id', projectId);
    if (error) throw new Error(`configure project: ${error.message}`);
    console.log('configured project', projectId);
  }

  const res = await generateSiteTasks(sb, projectId, sequence, { replace: flag('replace') });
  console.log(`\nRESULT → inserted ${res.inserted}  deleted ${res.deleted}  keptManual ${res.keptManual}`);

  // verify what landed
  const { data: rows, error } = await sb.from('site_tasks')
    .select('task_no, phase, floor_label, unit_label, trade, seq_no, source, project_id, org_id')
    .eq('project_id', projectId).order('seq_no');
  if (error) throw new Error(`verify read: ${error.message}`);
  const gen = rows.filter((r) => r.source === 'generated');
  const man = rows.filter((r) => r.source === 'manual');
  const byPhase = {};
  for (const r of gen) byPhase[r.phase] = (byPhase[r.phase] || 0) + 1;
  console.log(`\nlanded: ${rows.length} total  (generated ${gen.length}, manual ${man.length})`);
  console.log('per phase:', Object.entries(byPhase).map(([k, v]) => `${k}:${v}`).join('  '));
  console.log('sample:', gen.slice(0, 3).map((r) => `${r.task_no}[${r.org_id ? 'org✓' : 'org✗'} ${r.project_id}] ${r.phase}/${r.floor_label ?? '—'}/${r.trade}`).join('\n        '));
  if (man.length) console.log('MANUAL preserved:', man.map((r) => r.task_no).join(', '));
} catch (e) {
  console.error('\nFAILED:', e.message);
  process.exit(1);
}
