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
