// STEP 5 — the "verbs on a readback" classifiers (PURE). Beyond a field CORRECTION (Step 4b), a reply
// or a reaction to a readback can CONFIRM ("👍 yes, right") or RETRACT ("👎" / "ignore that, wrong").
// Both resolve their target through wa_message_map (Step 4a); this module holds only the pure reads of
// intent. Kept deliberately CONSERVATIVE — retraction is destructive-ish (dismisses an object), so the
// text matcher fires only on unambiguous retraction phrases, never on a normal update that happens to
// contain "wrong" (e.g. "wrong LEVEL on the slab" is a real issue, not a retraction).

export type ReactionIntent = 'confirm' | 'retract' | 'neutral'

// Emoji are matched by substring (multi-codepoint safe) — a reaction payload is a single emoji string.
const CONFIRM_EMOJI = ['👍', '✅', '🙏', '👌', '💯', '🎉', '🆗', '🙌', '❤️', '♥️', '😊']
const RETRACT_EMOJI = ['👎', '❌', '🚫', '⛔']

/** A reaction's intent. An empty emoji (a REMOVED reaction) or anything unrecognised → neutral (ignored,
 *  never an error) — the whole point is that reactions stop being dropped as "unsupported". */
export function classifyReaction(emoji: string): ReactionIntent {
  const e = (emoji ?? '').trim()
  if (!e) return 'neutral'
  if (CONFIRM_EMOJI.some((x) => e.includes(x))) return 'confirm'
  if (RETRACT_EMOJI.some((x) => e.includes(x))) return 'retract'
  return 'neutral'
}

// Unambiguous retraction phrases only. "wrong" is gated to wrong photo/pic/one/entry/item so a real
// defect note ("wrong level", "wrong mix") never reads as a retraction. Delete/remove/cancel/scratch/
// scrap/undo require a "that/it/this" object so "cancel the order" (a real instruction) doesn't match.
const RETRACT_RE = /\b(ignore (that|it|this)|wrong (photo|pic|one|entry|item)|(delete|remove|cancel|scratch|scrap|undo) (that|it|this)|disregard( that| it)?|never ?mind|my mistake)\b/i

/** Does this text explicitly RETRACT (undo) what we just logged? Conservative — see RETRACT_RE. */
export function isRetraction(text: string): boolean {
  return RETRACT_RE.test((text ?? '').trim())
}
