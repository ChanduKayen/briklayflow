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
  type Availability, type BlockVM, type BuildingGeometry, type CompletionState, type ConcreteEdge,
  type FloorVM, type GFloor, type Library, type Nature, type ProjectVM,
  type TaskNode, type TaskTypeId, type TaskVM, type VmEdge, type VmWhy,
} from './types'
import { LIBRARY, isHardNature, canonicalRank } from './library'
import { instantiate, stackToGeometry, buildAdjacency } from './instantiate'
import { Evaluator } from './evaluate'

const NATURE_RANK: Record<Nature, number> = {
  IMPOSSIBLE: 4, DESTRUCTIVE: 3, STRONG_PREF: 2, WEAK_PREF: 1, INDIFFERENT: 0,
}
interface ConstructionStack { levels: { label: string; kind: string; zones: { use: string; units: number }[] }[] }

export interface BuildVMOptions {
  name?: string
  dryRun?: boolean
  generatedAt?: string                       // injected for determinism/testability
  lib?: Library
  hasLift?: boolean
  hasCommonAreas?: boolean
  hasExternalWorks?: boolean
  commonSystems?: string[]   // opt-in common-area task-type ids enabled for this project (ca_*)
  suppressedTasks?: string[] // task-type ids marked 'not applicable' for this project
}

export function buildProjectVM(
  projectId: string,
  constructionStack: ConstructionStack,
  completionState: CompletionState = new Map(),
  opts: BuildVMOptions = {},
): ProjectVM {
  const lib = opts.lib ?? LIBRARY
  const geometry: BuildingGeometry = stackToGeometry(constructionStack, {
    hasLift: opts.hasLift, hasCommonAreas: opts.hasCommonAreas, hasExternalWorks: opts.hasExternalWorks,
    commonSystems: opts.commonSystems, suppressedTasks: opts.suppressedTasks,
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
  }
}

// the folded display node_key for a concrete node — MUST match foldTask()'s nodeKey exactly
function foldKeyOf(n: TaskNode): string {
  if (n.zoneId === null) return n.floorLabel ? `${n.taskTypeId}@${n.floorLabel}` : n.taskTypeId
  const unitKey = n.unitLabel ? n.unitLabel.replace(/\s+/g, '') : 'unit'
  return `${n.taskTypeId}@${n.floorLabel}/${unitKey}`
}

// the building-singleton substructure task-types, in chain order — surfaced as the "Foundation" stage
const FOUNDATION_TYPES = new Set<string>([
  'ground_clearance', 'excavation', 'pcc_bed', 'footing', 'footing_column', 'backfill', 'plinth_beam', 'plinth_fill', 'foundation',
])

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
  const fNodes = [...graph.nodes.values()].filter((n) => n.floorIndex === null && n.zoneId === null && FOUNDATION_TYPES.has(n.taskTypeId))
  if (!fNodes.length) return null
  const synthFloor: GFloor = { label: 'Foundation', index: -1, zones: [] }
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
  return { id: 'F0', name: 'Foundation', index: -1, pc, fills, blocks: [block], _counts: { done, total } }
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
  const cNodes = [...graph.nodes.values()].filter((n) => n.floorIndex === null && n.zoneId === null && n.taskTypeId.startsWith('ca_'))
  if (!cNodes.length) return null
  const synthFloor: GFloor = { label: 'Common areas', index: 9999, zones: [] }
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
    stage: pc === 100 ? { label: 'Complete', key: 'done' } : { label: 'Common areas', key: 'structure' },
  }
  return { id: 'CA', name: 'Common areas', index: 9999, pc, fills, blocks: [block], _counts: { done, total } }
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
  const perFloorStructural = floorNodes.filter((n) => n.zoneId === null) // columns/beams/slab/…
  const zoneNodes = floorNodes.filter((n) => n.zoneId !== null)

  // units on this floor (distinct unitLabel among zone nodes); villa/parking → one block
  const unitKeys = [...new Set(zoneNodes.map((n) => n.unitLabel ?? '∅'))]
  const blocks: BlockVM[] = (unitKeys.length ? unitKeys : ['∅']).map((uk) => {
    const unitZoneNodes = zoneNodes.filter((n) => (n.unitLabel ?? '∅') === uk)
    const unitLabel = uk === '∅' ? null : uk
    return buildBlockVM(floor, unitLabel, perFloorStructural, unitZoneNodes, ev, preds, succs, lib, canon)
  })

  // floor distinct folded set = structural folded once + each unit's per-zone folded
  const distinct: TaskVM[] = []
  if (blocks.length) {
    // structural tasks are identical across blocks → take them from the first block once
    const structural = blocks[0].tasks.filter((t) => t.layer === 'structure')
    distinct.push(...structural)
    for (const b of blocks) distinct.push(...b.tasks.filter((t) => t.layer !== 'structure'))
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
  const unitKey = unitLabel ? unitLabel.replace(/\s+/g, '') : 'unit'

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
    zoneId: `${floor.label}/${unitKey}`,
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
  const nodeKey = isBuilding ? taskType : isPerFloor ? `${taskType}@${floor.label}` : `${taskType}@${floor.label}/${unitKey}`

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
    nodeKey,
    taskType,
    label: tt?.label ?? taskType,
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
