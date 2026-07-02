// STEP 3 (2/2) — the RE-ANALYSE / HARVEST decision core (PURE). Step 2 ships a CONSERVATIVE merge: a
// text that follows a site photo is TRAILED onto the photo's object (feed shows "description added") but
// is NOT re-decomposed into structured updates — that (rich re-analyse + dedup) was deferred to here.
// Two Step-2 writes leave a `pending_reanalysis` marker on followup_events for the harvest to find:
//   • description_added       — an in-window RELATED follow-up (definitely about the object).
//   • possible_photo_followup — an UNCERTAIN→unrelated follow-up routed FRESH (the fail-safe), stamped
//                               on the photo's object so the pair CAN be reunited on re-analysis.
//
// The runner (siteops-reanalyze edge fn) does the DB + the one decompose() call; THIS module holds the
// pure decisions it turns on, so the whole harvest is journey-testable with no DB/network:
//   • decideHarvest       — merge this enrichment, or just clear the marker (correctly-fresh case).
//   • distillSignal       — the structured signal to lift from the decomposed enrichment.
//   • planEnrichmentMerge — the CONSERVATIVE field merge (fill-if-empty, NEVER overwrite a human value).
//
// DISCIPLINE: harvest ENRICHES (fills a missing cause / a missing deadline); it never overwrites an
// existing value and never auto-RESOLVES (resolution stays with the explicit chase-reply path — a
// background job must not close an item nobody told it to close). Cross-object MERGE of a fresh twin is
// deferred: Step 2 doesn't record what the fresh routing created, so there's no safe link to merge on.

import { photoRelatedness } from './_siteops_assoc.ts'
import { parseWhen } from './_siteops_route.ts'
import type { SiteItem } from './_siteops_extract.ts'

export type HarvestType = 'description_added' | 'possible_photo_followup'

export interface PendingEvent {
  id: string                              // followup_events.id (the marker to clear)
  type: HarvestType
  parent: { kind: 'issue' | 'todo'; id: string }
  body: string                            // the enrichment / follow-up text Step 2 stored
}

// The object's CURRENT state (loaded by the runner) — the merge is conservative against it.
export interface HarvestObject {
  kind: 'issue' | 'todo'
  title: string                           // problems.title / todos.text — used for the relatedness re-check
  cause: string | null                    // issues only (null/'other' = fillable); todos carry no cause
  deadline: string | null                 // issues.deadline / todos.due_date (null = fillable)
}

// What decompose() yields, distilled to the two fields the harvest safely applies.
export interface ExtractedSignal { cause: string | null; date_hint: string | null }

export interface MergePlan {
  updates: { cause?: string; deadline?: string }   // ONLY safe, non-overwriting fields
  changed: boolean
}

/**
 * Merge or skip? A description_added is definitely about the object → merge. A possible_photo_followup
 * was routed fresh under uncertainty → RE-CHECK relatedness now against the object's real title (Step 2
 * could only see the thin extract). Related → merge (the reunion); still unrelated → skip (it was
 * correctly routed fresh — just clear the marker, change nothing). PURE (reuses photoRelatedness).
 */
export function decideHarvest(ev: PendingEvent, obj: HarvestObject): { action: 'merge' | 'skip'; reason: string } {
  if (ev.type === 'description_added') return { action: 'merge', reason: 'in-window enrichment' }
  return photoRelatedness(obj.title, ev.body) === 'related'
    ? { action: 'merge', reason: 're-analysis confirms related' }
    : { action: 'skip', reason: 'unrelated — correctly routed fresh' }
}

/** Distil the decomposed enrichment to the harvestable signal: the first REAL cause (issues; 'other'
 *  and progress/todo items don't count) and the first date hint. PURE. */
export function distillSignal(items: SiteItem[]): ExtractedSignal {
  let cause: string | null = null
  let date_hint: string | null = null
  for (const it of items) {
    if (!cause && it.type === 'issue' && it.cause && it.cause !== 'other') cause = it.cause
    if (!date_hint && it.date_hint) date_hint = it.date_hint
  }
  return { cause, date_hint }
}

/**
 * CONSERVATIVE merge of the distilled signal into the object. Fills a MISSING cause (issues only, and
 * only when the object has none / 'other') and a MISSING deadline — never overwrites a value a human or
 * an earlier pass set, never touches status. PURE (parseWhen is pure given `now`).
 */
export function planEnrichmentMerge(obj: HarvestObject, sig: ExtractedSignal, now: Date): MergePlan {
  const updates: { cause?: string; deadline?: string } = {}
  if (obj.kind === 'issue' && (obj.cause === null || obj.cause === 'other') && sig.cause && sig.cause !== 'other') {
    updates.cause = sig.cause
  }
  if (!obj.deadline && sig.date_hint) {
    const d = parseWhen(sig.date_hint, now)
    if (d) updates.deadline = d.toISOString().slice(0, 10)
  }
  return { updates, changed: Object.keys(updates).length > 0 }
}
