// STEP 2 — association decision (PURE). Given a TEXT that arrives while a siteops_photo ENRICHMENT
// WINDOW is open, decide one of three things:
//   related   → it's about the photo; ENRICH the SAME objects (never a twin), one combined readback.
//   unrelated → it's its own message; route it FRESH to its real agent. This is the CHOSEN fail-safe for
//               the uncertain case too — the cost asymmetry is decisive: wrongly merging a real "send 50
//               bags cement" SILENTLY LOSES a procurement request (catastrophic-quiet), whereas wrongly
//               routing a real description just lands a visible near-twin note (recoverable-loud, and
//               Step 3 dedup / Step 5 verbs reunite it). So when unsure → unrelated, never swallow.
//   noop      → a bare affirmation ("ok" / "done" / "haan") — a confirmation of the readback, not a
//               description and not a new intent worth re-routing. Close the window clean; do nothing.
//
// Quoted-reply is the PRIMARY positive signal WITHIN the hold. Expiry is checked FIRST: an expired window
// is never a trap — the message routes fresh, no scoring, no questions. The relatedness scorer is
// deliberately LEXICAL and CONSERVATIVE: it calls "related" only on positive trade/subject-token overlap
// with the photo's extract, never on a bare affirmation. Kept pure + fully unit-tested.

import { tradeGroups } from './_siteops_route.ts'

export type AssocVerdict = 'related' | 'unrelated' | 'noop'

export interface AssocInput {
  withinHold: boolean          // now <= hold_until (the ~90s window is still live)
  bareAffirmation: boolean     // the text is a bare "ok"/"done"/"haan" — noise, not a description
  quotedMatchesHeld: boolean   // the text replied-to the photo's wamid (Cloud API context.id match)
  relatedness: 'related' | 'unrelated'   // conservative lexical read (positive overlap only)
}

/** The whole Step-2 steering rule, in one place. See the matrix in the tests. */
export function decideAssociation(i: AssocInput): AssocVerdict {
  // EXPIRY FIRST — an expired (un-swept) window is not a trap: route fresh, no scoring, no questions.
  // (Durable quoted-reply-after-expiry is deferred to the wamid→object map; in-window quoted works below.)
  if (!i.withinHold) return 'unrelated'
  // NOISE — a bare affirmation is a confirmation, handled elsewhere; here it's just window-closing noise.
  if (i.bareAffirmation) return 'noop'
  // PRIMARY — an explicit quoted-reply to the photo is an unambiguous association.
  if (i.quotedMatchesHeld) return 'related'
  // FALLBACK — only positive lexical overlap earns 'related'; everything else (incl. uncertain) → fresh.
  return i.relatedness
}

// Bare affirmation / acknowledgement — English + Telugu/Hindi code-mix. NOT a site description. A generic
// "ok" hitting the window is noise (the readback already went out), so it closes the window without a merge
// or a re-route. Kept tight so a real one-word update ("honeycombing") never matches.
const AFFIRM = /^\s*(ok(ay)?|k+|done|got\s*it|thanks?|thx|ty|yes+|ya+|yeah|yep|yup|noted|sure|fine|good|great|haan|ha|haa|sari+|sare+|saroj|acha+|theek|👍|✅|🙏|👌|🆗)[\s.!👍✅🙏👌]*$/i
export function isBareAffirmation(text: string): boolean {
  return AFFIRM.test((text ?? '').trim())
}

// Stopwords stripped before subject-token overlap — imperatives, pronouns, and site-generic filler that
// would otherwise create false "related" hits ("site", "work", "update", "send", "please").
const STOP = new Set([
  'this', 'that', 'with', 'from', 'have', 'need', 'want', 'send', 'give', 'please', 'update', 'site',
  'work', 'done', 'today', 'tomorrow', 'yesterday', 'about', 'there', 'here', 'they', 'them', 'your',
  'ours', 'sir', 'anna', 'bro', 'boss', 'and', 'the', 'for', 'are', 'was', 'will', 'bags', 'bag',
])
function subjectTokens(s: string): Set<string> {
  const out = new Set<string>()
  for (const w of ((s ?? '').toLowerCase().match(/[a-z]+/g) ?? [])) {
    if (w.length >= 4 && !STOP.has(w)) out.add(w)
  }
  return out
}

/**
 * CONSERVATIVE relatedness — 'related' ONLY on positive overlap between the message and the photo's
 * extract: either a shared TRADE group (brick≡block≡masonry, tiling≡flooring, …) or a shared subject
 * token. No overlap → 'unrelated' (the fail-safe: route fresh, never swallow). PURE.
 */
export function photoRelatedness(photoExtract: string, text: string): 'related' | 'unrelated' {
  const tg = new Set(tradeGroups(photoExtract))
  if (tg.size && tradeGroups(text).some((g) => tg.has(g))) return 'related'
  const a = subjectTokens(photoExtract)
  if (a.size) { for (const t of subjectTokens(text)) if (a.has(t)) return 'related' }
  return 'unrelated'
}
