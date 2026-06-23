/**
 * _translit — deterministic Indic → Latin transliteration for NAMES.
 *
 * The universal Latin gate: a payee/project name must never be stored in native
 * script, no matter the path it arrived by (LLM extractor output OR a raw follow-up
 * answer). The LLM is asked to transliterate, but it occasionally slips and the
 * follow-up answer is captured verbatim — so this runs as a deterministic guard.
 *
 * It acts ONLY on native script (Telugu U+0C00–0C7F, Devanagari U+0900–097F). Any
 * string already in Latin/ASCII is returned UNCHANGED, so it is safe to run on every
 * name unconditionally (idempotent on Latin). Output is a clean ASCII approximation —
 * not folk-perfect, but matchable/searchable and editable in the Day Book.
 */

// ── Telugu ─────────────────────────────────────────────────────────────────────
const TE_VOWEL: Record<string, string> = {
  'అ': 'a', 'ఆ': 'a', 'ఇ': 'i', 'ఈ': 'i', 'ఉ': 'u', 'ఊ': 'u', 'ఋ': 'ru', 'ౠ': 'ru',
  'ఎ': 'e', 'ఏ': 'e', 'ఐ': 'ai', 'ఒ': 'o', 'ఓ': 'o', 'ఔ': 'au',
}
const TE_MATRA: Record<string, string> = {
  'ా': 'a', 'ి': 'i', 'ీ': 'i', 'ు': 'u', 'ూ': 'u', 'ృ': 'ru',
  'ె': 'e', 'ే': 'e', 'ై': 'ai', 'ొ': 'o', 'ో': 'o', 'ౌ': 'au',
}
const TE_CONS: Record<string, string> = {
  'క': 'k', 'ఖ': 'kh', 'గ': 'g', 'ఘ': 'gh', 'ఙ': 'ng',
  'చ': 'ch', 'ఛ': 'chh', 'జ': 'j', 'ఝ': 'jh', 'ఞ': 'ny',
  'ట': 't', 'ఠ': 'th', 'డ': 'd', 'ఢ': 'dh', 'ణ': 'n',
  'త': 't', 'థ': 'th', 'ద': 'd', 'ధ': 'dh', 'న': 'n',
  'ప': 'p', 'ఫ': 'ph', 'బ': 'b', 'భ': 'bh', 'మ': 'm',
  'య': 'y', 'ర': 'r', 'ఱ': 'r', 'ల': 'l', 'ళ': 'l', 'వ': 'v',
  'శ': 'sh', 'ష': 'sh', 'స': 's', 'హ': 'h',
}

// ── Devanagari (Hindi) ─────────────────────────────────────────────────────────
const DV_VOWEL: Record<string, string> = {
  'अ': 'a', 'आ': 'a', 'इ': 'i', 'ई': 'i', 'उ': 'u', 'ऊ': 'u', 'ऋ': 'ri',
  'ए': 'e', 'ऐ': 'ai', 'ओ': 'o', 'औ': 'au',
}
const DV_MATRA: Record<string, string> = {
  'ा': 'a', 'ि': 'i', 'ी': 'i', 'ु': 'u', 'ू': 'u', 'ृ': 'ri',
  'े': 'e', 'ै': 'ai', 'ो': 'o', 'ौ': 'au',
}
const DV_CONS: Record<string, string> = {
  'क': 'k', 'ख': 'kh', 'ग': 'g', 'घ': 'gh', 'ङ': 'ng',
  'च': 'ch', 'छ': 'chh', 'ज': 'j', 'झ': 'jh', 'ञ': 'ny',
  'ट': 't', 'ठ': 'th', 'ड': 'd', 'ढ': 'dh', 'ण': 'n',
  'त': 't', 'थ': 'th', 'द': 'd', 'ध': 'dh', 'न': 'n',
  'प': 'p', 'फ': 'ph', 'ब': 'b', 'भ': 'bh', 'म': 'm',
  'य': 'y', 'र': 'r', 'ल': 'l', 'व': 'v', 'श': 'sh', 'ष': 'sh', 'स': 's', 'ह': 'h',
}

interface Scheme {
  vowel: Record<string, string>
  matra: Record<string, string>
  cons: Record<string, string>
  virama: string
  anusvara: string[] // chars treated as anusvara (-> m/n)
  visarga: string
}
const TE: Scheme = { vowel: TE_VOWEL, matra: TE_MATRA, cons: TE_CONS, virama: '్', anusvara: ['ం', 'ఁ'], visarga: 'ః' }
const DV: Scheme = { vowel: DV_VOWEL, matra: DV_MATRA, cons: DV_CONS, virama: '्', anusvara: ['ं', 'ँ'], visarga: 'ः' }

const NATIVE_RE = /[ఀ-౿ऀ-ॿ]/
const TELUGU_RE = /[ఀ-౿]/

function transliterate(s: string, sc: Scheme): string {
  const chars = [...s]
  let out = ''
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i]
    if (c in sc.cons) {
      out += sc.cons[c]
      const next = chars[i + 1]
      if (next === sc.virama) { i++; continue }                 // dead consonant (conjunct)
      if (next && next in sc.matra) { out += sc.matra[next]; i++; continue } // explicit vowel
      out += 'a'                                                 // inherent vowel
      continue
    }
    if (c in sc.vowel) { out += sc.vowel[c]; continue }
    if (sc.anusvara.includes(c)) {                              // nasal: m before labials, else n
      const nx = chars[i + 1]
      const base = nx && nx in sc.cons ? sc.cons[nx] : ''
      out += /^[pbm]/.test(base) ? 'm' : 'n'
      continue
    }
    if (c === sc.visarga) { out += 'h'; continue }
    if (c in sc.matra) { out += sc.matra[c]; continue }         // stray matra
    out += c                                                     // digits / spaces / Latin passthrough
  }
  return out
}

function titleCase(s: string): string {
  return s.replace(/(^|\s)([a-z])/g, (_, sp, ch) => sp + ch.toUpperCase())
}

/**
 * Force a NAME to Latin. Native script (Telugu/Devanagari) is transliterated; a string
 * already in Latin/ASCII is returned unchanged. Null/empty-safe.
 */
export function toLatinName(s: string | null | undefined): string | null {
  if (s == null) return null
  if (!NATIVE_RE.test(s)) return s                    // already Latin (or empty) — untouched
  const sc = TELUGU_RE.test(s) ? TE : DV
  const out = transliterate(s.replace(/[‌‍]/g, ''), sc) // drop ZWJ/ZWNJ first
    .normalize('NFKD').replace(/[̀-ͯ]/g, '') // strip any residual combining marks
    .replace(/\s+/g, ' ').trim()
  return titleCase(out) || s
}
