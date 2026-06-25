// Site-ops Pass-1 expander — DETERMINISTIC, NO LLM, NO I/O.
//
// Model: a project is an ordered LEVEL STACK (bottom→top). Each level has one or more
// ZONES; each zone has a `use` and (if habitable) a unit count. Phases apply by zone USE,
// not by level name — one rule set covers villa / duplex / stilt-house / apartment with no
// stilt/cellar/floor special-casing.
//
//   level = { label, kind, zones }      kind: 'parking' | 'habitable'
//   zone  = { use, units }              use:  'parking' | 'habitable' | 'semi_residential'
// MVP: exactly one zone per level (porch-on-ground is absorbed into a habitable Ground —
// NOT a separate parking zone). Multi-zone is a reserved capability, unused here.
//
// Phase rules (cardinality in sequence.json → application):
//   once       → site-wide (null floor/unit)
//   per_floor  → frame: EVERY structural level (parking + habitable). Trade-major walk.
//   per_unit   → build_out/finishes: HABITABLE zones × units only. Floor-major walk.
//   common     → only when has_common_areas (site-wide).
// A parking level emits EXACTLY: frame (it's structural) + the one final-phase parking-floor
// task — no build_out, no finishes, no per-unit. seq_no is one monotonic counter (sensible
// linear display order, not a precedence graph — true dependencies are the deferred engine).

export type Cardinality = 'once' | 'per_floor' | 'per_unit' | 'common'
export type ZoneUse = 'parking' | 'habitable' | 'semi_residential'  // semi_residential: treat as habitable for now

export interface SeqTrade { key: string; label: string; note?: string }
export interface SeqPhase { key: string; label: string; cardinality: Cardinality; trades: SeqTrade[] }
export interface Sequence { model: string; phases: SeqPhase[] }

export interface Zone { use: ZoneUse; units: number }
export interface Level { label: string; kind: 'parking' | 'habitable'; zones: Zone[] }
export interface Stack { levels: Level[] }   // bottom → top

/** The three creation questions that default the stack (+ existing has_common_areas). */
export interface CaptureSeed {
  dedicated_parking: 'none' | 'stilt' | 'cellar'
  habitable_floors: number
  units_per_floor: number
  has_common_areas: boolean
}

export interface GeneratedTask {
  phase: string
  trade: string
  floor_label: string | null
  unit_label: string | null
  name: string
  seq_no: number
  source: 'generated'
}

// KNOWN SEAM (deliberate MVP limit): the parking-floor trade lives in the once/final phase,
// so with at most ONE dedicated parking level it's emitted once and the parking level
// "claims" it. Stack two parking levels (cellar AND stilt) and this must become
// per-parking-level — until then it's a single site-wide task by design, not an under-count.
const PARKING_FLOOR_TRADE = 'cellar_parking_flooring'

const ORDINALS = [
  'First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth',
  'Eleventh', 'Twelfth', 'Thirteenth', 'Fourteenth', 'Fifteenth', 'Sixteenth', 'Seventeenth',
  'Eighteenth', 'Nineteenth', 'Twentieth',
]
/** Above-ground upper-floor name. i=1 → First, 2 → Second … (fallback "{i}th" beyond the table). */
function upperLabel(i: number): string { return ORDINALS[i - 1] ?? `${i}th` }

/** Habitable level labels: Ground, then First..(n-1) above it. n=1 → [Ground]. */
function habitableLabels(n: number): string[] {
  const out = ['Ground']
  for (let i = 1; i < Math.max(1, n); i++) out.push(upperLabel(i))
  return out
}

/** Unit labels for a habitable zone. 1 → [null] (villa: no unit label); N → Unit A, Unit B … */
function unitLabels(units: number): (string | null)[] {
  const n = Math.max(1, units)
  return n === 1 ? [null] : Array.from({ length: n }, (_, i) => `Unit ${String.fromCharCode(65 + i)}`)
}

/**
 * Build the concrete level stack from the three capture questions. The expander reads the
 * resolved stack; a future plan-upload can overwrite the same shape with an inferred stack.
 */
export function buildStack(seed: CaptureSeed): Stack {
  const levels: Level[] = []
  // dedicated parking level prepended at the BOTTOM (stilt at grade, cellar below ground)
  if (seed.dedicated_parking === 'cellar')
    levels.push({ label: 'Cellar', kind: 'parking', zones: [{ use: 'parking', units: 0 }] })
  if (seed.dedicated_parking === 'stilt')
    levels.push({ label: 'Stilt', kind: 'parking', zones: [{ use: 'parking', units: 0 }] })
  // habitable levels: Ground, then uppers
  for (const label of habitableLabels(seed.habitable_floors))
    levels.push({ label, kind: 'habitable', zones: [{ use: 'habitable', units: Math.max(1, seed.units_per_floor) }] })
  return { levels }
}

/** Expand a resolved stack + sequence into the ordered task skeleton. */
export function expand(stack: Stack, sequence: Sequence, opts: { has_common_areas: boolean }): GeneratedTask[] {
  const tasks: GeneratedTask[] = []
  let seq = 0
  const push = (p: SeqPhase, t: SeqTrade, floor: string | null, unit: string | null) =>
    tasks.push({
      phase: p.key, trade: t.key, floor_label: floor, unit_label: unit,
      name: t.label, seq_no: ++seq, source: 'generated',
    })

  const allLevels = stack.levels                                        // structural: every level
  const habitableLevels = allLevels.filter((l) => l.kind === 'habitable')
  const hasParkingLevel = allLevels.some((l) => l.kind === 'parking')

  for (const phase of sequence.phases) {
    switch (phase.cardinality) {
      case 'once':
        for (const t of phase.trades) {
          // parking-floor task is gated on a dedicated parking level existing (see KNOWN SEAM)
          if (t.key === PARKING_FLOOR_TRADE && !hasParkingLevel) continue
          push(phase, t, null, null)
        }
        break
      case 'per_floor':   // frame — trade-major: each trade sweeps UP every structural level
        for (const t of phase.trades)
          for (const level of allLevels) push(phase, t, level.label, null)
        break
      case 'per_unit':    // build_out / finishes — floor-major: a whole habitable level before moving up
        for (const level of habitableLevels)
          for (const zone of level.zones.filter((z) => z.use !== 'parking'))
            for (const unit of unitLabels(zone.units))
              for (const t of phase.trades) push(phase, t, level.label, unit)
        break
      case 'common':
        if (opts.has_common_areas) for (const t of phase.trades) push(phase, t, null, null)
        break
    }
  }
  return tasks
}
