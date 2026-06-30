// MODULE 2 — THE INSTANTIATOR (deterministic, no LLM, no I/O).
//
// Turns the relative, building-agnostic library (M1) into a CONCRETE task graph for one
// building, then derives seq_no by topological sort. This is the fix for the old
// "column-column-slab-slab" ordering: sequence now comes from the real dependency graph, not a
// hand-numbered guess. Same input → same graph, always.
//
// Pipeline: geometry × library → nodes → concrete edges (scope-resolved) → bundles → topo sort.

import {
  type BuildingGeometry, type ConcreteGraph, type ConcreteEdge, type Bundle,
  type GFloor, type GZone, type Library, type NodeId, type TaskNode, type TaskType, type ZoneKind,
  type Scope, type CompletionState,
} from './types'
import { LIBRARY, isHardNature } from './library'

// ── node-id construction (stable, human-debuggable) ──────────────────────────
function buildingNodeId(tid: string): NodeId { return tid }
function perFloorNodeId(tid: string, floorLabel: string): NodeId { return `${tid}@${floorLabel}` }
function perZoneNodeId(tid: string, floorLabel: string, zoneId: string): NodeId { return `${tid}@${floorLabel}#${zoneId}` }

const LAYER_ORDER: Record<string, number> = { structure: 0, services: 1, finishes: 2 }

// ── stack → geometry adapter ─────────────────────────────────────────────────
// The real projects.construction_stack carries levels with zone `use` (parking/habitable) and a
// unit count — it does NOT enumerate wet/dry rooms. The engine reasons in ZoneKinds, so this
// adapter expands each habitable unit into the kinded zones it contains. Defaults are
// deliberately conservative; a future plan-upload can supply an explicit BuildingGeometry and
// skip this adapter entirely.
interface StackZone { use: string; units: number }
interface StackLevel { label: string; kind: string; zones: StackZone[] }
interface ConstructionStack { levels: StackLevel[] }

/** Zone kinds a habitable unit is assumed to contain (one wet, one balcony, the rest dry-ish). */
const HABITABLE_ZONE_KINDS: ZoneKind[] = ['dry', 'wet', 'balcony']

export function stackToGeometry(
  stack: ConstructionStack,
  opts: { hasLift?: boolean; hasCommonAreas?: boolean; hasExternalWorks?: boolean; commonSystems?: string[]; suppressedTasks?: string[] } = {},
): BuildingGeometry {
  const floors: GFloor[] = stack.levels.map((level, index) => {
    const zones: GZone[] = []
    if (level.kind === 'parking') {
      // a parking level is structural + a single 'common' finishing zone (the parking deck)
      zones.push({ id: `${level.label}-parking`, kind: 'common', floorLabel: level.label, unitLabel: null })
    } else {
      for (const z of level.zones.filter((zz) => zz.use !== 'parking')) {
        const units = Math.max(1, z.units)
        for (let u = 0; u < units; u++) {
          const unitLabel = units === 1 ? null : `Unit ${String.fromCharCode(65 + u)}`
          const tag = unitLabel ? unitLabel.replace(/\s+/g, '') : 'unit'
          for (const kind of HABITABLE_ZONE_KINDS)
            zones.push({ id: `${level.label}-${tag}-${kind}`, kind, floorLabel: level.label, unitLabel })
        }
      }
    }
    return { label: level.label, index, zones }
  })
  return {
    floors,
    hasLift: opts.hasLift ?? false,
    hasCommonAreas: opts.hasCommonAreas ?? false,
    hasExternalWorks: opts.hasExternalWorks ?? false,
    commonSystems: new Set(opts.commonSystems ?? []),
    suppressedTasks: new Set(opts.suppressedTasks ?? []),
  }
}

// ── instantiation ────────────────────────────────────────────────────────────
export class CycleError extends Error {
  readonly cycleEdges: ConcreteEdge[]
  constructor(cycleEdges: ConcreteEdge[]) {
    super(`hard cycle in concrete graph (${cycleEdges.length} edge(s)): ` +
      cycleEdges.map((e) => `${e.from} → ${e.to}`).join(', '))
    this.name = 'CycleError'
    this.cycleEdges = cycleEdges
  }
}

function makeNode(t: TaskType, floor: GFloor | null, zone: GZone | null): TaskNode {
  const id = !floor ? buildingNodeId(t.id)
    : !zone ? perFloorNodeId(t.id, floor.label)
      : perZoneNodeId(t.id, floor.label, zone.id)
  return {
    id, taskTypeId: t.id, label: t.label, trade: t.trade, layer: t.layer,
    floorLabel: floor?.label ?? null,
    floorIndex: floor?.index ?? null,
    unitLabel: zone?.unitLabel ?? null,
    zoneId: zone?.id ?? null,
    zoneKind: zone?.kind ?? null,
    seqNo: 0,
    placementSource: 'authored',
    source: 'generated',
  }
}

/** Which building-singleton task-types to instantiate, given the geometry's capability flags. */
function buildingTypeEnabled(t: TaskType, geo: BuildingGeometry): boolean {
  if (t.id.startsWith('ca_')) return geo.commonSystems?.has(t.id) ?? false // opt-in common areas
  if (t.id === 'lift_shaft' || t.id === 'lift_mechanism') return !!geo.hasLift
  if (t.id === 'facade_plaster' || t.id === 'external_structure') return geo.hasExternalWorks ?? true
  if (t.id === 'site_grade' || t.id === 'site_development') return geo.hasExternalWorks ?? true
  return true // foundation / groundwork always
}

/**
 * Instantiate the library against a building's geometry → concrete graph with topo-sorted seq_no.
 * Pure + deterministic. Optionally pass extra task-types (M4 classified user tasks) to weave in.
 */
export function instantiate(
  geometry: BuildingGeometry,
  lib: Library = LIBRARY,
  extraTaskTypes: TaskType[] = [],
): ConcreteGraph {
  const types = new Map(lib.taskTypes)
  for (const x of extraTaskTypes) types.set(x.id, x)

  const nodes = new Map<NodeId, TaskNode>()
  const floorByIndex = new Map<number, GFloor>()
  for (const f of geometry.floors) floorByIndex.set(f.index, f)

  // 1. expand nodes
  for (const t of types.values()) {
    if (geometry.suppressedTasks?.has(t.id)) continue // 'not applicable here' — skip so dependents reflow
    if (t.instancing === 'building') {
      if (buildingTypeEnabled(t, geometry)) {
        const n = makeNode(t, null, null)
        if (extraTaskTypes.some((x) => x.id === t.id)) n.placementSource = 'classified'
        nodes.set(n.id, n)
      }
    } else if (t.instancing === 'per_floor') {
      for (const f of geometry.floors) {
        const n = makeNode(t, f, null)
        if (extraTaskTypes.some((x) => x.id === t.id)) n.placementSource = 'classified'
        nodes.set(n.id, n)
      }
    } else { // per_zone
      for (const f of geometry.floors)
        for (const z of f.zones)
          if (t.appliesTo.includes(z.kind)) {
            const n = makeNode(t, f, z)
            if (extraTaskTypes.some((x) => x.id === t.id)) n.placementSource = 'classified'
            nodes.set(n.id, n)
          }
    }
  }

  // 2. resolve seq edges to concrete edges
  const edges: ConcreteEdge[] = []
  const addEdge = (from: NodeId | null, to: NodeId, nature: ConcreteEdge['nature'], reason: ConcreteEdge['reason'], note: string) => {
    if (from && nodes.has(from) && nodes.has(to) && from !== to) edges.push({ from, to, nature, reason, note })
  }

  for (const follower of nodes.values()) {
    const t = types.get(follower.taskTypeId)!
    for (const e of t.seq) {
      const predIds = resolvePred(e.pred, e.scope, follower, types, floorByIndex, geometry)
      for (const pid of predIds) addEdge(pid, follower.id, e.nature, e.reason, e.note)
    }
  }

  // 3. resolve cohesion bundles
  const bundles: Bundle[] = []
  const seenBundle = new Set<string>()
  for (const node of nodes.values()) {
    const t = types.get(node.taskTypeId)!
    for (const c of t.cohesion ?? []) {
      const partners = resolvePred(c.with, { kind: 'same_zone' }, node, types, floorByIndex, geometry)
      for (const pid of partners) {
        const key = [node.id, pid].sort().join('|')
        if (seenBundle.has(key)) continue
        seenBundle.add(key)
        bundles.push({ members: [node.id, pid], nature: c.nature, reason: c.reason })
      }
    }
  }

  // 4. topo sort over HARD edges → seq_no
  const seqNoByNode = topoSort(nodes, edges)
  for (const [id, seq] of seqNoByNode) nodes.get(id)!.seqNo = seq

  return { nodes, edges, bundles, seqNoByNode }
}

// ── scope resolution ─────────────────────────────────────────────────────────
// Given a follower node and an authored edge's predecessor type + scope, return the concrete
// predecessor node-id(s) that exist in the graph. Endpoints that don't exist are simply absent
// (e.g. slab→columns(+1) on the top floor drops out).
function resolvePred(
  predId: string,
  scope: Scope,
  follower: TaskNode,
  types: Map<string, TaskType>,
  floorByIndex: Map<number, GFloor>,
  geometry: BuildingGeometry,
): NodeId[] {
  const pt = types.get(predId)
  if (!pt) return []

  // A building-singleton predecessor: the one shared node, regardless of scope.
  if (pt.instancing === 'building') return [buildingNodeId(predId)]

  const fIdx = follower.floorIndex
  const predFloorIndex = (scope.kind === 'cross_floor') ? (fIdx ?? 0) + scope.delta : (fIdx ?? 0)

  if (pt.instancing === 'per_floor') {
    if (fIdx === null) return [] // building/external follower vs per-floor pred — not modeled
    const f = floorByIndex.get(predFloorIndex)
    return f ? [perFloorNodeId(predId, f.label)] : []
  }

  // per_zone predecessor
  if (scope.kind === 'same_zone' || (scope.kind === 'cross_floor')) {
    // same locale: same zone-id on the (possibly offset) floor
    if (follower.zoneId) {
      const f = floorByIndex.get(predFloorIndex)
      if (!f) return []
      // when the follower is per_zone, match the SAME zone id only if pred applies there
      const z = f.zones.find((zz) => zz.id === follower.zoneId)
      if (z && pt.appliesTo.includes(z.kind)) return [perZoneNodeId(predId, f.label, z.id)]
      return []
    }
    // follower is per_floor/building but pred is per_zone under same_zone — link to every matching
    // zone on the follower's floor (rare; keeps such edges from silently vanishing).
    const f = floorByIndex.get(predFloorIndex)
    if (!f) return []
    return f.zones.filter((z) => pt.appliesTo.includes(z.kind)).map((z) => perZoneNodeId(predId, f.label, z.id))
  }

  if (scope.kind === 'same_floor') {
    const f = floorByIndex.get(predFloorIndex)
    if (!f) return []
    return f.zones.filter((z) => pt.appliesTo.includes(z.kind)).map((z) => perZoneNodeId(predId, f.label, z.id))
  }

  // building_wide / external per-zone pred — link to all matching zones building-wide (rare)
  const out: NodeId[] = []
  for (const f of geometry.floors)
    for (const z of f.zones)
      if (pt.appliesTo.includes(z.kind)) out.push(perZoneNodeId(predId, f.label, z.id))
  return out
}

// ── topological sort (Kahn) with deterministic tie-break ─────────────────────
// Only HARD edges (IMPOSSIBLE + DESTRUCTIVE + curing_time) constrain the order; prefs inform
// priority later, not the base sequence. Ties within a topo "rank" break by
// (floor asc, layer structure<services<finishes, then stable id) so the default reads naturally.
function topoSort(nodes: Map<NodeId, TaskNode>, edges: ConcreteEdge[]): Map<NodeId, number> {
  const hard = edges.filter((e) => isHardNature(e.nature, e.reason))
  const indeg = new Map<NodeId, number>()
  const adj = new Map<NodeId, NodeId[]>()
  for (const id of nodes.keys()) { indeg.set(id, 0); adj.set(id, []) }
  for (const e of hard) {
    if (!nodes.has(e.from) || !nodes.has(e.to)) continue
    adj.get(e.from)!.push(e.to)
    indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1)
  }

  const cmp = (a: NodeId, b: NodeId): number => {
    const na = nodes.get(a)!, nb = nodes.get(b)!
    const fa = na.floorIndex ?? -1, fb = nb.floorIndex ?? -1
    if (fa !== fb) return fa - fb
    const la = LAYER_ORDER[na.layer] ?? 9, lb = LAYER_ORDER[nb.layer] ?? 9
    if (la !== lb) return la - lb
    return a < b ? -1 : a > b ? 1 : 0
  }

  // ready set kept sorted by cmp (small graphs; simple insertion is fine)
  let ready = [...nodes.keys()].filter((id) => (indeg.get(id) ?? 0) === 0).sort(cmp)
  const order: NodeId[] = []
  while (ready.length) {
    const n = ready.shift()!
    order.push(n)
    const newlyReady: NodeId[] = []
    for (const m of adj.get(n)!) {
      const d = (indeg.get(m) ?? 0) - 1
      indeg.set(m, d)
      if (d === 0) newlyReady.push(m)
    }
    if (newlyReady.length) ready = [...ready, ...newlyReady].sort(cmp)
  }

  if (order.length !== nodes.size) {
    // a cycle remains — collect the offending hard edges among unprocessed nodes
    const placed = new Set(order)
    const stuck = [...nodes.keys()].filter((id) => !placed.has(id))
    const stuckSet = new Set(stuck)
    const cycleEdges = hard.filter((e) => stuckSet.has(e.from) && stuckSet.has(e.to))
    throw new CycleError(cycleEdges)
  }

  const seqNoByNode = new Map<NodeId, number>()
  order.forEach((id, i) => seqNoByNode.set(id, i + 1))
  return seqNoByNode
}

// ── reverse adjacency helper (used by the evaluator) ─────────────────────────
export function buildAdjacency(graph: ConcreteGraph) {
  const preds = new Map<NodeId, ConcreteEdge[]>()  // to → incoming edges
  const succs = new Map<NodeId, ConcreteEdge[]>()  // from → outgoing edges
  for (const id of graph.nodes.keys()) { preds.set(id, []); succs.set(id, []) }
  for (const e of graph.edges) {
    preds.get(e.to)?.push(e)
    succs.get(e.from)?.push(e)
  }
  return { preds, succs }
}

/** Convenience: empty completion state (everything not_started). */
export function emptyState(): CompletionState { return new Map() }
