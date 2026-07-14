// BABAI'S VOICE — the one grammar every outbound message is built from.
//
// ══ WHY THIS FILE EXISTS ═══════════════════════════════════════════════════════════════════════════
//
// The screen is WhatsApp. There is no UI to design — only words, order and rhythm. So the whole of the
// design lives in a handful of rules, and the ONLY way rules like that survive contact with a codebase
// is if there is exactly one place they are written down and every message is built by calling it.
//
// Copy scattered across eight files drifts within a week: one confirmation says "✓ Added to your Day
// Book", another says "✅ Posted", a third says "Recorded". Three formats is not three styles, it is a
// system the reader cannot learn — and a reader who cannot learn the shape has to READ every message
// instead of scanning it, which on a five-inch screen in sunlight with cement on his thumb is the
// difference between a tool and a chore.
//
// ══ THE FIVE MARKS — ONE MEANING EACH ══════════════════════════════════════════════════════════════
//
//   *bold*      THE FACT THAT CHANGED — the amount, the work item, the answer. ONE bold run per block,
//               maximum. Reading only the bold across a whole day must reconstruct the day. The moment
//               bold means three things, the reader stops trusting bold.
//   _italic_    HUMAN SPEECH AND SOFT STATES — his quoted words, a thing still in motion. Machine
//               statements are always plain: plain is Babai talking, italic is YOU talking.
//   ~strike~    CORRECTIONS ONLY. `~₹342~ *₹355* → Raju` — old, new, done, one glance. Never emphasis.
//   ```mono```  ALIGNED MONEY COLUMNS ONLY. Digits line up and it reads as a ledger page. Banned
//               everywhere else: it renders grey and looks like debug output.
//   > quote     Never. Use native reply-threading instead.
//
// ══ THE THREE SEPARATORS ═══════════════════════════════════════════════════════════════════════════
//
//   ·  joins siblings inside one fact          False-ceiling frame · Ground
//   —  attaches context or annotation          — The Pride,  — boards not yet fixed
//   →  money direction, and NOTHING else       ₹342 → Raju
//
// Banned: parentheses, `/`, `|`, `..`, and `:` except after "You said". Every stray mark is noise.

// ── THE GLYPHS. One leading glyph per message. Zero emoji inside a body. ────────────────────────────
//
// Fixed meanings, never decorative. ✅ is dead (a duplicate of ✓); 👇 is dead (it says nothing); 📍 is
// dead (it stamped UNCONFIRMED locations as fact, which is the worst thing a mark can do).
export const G = {
  photo: '📷',   // a photo arrived
  voice: '🎤',   // a voice note arrived
  money: '🧾',   // money detected
  done: '✓',    // posted · done. Every confirmation line, everywhere.
  held: '⏸',    // held for review — anything parked, failed or unplaced. BABAI has a question.
  ask: '❓',    // I need you — every disambiguation
  problem: '⚠',  // THE SITE has a problem. Distinct from ⏸, which is Babai's limbo, not the site's.
} as const

/** ⏸ deserves a name, a glyph and a home. A named limbo is trustworthy; an unnamed one is a black hole. */
export const HELD = 'Review'

// ── THE FOUR HOMES — four words, never synonyms ─────────────────────────────────────────────────────
//
// These are the EXACT tab names in the app. Never "your diary", never "the ledger", never "site log":
// he taps the button and lands somewhere named exactly what the message said, and after a week of
// confirmations he knows the app's geography without anyone teaching him.
export type Home = 'Day Book' | 'Tasks' | 'Problems' | 'Review'

// ── NUMBERS ────────────────────────────────────────────────────────────────────────────────────────
/** ₹1,20,000 — Indian grouping, no decimals unless paise exist, no space after ₹. */
export function money(n: number): string {
  const paise = Math.round(n * 100) % 100 !== 0
  return '₹' + n.toLocaleString('en-IN', {
    minimumFractionDigits: paise ? 2 : 0,
    maximumFractionDigits: paise ? 2 : 0,
  })
}

// ── THE MARKS, as functions, so they cannot be used for the wrong job by accident ───────────────────
export const bold = (s: string) => `*${s}*`
export const italic = (s: string) => `_${s}_`
export const strike = (s: string) => `~${s}~`

/** Drop any mark a caller has already applied — bold inside bold renders as literal asterisks. */
export const plain = (s: string) => s.replace(/[*_~`]/g, '').trim()

// ── THE LINES ──────────────────────────────────────────────────────────────────────────────────────

/**
 * EVERY ✓ LINE, EVERYWHERE, IS THIS SHAPE.
 *
 *     ✓ *Work item* · Floor — Project
 *
 * The bold carries the changed fact and nothing else. The project appears ONCE per message — and in a
 * project-grouped digest the header carries it, so it drops from the lines entirely (pass project=null).
 */
export function postedLine(work: string, where?: string | null, project?: string | null): string {
  const fact = bold(plain(work))
  const place = where ? ` · ${plain(where)}` : ''
  const proj = project ? ` — ${plain(project)}` : ''
  return `${G.done} ${fact}${place}${proj}`
}

/**
 *     ✓ *₹342 → Raju* — The Pride
 *
 * The whole money fact — amount, direction and party — is ONE bold run, because it is one fact. Split
 * across two bold runs and the eye has to decide which of them is the news.
 */
export function moneyLine(amount: number, party: string | null, project?: string | null): string {
  const fact = party ? `${money(amount)} → ${plain(party)}` : money(amount)
  return `${G.done} ${bold(fact)}${project ? ` — ${plain(project)}` : ''}`
}

/** A correction: old struck through, new in bold, one line. `✓ ~₹342~ *₹355 → Raju* — corrected` */
export function correctionLine(was: number, now: number, party: string | null, project?: string | null): string {
  const fact = party ? `${money(now)} → ${plain(party)}` : money(now)
  return `${G.done} ${strike(money(was))} ${bold(fact)}${project ? ` — ${plain(project)}` : ''} — corrected`
}

/** `⚠ *Tiles not delivered — mason waiting* · Ground — The Pride` — the SITE has a problem. */
export function problemLine(what: string, where?: string | null, project?: string | null): string {
  return `${G.problem} ${bold(plain(what))}${where ? ` · ${plain(where)}` : ''}${project ? ` — ${plain(project)}` : ''}`
}

/**
 * THE DESTINATION LINE — proof of a write, and the app's geography, taught one message at a time.
 *
 * It appears on EVERY message that wrote data and on NOTHING else. Acks, readbacks, questions, chases
 * and small talk never carry one: if it appears on everything, it proves nothing. That "and on NOTHING
 * else" is load-bearing — a didn't-catch or an untracked-work ack wrote no row, and stamping "Recorded in
 * Tasks" under it would be the system claiming a write it did not make.
 *
 * `Recorded in *Day Book* · Briklay` — and `Updated in` for a correction, because the record moved, it
 * was not born. One turn can land in more than one home ("Recorded in *Tasks & Review* · Briklay"), and
 * saying both is the point: it is the only line that tells him where to go looking.
 */
export function destinationLine(home: Home | Home[], verb: 'Recorded' | 'Updated' = 'Recorded'): string {
  const homes = Array.isArray(home) ? home : [home]
  if (!homes.length) return ''
  return `${verb} in ${bold(homes.join(' & '))} · Briklay`
}

/**
 * THE REPAIR HANDLE — one sentence, and only on a TERMINAL message.
 *
 * An ack or a question never carries it: they are not done yet, and begging for a correction mid-flow
 * reads anxious. In an interactive message it belongs in the FOOTER, where WhatsApp renders it small
 * and grey — which is exactly the weight meta-text should have.
 */
export const REPAIR = 'Wrong anywhere? Just reply — I’ll fix it.'
export const REPAIR_SHORT = 'Wrong anywhere? Just reply.'   // the footer field is tight

/**
 * A HEADING, in a medium that has none: a blank line above, and one bold line. That is the entire
 * heading system. One blank line between blocks — never two.
 */
export function heading(s: string): string {
  return bold(plain(s))
}

/** Join blocks with exactly one blank line, dropping the empties. Never two blank lines. */
export function blocks(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => !!p && p.trim() !== '').join('\n\n')
}

/** Join lines inside one block. Max 4 lines a block — past that the eye stops scanning and starts reading. */
export function lines(...parts: (string | null | undefined | false)[]): string {
  return parts.filter((p): p is string => !!p && p.trim() !== '').join('\n')
}

// ── INTERACTIVE COMPONENTS ──────────────────────────────────────────────────────────────────────────

/**
 * MARKUP DOES NOT RENDER INSIDE INTERACTIVE COMPONENTS.
 *
 * A row title, a button label or a list header containing `*Ceiling*` shows the ASTERISKS. Visible stars
 * read as a broken app. So everything that goes into a row, a button or a header is stripped bare, and
 * the hierarchy comes from title vs description instead — which is what those fields are for.
 */
export const ROW_TITLE_MAX = 24
export const ROW_DESC_MAX = 72
export const BUTTON_MAX = 20

/**
 * A ROW TITLE — 24 characters, hard, and truncation must not be visible.
 *
 * `Ceiling — false-ceiling frame` is 29 and would land as `Ceiling — false-ceilin…`, which reads as a
 * bug. But the row's DESCRIPTION already carries `Ceiling · Ground` — the category is right there — so
 * the prefix in the title is a repetition we can spend: drop it, and `False-ceiling frame` fits whole.
 *
 * Only then, if it still does not fit, do we cut — and we cut at a word, never mid-syllable.
 */
export function rowTitle(label: string): string {
  let s = plain(label)
  if (s.length > ROW_TITLE_MAX && s.includes(' — ')) s = s.slice(s.indexOf(' — ') + 3).trim()
  if (s.length <= ROW_TITLE_MAX) return s
  const cut = s.slice(0, ROW_TITLE_MAX - 1)
  const sp = cut.lastIndexOf(' ')
  return (sp > 10 ? cut.slice(0, sp) : cut).trim() + '…'
}

export function rowDesc(s: string): string {
  const t = plain(s)
  return t.length <= ROW_DESC_MAX ? t : t.slice(0, ROW_DESC_MAX - 1).trim() + '…'
}

export function buttonText(s: string): string {
  const t = plain(s)
  return t.length <= BUTTON_MAX ? t : t.slice(0, BUTTON_MAX - 1).trim() + '…'
}
