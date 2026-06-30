// SiteOps constraint engine — shared type contract (the six dimensions, encoded once).
//
// This file is the vocabulary every module agrees on. It is framework-free (no React, no
// Supabase) so it runs identically in Node tests and in a Deno edge function. The six
// dimensions of the founder's constraint model live here as types:
//   1. NATURE       — the forbidden→free spectrum (only IMPOSSIBLE truly forbids)
//   2. REASON       — why a constraint exists (so the engine can always explain itself)
//   3. TWO AXES     — sequence (precedes/follows) vs cohesion (bound-with bundle)
//   4. SCOPE        — where a constraint applies (same-zone … building-wide … external)
//   5. FREEDOM      — positively asserted via freedom sets, never residual
//   6. STATE-EVAL   — the library is the ruleset; availability is computed live (evaluate.ts)
//
// See ./README.md for the bounded-classifier principle and the honesty valve.

// ── Dimension 1: NATURE ──────────────────────────────────────────────────────
// The spectrum from forbidden to free. Only IMPOSSIBLE is a hard block.
// NOTE on curing: the Constraints sheet labels slab→deshutter as "CURING-WAIT". We encode
// that as nature DESTRUCTIVE with reason 'curing_time' (see isHardEdge in instantiate.ts):
// destructive because de-propping green concrete ruins the slab, and reason 'curing_time'
// flags it as a TIME wait the future scheduler attaches a duration to — not a trade-finish gate.
export type Nature = 'IMPOSSIBLE' | 'DESTRUCTIVE' | 'STRONG_PREF' | 'WEAK_PREF' | 'INDIFFERENT'

// ── Dimension 2: REASON ──────────────────────────────────────────────────────
export type Reason = 'structural' | 'concealment' | 'curing_time' | 'logistics' | 'quality' | 'policy'

// User-facing layer names (the model's bones/muscle/skin, renamed for users).
export type Layer = 'structure' | 'services' | 'finishes'

// ── Dimension 4: SCOPE ───────────────────────────────────────────────────────
// Where a relative constraint applies. `delta` on cross_floor is the PREDECESSOR's floor
// offset relative to the follower's floor (delta -1 = predecessor one floor below me).
export type Scope =
  | { kind: 'same_zone' }
  | { kind: 'same_floor' }
  | { kind: 'cross_floor'; delta: number }
  | { kind: 'building_wide' }
  | { kind: 'external' }

// Which zone kinds a per-zone task instantiates into. The Constraints sheet's wet/dry split.
export type ZoneKind = 'dry' | 'wet' | 'balcony' | 'common' | 'external' | 'shaft'

// How a task type is instanced onto building geometry (see instantiate.ts):
//   per_zone  — one node per matching zone (default; services + finishes)
//   per_floor — one node per structural floor, zone-agnostic (columns/beams/slab/blockwork)
//   building  — a single shared node for the whole building (foundation/lift/facade/site dev)
export type Instancing = 'per_zone' | 'per_floor' | 'building'

export type TaskTypeId = string
export type FreedomSetId = string

// ── Dimension 3, axis A: SEQUENCE ────────────────────────────────────────────
// Authored on the FOLLOWER: "`pred` precedes me, with this nature/reason/scope".
export interface SeqEdge {
  pred: TaskTypeId
  nature: Nature
  reason: Reason
  scope: Scope
  note: string
}

// ── Dimension 3, axis B: COHESION ────────────────────────────────────────────
// A bundle that relocates as one; internal order preserved.
export interface Cohesion {
  with: TaskTypeId
  nature: Nature
  reason: Reason
  note: string
}

export interface TaskType {
  id: TaskTypeId
  label: string
  trade: string
  layer: Layer
  instancing: Instancing
  appliesTo: ZoneKind[] // which zone kinds instantiate this (per_zone); informational for per_floor/building
  seq: SeqEdge[]
  cohesion?: Cohesion[]
  // ── construction semantics (the civil-engineer layer; not raw sheet rows, derived from
  //    reason/notes). Essential for the classifier and for self-explaining messages. ──
  conceals?: TaskTypeId[]      // surfaces/elements I cover up (plaster conceals conduit)
  concealedBy?: TaskTypeId[]   // who covers me
  hosts?: TaskTypeId[]         // frame hosts shutter; rough-in hosts fitting
  hostedBy?: TaskTypeId[]
  isGateway?: boolean          // blockwork: opens the floor — services fan out after it
  longLead?: boolean           // lift mechanism: start procurement early
  freedomSet?: FreedomSetId    // positively-asserted interchangeability
}

// ── Dimension 5: FREEDOM SETS ────────────────────────────────────────────────
// Positively-asserted interchangeable tasks, bounded between a hard-earliest and hard-latest
// anchor (both reference existing task-type ids). Membership = confident freedom, not residual.
export interface FreedomSet {
  id: FreedomSetId
  label: string
  members: TaskTypeId[]
  earliestAfter: TaskTypeId | null   // hard-earliest anchor (e.g. 'blockwork')
  latestBefore: TaskTypeId | null    // hard-latest anchor  (e.g. 'plaster')
  scope: 'per_zone' | 'per_floor' | 'building_wide'
  note: string
}

export interface Library {
  taskTypes: Map<TaskTypeId, TaskType>
  freedomSets: Map<FreedomSetId, FreedomSet>
}

// ── Building geometry (instantiator input) ───────────────────────────────────
// A normalized, zone-kinded view of a building. `stackToGeometry()` (instantiate.ts) derives
// this from the real projects.construction_stack so the engine stays geometry-general and the
// golden tests can pass an explicit geometry.
export interface GZone {
  id: string            // unique within the building, e.g. "GF-UnitA-wet"
  kind: ZoneKind
  floorLabel: string
  unitLabel: string | null
}
export interface GFloor {
  label: string
  index: number         // 0 = bottom-most structural level; +1 per level upward
  zones: GZone[]
}
export interface BuildingGeometry {
  floors: GFloor[]      // ordered bottom → top
  hasLift?: boolean
  hasCommonAreas?: boolean
  hasExternalWorks?: boolean
  commonSystems?: Set<string>   // opt-in common-area task-type ids enabled for this project (ca_*)
  suppressedTasks?: Set<string> // task-type ids marked 'not applicable' for this project (not instantiated)
}

// ── Concrete graph (instantiator output) ─────────────────────────────────────
export type NodeId = string

export interface TaskNode {
  id: NodeId            // `${taskTypeId}@${floorLabel}#${zoneId}` | `${id}@${floor}` | `${id}`
  taskTypeId: TaskTypeId
  label: string
  trade: string
  layer: Layer
  floorLabel: string | null
  floorIndex: number | null
  unitLabel: string | null
  zoneId: string | null
  zoneKind: ZoneKind | null
  seqNo: number         // assigned by topo sort
  placementSource: 'authored' | 'classified'
  source: 'generated' | 'manual'
  needsReview?: boolean
}

export interface ConcreteEdge {
  from: NodeId          // predecessor
  to: NodeId            // follower
  nature: Nature
  reason: Reason
  note: string
}

export interface Bundle {
  members: NodeId[]
  nature: Nature
  reason: Reason
}

export interface ConcreteGraph {
  nodes: Map<NodeId, TaskNode>
  edges: ConcreteEdge[]            // predecessor → follower
  bundles: Bundle[]
  seqNoByNode: Map<NodeId, number>
}

// ── Live state + evaluation outputs (evaluate.ts) ────────────────────────────
export type TaskStatus = 'not_started' | 'active' | 'done'
export type Availability = 'done' | 'active' | 'available' | 'blocked'

/** Map of NodeId → current status. Absent = not_started. */
export type CompletionState = Map<NodeId, TaskStatus>

export type ExecutionPolicy = 'structure_first' | 'floor_complete' | 'watertight_first' | 'own_practice'

export interface Blocker {
  node: NodeId
  taskTypeId: TaskTypeId
  nature: Nature
  reason: Reason
  note: string
}

export interface FreedomSpan {
  fullyFree: boolean                 // in a freedom set whose set-level constraints are met
  earliestAfterDone: boolean         // all hard predecessors done
  latestBefore: NodeId[]             // hard dependents that cap the latest position
  freedomSet: FreedomSetId | null
}

export type MoveVerdict = 'allow' | 'suggest' | 'warn' | 'allow_with_consequence' | 'forbid'

export interface MoveResult {
  verdict: MoveVerdict
  reason: Reason | null
  nature: Nature | null
  message: string
  movesBundle: NodeId[]              // cohesion bundle that relocates with the node (incl. self)
}

// ── VIEW-MODEL (the engine→UI contract; buildProjectVM in viewModel.ts) ───────
// The engine emits this fully-computed, serializable shape and the UI renders it WITHOUT
// recomputing anything about availability, ordering, or "why". One engine, one source of truth.
export interface VmWhy { afterLabel: string; reason: Reason }

// A hard predecessor / dependent of a task, supplied so a THIN client-side drag-legality check can
// render the engine's verdict from engine data — NOT a reimplemented ruleset. The natures/reasons
// are the engine's; the UI only maps them to a colour + phrasing.
export interface VmEdge { nodeKey: NodeId; taskType: TaskTypeId; label: string; nature: Nature; reason: Reason }

export interface TaskVM {
  nodeKey: NodeId            // stable id: `${taskType}@${floor}` or `${taskType}@${floor}/${unit}`
  taskType: TaskTypeId
  label: string
  trade: string
  layer: Layer
  status: Availability       // done | active | available | blocked
  seqNo: number              // from topo sort — the canonical order
  why?: VmWhy[]              // present iff blocked; most-severe first
  freedomSet?: FreedomSetId  // set id if member → the "parallel / any order" tag
  placementSource: 'authored' | 'classified'
  needsReview?: boolean
  hardPreds: VmEdge[]        // engine-supplied; for the thin drag-legality renderer (no UI ruleset)
  hardDeps: VmEdge[]
}

export interface BlockVM {
  zoneId: string             // the unit/zone grouping key
  name: string               // 'Unit A' / 'Whole floor'
  kind: ZoneKind
  tasks: TaskVM[]            // already in seqNo order; UI may reorder for DISPLAY only
  layerPct: { structure: number; services: number; finishes: number }
  overallPct: number
  stage: { label: string; key: 'structure' | 'services' | 'finishes' | 'done' }
}

export interface FloorVM {
  id: string                 // derived from the floor label ('G','1','2'…)
  name: string
  index: number              // bottom-up order, for the rising timeline
  pc: number                 // floor overall %
  fills: [ 'struct' | 'serv' | 'fin' | 'done', number ][]  // timeline column segments
  blocks: BlockVM[]
}

export interface ProjectVM {
  projectId: string
  name: string
  floors: FloorVM[]
  overallPct: number
  generatedAt: string
  dryRun: boolean            // true = computed, not persisted
}
