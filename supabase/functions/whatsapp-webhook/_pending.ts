// Agent-agnostic pending-question credibility — the PURE half (2026-07-11).
//
// A question we asked (ANY agent's) can be interrupted by a new turn. The dispatcher STASHES it, handles the
// turn, then RE-SURFACES it (with a Dismiss button) or DROPS it with a notice. These pure helpers read a
// CONVENTIONAL slot shape shared across agents — the SAME convention pendingSummary in _router.ts reads — so
// the machinery never learns any agent's schema. Kept here (not in _dispatch.ts) so they're unit-testable
// without dragging the whole dispatcher (and its Deno/IO imports) into the offline test bundle.

import * as M from './_messages.ts'
import type { Lang } from './_messages.ts'

type PendingSlots = { messages?: unknown; piece_text?: unknown; text?: unknown; candidates?: unknown; ask_body?: unknown }
type Pending = { pending_question: string | null; slots_so_far?: Record<string, unknown> | null }

// A DEFERRED question is one that was HELD when a new question interrupted it. It rides the new question's
// slots (`deferred_pending`) and re-surfaces when that new question's whole chain finishes — never dropped.
// A minimal snapshot (JSON-serialisable → lives in jsonb slots) is enough to re-open it exactly.
export type DeferredPending = {
  owning_agent: string | null; pending_question: string | null
  slots_so_far: Record<string, unknown>; staged_entry_id: string | null
}

/** The older question deferred behind this convo, if any. */
export function deferredOf(convo: { slots_so_far?: Record<string, unknown> | null }): DeferredPending | null {
  const d = (convo.slots_so_far ?? {})['deferred_pending']
  return d && typeof d === 'object' ? (d as DeferredPending) : null
}

/** Snapshot a convo for deferral. Its slots ride along verbatim — so a NESTED deferral (this question was
 *  itself holding an older one) chains automatically when it re-surfaces. */
export function snapshotPending(convo: { owning_agent: string | null; pending_question: string | null; slots_so_far?: Record<string, unknown> | null; staged_entry_id?: string | null }): DeferredPending {
  return {
    owning_agent: convo.owning_agent ?? null,
    pending_question: convo.pending_question ?? null,
    slots_so_far: (convo.slots_so_far ?? {}) as Record<string, unknown>,
    staged_entry_id: convo.staged_entry_id ?? null,
  }
}

/** A short echo of WHAT the stashed question was about — for the evict notice ("…about \"cars…\""). */
export function pendingSubjectOf(p: Pending): string | null {
  const s = (p.slots_so_far ?? {}) as PendingSlots
  const subj =
    (Array.isArray(s.messages) && typeof s.messages[0] === 'string' && (s.messages[0] as string)) ||
    (typeof s.piece_text === 'string' && s.piece_text) ||
    (typeof s.text === 'string' && s.text) || ''
  const out = String(subj).trim()
  return out ? out.slice(0, 80) : null
}

/**
 * The body of the re-surfaced question.
 *
 * VERBATIM WHEN WE HAVE IT (2026-07-11). `ask_body` is the question EXACTLY as it was asked, stored in the
 * slots by whoever asked it. Re-rendering from the question string + candidate names is a lossy translation,
 * and live it lost everything that made the question answerable: the "You said …" piece it was about, the
 * "It's something else" / "None of these" escapes (still valid on the answer — just invisible), and the
 * "(2 more to sort out after this.)" counter. The supervisor was shown a stump and asked to answer it.
 *
 * The re-render below stays as the FALLBACK — an older conversation, or an agent that stores no body, still
 * gets a usable question rather than nothing.
 */
export function resurfaceBody(p: Pending, lang: Lang): string {
  const s = (p.slots_so_far ?? {}) as PendingSlots
  if (typeof s.ask_body === 'string' && s.ask_body.trim()) {
    return [M.pendingResurfaceLead(lang), s.ask_body.trim(), M.pendingResurfaceFooter(lang)].join('\n')
  }
  const q = (p.pending_question ?? '').trim() || 'my earlier question'
  const cands = Array.isArray(s.candidates) ? (s.candidates as Record<string, unknown>[]) : []
  const opts = cands
    .map((c) => (c?.name ?? c?.title ?? '')).map(String).filter(Boolean)
    .map((label, i) => `${i + 1}. ${label}`)
  const parts = [M.pendingResurfaceLead(lang), q]
  if (opts.length) parts.push(opts.join('\n'))
  parts.push(M.pendingResurfaceFooter(lang))
  return parts.join('\n')
}
