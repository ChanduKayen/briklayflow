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
// 'terrace' is the roof's own kind. No per_zone task claims it (nobody tiles a bathroom on the roof), so
// giving the terrace a zone of this kind adds a PLACE without adding a single flat's worth of work.
export type ZoneKind = 'dry' | 'wet' | 'balcony' | 'common' | 'external' | 'shaft' | 'terrace'

/**
 * What KIND of level this is. A per_floor task declares which kinds it occupies (TaskType.floors).
 * 'stage' is the odd one: it is NOT a level of the building at all, but the view-model's stand-in for a
 * synthetic stage (Site & foundation / Exterior & handover / Amenities). stackToGeometry never produces one,
 * so per_floor work can never instantiate onto it — which is precisely why it is spelled out rather than
 * borrowed from 'habitable'.
 */
export type FloorKind = 'parking' | 'habitable' | 'terrace' | 'stage'

// How a task type is instanced onto building geometry (see instantiate.ts):
//   per_zone  — one node per matching zone (default; services + finishes)
//   per_floor — one node per structural floor, zone-agnostic (columns/beams/slab/blockwork)
//   sited     — a SINGLE node, but placed ON a named level (the DG on the stilt, the OHT on the roof)
//   building  — a single shared node for the whole building (foundation/facade/site dev/commissioning)
//
// `sited` exists because an amenity has a PLACE. A generator is one task, but it is one task *on the
// stilt* — and a supervisor says "generator foundation is done at the stilt". Modelled as `building` it
// had no floor at all, so it sorted next to the excavation and could not be reported against a level.
export type Instancing = 'per_zone' | 'per_floor' | 'sited' | 'building'

// ── AMENITY SYSTEMS ──────────────────────────────────────────────────────────
// An amenity is a SYSTEM, not a task. A lift is a shaft that rises through every floor, a landing door
// AT every floor, a machine room, a mechanism, and a commissioning/licence step. Modelled as one
// `building` atom (as all 14 ca_* types were until 2026-07-13) none of that is trackable: there is no
// row for "lift landing door, 3rd floor", so nobody can report it and the system shows no progress
// until someone flips the whole thing done.
//
// So a system EXPANDS into several task types, each with the instancing its component actually has:
//   · sited     — the plant itself, on its level (DG, transformer, sump, STP, OHT, solar)
//   · per_floor — the part that repeats at every level (lift door, riser drop, stair flight, corridor)
//   · building  — commissioning / licence, once, near handover
//
// `SystemId` doubles as the project's OPT-IN key (projects.common_systems), so the ids are unchanged
// and existing rows in that column keep working — one system id now enables several task types.
export type SystemId = string

export type TaskTypeId = string
export type FreedomSetId = string

// ── TRADE PHASE ──────────────────────────────────────────────────────────────
// An electrician passes over the same wall three times, and a plumber four. The pass is not part of the
// task's NAME — it is a property of it. It used to be glued into the label ("Electrical — wire pulling
// (2nd fix)"), which read like noise in a list where every second row carried a parenthetical.
//
// Split out, it becomes a chip beside the name, and it stays load-bearing where it must: the resolver
// still sees the qualified form ("Electrical — wire pulling (2nd fix)"), because "second fix is done" is
// a thing a supervisor actually says and it has to land on the right row.
//
// NOTE it is NOT the `phase` column on site_tasks — that one holds the LAYER (structure/services/
// finishes). This persists to `site_tasks.trade_phase`.
export type TradePhase = '1st fix' | '2nd fix' | 'final fix'

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

// ── QUALITY CONTROL (authored per TYPE, 2026-07-11) ──────────────────────────
// A QC check is a CHECKABLE FACT about this kind of work — never vague praise ("looks good" answers
// nothing). Exactly 3 per authored type, exactly 1 critical (the DB's site_task_qc_one_critical partial
// unique index is the hard backstop; validateLibrary is the soft one).
//
// WHY IT LIVES HERE, not in a generation step: QC used to be produced by an LLM enrich pass fired from a
// browser page-visit, which meant a task's checks existed only if a human happened to open the right page
// at the right moment — and any task created afterwards (by the engine, or by the WhatsApp materializer
// mid-conversation) had none, forever. A property of a task TYPE belongs with the task type, next to its
// constraint edges. Authored here, coverage is structural: a type without checks fails the validator.
//
// PHRASED FOR A PHOTO where the work allows it. These checks are what the vision pass grades a site photo
// against — "are the cover blocks under the slab steel?" is answerable from a picture; "was the concrete
// mix design approved?" is not. The photo-answerable check is the one that earns its place.
export interface QcCheck {
  question: string
  is_critical: boolean
}

/** A task type's 3-point brief, per language. Authored in briefs.ts; see the note there on Telugu. */
export interface Brief {
  en: string[]
  te: string[]
}

/** The languages a brief is authored in. Telugu is the default on site; English is the fallback. */
export type BriefLang = 'te' | 'en'

export interface TaskType {
  id: TaskTypeId
  label: string
  trade: string
  layer: Layer
  /** The 3 authored QC checks (1 critical). Absent only on user-classified tasks, which have no
   *  authored type — an honest gap, not a silent one (they carry no checks and claim none). */
  qc?: QcCheck[]
  /** The 3-point brief: what this IS, what goes wrong, when it's really done. Shown BEFORE the task
   *  starts, where a checklist would be useless — you cannot tick a check on work nobody has done.
   *  The checks then take over from in-progress onwards. See briefs.ts. */
  brief?: Brief
  instancing: Instancing
  /** The trade pass this is ('2nd fix'). Rendered as a chip, never glued into the label. */
  phase?: TradePhase
  /** THE WORDS A SITE ACTUALLY USES FOR THIS. Shown to the resolver on the candidate line, so a supervisor's
   *  own word reaches the task it names.
   *
   *  LIVE (2026-07-13): he said "electrical గాడులు" — electrical CHASES. The word "chases" appears in exactly
   *  ONE label in this library, and it is the PLUMBING one ("Plumbing — in-wall lines (chases & sleeves)").
   *  The engine's own comment on `conduit` says it is "chased INTO brick" — we knew the word; we had simply
   *  never put it anywhere the matcher could see it. So the model matched the only label that carried it.
   *
   *  Authored ONLY where a real collision has been observed. A wrong alias does not merely fail to help — it
   *  drags a message onto the wrong task, which is the bug this exists to prevent. */
  saidAs?: string[]
  appliesTo: ZoneKind[] // which zone kinds instantiate this (per_zone); informational for per_floor/building
  /**
   * WHICH LEVELS a per_floor task occupies. Absent → the building's occupied levels (parking + habitable)
   * and NOT the terrace — because the terrace slab IS the top floor's pour, and a frame that instantiated
   * itself on the roof would pour it twice. A task that genuinely belongs up there says so:
   * the staircase headroom, the lift machine room, the tank, the panels.
   */
  floors?: FloorKind[]
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
  /** The amenity system this type is a component of. Doubles as the project's opt-in key: the type
   *  instantiates only when projects.common_systems contains this id. Absent → core building work,
   *  always instantiated. */
  system?: SystemId
  /** For `sited` types: where the plant goes when the project hasn't said. 'lowest' = the stilt/cellar
   *  if there is one, else the ground floor. 'top' = the roof-most level. */
  sitedDefault?: 'lowest' | 'top'
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
// A ZONE IS A UNIT — one flat, or the parking deck / common area of a level. It is NOT a room.
//
// It carries the SET of room-kinds inside it (a flat has dry rooms, a wet room and a balcony), and a
// per_zone task instantiates once per zone whose kinds intersect the type's `appliesTo`. That keeps
// `appliesTo: ['wet']` meaningful — waterproofing lands on flats, never on the parking deck — without
// splitting a flat into three tasks named identically.
//
// The unit is the atom because it is what the site talks in ("wiring's done in 2B"). A room-level task
// graph would need room-level geometry, which construction_stack does not carry — inventing it produced
// three indistinguishable "Electrical — conduiting" rows per flat, and a which_item ask nobody could
// answer. See __tests__/identity.test.ts.
export interface GZone {
  id: string            // === the VM fold key's zone half, e.g. "Ground/UnitA" (or "Ground/unit")
  kind: ZoneKind        // the REPRESENTATIVE kind (display/block colour): 'dry' for a flat, 'common' for a deck
  kinds: ZoneKind[]     // every room-kind present inside — what `appliesTo` is matched against
  floorLabel: string
  unitLabel: string | null
}
export interface GFloor {
  label: string
  index: number         // 0 = bottom-most structural level; +1 per level upward
  zones: GZone[]
  kind: FloorKind       // parking deck / habitable floor / the terrace on top
}
export interface BuildingGeometry {
  floors: GFloor[]      // ordered bottom → top
  hasCommonAreas?: boolean
  /** Façade, site grading and site development. DEFAULTS TRUE — every building has an outside. It used
   *  to default false AND be wired to has_common_areas at every call site, so a project with no
   *  amenities silently got no façade plaster, no façade paint and no site development. A project that
   *  genuinely has none uses `suppressedTasks`, the mechanism that already exists for exactly this. */
  hasExternalWorks?: boolean
  commonSystems?: Set<SystemId> // opt-in amenity SYSTEMS enabled for this project (projects.common_systems)
  /** system id → the floor label its `sited` plant sits on. Absent → the type's `sitedDefault`. */
  sitedLevels?: Map<SystemId, string>
  suppressedTasks?: Set<string> // task-type ids marked 'not applicable' for this project (not instantiated)
  /** node_keys a human DELETED from this project's plan (projects.suppressed_nodes). One task, not a
   *  whole type — deleting the First floor's slab must leave every other floor's slab standing. Not
   *  instantiated, so their edges vanish with them and dependents reflow. */
  suppressedNodes?: Set<string>
}

// ── Concrete graph (instantiator output) ─────────────────────────────────────
export type NodeId = string

export interface TaskNode {
  id: NodeId            // `${taskTypeId}@${floorLabel}/${unitKey}` | `${id}@${floor}` | `${id}`
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
  system?: SystemId     // the amenity system this node belongs to (absent → core building work)
  phase?: TradePhase    // the trade pass ('2nd fix') — a chip, not part of the name
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
  phase?: TradePhase         // '2nd fix' — rendered as a chip beside the label
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
  /** The SAME task rows the floors carry, re-indexed by amenity system. Not a second task tree — a
   *  second grouping. A lift's shaft rises through every floor's Common block AND reads here as one
   *  system, end to end: shaft ×N → mechanism → landing doors ×N → commissioning. */
  amenities: AmenityVM[]
}

export interface AmenityVM {
  system: SystemId           // 'ca_lift' — also the project's opt-in key
  label: string              // 'Lift'
  pc: number                 // done / total across every component, every floor
  tasks: (TaskVM & { floorLabel: string | null })[]   // in build order; floor-tagged, since many repeat
}
