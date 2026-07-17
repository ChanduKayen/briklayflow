// WhatsApp Sprint 4 -- payee/project fuzzy matching with confidence bands.
// Algorithm ported from ai-extract-entry's matchPayee/matchProject (Supabase
// bundles each function separately, so cross-function import isn't practical --
// this is the same logic, co-located, not a new approach).
//
// Bands (configurable as TXN_*). Sprint 5 A2: PAYEE and PROJECT have SEPARATE auto
// thresholds -- attributing a payment to the wrong PERSON is worse than the wrong
// project, so payee needs near-exact for auto; anything fuzzy -> confirm (buttons).
//   auto    (>= the kind's auto threshold) -> use silently, don't ask
//   confirm (>= TXN_CONFIRM)               -> use but surface (reply buttons)
//   open    (below, or no match)           -> keep raw, ask only if core

const TXN_PAYEE_AUTO   = Number(Deno.env.get('TXN_PAYEE_AUTO_THRESHOLD')   ?? '0.95') // near-exact
const TXN_PROJECT_AUTO = Number(Deno.env.get('TXN_PROJECT_AUTO_THRESHOLD') ?? Deno.env.get('TXN_AUTO_THRESHOLD') ?? '0.82')
const TXN_CONFIRM      = Number(Deno.env.get('TXN_CONFIRM_THRESHOLD')      ?? '0.60')

export type Band = 'auto' | 'confirm' | 'open'
// `closest` is a RANKED list, not a shortlist — every row carries its score because its consumers floor at
// DIFFERENT heights, and a row's score is the only thing that makes that possible. See pickable() below.
export type Match = { band: Band; id: string | null; name: string | null; score: number; closest: { id: string; name: string; score: number }[] }

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length
  const dp: number[][] = []
  for (let i = 0; i <= m; i++) { dp[i] = [i]; for (let j = 1; j <= n; j++) dp[i][j] = 0 }
  for (let j = 0; j <= n; j++) dp[0][j] = j
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1])
  return dp[m][n]
}
function initials(name: string): string {
  return name.split(/[\s'-]+/).map((w) => w[0] || '').join('').toUpperCase()
}
function bandOf(score: number, autoThreshold: number): Band {
  return score >= autoThreshold ? 'auto' : score >= TXN_CONFIRM ? 'confirm' : 'open'
}

// Distinctive-token matching — people rarely repeat a stored project name verbatim; they
// say the memorable word ("Lakshmi") and drop the filler ("villa/project/site"). FILLER is
// stripped before comparing, and tokenisation folds punctuation/case so "LAKSHMI-001" and
// "Sri Lakshmi Residence" both surface "lakshmi". (Filler words are construction-project
// generics; they never appear in person names, so this is inert for payee matching.)
const FILLER = new Set([
  'villa', 'villas', 'site', 'sites', 'project', 'projects', 'building', 'buildings',
  'apartment', 'apartments', 'apt', 'apts', 'residency', 'residences', 'residence',
  'enclave', 'towers', 'tower', 'homes', 'home', 'flats', 'flat', 'block', 'blocks',
  'phase', 'plot', 'plots', 'the',
])
function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean)
}
/** Content tokens with filler removed; falls back to all tokens if everything was filler. */
export function distinctiveTokens(s: string): string[] {
  const t = tokenize(s).filter((w) => !FILLER.has(w))
  return t.length ? t : tokenize(s)
}

/** Score one candidate name against the query in 0..1 (1 = exact). */
function scoreName(q: string, name: string): number {
  const sn = name.toLowerCase()
  if (sn === q) return 1.0
  if ((sn.includes(q) && q.length >= 3) || (q.includes(sn) && sn.length >= 3)) return 0.9
  if (sn.split(/\s+/)[0] === q.split(/\s+/)[0] && q.length > 2) return 0.8
  // Exact full-initialism ("SRC" ↔ "Sri Raghavendra Constructions") is a STRUCTURAL match — every initial
  // lines up, not a coincidental token — so it earns the PROJECT auto band (a supervisor typing a site's
  // initials should resolve, not be re-asked). Two sites sharing initials still both land 'auto' → the
  // ambiguous-auto path disambiguates (never a silent guess). Payee auto (0.95) is untouched: for people an
  // initialism stays 'confirm' (buttons) — attributing money to the wrong person needs near-exact.
  const abbr = initials(name); const qClean = q.replace(/\s+/g, '').toUpperCase()
  if (abbr === qClean && qClean.length >= 2) return 0.85
  if (sn.split(/\s+/).some((w) => w.startsWith(q) && q.length >= 3)) return 0.7
  // Distinctive-token overlap — only for NAME-LIKE queries (<=4 content tokens), so a whole
  // narration scanned for an embedded name can't loose-match on a single coincidental word
  // (that path stays on the strict substring/levenshtein scoring below — precision wins).
  const qd = distinctiveTokens(q)
  if (qd.length && qd.length <= 4) {
    const nd = new Set(distinctiveTokens(sn))
    if (qd.every((w) => nd.has(w))) return 0.9              // every distinctive query word is in the name
    if (qd.some((w) => w.length >= 4 && nd.has(w))) return 0.85  // a shared distinctive (>=4-char) word
  }
  const d = levenshtein(q, sn); const rel = d / Math.max(q.length, sn.length)
  if (d <= 2) return 0.7
  if (rel <= 0.4) return 0.55
  return Math.max(0, 1 - rel)
}

function match(raw: string | null, rows: { id: string; name: string }[], autoThreshold: number): Match {
  const empty: Match = { band: 'open', id: null, name: null, score: 0, closest: [] }
  if (!raw?.trim() || !rows.length) return empty
  const q = raw.toLowerCase().trim()
  const scored = rows.map((r) => ({ ...r, s: scoreName(q, r.name) })).sort((a, b) => b.s - a.s)
  const top = scored[0]
  const closest = scored.slice(0, 3).map((r) => ({ id: r.id, name: r.name, score: r.s }))
  const band = bandOf(top.s, autoThreshold)
  return band === 'open'
    ? { band: 'open', id: null, name: null, score: top.s, closest }
    : { band, id: top.id, name: top.name, score: top.s, closest }
}

/** The rows a PICK may offer — those the matcher would actually stand behind (>= TXN_CONFIRM).
 *
 *  `closest` is a top-3 slice with no floor of its own, and it never was one: in an org with three
 *  stakeholders all three are "closest" to every query. Asked about "sreenu" it returned
 *  Srinu (0.70) · Suribabu (0.375) · Raju (0.333) — and the pick offered all three by name, which reads to
 *  the man holding the phone as "we have three people who might be Srinu". We have one.
 *
 *  This is the payee twin of the rule mSitePick already states: no 'nearest' filler. A row in a pick is a
 *  claim that this could be who he meant. Below the confirm band there is no such claim to make — and if
 *  NOTHING clears it, an empty list is the honest answer (the caller says "I don't have anyone by that
 *  name", which is true, instead of asking him to choose between strangers).
 *
 *  Deliberately NOT applied inside match(): transaction.ts's Day Book "did you mean…" reads closest[0] at a
 *  LOWER floor (TXN_SUGGEST_FLOOR, 0.45). Too weak to OFFER and worth WHISPERING are different questions. */
export function pickable(m: Match): { id: string; name: string; score: number }[] {
  return m.closest.filter((c) => c.score >= TXN_CONFIRM)
}

export function matchPayee(raw: string | null, stakeholders: { stakeholder_id: string; name: string }[]): Match {
  return match(raw, stakeholders.map((s) => ({ id: s.stakeholder_id, name: s.name })), TXN_PAYEE_AUTO)
}

export function matchProject(raw: string | null, projects: { project_id: string; name: string }[]): Match {
  return match(raw, projects.map((p) => ({ id: p.project_id, name: p.name })), TXN_PROJECT_AUTO)
}

/** Every project scored + banded against the query, sorted best-first. resolveProject uses
 *  this (not just the single best) so it can tell a clean single auto-match from a genuine
 *  multi-project ambiguity (two buildings sharing the named token) → disambiguate, not guess. */
export function scoreProjects(
  raw: string | null,
  projects: { project_id: string; name: string }[],
): { id: string; name: string; score: number; band: Band }[] {
  if (!raw?.trim() || !projects.length) return []
  const q = raw.toLowerCase().trim()
  return projects
    .map((p) => {
      const score = scoreName(q, p.name)
      return { id: p.project_id, name: p.name, score, band: bandOf(score, TXN_PROJECT_AUTO) }
    })
    .sort((a, b) => b.score - a.score)
}
