// MODULE 1 — THE CONSTRAINT LIBRARY (authored, building-agnostic).
//
// The canonical task-types and their RELATIVE constraints, transcribed faithfully from
// constraint_model_schema.xlsx (Constraints + Freedom Sets sheets). Edges are authored on the
// FOLLOWER (`seq[].pred` precedes me); the instantiator derives reverse adjacency. Every row of
// the Constraints sheet appears below tagged with its row number (R3…R39).
//
// AUTHORING DISCIPLINE (per the build prompt's guardrails):
//   · Do NOT "improve" an authored nature/reason. Where the sheet looks debatable, a FOUNDER
//     RED-PEN comment flags it; the value is left as authored.
//   · Construction-semantic fields (conceals/concealedBy/hosts/hostedBy/isGateway/longLead) are
//     NOT raw sheet rows — they are derived from the reason/notes and are essential for M4.
//
// Validators + a frozen snapshot live in ./library and __tests__/library.test.ts.

import type {
  TaskType, FreedomSet, Library, Scope, TaskTypeId,
} from './types'

// ── scope helpers (terse authoring) ──────────────────────────────────────────
const SZ: Scope = { kind: 'same_zone' }
const SF: Scope = { kind: 'same_floor' }
const BW: Scope = { kind: 'building_wide' }
const EX: Scope = { kind: 'external' }
const CF = (delta: number): Scope => ({ kind: 'cross_floor', delta })

// The authored task-types. Order here is only authoring convenience; the instantiator's topo
// sort decides real sequence. Edges reference ids defined elsewhere in this same array — the
// validator proves every reference resolves and the authored graph is acyclic.
const TASK_TYPES: TaskType[] = [
  // ════════ FOUNDATION / GROUNDWORK (substructure) — building singletons, the FIRST stage ════════
  // The master-dependency chain: clear → dig → footings → plinth → mass concrete. All building-wide
  // singletons (one per building), run strictly in order BEFORE any superstructure. The whole frame
  // (GF columns onward) hangs off `foundation`, the final pour, via the columns→foundation edge (R6).
  {
    id: 'ground_clearance', label: 'Ground clearance', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [], // the master start — site work precedes it (out of scope)
  },
  {
    id: 'excavation', label: 'Excavation', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'ground_clearance', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'clear the site before digging' }],
  },
  {
    id: 'pcc_bed', label: 'PCC bed (footing base)', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'excavation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'lean-concrete bed in the dug pit' }],
  },
  {
    id: 'footing', label: 'Footings', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'pcc_bed', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'footing cast on the PCC bed' }],
  },
  {
    id: 'footing_column', label: 'Footing columns (to plinth)', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'footing', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'starter columns rise from the footings to plinth' }],
  },
  {
    id: 'backfill', label: 'Backfilling & compaction', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'footing_column', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'backfill around the footings and compact' }],
  },
  {
    id: 'plinth_beam', label: 'Plinth beams', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'backfill', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'plinth beams tie the columns at plinth level' }],
  },
  {
    id: 'plinth_fill', label: 'Plinth filling & compaction', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'plinth_beam', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'fill and compact inside the plinth' }],
  },
  {
    id: 'foundation', label: 'Foundation', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'plinth_fill', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'mass-concrete / anti-termite bed — substructure complete' }],
  },
  {
    id: 'columns', label: 'Columns', trade: 'civil', layer: 'structure',
    instancing: 'per_floor', appliesTo: [],
    seq: [
      // R6 Foundation → Columns(GF). Scope same-zone in sheet; foundation is a building singleton,
      // so this links every columns node to it. Harmless on upper floors (already gated via the
      // slab chain below) and truthful: all columns ultimately rest on the foundation.
      { pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'GF anchors to foundation' },
      // R5 Slab(floor) → Columns(floor+1): my columns need the deck below to stand on.
      { pred: 'slab', nature: 'IMPOSSIBLE', reason: 'structural', scope: CF(-1), note: 'deck to stand on' },
    ],
  },
  {
    id: 'beams', label: 'Beams', trade: 'civil', layer: 'structure',
    instancing: 'per_floor', appliesTo: [],
    seq: [
      { pred: 'columns', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'no beam without column' }, // R3
    ],
  },
  {
    id: 'slab', label: 'Slab', trade: 'civil', layer: 'structure',
    instancing: 'per_floor', appliesTo: [],
    seq: [
      { pred: 'beams', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'slab rests on beams' }, // R4
    ],
    conceals: [], // structural; concealment handled by finishes
  },
  {
    id: 'shuttering_removal', label: 'Shuttering removal (de-prop)', trade: 'civil', layer: 'structure',
    instancing: 'per_floor', appliesTo: [],
    seq: [
      // R7 Slab → Shuttering-removal. Sheet nature = "CURING-WAIT": encoded DESTRUCTIVE +
      // reason curing_time (de-propping green concrete ruins the slab; it is a TIME gate).
      { pred: 'slab', nature: 'DESTRUCTIVE', reason: 'curing_time', scope: SF, note: 'cure before de-prop (~time, not a trade)' },
    ],
  },
  {
    id: 'blockwork', label: 'Blockwork (walls)', trade: 'masonry', layer: 'structure',
    instancing: 'per_floor', appliesTo: [],
    isGateway: true, // once a floor's walls are up, the whole services freedom-set fans out
    seq: [
      { pred: 'slab', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'walls need the deck' }, // R9
      // R8 Shuttering-removal → Blockwork: "no work under a propped slab" (FLAG-1, FOUNDER-RULED).
      // A slab's props stand on the floor BELOW it, so while slab@(F+1) is propped/curing those
      // props occupy floor F — you cannot raise blockwork on floor F until the slab ABOVE is
      // de-propped. So blockwork@F is gated by shuttering_removal@(F+1): cross_floor delta +1.
      // Consequence (intended): the frame races UP, then blockwork follows floor-by-floor as props
      // come down — NOT interleaved per floor. The TOP occupied floor's blockwork is gated by the
      // terrace slab's de-prop, or by nothing if it is the topmost (the +1 edge simply drops).
      // It is NEVER gated by its OWN-floor deshutter.
      { pred: 'shuttering_removal', nature: 'DESTRUCTIVE', reason: 'structural', scope: CF(+1), note: 'no work under a propped slab — the slab ABOVE must be de-propped' },
    ],
  },

  // ════════ SERVICES (muscle) — per_zone unless noted ════════
  {
    id: 'conduit', label: 'Electrical conduiting', trade: 'electrical', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'muscle_followers',
    hosts: ['wiring', 'switchboard'],
    concealedBy: ['plaster'],
    seq: [
      { pred: 'blockwork', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'conduit chased INTO brick' }, // R10
    ],
  },
  {
    id: 'in_wall_plumbing', label: 'In-wall plumbing', trade: 'plumbing', layer: 'services',
    instancing: 'per_zone', appliesTo: ['wet', 'balcony', 'common'],
    freedomSet: 'muscle_followers',
    concealedBy: ['plaster'],
    // FOUNDER RED-PEN: the sheet carries both "In-wall plumbing" (R11/R15) and "Plumbing rough"
    // (R17/R31/R35). They overlap heavily in Indian practice (concealed pipe = rough-in). Encoded
    // as DISTINCT task-types per the sheet, not merged — flag for review, do not "improve".
    seq: [
      { pred: 'blockwork', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'pipe runs in brick' }, // R11
    ],
  },
  {
    id: 'plumb_rough', label: 'Plumbing rough-in', trade: 'plumbing', layer: 'services',
    instancing: 'per_zone', appliesTo: ['wet', 'balcony'],
    hosts: ['sanitary'],
    cohesion: [
      { with: 'pressure_test', nature: 'STRONG_PREF', reason: 'quality', note: 'test meaningless detached from rough' }, // R35
    ],
    // FOUNDER RED-PEN (engine-flagged gap): the sheet gave plumb_rough no predecessor, so it floated
    // to the very start of Services (before walls). Rough-in pipes are chased into the masonry / laid
    // against walls — like in-wall plumbing, it follows blockwork. Added:
    seq: [
      { pred: 'blockwork', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'rough-in chased into / against the walls' },
    ],
  },
  {
    id: 'pressure_test', label: 'Pressure test', trade: 'plumbing', layer: 'services',
    instancing: 'per_zone', appliesTo: ['wet', 'balcony'],
    seq: [
      { pred: 'plumb_rough', nature: 'STRONG_PREF', reason: 'quality', scope: SZ, note: 'test before concealing — catch leaks' }, // R17
    ],
  },
  {
    id: 'wiring', label: 'Wiring (wire pulling)', trade: 'electrical', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    hostedBy: ['conduit'],
    seq: [
      { pred: 'conduit', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'wire needs conduit' }, // R16
    ],
  },
  {
    id: 'switchboard', label: 'Switchboards / DB', trade: 'electrical', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'common'],
    hostedBy: ['conduit'],
    seq: [
      { pred: 'conduit', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'board needs its wiring' }, // R30
    ],
  },
  {
    id: 'door_frame', label: 'Door frames', trade: 'carpentry', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'muscle_followers',
    hosts: ['door_shutter'],
    seq: [
      // R12 promoted STRONG_PREF→IMPOSSIBLE (engine-flagged, FOUNDER-RULED): a door frame seats
      // INTO the masonry reveal — there is nothing to fix it to before the wall opening exists, so
      // it is impossible (not merely inadvisable) before blockwork. REVERT to STRONG_PREF only if
      // your sites set frames first with fixing lugs and build masonry around them.
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'frame seats into the masonry opening — needs the wall' },
      { pred: 'conduit', nature: 'WEAK_PREF', reason: 'logistics', scope: SZ, note: 'either order works' }, // R19 (conduit→frames)
    ],
  },
  {
    id: 'window_frame', label: 'Window frames', trade: 'carpentry', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'muscle_followers',
    seq: [
      // R13 promoted STRONG_PREF→IMPOSSIBLE for the same reason as door frames: the jamb seats into
      // the masonry opening and cannot precede the wall. Applied for consistency with door_frame;
      // REVERT to STRONG_PREF if windows are set first with lugs. (engine-flagged, FOUNDER-RULED)
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'jamb seats into the masonry opening — needs the wall' },
      { pred: 'conduit', nature: 'WEAK_PREF', reason: 'logistics', scope: SZ, note: 'either order works' }, // R19
    ],
  },
  {
    id: 'ceiling_frame', label: 'False-ceiling frame', trade: 'ceiling', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    hosts: ['overhead_service'],
    // FOUNDER RED-PEN (engine-flagged gap): the sheet authored NO predecessor, so the engine
    // honestly reported "available before walls exist". A false ceiling hangs from the slab soffit
    // and its perimeter channel anchors to the walls — it cannot exist before the floor's
    // structure, and not meaningfully before blockwork. Two edges added:
    seq: [
      { pred: 'slab', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'false ceiling hangs from the slab soffit' },
      { pred: 'blockwork', nature: 'DESTRUCTIVE', reason: 'logistics', scope: SZ, note: 'perimeter channel anchors to the walls — framing before walls means redoing the perimeter' },
    ],
  },
  {
    id: 'overhead_service', label: 'Overhead services (in ceiling void)', trade: 'mep', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    freedomSet: 'overhead_void',
    hostedBy: ['ceiling_frame'],
    concealedBy: ['ceiling_board'],
    seq: [
      { pred: 'ceiling_frame', nature: 'STRONG_PREF', reason: 'logistics', scope: SZ, note: 'service hung on frame' }, // R27
    ],
  },
  {
    id: 'void_wiring', label: 'Ceiling void-wiring', trade: 'electrical', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    freedomSet: 'overhead_void',
    concealedBy: ['pop_finish'],
    cohesion: [
      { with: 'pop_finish', nature: 'DESTRUCTIVE', reason: 'concealment', note: 'POP conceals wiring → move together' }, // R34
    ],
    // FOUNDER RED-PEN (engine-flagged gap): authored with no predecessor, so it floated to the top of
    // Services. Wiring run in the ceiling void belongs with the overhead_void set, after the frame
    // that forms the void. Added as a soft order anchor (it can be partly pre-run, so not hard):
    seq: [
      { pred: 'ceiling_frame', nature: 'STRONG_PREF', reason: 'logistics', scope: SZ, note: 'run in the ceiling void the frame forms' },
    ],
  },

  // ════════ FINISHES (skin) — per_zone unless noted ════════
  {
    id: 'plaster', label: 'Plastering', trade: 'plaster', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    conceals: ['conduit', 'in_wall_plumbing', 'pressure_test'],
    hosts: ['switchplate'],
    seq: [
      { pred: 'conduit', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'plaster hides conduit; un-cover to fix' }, // R14
      { pred: 'in_wall_plumbing', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'pipe concealed by plaster' }, // R15
      // R18 Pressure-test → Conceal(floor): the sheet's generic "Conceal" is realized here as
      // plaster (the concealing finish over in-wall lines). §8 domain rule: never bury an
      // untested pipe. Where pressure_test exists in a zone, it precedes that zone's plaster.
      { pred: 'pressure_test', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'never conceal an untested line (R18)' },
    ],
  },
  {
    id: 'waterproof', label: 'Waterproofing', trade: 'waterproofing', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['wet', 'balcony'],
    concealedBy: ['screed', 'floor_tile'],
    cohesion: [
      { with: 'screed', nature: 'DESTRUCTIVE', reason: 'concealment', note: 'stacked covers move as one' }, // R36
    ],
    seq: [],
  },
  {
    id: 'screed', label: 'Screed / leveling', trade: 'flooring', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    conceals: ['waterproof'],
    concealedBy: ['floor_tile'],
    seq: [
      { pred: 'waterproof', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'screed covers WP' }, // R20
    ],
  },
  {
    id: 'floor_tile', label: 'Floor tiling', trade: 'tiling', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    conceals: ['screed', 'waterproof'],
    seq: [
      { pred: 'screed', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'tile over screed' }, // R21
      { pred: 'waterproof', nature: 'DESTRUCTIVE', reason: 'quality', scope: SZ, note: 'WP must underlie wet floor' }, // R22
    ],
  },
  {
    id: 'wall_tile', label: 'Wall tiling / dado', trade: 'tiling', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['wet'],
    seq: [
      { pred: 'plaster', nature: 'STRONG_PREF', reason: 'quality', scope: SZ, note: 'tile backing' }, // R24
    ],
  },
  {
    id: 'paint', label: 'Painting', trade: 'painting', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'room_finishing',
    seq: [
      { pred: 'plaster', nature: 'DESTRUCTIVE', reason: 'quality', scope: SZ, note: 'paint needs plastered surface' }, // R23
      { pred: 'floor_tile', nature: 'WEAK_PREF', reason: 'quality', scope: SZ, note: 'or paint-then-floor; protect either way' }, // R26
    ],
  },
  {
    id: 'switchplate', label: 'Switchplates / faceplates', trade: 'electrical', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'common'],
    freedomSet: 'skin_fittings',
    hostedBy: ['plaster'],
    seq: [
      { pred: 'plaster', nature: 'STRONG_PREF', reason: 'logistics', scope: SZ, note: 'mount on finished wall' }, // R25
    ],
  },
  {
    id: 'ceiling_board', label: 'Ceiling boarding', trade: 'ceiling', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    conceals: ['overhead_service'],
    seq: [
      { pred: 'overhead_service', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'board seals the void' }, // R28
    ],
  },
  {
    id: 'pop_finish', label: 'POP / ceiling finish', trade: 'ceiling', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    conceals: ['void_wiring'],
    seq: [
      { pred: 'ceiling_board', nature: 'STRONG_PREF', reason: 'quality', scope: SZ, note: 'finish over board' }, // R29
    ],
  },
  {
    id: 'sanitary', label: 'Sanitaryware / fittings', trade: 'plumbing', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['wet'],
    freedomSet: 'skin_fittings',
    hostedBy: ['plumb_rough'],
    seq: [
      { pred: 'plumb_rough', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'fittings need rough-in' }, // R31
      { pred: 'wall_tile', nature: 'STRONG_PREF', reason: 'quality', scope: SZ, note: 'fittings on tiled wall' }, // R33
    ],
  },
  {
    id: 'door_shutter', label: 'Door shutters', trade: 'carpentry', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'skin_fittings',
    hostedBy: ['door_frame'],
    seq: [
      { pred: 'door_frame', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'shutter hangs on frame' }, // R32
    ],
  },

  // ════════ COMMON / EXTERNAL / LONG-LEAD — building / external ════════
  {
    id: 'external_structure', label: 'External / façade structure', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: ['external'],
    seq: [],
  },
  {
    id: 'facade_plaster', label: 'Façade plaster', trade: 'plaster', layer: 'finishes',
    instancing: 'building', appliesTo: ['external'],
    freedomSet: 'common_stream',
    seq: [
      { pred: 'external_structure', nature: 'STRONG_PREF', reason: 'logistics', scope: BW, note: 'scaffolding / access' }, // R37
    ],
  },
  {
    id: 'lift_shaft', label: 'Lift-shaft structure', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: ['shaft'],
    seq: [],
  },
  {
    id: 'lift_mechanism', label: 'Lift mechanism', trade: 'lift', layer: 'services',
    instancing: 'building', appliesTo: ['shaft'],
    longLead: true, // start procurement early though install is late
    seq: [
      { pred: 'lift_shaft', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'LONG-LEAD: start early' }, // R38
    ],
  },
  {
    id: 'site_grade', label: 'Site grading', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: ['external'],
    seq: [],
  },
  {
    id: 'site_development', label: 'Site development', trade: 'civil', layer: 'finishes',
    instancing: 'building', appliesTo: ['external'],
    freedomSet: 'common_stream',
    seq: [
      { pred: 'site_grade', nature: 'STRONG_PREF', reason: 'logistics', scope: EX, note: 'near handover' }, // R39
    ],
  },

  // ════════ COMMON AREAS / AMENITIES — building singletons, OPT-IN per project ════════
  // Each is gated by the project's enabled common-systems set (instantiate.buildingTypeEnabled): a
  // `ca_*` node only instantiates when the project ticked it. All sit on the substructure (after
  // `foundation`), run parallel to each other and to the unit work, and surface as one "Common areas"
  // stage in the timeline. Anchors are deliberately light — these are managed as a parallel stream.
  { id: 'ca_parking', label: 'Parking deck & markings', trade: 'civil', layer: 'structure', instancing: 'building', appliesTo: [], seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'built on the substructure' }] },
  { id: 'ca_stair', label: 'Common staircase', trade: 'civil', layer: 'structure', instancing: 'building', appliesTo: [], seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'rises from the substructure' }] },
  { id: 'ca_ugt', label: 'Underground sump / tank', trade: 'civil', layer: 'structure', instancing: 'building', appliesTo: [], seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'cast with the substructure' }] },
  { id: 'ca_stp', label: 'Sewage treatment plant (STP)', trade: 'civil', layer: 'structure', instancing: 'building', appliesTo: [], seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'below-grade plant' }] },
  { id: 'ca_compound', label: 'Compound wall & gate', trade: 'civil', layer: 'structure', instancing: 'building', appliesTo: [], seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'site boundary' }] },
  { id: 'ca_lift', label: 'Lift (shaft & cabin)', trade: 'lift', layer: 'services', instancing: 'building', appliesTo: [], longLead: true, seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'LONG-LEAD: order early' }] },
  { id: 'ca_transformer', label: 'Transformer / substation', trade: 'electrical', layer: 'services', instancing: 'building', appliesTo: [], longLead: true, seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'LONG-LEAD power infra' }] },
  { id: 'ca_generator', label: 'DG / generator set', trade: 'electrical', layer: 'services', instancing: 'building', appliesTo: [], longLead: true, seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'backup power' }] },
  { id: 'ca_oht', label: 'Overhead tank & pumps', trade: 'plumbing', layer: 'services', instancing: 'building', appliesTo: [], seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'water storage & pumping' }] },
  { id: 'ca_fire', label: 'Fire fighting (pumps, sprinklers, alarm)', trade: 'fire', layer: 'services', instancing: 'building', appliesTo: [], seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'building-wide fire system' }] },
  { id: 'ca_solar', label: 'Rooftop solar', trade: 'electrical', layer: 'services', instancing: 'building', appliesTo: [], seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'roof-mounted PV' }] },
  { id: 'ca_borewell', label: 'Borewell', trade: 'plumbing', layer: 'services', instancing: 'building', appliesTo: [], seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'water source' }] },
  { id: 'ca_corridor', label: 'Corridor & lobby finishes', trade: 'finishing', layer: 'finishes', instancing: 'building', appliesTo: [], seq: [{ pred: 'ca_stair', nature: 'STRONG_PREF', reason: 'logistics', scope: BW, note: 'finish after the common structure' }] },
  { id: 'ca_landscaping', label: 'Landscaping & hardscape', trade: 'landscaping', layer: 'finishes', instancing: 'building', appliesTo: [], seq: [{ pred: 'ca_compound', nature: 'STRONG_PREF', reason: 'logistics', scope: BW, note: 'near handover, inside the boundary' }] },
]

// ── Freedom Sets (every row of the Freedom Sets sheet; R8 [ADD] placeholder omitted) ──
const FREEDOM_SETS: FreedomSet[] = [
  {
    id: 'muscle_followers', label: 'Muscle followers of brick',
    members: ['conduit', 'in_wall_plumbing', 'door_frame', 'window_frame'], // sheet also lists ELV (no task-type yet)
    earliestAfter: 'blockwork', latestBefore: 'plaster', scope: 'per_zone',
    note: 'after blockwork → before plaster',
  },
  {
    id: 'room_finishing', label: 'Room finishing order',
    members: ['paint'], // room-by-room paint; per-floor freedom (each after its own plaster)
    earliestAfter: 'plaster', latestBefore: null, scope: 'per_floor',
    note: 'each after its own plaster → before handover',
  },
  {
    id: 'skin_fittings', label: 'Skin-phase fittings',
    members: ['switchplate', 'sanitary', 'door_shutter'], // sheet also lists light fixtures (no task-type yet)
    earliestAfter: null, latestBefore: null, scope: 'per_zone',
    note: 'after own-muscle + surface → before handover',
  },
  {
    id: 'overhead_void', label: 'Overhead services in ceiling void',
    members: ['overhead_service', 'void_wiring'],
    earliestAfter: 'ceiling_frame', latestBefore: 'ceiling_board', scope: 'per_zone',
    note: 'after ceiling frame → before board',
  },
  {
    id: 'common_stream', label: 'Common-area stream vs unit work',
    members: ['facade_plaster', 'site_development'],
    earliestAfter: null, latestBefore: null, scope: 'building_wide',
    note: 'run parallel to units; after own structure → near handover',
  },
]

// ── Canonical DISPLAY sequence (the designed construction order) ──────────────
// The hard graph fixes what's *possible*; the freedom sets say many muscle/finish trades are
// genuinely interchangeable. So a pure topo sort tie-breaks those parallel trades alphabetically —
// a valid order, but not the one a builder reads as "natural". This list is the authored default
// READING ORDER per task-type (mirrors the approved design's sequence). It is NOT a constraint — it
// only orders tasks that the hard graph leaves free. validateCanonicalSequence asserts it never
// contradicts a hard edge, so the default can never read as physically impossible.
export const CANONICAL_SEQUENCE: TaskTypeId[] = [
  // foundation / groundwork (substructure) — the first stage, building singletons
  'ground_clearance', 'excavation', 'pcc_bed', 'footing', 'footing_column', 'backfill', 'plinth_beam', 'plinth_fill', 'foundation',
  // structure (bones)
  'columns', 'beams', 'slab', 'shuttering_removal', 'blockwork',
  // services (muscle) — wall services, then ceiling-void services
  'conduit', 'in_wall_plumbing', 'plumb_rough', 'pressure_test', 'door_frame', 'window_frame',
  'wiring', 'switchboard', 'ceiling_frame', 'overhead_service', 'void_wiring',
  // finishes (skin) — plaster → wet-floor stack → tiling → ceiling finish → paint → fittings
  'plaster', 'waterproof', 'screed', 'floor_tile', 'wall_tile', 'ceiling_board', 'pop_finish',
  'paint', 'switchplate', 'sanitary', 'door_shutter',
  // common / external / long-lead
  'external_structure', 'facade_plaster', 'lift_shaft', 'lift_mechanism', 'site_grade', 'site_development',
  // common areas / amenities (opt-in per project)
  'ca_parking', 'ca_stair', 'ca_ugt', 'ca_stp', 'ca_compound', 'ca_lift', 'ca_transformer', 'ca_generator',
  'ca_oht', 'ca_fire', 'ca_solar', 'ca_borewell', 'ca_corridor', 'ca_landscaping',
]

/** Map task-type id → its canonical display rank (lower = earlier). Unknown ids → +∞. */
export function canonicalRank(lib: Library = LIBRARY): Map<TaskTypeId, number> {
  const m = new Map<TaskTypeId, number>()
  CANONICAL_SEQUENCE.forEach((id, i) => { if (lib.taskTypes.has(id)) m.set(id, i) })
  return m
}

// ── Build + freeze the Library ───────────────────────────────────────────────
export function buildLibrary(): Library {
  const taskTypes = new Map(TASK_TYPES.map((t) => [t.id, t]))
  const freedomSets = new Map(FREEDOM_SETS.map((f) => [f.id, f]))
  return { taskTypes, freedomSets }
}

/** Singleton — the library is immutable authored data. */
export const LIBRARY: Library = buildLibrary()

// ── Validators (data-integrity, run in tests + at module load in dev) ─────────
export interface ValidationIssue { kind: string; detail: string }

/**
 * Assert the authored library is internally consistent:
 *   · every SeqEdge.pred / Cohesion.with references a known task-type id
 *   · every freedom-set member + anchor references a known id
 *   · the authored graph (ignoring scope/delta) is acyclic over HARD edges
 * Returns [] when clean; never throws (callers decide).
 */
export function validateLibrary(lib: Library = LIBRARY): ValidationIssue[] {
  const issues: ValidationIssue[] = []
  const ids = lib.taskTypes

  for (const t of ids.values()) {
    for (const e of t.seq)
      if (!ids.has(e.pred)) issues.push({ kind: 'unknown_pred', detail: `${t.id}.seq → unknown '${e.pred}'` })
    for (const c of t.cohesion ?? [])
      if (!ids.has(c.with)) issues.push({ kind: 'unknown_cohesion', detail: `${t.id}.cohesion → unknown '${c.with}'` })
    for (const field of ['conceals', 'concealedBy', 'hosts', 'hostedBy'] as const)
      for (const ref of t[field] ?? [])
        if (!ids.has(ref)) issues.push({ kind: 'unknown_semantic', detail: `${t.id}.${field} → unknown '${ref}'` })
    if (t.freedomSet && !lib.freedomSets.has(t.freedomSet))
      issues.push({ kind: 'unknown_freedom_set', detail: `${t.id}.freedomSet → unknown '${t.freedomSet}'` })
  }

  for (const f of lib.freedomSets.values()) {
    for (const m of f.members)
      if (!ids.has(m)) issues.push({ kind: 'unknown_member', detail: `freedomSet ${f.id} → unknown member '${m}'` })
    for (const a of [f.earliestAfter, f.latestBefore])
      if (a && !ids.has(a)) issues.push({ kind: 'unknown_anchor', detail: `freedomSet ${f.id} → unknown anchor '${a}'` })
  }

  // Acyclicity over the abstract (scope-ignored) hard-edge graph. A cycle = authoring error.
  const cycle = findAbstractCycle(lib)
  if (cycle) issues.push({ kind: 'cycle', detail: `authored cycle: ${cycle.join(' → ')}` })

  // The canonical display sequence must cover every task-type exactly once and must NEVER place a
  // hard predecessor after its follower (else the default order would read as physically impossible).
  const rank = canonicalRank(lib)
  for (const id of ids.keys())
    if (!rank.has(id)) issues.push({ kind: 'canon_missing', detail: `task-type '${id}' not in CANONICAL_SEQUENCE` })
  const seen = new Set<TaskTypeId>()
  for (const id of CANONICAL_SEQUENCE) {
    if (seen.has(id)) issues.push({ kind: 'canon_dup', detail: `'${id}' listed twice in CANONICAL_SEQUENCE` })
    seen.add(id)
  }
  for (const t of ids.values())
    for (const e of t.seq) {
      const crossFloor = e.scope.kind === 'cross_floor' && e.scope.delta !== 0
      if (!isHardNature(e.nature, e.reason) || crossFloor) continue
      const rp = rank.get(e.pred), rf = rank.get(t.id)
      if (rp !== undefined && rf !== undefined && rp >= rf)
        issues.push({ kind: 'canon_violates_hard', detail: `CANONICAL_SEQUENCE puts '${e.pred}' at/after its hard follower '${t.id}'` })
    }

  return issues
}

/** True for edges that hard-order the topo sort: IMPOSSIBLE, DESTRUCTIVE, or any curing_time wait. */
export function isHardNature(nature: string, reason: string): boolean {
  return nature === 'IMPOSSIBLE' || nature === 'DESTRUCTIVE' || reason === 'curing_time'
}

/** DFS cycle finder over abstract pred→follower hard edges (scope ignored). Returns a cycle path or null. */
function findAbstractCycle(lib: Library): TaskTypeId[] | null {
  const WHITE = 0, GRAY = 1, BLACK = 2
  const color = new Map<TaskTypeId, number>()
  const stack: TaskTypeId[] = []
  // adjacency: pred → [followers]
  const adj = new Map<TaskTypeId, TaskTypeId[]>()
  for (const t of lib.taskTypes.values())
    for (const e of t.seq) {
      // Cross-floor edges with a non-zero delta link DIFFERENT floor instances (slab(F) →
      // columns(F+1)); they can never form a same-node cycle, so they're excluded from this
      // within-instance acyclicity proxy. The instantiator's topo sort catches concrete cycles.
      const crossFloor = e.scope.kind === 'cross_floor' && e.scope.delta !== 0
      if (isHardNature(e.nature, e.reason) && !crossFloor) {
        if (!adj.has(e.pred)) adj.set(e.pred, [])
        adj.get(e.pred)!.push(t.id)
      }
    }

  let found: TaskTypeId[] | null = null
  const visit = (n: TaskTypeId): void => {
    if (found) return
    color.set(n, GRAY); stack.push(n)
    for (const m of adj.get(n) ?? []) {
      if (found) break
      const c = color.get(m) ?? WHITE
      if (c === GRAY) { found = [...stack.slice(stack.indexOf(m)), m]; break }
      if (c === WHITE) visit(m)
    }
    stack.pop(); color.set(n, BLACK)
  }
  for (const t of lib.taskTypes.values()) if ((color.get(t.id) ?? WHITE) === WHITE) visit(t.id)
  return found
}

/** Convenience accessor — throws if id unknown (caller bug). */
export function taskType(id: TaskTypeId, lib: Library = LIBRARY): TaskType {
  const t = lib.taskTypes.get(id)
  if (!t) throw new Error(`unknown task-type '${id}'`)
  return t
}
