// Smart unit-naming — infer a naming scheme from ONE typed example and propagate it across every
// unit on every floor. Display-only: the engine keeps its stable "Unit A" keys (node_keys never
// change); this just produces the labels the UI shows.
//
//   "201" on Second(idx 2), unit 0  → 201 202 …  and  301 302 … (floor up)
//   "1A"  on First(idx 1),  unit 0  → 1A 1B …    and  2A 2B …
//   "G2"  on Ground(idx 0), unit 1  → G1 G2 …    and  H1 H2 … (letter floors)
//
// A unit token is a trailing letter (A,B,C…) or trailing 1–2 digits; the rest is the floor token,
// which increments numerically (preserving width) or as a letter. Unparseable input → {} (no-op).

export interface NameFloor { label: string; index: number; units: number }

export function inferUnitNames(
  typed: string,
  floorIndex: number,
  unitIndex: number,
  floors: NameFloor[],
): Record<string, string[]> {
  const t = typed.trim()
  if (!t) return {}

  // ── unit token: trailing letter, else trailing 1–2 digits ──
  let floorPart = ''
  let unitKind: 'letter' | 'digit'
  let unitBase = 0
  let unitWidth = 1
  const mLetter = t.match(/^(.*?)([A-Za-z])$/)
  const mDigit = t.match(/^(.*?)(\d{1,2})$/)
  if (mLetter && !/\d/.test(mLetter[2])) {
    floorPart = mLetter[1]
    unitKind = 'letter'
    unitBase = (mLetter[2].toUpperCase().charCodeAt(0) - 65) - unitIndex
  } else if (mDigit) {
    floorPart = mDigit[1]
    unitKind = 'digit'
    unitWidth = mDigit[2].length
    unitBase = parseInt(mDigit[2], 10) - unitIndex
  } else {
    return {}
  }

  // ── floor token from the remaining prefix: numeric (increments + width-padded), single letter
  //    (increments as a letter), or a constant literal ──
  let floorKind: 'digit' | 'letter' | 'literal'
  let floorNumBase = 0
  let floorWidth = 1
  let floorLetBase = 0
  const fNum = floorPart.match(/^(\d+)$/)
  const fLet = floorPart.match(/^([A-Za-z])$/)
  if (fNum) { floorKind = 'digit'; floorWidth = fNum[1].length; floorNumBase = parseInt(fNum[1], 10) - floorIndex }
  else if (fLet) { floorKind = 'letter'; floorLetBase = (fLet[1].toUpperCase().charCodeAt(0) - 65) - floorIndex }
  else floorKind = 'literal'

  const out: Record<string, string[]> = {}
  for (const f of floors) {
    const names: string[] = []
    for (let u = 0; u < Math.max(1, f.units); u++) {
      let fp: string
      if (floorKind === 'digit') fp = String(Math.max(0, floorNumBase + f.index)).padStart(floorWidth, '0')
      else if (floorKind === 'letter') { const c = floorLetBase + f.index; fp = c >= 0 && c < 26 ? String.fromCharCode(65 + c) : String(f.index) }
      else fp = floorPart
      let up: string
      if (unitKind === 'letter') { const c = unitBase + u; up = c >= 0 && c < 26 ? String.fromCharCode(65 + c) : String(u + 1) }
      else up = String(Math.max(0, unitBase + u)).padStart(unitWidth, '0')
      names.push(fp + up)
    }
    out[f.label] = names
  }
  return out
}
