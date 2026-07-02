// STEP 3 — the ATTACH-vs-OBSERVE decision (PURE). Given a decomposed image ITEM and the project's
// grounded candidate set (open issues + tasks + todos, from loadCandidates), decide whether the photo
// is a RE-PHOTO of an existing open item (ATTACH evidence, never a twin), a genuinely NEW observation
// (OBSERVE — create fresh), or too close to call between several (ASK — the grounded TYPED shortlist).
//
// ASK-ON-ANY-DOUBT (the ruling): auto-ATTACH only on a SINGLE unambiguous match; 2+ plausible → ASK;
// none → OBSERVE. A wrong attach hides evidence on the WRONG item (quiet corruption); a pick is one
// cheap tap. LEXICAL, reusing the SAME floor/trade + subject-token signal the rest of siteops matches
// on (floorFromHint/tradeGroups) — no LLM call, fully unit-tested. The prefilter that narrows the
// vision prompt is NOT reused here as a wall: the resume path (resolveTypedPick) searches the FULL set.
//
// Applies to issue/todo items only — those are the ones ROUTE would CREATE, so those are the ones that
// can TWIN. progress items stay on the task axis (resolveTaskLLM), which already has its own pick.

import { floorFromHint, tradeGroups } from './_siteops_route.ts'
import type { Candidate } from './_siteops_candidates.ts'
import type { SiteItem } from './_siteops_extract.ts'

export type AttachDecision =
  | { kind: 'attach'; target: Candidate }        // exactly one plausible existing item → attach evidence
  | { kind: 'ask'; shortlist: Candidate[] }      // several plausible → the grounded typed pick
  | { kind: 'observe' }                          // nothing plausible → create fresh (OBSERVE)

// A minimal, kind-agnostic pick candidate — what the pick STORES + the resume matches against.
export interface PickCandidate { kind: string; id: string; label: string }

// Subject stopwords — site-generic filler that must not create a false match (mirrors _siteops_assoc's
// intent). Kept tight so a real one-word subject ("honeycombing", "cement") always survives.
const STOP = new Set([
  'this', 'that', 'with', 'from', 'work', 'site', 'done', 'area', 'side', 'floor', 'unit', 'slab',
  'wall', 'about', 'there', 'here', 'update', 'note', 'photo', 'today', 'left', 'right', 'near',
])
/** Distinctive subject tokens: lowercased words len>=4, not stopwords. */
function subjectTokens(s: string): Set<string> {
  const out = new Set<string>()
  for (const w of (s.toLowerCase().match(/[a-z]+/g) ?? [])) if (w.length >= 4 && !STOP.has(w)) out.add(w)
  return out
}

/** Score ONE candidate against the item. `plausible` gates entry to the decision; `s` ranks the shortlist.
 *  A trade-group hit or a shared distinctive subject token makes it plausible — floor ALONE never does
 *  (too weak: every item on a floor would match). */
function scoreCandidate(item: SiteItem, cand: Candidate): { plausible: boolean; s: number } {
  const itemText = `${item.text} ${item.task_hint ?? ''}`
  const tradeHit = tradeGroups(itemText).some((g) => tradeGroups(cand.tradeText).includes(g))
  const st = subjectTokens(itemText)
  const ct = subjectTokens(`${cand.label} ${cand.tradeText}`)
  let subj = 0
  for (const t of st) if (ct.has(t)) subj++
  const f = floorFromHint(item.task_hint) ?? floorFromHint(item.text)
  const floorHit = !!(f && cand.floor && f === cand.floor)
  const plausible = tradeHit || subj >= 1
  const s = (tradeHit ? 2 : 0) + subj + (floorHit ? 1 : 0)
  return { plausible, s }
}

/**
 * Decide ATTACH / ASK / OBSERVE for one issue/todo item against the project's candidate set. PURE.
 * Ask-on-any-doubt: 0 plausible → observe, 1 → attach (the single unambiguous match), 2+ → ask.
 */
export function decideAttach(cands: Candidate[], item: SiteItem, cap = 6): AttachDecision {
  const scored = cands
    .map((c) => ({ c, ...scoreCandidate(item, c) }))
    .filter((x) => x.plausible)
    .sort((a, b) => b.s - a.s)
  if (!scored.length) return { kind: 'observe' }
  if (scored.length === 1) return { kind: 'attach', target: scored[0].c }
  return { kind: 'ask', shortlist: scored.slice(0, cap).map((x) => x.c) }
}

/**
 * Plan a whole photo's decomposed items against the candidate set. PURE — the journey-test seam.
 *   • attaches — issue/todo items that matched exactly one open item (attach evidence, no twin).
 *   • asks     — issue/todo items ambiguous over several (the grounded typed pick).
 *   • rest     — everything ROUTE should still create/route: progress items (task axis) + OBSERVE
 *                issue/todo items (no match → genuinely new).
 * The caller opens ONE typed pick (asks[0]); any extra asks fall into `rest` (OBSERVE — create fresh,
 * recoverable) rather than stacking picks. A single photo rarely decomposes into 2+ ambiguous items.
 */
export function planPhotoItems(cands: Candidate[], items: SiteItem[]): {
  attaches: { item: SiteItem; target: Candidate }[]
  asks: { item: SiteItem; shortlist: Candidate[] }[]
  rest: SiteItem[]
} {
  const attaches: { item: SiteItem; target: Candidate }[] = []
  const asks: { item: SiteItem; shortlist: Candidate[] }[] = []
  const rest: SiteItem[] = []
  for (const item of items) {
    if (item.type !== 'issue' && item.type !== 'todo') { rest.push(item); continue }   // progress → task axis
    const d = decideAttach(cands, item)
    if (d.kind === 'attach') attaches.push({ item, target: d.target })
    else if (d.kind === 'ask') asks.push({ item, shortlist: d.shortlist })
    else rest.push(item)   // observe → create fresh via routeItems
  }
  // Only the FIRST ambiguous item becomes a pick; extras OBSERVE (into rest) to avoid stacking picks.
  for (const extra of asks.slice(1)) rest.push(extra.item)
  return { attaches, asks: asks.slice(0, 1), rest }
}

/**
 * Resolve a reply to an open typed pick. PURE. Handles a numeric tap (into the shortlist, with the
 * trailing "None — it's new" row) AND a typed answer. TYPED-ANSWER FULL-SET FALLBACK (the amendment):
 * a typed label is searched in the shortlist FIRST, then the FULL candidate set — the vision-prompt
 * prefilter must never wall off a valid human answer that names an item off the shortlist.
 */
export function resolveTypedPick(
  shortlist: PickCandidate[], full: PickCandidate[], text: string,
): { kind: 'attach'; target: PickCandidate } | { kind: 'observe' } | { kind: 'none' } {
  const t = text.trim().toLowerCase()
  const m = text.match(/(\d+)/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n === shortlist.length + 1) return { kind: 'observe' }        // the "None — it's new" row
    if (n >= 1 && n <= shortlist.length) return { kind: 'attach', target: shortlist[n - 1] }
    return { kind: 'none' }
  }
  // typed label — shortlist first, then the FULL set (fallback), by label substring.
  const find = (arr: PickCandidate[]) => arr.find((c) => t.length >= 3 && c.label.toLowerCase().includes(t)) ?? null
  const hit = find(shortlist) ?? find(full)
  if (hit) return { kind: 'attach', target: hit }
  if (/\b(new|fresh|none|different|another|separate)\b/i.test(text)) return { kind: 'observe' }
  return { kind: 'none' }
}
