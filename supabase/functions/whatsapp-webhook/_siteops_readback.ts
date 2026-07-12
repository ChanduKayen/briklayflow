// SITEOPS combined-readback composition — SHARED so both the agent (fold on resume / flush) and the sweep
// (the 2-min held-flush cron) render the SAME professional sectioned layout without a circular import.
// PURE. No I/O.

// STEP C1 — a resolved summary HELD behind an open which_item ask, carried in the conversation slots so the
// answer (or the interrupt / 2-min flush) can fold it into ONE reply. Never a silent drop.
// NOTHING_TO_UPDATE / MISS_CLAUSE live with the terminals that produce them (_siteops_resolution, PURE —
// it imports nothing from here, so this is not a cycle).
import { NOTHING_TO_UPDATE, MISS_CLAUSE, canonFloor, canonUnit } from './_siteops_resolution.ts'
import type { SiteItem, StructureSlot } from './_siteops_extract.ts'

export type HeldReadback = { entries: { project: string | null; body: string }[]; resolvedRefs: { kind: string; id: string; event: string }[] }

// ── STEP A (IMAGE) — THE ACK IS THE CONFIRMATION ──────────────────────────────────────────────────────────
// A typed note is acked with a count, because the sender already knows what he wrote. A PHOTO is different:
// the words about to be acted on are OURS, not his — our read of his pixels — and a vision misread (a floor
// number off a lift panel, a cured slab read as a fresh pour) is invisible to him until the wrong row is
// already written. He was standing there. He is the only one who can catch it, and only if we show him.
//
// So an image's ack reads the GROUNDED observation back — every item the vision pass extracted, in its own
// words, next to his caption — BEFORE the resolve loop writes anything.
//
// FULL observation, deliberately: items we will NOT act on are shown too (a low-confidence read is demoted
// to a plain note by the vision floor, and never chased). Him seeing "also: exposed wiring at the left wall"
// and replying "that's a snag" is the cheapest correction there is; hiding it is how a miss stays silent.
//
// PURE. Returns null when the photo yielded nothing — the caller then keeps its honest plain receipt rather
// than narrating an observation we never made.

/** "Third floor · Unit A" — the place, as the pin will file it. Null when nothing named one. */
function placeLabel(s: StructureSlot | null | undefined): string | null {
  const floor = canonFloor(s?.floor)
  const unitRaw = canonUnit(s?.unit)
  // canonUnit passes a bare token through lowercased ("A" → "a"); name it the way the task rows do.
  const unit = unitRaw ? (/^unit\s/i.test(unitRaw) ? unitRaw.replace(/^unit\s+/i, 'Unit ') : `Unit ${unitRaw.toUpperCase()}`) : null
  const parts = [floor ? `${floor} floor` : null, unit].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export function composePhotoAck(items: SiteItem[], caption: string | null): string | null {
  if (!items.length) return null
  const places = items.map((i) => placeLabel(i.structure))
  const uniq = [...new Set(places.filter(Boolean) as string[])]
  // ONE photo is ONE place (the inheritance rule in applyMediaStructure) — so a place every observation
  // shares is stated ONCE, up top. Observations that genuinely differ carry their own, per line.
  const shared = uniq.length === 1 && places.every(Boolean) ? uniq[0] : null
  const said = caption?.trim() ?? ''
  const lines = items.map((i, n) => {
    const p = shared ? null : places[n]
    return `• ${i.text}${p ? ` _(${p})_` : ''}`
  })
  const head = said ? `📷 Got your photo — you said "${said}"` : `📷 Got your photo.`
  const one = items.length === 1
  return [
    head,
    shared ? `📍 ${shared}` : null,
    '',
    `Here's what I can see in it:`,
    lines.join('\n'),
    '',
    one
      ? `Checking it against the open work now — I'll confirm back. If I've read the photo wrong, just tell me.`
      : `Checking these against the open work now — I'll confirm back and ask if anything's unclear. If I've read the photo wrong, just tell me.`,
  ].filter((l) => l !== null).join('\n')
}

/** STEP B — the professional, sectioned combined readback: a warm header, per-SITE sections (multi-project),
 *  each outcome on its own line, a closing invitation. A SINGLE entry is verbatim (keeps the undo button).
 *  Lines already carry their status glyph (✓ / ⚠️ / logged new / Didn't catch / ⏳) from the composer. */
export function combineReadbacks(entries: { project: string | null; body: string }[]): string {
  if (entries.length === 1) return entries[0].body
  // A fragment that landed nowhere composes the FULL "here's how to name it" guidance, because on its own that
  // IS the reply. Folded into a combined readback it would bury the things that did land — and repeat itself
  // once per unplaced fragment. Inside a list it becomes one honest clause, deduped.
  const strip = (b: string) => (b === NOTHING_TO_UPDATE ? MISS_CLAUSE : b)
    .replace(/^Got it\s*—\s*/i, '').replace(/^Got it\.?$/i, '').trim()
  const multiProject = new Set(entries.map((e) => e.project)).size > 1
  const order: (string | null)[] = []
  const byProj = new Map<string | null, string[]>()
  for (const e of entries) {
    const line = strip(e.body)
    if (!line) continue
    if (!byProj.has(e.project)) { byProj.set(e.project, []); order.push(e.project) }
    const bucket = byProj.get(e.project)!
    // NEVER SAY ONE THING TWICE (live probe, 2026-07-11). One photo over-decomposed into two halves of the
    // same ceiling, he answered the same work to both asks, and the readback told him twice that
    // “False-ceiling frame (Fourth)” was updated. An identical line for the same site is the same FACT — the
    // line carries no count, so a repeat says nothing and reads as two separate writes that never happened.
    // (This subsumes the older one-MISS_CLAUSE-per-site rule: the miss clause is just the commonest repeat.)
    if (bucket.includes(line)) continue
    bucket.push(line)
  }
  if (!order.length) return 'Got it'
  const sections = order.map((proj) => {
    const lines = (byProj.get(proj) ?? []).join('\n')
    return multiProject && proj ? `*${proj}*\n${lines}` : lines   // site header only when >1 site
  })
  return `Here's where everything landed 👇\n\n${sections.join('\n\n')}\n\nAnything off? Just reply and I'll fix it.`
}
