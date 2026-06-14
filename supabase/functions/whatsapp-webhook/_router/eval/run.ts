// Router eval harness. Calls routeMessage() directly and reports accuracy +
// a confusion matrix over decision classes. Target >= 90%.
//
//   OPENAI_API_KEY=sk-... deno run --allow-env --allow-net \
//     supabase/functions/whatsapp-webhook/_router/eval/run.ts
//
// (Deterministic cases pass without a key; LLM cases need OPENAI_API_KEY or
//  ANTHROPIC_API_KEY for full accuracy.)

import { routeMessage } from '../../_router.ts'

type Case = {
  id: string
  text: string
  pending?: { agent: string; question: string; slots?: Record<string, unknown> } | null
  lingering?: { last_action_summary: string } | null
  expect: { decision: string; intent_agent?: string | null }
}

const DECISIONS = ['ANSWERS_PENDING', 'NEW_INTENT', 'CHITCHAT', 'AMBIGUOUS']

const here = new URL('./cases.jsonl', import.meta.url)
const lines = (await Deno.readTextFile(here)).split('\n').map((l) => l.trim()).filter(Boolean)
const cases: Case[] = lines.map((l) => JSON.parse(l))

let pass = 0
const fails: string[] = []
const perClass: Record<string, { total: number; ok: number }> = {}
// confusion[expected][actual] = count
const confusion: Record<string, Record<string, number>> = {}
for (const d of DECISIONS) { confusion[d] = {}; for (const a of DECISIONS) confusion[d][a] = 0 }

for (const c of cases) {
  const res = await routeMessage({ text: c.text, pending: c.pending ?? null, lingering: c.lingering ?? null })
  const expDec = c.expect.decision
  const decOk = res.decision === expDec
  const agentOk = c.expect.intent_agent === undefined || (res.intent_agent ?? null) === (c.expect.intent_agent ?? null)
  const ok = decOk && agentOk

  perClass[expDec] ??= { total: 0, ok: 0 }
  perClass[expDec].total++
  if (ok) perClass[expDec].ok++
  if (confusion[expDec] && confusion[expDec][res.decision] !== undefined) confusion[expDec][res.decision]++

  if (ok) pass++
  else fails.push(`  ✗ ${c.id}: "${c.text}" -> ${res.decision}/${res.intent_agent} (expected ${expDec}/${c.expect.intent_agent ?? '*'}) [conf ${res.confidence}]`)
}

const acc = (pass / cases.length) * 100
console.log(`\nRouter eval: ${pass}/${cases.length} = ${acc.toFixed(1)}%  (target >= 90%)\n`)

console.log('Per decision class:')
for (const [k, v] of Object.entries(perClass)) {
  console.log(`  ${k.padEnd(16)} ${v.ok}/${v.total} (${((v.ok / v.total) * 100).toFixed(0)}%)`)
}

console.log('\nConfusion matrix (rows = expected, cols = actual):')
console.log('  ' + 'expected\\actual'.padEnd(18) + DECISIONS.map((d) => d.slice(0, 8).padStart(9)).join(''))
for (const exp of DECISIONS) {
  console.log('  ' + exp.padEnd(18) + DECISIONS.map((a) => String(confusion[exp][a]).padStart(9)).join(''))
}

if (fails.length) {
  console.log('\nFailures:')
  for (const f of fails) console.log(f)
}

console.log('')
Deno.exit(acc >= 90 ? 0 : 1)
