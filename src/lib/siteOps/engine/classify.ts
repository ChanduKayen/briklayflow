// MODULE 4 — THE CLASSIFIER (user-created tasks). GROUNDED + BOUNDED.
//
// When a user adds a free-text task ("false ceiling in living room", "Italian marble cladding in
// lobby"), the engine must place it into the graph with the SAME six dimensions we authored for
// known trades — WITHOUT letting the LLM invent freeform physics. The discipline:
//
//   The library is a CLOSED CONTRACT for known trades. The classifier is the OPEN DOOR for user
//   tasks — but it admits them by SNAPPING them to library anchors, never by authoring new edges.
//   The LLM's job is RECOGNITION and MAPPING; the physics stays in the authored library.
//
// Every LLM-proposed edge must reference an EXISTING TaskTypeId + an enum nature/reason/scope, or
// it is dropped. The output is then VALIDATED against the real graph (acyclicity), severity-capped
// on low confidence, and — if it can't be anchored confidently — attached LOOSELY with a visible
// needs_review flag. Unknown → loose + flag, NEVER unknown → silently free, NEVER unknown →
// confidently hard. That bound is what keeps the engine trustworthy; see the tests, especially
// "malicious output rejected".

import {
  type FreedomSetId, type Layer, type Library, type Nature, type Reason, type Scope,
  type TaskStatus, type TaskType, type TaskTypeId, type ZoneKind,
} from './types'
import { LIBRARY, isHardNature } from './library'

// ── enum guards (the bounded vocabulary) ─────────────────────────────────────
const NATURES = new Set<Nature>(['IMPOSSIBLE', 'DESTRUCTIVE', 'STRONG_PREF', 'WEAK_PREF', 'INDIFFERENT'])
const REASONS = new Set<Reason>(['structural', 'concealment', 'curing_time', 'logistics', 'quality', 'policy'])
const LAYERS = new Set<Layer>(['structure', 'services', 'finishes'])
const ZONE_KINDS = new Set<ZoneKind>(['dry', 'wet', 'balcony', 'common', 'external', 'shaft'])
const SCOPE_KINDS = new Set(['same_zone', 'same_floor', 'cross_floor', 'building_wide', 'external'])

// SAFE DEFAULT (load-bearing): an unmatched/unknown constraint degrades to a WARNING (STRONG_PREF),
// never a silent "free" and never a confident hard block.
const SAFE_NATURE: Nature = 'STRONG_PREF'
const SAFE_REASON: Reason = 'logistics'
const SAFE_SCOPE: Scope = { kind: 'same_zone' }

// ── interfaces ───────────────────────────────────────────────────────────────
export interface ClassifyContext {
  taskText: string
  floorLabel: string
  zoneId?: string
  zoneKind: ZoneKind
  /** what already exists in that zone + status — deterministic grounding, no LLM. */
  localTasks?: { taskTypeId: TaskTypeId; status: TaskStatus }[]
}

/** The raw, UNTRUSTED shape we ask the LLM to return (structured JSON only). */
export interface ClassifierLLMOutput {
  layer: string
  trade: string
  appliesTo: string[]
  placement: { pred: string; nature: string; reason: string; scope: Scope | { kind: string; delta?: number } }[]
  conceals?: string[]
  concealedBy?: string[]
  hosts?: string[]
  hostedBy?: string[]
  freedomSet?: string | null   // existing set id | null | 'NEW_FREE'
  confidence: number
  rationale: string
}

export type ClassifierLLM = (prompt: string, ctx: ClassifyContext) => Promise<ClassifierLLMOutput>

export interface DroppedEdge { pred: string; why: string }

export interface ClassifiedTask {
  taskType: TaskType                 // synthetic, id `user_<slug>`, placement_source 'classified'
  needsReview: boolean
  confidence: number
  rationale: string                  // stored for tuning, hidden from users
  demoted: boolean                   // severity ceiling fired
  droppedEdges: DroppedEdge[]        // edges rejected by the validator (transparency)
  looselyAttached: boolean           // honesty valve fired
}

// ── prompt builder (vocabulary + enums + grounding) ──────────────────────────
// Supplies the LLM the bounded vocabulary it must map onto. Kept deterministic so the same
// context yields the same prompt (useful for caching + replay).
export function buildClassifierPrompt(ctx: ClassifyContext, lib: Library = LIBRARY): string {
  const vocab = [...lib.taskTypes.values()].map((t) =>
    `  ${t.id} — ${t.label} [${t.layer}]` +
    (t.conceals?.length ? ` conceals:${t.conceals.join(',')}` : '') +
    (t.hosts?.length ? ` hosts:${t.hosts.join(',')}` : ''),
  ).join('\n')
  const sets = [...lib.freedomSets.values()].map((f) => `  ${f.id} — ${f.label} (${f.note})`).join('\n')
  const local = (ctx.localTasks ?? []).map((t) => `  ${t.taskTypeId}:${t.status}`).join('\n') || '  (none)'

  return [
    'You map a user-added construction task onto an EXISTING constraint library. You DO NOT invent',
    'new physics. Every placement edge MUST reference an existing TaskTypeId below (or "UNKNOWN").',
    'Return STRICT JSON matching ClassifierLLMOutput. Choose anchors, not freeform rules.',
    '',
    `TASK: ${JSON.stringify(ctx.taskText)}`,
    `LOCATION: floor=${ctx.floorLabel} zoneKind=${ctx.zoneKind}`,
    'ALREADY IN THIS ZONE:', local,
    '',
    'LAYER ∈ {structure, services, finishes}',
    'NATURE ∈ {IMPOSSIBLE, DESTRUCTIVE, STRONG_PREF, WEAK_PREF, INDIFFERENT} (only IMPOSSIBLE truly forbids)',
    'REASON ∈ {structural, concealment, curing_time, logistics, quality, policy}',
    'SCOPE.kind ∈ {same_zone, same_floor, cross_floor(+delta), building_wide, external}',
    'ZONE_KIND ∈ {dry, wet, balcony, common, external, shaft}',
    '',
    'TASK-TYPE VOCABULARY (anchor only to these ids):', vocab,
    '',
    'FREEDOM SETS (freedomSet must be one of these ids, null, or "NEW_FREE"):', sets,
    '',
    'Provide: layer, trade, appliesTo[], placement[{pred,nature,reason,scope}], conceals[],',
    'concealedBy[], hosts[], hostedBy[], freedomSet, confidence(0..1), rationale.',
  ].join('\n')
}

// ── slug / id ────────────────────────────────────────────────────────────────
export function slugifyTaskId(text: string): TaskTypeId {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48)
  return `user_${slug || 'task'}`
}

// ── the honesty valve ────────────────────────────────────────────────────────
// When the task can't be confidently anchored, attach it LOOSELY: bound only by the layer's
// natural gateway as a STRONG_PREF, and flag needs_review. Never a hard constraint, never silently
// free. Mirrors the extraction "other" valve.
function gatewayAnchor(layer: Layer): { pred: TaskTypeId; nature: Nature; reason: Reason; scope: Scope; note: string } {
  if (layer === 'structure')
    return { pred: 'floor_pour', nature: SAFE_NATURE, reason: 'structural', scope: { kind: 'same_floor' }, note: 'loose: after the floor structure (needs review)' }
  // services + finishes fan out after blockwork (the gateway)
  return { pred: 'blockwork', nature: SAFE_NATURE, reason: 'logistics', scope: { kind: 'same_zone' }, note: 'loose: after blockwork gateway (needs review)' }
}

// ── deterministic validator (the hard gate) ──────────────────────────────────
export function validateClassification(
  raw: ClassifierLLMOutput,
  ctx: ClassifyContext,
  lib: Library = LIBRARY,
  confidenceThreshold = 0.55,
): ClassifiedTask {
  const ids = lib.taskTypes
  const dropped: DroppedEdge[] = []
  let needsReview = false
  let demoted = false

  const confidence = clamp01(typeof raw.confidence === 'number' ? raw.confidence : 0)
  const lowConfidence = confidence < confidenceThreshold

  // layer (coerce to enum; default services if unclear)
  const layer: Layer = LAYERS.has(raw.layer as Layer) ? (raw.layer as Layer) : 'services'
  if (!LAYERS.has(raw.layer as Layer)) needsReview = true

  // appliesTo (filter to valid zone kinds; default to the zone the user added it to)
  const appliesTo = (raw.appliesTo ?? []).filter((z): z is ZoneKind => ZONE_KINDS.has(z as ZoneKind))
  if (appliesTo.length === 0) appliesTo.push(ctx.zoneKind)

  // semantic ref lists — keep only references to known ids
  const cleanRefs = (xs?: string[]): TaskTypeId[] => (xs ?? []).filter((x) => ids.has(x))
  const conceals = cleanRefs(raw.conceals)
  const concealedBy = cleanRefs(raw.concealedBy)
  const hosts = cleanRefs(raw.hosts)
  const hostedBy = cleanRefs(raw.hostedBy)

  // placement edges → sanitized seq edges (drop unknown preds; coerce enums; severity ceiling)
  const seq: TaskType['seq'] = []
  for (const p of raw.placement ?? []) {
    if (p.pred === 'UNKNOWN') { needsReview = true; dropped.push({ pred: 'UNKNOWN', why: 'LLM could not anchor' }); continue }
    if (!ids.has(p.pred)) { dropped.push({ pred: p.pred, why: 'not a known TaskTypeId' }); continue }

    let nature: Nature = NATURES.has(p.nature as Nature) ? (p.nature as Nature) : SAFE_NATURE
    if (!NATURES.has(p.nature as Nature)) needsReview = true
    const reason: Reason = REASONS.has(p.reason as Reason) ? (p.reason as Reason) : SAFE_REASON
    const scope = sanitizeScope(p.scope)

    // SEVERITY CEILING: a low-confidence guess may not hard-block real work. Demote IMPOSSIBLE /
    // DESTRUCTIVE → STRONG_PREF (loose capture + visible correction beats strict gating + error).
    if (lowConfidence && (nature === 'IMPOSSIBLE' || nature === 'DESTRUCTIVE')) {
      nature = SAFE_NATURE; demoted = true
    }
    seq.push({ pred: p.pred, nature, reason, scope, note: `classified: ${truncate(raw.rationale, 80)}` })
  }

  const id = slugifyTaskId(ctx.taskText)
  const freedomSet = resolveFreedomSet(raw.freedomSet, lib)

  let candidate: TaskType = {
    id, label: ctx.taskText.trim(), trade: String(raw.trade || 'other').slice(0, 40),
    layer, instancing: 'per_zone', appliesTo: dedupe(appliesTo),
    seq, conceals, concealedBy, hosts, hostedBy,
    freedomSet: freedomSet ?? undefined,
  }

  // ACYCLICITY GATE: tentatively insert the candidate (incoming placement edges + outgoing host
  // edges) into the abstract hard-edge graph. A cycle = the LLM tried to make the new task a
  // predecessor of something it actually follows. Reject ALL its edges and fall back to loose.
  let looselyAttached = false
  if (introducesCycle(lib, candidate)) {
    dropped.push(...candidate.seq.map((e) => ({ pred: e.pred, why: 'rejected: would create a cycle' })))
    candidate = { ...candidate, seq: [], hosts: [] } // strip the offending edges
    needsReview = true
  }

  // HONESTY VALVE: no surviving anchor, or low confidence → loose attach to the layer gateway.
  if (candidate.seq.length === 0 || lowConfidence) {
    if (candidate.seq.length === 0) {
      candidate = { ...candidate, seq: [gatewayAnchor(candidate.layer)] }
      looselyAttached = true
    }
    needsReview = true
  }

  return { taskType: candidate, needsReview, confidence, rationale: String(raw.rationale ?? ''), demoted, droppedEdges: dropped, looselyAttached }
}

// ── the async entry point (mock the LLM in tests; wire the real model later) ──
export async function classifyUserTask(
  ctx: ClassifyContext,
  llm: ClassifierLLM,
  opts: { lib?: Library; confidenceThreshold?: number } = {},
): Promise<ClassifiedTask> {
  const lib = opts.lib ?? LIBRARY
  const prompt = buildClassifierPrompt(ctx, lib)
  const raw = await llm(prompt, ctx)
  return validateClassification(raw, ctx, lib, opts.confidenceThreshold ?? 0.55)
}

// ── helpers ──────────────────────────────────────────────────────────────────
function clamp01(n: number): number { return n < 0 ? 0 : n > 1 ? 1 : n }
function dedupe<T>(xs: T[]): T[] { return [...new Set(xs)] }
function truncate(s: string, n: number): string { return (s ?? '').length > n ? s.slice(0, n) + '…' : (s ?? '') }

function sanitizeScope(s: ClassifierLLMOutput['placement'][number]['scope']): Scope {
  if (!s || typeof s !== 'object' || !SCOPE_KINDS.has((s as { kind: string }).kind)) return SAFE_SCOPE
  const k = (s as { kind: string }).kind
  if (k === 'cross_floor') {
    const delta = Number((s as { delta?: number }).delta)
    return { kind: 'cross_floor', delta: Number.isFinite(delta) ? delta : 0 }
  }
  return { kind: k } as Scope
}

function resolveFreedomSet(v: string | null | undefined, lib: Library): FreedomSetId | null {
  if (!v || v === 'NEW_FREE') return null // NEW_FREE = freely interchangeable but not a named set
  return lib.freedomSets.has(v) ? v : null
}

// Abstract (type-level, same-instance) hard-edge cycle detection with the candidate woven in.
// A type-level cycle ⟺ a concrete same-instance cycle for per-zone tasks, so this is a faithful,
// deterministic proxy for "tentatively insert into the concrete graph and topo-sort".
function introducesCycle(lib: Library, candidate: TaskType): boolean {
  const adj = new Map<TaskTypeId, TaskTypeId[]>()
  const push = (from: TaskTypeId, to: TaskTypeId) => {
    if (!adj.has(from)) adj.set(from, [])
    adj.get(from)!.push(to)
  }
  // existing library hard edges (exclude cross-floor delta≠0 — those link different instances)
  for (const t of lib.taskTypes.values())
    for (const e of t.seq) {
      const crossFloor = e.scope.kind === 'cross_floor' && e.scope.delta !== 0
      if (isHardNature(e.nature, e.reason) && !crossFloor) push(e.pred, t.id)
    }
  // candidate incoming hard preds: pred → candidate
  for (const e of candidate.seq) {
    const crossFloor = e.scope.kind === 'cross_floor' && e.scope.delta !== 0
    if (isHardNature(e.nature, e.reason) && !crossFloor) push(e.pred, candidate.id)
  }
  // candidate OUTGOING host edges: candidate → hosted (the only way a user task becomes a
  // predecessor of an existing trade — and the only way it can close a cycle).
  for (const h of candidate.hosts ?? []) push(candidate.id, h)

  // DFS cycle detection over the combined graph
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<TaskTypeId, number>()
  const allNodes = new Set<TaskTypeId>([...lib.taskTypes.keys(), candidate.id])
  let cyclic = false
  const visit = (n: TaskTypeId): void => {
    if (cyclic) return
    color.set(n, GRAY)
    for (const m of adj.get(n) ?? []) {
      const c = color.get(m) ?? WHITE
      if (c === GRAY) { cyclic = true; return }
      if (c === WHITE) visit(m)
    }
    color.set(n, BLACK)
  }
  for (const n of allNodes) if ((color.get(n) ?? WHITE) === WHITE) visit(n)
  return cyclic
}
