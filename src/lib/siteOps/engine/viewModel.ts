// ENGINE → UI VIEW-MODEL. Pure, no I/O.
//
// buildProjectVM folds the concrete graph (M2) + live evaluation (M3) into the serializable
// ProjectVM the UI renders. EVERYTHING the UI used to compute — status, ordering (seqNo), why,
// freedom, layer %, overall %, stage, timeline fills — is computed HERE, once, from the real
// engine. The UI must recompute none of it. One engine, one source of truth.
//
// Folding model: the engine instantiates per (floor, unit, zoneKind); the UI shows per-UNIT
// "blocks". So each block aggregates a floor's shared per-floor structural nodes + that unit's
// per-zone nodes, collapsing multiple zone-instances of the same task-type into one display task
// (e.g. one "Conduiting" per unit even though it exists in the unit's dry + wet + balcony zones).

import {
  type AmenityVM, type Availability, type BlockVM, type BuildingGeometry, type CompletionState,
  type ConcreteEdge, type FloorVM, type GFloor, type Library, type Nature, type ProjectVM,
  type TaskNode, type TaskTypeId, type TaskVM, type VmEdge, type VmWhy,
} from './types'
import { LIBRARY, isHardNature, canonicalRank } from './library'
import { instantiate, stackToGeometry, buildAdjacency } from './instantiate'
import { Evaluator } from './evaluate'
import { nodeKey, nodeKeyOf, unitKeyOf, zoneIdOf } from './identity'
import { stageOfFloorless, STAGE_LABEL } from './stages'

const NATURE_RANK: Record<Nature, number> = {
  IMPOSSIBLE: 4, DESTRUCTIVE: 3, STRONG_PREF: 2, WEAK_PREF: 1, INDIFFERENT: 0,
}
interface ConstructionStack { levels: { label: string; kind: string; zones: { use: string; units: number }[] }[] }

export interface BuildVMOptions {
  name?: string
  dryRun?: boolean
  generatedAt?: string                       // injected for determinism/testability
  lib?: Library
  hasCommonAreas?: boolean
  hasExternalWorks?: boolean                 // defaults TRUE — see BuildingGeometry.hasExternalWorks
  commonSystems?: string[]   // opt-in amenity SYSTEM ids enabled for this project (projects.common_systems)
  sitedLevels?: Record<string, string>       // system id → the level its plant stands on
  suppressedTasks?: string[] // task-type ids marked 'not applicable' for this project
  suppressedNodes?: string[] // node_keys a human deleted from the plan (one task, not a type)
}

export function buildProjectVM(
  projectId: string,
  constructionStack: ConstructionStack,
  completionState: CompletionState = new Map(),
  opts: BuildVMOptions = {},
): ProjectVM {
  const lib = opts.lib ?? LIBRARY
  const geometry: BuildingGeometry = stackToGeometry(constructionStack, {
    hasCommonAreas: opts.hasCommonAreas, hasExternalWorks: opts.hasExternalWorks, sitedLevels: opts.sitedLevels,
    commonSystems: opts.commonSystems, suppressedTasks: opts.suppressedTasks,
    suppressedNodes: opts.suppressedNodes,
  })
  const graph = instantiate(geometry, lib)
  // Completion may be keyed by the FOLDED display node_key (one row per unit-task — what the UI
  // materialises) OR a concrete node id (full persist). The Evaluator works on concrete nodes, so
  // expand: a concrete node takes the status set on its own id OR on its folded key. WITHOUT this,
  // per-zone services/finishes (whose folded key ≠ concrete id) never registered as done.
  const concreteState: CompletionState = new Map()
  for (const n of graph.nodes.values()) {
    const s = completionState.get(n.id) ?? completionState.get(foldKeyOf(n))
    if (s) concreteState.set(n.id, s)
  }
  const ev = new Evaluator(graph, concreteState, lib)
  const { preds, succs } = buildAdjacency(graph)
  const canon = canonicalRank(lib) // canonical task-TYPE display order for every block

  // a folded display-task = all graph nodes that share a (taskType) within one block
  const floors: (FloorVM & { _counts?: { done: number; total: number } })[] = geometry.floors
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((floor) => buildFloorVM(floor, graph, ev, preds, succs, lib, canon))

  // FOUNDATION / GROUNDWORK — the building-singleton substructure nodes (floorIndex null) are folded
  // into one synthetic "Foundation" floor at index -1, so they render as the FIRST stage of the build
  // (below the ground floor) rather than being dropped from the floor-keyed timeline.
  const foundationFloor = buildFoundationFloorVM(graph, ev, preds, succs, lib, canon)
  if (foundationFloor) floors.unshift(foundationFloor)

  // BUILDING-WIDE — terrace, façade, risers, staircase, snagging: floorless work that belonged to no
  // stage and so could never be marked done. Sits above the top floor, below the amenities.
  const buildingFloor = buildBuildingWideFloorVM(graph, ev, preds, succs, lib, canon)
  if (buildingFloor) floors.push(buildingFloor)

  // COMMON AREAS / AMENITIES — the opt-in ca_* building singletons fold into one "Common areas" stage
  // at the TOP of the elevation (above the roof), parallel to the unit work.
  const commonFloor = buildCommonFloorVM(graph, ev, preds, succs, lib, canon)
  if (commonFloor) floors.push(commonFloor)

  // project overall = done / total over each floor's distinct folded tasks (no double-count of
  // the per-floor structural shared across a floor's blocks; buildFloorVM computed this in _counts)
  let pDone = 0, pTotal = 0
  for (const f of floors) { pDone += f._counts?.done ?? 0; pTotal += f._counts?.total ?? 0 }
  const overallPct = pTotal ? Math.round((pDone / pTotal) * 100) : 0

  // strip the private _counts helper before returning
  for (const f of floors) delete (f as FloorVM & { _counts?: unknown })._counts

  return {
    projectId,
    name: opts.name ?? projectId,
    floors,
    overallPct,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    dryRun: opts.dryRun ?? false,
    amenities: buildAmenitiesVM(graph, ev, preds, succs, lib),
  }
}

// ── amenities, by SYSTEM ─────────────────────────────────────────────────────
// The second index over the same nodes. The elevation answers "what is happening on the third floor?";
// this answers "how far along is the lift?" — which the floor-keyed view can never answer, because a
// lift is spread across every floor plus two floorless steps.
//
// Deliberately NOT a second set of tasks. Every entry here is a node the floors also render, so a
// status written from either surface is the same status, and nothing can drift.
function buildAmenitiesVM(
  graph: ReturnType<typeof instantiate>,
  ev: Evaluator,
  preds: Map<string, ConcreteEdge[]>,
  succs: Map<string, ConcreteEdge[]>,
  lib: Library,
): AmenityVM[] {
  const bySystem = new Map<string, TaskNode[]>()
  for (const n of graph.nodes.values()) {
    if (!n.system) continue
    if (!bySystem.has(n.system)) bySystem.set(n.system, [])
    bySystem.get(n.system)!.push(n)
  }

  const out: AmenityVM[] = []
  for (const [system, nodes] of bySystem) {
    // one entry per NODE (not per type): a landing door on each floor is four separate jobs, and the
    // whole point is that each is reportable on its own.
    const tasks = nodes
      .slice()
      .sort((a, b) => a.seqNo - b.seqNo)
      .map((n) => ({
        ...foldTask(n.taskTypeId, [n], 'common',
          { label: n.floorLabel ?? '', index: n.floorIndex ?? 0, zones: [], kind: 'stage' }, ev, preds, succs, lib),
        floorLabel: n.floorLabel,
      }))
    const done = tasks.filter((t) => t.status === 'done').length
    out.push({
      system,
      label: SYSTEM_LABELS[system] ?? system,
      pc: tasks.length ? Math.round((done / tasks.length) * 100) : 0,
      tasks,
    })
  }
  return out.sort((a, b) => a.label.localeCompare(b.label))
}

/** Human names for the amenity systems (the opt-in keys). */
const SYSTEM_LABELS: Record<string, string> = {
  ca_lift: 'Lift', ca_stair: 'Common staircase', ca_corridor: 'Corridors & lobbies',
  ca_oht: 'Water — tank & pumps', ca_ugt: 'Sump / UG tank', ca_borewell: 'Borewell', ca_stp: 'STP',
  ca_transformer: 'Transformer', ca_generator: 'DG / generator', ca_solar: 'Rooftop solar',
  ca_fire: 'Fire fighting', ca_parking: 'Parking', ca_compound: 'Compound wall & gate',
  ca_landscaping: 'Landscaping',
}

// the folded display node_key for a concrete node. It no longer has to be KEPT in step with the graph's
// id and foldTask()'s key by hand — all three ARE the same function now (identity.ts).
const foldKeyOf = (n: TaskNode): string => nodeKeyOf(n)

// the building-singleton substructure task-types, in chain order — surfaced as the "Foundation" stage
// (site_marking + plinth_slab added 2026-07-13: they are substructure, and living outside every stage
// made them unrenderable — hence unwriteable, see buildBuildingWideFloorVM)
// FOUNDATION_TYPES + the three-way split now live in ONE place (stages.ts) — the desk asks the same
// function, so the VM and the task list cannot disagree about where a floorless task belongs. They did:
// the desk had one bin ("everything with no floor") and put the lift and the facade under the foundation.

// ── foundation / groundwork (synthetic floor) ─────────────────────────────────
// Folds the building-level substructure singletons into one "Foundation" floor (index -1, one block)
// so the first stage of the build is visible in the timeline. nodeKeys stay bare task-type ids — the
// same key foldKeyOf() yields for a building node — so completion status maps correctly.
function buildFoundationFloorVM(
  graph: ReturnType<typeof instantiate>,
  ev: Evaluator,
  preds: Map<string, ConcreteEdge[]>,
  succs: Map<string, ConcreteEdge[]>,
  lib: Library,
  canon: Map<TaskTypeId, number>,
): (FloorVM & { _counts?: { done: number; total: number } }) | null {
  const fNodes = [...graph.nodes.values()].filter((n) => n.floorIndex === null && n.zoneId === null && stageOfFloorless(n.taskTypeId, lib) === 'foundation')
  if (!fNodes.length) return null
  const synthFloor: GFloor = { label: STAGE_LABEL.foundation, index: -1, zones: [], kind: 'stage' }
  const byType = new Map<string, TaskNode[]>()
  for (const n of fNodes) { if (!byType.has(n.taskTypeId)) byType.set(n.taskTypeId, []); byType.get(n.taskTypeId)!.push(n) }
  const rank = (tt: string): number => canon.get(tt) ?? 9999
  const tasks: TaskVM[] = [...byType.entries()]
    .map(([tt, inst]) => foldTask(tt, inst, 'unit', synthFloor, ev, preds, succs, lib))
    .sort((a, b) => (rank(a.taskType) - rank(b.taskType)) || (a.seqNo - b.seqNo))
  const done = tasks.filter((t) => t.status === 'done').length
  const total = tasks.length
  const pc = total ? Math.round((done / total) * 100) : 0
  const fills: FloorVM['fills'] = pc === 100 && total > 0 ? [['done', 100]] : pc > 0 ? [['struct', pc]] : []
  const block: BlockVM = {
    zoneId: 'Foundation/unit', name: 'Substructure', kind: 'common', tasks,
    layerPct: { structure: pc, services: 0, finishes: 0 }, overallPct: pc,
    stage: pc === 100 ? { label: 'Complete', key: 'done' } : { label: 'Substructure', key: 'structure' },
  }
  return { id: 'F0', name: STAGE_LABEL.foundation, index: -1, pc, fills, blocks: [block], _counts: { done, total } }
}

// ── common areas / amenities (synthetic floor) ────────────────────────────────
// Folds the enabled ca_* building singletons into one "Common areas" stage at the top of the
// elevation. nodeKeys stay bare task-type ids (= foldKeyOf for a building node) so status maps.
function buildCommonFloorVM(
  graph: ReturnType<typeof instantiate>,
  ev: Evaluator,
  preds: Map<string, ConcreteEdge[]>,
  succs: Map<string, ConcreteEdge[]>,
  lib: Library,
  canon: Map<TaskTypeId, number>,
): (FloorVM & { _counts?: { done: number; total: number } }) | null {
  // The FLOORLESS half of the amenity systems: commissioning, licences, the compound wall, landscaping.
  // The parts that live on a level (lift shaft/door, stair flight, corridor, the sited plant) are
  // rendered on their floor's Common block instead — that's where the work happens.
  const cNodes = [...graph.nodes.values()].filter((n) => n.floorIndex === null && n.zoneId === null && stageOfFloorless(n.taskTypeId, lib) === 'amenities')
  if (!cNodes.length) return null
  const synthFloor: GFloor = { label: STAGE_LABEL.amenities, index: 9999, zones: [], kind: 'stage' }
  const byType = new Map<string, TaskNode[]>()
  for (const n of cNodes) { if (!byType.has(n.taskTypeId)) byType.set(n.taskTypeId, []); byType.get(n.taskTypeId)!.push(n) }
  const rank = (tt: string): number => canon.get(tt) ?? 9999
  const tasks: TaskVM[] = [...byType.entries()]
    .map(([tt, inst]) => foldTask(tt, inst, 'unit', synthFloor, ev, preds, succs, lib))
    .sort((a, b) => (rank(a.taskType) - rank(b.taskType)) || (a.seqNo - b.seqNo))
  const done = tasks.filter((t) => t.status === 'done').length
  const total = tasks.length
  const pc = total ? Math.round((done / total) * 100) : 0
  const fills: FloorVM['fills'] = pc === 100 && total > 0 ? [['done', 100]] : pc > 0 ? [['struct', pc]] : []
  const block: BlockVM = {
    zoneId: 'Common/unit', name: 'Amenities', kind: 'common', tasks,
    layerPct: {
      structure: pctDone(tasks.filter((t) => t.layer === 'structure')),
      services: pctDone(tasks.filter((t) => t.layer === 'services')),
      finishes: pctDone(tasks.filter((t) => t.layer === 'finishes')),
    },
    overallPct: pc,
    stage: pc === 100 ? { label: 'Complete', key: 'done' } : { label: STAGE_LABEL.amenities, key: 'structure' },
  }
  return { id: 'CA', name: STAGE_LABEL.amenities, index: 9999, pc, fills, blocks: [block], _counts: { done, total } }
}

// ── building-wide work (synthetic floor) — THE CATCH-ALL ──────────────────────
// Every building singleton the other two synthetic stages don't claim: the terrace (waterproofing,
// finishing), the façade (structure, plaster, paint), vertical risers, the common staircase, site
// development, the lift, and snagging & handover.
//
// This exists because "renders nowhere" silently meant "cannot be marked done". The elevation keyed
// everything by floor, so a task with no floor — a terrace, a riser, handover itself — appeared in no
// stage, produced no VM nodeKey, and applyProgress's guardrail (node_key ∈ vmNodeKeys) therefore
// REFUSED every write to it: the supervisor could say "terrace waterproofing is done" forever and the
// row never moved.
//
// So the rule is a REMAINDER, not a list: anything floorless and zoneless that isn't substructure and
// isn't an amenity lands here. A task type added to the library tomorrow cannot be born invisible —
// which is the property __tests__/identity.test.ts pins.
function buildBuildingWideFloorVM(
  graph: ReturnType<typeof instantiate>,
  ev: Evaluator,
  preds: Map<string, ConcreteEdge[]>,
  succs: Map<string, ConcreteEdge[]>,
  lib: Library,
  canon: Map<TaskTypeId, number>,
): (FloorVM & { _counts?: { done: number; total: number } }) | null {
  const bNodes = [...graph.nodes.values()].filter((n) =>
    n.floorIndex === null && n.zoneId === null && stageOfFloorless(n.taskTypeId, lib) === 'exterior')
  if (!bNodes.length) return null
  const synthFloor: GFloor = { label: STAGE_LABEL.exterior, index: 9998, zones: [], kind: 'stage' }
  const byType = new Map<string, TaskNode[]>()
  for (const n of bNodes) { if (!byType.has(n.taskTypeId)) byType.set(n.taskTypeId, []); byType.get(n.taskTypeId)!.push(n) }
  const rank = (tt: string): number => canon.get(tt) ?? 9999
  const tasks: TaskVM[] = [...byType.entries()]
    .map(([tt, inst]) => foldTask(tt, inst, 'unit', synthFloor, ev, preds, succs, lib))
    .sort((a, b) => (rank(a.taskType) - rank(b.taskType)) || (a.seqNo - b.seqNo))
  const done = tasks.filter((t) => t.status === 'done').length
  const total = tasks.length
  const pc = total ? Math.round((done / total) * 100) : 0
  const fills: FloorVM['fills'] = pc === 100 && total > 0 ? [['done', 100]] : pc > 0 ? [['struct', pc]] : []
  const block: BlockVM = {
    zoneId: 'Building/unit', name: 'Terrace, façade & handover', kind: 'common', tasks,
    layerPct: {
      structure: pctDone(tasks.filter((t) => t.layer === 'structure')),
      services: pctDone(tasks.filter((t) => t.layer === 'services')),
      finishes: pctDone(tasks.filter((t) => t.layer === 'finishes')),
    },
    overallPct: pc,
    stage: pc === 100 ? { label: 'Complete', key: 'done' } : { label: 'Building-wide', key: 'finishes' },
  }
  return { id: 'BW', name: STAGE_LABEL.exterior, index: 9998, pc, fills, blocks: [block], _counts: { done, total } }
}

// ── floor ────────────────────────────────────────────────────────────────────
function buildFloorVM(
  floor: GFloor,
  graph: ReturnType<typeof instantiate>,
  ev: Evaluator,
  preds: Map<string, ConcreteEdge[]>,
  succs: Map<string, ConcreteEdge[]>,
  lib: Library,
  canon: Map<TaskTypeId, number>,
): FloorVM & { _counts?: { done: number; total: number } } {
  const floorNodes = [...graph.nodes.values()].filter((n) => n.floorIndex === floor.index)
  // AMENITY nodes on this floor — the lift shaft and its landing door, the stair flight, the corridor,
  // the fire standpipe, and any `sited` plant (the DG on the stilt, the OHT on the roof). They get their
  // OWN block, because they are common work: they belong to the floor but to no flat. Excluding them
  // from `perFloorStructural` matters — that list is copied into EVERY unit block, so a lift shaft left
  // in it would appear once per flat.
  const amenityNodes = floorNodes.filter((n) => !!n.system)
  const perFloorStructural = floorNodes.filter((n) => n.zoneId === null && !n.system) // columns/beams/slab/…
  const zoneNodes = floorNodes.filter((n) => n.zoneId !== null && !n.system)

  // units on this floor (distinct unitLabel among zone nodes); villa/parking → one block
  const unitKeys = [...new Set(zoneNodes.map((n) => n.unitLabel ?? '∅'))]
  const blocks: BlockVM[] = (unitKeys.length ? unitKeys : ['∅']).map((uk) => {
    const unitZoneNodes = zoneNodes.filter((n) => (n.unitLabel ?? '∅') === uk)
    const unitLabel = uk === '∅' ? null : uk
    return buildBlockVM(floor, unitLabel, perFloorStructural, unitZoneNodes, ev, preds, succs, lib, canon)
  })

  const commonBlock = amenityNodes.length
    ? buildCommonBlockVM(floor, amenityNodes, ev, preds, succs, lib, canon)
    : null
  if (commonBlock) blocks.push(commonBlock)

  // floor distinct folded set = structural folded once + each unit's per-zone folded + the common block
  const distinct: TaskVM[] = []
  if (blocks.length) {
    // structural tasks are identical across blocks → take them from the first block once
    const structural = blocks[0].tasks.filter((t) => t.layer === 'structure')
    distinct.push(...structural)
    for (const b of blocks) {
      if (b === commonBlock) { distinct.push(...b.tasks); continue }  // common work is never shared
      distinct.push(...b.tasks.filter((t) => t.layer !== 'structure'))
    }
  }
  const done = distinct.filter((t) => t.status === 'done').length
  const total = distinct.length
  const pc = total ? Math.round((done / total) * 100) : 0

  // fills: each layer's done share of the whole floor (segments sum ≈ pc). Fully done → one 'done'.
  let fills: FloorVM['fills']
  if (pc === 100 && total > 0) fills = [['done', 100]]
  else {
    fills = ([['structure', 'struct'], ['services', 'serv'], ['finishes', 'fin']] as const)
      .map(([layer, tag]): ['struct' | 'serv' | 'fin', number] => {
        const doneInLayer = distinct.filter((t) => t.layer === layer && t.status === 'done').length
        return [tag, total ? Math.round((doneInLayer / total) * 100) : 0]
      })
      .filter(([, v]) => v > 0)
  }

  return {
    id: floorId(floor.label),
    name: floor.label,
    index: floor.index,
    pc,
    fills,
    blocks,
    _counts: { done, total },
  }
}

// ── block (a floor's COMMON work) ─────────────────────────────────────────────
// The amenity components that live on THIS floor: the lift shaft and landing door, the stair flight,
// the corridor, the fire standpipe, plus any plant sited here (the DG on the stilt). Rendered as a block
// beside the flats, because that is where the work is — and, not incidentally, because a task the VM
// renders is a task applyProgress is allowed to write ("lift door done on the third").
function buildCommonBlockVM(
  floor: GFloor,
  amenityNodes: TaskNode[],
  ev: Evaluator,
  preds: Map<string, ConcreteEdge[]>,
  succs: Map<string, ConcreteEdge[]>,
  lib: Library,
  canon: Map<TaskTypeId, number>,
): BlockVM {
  const byType = new Map<string, TaskNode[]>()
  for (const n of amenityNodes) {
    if (!byType.has(n.taskTypeId)) byType.set(n.taskTypeId, [])
    byType.get(n.taskTypeId)!.push(n)
  }
  const rank = (tt: string): number => canon.get(tt) ?? 9999
  const tasks: TaskVM[] = [...byType.entries()]
    .map(([tt, inst]) => foldTask(tt, inst, 'common', floor, ev, preds, succs, lib))
    .sort((a, b) => (rank(a.taskType) - rank(b.taskType)) || (a.seqNo - b.seqNo))

  const layerPct = {
    structure: pctDone(tasks.filter((t) => t.layer === 'structure')),
    services: pctDone(tasks.filter((t) => t.layer === 'services')),
    finishes: pctDone(tasks.filter((t) => t.layer === 'finishes')),
  }
  const overallPct = pctDone(tasks)
  return {
    zoneId: `${floor.label}/common`,
    name: 'Common',
    kind: 'common',
    tasks,
    layerPct,
    overallPct,
    stage: deriveStage(layerPct),
  }
}

// ── block (a unit) ─────────────────────────────────────────────────────────────
function buildBlockVM(
  floor: GFloor,
  unitLabel: string | null,
  perFloorStructural: TaskNode[],
  unitZoneNodes: TaskNode[],
  ev: Evaluator,
  preds: Map<string, ConcreteEdge[]>,
  succs: Map<string, ConcreteEdge[]>,
  lib: Library,
  canon: Map<TaskTypeId, number>,
): BlockVM {
  const unitKey = unitKeyOf(unitLabel)

  // group nodes by taskType (per-floor structural are shared; per-zone may repeat per zone kind)
  const byType = new Map<string, TaskNode[]>()
  for (const n of [...perFloorStructural, ...unitZoneNodes]) {
    if (!byType.has(n.taskTypeId)) byType.set(n.taskTypeId, [])
    byType.get(n.taskTypeId)!.push(n)
  }

  // sort by the canonical construction sequence of task-TYPES (NOT the zone-scrambled instance
  // seqNo); seqNo breaks any ties (e.g. classified user tasks not in the canon).
  const rank = (tt: string): number => canon.get(tt) ?? 9999
  const tasks: TaskVM[] = [...byType.entries()].map(([taskType, instances]) =>
    foldTask(taskType, instances, unitKey, floor, ev, preds, succs, lib),
  ).sort((a, b) => (rank(a.taskType) - rank(b.taskType)) || (a.seqNo - b.seqNo))

  // layer % and overall %
  const layerPct = {
    structure: pctDone(tasks.filter((t) => t.layer === 'structure')),
    services: pctDone(tasks.filter((t) => t.layer === 'services')),
    finishes: pctDone(tasks.filter((t) => t.layer === 'finishes')),
  }
  const overallPct = pctDone(tasks)
  const repZone = unitZoneNodes[0]?.zoneKind ?? 'dry'

  return {
    zoneId: zoneIdOf(floor.label, unitLabel),
    name: unitLabel ?? 'Whole floor',
    kind: repZone,
    tasks,
    layerPct,
    overallPct,
    stage: deriveStage(layerPct),
  }
}

// ── fold N zone-instances of one task-type into one display task ─────────────
function foldTask(
  taskType: string,
  instances: TaskNode[],
  unitKey: string,
  floor: GFloor,
  ev: Evaluator,
  preds: Map<string, ConcreteEdge[]>,
  succs: Map<string, ConcreteEdge[]>,
  lib: Library,
): TaskVM {
  const tt = lib.taskTypes.get(taskType)
  const isBuilding = instances[0].floorLabel === null   // foundation/groundwork building singletons
  const isPerFloor = instances[0].zoneId === null
  const key = nodeKey(taskType, isBuilding ? null : floor.label, isBuilding || isPerFloor ? null : unitKey)

  // folded status: all done → done; any active → active; any available → available; else blocked
  const statuses = instances.map((n) => ev.availability(n.id))
  const status: Availability =
    statuses.every((s) => s === 'done') ? 'done'
      : statuses.some((s) => s === 'active') ? 'active'
        : statuses.some((s) => s === 'available') ? 'available'
          : 'blocked'

  const seqNo = Math.min(...instances.map((n) => n.seqNo))

  // why: from a blocked instance, most-severe binder first, deduped by predecessor label
  let why: VmWhy[] | undefined
  if (status === 'blocked') {
    const blockedInst = instances.find((n) => ev.availability(n.id) === 'blocked')!
    const seen = new Set<string>()
    why = ev.why(blockedInst.id).map((b): VmWhy => ({
      afterLabel: lib.taskTypes.get(b.taskTypeId)?.label ?? b.taskTypeId,
      reason: b.reason,
    })).filter((w) => (seen.has(w.afterLabel) ? false : (seen.add(w.afterLabel), true)))
  }

  // hard preds/deps (engine-supplied) — deduped by predecessor/dependent task-type, most-severe nature
  const hardPreds = foldEdges(instances.flatMap((n) => preds.get(n.id) ?? []), 'from', ev, lib)
  const hardDeps = foldEdges(instances.flatMap((n) => succs.get(n.id) ?? []), 'to', ev, lib)

  return {
    nodeKey: key,
    taskType,
    label: tt?.label ?? taskType,
    phase: tt?.phase,
    trade: tt?.trade ?? instances[0].trade,
    layer: instances[0].layer,
    status,
    seqNo,
    why,
    freedomSet: tt?.freedomSet,
    placementSource: instances[0].placementSource,
    needsReview: instances.some((n) => n.needsReview) || undefined,
    hardPreds,
    hardDeps,
  }
}

function foldEdges(edges: ConcreteEdge[], side: 'from' | 'to', ev: Evaluator, lib: Library): VmEdge[] {
  const byType = new Map<string, VmEdge>()
  for (const e of edges) {
    if (!isHardNature(e.nature, e.reason)) continue
    const otherId = side === 'from' ? e.from : e.to
    const node = ev.graph.nodes.get(otherId)
    if (!node) continue
    const existing = byType.get(node.taskTypeId)
    if (!existing || NATURE_RANK[e.nature] > NATURE_RANK[existing.nature]) {
      byType.set(node.taskTypeId, {
        nodeKey: otherId,
        taskType: node.taskTypeId,
        label: lib.taskTypes.get(node.taskTypeId)?.label ?? node.taskTypeId,
        nature: e.nature,
        reason: e.reason,
      })
    }
  }
  return [...byType.values()]
}

// ── small helpers ────────────────────────────────────────────────────────────
function pctDone(tasks: TaskVM[]): number {
  if (!tasks.length) return 0
  return Math.round((tasks.filter((t) => t.status === 'done').length / tasks.length) * 100)
}

function deriveStage(layerPct: BlockVM['layerPct']): BlockVM['stage'] {
  // matches the prototype's stage() semantics, computed once here
  if (layerPct.finishes > 0) return layerPct.finishes === 100 ? { label: 'Complete', key: 'done' } : { label: 'Finishing', key: 'finishes' }
  if (layerPct.services > 0) return { label: 'Services', key: 'services' }
  if (layerPct.structure === 100) return { label: 'Structure done', key: 'structure' }
  return { label: 'Structuring', key: 'structure' }
}

function floorId(label: string): string {
  // 'Ground'→'G', 'First'→'1' (ordinal index isn't known here; fall back to first char / digits)
  const map: Record<string, string> = { Ground: 'G', First: '1', Second: '2', Third: '3', Fourth: '4', Fifth: '5', Terrace: 'T', Stilt: 'S', Cellar: 'C' }
  return map[label] ?? label.charAt(0).toUpperCase()
}
