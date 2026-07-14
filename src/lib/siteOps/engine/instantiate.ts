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
  type Scope, type CompletionState, type FloorKind,
} from './types'
import { LIBRARY, isHardNature } from './library'
import { nodeKey, nodeKeyOf, unitKeyOf, zoneIdOf } from './identity'

// ── node-id construction ─────────────────────────────────────────────────────
// A node id IS the persisted node_key IS the VM's fold key. One identity, three readers — and now ONE
// function (identity.ts), because for a while it was one identity written out four times and kept in step
// by a comment. See identity.ts for what that cost.

/** Which LEVEL KINDS a per_floor type occupies. Default: the occupied building — never the roof. */
function floorsOf(t: TaskType): FloorKind[] { return t.floors ?? ['parking', 'habitable'] }

/** Does a per_zone task type occur anywhere inside this zone? (kinds intersect appliesTo) */
function zoneApplies(t: TaskType, z: GZone): boolean { return z.kinds.some((k) => t.appliesTo.includes(k)) }

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

/** The room-kinds a habitable unit is assumed to contain. They live INSIDE one zone; they are not zones. */
const HABITABLE_ZONE_KINDS: ZoneKind[] = ['dry', 'wet', 'balcony']

export function stackToGeometry(
  stack: ConstructionStack,
  opts: {
    hasCommonAreas?: boolean
    /** DEFAULTS TRUE — every building has an outside. See BuildingGeometry.hasExternalWorks. */
    hasExternalWorks?: boolean
    commonSystems?: string[]
    /** system id → floor label for its `sited` plant (projects.amenity_levels). */
    sitedLevels?: Record<string, string>
    suppressedTasks?: string[]
    /** node_keys a human deleted from the plan (projects.suppressed_nodes). */
    suppressedNodes?: string[]
  } = {},
): BuildingGeometry {
  const floors: GFloor[] = stack.levels.map((level, index) => {
    const zones: GZone[] = []
    if (level.kind === 'parking') {
      // a parking level is structural + a single 'common' finishing zone (the parking deck)
      zones.push({ id: zoneIdOf(level.label, null), kind: 'common', kinds: ['common'], floorLabel: level.label, unitLabel: null })
    } else {
      for (const z of level.zones.filter((zz) => zz.use !== 'parking')) {
        const units = Math.max(1, z.units)
        for (let u = 0; u < units; u++) {
          const unitLabel = units === 1 ? null : `Unit ${String.fromCharCode(65 + u)}`
          // ONE zone per unit, carrying the kinds inside it — not one zone per kind. A flat is the atom.
          zones.push({
            id: zoneIdOf(level.label, unitLabel), kind: 'dry', kinds: HABITABLE_ZONE_KINDS,
            floorLabel: level.label, unitLabel,
          })
        }
      }
    }
    return { label: level.label, index, zones, kind: (level.kind === 'parking' ? 'parking' : 'habitable') as FloorKind }
  })

  // ── THE TERRACE IS A PLACE (2026-07-13) ────────────────────────────────────────────────────────────
  // It was not one, and everything that stands on it was homeless or housed in a lie: `Terrace —
  // waterproofing` and `Terrace — finishing` had NO FLOOR AT ALL, the lift's machine room was a floorless
  // singleton, and the overhead tank and the rooftop solar — both `sitedDefault: 'top'` — were sited on the
  // top HABITABLE floor, i.e. inside somebody's living room. The model had no roof to put a roof-thing on.
  //
  // So the building gets its roof. It is a real level: it has an index above the top floor, it has a zone
  // (kind 'terrace', which no per_zone task claims, so it adds a PLACE and no phantom work), and every
  // `sited` type that says `top` now lands on it by itself — which is the whole point of `sited`.
  //
  // A building with no habitable floor (a compound, a plot) gets no terrace: there is nothing to be on top of.
  const top = floors[floors.length - 1]
  if (floors.some((f) => f.kind === 'habitable')) {
    const label = 'Terrace'
    floors.push({
      label, index: top.index + 1, kind: 'terrace',
      zones: [{ id: zoneIdOf(label, null), kind: 'terrace', kinds: ['terrace'], floorLabel: label, unitLabel: null }],
    })
  }
  return {
    floors,
    hasCommonAreas: opts.hasCommonAreas ?? false,
    // TRUE by default (2026-07-13). This used to default FALSE *and* every caller passed
    // `hasExternalWorks: has_common_areas` — so a project with no amenities silently had no façade
    // structure, no façade plaster, no façade paint, no site grading and no site development. Two
    // unrelated ideas sharing one flag. Opting out is what `suppressedTasks` is for.
    hasExternalWorks: opts.hasExternalWorks ?? true,
    commonSystems: new Set(opts.commonSystems ?? []),
    sitedLevels: new Map(Object.entries(opts.sitedLevels ?? {})),
    suppressedTasks: new Set(opts.suppressedTasks ?? []),
    suppressedNodes: new Set(opts.suppressedNodes ?? []),
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
  const where = {
    taskTypeId: t.id,
    floorLabel: floor?.label ?? null,
    unitLabel: zone?.unitLabel ?? null,
    zoneId: zone?.id ?? null,
  }
  return {
    id: nodeKeyOf(where), taskTypeId: t.id, label: t.label, trade: t.trade, layer: t.layer,
    floorLabel: where.floorLabel,
    floorIndex: floor?.index ?? null,
    unitLabel: where.unitLabel,
    zoneId: where.zoneId,
    zoneKind: zone?.kind ?? null,
    seqNo: 0,
    placementSource: 'authored',
    source: 'generated',
    system: t.system,
    phase: t.phase,
  }
}

/**
 * Is this task-type instantiated for this project at all?
 *
 * APPLIES TO EVERY INSTANCING — this used to be checked only inside the `building` branch, so the
 * moment an amenity gained a `per_floor` component (a lift landing door) it would have been created
 * for EVERY project whether or not the lift was ticked. The opt-in is a property of the TYPE, not of
 * how it multiplies.
 */
function typeEnabled(t: TaskType, geo: BuildingGeometry): boolean {
  if (geo.suppressedTasks?.has(t.id)) return false      // 'not applicable here' — dependents reflow
  if (t.system) return geo.commonSystems?.has(t.system) ?? false   // opt-in amenity system
  if (t.id === 'facade_plaster' || t.id === 'external_structure') return geo.hasExternalWorks ?? true
  if (t.id === 'external_paint') return geo.hasExternalWorks ?? true
  if (t.id === 'site_grade' || t.id === 'site_development') return geo.hasExternalWorks ?? true
  return true // core building work — always
}

/** The level a `sited` plant stands on: the project's explicit choice, else the type's default. */
function sitedFloor(t: TaskType, geo: BuildingGeometry): GFloor | null {
  const ordered = [...geo.floors].sort((a, b) => a.index - b.index)
  if (!ordered.length) return null
  const chosen = t.system ? geo.sitedLevels?.get(t.system) : undefined
  if (chosen) {
    const hit = ordered.find((f) => f.label === chosen)
    if (hit) return hit           // an unknown label falls through to the default, never drops the task
  }
  return t.sitedDefault === 'top' ? ordered[ordered.length - 1] : ordered[0]
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
    if (!typeEnabled(t, geometry)) continue
    if (t.instancing === 'building') {
      const n = makeNode(t, null, null)
      if (extraTaskTypes.some((x) => x.id === t.id)) n.placementSource = 'classified'
      nodes.set(n.id, n)
    } else if (t.instancing === 'sited') {
      const f = sitedFloor(t, geometry)
      if (f) {
        const n = makeNode(t, f, null)   // one node, but ON a level — the DG stands on the stilt
        if (extraTaskTypes.some((x) => x.id === t.id)) n.placementSource = 'classified'
        nodes.set(n.id, n)
      }
    } else if (t.instancing === 'per_floor') {
      for (const f of geometry.floors.filter((fl) => floorsOf(t).includes(fl.kind))) {
        const n = makeNode(t, f, null)
        if (extraTaskTypes.some((x) => x.id === t.id)) n.placementSource = 'classified'
        nodes.set(n.id, n)
      }
    } else { // per_zone
      for (const f of geometry.floors)
        for (const z of f.zones)
          if (zoneApplies(t, z)) {
            const n = makeNode(t, f, z)
            if (extraTaskTypes.some((x) => x.id === t.id)) n.placementSource = 'classified'
            nodes.set(n.id, n)
          }
    }
  }

  /**
   * 1b. THE TASKS A HUMAN DELETED. One node, by key — not a whole task-type.
   *
   * `suppressedTasks` (above, in typeEnabled) removes a TYPE from the project: no wiring anywhere.
   * That is the wrong grain for a delete on the desk, where he removed ONE task — the slab on the
   * First floor — and every other floor's slab must survive. So the key is the node_key, and it is
   * dropped here, after the nodes are minted and before the edges are drawn.
   *
   * Dropped here rather than filtered downstream because addEdge() already refuses any edge whose
   * ends are not both in `nodes` — so removing the node removes its edges for free, and everything
   * that was waiting on it becomes available. That reflow is not a side effect. It IS the delete: the
   * work is not happening, so nothing can still be waiting for it.
   */
  if (geometry.suppressedNodes?.size) {
    for (const id of geometry.suppressedNodes) nodes.delete(id)
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
  if (pt.instancing === 'building') return [nodeKey(predId, null, null)]

  // A SITED predecessor is also a single node — it just happens to stand on a level. Its OWN level, not
  // the follower's, so scope doesn't move it. sitedFloor() is the same function that placed it, so this
  // can't drift; and addEdge drops any endpoint that isn't in the graph anyway.
  if (pt.instancing === 'sited') {
    const f = sitedFloor(pt, geometry)
    return f ? [nodeKey(predId, f.label, null)] : []
  }

  const fIdx = follower.floorIndex
  const predFloorIndex = (scope.kind === 'cross_floor') ? (fIdx ?? 0) + scope.delta : (fIdx ?? 0)

  if (pt.instancing === 'per_floor') {
    // BUILDING_WIDE, or a follower with no floor of its own (a commissioning singleton): the edge means
    // "after this on EVERY floor". Lift commissioning waits for every landing door, the fire approval for
    // every floor's standpipe. This branch used to `return []` when the follower had no floor, which
    // silently dropped exactly those edges — the whole point of a commissioning step.
    if (scope.kind === 'building_wide' || fIdx === null)
      return geometry.floors.map((f) => nodeKey(predId, f.label, null))
    const f = floorByIndex.get(predFloorIndex)
    return f ? [nodeKey(predId, f.label, null)] : []
  }

  // per_zone predecessor
  if (scope.kind === 'same_zone' || (scope.kind === 'cross_floor')) {
    // same locale: same zone (= same unit) on the (possibly offset) floor
    if (follower.zoneId) {
      const f = floorByIndex.get(predFloorIndex)
      if (!f) return []
      // when the follower is per_zone, match the SAME unit only if pred applies there. The zone id is
      // floor-qualified, so on a cross_floor hop compare the UNIT, not the id.
      const z = f.zones.find((zz) => unitKeyOf(zz.unitLabel) === unitKeyOf(follower.unitLabel))
      if (z && zoneApplies(pt, z)) return [nodeKey(predId, f.label, unitKeyOf(z.unitLabel))]
      return []
    }
    // follower is per_floor/building but pred is per_zone under same_zone — link to every matching
    // zone on the follower's floor (rare; keeps such edges from silently vanishing).
    const f = floorByIndex.get(predFloorIndex)
    if (!f) return []
    return f.zones.filter((z) => zoneApplies(pt, z)).map((z) => nodeKey(predId, f.label, unitKeyOf(z.unitLabel)))
  }

  if (scope.kind === 'same_floor') {
    const f = floorByIndex.get(predFloorIndex)
    if (!f) return []
    return f.zones.filter((z) => zoneApplies(pt, z)).map((z) => nodeKey(predId, f.label, unitKeyOf(z.unitLabel)))
  }

  // building_wide / external per-zone pred — link to all matching zones building-wide (rare)
  const out: NodeId[] = []
  for (const f of geometry.floors)
    for (const z of f.zones)
      if (zoneApplies(pt, z)) out.push(nodeKey(predId, f.label, unitKeyOf(z.unitLabel)))
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
