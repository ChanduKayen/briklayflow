// SITEOPS combined-readback composition — SHARED so both the agent (fold on resume / flush) and the sweep
// (the 2-min held-flush cron) render the SAME professional sectioned layout without a circular import.
// PURE. No I/O.

// STEP C1 — a resolved summary HELD behind an open which_item ask, carried in the conversation slots so the
// answer (or the interrupt / 2-min flush) can fold it into ONE reply. Never a silent drop.
// NOTHING_TO_UPDATE / MISS_CLAUSE live with the terminals that produce them (_siteops_resolution, PURE —
// it imports nothing from here, so this is not a cycle).
import { isNothingToUpdate, MISS_CLAUSE, canonFloor, canonUnit } from './_siteops_resolution.ts'
import type { SiteItem, StructureSlot } from './_siteops_extract.ts'
import { G, bold, italic, plain, lines, blocks, heading, destinationLine, REPAIR, type Home } from './_voice.ts'
import { reviewLink, todayLink, tasksLink, taskLink, type Link } from './_links.ts'
import type { OutMessage } from './_format.ts'

/**
 * ONE ENTRY = one applyTerminals call's readback: its composed line(s), the site they belong to, and — new
 * with Type 5 — WHERE the rows it wrote actually landed, plus a link to the single record it wrote (when it
 * wrote exactly one). Both are optional: a readback held in a conversation's slots before this shipped comes
 * back without them, and a missing home simply means no destination line — never a guessed one.
 */
export type ReadbackEntry = {
  project: string | null
  body: string
  /** The homes this entry's WRITES landed in (homesOf). Empty/absent → it wrote nothing → no destination line. */
  homes?: Home[]
  /** The one record it wrote, when it wrote exactly one — the deep-link target. Absent for 0 or 2+. */
  link?: Link | null
}

export type HeldReadback = { entries: ReadbackEntry[]; resolvedRefs: { kind: string; id: string; event: string }[] }

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

export function composePhotoAck(
  items: SiteItem[],
  caption: string | null,
  ctx?: { project?: string | null; threaded?: boolean },
): string | null {
  if (!items.length) return null

  /**
   * ══ TYPE 3 · THE READBACK — THE CONTRACT BEFORE ACTING ═══════════════════════════════════════════
   *
   * Four lines, and each one has a job the others do not:
   *
   *     📷 The Pride · Unit A          where — and ONLY what is confirmed
   *     You said: _"1st floor ceilings"_   his words, verbatim, in his voice (italic)
   *     I see: *framing up, boards not fixed* — hangers and channels in.   ours, in ours (bold fact)
   *     Matching it to open work — confirming back in a moment.            the promise
   *
   * ── WHAT THIS REPLACED, AND WHY IT HAD TO GO ────────────────────────────────────────────────────
   *
   * It was a wall: the caption, then a 📍 pin, then "Here's what I can see in it:", then a forty-word
   * vision essay per item, then a paragraph of instructions. Four jobs in one bubble.
   *
   *   · THE 📍 PIN STAMPED AN UNCONFIRMED LOCATION AS FACT. It printed "First floor" from the caption,
   *     and the very next message said "this site has no floor First". The system contradicted itself
   *     inside two bubbles. A location line may state only what is CONFIRMED — so it now carries the
   *     project (which we resolved) and nothing we are about to argue with.
   *
   *   · THE VISION ESSAY described the room. "Plastered walls, chalk markings and loose service wires
   *     are visible as part of ongoing works" is the camera talking, not an engineer. The filter is
   *     one question — WOULD A SITE ENGINEER MENTION IT ON A PHONE CALL? Hangers in, boards not fixed:
   *     yes. Scenery: no. So the read is one line — the progress state in bold, one clause of
   *     QC-relevant detail after the dash. A bare fact reads thin, as if we barely looked; a shaped
   *     detail clause reads like somebody who looked properly, because everything in it matters.
   *
   *   · NO REPAIR HANDLE. This message is not done yet, and asking to be corrected mid-flow reads
   *     anxious. The handle belongs on the terminal message, and only there.
   *
   * `threaded` — when the readback is sent as a native reply to his photo, WhatsApp draws the photo's
   * own thumbnail above it, and the "You said" line becomes a worse copy of a quote already on screen.
   * It goes.
   */
  const said = caption?.trim() ?? ''

  /**
   * THE PLACE LINE — and the 📍 that had to die.
   *
   * The old ack printed `📍 First floor` as a stamped fact, and the very next bubble said "this site has
   * no floor First". The system contradicted itself inside two messages. But the answer is NOT to hide
   * the place: it comes from HIS OWN CAPTION, and a misread place is the most expensive misread there
   * is — he is the only one who can catch it, and only if we show him.
   *
   * So the place is stated, once, on line 1, beside the project — as part of what we HEARD, not as a pin
   * we have verified. The 📍 glyph is gone (a mark that says "confirmed location" over an unconfirmed
   * one is a lie in one character), and the contradiction is fixed where it actually lived: the question
   * now OWNS the gap ("I don't have a 1st floor for The Pride") instead of denying his site.
   *
   * One photo is one place (the inheritance rule), so a place they all share is said ONCE. Observations
   * that genuinely differ carry their own.
   */
  const places = items.map((i) => placeLabel(i.structure))
  const uniq = [...new Set(places.filter(Boolean) as string[])]
  const shared = uniq.length === 1 && places.every(Boolean) ? uniq[0] : null

  const head = [G.photo, ctx?.project ? plain(ctx.project) : null, shared]
    .filter(Boolean).join(' · ')

  // Multiple observations in DIFFERENT places each carry their own — otherwise one scene, one sentence.
  const read = shared || items.length === 1
    ? items.map((i) => plain(i.text)).join(' · ')
    : items.map((i, n) => (places[n] ? `${plain(i.text)} — ${places[n]}` : plain(i.text))).join('\n')

  return lines(
    head,
    said && !ctx?.threaded ? `You said: ${italic('"' + said + '"')}` : null,
    `I see: ${bold(read)}`,
    items.length > 1
      ? 'Matching them to open work — confirming back in a moment.'
      : 'Matching it to open work — confirming back in a moment.',
  )
}

/** STEP B — the professional, sectioned combined readback: a warm header, per-SITE sections (multi-project),
 *  each outcome on its own line, a closing invitation. A SINGLE entry is verbatim (keeps the undo button).
 *  Lines already carry their status glyph (✓ / ⚠️ / logged new / Didn't catch / ⏳) from the composer. */
export function combineReadbacks(entries: ReadbackEntry[]): string {
  if (entries.length === 1) return entries[0].body

  /**
   * ══ TYPE 5 · THE DIGEST — LINE 1 IS THE NOTIFICATION ═════════════════════════════════════════════
   *
   * It opened with "Here's where everything landed 👇" — and a push preview shows about the first fifty
   * characters, so that is the WHOLE of what a man saw on his lock screen. It says nothing. It is a
   * preamble to a fact, delivered instead of the fact.
   *
   * So the digest opens with its strongest fact, and the strongest fact is the count:
   *
   *     ✓ *3 updates filed* — 2 sites          ← complete story, on a lock screen
   *
   *     *The Pride*
   *     ✓ Floor — tiling · Ground
   *
   *     *Chakradhar's Residence*
   *     ✓ Site — ground clearance
   *
   * The project is the HEADING (blank line above, one bold line — that is the entire heading system in
   * a medium with no headers), so it drops off the lines beneath it: a project named twice in one
   * message is one time too many.
   *
   * The ⏸ line lives INSIDE the digest, at its project — not as a floating apology at the bottom. An
   * item we could not place is a first-class citizen of the report, not a footnote to it.
   */
  const strip = (b: string) => (isNothingToUpdate(b) ? MISS_CLAUSE : b)
    .replace(/^Got it\s*—\s*/i, '').replace(/^Got it\.?$/i, '').trim()

  const order: (string | null)[] = []
  const byProj = new Map<string | null, string[]>()
  for (const e of entries) {
    const line = strip(e.body)
    if (!line) continue
    if (!byProj.has(e.project)) { byProj.set(e.project, []); order.push(e.project) }
    const bucket = byProj.get(e.project)!
    // NEVER SAY ONE THING TWICE. One photo over-decomposed into two halves of the same ceiling, he
    // answered the same work to both asks, and the readback told him twice that the frame was updated.
    // An identical line for the same site is the same FACT, and a repeat reads as two writes that never
    // happened. A duplicate costs more trust than a wrong extraction: a wrong extraction looks like a
    // mistake, a duplicate looks like a malfunction.
    if (bucket.includes(line)) continue
    bucket.push(line)
  }
  if (!order.length) return 'Got it'

  // the count, in the terms the reader cares about: how many things, across how many sites
  const filed = [...byProj.values()].reduce((n, ls) => n + ls.length, 0)
  const sites = order.filter((p): p is string => !!p).length
  const head = `${G.done} ${bold(`${filed} update${filed === 1 ? '' : 's'} filed`)}${sites > 1 ? ` — ${sites} sites` : ''}`

  const multiProject = order.length > 1
  const sections = order.map((proj) => {
    const ls = (byProj.get(proj) ?? []).join('\n')
    return multiProject && proj ? `${heading(proj)}\n${ls}` : ls
  })

  return blocks(head, ...sections, REPAIR)
}

/**
 * ══ TYPE 5 · THE CONFIRMATION — ONE DOOR ═════════════════════════════════════════════════════════════
 *
 * Six places in this codebase sent a confirmation, and each one hand-rolled its own message: the executor's
 * direct path, the batched flush, the pick-resume fold, the interrupt flush, the 2-minute sweep. They shared
 * the BODY (combineReadbacks) and nothing else — so the undo button existed on exactly one of them, and a
 * destination line could be added to one and silently missing from the other four. That is the same shape as
 * the bug this codebase already paid for once ("one road, one door"): a fact that must be true of every
 * message cannot live in the callers.
 *
 * So the confirmation is composed ONCE, here, as a whole OutMessage — body, destination line, button — and
 * every send site passes its entries in and sends what comes back.
 *
 *     ✓ *3 updates filed* — 2 sites
 *
 *     *The Pride*
 *     ✓ Floor — tiling · Ground
 *
 *     *Chakradhar's Residence*
 *     ✓ Site — ground clearance
 *
 *     Recorded in *Tasks* · Briklay
 *     [ Open Tasks ]
 *
 * ── THE ONE BUTTON, AND WHO GETS IT ─────────────────────────────────────────────────────────────────
 *
 * WhatsApp allows ONE interactive type per message — three reply buttons OR one URL button, never both. So
 * the slot is genuinely scarce, and it goes to the most consequential thing the reader could do next:
 *
 *   1. UNDO, when a resolve landed. He just told us an issue is finished and we closed it. If we heard that
 *      wrong, the fastest possible reversal beats the fastest possible navigation — and a wrongly-closed
 *      issue is invisible precisely because it is closed. Nothing outranks it.
 *   2. OPEN REVIEW, when anything is held, failed or unplaced. The one thing that still needs him.
 *   3. VIEW TASK, when exactly one record was written and we know which. "View" lands on THE RECORD.
 *   4. OPEN TASKS, when several updates landed and every one of them was a task. No single record to open,
 *      but they all live in one section — so it points at the Tasks plan, not the day.
 *   5. OPEN TODAY, otherwise — a bundle that spans homes and one button cannot point at all of them, so it
 *      points one level UP, at Problems: the half of the desk that needs a human.
 *
 * The DESTINATION LINE, unlike the button, is not scarce: it rides every one of these, because it is the
 * line that proves the write happened and teaches where the thing now lives.
 */
export function composeConfirmation(
  entries: ReadbackEntry[],
  resolvedRefs: { kind: string; id: string; event: string }[] = [],
): OutMessage {
  const readback = combineReadbacks(entries)

  // WHERE IT LANDED — the union of the homes the entries actually wrote to. Nothing written → no line.
  const order: Home[] = ['Day Book', 'Tasks', 'Problems', 'Review']
  const homes = order.filter((h) => entries.some((e) => e.homes?.includes(h)))

  // THE REASSURANCE GOES LAST, AND IT GOES ONCE. Every failure line used to carry its own "— saved for
  // review", so a message that failed three times said it three times, each one before the reader had
  // finished the bad news. Reason, then destination, then reassurance: it belongs on the line that names
  // the home it was saved INTO, and nowhere else.
  const dest = homes.length
    ? destinationLine(homes) + (homes.includes('Review') ? " — nothing's lost." : '')
    : ''
  const body = blocks(readback, dest)

  // 1 — the undo outranks every link (see above). It keeps its reply-button slot, and the destination line
  //     still rides along, so he is told where the row went even while being offered to take it back.
  if (entries.length === 1 && resolvedRefs.length) {
    return { kind: 'buttons', body, buttons: [{ id: 'siteops_undo', title: 'Not resolved' }] }
  }

  const link: Link | null =
    homes.includes('Review') ? reviewLink()                                  // 2 — the thing still owed
    : entries.length === 1 && entries[0].link ? entries[0].link              // 3 — the one record we wrote
    : homes.length === 1 && homes[0] === 'Tasks' ? tasksLink()               // 4 — a pure task digest → the Tasks section
    : homes.length ? todayLink()                                             // 5 — a mixed bundle → the day (Problems)
    : null                                                                   //     nothing written → no button

  return link ? { kind: 'cta', body, cta: link } : { kind: 'text', body }
}

/** The deep link for ONE written record — the `link` an entry carries when it wrote exactly one row.
 *  A task is the only kind we can currently address precisely (the desk opens it by ref); an issue's
 *  permalink needs the site code, which the executor does not hold, so those fall back to the day. */
export function recordLink(projectId: string | null | undefined, targetId: string, kind: string): Link | null {
  return projectId && kind === 'task' ? taskLink(projectId, targetId) : null
}
