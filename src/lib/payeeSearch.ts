// Payee search for the browser — the Day Book's approve/edit picker.
//
// Mirrors the Edge Function's scorer (supabase/functions/whatsapp-webhook/_match.ts `scoreName`) but ships
// to the browser, so the picker ranks locally with no RPC round-trip. A direct import is not possible:
// _match.ts reads Deno.env at module scope and would not survive the bundle.
// UPDATE BOTH FILES TOGETHER when changing the scoring — the same convention as src/lib/brandFilter.ts,
// and the reason is not tidiness: when WhatsApp and the Day Book disagree about who "sreenu" is, the man
// gets one answer on his phone and a different one on his screen, and neither is debuggable from the other.
//
// ══ WHY THIS FILE EXISTS ═══════════════════════════════════════════════════════════════════════════════
//
// The picker filtered with a raw substring:
//
//     stakeholders.filter((s) => s.name.toLowerCase().includes(payeeSearch.toLowerCase()))
//
// Type "sreenu" and `"srinu".includes("sreenu")` is false. Every stakeholder is filtered out, the dropdown
// finds nothing — and its zero-match branch promotes "Create *sreenu*" to the top as the hero action. So the
// picker did not merely fail to find Srinu: it invited the owner to file a SECOND Srinu, one tap away.
// Two Srinus in the roster, and every future payment splits between them at random.
//
// The scorer this mirrors already knew the answer — matchPayee('sreenu') scores Srinu at 0.70 and asks
// "which Srinu?" on WhatsApp. The Day Book had a dumber matcher standing in the same place, and lost.
//
// ══ WHY NOT JUST SWAP includes() FOR THE SCORER ════════════════════════════════════════════════════════
//
// Because a search box is typed one letter at a time, and the scorer is built to judge a WHOLE name. Its
// substring and prefix rules both require q.length >= 3, so "s" and "sr" fall through to Levenshtein and
// score near zero — scoreName('s', 'srinu') is 0.2. A pure swap would empty the dropdown on the first two
// keystrokes of every search, and hand back the same "Create…" hero it was written to prevent.
//
// So: a substring hit ALWAYS survives (that is what incremental typing is), and the fuzzy score is what
// RESCUES the spellings a substring can never reach. Union, not replacement, ranked so the tightest match
// leads.

import { bandedMatch, type BandedMatch } from './matchBand';

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

/**
 * Score one stored name against a query, 0..1 (1 = exact). Ported from _match.ts `scoreName`, minus the
 * project-only rules (FILLER stripping, initialisms) — this path only ever sees PEOPLE.
 *
 * The d <= 2 rule is what carries Indian romanisation variance, and it carries more of it than it looks:
 * sreenu/Srinu, naveen/Navin, praveen/Pravin, santhosh/Santosh, baskar/Bhaskar, reddi/Reddy are each a
 * one- or two-edit hop. It does NOT reach the multi-character substitutions — laxmi/Lakshmi (ksh→x) is
 * three edits and scores 0.57. That gap is real and known; see the note in payeeSearch.test.ts.
 */
export function scorePayeeName(q: string, name: string): number {
  const sn = name.toLowerCase();
  if (sn === q) return 1.0;
  if ((sn.includes(q) && q.length >= 3) || (q.includes(sn) && sn.length >= 3)) return 0.9;
  if (sn.split(/\s+/)[0] === q.split(/\s+/)[0] && q.length > 2) return 0.8;
  if (sn.split(/\s+/).some((w) => w.startsWith(q) && q.length >= 3)) return 0.7;
  const d = levenshtein(q, sn);
  const rel = d / Math.max(q.length, sn.length);
  if (d <= 2) return 0.7;
  if (rel <= 0.4) return 0.55;
  return Math.max(0, 1 - rel);
}

/** The floor a row must clear to be worth showing. Mirrors TXN_CONFIRM (_match.ts) — below it the Edge
 *  scorer says "nothing is near", and the Day Book must not claim otherwise. */
export const PAYEE_SEARCH_FLOOR = 0.6;

/** Payee AUTO floor — near-exact, mirrors _match.ts TXN_PAYEE_AUTO. Attributing money to the wrong
 *  PERSON is worse than the wrong project, so people need near-exact to auto-link; anything fuzzy is a
 *  confirm (the importer surfaces it with a "?"). */
export const PAYEE_AUTO_FLOOR = 0.95;

// ══ ROLE-AWARE, JUMBLE-TOLERANT MATCHING (importer only) ═══════════════════════════════════════════════
//
// scorePayeeName above is the WhatsApp/Day-Book mirror and must stay byte-for-byte with _match.ts — do NOT
// change it. The importer, though, has two facts that path never had: the stakeholder's NATURE (type +
// trade) and a full grid where "which Raju?" can be asked cheaply. scorePayeeRich uses both, and treats a
// name as a BAG OF TOKENS so order and length don't matter:
//
//   • jumbled     — "Aradadi Raju" ≡ "Raju Aradadi" (token-set, not first-word)
//   • short↔full  — "Raju" vs "Raju Aradadi" is a partial (confirm/ask), not a miss or a silent guess
//   • the NATURE  — "Raju supervisor" prefers Raju Kojjavrapu (supervisor) over Raju Aradadi (painter)
//
// The per-token compare still tolerates 1–2 edits, so romanisation (sreenu→Srinu) survives token-wise, and
// the whole-name mirror is kept as a floor so nothing the old scorer caught regresses.

/** Occupation words → canonical role. PEOPLE roles only — deliberately NO material/product words
 *  (steel, cement, granite, sand, marble), so a vendor like "B R Granites" keeps "granites" as identity. */
const OCCUPATION_SYN: Record<string, string[]> = {
  supervisor: ['supervisor', 'super', 'incharge', 'foreman', 'maistri', 'mestri', 'mesthri', 'mastri', 'manager'],
  painter: ['painter', 'painting'],
  electrician: ['electrician', 'electric', 'electrical', 'wireman', 'wiring'],
  plumber: ['plumber', 'plumbing', 'sanitary'],
  carpenter: ['carpenter', 'carpentry'],
  mason: ['mason', 'masonry', 'brickwork'],
  welder: ['welder', 'welding', 'fabricator'],
  barbender: ['barbender', 'bender', 'steelfixer', 'fitter'],
  driver: ['driver', 'driving', 'operator'],
  helper: ['helper', 'coolie', 'mazdoor', 'labour', 'labourer', 'labor'],
  plasterer: ['plasterer', 'plastering', 'plaster'],
  centering: ['centering', 'shuttering', 'formwork'],
};
const CANON_OF = new Map<string, string>();          // synonym → canonical
for (const [canon, syns] of Object.entries(OCCUPATION_SYN)) for (const s of syns) CANON_OF.set(s, canon);
const HONORIFICS = new Set(['mr', 'mrs', 'ms', 'sri', 'shri', 'smt', 'ji', 'the', 'and']);

const ROLE_BONUS = 0.15;      // a matching trade lifts a partial name toward a confident pick
const ROLE_PENALTY = 0.18;    // a KNOWN but different trade pushes the wrong same-name person down

function tokenize(s: string): string[] {
  return s.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !HONORIFICS.has(t));
}
const isOccupation = (t: string): boolean => CANON_OF.has(t);
const canonRole = (t: string): string => CANON_OF.get(t) ?? '';
const isKnownTrade = (c?: string | null): boolean => {
  const s = (c ?? '').trim().toLowerCase();
  return !!s && s !== 'general' && s !== 'other';
};

/** Fuzzy equality of two name tokens, 0..1. Prefix + 1–2 edits carry romanisation token-wise. */
function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  const min = Math.min(a.length, b.length);
  if (min >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.92;
  if (min >= 3 && levenshtein(a, b) <= 2) return 0.85;
  const rel = levenshtein(a, b) / Math.max(a.length, b.length);
  return rel <= 0.34 ? 0.7 : 0;
}

/** Order-independent token-bag similarity. Weighted toward covering the QUERY (the sheet name we're
 *  resolving); candidate coverage guards a one-token query from latching a long unrelated name. */
function nameTokenScore(qT: string[], cT: string[]): number {
  if (!qT.length || !cT.length) return 0;
  const cover = (from: string[], to: string[]): number => {
    const used = new Set<number>();
    let sum = 0;
    for (const a of from) {
      let best = 0, bi = -1;
      to.forEach((b, i) => { if (used.has(i)) return; const s = tokenSim(a, b); if (s > best) { best = s; bi = i; } });
      if (bi >= 0 && best > 0) used.add(bi);
      sum += best;
    }
    return sum / from.length;
  };
  return 0.6 * cover(qT, cT) + 0.4 * cover(cT, qT);
}

/** +1 a query role matches the candidate's nature, -1 it contradicts a KNOWN trade, 0 no signal. */
function roleVerdict(qRoles: string[], cand: { name: string; type?: string | null; category?: string | null }): number {
  const candText = `${cand.category ?? ''} ${cand.type ?? ''} ${cand.name}`.toLowerCase();
  const candCanon = new Set(tokenize(candText).map(canonRole).filter(Boolean));
  for (const r of qRoles) {
    const canon = canonRole(r);
    if ((canon && candCanon.has(canon)) || candText.includes(r)) return 1;
  }
  // No role matched — a contradiction only counts when the candidate's trade is actually known.
  const candHasKnownRole = candCanon.size > 0 || isKnownTrade(cand.category);
  return candHasKnownRole ? -1 : 0;
}

/** The importer's payee score: token-bag name similarity + the stakeholder's nature, floored by the
 *  whole-name mirror so nothing the parity scorer caught is lost. */
export function scorePayeeRich(q: string, cand: { name: string; type?: string | null; category?: string | null }): number {
  const query = q.trim().toLowerCase();
  const cname = cand.name.toLowerCase();
  const qAll = tokenize(query);
  const qRoles = qAll.filter(isOccupation);
  let qName = qAll.filter((t) => !isOccupation(t));
  if (!qName.length) qName = qAll;                    // the sheet gave ONLY a role word — use it as the name

  const base = nameTokenScore(qName, tokenize(cname));
  let score = Math.max(base, scorePayeeName(query, cname));

  if (qRoles.length) {
    const v = roleVerdict(qRoles, cand);
    if (v > 0) score = Math.min(1, score + ROLE_BONUS);
    else if (v < 0) score = Math.max(0, score - ROLE_PENALTY);
  }
  return score;
}

/**
 * Banded payee resolution for the Transactions importer — the PEOPLE twin of projectSearch.matchProject,
 * through the shared banding (matchBand.ts). Returns auto/confirm/open + best/alts/doubt so the resolve
 * grid treats names and sites identically. Reads each stakeholder's `type`/`category` (nature) when given.
 */
export function matchPayee(
  raw: string | null | undefined,
  stakeholders: { stakeholder_id: string; name: string; type?: string | null; category?: string | null }[],
): BandedMatch {
  return bandedMatch(
    raw,
    stakeholders.map((s) => ({ id: s.stakeholder_id, name: s.name, type: s.type ?? null, category: s.category ?? null })),
    (q, r) => scorePayeeRich(q, r),
    PAYEE_AUTO_FLOOR,
    PAYEE_SEARCH_FLOOR,
  );
}

/** Rank one name for the SEARCH BOX: the fuzzy score, with substring hits floored so that incremental
 *  typing ("s", "sr") always survives and the tightest match still leads. */
export function rankPayeeName(query: string, name: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const n = name.toLowerCase();
  if (n === q) return 1.0;
  const fuzzy = scorePayeeName(q, n);
  if (n.startsWith(q)) return Math.max(fuzzy, 0.97);       // "sri" → Srinu, ahead of a mid-word hit
  const word = n.split(/\s+/).some((w) => w.startsWith(q));
  if (word) return Math.max(fuzzy, 0.96);                  // "reddy" → Srinu Reddy
  if (n.includes(q)) return Math.max(fuzzy, 0.95);
  return fuzzy;
}

/**
 * The picker's list for a typed query: everything that plausibly matches, tightest first.
 * An empty query is not a search — it is browsing, so the list is returned whole and untouched.
 */
export function searchPayees<T extends { name: string }>(list: T[], query: string): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list
    .map((s) => ({ s, r: rankPayeeName(q, s.name) }))
    .filter((x) => x.r >= PAYEE_SEARCH_FLOOR)
    .sort((a, b) => b.r - a.r || a.s.name.length - b.s.name.length)
    .map((x) => x.s);
}
