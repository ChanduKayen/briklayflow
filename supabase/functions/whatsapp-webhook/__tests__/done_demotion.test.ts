// SPRINT 1 · T2 — DEMOTE DONE_RE: NO TERMINAL TASK STATUS WITHOUT THE LADDER (Hazard 3 / clause-4).
//
// THE HAZARD: statusFromProgress's DONE_RE (_siteops_route.ts) wrote site_tasks.status='done' straight from
// the word "done" — no confidence, no closure_explicit, no undo. The SAME sentence differed by MODALITY:
// text "slab done" → the ladder; a photo-captioned "slab done" → the regex → a silent, un-undoable terminal
// close (the "Flooring — marked done" incident). And even on the ladder's OWN task-update path, applyProgress
// let DONE_RE re-derive 'done' from the reason text, OVERRIDING the ladder's `applied` verdict.
//
// THE FIX (surgical — T5 later removes the whole image engine): a `closureAuthorized` boolean on
// statusFromProgress/applyProgress, threaded through applyTaskProgressById. DONE_RE without authorization →
// 'active' (progress captured, task advances), NEVER terminal 'done'. The ONLY caller that authorizes is
// applyTaskUpdate, and ONLY when the ladder ruled `t.applied === 'resolve'`. One boolean; the image path is
// untouched; terminal task closure is the ladder's alone.
//
// RED-FIRST: j1 (image/fresh "done" → 'done' today) and j5 (ladder ADDRESSING whose reason says "completed"
// → 'done' today — the executor-T1 override bug) land RED and flip GREEN. j2/j3/j4 are the guards.

import { suite, test, expect } from './harness'
import { fakeSupabase, type Seed } from './fake_supabase'
import { applyProgress, type RouteCtx } from '../_siteops_route.ts'
import { applyTerminals, type ExecCtx } from '../_agents/siteops.ts'
import type { Terminal } from '../_siteops_resolution.ts'
import type { BatchItem } from '../_siteops_batch.ts'

const ORG = 'org-1'
const SENDER = '919900000000'

// ── applyProgress harness (j1/j4) — the FRESH path (routeItems), no ladder verdict. vmNodeKeys absent →
//    the guardrail proceeds unguarded (stack-less project), so the write actually lands and we can read the
//    status it chose. This is the exact call routeItems makes for a photo-captioned progress item. ──
const mkRc = (fake: ReturnType<typeof fakeSupabase>): RouteCtx => ({
  supabase: fake, orgId: ORG, projectId: 'P1', byLabel: SENDER,
  members: [], supervisorId: null, principalId: null, narrationId: 'narr-1', now: new Date('2026-07-07T00:00:00Z'),
  vmNodeKeys: undefined, vmTaskNames: undefined,
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const task = (over: Record<string, unknown> = {}): any => ({
  task_id: 'tk-slab', name: 'Slab Pour', status: 'not_started', floor_label: 'Ground', unit_label: null,
  node_key: null, task_type_id: null, ...over,
})
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const progressItem = (text: string): any => ({
  type: 'progress', text, task_hint: null, qc_statements: [],
  cause: null, cause_reason: null, owner_hint: null, date_hint: null, project_hint: null,
})
const siteTaskStatus = (fake: ReturnType<typeof fakeSupabase>): (string | undefined)[] =>
  fake.writesTo('site_tasks').filter((w) => w.op === 'update').map((w) => w.payload?.status)

// ── applyTerminals harness (j2/j3/j5) — the LADDER path. A HIGH task object_updated reaches applyTaskUpdate;
//    the ladder's `applied` is the sole closure authority. ──
const ctxFor = (fake: ReturnType<typeof fakeSupabase>) => ({ supabase: fake, from: SENDER, orgId: ORG, wamid: 'w-1', lang: 'te' as const })
const execCtx = (): ExecCtx => ({ itemsById: new Map<string, BatchItem>(), labelById: new Map(), cadenceMap: new Map(), actorId: null, now: new Date('2026-07-07T00:00:00Z'), narrationId: 'narr-1', projectId: 'P1' })
const taskSeed = (): Seed => ({
  projects: [{ project_id: 'P1', name: 'ASM Elite' }],
  site_tasks: { 'tk-slab': { task_id: 'tk-slab', name: 'Slab Pour', project_id: 'P1', status: 'not_started', floor_label: 'Ground', unit_label: null, node_key: null, task_type_id: null, owner_id: null, owner_source: null, phase: null, trade: null } },
})
const tTask = (applied: 'resolve' | 'addressing', action: 'progress' | 'resolve', closure_explicit: boolean, reason: string): Terminal => ({
  kind: 'object_updated',
  update: { target_id: 'tk-slab', target_kind: 'task', action, confidence: 'high', closure_explicit, reason },
  applied, undo: false, readback: '', reason: '',
} as Terminal)

suite('siteops T2 — DONE_RE demoted: terminal task status needs the ladder (Hazard 3 / clause-4)', () => {
  // j1 (RED) — the image/fresh path: a captioned "slab done" reaches applyProgress with NO ladder authority.
  // It must be CAPTURED as progress ('active'), never terminally closed from the word. RED today: DONE_RE
  // writes 'done' straight from the caption.
  test('(j1) fresh/image "slab done" → status ADVANCES to active, NEVER terminal done', async () => {
    const fake = fakeSupabase({})
    const res = await applyProgress(mkRc(fake), task(), progressItem('slab done'))

    expect(res.statusTo).toBe('active')
    expect(siteTaskStatus(fake).includes('done')).toBe(false)
    expect(siteTaskStatus(fake).includes('active')).toBe(true)
  })

  // j5 (RED — the bonus, most valuable) — the LADDER's OWN path, mis-overridden. The ladder ruled
  // applied:'addressing' (HIGH referent, action:progress), but the reason text carries "completed" — today
  // DONE_RE fires inside applyProgress and writes terminal 'done', SILENTLY OVERRIDING the ladder. This is
  // the live text-path override (executor-T1). Post-fix: closureAuthorized = (applied==='resolve') = false →
  // 'active'.
  test('(j5) ladder ADDRESSING + reason "…completed" → active, the regex NO LONGER overrides the ladder', async () => {
    const fake = fakeSupabase(taskSeed())
    await applyTerminals(ctxFor(fake), [tTask('addressing', 'progress', false, 'stilt columns / slab pour completed')], execCtx())

    expect(siteTaskStatus(fake).includes('done')).toBe(false)   // RED today (writes 'done')
    expect(siteTaskStatus(fake).includes('active')).toBe(true)
  })

  // j2 (guard) — a genuine ladder RESOLVE (action:resolve + closure_explicit:true → applied:'resolve') still
  // closes the task. Paired with j5: SAME "…done/…completed" done-word in the reason; the ONLY difference is
  // the ladder's verdict. That the two diverge is the tell — the LADDER decides, not the regex.
  test('(j2) ladder RESOLVE (closure_explicit true) → terminal done lands (the legit close is not suppressed)', async () => {
    const fake = fakeSupabase(taskSeed())
    await applyTerminals(ctxFor(fake), [tTask('resolve', 'resolve', true, 'slab done')], execCtx())

    expect(siteTaskStatus(fake).includes('done')).toBe(true)
  })

  // j3 (guard) — the text path's close is byte-identical: a "slab done" the ladder RESOLVES writes terminal
  // 'done' before AND after (both DONE_RE and closureAuthorized agree on this input). The demotion doesn't
  // touch the legitimate text close. (Same seam the text path hits: runSingularUnit → applyTerminals →
  // applyTaskUpdate.)
  test('(j3) text-path RESOLVE of "slab done" → still terminal done (demotion leaves the legit close untouched)', async () => {
    const fake = fakeSupabase(taskSeed())
    await applyTerminals(ctxFor(fake), [tTask('resolve', 'resolve', true, 'slab done')], execCtx())

    expect(siteTaskStatus(fake).some((s) => s === 'done')).toBe(true)
    expect(siteTaskStatus(fake).includes('not_started')).toBe(false)
  })

  // j4 (guard) — a non-closure progress note is untouched by the demoted branch: it never matched DONE_RE, so
  // it advances not_started → active exactly as before, and never lands 'done'.
  test('(j4) non-closure "slab pour going well" → progress (active), not caught by the demoted path', async () => {
    const fake = fakeSupabase({})
    const res = await applyProgress(mkRc(fake), task(), progressItem('slab pour going well'))

    expect(res.statusTo).toBe('active')
    expect(siteTaskStatus(fake).includes('done')).toBe(false)
  })
})
