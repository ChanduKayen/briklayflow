// One banding primitive shared by the payee matcher (payeeSearch.ts) and the project matcher
// (projectSearch.ts), so the Transactions importer resolves NAMES and SITES through the exact same
// auto/confirm/open logic and "which one?" doubt rule — only the scorer and the auto floor differ
// (people need near-exact, 0.95; projects auto at 0.82). Mirrors the Edge Function's bands
// (_match.ts): auto → use silently, confirm → surface with alternates, open → no match.

export type Band = 'auto' | 'confirm' | 'open';

export interface Scored { id: string; name: string; score: number }

export interface BandedMatch {
  band: Band;
  best: Scored | null;   // top candidate once it clears the confirm floor
  alts: Scored[];        // other candidates worth offering (>= confirm), best-first, best excluded
  doubt: boolean;        // confirm-grade top OR a near-tie with the runner-up → surface a "?"
  closest: Scored[];     // raw top-3 with scores, no floor — for callers that floor lower
}

export const CONFIRM_FLOOR = 0.60;

/**
 * Rank `rows` against `raw` with `scorer`, then band the top hit. `autoFloor` is the score at or
 * above which the top is taken as a confident match (payee 0.95, project 0.82). `doubt` fires when
 * the top is only confirm-grade, or a runner-up is within 0.1 of it — the "two Sri Lakshmis, which?"
 * signal the importer renders as the prototype's red "?".
 */
export function bandedMatch<T extends { id: string; name: string }>(
  raw: string | null | undefined,
  rows: T[],
  scorer: (q: string, row: T) => number,
  autoFloor: number,
  confirmFloor: number = CONFIRM_FLOOR,
): BandedMatch {
  const empty: BandedMatch = { band: 'open', best: null, alts: [], doubt: false, closest: [] };
  const q = (raw ?? '').toLowerCase().trim();
  if (!q || !rows.length) return empty;

  const scored: Scored[] = rows
    .map((r) => ({ id: r.id, name: r.name, score: scorer(q, r) }))
    .sort((a, b) => b.score - a.score || a.name.length - b.name.length);
  const closest = scored.slice(0, 3);
  const top = scored[0];
  const band: Band = top.score >= autoFloor ? 'auto' : top.score >= confirmFloor ? 'confirm' : 'open';
  if (band === 'open') return { ...empty, closest };

  const alts = scored.filter((s) => s.score >= confirmFloor && s.id !== top.id);
  const nearTie = alts.length > 0 && top.score - alts[0].score < 0.1;
  return { band, best: top, alts, doubt: band === 'confirm' || nearTie, closest };
}
