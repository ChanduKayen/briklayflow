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
  TaskType, FreedomSet, Library, Scope, TaskTypeId, QcCheck,
} from './types'
import { BRIEFS } from './briefs'

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
    id: 'ground_clearance', label: 'Site — ground clearance', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [], // the master start — site work precedes it (out of scope)
  },
  {
    // NEW (2026-07-11) — the legacy expander tracked "Site Marking / Setting Out" and the engine did not,
    // so a supervisor reporting "marking done" had nothing to land on. Setting out happens on cleared
    // ground and gates the dig: you cannot excavate to a grid you have not set out.
    id: 'site_marking', label: 'Site — marking / setting out', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'ground_clearance', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'set the grid out on cleared ground' }],
  },
  {
    id: 'excavation', label: 'Site — excavation', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'site_marking', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'dig to the set-out grid' }],
  },
  {
    id: 'pcc_bed', label: 'Foundation — PCC bed (footing base)', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'excavation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'lean-concrete bed in the dug pit' }],
  },
  {
    id: 'footing', label: 'Foundation — footings', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'pcc_bed', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'footing cast on the PCC bed' }],
  },
  {
    id: 'footing_column', label: 'Foundation — footing columns (to plinth)', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'footing', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'starter columns rise from the footings to plinth' }],
  },
  {
    id: 'backfill', label: 'Foundation — backfilling & compaction', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'footing_column', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'backfill around the footings and compact' }],
  },
  {
    id: 'plinth_beam', label: 'Plinth — beams', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'backfill', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'plinth beams tie the columns at plinth level' }],
  },
  {
    id: 'plinth_fill', label: 'Plinth — filling & compaction', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'plinth_beam', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'fill and compact inside the plinth' }],
  },
  {
    // NEW (2026-07-11) — the legacy expander tracked "Plinth Slab" and the engine went straight from the
    // fill to the mass-concrete bed, so the ground-floor deck itself had no task. It is cast ON the
    // compacted fill and is what the ground floor stands on.
    id: 'plinth_slab', label: 'Plinth — slab', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'plinth_fill', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'the ground-floor deck, cast on the compacted fill' }],
  },
  {
    id: 'foundation', label: 'Foundation — mass concrete', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: [],
    seq: [{ pred: 'plinth_slab', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'mass-concrete / anti-termite bed — substructure complete' }],
  },
  {
    id: 'columns', label: 'Frame — columns', trade: 'civil', layer: 'structure',
    instancing: 'per_floor', appliesTo: [],
    seq: [
      // R6 Foundation → Columns(GF). Scope same-zone in sheet; foundation is a building singleton,
      // so this links every columns node to it. Harmless on upper floors (already gated via the
      // pour chain below) and truthful: all columns ultimately rest on the foundation.
      { pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'GF anchors to foundation' },
      // R5 Pour(floor) → Columns(floor+1): my columns need the deck below to stand on.
      { pred: 'floor_pour', nature: 'IMPOSSIBLE', reason: 'structural', scope: CF(-1), note: 'deck to stand on' },
    ],
  },

  // ── THE FLOOR CYCLE (rebuilt 2026-07-11, FOUNDER-RULED "Option A") ────────────────────────────────
  // The library used to carry `beams` and `slab` as two separately-cast tasks (R3/R4: "no beam without
  // column", "slab rests on beams"). That is not how an RCC floor is built: the beams and the slab are
  // shuttered together, reinforced together, and poured MONOLITHICALLY in one pour. Two cast tasks for
  // one pour meant a supervisor's "slab poured" fit two rows and distinguished neither — and it left the
  // stages he actually reports ("shuttering done", "steel tied", "pour tomorrow") with nothing to land on.
  // Replaced by the real cycle: shutter → reinforce → pour → (cure) → de-prop.
  {
    id: 'floor_shutter', label: 'Frame — shuttering (beams & slab)', trade: 'civil', layer: 'structure',
    instancing: 'per_floor', appliesTo: [],
    seq: [
      { pred: 'columns', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'formwork spans between the cast columns' }, // was R3
    ],
  },
  {
    id: 'floor_rebar', label: 'Frame — reinforcement (beams & slab)', trade: 'civil', layer: 'structure',
    instancing: 'per_floor', appliesTo: [],
    seq: [
      { pred: 'floor_shutter', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'steel is tied into the formwork' },
    ],
  },
  {
    id: 'floor_pour', label: 'Frame — slab & beam pour', trade: 'civil', layer: 'structure',
    saidAs: ['slab', 'slab pour', 'concreting', 'casting', 'స్లాబ్'],
    instancing: 'per_floor', appliesTo: [],
    seq: [
      // The gate the whole QC story hangs off: once this is poured, everything below it is buried. A
      // missed cover block or an untied lap is permanent here — this is the moment a photo is worth most.
      { pred: 'floor_rebar', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'never pour over unfinished steel — cover blocks, laps and cages are checked HERE or never' }, // was R4
    ],
    conceals: [], // structural; concealment handled by finishes
  },
  {
    id: 'shuttering_removal', label: 'Frame — de-propping (shuttering removal)', trade: 'civil', layer: 'structure',
    saidAs: ['de-shuttering', 'de-propping', 'షట్టరింగ్ తీయడం'],
    instancing: 'per_floor', appliesTo: [],
    seq: [
      // R7 Pour → Shuttering-removal. Sheet nature = "CURING-WAIT": encoded DESTRUCTIVE +
      // reason curing_time (de-propping green concrete ruins the slab; it is a TIME gate).
      { pred: 'floor_pour', nature: 'DESTRUCTIVE', reason: 'curing_time', scope: SF, note: 'cure before de-prop (~time, not a trade)' },
    ],
  },
  {
    id: 'blockwork', label: 'Wall — blockwork', trade: 'masonry', layer: 'structure',
    saidAs: ['brick work', 'block work', 'masonry', 'గోడలు'],
    instancing: 'per_floor', appliesTo: [],
    isGateway: true, // once a floor's walls are up, the whole services freedom-set fans out
    seq: [
      { pred: 'floor_pour', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'walls need the deck' }, // R9
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
    id: 'conduit', label: 'Electrical — conduiting', phase: '1st fix', trade: 'electrical', layer: 'services',
    // THE COLLISION. A chase is a groove cut in a wall; the electrician cuts them for his conduit. The word
    // lived only on the plumbing label, so "electrical chases" matched plumbing. It lives here now too.
    saidAs: ['electrical chases', 'chases', 'grooves', 'గాడులు', 'gaadulu', 'కండ్యూట్', '1st fix', 'first fix'],
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'muscle_followers',
    hosts: ['wiring', 'switchboard'],
    concealedBy: ['plaster'],
    seq: [
      { pred: 'blockwork', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'conduit chased INTO brick' }, // R10
    ],
  },
  {
    id: 'in_wall_plumbing', label: 'Plumbing — in-wall lines (chases & sleeves)', trade: 'plumbing', layer: 'services',
    saidAs: ['plumbing chases', 'pipe chases', 'sleeves', 'ప్లంబింగ్ గాడులు', 'పైపు గాడులు'],
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
    id: 'plumb_rough', label: 'Plumbing — floor rough-in', trade: 'plumbing', layer: 'services',
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
    id: 'pressure_test', label: 'Plumbing — pressure test', trade: 'plumbing', layer: 'services',
    instancing: 'per_zone', appliesTo: ['wet', 'balcony'],
    seq: [
      { pred: 'plumb_rough', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'there is nothing to pressurise until the pipes are laid' }, // R17
    ],
  },
  {
    // NEW (2026-07-11) — the legacy expander tracked "Vertical Plumbing Risers" and the engine had only
    // the per-floor rough-in. The risers are the vertical spine every floor's rough-in ties into; a
    // supervisor reporting "risers done" had nowhere to land it.
    // PER_FLOOR since 2026-07-13. A riser is not one task: it climbs the shaft and is dropped, teed and
    // valved AT EVERY FLOOR, and that is the unit of work a plumber reports ("risers done up to third").
    // As a single `building` node the floors it passes were invisible and unreportable.
    id: 'riser', label: 'Plumbing — vertical risers', trade: 'plumbing', layer: 'services',
    saidAs: ['risers', 'vertical lines', 'shaft pipes'],
    instancing: 'per_floor', appliesTo: ['shaft', 'common'],
    seq: [
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'the shaft walls must exist on this floor before the riser is dropped through it' },
      { pred: 'riser', nature: 'IMPOSSIBLE', reason: 'structural', scope: CF(-1), note: 'a riser climbs — the floor below carries this one' },
    ],
  },
  {
    id: 'wiring', label: 'Electrical — wire pulling', phase: '2nd fix', trade: 'electrical', layer: 'services',
    saidAs: ['wiring', 'wire pulling', 'వైరింగ్', '2nd fix', 'second fix'],
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    hostedBy: ['conduit'],
    seq: [
      { pred: 'conduit', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'wire needs conduit' }, // R16
    ],
  },
  {
    id: 'switchboard', label: 'Electrical — switchboards / DB', trade: 'electrical', layer: 'services',
    saidAs: ['switchboards', 'DB', 'distribution board', 'స్విచ్ బోర్డ్'],
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'common'],
    hostedBy: ['conduit'],
    seq: [
      { pred: 'conduit', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'board needs its wiring' }, // R30
    ],
  },
  {
    id: 'door_frame', label: 'Door — frames', trade: 'carpentry', layer: 'services',
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
    id: 'window_frame', label: 'Window — frames', trade: 'carpentry', layer: 'services',
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
    id: 'ceiling_frame', label: 'Ceiling — false-ceiling frame', trade: 'ceiling', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    hosts: ['overhead_service'],
    // FOUNDER RED-PEN (engine-flagged gap): the sheet authored NO predecessor, so the engine
    // honestly reported "available before walls exist". A false ceiling hangs from the slab soffit
    // and its perimeter channel anchors to the walls — it cannot exist before the floor's
    // structure, and not meaningfully before blockwork. Two edges added:
    seq: [
      { pred: 'floor_pour', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'the ceiling hangs from the slab soffit — the floor above must be poured' },
      { pred: 'blockwork', nature: 'DESTRUCTIVE', reason: 'logistics', scope: SZ, note: 'perimeter channel anchors to the walls — framing before walls means redoing the perimeter' },
    ],
  },
  {
    id: 'overhead_service', label: 'Ceiling — overhead services (in the void)', trade: 'mep', layer: 'services',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    freedomSet: 'overhead_void',
    hostedBy: ['ceiling_frame'],
    concealedBy: ['ceiling_board'],
    seq: [
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'services run in a room, off a slab - the shell must exist' },
      { pred: 'ceiling_frame', nature: 'STRONG_PREF', reason: 'logistics', scope: SZ, note: 'service hung on frame' }, // R27
    ],
  },
  {
    id: 'void_wiring', label: 'Ceiling — void wiring', trade: 'electrical', layer: 'services',
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
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'services run in a room, off a slab - the shell must exist' },
      { pred: 'ceiling_frame', nature: 'STRONG_PREF', reason: 'logistics', scope: SZ, note: 'run in the ceiling void the frame forms' },
    ],
  },

  // ════════ FINISHES (skin) — per_zone unless noted ════════
  {
    id: 'plaster', label: 'Wall — internal plaster', trade: 'plaster', layer: 'finishes',
    saidAs: ['plastering', 'internal plastering', 'ప్లాస్టరింగ్'],
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
    // NEW (2026-07-11) — the legacy expander tracked "Wall Putty" and the engine went straight from
    // plaster to paint. Putty is its own stage, its own crew and its own defect class (a painted wall
    // over bad putty has to be redone), so a "putty done" report needs a row of its own.
    id: 'putty', label: 'Wall — putty', trade: 'painting', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    concealedBy: ['paint'],
    seq: [
      { pred: 'plaster', nature: 'DESTRUCTIVE', reason: 'quality', scope: SZ, note: 'putty needs a plastered surface' },
    ],
  },
  {
    id: 'waterproof', label: 'Wet area — waterproofing', trade: 'waterproofing', layer: 'finishes',
    saidAs: ['waterproofing', 'వాటర్‌ప్రూఫింగ్'],
    instancing: 'per_zone', appliesTo: ['wet', 'balcony'],
    concealedBy: ['screed', 'floor_tile'],
    cohesion: [
      { with: 'screed', nature: 'DESTRUCTIVE', reason: 'concealment', note: 'stacked covers move as one' }, // R36
    ],
    seq: [
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'a wet area is a ROOM - there is nothing to tank until the walls are up' },],
  },
  {
    id: 'screed', label: 'Floor — screed / leveling', trade: 'flooring', layer: 'finishes',
    saidAs: ['screed', 'levelling', 'base coat'],
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    conceals: ['waterproof'],
    concealedBy: ['floor_tile'],
    seq: [
      { pred: 'waterproof', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'screed covers WP' }, // R20
    ],
  },
  {
    id: 'floor_tile', label: 'Floor — tiling', trade: 'tiling', layer: 'finishes',
    saidAs: ['floor tiles', 'tiles laying', 'flooring', 'టైల్స్'],
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    conceals: ['screed', 'waterproof'],
    seq: [
      { pred: 'screed', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'tile over screed' }, // R21
      { pred: 'waterproof', nature: 'DESTRUCTIVE', reason: 'quality', scope: SZ, note: 'WP must underlie wet floor' }, // R22
    ],
  },
  {
    id: 'wall_tile', label: 'Wall — tiling / dado', trade: 'tiling', layer: 'finishes',
    saidAs: ['wall tiles', 'dado', 'గోడ టైల్స్'],
    instancing: 'per_zone', appliesTo: ['wet'],
    seq: [
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'you cannot tile a wall that does not exist (plaster below is the QUALITY pref, not the wall)' },
      { pred: 'plaster', nature: 'STRONG_PREF', reason: 'quality', scope: SZ, note: 'tile backing' }, // R24
    ],
  },
  {
    id: 'paint', label: 'Wall — internal paint', trade: 'painting', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'room_finishing',
    conceals: ['putty'],
    seq: [
      // R23 re-pointed (2026-07-11): paint goes over PUTTY, which goes over plaster. The plaster gate
      // still holds transitively — putty cannot precede it — so no constraint is lost.
      { pred: 'putty', nature: 'DESTRUCTIVE', reason: 'quality', scope: SZ, note: 'paint needs a puttied surface' }, // R23
      { pred: 'floor_tile', nature: 'WEAK_PREF', reason: 'quality', scope: SZ, note: 'or paint-then-floor; protect either way' }, // R26
    ],
  },
  {
    id: 'switchplate', label: 'Electrical — switchplates', phase: 'final fix', trade: 'electrical', layer: 'finishes',
    saidAs: ['switchplates', 'switch boards', 'స్విచ్ ప్లేట్లు', 'final fix'],
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'common'],
    freedomSet: 'skin_fittings',
    hostedBy: ['plaster'],
    seq: [
      { pred: 'wiring', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'a plate terminates a wire - there must be wire' },
      { pred: 'plaster', nature: 'STRONG_PREF', reason: 'logistics', scope: SZ, note: 'mount on finished wall' }, // R25
    ],
  },
  {
    id: 'ceiling_board', label: 'Ceiling — boarding', trade: 'ceiling', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    conceals: ['overhead_service'],
    seq: [
      { pred: 'overhead_service', nature: 'DESTRUCTIVE', reason: 'concealment', scope: SZ, note: 'board seals the void' }, // R28
    ],
  },
  {
    id: 'pop_finish', label: 'Ceiling — POP finish', trade: 'ceiling', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    conceals: ['void_wiring'],
    seq: [
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'the room must exist; boarding below is the quality pref' },
      { pred: 'ceiling_board', nature: 'STRONG_PREF', reason: 'quality', scope: SZ, note: 'finish over board' }, // R29
    ],
  },
  {
    id: 'sanitary', label: 'Plumbing — sanitaryware & fittings', phase: 'final fix', trade: 'plumbing', layer: 'finishes',
    saidAs: ['sanitaryware', 'fittings', 'taps', 'closet', 'final fix plumbing'],
    instancing: 'per_zone', appliesTo: ['wet'],
    freedomSet: 'skin_fittings',
    hostedBy: ['plumb_rough'],
    seq: [
      { pred: 'plumb_rough', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'fittings need rough-in' }, // R31
      { pred: 'wall_tile', nature: 'STRONG_PREF', reason: 'quality', scope: SZ, note: 'fittings on tiled wall' }, // R33
    ],
  },
  {
    id: 'door_shutter', label: 'Door — shutters', trade: 'carpentry', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'skin_fittings',
    hostedBy: ['door_frame'],
    seq: [
      { pred: 'door_frame', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'shutter hangs on frame' }, // R32
    ],
  },
  {
    // NEW (2026-07-11) — "Window Grills" from the legacy set. The engine had window FRAMES only; the
    // grill is a separate item, fitted much later, by a different trade.
    id: 'window_grill', label: 'Window — grills', trade: 'carpentry', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'skin_fittings',
    hostedBy: ['window_frame'],
    seq: [
      { pred: 'window_frame', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'the grill fixes to the window frame' },
    ],
  },
  {
    // NEW (2026-07-11) — "Fixtures" from the legacy set: lights, fans, fittings. The FINAL electrical
    // fix. The skin_fittings freedom set already named it in a comment ("sheet also lists light
    // fixtures (no task-type yet)") — now it exists.
    id: 'fixture', label: 'Electrical — fixtures (lights, fans)', trade: 'electrical', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'wet', 'balcony', 'common'],
    freedomSet: 'skin_fittings',
    hostedBy: ['wiring'],
    seq: [
      { pred: 'wiring', nature: 'IMPOSSIBLE', reason: 'logistics', scope: SZ, note: 'a fixture needs its wire' },
      { pred: 'paint', nature: 'STRONG_PREF', reason: 'quality', scope: SZ, note: 'fit after paint — painting around a fitted light ruins both' },
    ],
  },
  {
    // NEW (2026-07-11) — "Decorative Installations" from the legacy set (cladding, panelling, feature work).
    id: 'decorative', label: 'Decorative installations', trade: 'finishing', layer: 'finishes',
    instancing: 'per_zone', appliesTo: ['dry', 'common'],
    seq: [
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SZ, note: 'nothing to install into before the walls are up' },
      { pred: 'paint', nature: 'STRONG_PREF', reason: 'quality', scope: SZ, note: 'decorative work lands on finished surfaces' },
    ],
  },

  // ════════ COMMON / EXTERNAL / LONG-LEAD — building / external ════════
  {
    id: 'external_structure', label: 'External — façade structure', trade: 'civil', layer: 'structure',
    instancing: 'building', appliesTo: ['external'],
    seq: [
      { pred: 'floor_pour', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'a facade hangs on a FRAME - authored with no predecessor at all, so the plan put it at seq_no 1, ahead of clearing the site' },],
  },
  {
    id: 'facade_plaster', label: 'External — façade plaster', trade: 'plaster', layer: 'finishes',
    instancing: 'building', appliesTo: ['external'],
    freedomSet: 'common_stream',
    seq: [
      { pred: 'floor_pour', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'no elevation to plaster until the frame is up (facade structure below is the access/scaffolding pref)' },
      { pred: 'external_structure', nature: 'STRONG_PREF', reason: 'logistics', scope: BW, note: 'scaffolding / access' }, // R37
    ],
  },
  {
    // NEW (2026-07-11) — "External Painting" from the legacy set. The engine had ONE generic `paint`,
    // which is the internal job: a different crew, different material, different weather window, and a
    // different defect class. A bare generic that swallows both is exactly the ambiguity we are removing.
    id: 'external_paint', label: 'External — façade paint', trade: 'painting', layer: 'finishes',
    instancing: 'building', appliesTo: ['external'],
    freedomSet: 'common_stream',
    seq: [
      { pred: 'facade_plaster', nature: 'DESTRUCTIVE', reason: 'quality', scope: BW, note: 'paint needs the plastered façade' },
    ],
  },
  {
    // NEW (2026-07-11) — "Terrace Waterproofing" from the legacy set. `waterproof` is the WET-AREA job
    // (per zone, bathrooms/balconies). The terrace is a building-wide job at a different moment, and it
    // is the single most expensive thing on the building to get wrong.
    // ON THE TERRACE (2026-07-13). This was `building` — floorless — so the single most expensive thing on
    // the building to get wrong lived nowhere: not on a floor, not in a stage a supervisor would look at.
    // `sited`/'top' puts it where it happens, now that the building has a roof to happen on.
    id: 'terrace_waterproof', label: 'Terrace — waterproofing', trade: 'waterproofing', layer: 'finishes',
    instancing: 'sited', sitedDefault: 'top', appliesTo: ['terrace'],
    concealedBy: ['terrace_finish'],
    seq: [
      { pred: 'floor_pour', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'the terrace slab must be cast first' },
    ],
  },
  {
    // NEW (2026-07-11) — "Terrace Finishing" from the legacy set: the screed/tile layer that BURIES the
    // waterproofing. Once this is down, a membrane defect is invisible until it leaks into the top floor.
    id: 'terrace_finish', label: 'Terrace — finishing', trade: 'flooring', layer: 'finishes',
    instancing: 'sited', sitedDefault: 'top', appliesTo: ['terrace'],
    conceals: ['terrace_waterproof'],
    seq: [
      { pred: 'terrace_waterproof', nature: 'DESTRUCTIVE', reason: 'concealment', scope: BW, note: 'the finish buries the membrane — never cover an untested one' },
    ],
  },
  // DELETED (2026-07-13): `lift_shaft` + `lift_mechanism`. They were gated on `geometry.hasLift`, which
  // NO CALLER EVER PASSED — so neither type was ever instantiated, in any project, ever. Meanwhile
  // `ca_lift` modelled the same lift as a single opaque atom. Two models, one of them dead. The lift is
  // now ONE system (`ca_lift`) expanded into its real components below.
  {
    // GRADING HAPPENS AT THE STILT, NOT AT SITE PREP (2026-07-13). It was a floorless `building` task gated
    // only on clearing the plot, so the plan put it third — in among the setting-out and the excavation. You
    // cannot shape the finished ground while the plinth is still an open trench and lorries are still driving
    // over it. Cut and fill is the level the STILT (or, with no stilt, the ground floor) stands on, and it is
    // done once the substructure is out of the ground. `sited`/'lowest' stands it on that level — the same
    // level the parking deck stands on — so it reads where it actually happens.
    id: 'site_grade', label: 'Site — grading', trade: 'civil', layer: 'structure',
    instancing: 'sited', sitedDefault: 'lowest', appliesTo: ['external'],
    seq: [
      { pred: 'ground_clearance', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'you cannot grade ground you have not cleared' },
      { pred: 'plinth_slab', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'the substructure must be out of the ground — you cannot grade over an open trench' },
    ],
  },
  {
    id: 'site_development', label: 'Site — development', trade: 'civil', layer: 'finishes',
    instancing: 'building', appliesTo: ['external'],
    freedomSet: 'common_stream',
    seq: [
      { pred: 'floor_pour', nature: 'DESTRUCTIVE', reason: 'quality', scope: BW, note: 'site works laid before the frame is up are destroyed by construction traffic' },
      { pred: 'site_grade', nature: 'STRONG_PREF', reason: 'logistics', scope: EX, note: 'near handover' }, // R39
    ],
  },

  // ════════ AMENITY SYSTEMS — OPT-IN per project, EXPANDED into their real components ════════
  //
  // Every type here carries `system`, which is BOTH the opt-in key (projects.common_systems — the ids
  // are unchanged, so existing project rows keep working) and the grouping key for the amenities view.
  // One system now yields several task types, each with the instancing its component actually has:
  //
  //   sited     — the plant, ON its level. The DG and the transformer sit on the stilt; the OHT and the
  //               solar sit on the roof; the sump and the STP go below grade. `sitedDefault` picks the
  //               level when the project hasn't said, and projects.amenity_levels overrides it.
  //   per_floor — the part that REPEATS at every level: the lift shaft and its landing doors, the stair
  //               flight, the corridor, the fire standpipe. This is the fix for the real complaint —
  //               there was no row for "lift landing door, 3rd floor", so nobody could report it.
  //   building  — commissioning / licence / boundary work: genuinely one thing, once.
  //
  // Before 2026-07-13 all fourteen were a single `building` atom with one edge ("after foundation"), so
  // an amenity had no place, no per-floor work, and no progress until someone flipped the whole thing.

  // ── vertical circulation: the lift, as the four things it actually is ──
  { id: 'ca_lift_shaft', label: 'Lift — shaft', trade: 'civil', layer: 'structure', instancing: 'per_floor', appliesTo: [], system: 'ca_lift', seq: [
    { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'the shaft walls rise with this floor\'s masonry' },
    { pred: 'ca_lift_shaft', nature: 'IMPOSSIBLE', reason: 'structural', scope: CF(-1), note: 'a shaft climbs — the floor below carries this one' },
  ] },
  // THE MACHINE ROOM IS A ROOM, and it stands in the headroom on the terrace. It was `building` (nowhere).
  // `sited` keeps the system's level override (amenity_levels), so a machine-room-less lift can be placed
  // elsewhere without touching the library.
  { id: 'ca_lift_mech', label: 'Lift — mechanism & car', trade: 'lift', layer: 'services', instancing: 'sited', sitedDefault: 'top', appliesTo: [], system: 'ca_lift', longLead: true, seq: [
    { pred: 'ca_lift_shaft', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'LONG-LEAD: order early, but it installs into a finished shaft' },
  ] },
  { id: 'ca_lift_door', label: 'Lift — landing door', trade: 'lift', layer: 'services', instancing: 'per_floor', appliesTo: [], system: 'ca_lift', seq: [
    { pred: 'ca_lift_shaft', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'the door seats into this floor\'s shaft opening' },
    { pred: 'ca_lift_mech', nature: 'IMPOSSIBLE', reason: 'logistics', scope: BW, note: 'doors hang off the installed guide rails' },
  ] },
  { id: 'ca_lift', label: 'Lift — commissioning & licence', trade: 'lift', layer: 'services', instancing: 'building', appliesTo: [], system: 'ca_lift', seq: [
    { pred: 'ca_lift_door', nature: 'IMPOSSIBLE', reason: 'quality', scope: BW, note: 'you cannot certify a lift whose landing doors are not all hung' },
  ] },

  // ── the common staircase: a flight per floor, finished per floor ──
  // …to the terrace as well: the top flight IS the staircase headroom, and without it there is no way onto
  // the roof at all. (A per_floor type occupies parking + habitable by default; these two opt in.)
  { id: 'ca_stair', label: 'Common staircase — structure', trade: 'civil', layer: 'structure', instancing: 'per_floor', floors: ['parking', 'habitable', 'terrace'], appliesTo: [], system: 'ca_stair', seq: [
    { pred: 'floor_pour', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'the flight lands on this floor\'s slab' },
  ] },
  { id: 'stair_finish', label: 'Common staircase — finishing', trade: 'finishing', layer: 'finishes', instancing: 'per_floor', floors: ['parking', 'habitable', 'terrace'], appliesTo: [], system: 'ca_stair', seq: [
    { pred: 'ca_stair', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'finish the flight that exists' },
  ] },
  { id: 'ca_corridor', label: 'Corridor & lobby finishes', trade: 'finishing', layer: 'finishes', instancing: 'per_floor', appliesTo: [], system: 'ca_corridor', seq: [
      { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'a corridor is walls and a slab - finish what exists' },
    { pred: 'plaster', nature: 'STRONG_PREF', reason: 'logistics', scope: SF, note: 'finish the corridor after the units on this floor are plastered' },
  ] },

  // ── water: the tank is on the roof, the pump is downstairs, the sump is below grade ──
  { id: 'ca_oht', label: 'Overhead tank', trade: 'plumbing', layer: 'services', instancing: 'sited', appliesTo: [], system: 'ca_oht', sitedDefault: 'top', seq: [
    { pred: 'floor_pour', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'the tank sits on the roof slab' },
  ] },
  { id: 'ca_oht_pump', label: 'Water pumps & plumbing room', trade: 'plumbing', layer: 'services', instancing: 'sited', appliesTo: [], system: 'ca_oht', sitedDefault: 'lowest', seq: [
    { pred: 'riser', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'the pump feeds the risers — they must exist to be fed' },
  ] },
  { id: 'ca_ugt', label: 'Underground sump / tank', trade: 'civil', layer: 'structure', instancing: 'sited', appliesTo: [], system: 'ca_ugt', sitedDefault: 'lowest', seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'cast with the substructure' }] },
  { id: 'ca_borewell', label: 'Borewell', trade: 'plumbing', layer: 'services', instancing: 'sited', appliesTo: [], system: 'ca_borewell', sitedDefault: 'lowest', seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'water source' }] },
  { id: 'ca_stp', label: 'Sewage treatment plant (STP)', trade: 'civil', layer: 'structure', instancing: 'sited', appliesTo: [], system: 'ca_stp', sitedDefault: 'lowest', seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'below-grade plant' }] },

  // ── power: the DG and the transformer stand on a level (the stilt, usually) ──
  { id: 'ca_transformer', label: 'Transformer / substation', trade: 'electrical', layer: 'services', instancing: 'sited', appliesTo: [], system: 'ca_transformer', sitedDefault: 'lowest', longLead: true, seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'LONG-LEAD power infra' }] },
  { id: 'ca_generator', label: 'DG / generator set', trade: 'electrical', layer: 'services', instancing: 'sited', appliesTo: [], system: 'ca_generator', sitedDefault: 'lowest', longLead: true, seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'backup power' }] },
  { id: 'ca_solar', label: 'Rooftop solar', trade: 'electrical', layer: 'services', instancing: 'sited', appliesTo: [], system: 'ca_solar', sitedDefault: 'top', seq: [
    { pred: 'terrace_waterproof', nature: 'DESTRUCTIVE', reason: 'concealment', scope: BW, note: 'never anchor a frame through un-waterproofed roof' },
  ] },

  // ── fire: a standpipe/hydrant on every floor, a pump downstairs, one approval ──
  { id: 'ca_fire_floor', label: 'Fire — standpipe & hydrant', trade: 'fire', layer: 'services', instancing: 'per_floor', appliesTo: [], system: 'ca_fire', seq: [
    { pred: 'blockwork', nature: 'IMPOSSIBLE', reason: 'structural', scope: SF, note: 'the wet riser runs the shaft on this floor' },
    { pred: 'ca_fire_floor', nature: 'IMPOSSIBLE', reason: 'structural', scope: CF(-1), note: 'the wet riser climbs' },
  ] },
  { id: 'ca_fire', label: 'Fire fighting — pumps, alarm & approval', trade: 'fire', layer: 'services', instancing: 'building', appliesTo: [], system: 'ca_fire', seq: [
    { pred: 'ca_fire_floor', nature: 'IMPOSSIBLE', reason: 'quality', scope: BW, note: 'the authority certifies a system that reaches every floor' },
  ] },

  // ── site & boundary: genuinely one thing, once ──
  /**
   * PARKING DECK & MARKINGS IS A FINISH, NOT A FRAME.
   *
   * It was `layer: 'structure'` with ONE gate — `foundation` — which meant that the moment the footings
   * were in, the engine believed you could go and paint the bay markings. It topo-sorted to the very
   * top of the stilt floor, AHEAD OF THE COLUMNS, and took the "Up next" chip: the first job the desk
   * offered on a real site was to line out the car park of a building that did not exist yet.
   *
   * The structural slab of the parking level is part of the frame — it is `floor_pour` on that level,
   * and it already exists as its own task. THIS is the wearing surface and the paint on top of it, and
   * it is one of the last things that happens: for the whole build, that deck is the road every mixer,
   * every lorry and every steel delivery drives over. Lay it early and you resurface it at handover.
   *
   * So: a finish, and gated on the frame being up (the same rule, and the same reasoning, that
   * landscaping already carries — "planting before the frame is up is planting under a crane").
   */
  { id: 'ca_parking', label: 'Parking deck & markings', trade: 'civil', layer: 'finishes', instancing: 'sited', appliesTo: [], system: 'ca_parking', sitedDefault: 'lowest', seq: [
    { pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'built on the substructure' },
    { pred: 'floor_pour', nature: 'DESTRUCTIVE', reason: 'quality', scope: BW, note: 'the deck is the site road until the frame is up — surface it early and every lorry on the job drives over it' },
  ] },
  { id: 'ca_compound', label: 'Compound wall & gate', trade: 'civil', layer: 'structure', instancing: 'building', appliesTo: [], system: 'ca_compound', seq: [{ pred: 'foundation', nature: 'IMPOSSIBLE', reason: 'structural', scope: BW, note: 'site boundary' }] },
  { id: 'ca_landscaping', label: 'Landscaping & hardscape', trade: 'landscaping', layer: 'finishes', instancing: 'building', appliesTo: [], system: 'ca_landscaping', seq: [
      { pred: 'floor_pour', nature: 'DESTRUCTIVE', reason: 'quality', scope: BW, note: 'planting before the frame is up is planting under a crane' },{ pred: 'ca_compound', nature: 'STRONG_PREF', reason: 'logistics', scope: BW, note: 'near handover, inside the boundary' }] },
  // Snagging is anchored SOFT on purpose: it is a WALK of whatever is finished. A hard gate on every
  // finishing type would make it unavailable until the last zone in the building is done — the opposite
  // of how a snag list is actually built (you start walking as units complete).
  { id: 'snagging', label: 'Snagging & handover', trade: 'finishing', layer: 'finishes', instancing: 'building', appliesTo: [], seq: [
    { pred: 'paint', nature: 'IMPOSSIBLE', reason: 'quality', scope: BW, note: 'you cannot hand over an unpainted building - this was a PREF, so the plan offered handover on bare ground' },
    { pred: 'sanitary', nature: 'IMPOSSIBLE', reason: 'quality', scope: BW, note: 'nor one with no fittings in it' },
  ] },
]

// ── QC: the authored checks, one block, 3 per type (1 critical, listed FIRST) ─────────────────
// See types.ts QcCheck for WHY these live in the library rather than in a generation step.
// buildLibrary() attaches these onto their TaskType; validateLibrary() proves every authored
// type has exactly 3 with exactly 1 critical — so partial QC coverage is not expressible.
const QC: Record<TaskTypeId, QcCheck[]> = {
  ground_clearance: [
    { question: 'The full building footprint plus working margin is cleared — no vegetation, rubble or old foundations left in it', is_critical: true },
    { question: 'Topsoil is stripped and stockpiled separately, not mixed into the spoil', is_critical: false },
    { question: 'An access route for material vehicles is established and passable', is_critical: false },
  ],
  site_marking: [
    { question: 'Grid lines and building corners are marked against the approved drawing, with reference pillars/offsets that survive the dig', is_critical: true },
    { question: 'Setback distances to every boundary match the sanctioned plan', is_critical: false },
    { question: 'The benchmark level (datum) is fixed on site and recorded', is_critical: false },
  ],
  excavation: [
    { question: 'The excavation reaches the drawing\'s depth AND firm strata at every footing — no footing sitting on loose fill', is_critical: true },
    { question: 'Pit sides are stable or shored, and the pit bottom is clean of loose soil', is_critical: false },
    { question: 'Pit dimensions match the footing size plus working space', is_critical: false },
  ],
  pcc_bed: [
    { question: 'PCC covers the full footing area and is levelled to the marked level — no steel will rest on bare earth', is_critical: true },
    { question: 'PCC thickness matches the drawing', is_critical: false },
    { question: 'The PCC has hardened before reinforcement is placed on it', is_critical: false },
  ],
  footing: [
    { question: 'Cover blocks are in place under and around the footing steel — no bar is touching the PCC or the earth', is_critical: true },
    { question: 'Bar size, spacing and mesh match the drawing', is_critical: false },
    { question: 'The footing is poured in one continuous operation and compacted — no honeycombing at the edges', is_critical: false },
  ],
  footing_column: [
    { question: 'Starter bars are held plumb at the correct grid position, with the drawing\'s lap length', is_critical: true },
    { question: 'The starter cage is tied and boxed square before the pour', is_critical: false },
    { question: 'Concrete at the kicker is compacted — no honeycombing where the column leaves the footing', is_critical: false },
  ],
  backfill: [
    { question: 'Backfill is placed and compacted in LAYERS — not tipped in one lift', is_critical: true },
    { question: 'The fill material carries no debris, wood or organic matter', is_critical: false },
    { question: 'Fill is raised evenly on both sides of the footing so nothing is pushed out of line', is_critical: false },
  ],
  plinth_beam: [
    { question: 'Cover blocks are under and around the plinth-beam steel on every face — no bar against the earth or the shutter', is_critical: true },
    { question: 'The beam is cast at the marked level and ties every column at plinth', is_critical: false },
    { question: 'The beam faces are compacted and free of honeycombing', is_critical: false },
  ],
  plinth_fill: [
    { question: 'The fill is compacted in layers up to the underside of the slab — no soft spots or voids', is_critical: true },
    { question: 'Anti-termite treatment is applied where specified, before the fill is closed', is_critical: false },
    { question: 'The finished fill is level across the whole plinth', is_critical: false },
  ],
  plinth_slab: [
    { question: 'Cover blocks are under the slab mesh — the steel is nowhere resting on the fill', is_critical: true },
    { question: 'Slab thickness and mesh match the drawing', is_critical: false },
    { question: 'The finished slab is level, with no ponding', is_critical: false },
  ],
  foundation: [
    { question: 'The mass-concrete / anti-termite bed is continuous across the plinth — no gaps at the edges', is_critical: true },
    { question: 'Levels are checked against the benchmark before the superstructure starts', is_critical: false },
    { question: 'Every substructure item below is complete and signed off', is_critical: false },
  ],
  columns: [
    { question: 'Cover blocks are on EVERY face of the column steel — no bar visible against the shutter', is_critical: true },
    { question: 'Lap length and lap position match the drawing, and laps are staggered', is_critical: false },
    { question: 'The column is plumb and boxed square; the base is compacted with no honeycombing', is_critical: false },
  ],
  floor_shutter: [
    { question: 'Props stand on a firm base, are braced, and the formwork is levelled to the slab soffit line', is_critical: true },
    { question: 'Shutter joints are tight — no gaps that will bleed slurry out of the pour', is_critical: false },
    { question: 'Shutter faces are cleaned and oiled before any steel is laid on them', is_critical: false },
  ],
  floor_rebar: [
    { question: 'Cover blocks are under ALL slab and beam steel — no bar is resting directly on the shuttering', is_critical: true },
    { question: 'Bar size, spacing and lap length match the drawing; laps are staggered and tied', is_critical: false },
    { question: 'Conduits and sleeves are laid in and tied down before the pour, so they cannot float', is_critical: false },
  ],
  floor_pour: [
    { question: 'The beams and slab are poured in ONE continuous operation — no cold joint anywhere in the deck', is_critical: true },
    { question: 'The concrete is vibrated/compacted and the surface levelled to the marked level', is_critical: false },
    { question: 'Curing is started within the specified time and kept up (ponding or wet covering)', is_critical: false },
  ],
  shuttering_removal: [
    { question: 'The concrete has cured the FULL specified period before any prop comes out', is_critical: true },
    { question: 'Props are struck in the correct order — no span is de-propped suddenly', is_critical: false },
    { question: 'The soffit is inspected after de-prop: no honeycombing, no sagging, no exposed steel', is_critical: false },
  ],
  blockwork: [
    { question: 'Walls are plumb and in line with the grid, with the first course on a clean, level bed', is_critical: true },
    { question: 'Joints are fully filled with mortar and the blocks are wetted before laying', is_critical: false },
    { question: 'Door and window openings are at the drawing\'s size and position', is_critical: false },
  ],
  conduit: [
    { question: 'Chases are cut without cutting through reinforcement or into a structural member', is_critical: true },
    { question: 'Conduits run to the drawing\'s switch and point positions and are fixed so plaster cannot move them', is_critical: false },
    { question: 'Junction and switch boxes are set flush and level with the finished wall line', is_critical: false },
  ],
  in_wall_plumbing: [
    { question: 'Chases are cut without cutting into a structural member', is_critical: true },
    { question: 'Concealed runs are fixed and supported in the chase — no crushed sections, no sharp bends', is_critical: false },
    { question: 'Every open pipe end is capped so debris cannot enter before the fittings go on', is_critical: false },
  ],
  plumb_rough: [
    { question: 'Rough-in positions match the sanitaryware layout — centre distances for the WC, basin and mixer', is_critical: true },
    { question: 'Waste lines are laid to the specified fall towards the drain', is_critical: false },
    { question: 'All open ends are capped before anything is concealed', is_critical: false },
  ],
  pressure_test: [
    { question: 'The line held the specified test pressure for the specified duration with NO drop', is_critical: true },
    { question: 'The test covered every line in the zone, including the concealed runs', is_critical: false },
    { question: 'Nothing was concealed before the test passed, and the result is recorded', is_critical: false },
  ],
  riser: [
    { question: 'Risers are plumb and bracketed at the specified spacing, supported at every floor', is_critical: true },
    { question: 'Riser size and material match the drawing', is_critical: false },
    { question: 'The riser is pressure-tested before the shaft is closed up', is_critical: false },
  ],
  door_frame: [
    { question: 'The frame is plumb, square and set at the correct finished-floor height', is_critical: true },
    { question: 'The frame is anchored with the specified hold-fasts into the masonry', is_critical: false },
    { question: 'The gap between frame and masonry is packed solid — no voids at the reveal', is_critical: false },
  ],
  window_frame: [
    { question: 'The frame is plumb and square, set to the drawing\'s sill level', is_critical: true },
    { question: 'The frame is anchored into the masonry and sealed at the reveal against water ingress', is_critical: false },
    { question: 'A drip or sill slope is provided so water runs away from the opening', is_critical: false },
  ],
  ceiling_frame: [
    { question: 'Hangers are anchored into the slab soffit itself — never into plaster or a service', is_critical: true },
    { question: 'The grid is level across the whole room, checked against the finished ceiling line', is_critical: false },
    { question: 'The perimeter channel is fixed to the walls all round, level and straight', is_critical: false },
  ],
  overhead_service: [
    { question: 'Every service in the void is complete AND tested before the ceiling can be boarded', is_critical: true },
    { question: 'Services are supported independently — nothing hangs off the ceiling grid', is_critical: false },
    { question: 'Access is left where a fitting will have to be reached later', is_critical: false },
  ],
  void_wiring: [
    { question: 'Void wiring is complete and tested before the ceiling is closed', is_critical: true },
    { question: 'Wiring in the void is run in conduit or otherwise protected — never loose across the grid', is_critical: false },
    { question: 'Light-point positions in the void match the ceiling layout', is_critical: false },
  ],
  wiring: [
    { question: 'Every circuit is tested for continuity and insulation before the board is energised', is_critical: true },
    { question: 'Wire size matches the circuit load and the colour code is respected', is_critical: false },
    { question: 'There are no joints inside the conduit runs — terminations only at boxes', is_critical: false },
  ],
  switchboard: [
    { question: 'The board is earthed, the circuits are labelled, and the MCB ratings match the circuits they protect', is_critical: true },
    { question: 'The board is fixed plumb at the specified height and is accessible', is_critical: false },
    { question: 'Incoming and outgoing cables are dressed and terminated tight', is_critical: false },
  ],
  plaster: [
    { question: 'The surface is plumb and true to a straight-edge, and sounds solid when tapped — no hollow patches', is_critical: true },
    { question: 'Junctions where masonry meets concrete are meshed before plastering', is_critical: false },
    { question: 'The plaster is kept wet and cured for the specified period', is_critical: false },
  ],
  putty: [
    { question: 'The surface is smooth and true — no waves, ridges or sanding marks visible under a raking light', is_critical: true },
    { question: 'Putty is applied only on a fully cured, dry plaster surface', is_critical: false },
    { question: 'The specified number of coats is applied, each sanded before the next', is_critical: false },
  ],
  waterproof: [
    { question: 'The membrane is CONTINUOUS — turned up the wall to the specified height, through every corner and around every pipe penetration', is_critical: true },
    { question: 'A pond test was held for the specified duration with no leak below', is_critical: false },
    { question: 'The membrane is undamaged when the screed goes over it', is_critical: false },
  ],
  screed: [
    { question: 'The falls are correct — water runs to the drain with no ponding anywhere', is_critical: true },
    { question: 'The screed is bonded — no hollow sound when tapped', is_critical: false },
    { question: 'The screed level leaves the right thickness for the tile and the finished-floor level', is_critical: false },
  ],
  floor_tile: [
    { question: 'No hollow tiles — every tile is fully bedded (tap test)', is_critical: true },
    { question: 'Joints are straight and even, and lippage between tiles is within tolerance', is_critical: false },
    { question: 'Wet-area floors fall to the drain, and the level matches at the door threshold', is_critical: false },
  ],
  wall_tile: [
    { question: 'No hollow tiles, and the tiles are plumb with joints lining through with the floor', is_critical: true },
    { question: 'Cut tiles are placed at the least visible position, with clean cut edges', is_critical: false },
    { question: 'Tiling reaches the specified dado height and is cut cleanly around every penetration', is_critical: false },
  ],
  paint: [
    { question: 'Coverage is even under a raking light — no patches, brush marks or roller lines', is_critical: true },
    { question: 'The specified number of coats is applied on a dry, puttied surface', is_critical: false },
    { question: 'Cut-ins are clean — no paint on switches, frames or floors', is_critical: false },
  ],
  switchplate: [
    { question: 'Every switch and socket is tested live and its circuit is labelled', is_critical: true },
    { question: 'Plates sit flush and level on the finished wall, fully covering the box', is_critical: false },
    { question: 'There is no wall damage or paint marking around the plate', is_critical: false },
  ],
  ceiling_board: [
    { question: 'The void was signed off — services complete and TESTED — before the boarding closed it', is_critical: true },
    { question: 'Board joints fall on the grid and are staggered, with screws set below the surface', is_critical: false },
    { question: 'Cut-outs for lights and services are clean and at the layout\'s positions', is_critical: false },
  ],
  pop_finish: [
    { question: 'The finished surface is level and true — no sagging, no visible joints, no corner cracks', is_critical: true },
    { question: 'Corners and edges are straight and sharp', is_critical: false },
    { question: 'Cut-outs around every fitting are neat', is_critical: false },
  ],
  sanitary: [
    { question: 'Every fitting is leak-tested after installation — supply AND waste', is_critical: true },
    { question: 'Fittings are level, at the drawing\'s height, and firmly anchored', is_critical: false },
    { question: 'Sealing at every wall junction is complete and clean', is_critical: false },
  ],
  door_shutter: [
    { question: 'The shutter opens, closes and latches freely — no binding anywhere in its swing', is_critical: true },
    { question: 'Gaps around the shutter are even, with the bottom clearance suiting the finished floor', is_critical: false },
    { question: 'All hardware — hinges, lock, stopper — is fitted and working', is_critical: false },
  ],
  window_grill: [
    { question: 'The grill is anchored into the structure, not merely into the frame — it cannot be prised out', is_critical: true },
    { question: 'The grill is square and level, with welds ground clean', is_critical: false },
    { question: 'The grill is primed and coated against rust before handover', is_critical: false },
  ],
  fixture: [
    { question: 'Every fixture is tested live and works — light, fan speed, switch', is_critical: true },
    { question: 'Each fixture is fixed to a proper anchor — a fan hooks into the slab hook, never into the ceiling board', is_critical: false },
    { question: 'Positions match the lighting layout, with no paint marks or damage on the fitting', is_critical: false },
  ],
  decorative: [
    { question: 'Fixings go into a proper substrate and the installation is secure', is_critical: true },
    { question: 'Alignment and level are true, with consistent joints', is_critical: false },
    { question: 'Adjacent finished surfaces are protected — no damage to paint or flooring', is_critical: false },
  ],
  external_structure: [
    { question: 'External structural elements are plumb and as per drawing, with no honeycombing or exposed steel on the outer face', is_critical: true },
    { question: 'Drip courses and edges are formed where specified', is_critical: false },
    { question: 'Any embedded fixings for the façade are in place before the finish goes on', is_critical: false },
  ],
  facade_plaster: [
    { question: 'The external plaster is crack-free and solid to the tap — no hollow patches to fall away later', is_critical: true },
    { question: 'Drip grooves are formed above openings so water cannot track back into the wall', is_critical: false },
    { question: 'The plaster is kept wet and cured — external plaster dries fast and cracks if it is not', is_critical: false },
  ],
  external_paint: [
    { question: 'The surface is fully sealed — primer plus the specified coats, with no thin or patchy areas', is_critical: true },
    { question: 'Cracks and gaps are filled and primed before painting', is_critical: false },
    { question: 'Painted in suitable weather — no runs, no lap marks', is_critical: false },
  ],
  terrace_waterproof: [
    { question: 'The membrane is CONTINUOUS — turned up at every parapet and sealed around every penetration', is_critical: true },
    { question: 'A flood test was held for the specified duration with no leak into the floor below', is_critical: false },
    { question: 'Falls run to the outlets — no ponding anywhere on the terrace', is_critical: false },
  ],
  terrace_finish: [
    { question: 'The finish was laid only AFTER the flood test passed, and the membrane is undamaged beneath it', is_critical: true },
    { question: 'The falls to the outlets are maintained in the finished surface', is_critical: false },
    { question: 'The parapet junction and every outlet are sealed and clear', is_critical: false },
  ],
  lift_shaft: [
    { question: 'Shaft plumb and dimensions are within the lift supplier\'s tolerance, top to bottom', is_critical: true },
    { question: 'Pit depth and headroom match the supplier\'s drawing', is_critical: false },
    { question: 'The shaft is clean and dry, and no service crosses it', is_critical: false },
  ],
  lift_mechanism: [
    { question: 'The lift is commissioned and load-tested by the supplier, with the certificate on record', is_critical: true },
    { question: 'Door interlocks, emergency stop and the alarm are all tested working', is_critical: false },
    { question: 'The machine room / control panel is complete and accessible', is_critical: false },
  ],
  site_grade: [
    { question: 'Finished levels drain AWAY from the building on every side', is_critical: true },
    { question: 'Filled areas are compacted, not left loose', is_critical: false },
    { question: 'Levels match the approved site plan', is_critical: false },
  ],
  site_development: [
    { question: 'External drainage, paving and boundary work drain away from the structure and hold their level', is_critical: true },
    { question: 'No settlement or ponding shows after the first rain or water test', is_critical: false },
    { question: 'All debris and temporary works are removed from the site', is_critical: false },
  ],
  ca_parking: [
    { question: 'The deck falls to its drains — no ponding — and the surface is non-slip', is_critical: true },
    { question: 'Bay markings and drive lanes match the approved layout and its dimensions', is_critical: false },
    { question: 'Headroom clearance meets the drawing at every point, including under beams', is_critical: false },
  ],
  ca_stair: [
    { question: 'Every riser and tread in a flight is EQUAL — there is no odd step', is_critical: true },
    { question: 'Landing levels and headroom match the drawing', is_critical: false },
    { question: 'The soffit is free of honeycombing and exposed steel', is_critical: false },
  ],
  ca_ugt: [
    { question: 'The tank holds water — leak-tested with no seepage through the walls or base', is_critical: true },
    { question: 'The internal finish is smooth and suitable for potable water where it stores drinking water', is_critical: false },
    { question: 'Cover, ventilation and access are provided and sealed against contamination', is_critical: false },
  ],
  ca_stp: [
    { question: 'The plant is commissioned and tested to its design flow, with the certificate on record', is_critical: true },
    { question: 'The tanks are leak-tested watertight BEFORE backfilling', is_critical: false },
    { question: 'Inlet and outlet levels and connections match the drawing', is_critical: false },
  ],
  ca_compound: [
    { question: 'The wall is plumb on a proper foundation, with movement joints at the specified spacing', is_critical: true },
    { question: 'The gate is plumb, swings or slides freely, and is anchored to a proper post', is_critical: false },
    { question: 'The coping sheds water clear of the wall face', is_critical: false },
  ],
  ca_lift: [
    { question: 'The lift is commissioned, load-tested and safety-tested by the supplier, with the certificate on record', is_critical: true },
    { question: 'The statutory lift licence / inspector approval is obtained and on record', is_critical: false },
    { question: 'Landing doors align and interlock at every floor, and the car levels correctly at each', is_critical: false },
  ],
  ca_lift_shaft: [
    { question: 'The shaft is PLUMB through this floor and its clear internal dimensions match the lift supplier\'s drawing — a shaft out of tolerance cannot take the car', is_critical: true },
    { question: 'The landing opening on this floor is formed to the specified size, with its lintel in place', is_critical: false },
    { question: 'Scaffold inserts and any temporary openings through the shaft wall are made good', is_critical: false },
  ],
  ca_lift_mech: [
    { question: 'Guide rails are plumb and aligned over the full travel, and the car and counterweight run free', is_critical: true },
    { question: 'The machine room / headroom equipment is installed with the supplier\'s clearances met', is_critical: false },
    { question: 'The pit is dry, and the buffers and pit ladder are installed', is_critical: false },
  ],
  ca_lift_door: [
    { question: 'The landing door on this floor interlocks — the car cannot move with it open, and it cannot be opened with no car at the landing', is_critical: true },
    { question: 'The door sill is level with the finished floor and the gap is within tolerance', is_critical: false },
    { question: 'The frame is plumb and grouted solid into the shaft opening', is_critical: false },
  ],
  ca_oht_pump: [
    { question: 'The pump set delivers to the topmost floor at the design pressure, and the auto cut-off works', is_critical: true },
    { question: 'The pumps are mounted on an anti-vibration base and the room drains', is_critical: false },
    { question: 'Suction and delivery valves are installed and the standby pump changeover works', is_critical: false },
  ],
  ca_fire_floor: [
    { question: 'The hydrant / hose reel on this floor is pressure-tested and holds — no leak at the landing valve', is_critical: true },
    { question: 'Sprinkler coverage on this floor matches the approved fire drawing', is_critical: false },
    { question: 'The floor\'s hose cabinet is accessible, stocked, and not obstructed by stored material', is_critical: false },
  ],
  ca_transformer: [
    { question: 'The transformer is commissioned and tested by the licensed agency, with the statutory approvals on record', is_critical: true },
    { question: 'Earthing is complete and tested to the specified resistance', is_critical: false },
    { question: 'The enclosure is secure, ventilated, and clear of stored material', is_critical: false },
  ],
  ca_generator: [
    { question: 'The DG is load-tested and the changeover to mains works automatically', is_critical: true },
    { question: 'Earthing and exhaust routing are complete and compliant', is_critical: false },
    { question: 'Fuel storage and the acoustic enclosure meet the specified norms', is_critical: false },
  ],
  ca_oht: [
    { question: 'The tank holds water — leak-tested with no seepage through the base or walls', is_critical: true },
    { question: 'The tank sits on a designed support that the roof slab can actually carry', is_critical: false },
    { question: 'Overflow, vent and cleaning access are all provided', is_critical: false },
  ],
  ca_fire: [
    { question: 'The system is commissioned, pressure-tested and approved by the fire authority', is_critical: true },
    { question: 'The pumps start automatically on a pressure drop and the alarm sounds on every floor', is_critical: false },
    { question: 'The fire NOC / occupancy clearance is obtained and on record', is_critical: false },
  ],
  ca_solar: [
    { question: 'The array is commissioned and generating, with the inverter/meter reading verified', is_critical: true },
    { question: 'The mounting is anchored WITHOUT penetrating the terrace waterproofing', is_critical: false },
    { question: 'Cabling is UV-protected and routed clear of walkways', is_critical: false },
  ],
  ca_borewell: [
    { question: 'The yield is tested and recorded, and the water is tested for potability', is_critical: true },
    { question: 'The casing is sealed at the top so surface water cannot enter the bore', is_critical: false },
    { question: 'The pump is set at the correct depth and delivers to the tank', is_critical: false },
  ],
  ca_corridor: [
    { question: 'Floor, wall and ceiling finishes run continuous and level through the corridor — no lippage at the joints', is_critical: true },
    { question: 'Lighting and any emergency signage are working', is_critical: false },
    { question: 'No damage to the finishes has been left by the trades that followed', is_critical: false },
  ],
  stair_finish: [
    { question: 'Every riser and tread is EQUAL after finishing — the finish has not created an odd step', is_critical: true },
    { question: 'The nosing is consistent and the surface is non-slip', is_critical: false },
    { question: 'The handrail is anchored securely and set at the specified height', is_critical: false },
  ],
  ca_landscaping: [
    { question: 'Levels drain away from the structure — no water is trapped against the building', is_critical: true },
    { question: 'Paving is laid to fall and does not rock underfoot', is_critical: false },
    { question: 'Planting and irrigation are complete, with no debris left in the soil', is_critical: false },
  ],
  snagging: [
    { question: 'Every snag on the list is closed AND re-inspected — nothing is signed off untouched', is_critical: true },
    { question: 'All services are tested working at handover — water, power, drainage, lift', is_critical: false },
    { question: 'The unit is cleaned, and all protection and debris are removed', is_critical: false },
  ],
}

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
    members: ['switchplate', 'sanitary', 'door_shutter', 'fixture', 'window_grill'], // `fixture` IS the sheet's light fixtures — authored 2026-07-11
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
    members: ['facade_plaster', 'external_paint', 'site_development'],
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
  'ground_clearance', 'site_marking', 'excavation', 'pcc_bed', 'footing', 'footing_column', 'backfill',
  'plinth_beam', 'plinth_fill', 'plinth_slab', 'foundation',
  // structure (bones) — the floor cycle: shutter → reinforce → pour → cure/de-prop → walls
  'columns', 'floor_shutter', 'floor_rebar', 'floor_pour', 'shuttering_removal', 'blockwork',
  // services (muscle) — wall services, then ceiling-void services
  'conduit', 'in_wall_plumbing', 'plumb_rough', 'pressure_test', 'riser', 'door_frame', 'window_frame',
  'wiring', 'switchboard', 'ceiling_frame', 'overhead_service', 'void_wiring',
  // finishes (skin) — plaster → putty → wet-floor stack → tiling → ceiling finish → paint → fittings
  'plaster', 'putty', 'waterproof', 'screed', 'floor_tile', 'wall_tile', 'ceiling_board', 'pop_finish',
  'paint', 'switchplate', 'sanitary', 'door_shutter', 'window_grill', 'fixture', 'decorative',
  // common / external / long-lead
  'external_structure', 'facade_plaster', 'external_paint', 'terrace_waterproof', 'terrace_finish',
  'site_grade', 'site_development',
  // amenity systems (opt-in per project). Each system reads in its own build order: the structure it
  // needs, then the plant, then the per-floor components, then commissioning.
  'ca_parking', 'ca_ugt', 'ca_stp', 'ca_borewell', 'ca_compound',
  'ca_stair', 'stair_finish',
  'ca_lift_shaft', 'ca_lift_mech', 'ca_lift_door', 'ca_lift',
  'ca_transformer', 'ca_generator',
  'ca_oht', 'ca_oht_pump',
  'ca_fire_floor', 'ca_fire',
  'ca_solar', 'ca_corridor', 'ca_landscaping',
  // the closing stage
  'snagging',
]

/** Map task-type id → its canonical display rank (lower = earlier). Unknown ids → +∞. */
export function canonicalRank(lib: Library = LIBRARY): Map<TaskTypeId, number> {
  const m = new Map<TaskTypeId, number>()
  CANONICAL_SEQUENCE.forEach((id, i) => { if (lib.taskTypes.has(id)) m.set(id, i) })
  return m
}

// ── Build + freeze the Library ───────────────────────────────────────────────
export function buildLibrary(): Library {
  // QC and the BRIEF both ride onto their type here — authored once, never generated.
  const taskTypes = new Map(TASK_TYPES.map((t) => [t.id, { ...t, qc: QC[t.id] ?? [], brief: BRIEFS[t.id] }]))
  const freedomSets = new Map(FREEDOM_SETS.map((f) => [f.id, f]))
  return { taskTypes, freedomSets }
}

/** The site's own words for a task type — shown to the resolver on the candidate line so a supervisor's
 *  word reaches the task it names. Empty for a type with no observed collision, and for a hand-added task
 *  (no engine type → no aliases, and none are invented). */
export function saidAsOf(taskTypeId: string | null | undefined): string[] {
  if (!taskTypeId) return []
  return LIBRARY.taskTypes.get(taskTypeId)?.saidAs ?? []
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

  // QC COVERAGE — every authored type carries exactly 3 checks, exactly 1 critical. This is what makes
  // "was the QC generated for this task?" an un-askable question: it is authored, so it is always there.
  // (The DB's site_task_qc_one_critical partial unique index is the hard backstop on the second critical.)
  for (const t of ids.values()) {
    const qc = t.qc ?? []
    if (qc.length !== 3) issues.push({ kind: 'qc_count', detail: `task-type '${t.id}' has ${qc.length} QC checks (need exactly 3)` })
    const crit = qc.filter((q) => q.is_critical).length
    if (crit !== 1) issues.push({ kind: 'qc_critical', detail: `task-type '${t.id}' has ${crit} critical QC checks (need exactly 1)` })
    for (const q of qc)
      if (!q.question.trim()) issues.push({ kind: 'qc_empty', detail: `task-type '${t.id}' has an empty QC question` })
  }

  // BRIEF COVERAGE — exactly 3 points, in EVERY language. A task with a brief in one language and not
  // the other is worse than none: the user toggles, gets a blank, and stops trusting the toggle.
  for (const t of ids.values()) {
    const b = t.brief
    if (!b) { issues.push({ kind: 'brief_missing', detail: `task-type '${t.id}' has no brief` }); continue }
    for (const lang of ['en', 'te'] as const) {
      const pts = b[lang] ?? []
      if (pts.length !== 3) issues.push({ kind: 'brief_count', detail: `task-type '${t.id}' has ${pts.length} ${lang} brief points (need exactly 3)` })
      for (const line of pts)
        if (!line.trim()) issues.push({ kind: 'brief_empty', detail: `task-type '${t.id}' has an empty ${lang} brief point` })
    }
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
