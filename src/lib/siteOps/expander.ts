// Site-ops Pass-1 expander — DETERMINISTIC, NO LLM, NO I/O.
//
// Input:  a project seed (the construction columns on `projects`) + a parsed
//         sequence (docs/site-ops/sequence.json).
// Output: a flat, ordered list of tasks with monotonic seq_no — exactly the rows
//         to insert into site_tasks (the caller adds project_id/org_id and persists).
//
// The caller LOADS the sequence (Vite import in-app, fs in tests) and passes it in,
// so this module never reaches for the file — pure data-in, data-out, trivially testable.
//
// Walk order (sequence.json no longer carries a per-phase `walk`, so it's by cardinality):
//   once       → 1 task per trade (site-wide)
//   per_floor  → TRADE-major: each trade sweeps UP every structural floor
//                (frame: all floors' columns, then all beams … "all slabs in frame order")
//   per_unit   → FLOOR-major: finish a floor (every unit, every trade) before moving up
//   common     → 1 task per trade, only when the project has_common_areas
// seq_no is a single monotonic counter across the whole walk (a sensible linear order,
// not a dependency graph).

export type Cardinality = 'once' | 'per_floor' | 'per_unit' | 'common'

export interface SeqTrade { key: string; label: string; note?: string }
export interface SeqPhase { key: string; label: string; cardinality: Cardinality; trades: SeqTrade[] }
export interface Sequence { model: string; phases: SeqPhase[] }

/** The construction seed — the relevant columns from a `projects` row. */
export interface ProjectSeed {
  floors_above: number
  has_basement?: boolean
  basement_count?: number
  has_stilt?: boolean
  units_per_floor?: number
  has_common_areas?: boolean
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

/** Structural floors bottom→top — the frame covers every level (basements, stilt, above-ground). */
function structuralFloors(seed: ProjectSeed): string[] {
  const floors: string[] = []
  const basements = seed.has_basement ? Math.max(1, seed.basement_count ?? 1) : 0
  for (let b = basements; b >= 1; b--) floors.push(`Basement ${b}`)
  if (seed.has_stilt) floors.push('Stilt')
  const above = Math.max(0, seed.floors_above ?? 0)
  for (let f = 1; f <= above; f++) floors.push(`Floor ${f}`)
  return floors
}

/** Occupied (unit-bearing) floors = above-ground only — basements/stilt hold no flats. */
function occupiedFloors(seed: ProjectSeed): string[] {
  const above = Math.max(0, seed.floors_above ?? 0)
  const floors: string[] = []
  for (let f = 1; f <= above; f++) floors.push(`Floor ${f}`)
  return floors
}

/** Unit labels for a floor. 1 unit → [null] (villa has no unit label); N → Unit A, Unit B … */
function unitLabels(unitsPerFloor: number): (string | null)[] {
  const n = Math.max(1, unitsPerFloor)
  return n === 1 ? [null] : Array.from({ length: n }, (_, i) => `Unit ${String.fromCharCode(65 + i)}`)
}

/** Expand a seed + sequence into the ordered task skeleton. */
export function expand(seed: ProjectSeed, sequence: Sequence): GeneratedTask[] {
  const tasks: GeneratedTask[] = []
  let seq = 0
  const push = (p: SeqPhase, t: SeqTrade, floor: string | null, unit: string | null) =>
    tasks.push({
      phase: p.key, trade: t.key, floor_label: floor, unit_label: unit,
      name: t.label, seq_no: ++seq, source: 'generated',
    })

  for (const phase of sequence.phases) {
    switch (phase.cardinality) {
      case 'once':
        for (const t of phase.trades) push(phase, t, null, null)
        break
      case 'per_floor': // trade-major: a trade sweeps up every structural floor
        for (const t of phase.trades)
          for (const floor of structuralFloors(seed)) push(phase, t, floor, null)
        break
      case 'per_unit': // floor-major: a whole floor (every unit × every trade) before moving up
        for (const floor of occupiedFloors(seed))
          for (const unit of unitLabels(seed.units_per_floor ?? 1))
            for (const t of phase.trades) push(phase, t, floor, unit)
        break
      case 'common':
        if (seed.has_common_areas) for (const t of phase.trades) push(phase, t, null, null)
        break
    }
  }
  return tasks
}
