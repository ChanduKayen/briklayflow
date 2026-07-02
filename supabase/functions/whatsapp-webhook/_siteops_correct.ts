// STEP 4b — the readback CORRECTION policy (PURE). A quoted-reply to a task READBACK (resolved via
// wa_message_map, Step 4a) is the user AUTHORITATIVELY correcting what we logged. So — unlike the Step 3
// harvest's conservative fill-if-empty (_siteops_reanalyze) — a correction OVERWRITES the named field:
// the user is explicitly pointing at this message and fixing it. Still bounded to SAFE fields (a cause on
// issues, a deadline/due on either) and it never touches status, type, or task association — those are
// heavier re-routing operations, not 4b. The signal comes from re-decomposing the reply (same extractor
// as text), distilled by _siteops_reanalyze.distillSignal; this module is just the apply policy. PURE.

import { parseWhen } from './_siteops_route.ts'

// Structural shapes (kept local so this module stands alone; distillSignal's output satisfies Signal).
export interface CorrectionObject { kind: 'issue' | 'todo'; cause: string | null; deadline: string | null }
export interface Signal { cause: string | null; date_hint: string | null }
export interface CorrectionPlan { updates: { cause?: string; deadline?: string }; changed: boolean }

/**
 * AUTHORITATIVE overwrite of the corrected fields. A real cause (issues only) and/or a parseable date
 * REPLACE whatever is there — the user said so. An 'other' cause or an unparseable date is ignored (no
 * signal ⇒ no change, so a chatty reply that names nothing structured never blanks a field). PURE.
 */
export function planCorrection(obj: CorrectionObject, sig: Signal, now: Date): CorrectionPlan {
  const updates: { cause?: string; deadline?: string } = {}
  if (obj.kind === 'issue' && sig.cause && sig.cause !== 'other') updates.cause = sig.cause   // overwrite
  if (sig.date_hint) {
    const d = parseWhen(sig.date_hint, now)
    if (d) updates.deadline = d.toISOString().slice(0, 10)                                    // overwrite
  }
  return { updates, changed: Object.keys(updates).length > 0 }
}
