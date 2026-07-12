// STEP 5b — LATE-ANSWER RECOVERY (pure core). A pick ("which task?" / "which of these, or new?") that
// the sender never answered PARKS to siteops_unplaced (commitInterrupted) rather than dropping — the
// item is ground truth, the interpretation was best-effort. If the sender later QUOTED-REPLIES to that
// original question (context.id === the pick's outbound wamid, stored as siteops_unplaced.question_wamid
// via the Step 4a map), we can still place it. This module reconstructs the RESUME SLOTS from the parked
// row so the answer flows through the SAME answerSiteops branch it would have hit live — no parallel
// placement logic to drift. PURE; the handler re-opens the convo with these slots and delegates.
//
// Parked = recoverable, not shelved. Only observation-carrying picks are recoverable this way (disambig,
// typed_pick, project); an evidence-only pin (photo_pick / batch_collision / floor) carries no pending
// choice to re-apply and returns null.

export interface ParkedRow {
  reason: string                              // the pick kind it parked from (siteops_unplaced.reason)
  observation: unknown                        // the SiteItem (disambig/typed) or {items:[...]} (project)
  candidates: unknown                         // the shortlist it was ambiguous over
  project_id: string | null
  object_path: string | null                  // parked photo evidence (rough-entry-media), if any
  caption: string | null
  narration_id: string | null
}

/**
 * Rebuild the answerSiteops slots for a parked pick, or null when the reason carries no re-answerable
 * choice. The shapes MIRROR what each live pick stored, so the reconstructed slots drive the exact same
 * resume branch. PURE.
 */
export function reconstructParkedSlots(p: ParkedRow): Record<string, unknown> | null {
  const image = p.object_path ? { storagePath: p.object_path, caption: p.caption ?? null } : null
  const base = { project_id: p.project_id, project_name: null, narration_id: p.narration_id ?? null, image }
  const candidates = p.candidates ?? []
  switch (p.reason) {
    case 'disambig':
      return { kind: 'siteops_disambig', item: p.observation, candidates, ...base }
    case 'typed_pick':
      // typed_pick stored its shortlist as `candidates` at park; full-set fallback reuses it.
      return { kind: 'siteops_typed_pick', item: p.observation, shortlist: candidates, full: candidates, ...base }
    case 'project': {
      const items = (p.observation && typeof p.observation === 'object' && 'items' in (p.observation as object))
        ? (p.observation as { items: unknown }).items : []
      return { kind: 'siteops_project', items, candidates, ...base }
    }
    // THE which_item PICK (#8, 2026-07-11). It parks as batch_collision and used to land in `default` — so a
    // pick that was never answered live could never be answered at all. That was tolerable while picks only
    // expired after 24h; with the 30-minute pending TTL, "answered ten minutes after we set it aside" is the
    // normal case. The park carries what the live slots carried: the supervisor's piece + the offered set.
    case 'batch_collision': {
      const obs = (p.observation ?? null) as { piece_text?: unknown; candidates?: unknown } | null
      const piece = typeof obs?.piece_text === 'string' ? obs.piece_text.trim() : ''
      if (!piece) return null   // no question to re-ask (an evidence-only collision) — never a phantom pick
      const offered = (Array.isArray(candidates) && candidates.length ? candidates : obs?.candidates) ?? []
      return { kind: 'siteops_batch_collision', status: 'still_open', piece_text: piece, candidates: offered, ...base }
    }
    default:
      return null   // floor / photo_pick — no pending choice to re-apply
  }
}
