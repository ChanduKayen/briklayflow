// TWO VOICES IN ONE MESSAGE (2026-07-11).
//
// A site photo arrives as two things: the CAPTION (the sender's own words) and the DESCRIPTION (our read of
// the pixels). They were being glued together with " -- " at the boundary (_normalize) and then, worse,
// thrown apart again in the agent — `imgRawText = ctx.image.caption || text` DROPPED our read of the photo
// entirely whenever a caption existed. So the pixels' own evidence — a floor number chalked on a wall, a
// board in the frame — never reached the resolver at all if the sender had typed anything.
//
// And in the other direction, the mush was quoted back at him as HIS words:
//     You said: "Ceiling work in pride site 4th floor. -- Ceiling installation framework visible at the
//                construction site on the 4th floor."
// He never said the second half. We did.
//
// So: ONE composite, MARKED, carried whole — and rendered back to a human with each half attributed to
// whoever actually said it. The marking is also the injection boundary: caption text is untrusted data and
// is now unambiguously delimited from our own description of the image.
//
// PURE (no Deno, no IO) — the composer, the parser and the human rendering all live together, because a
// format written in one place and read in another is a format that drifts.

export interface MediaParts {
  caption: string | null        // the sender's words (authoritative — they were standing there)
  description: string | null    // our read of the image (corroborates; supplies what the caption omits)
}

const CAPTION_RE = /<caption>([\s\S]*?)<\/caption>/i
const PHOTO_RE = /<photo>([\s\S]*?)<\/photo>/i

/** The MODEL-facing string: both signals, each labelled, so a reader (model or code) knows whose claim is
 *  whose. Either half may be absent — a photo with no caption, or a caption we could not describe. */
export function mediaComposite(p: MediaParts): string {
  const cap = (p.caption ?? '').trim()
  const desc = (p.description ?? '').trim()
  const parts: string[] = []
  if (cap) parts.push(`<caption>${cap}</caption>`)
  if (desc) parts.push(`<photo>${desc}</photo>`)
  return parts.join('\n')
}

/** Read a composite back apart. Not a composite (plain text, a voice note) → null. */
export function parseComposite(s: string): MediaParts | null {
  const text = s ?? ''
  const cap = CAPTION_RE.exec(text)?.[1]?.trim() ?? null
  const desc = PHOTO_RE.exec(text)?.[1]?.trim() ?? null
  if (cap === null && desc === null) return null
  return { caption: cap || null, description: desc || null }
}

/**
 * The HUMAN-facing split. `said` is what the SENDER said — never our description, which we must not put in
 * his mouth. `seen` is our read of the photo, shown separately and owned by us.
 *
 * A photo with no caption has nothing the sender "said": `said` is empty and the caller leads with `seen`.
 * Plain text (no markers) passes through as `said` verbatim — every non-image message behaves exactly as
 * before.
 */
export function humanizeInbound(s: string): { said: string; seen: string | null } {
  const parts = parseComposite(s)
  if (!parts) return { said: s ?? '', seen: null }
  return { said: parts.caption ?? '', seen: parts.description }
}
