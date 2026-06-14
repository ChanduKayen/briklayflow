// WhatsApp Sprint 4 -- payee/project fuzzy matching with confidence bands.
// Algorithm ported from ai-extract-entry's matchPayee/matchProject (Supabase
// bundles each function separately, so cross-function import isn't practical --
// this is the same logic, co-located, not a new approach).
//
// Bands (mirror the SKU_* thresholds, configurable as TXN_*):
//   auto    (>= TXN_AUTO_THRESHOLD, default 0.82)  -> use silently, don't ask
//   confirm (>= TXN_CONFIRM_THRESHOLD, default 0.60) -> use but surface ("-> The Pride?")
//   open    (below, or no match)                    -> keep raw, ask only if core

const TXN_AUTO    = Number(Deno.env.get('TXN_AUTO_THRESHOLD')    ?? '0.82')
const TXN_CONFIRM = Number(Deno.env.get('TXN_CONFIRM_THRESHOLD') ?? '0.60')

export type Band = 'auto' | 'confirm' | 'open'
export type Match = { band: Band; id: string | null; name: string | null; score: number; closest: { id: string; name: string }[] }

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
function bandOf(score: number): Band {
  return score >= TXN_AUTO ? 'auto' : score >= TXN_CONFIRM ? 'confirm' : 'open'
}

/** Score one candidate name against the query in 0..1 (1 = exact). */
function scoreName(q: string, name: string): number {
  const sn = name.toLowerCase()
  if (sn === q) return 1.0
  if ((sn.includes(q) && q.length >= 3) || (q.includes(sn) && sn.length >= 3)) return 0.9
  if (sn.split(/\s+/)[0] === q.split(/\s+/)[0] && q.length > 2) return 0.8
  const abbr = initials(name); const qClean = q.replace(/\s+/g, '').toUpperCase()
  if (abbr === qClean && qClean.length >= 2) return 0.75
  if (sn.split(/\s+/).some((w) => w.startsWith(q) && q.length >= 3)) return 0.7
  const d = levenshtein(q, sn); const rel = d / Math.max(q.length, sn.length)
  if (d <= 2) return 0.7
  if (rel <= 0.4) return 0.55
  return Math.max(0, 1 - rel)
}

function match(raw: string | null, rows: { id: string; name: string }[]): Match {
  const empty: Match = { band: 'open', id: null, name: null, score: 0, closest: [] }
  if (!raw?.trim() || !rows.length) return empty
  const q = raw.toLowerCase().trim()
  const scored = rows.map((r) => ({ ...r, s: scoreName(q, r.name) })).sort((a, b) => b.s - a.s)
  const top = scored[0]
  const closest = scored.slice(0, 3).map((r) => ({ id: r.id, name: r.name }))
  const band = bandOf(top.s)
  return band === 'open'
    ? { band: 'open', id: null, name: null, score: top.s, closest }
    : { band, id: top.id, name: top.name, score: top.s, closest }
}

export function matchPayee(raw: string | null, stakeholders: { stakeholder_id: string; name: string }[]): Match {
  return match(raw, stakeholders.map((s) => ({ id: s.stakeholder_id, name: s.name })))
}

export function matchProject(raw: string | null, projects: { project_id: string; name: string }[]): Match {
  return match(raw, projects.map((p) => ({ id: p.project_id, name: p.name })))
}
