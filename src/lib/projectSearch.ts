// Project matching for the browser — the Transactions importer's site-resolution step.
//
// Mirrors the Edge Function's project scorer (supabase/functions/whatsapp-webhook/_match.ts —
// `scoreName` + `distinctiveTokens` + `FILLER` + the auto/confirm/open bands) but ships to the
// browser so the importer can resolve sites locally with no RPC. A direct import is not possible:
// _match.ts reads Deno.env at module scope and would not survive the bundle.
// UPDATE BOTH FILES TOGETHER when changing the scoring — same convention as payeeSearch.ts. The
// reason is not tidiness: when WhatsApp and the importer disagree about which site "KKD site 2" is,
// the same sheet resolves differently depending on the door it came through, and neither is
// debuggable from the other.
//
// payeeSearch.ts is the PEOPLE twin; this is the PROJECT twin. People never carry the filler/
// initialism rules (a person is not "Sri Lakshmi *Residence*"), so the two scorers diverge exactly
// where _match.ts's scoreName does — here we keep the project-only rules, there they are dropped.

import { bandedMatch } from './matchBand';

/** Levenshtein edit distance. Ported verbatim from _match.ts. */
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = [];
  for (let i = 0; i <= m; i++) { dp[i] = [i]; for (let j = 1; j <= n; j++) dp[i][j] = 0; }
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
  return dp[m][n];
}

function initials(name: string): string {
  return name.split(/[\s'-]+/).map((w) => w[0] || '').join('').toUpperCase();
}

// Construction-project generics — stripped before token comparison so "LAKSHMI-001" and
// "Sri Lakshmi Residence" both surface the distinctive "lakshmi". Ported verbatim from _match.ts;
// keep the two lists identical.
const FILLER = new Set([
  'villa', 'villas', 'site', 'sites', 'project', 'projects', 'building', 'buildings',
  'apartment', 'apartments', 'apt', 'apts', 'residency', 'residences', 'residence',
  'enclave', 'towers', 'tower', 'homes', 'home', 'flats', 'flat', 'block', 'blocks',
  'phase', 'plot', 'plots', 'the',
]);

function tokenize(s: string): string[] {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(/\s+/).filter(Boolean);
}

/** Content tokens with filler removed; falls back to all tokens if everything was filler. */
export function distinctiveTokens(s: string): string[] {
  const t = tokenize(s).filter((w) => !FILLER.has(w));
  return t.length ? t : tokenize(s);
}

/**
 * Score one stored PROJECT name against the query, 0..1 (1 = exact). Ported from _match.ts
 * `scoreName` INCLUDING the project-only rules payeeSearch.ts drops: filler-stripped distinctive-
 * token overlap and full-initialism ("SRC" ↔ "Sri Raghavendra Constructions"). Keep in lockstep
 * with _match.ts.
 */
export function scoreProjectName(q: string, name: string): number {
  const sn = name.toLowerCase();
  if (sn === q) return 1.0;
  if ((sn.includes(q) && q.length >= 3) || (q.includes(sn) && sn.length >= 3)) return 0.9;
  if (sn.split(/\s+/)[0] === q.split(/\s+/)[0] && q.length > 2) return 0.8;
  const abbr = initials(name); const qClean = q.replace(/\s+/g, '').toUpperCase();
  if (abbr === qClean && qClean.length >= 2) return 0.85;
  if (sn.split(/\s+/).some((w) => w.startsWith(q) && q.length >= 3)) return 0.7;
  const qd = distinctiveTokens(q);
  if (qd.length && qd.length <= 4) {
    const nd = new Set(distinctiveTokens(sn));
    if (qd.every((w) => nd.has(w))) return 0.9;
    if (qd.some((w) => w.length >= 4 && nd.has(w))) return 0.85;
  }
  const d = levenshtein(q, sn); const rel = d / Math.max(q.length, sn.length);
  if (d <= 2) return 0.7;
  if (rel <= 0.4) return 0.55;
  return Math.max(0, 1 - rel);
}

// Bands mirror _match.ts's TXN_PROJECT_AUTO / TXN_CONFIRM defaults (the Edge reads them from env;
// the browser cannot, so the defaults are the contract here).
export const PROJECT_AUTO_FLOOR = 0.82;
export const PROJECT_CONFIRM_FLOOR = 0.60;

export type { Band, BandedMatch } from './matchBand';
export interface ProjectRow { id: string; name: string }

/**
 * Resolve a raw site mention against the org's projects. Bands the importer's state machine reads:
 * `auto` → collapse as a confident match, `confirm` → show with a "?" and offer alternates, `open` →
 * no match, drop to the create-new form. See bandedMatch/`doubt` in matchBand.ts.
 */
export function matchProject(raw: string | null | undefined, projects: ProjectRow[]) {
  return bandedMatch(raw, projects, (q, r) => scoreProjectName(q, r.name), PROJECT_AUTO_FLOOR, PROJECT_CONFIRM_FLOOR);
}
