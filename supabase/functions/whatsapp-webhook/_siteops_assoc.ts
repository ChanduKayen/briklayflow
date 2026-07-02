// STEP 2 — association decision (PURE). Given the signals around an inbound TEXT that might belong to a
// just-logged photo (or a PHOTO that might belong to a just-logged text — the decision is symmetric),
// decide one of three things:
//   related   → it's about the held item; ENRICH the SAME object (never a twin), one combined readback.
//   unrelated → route it fresh (independent capture).
//   ask       → within the hold but the extract can't tell → send ONE cheap question ("was that about
//               the photo?"). The spec's rule: one cheap question beats a wrong merge OR a duplicate.
//
// Quoted-reply is the PRIMARY signal and is DETERMINISTIC + window-independent: a reply-to the photo
// (Cloud API context.id == the photo's wamid) associates even after the ~90s hold lapsed. The hold is
// only the FALLBACK for a non-reply follow-up. Kept pure + unit-tested; the agent supplies the signals
// (quoted match, hold check, and a cheap relatedness read) and acts on the verdict.

export type AssocVerdict = 'related' | 'unrelated' | 'ask'
export type Relatedness = 'related' | 'unrelated' | 'unknown'

export interface AssocInput {
  quotedMatchesHeld: boolean   // the inbound message replied-to the held item's wamid (context.id match)
  withinHold: boolean          // now <= hold_until (the ~90s enrichment window is still live)
  relatedness: Relatedness     // a cheap extract/lexical read of whether this message concerns the held item
}

/** The whole Step-2 association rule, in one place. See the matrix in the tests. */
export function decideAssociation(i: AssocInput): AssocVerdict {
  // PRIMARY — an explicit quoted-reply to the held item is an unambiguous association; the window is
  // irrelevant (it binds even after the hold lapsed). This is the signal that removes the guesswork.
  if (i.quotedMatchesHeld) return 'related'

  // FALLBACK — for a NON-reply follow-up, only the live hold is in play. A lapsed hold with no reply is
  // just a fresh message; never reach back and merge into an item the sender didn't point at.
  if (!i.withinHold) return 'unrelated'

  // Within the hold: trust a confident extract read either way; when it genuinely can't tell, ASK rather
  // than risk a wrong merge (loses their real intent) or a duplicate (two objects for one report).
  if (i.relatedness === 'related') return 'related'
  if (i.relatedness === 'unrelated') return 'unrelated'
  return 'ask'
}
