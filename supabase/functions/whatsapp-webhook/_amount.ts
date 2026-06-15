// Deterministic spoken-amount parser for code-mixed Tinglish/Hindi input (digits +
// English + Telugu + Hindi, in any mix). The amount is the ONE essential that must be
// exact, so the agent's LLM understanding (temperature 0, worked numeral examples) is
// cross-checked HERE in deterministic code: when this parser fully recognizes the
// amount span, its value is authoritative and the LLM's only role is the confidence
// signal. It composes the Indian way -- folding tens+units BEFORE the multiplier:
//   "muppai aidu vela" = (30 + 5) × 1000 = 35,000.

// Units 1..9 (Telugu, common Latin spellings).
const UNITS: Record<string, number> = {
  okati: 1, okkati: 1, oka: 1,
  rendu: 2, rendi: 2,
  mudu: 3, moodu: 3, muudu: 3,
  nalugu: 4, naalugu: 4,
  aidu: 5, aidhu: 5, ayidu: 5, aydu: 5, aaidu: 5,
  aaru: 6, aru: 6,
  edu: 7, eedu: 7, yedu: 7,
  enimidi: 8, enmidi: 8,
  tommidi: 9, thommidi: 9,
}

// Tens 10..90 (already full values -- "muppai" is 30, not 3).
const TENS: Record<string, number> = {
  padi: 10,
  iruvai: 20, iravai: 20, iruvayi: 20, iravayi: 20,
  muppai: 30, muppayi: 30, muppadi: 30,
  nalabai: 40, nalabhai: 40, nalabayi: 40, nalbhai: 40,
  yabhai: 50, abhai: 50, ayabhai: 50, ebhai: 50, yaabhai: 50,
  aravai: 60, aaravai: 60, aravayi: 60,
  debbhai: 70, debadi: 70, debbai: 70,
  enabhai: 80, enabai: 80, enibhai: 80,
  tombhai: 90, thombhai: 90, tombai: 90,
}

// Hindi fractional quantifiers that precede a multiplier: "dedh lakh" = 1.5 × lakh.
const FRACTIONS: Record<string, number> = {
  dedh: 1.5, dedhh: 1.5, deedh: 1.5,
  sava: 1.25, savaa: 1.25,
  dhai: 2.5, dhaai: 2.5, adhai: 2.5,
}

// Multipliers. Telugu + Hindi + English share the table.
const MULT: Record<string, number> = {
  vanda: 100, vandalu: 100, vandhalu: 100, hundred: 100,
  vela: 1000, velu: 1000, veelu: 1000, vey: 1000, veyyi: 1000, veyi: 1000,
  hazaar: 1000, hazar: 1000, thousand: 1000,
  laksha: 100000, laksa: 100000, laksham: 100000, lakshalu: 100000, lakh: 100000, lac: 100000, lakhs: 100000,
  koti: 10000000, kotlu: 10000000, crore: 10000000, crores: 10000000,
}

// Words allowed within the amount span without making it "unrecognized" (currency
// words / "and"). Anything else alphabetic in the span -> not fully recognized.
const CONNECTORS = new Set(['ru', 'rs', 'rupees', 'rupayi', 'rupayilu', 'rupaye', 'rupaya', 'rupay', 'and', 'plus'])

/** A digit token, with optional k/l shorthand: "35000", "35", "5k", "1.5l". */
function parseDigitToken(t: string): number | null {
  const m = t.match(/^(\d+(?:\.\d+)?)(k|l)?$/)
  if (!m) return null
  let n = parseFloat(m[1])
  if (m[2] === 'k') n *= 1000
  else if (m[2] === 'l') n *= 100000
  return n
}

export type SpokenAmount = {
  amount: number | null      // composed value (null if no numeral found / non-positive)
  hasWord: boolean           // saw at least one number WORD (not a bare digit)
  fullyRecognized: boolean   // every alphabetic token in the span is a known numeral/connector
}

/**
 * Parse a code-mixed amount deterministically. Folds tens+units (and a Hindi
 * fractional quantifier) before applying a multiplier; Telugu, Hindi, and English
 * multipliers compose identically. Bare digits are supported, so the same function
 * is the pure-digit fast path AND the spoken-numeral cross-check.
 */
export function parseSpokenAmount(text: string): SpokenAmount {
  const tokens = text.toLowerCase().replace(/,/g, '').match(/\d+(?:\.\d+)?[kl]?|[a-z]+/g) ?? []

  let total = 0, current = 0
  let hasWord = false
  let sawNumeral = false
  let fullyRecognized = true

  for (const t of tokens) {
    const digit = parseDigitToken(t)
    if (digit != null) { current += digit; sawNumeral = true; continue }

    if (t in UNITS || t in TENS || t in FRACTIONS) {
      current += (UNITS[t] ?? TENS[t] ?? FRACTIONS[t]); hasWord = true; sawNumeral = true; continue
    }
    if (t in MULT) {
      const m = MULT[t]
      hasWord = true; sawNumeral = true
      if (current === 0) current = 1            // bare "vela"/"lakh" = 1×
      if (m >= 1000) { total += current * m; current = 0 }  // section multiplier
      else { current = current * m }            // hundred multiplies the current group
      continue
    }
    // an alphabetic token that isn't a numeral or a connector -> span not fully clean
    if (!CONNECTORS.has(t)) fullyRecognized = false
  }
  total += current

  return { amount: sawNumeral && total > 0 ? total : null, hasWord, fullyRecognized }
}
