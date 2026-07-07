// STEP 3 — the grounded TYPED-PICK resume grammar (PURE). The ATTACH-vs-OBSERVE *planner* (decideAttach /
// planPhotoItems) was retired with the image second-engine in T5 (the singular unit's ladder now decides a
// re-photo as an update component). What survives is the resume grammar: given a reply to an open typed
// pick (the place_photo ask, or a recovered parked pick), resolve it to attach / observe / re-ask.

// A minimal, kind-agnostic pick candidate — what the pick STORES + the resume matches against.
export interface PickCandidate { kind: string; id: string; label: string }

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
  // A reply that is JUST a number is a positional pick into the shortlist (display order == stored order).
  // Anchored to a BARE integer so a natural answer that merely CONTAINS a digit ("Phase 2 panel") is
  // resolved by MEANING below, not hijacked into a wrong position by the first digit anywhere in the text.
  const m = t.match(/^(\d+)$/)
  if (m) {
    const n = parseInt(m[1], 10)
    if (n === shortlist.length + 1) return { kind: 'observe' }        // the "None — it's new" row
    if (n >= 1 && n <= shortlist.length) return { kind: 'attach', target: shortlist[n - 1] }
    return { kind: 'none' }
  }
  // TYPED ANSWER — resolve against the STORED list by MEANING: (1) whole-phrase containment, then (2) shared-
  // token overlap ("fourth floor" shares the distinctive token "fourth" with "Wiring — Fourth floor" even
  // when neither contains the other verbatim). In BOTH, a UNIQUE best wins; an answer that fits several
  // offered items equally (the bare word "floor") is AMBIGUOUS → none, and the caller re-prompts — never an
  // arbitrary pick, never an eat. (Callers pass the FULL title as `label` so a truncated display doesn't
  // wall off a valid answer.)
  if (t.length >= 3) {
    const uniqSub = (arr: PickCandidate[]) => {
      const hits = arr.filter((c) => c.label.toLowerCase().includes(t))
      return hits.length === 1 ? hits[0] : null
    }
    const sub = uniqSub(shortlist) ?? uniqSub(full)
    if (sub) return { kind: 'attach', target: sub }
    const tok = bestTokenOverlap(text, full.length ? full : shortlist)
    if (tok) return { kind: 'attach', target: tok }
  }
  if (/\b(new|fresh|none|different|another|separate)\b/i.test(text)) return { kind: 'observe' }
  return { kind: 'none' }
}

// shared-token overlap — count the DISTINCTIVE (≥3-char, alphanumeric) tokens the reply shares with each
// candidate title. The best candidate wins ONLY if its score is ≥1 AND strictly greater than every other's;
// a tie is AMBIGUOUS → no pick (the caller re-prompts). Conservative by design: no stemming, no fuzzy match,
// no cross-candidate leakage — it must never turn a vague reply into a confident wrong attach.
const pickTokens = (s: string): Set<string> => new Set((s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []))
export function bestTokenOverlap(text: string, cands: PickCandidate[]): PickCandidate | null {
  const q = pickTokens(text)
  if (!q.size) return null
  const scored = cands.map((c) => ({ c, n: [...pickTokens(c.label)].reduce((a, w) => a + (q.has(w) ? 1 : 0), 0) }))
  const max = Math.max(0, ...scored.map((s) => s.n))
  if (max < 1) return null
  const top = scored.filter((s) => s.n === max)
  return top.length === 1 ? top[0].c : null
}
