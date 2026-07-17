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
