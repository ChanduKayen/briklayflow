// WhatsApp Sprint 5 -- message catalog. Every outbound transaction string is built
// here, keyed by language (router's reply_language). EN is filled; TE/HI are STUBS
// that fall back to EN -- a foreman writes Tenglish, not formal Telugu, so Chandu
// fills te/hi by hand (do not auto-generate). Returns Sprint-2 OutMessage objects
// so the formatter renders the right interactive type.

import type { OutMessage } from './_format.ts'
import { entryLink, dayBookLink } from './_links.ts'

export type Lang = 'en' | 'te' | 'te-en' | 'hi'

// The deep-link placeholder the staging RPC substitutes with "<WA_APP_LINK>?entry=<id>"
// (the id only exists after the row is inserted). CTA URL buttons need a real https URL.
export const EDIT_LINK = '__ENTRY_LINK__'

// WhatsApp limits.
const trunc = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
const ROW_TITLE = 24, ROW_DESC = 72, MAX_ROWS = 10, MAX_BTNS = 3

/** Pick localized copy; te/hi fall back to en until Chandu fills them. */
function pick(lang: Lang, c: { en: string; te?: string; hi?: string }): string {
  if ((lang === 'te' || lang === 'te-en') && c.te) return c.te
  if (lang === 'hi' && c.hi) return c.hi
  return c.en
}

/** "Ramu · ₹5,000 · The Pride" (parts omitted when absent). */
function entryLine(payee: string | null, amount: number | null, project: string | null): string {
  const parts: string[] = []
  if (payee) parts.push(payee)
  if (amount != null) parts.push('₹' + amount.toLocaleString('en-IN'))
  if (project) parts.push(project)
  return parts.join(' · ')
}

// ── Catalog ─────────────────────────────────────────────────────────────────────

/**
 * ══ TYPE 5 · THE SINGLE-PAYMENT CONFIRMATION ═════════════════════════════════════════════════════════
 *
 *     ✓ *₹25,000 → Nukaraju* — Dr Soundharya Residence
 *
 *     _Weekly payment for Dr Soundharya's site_
 *
 *     Recorded in *Day Book* · Briklay
 *     [ View entry ]
 *
 * ── WHY THIS EXISTED SEPARATELY, AND WHAT IT COST ────────────────────────────────────────────────────
 *
 * There were TWO money composers: mBatch for 2+ payments, and this one for a single payment — which is to
 * say, this one, almost always. The Type 5 pass unified six hand-rolled confirmation composers in SiteOps
 * and fixed mBatch, and MISSED this. So the new grammar shipped to the rare case and the old copy stayed
 * live on the common one. That is the exact disease Type 5 was written to cure, caught wearing the cure.
 *
 * ── LINE 1 IS THE NOTIFICATION ───────────────────────────────────────────────────────────────────────
 *
 * It opened with `✓ Added to your Day Book` and put the money on line 2. A push preview shows roughly the
 * first fifty characters, so what a man saw on his lock screen was a sentence with no amount, no payee and
 * no site in it — a preamble to a fact, delivered instead of the fact. The money IS the news; it goes first,
 * and "Day Book" moves to the destination line, where it also earns its keep by naming the home.
 *
 * ── ONE BOLD RUN, AND THE ARROW ──────────────────────────────────────────────────────────────────────
 *
 * Amount, direction and party are ONE fact. `→` is money direction and nothing else, so `₹25,000 → Nukaraju`
 * says who paid whom without a preposition — and the project rides after the em-dash as context, unbolded,
 * because it is not the news.
 *
 * ── AND A GAP GETS A HANDLE (Type 7) ─────────────────────────────────────────────────────────────────
 *
 * `Nukaraju isn't in your contacts yet` is a bare observation — an orphan line, the machine thinking out
 * loud. Every unknown gets the same shape: NAME the gap, OFFER the one fix, MAKE IGNORING SAFE. The fix
 * here is the button this card already carries, so the line points at it and promises what happens if he
 * does nothing.
 *
 * The CTA target is unchanged (EDIT_LINK → the staging RPC substitutes the real entry link), and so are the
 * states and the gating. `mode`/`direction` render only when supplied.
 */
export function mComplete(
  lang: Lang,
  p: {
    payee: string | null; payeeMatched: boolean;
    amount: number | null;
    projectName: string | null; projectRaw: string | null;
    note: string | null;
    mode?: string | null;              // appended after the fact ONLY when present
    direction?: 'out' | 'in' | null;   // 'in' → money came TO us: the arrow reverses
  },
): OutMessage {
  // 1. THE FACT — one bold run: amount, direction, party. The project is context, after the dash.
  const amt = p.amount != null ? '₹' + p.amount.toLocaleString('en-IN') : pick(lang, { en: 'amount not set' })
  const who = p.payee ?? pick(lang, { en: 'payee not set' })
  const flow = p.direction === 'in' ? `${who} → ${amt}` : `${amt} → ${who}`
  const site = p.projectName ?? p.projectRaw ?? null
  const modeBit = p.mode?.trim() ? ` · ${p.mode.trim()}` : ''
  const fact = `✓ *${flow}*${site ? ` — ${site}` : ''}${modeBit}`

  // 2. HIS note, raw (never summarised), italic — his words stay in his voice.
  const noteBlock = p.note?.trim() ? `_${p.note.trim()}_` : ''

  // 3. THE GAPS — named, each with the one fix, and ignoring is safe (Type 7).
  const flags: string[] = []
  if (p.payee && !p.payeeMatched) {
    flags.push(pick(lang, {
      en: `*${p.payee}* is new to me — tap below to add them to contacts, or ignore and I'll keep this as a one-off.`,
    }))
  }
  if (p.projectRaw) {
    flags.push(pick(lang, {
      en: `I don't have a site called *${p.projectRaw}* — tap below to set the right one, or ignore and it stays unassigned.`,
    }))
  }
  const flagBlock = flags.join('\n')

  // 4. WHERE IT LANDED — the proof of the write, on every card that made one.
  const dest = `Recorded in *Day Book* · Briklay`

  // The CTA label still names the state; the target is unchanged.
  const ctaText =
    (p.payee && !p.payeeMatched) ? pick(lang, { en: 'Add contact' })
    : p.projectRaw ? pick(lang, { en: 'Set the site' })
    : pick(lang, { en: 'View entry' })

  const body = [fact, noteBlock, flagBlock, dest].filter(Boolean).join('\n\n')
  return { kind: 'cta', body, cta: { text: ctaText, url: EDIT_LINK } }
}

// ── Instant routing ack ───────────────────────────────────────────────────────
// Sent the MOMENT a message is routed to the Transaction agent — before the (slower)
// extraction + staging — so the sender knows it landed and isn't left waiting. TONE:
// mature and confidence-inspiring, not cute. ONE calm line: a single consistent ledger
// emoji (🧾, not a rotating zoo of cute ones), a *bold* receipt word, then a precise
// BOOKKEEPING action. It does NOT name a destination — "Day Book" is owned by the
// confirmation (mComplete: "Added to your Day Book"); naming "books"/"ledger" here would
// introduce a competing term and confuse. No payee/amount yet (not read) → it stays
// general. The verb rotates so back-to-back entries don't read like a robot. EN filled;
// te/hi stay stubs (fall back to EN).
const TXN_ACKS: { en: string; te?: string; hi?: string }[] = [
  { en: '🧾 *Got it* — recording your transaction…' },
  { en: '🧾 *Received* — putting it on record…' },
  { en: '🧾 *Noted* — filing your entry…' },
  { en: '🧾 *Got it* — recording the details now…' },
  { en: '🧾 *Received* — entering your transaction…' },
]

/** A quick "received, working on it…" — rotated, sent before extraction begins. */
export function mTxnAck(lang: Lang): OutMessage {
  const c = TXN_ACKS[Math.floor(Math.random() * TXN_ACKS.length)]
  return { kind: 'text', body: pick(lang, c) }
}

// Procurement (materials request) routing ack — same instant-ack pattern + mature voice
// as TXN_ACKS, but a procurement glyph (📦) and sourcing verbs. No destination named
// (the procurement flow's own messages own "purchase request"/"order"); it stays general
// because we haven't read the items/qty yet. Verb rotates so repeats don't read robotic.
const PROC_ACKS: { en: string; te?: string; hi?: string }[] = [
  { en: '📦 *Got it* — preparing your order…' },
  { en: '📦 *Received* — sourcing this now…' },
  { en: '📦 *Noted* — drafting your request…' },
  { en: '📦 *Got it* — getting the order ready…' },
  { en: '📦 *Received* — pulling the details together…' },
]

/** A quick procurement "received, sourcing…" — rotated, sent on routing before the gate.
 *  (Distinct from the flow's mProcAck below, which is the vendor-confirmed "raising it".) */
export function mProcRouteAck(lang: Lang): OutMessage {
  const c = PROC_ACKS[Math.floor(Math.random() * PROC_ACKS.length)]
  return { kind: 'text', body: pick(lang, c) }
}

// SiteOps routing ack — the same instant-ack pattern TRANSACTION and PROCUREMENT have had all along,
// and which SiteOps, ALONE, did not.
//
// SiteOps is by some distance the slowest agent: a measured voice turn ran ~30s from the supervisor
// finishing his sentence to his phone buzzing (STT → router → decompose → a resolve call per item →
// the readback). Every other agent said "got it" in the first second; the one that takes half a minute
// said nothing at all. That is exactly backwards.
//
// It names NOTHING it has not read yet — no site, no task, no count. The site and the items are the
// readback's to own, and a wrong guess here would be a correction the supervisor has to make. It says
// only the one thing we know for certain at routing time: it arrived, and we are reading it.
const SITEOPS_ACKS: { en: string; te?: string; hi?: string }[] = [
  { en: '📋 *Got it* — reading your update…', te: '📋 *అందింది* — చూస్తున్నాను…' },
  { en: '📋 *Received* — going through it now…', te: '📋 *అందింది* — ఇప్పుడే చూస్తున్నాను…' },
  { en: '📋 *Noted* — working through it…', te: '📋 *నోట్ చేసుకున్నా* — చూస్తున్నాను…' },
]

// A VOICE note earns its own line. He has just spoken for twenty seconds and the transcription alone
// takes ~7s of the turn — so name the thing he actually did, and the wait stops feeling like a fault.
const SITEOPS_VOICE_ACKS: { en: string; te?: string; hi?: string }[] = [
  { en: '🎤 *Got your voice note* — listening…', te: '🎤 *వాయిస్ నోట్ అందింది* — వింటున్నాను…' },
  { en: '🎤 *Received* — playing it back now…', te: '🎤 *అందింది* — ఇప్పుడే వింటున్నాను…' },
]

// A PHOTO likewise: the vision pass is a real, visible cost, and "looking at it" is the honest word.
const SITEOPS_IMAGE_ACKS: { en: string; te?: string; hi?: string }[] = [
  { en: '📷 *Got your photo* — looking at it…', te: '📷 *ఫోటో అందింది* — చూస్తున్నాను…' },
  { en: '📷 *Received* — checking the photo…', te: '📷 *అందింది* — ఫోటో చూస్తున్నాను…' },
]

/** The instant "it landed, I'm reading it" — sent on routing to SITEOPS, before the slow work begins. */
export function mSiteopsAck(lang: Lang, media: 'voice' | 'image' | null = null): OutMessage {
  const pool = media === 'voice' ? SITEOPS_VOICE_ACKS : media === 'image' ? SITEOPS_IMAGE_ACKS : SITEOPS_ACKS
  const c = pool[Math.floor(Math.random() * pool.length)]
  return { kind: 'text', body: pick(lang, c) }
}

/**
 * THE MEDIA ACK — sent the INSTANT a voice note or a photo arrives, before we have read a word of it.
 *
 * The agent acks above all fire from the dispatcher, which runs AFTER transcription and AFTER the router. On
 * a TEXT message that is ~5s. On a VOICE NOTE it measured **10 seconds** — transcription alone was 5.4s and
 * the router another 4.8s — and an acknowledgement that arrives ten seconds late is not an acknowledgement,
 * it is a delayed reaction. He has already looked at the screen twice by then.
 *
 * This one needs NOTHING we have to compute. It does not claim to know what he said, which site he meant, or
 * even which agent will handle it — because at this point we do not. It claims exactly one thing, and it is
 * true of a voice note whatever it turns out to be about: **it arrived, and we are listening to it.**
 *
 * The language is a guess (we have no transcript yet), so it says as little as possible and leans on the
 * emoji. The real, language-correct reply follows from the agent that ends up owning the turn.
 */
const MEDIA_ACKS: Record<'voice' | 'image', { en: string; te?: string; hi?: string }> = {
  voice: { en: '🎤 Got your voice note — listening…', te: '🎤 వాయిస్ నోట్ అందింది — వింటున్నాను…' },
  image: { en: '📷 Got your photo — looking at it…', te: '📷 ఫోటో అందింది — చూస్తున్నాను…' },
}

export function mMediaAck(lang: Lang, media: 'voice' | 'image'): OutMessage {
  return { kind: 'text', body: pick(lang, MEDIA_ACKS[media]) }
}

// ── The two essential-asks (the ONLY questions the Transaction agent ever sends) ──
// Each captures a raw value; neither matches against the DB. Acknowledge-before-ask:
// surface what is already known, ask only the gap.

/** Amount missing (payee may be known): "Paid <payee> — how much?" / "How much?". */
export function mAskAmount(lang: Lang, p: { payee: string | null }): OutMessage {
  return { kind: 'text', body: p.payee
    ? `${pick(lang, { en: 'Paid' })} ${p.payee} — ${pick(lang, { en: 'how much?' })}`
    : pick(lang, { en: 'How much?' }) }
}

/** Payee missing (amount may be known): "₹<amount> to whom?" / "Who did you pay?". */
export function mAskPayee(lang: Lang, p: { amount: number | null } = { amount: null }): OutMessage {
  return { kind: 'text', body: p.amount != null
    ? `₹${p.amount.toLocaleString('en-IN')} ${pick(lang, { en: 'to whom?' })}`
    : pick(lang, { en: 'Who did you pay?' }) }
}

/** Both essentials missing: one combined natural ask. */
export function mAskBoth(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: 'Who did you pay, and how much?' }) }
}

/** Re-prompt when an amount answer didn't parse to a number. */
export function mJustAmount(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: 'Just the amount please — e.g. 5000 or 5k' }) }
}

// NOTE: mProjectList / mConfirmPayee / mConfirmProject below are retained for the
// concierge and future agents. The Transaction agent no longer calls them — its
// disambiguation moved to the Day Book (capture-first). Do not delete.

/** Project selection: interactive LIST (replaces "Reply 1-5"). */
export function mProjectList(
  lang: Lang,
  p: { payee: string | null; amount: number; options: { id: string; name: string }[]; prefix?: string },
): OutMessage {
  const head = p.prefix ? p.prefix + ' ' : ''
  const body = `${head}${entryLine(p.payee, p.amount, null)} — ${pick(lang, { en: 'which project?' })}`
  return {
    kind: 'list',
    body,
    button: pick(lang, { en: 'Choose project' }),
    rows: p.options.slice(0, MAX_ROWS).map((o) => ({ id: o.id, title: trunc(o.name, ROW_TITLE) })),
  }
}

/** Mid-confidence payee: reply BUTTONS (no silent auto-commit). */
export function mConfirmPayee(lang: Lang, p: { guess: string }): OutMessage {
  return {
    kind: 'buttons',
    body: pick(lang, { en: `Pay to ${p.guess}?` }),
    buttons: [
      { id: 'confirm_payee_yes', title: pick(lang, { en: 'Yes' }) },
      { id: 'confirm_payee_no', title: trunc(pick(lang, { en: 'No, someone else' }), 20) },
    ].slice(0, MAX_BTNS),
  }
}

/** Mid-confidence project: reply BUTTONS. */
export function mConfirmProject(lang: Lang, p: { guess: string }): OutMessage {
  return {
    kind: 'buttons',
    body: pick(lang, { en: `→ ${p.guess}?` }),
    buttons: [
      { id: 'confirm_project_yes', title: pick(lang, { en: 'Yes' }) },
      { id: 'confirm_project_no', title: pick(lang, { en: 'Pick another' }) },
    ].slice(0, MAX_BTNS),
  }
}

/** Interrupted (consolidated): a LIST whose body carries A's ack + B's question. */
export function mInterruptedList(
  lang: Lang,
  p: { ackA: string; payee: string | null; amount: number; options: { id: string; name: string }[] },
): OutMessage {
  return mProjectList(lang, { payee: p.payee, amount: p.amount, options: p.options, prefix: p.ackA + ' — ' + pick(lang, { en: 'now,' }) })
}

/**
 * THE INCOMPLETE ENTRY — a row WAS written, so it owes a destination line like any other write.
 *
 * It read `Saved Nukaraju · ₹25,000 — payee not set. Add anytime.`: it never said where "saved" had put it,
 * and it stated the gap as a bare fact with no handle on it. Every unknown gets the same shape (Type 7) —
 * NAME the gap, OFFER the one fix, MAKE IGNORING SAFE — and here ignoring it really is safe, because the
 * entry is in the Day Book whatever he does next. That is the reassuring thing to say, so it is said LAST.
 * (Also the A1 fix path; also enqueued by the SQL sweep.)
 */
export function mAbandoned(lang: Lang, p: { payee: string | null; amount: number | null; missing: string }): OutMessage {
  // What we DID capture leads — half a fact is still the news, and it is what he will recognise.
  const amt = p.amount != null ? '₹' + p.amount.toLocaleString('en-IN') : null
  const fact = amt && p.payee ? `${amt} → ${p.payee}` : (amt ?? p.payee ?? pick(lang, { en: 'your entry' }))
  return {
    kind: 'cta',
    body: [
      `✓ *${fact}*`,
      pick(lang, { en: `I don't have the ${p.missing} yet — tap below to add it, or leave it and I'll keep the entry as it is.` }),
      `Recorded in *Day Book* · Briklay`,
    ].join('\n\n'),
    cta: { text: pick(lang, { en: 'Add details' }), url: EDIT_LINK },
  }
}

export function mCancelled(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: 'Okay, discarded that.' }) }
}

export function mFailureNoAmount(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: "Couldn't log that — I didn't catch an amount. Try: paid 5000 to ramu." }) }
}

// ── Explicit write-failure (the entry did NOT commit) ─────────────────────────────
// No silent failure, no false "✓": when the staging RPC rolls back, the user is told
// EXPLICITLY that nothing was recorded, sees exactly what was lost (from the parsed
// values -- the entry has no id), and gets a one-tap replay. Reply BUTTONS (a CTA URL
// button can't share a message with reply buttons -> [Add in Day Book] sends the link
// as a follow-up).

/** "⏸ *Couldn't save ₹12,000 → Kumar* — ASM Elite / Nothing was recorded — tap to try again." */
export function mWriteFailed(
  lang: Lang,
  p: { payee: string | null; amount: number | null; project: string | null; replayId: string },
): OutMessage {
  // ⏸, NOT ⚠️. ⚠️ means the SITE has a problem — something a builder must act on. A write that failed on OUR
  // side is Babai's limbo. Using one mark for both is how a warning glyph stops being read at all.
  // And NO destination line: this one is telling the truth when it says nothing was recorded, so there is no
  // home to name — the reassurance is that nothing half-landed, and it comes LAST.
  const amt = p.amount != null ? '₹' + p.amount.toLocaleString('en-IN') : null
  const fact = amt && p.payee ? `${amt} → ${p.payee}` : (amt ?? p.payee ?? pick(lang, { en: 'that' }))
  const site = p.project ? ` — ${p.project}` : ''
  const body = [
    `⏸ *${pick(lang, { en: "Couldn't save" })} ${fact}*${site}`,
    pick(lang, { en: 'Nothing was recorded — tap to try again.' }),
  ].join('\n\n')
  return {
    kind: 'buttons',
    body,
    buttons: [
      { id: `retry_${p.replayId}`, title: pick(lang, { en: 'Try again' }) },
      { id: 'add_daybook', title: trunc(pick(lang, { en: 'Add in Day Book' }), 20) },
    ],
  }
}

/**
 * Aggregated multi-entry card. ALL good -> a CTA listing each entry + the day-total.
 * PARTIAL -> reply-buttons naming each saved/not-saved line + [Try again] (one entry's
 * replay id, or a retry-all token for ≥2) + [Add in Day Book]. Functional EN copy; the
 * message-system pass polishes te-latin/te-script later. retryButtonId is null only when
 * nothing failed. The URLs come from the LINK LAYER (_links.ts) — this card is sent OUTSIDE the
 * staging RPC, so the __ENTRY_LINK__ placeholder would never be substituted.
 */
type BatchEntry = {
  payee: string | null; amount: number | null; project: string | null; committed: boolean
  /** The staged entry's id — the deep-link target when exactly one entry landed. */
  entryId?: string | null
}

export function mBatch(
  lang: Lang,
  p: { entries: BatchEntry[]; retryButtonId: string | null },
): OutMessage {
  /**
   * ══ TYPE 5 · THE MONEY CONFIRMATION ═════════════════════════════════════════════════════════════════
   *
   *     ✓ *₹3,25,000 → Rajeev Sharma* — The Pride
   *     Recorded in *Day Book* · Briklay
   *     [ View entry ]
   *
   * ── THE ARROW WAS POINTING THE WRONG WAY ────────────────────────────────────────────────────────────
   *
   * This card read `Rajeev Sharma → ₹3,25,000`, and in the one grammar this system has, `→` means MONEY
   * DIRECTION and nothing else. So the line said, precisely, that Rajeev paid US three lakh — the exact
   * inverse of what happened. It is the single worst sentence the system could produce about money, and it
   * was produced on every payment, because nobody had written the arrow's meaning down anywhere.
   *
   * ── AND THE WHOLE FACT IS ONE BOLD RUN ──────────────────────────────────────────────────────────────
   *
   * Amount, direction and party are ONE fact; split across two bold runs, the eye has to decide which of
   * them is the news. The project rides after the em-dash as context, unbolded, because it is not.
   */
  const money = (n: number) => '₹' + n.toLocaleString('en-IN')
  const line = (e: BatchEntry) => {
    const amt = e.amount != null ? money(e.amount) : pick(lang, { en: 'amount not set' })
    const who = e.payee ?? pick(lang, { en: 'payee not set' })
    const proj = e.project ? ` — ${e.project}` : ''
    return `${amt} → ${who}${proj}`
  }
  const committed = p.entries.filter((e) => e.committed)
  const failed = p.entries.filter((e) => !e.committed)
  const savedSum = committed.reduce((s, e) => s + (e.amount ?? 0), 0)

  // WHERE IT LANDED — on every card, because a card that wrote money and did not say where is the one
  // message a builder will not take on trust.
  const dest = `Recorded in *Day Book* · Briklay`

  if (!failed.length) {
    // ONE payment → the payment IS the headline, and the button lands on THAT entry (not on the Day Book
    // to go looking in). Several → the count is the headline, and the button opens the book.
    const one = committed.length === 1 ? committed[0] : null
    const body = one
      ? [`✓ *${line(one)}*`, dest].join('\n')
      : [
          `✓ *${committed.length} payments filed* — ${money(savedSum)}`,
          committed.map(line).join('\n'),
          dest,
        ].join('\n\n')
    // THE LINK LAYER OWNS THE URL (_links.ts). It was being built here by hand from a second copy of the
    // Day Book base — two builders for one address is exactly the drift that layer exists to prevent.
    return { kind: 'cta', body, cta: one?.entryId ? entryLink(one.entryId) : dayBookLink() }
  }

  /**
   * PARTIAL. The retry button OUTRANKS the deep link for the same reason undo does on a site readback:
   * WhatsApp allows one interactive type per message, and the most consequential thing he can do is not
   * "go look at the ones that worked" — it is "save the one that didn't". So the link goes and the
   * buttons stay.
   *
   * ⏸, NOT ⚠️: a write that failed on our side is Babai's limbo, not a hazard on his site. And the
   * reassurance ("nothing was recorded for these") is LAST, after he has read what actually happened.
   */
  const head = committed.length
    ? `✓ *${committed.length} filed* · ⏸ ${failed.length} couldn't save`
    : `⏸ *Couldn't save ${failed.length === 1 ? 'that' : `those ${failed.length}`}*`
  const lines = p.entries.map((e) => (e.committed ? `✓ ${line(e)}` : `⏸ ${line(e)}`)).join('\n')
  const tail = committed.length
    ? `${money(savedSum)} in the Day Book. Nothing was recorded for the ⏸ lines — tap to try again.`
    : `Nothing was recorded — tap to try again.`
  const body = [head, lines, tail].join('\n\n')
  return {
    kind: 'buttons',
    body,
    buttons: [
      { id: p.retryButtonId ?? 'add_daybook', title: pick(lang, { en: 'Try again' }) },
      { id: 'add_daybook', title: trunc(pick(lang, { en: 'Add in Day Book' }), 20) },
    ],
  }
}

/** Follow-up after [Add in Day Book]: a CTA URL to the Day Book (real https). */
export function mDaybookLink(lang: Lang, url: string): OutMessage {
  return { kind: 'cta', body: pick(lang, { en: 'Open your Day Book to add it.' }), cta: { text: pick(lang, { en: 'Open Day Book' }), url } }
}

/** [Try again] on a replay row that expired / no longer exists. */
export function mReplayExpired(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: 'That entry expired — just send it again.' }) }
}

/**
 * Plain acknowledgment string for the consolidated-interrupt prefix. The draft was
 * committed flagged (never lost) — name the gap transparently so the owner knows
 * what to tidy in the Day Book.
 */
export function ackLine(lang: Lang, p: { payee: string | null; amount: number | null }): string {
  const saved = pick(lang, { en: 'Saved' })
  const line = entryLine(p.payee, p.amount, null)
  const gap = !p.payee ? pick(lang, { en: 'payee not set' })
    : p.amount == null ? pick(lang, { en: 'amount not set' })
    : ''
  if (gap) return `${saved}${line ? ' ' + line : ''} — ${gap}`.trim()
  return `${saved} ${line} ✓`.trim()
}

export function mUnsupported(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: 'I can read text, photos and voice notes — send me a payment like "Ramu 5000 cash" and I\'ll file it for you.' }) }
}

/** Voice IS supported now -- this is a transcription miss, not "coming soon". */
export function mVoiceUnclear(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: "I couldn't quite catch that voice note — please try again, or just type it out." }) }
}

/** Disambiguation: reply buttons (next turn resolves). */
export function mDisambiguate(lang: Lang, prefix?: string): OutMessage {
  const body = (prefix ? prefix + '\n\n' : '') + pick(lang, { en: "I didn't quite catch that — what would you like to do?" })
  return {
    kind: 'buttons', body,
    buttons: [
      { id: 'disamb_log', title: pick(lang, { en: 'Log a payment' }) },
      { id: 'disamb_ask', title: pick(lang, { en: 'Ask a question' }) },
    ],
  }
}

export function mNotRegistered(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: "You're not registered on Briklay. Contact your manager to get access." }) }
}

/** Registered number with no org. Two honest paths: join a team (ask the manager) OR
 *  run your own site (a tappable Set-up button → sign-up / create-org). */
export function mNoOrg(lang: Lang, signupUrl: string): OutMessage {
  return {
    kind: 'cta',
    body: pick(lang, {
      en: "You're almost set up — your number is recognised, but it isn't linked to a site yet.\n\nIf your team already uses Briklay, ask your site manager to add you — then just message me and you're in.\n\nWant to run your own site instead? Set it up yourself below.",
    }),
    cta: { text: 'Set up my site', url: signupUrl },
  }
}

/** Sender row exists but is switched off (and not an 'invited' self-activation row). */
export function mAccessPaused(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, {
    en: "Your access to Briklay is paused for now — no worries.\n\nAsk your site manager to switch it back on, and you'll be able to send straight away.",
    te: "మీ Briklay యాక్సెస్ ప్రస్తుతం నిలిపివేయబడింది — ఫర్వాలేదు.\n\nమీ సైట్ మేనేజర్‌ను దాన్ని మళ్లీ ఆన్ చేయమని అడగండి, వెంటనే మీరు పంపగలరు.",
    hi: "आपकी Briklay एक्सेस अभी रुकी हुई है — कोई बात नहीं।\n\nअपने साइट मैनेजर से इसे दोबारा चालू करने को कहें, और आप तुरंत भेज पाएँगे।",
  }) }
}

// ── First-contact prefixes (folded into a member's first-touch / dormant reply) ──
// Returned as plain strings (not OutMessage): the dispatcher passes them as the
// `prefix`/`welcomePrefix` an agent folds into its single reply, so a brand-new
// teammate who logs a payment on their first message gets ONE message — the
// confirmation, led by a welcome — never a separate greeting they must scroll past.

/** "Welcome aboard, Ramu! ✓" — prepended to a member's very first reply. */
export function welcomePrefix(lang: Lang, p: { name?: string | null }): string {
  const first = (p.name ?? '').trim().split(/\s+/)[0]
  const named = first ? `, ${first}` : ''
  return pick(lang, {
    en: `Welcome aboard${named}! 👋`,
    te: `స్వాగతం${named}! 👋`,
    hi: `स्वागत है${named}! 👋`,
  })
}

/** "Welcome back, Ramu 👋" — prepended when a dormant member returns. Personalised by
 *  first name when we have one, so the return feels recognised, not canned. */
export function welcomeBack(lang: Lang, p: { name?: string | null } = {}): string {
  const first = (p.name ?? '').trim().split(/\s+/)[0]
  const named = first ? `, ${first}` : ''
  return pick(lang, {
    en: `Welcome back${named} 👋`,
    te: `మళ్లీ స్వాగతం${named} 👋`,
    hi: `Welcome back${named} 👋`,
  })
}

// ── Procurement (purchase request) ───────────────────────────────────────────

/** Instant ack when a vendor is named & confident — proceed silently. */
export function mProcAck(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: 'Got it — raising the request 👍' }) }
}

/** One-PR guard: 2+ distinct vendors/sites in one message. Name what we saw, state
 *  the rule, redirect — NEVER silently merge. (The twin of the txn thin-guard.) */
export function mProcMultiGuard(lang: Lang, p: { requests: { label: string }[] }): OutMessage {
  const parts = p.requests.map((r) => r.label).filter(Boolean)
  const named = parts.length >= 2 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts.join(', ')
  return { kind: 'text', body: pick(lang, {
    en: `Looks like ${named} — those are separate orders. Send each on its own and I'll catch both.`,
  }) }
}

/** Sourcing prompt when no vendor is named. v1: reply buttons (Flow seam left).
 *  Takes a LIST of requests (v1 length 1) so multi-request later renders multi-screen
 *  with no caller change. Solo orgs (no approver) drop "Let ... decide". */
export function buildSourcingPrompt(
  lang: Lang,
  p: { requests: { label: string }[]; hasApprover: boolean; approverName?: string | null },
): OutMessage {
  const what = p.requests[0]?.label ? `${p.requests[0].label} — ` : ''
  const buttons = [
    { id: 'proc_src_direct', title: pick(lang, { en: 'Send to a vendor' }) },
    { id: 'proc_src_rfq', title: pick(lang, { en: 'Get quotes' }) },
  ]
  if (p.hasApprover) {
    const who = (p.approverName ?? '').trim().split(/\s+/)[0]
    buttons.push({ id: 'proc_src_defer', title: trunc(pick(lang, { en: who ? `Let ${who} decide` : 'Let manager decide' }), 20) })
  }
  return { kind: 'buttons', body: pick(lang, { en: `${what}how would you like to source it?` }), buttons: buttons.slice(0, 3) }
}

// ── Vendor Flows (WhatsApp interactive forms) ────────────────────────────────
// Two terminal flows replace the plain vendor list when a richer pick is wanted:
//   SELECT_VENDOR  — RadioButtonsGroup (single)   -> { mode:"single", vendor:<id> }
//   PICK_VENDORS   — CheckboxGroup (rfq, min 1)    -> { mode:"rfq", selected_vendors:[<id>…] }
// Both bind ${data.vendors} to an array of these four fields (all required by the
// flow's data schema, so every vendor must emit all four — see loadVendors).

/** One item in a vendor Flow's ${data.vendors}. */
export type FlowVendor = { id: string; title: string; description: string; metadata: string }

/** SELECT_VENDOR flow — single vendor (RadioButtonsGroup). flowToken carries the PR id
 *  (not echoed back; completion binds via the open conversation). */
export function buildSelectVendorFlow(
  lang: Lang,
  p: { flowId: string; flowToken: string; vendors: FlowVendor[]; draft?: boolean },
): OutMessage {
  return {
    kind: 'flow',
    body: pick(lang, { en: 'Choose the vendor to order from.' }),
    flowId: p.flowId,
    flowToken: p.flowToken,
    cta: pick(lang, { en: 'Choose vendor' }),
    screen: 'SELECT_VENDOR',
    data: { vendors: p.vendors },
    ...(p.draft ? { draft: true } : {}),
  }
}

/** PICK_VENDORS flow — RFQ multi-select (CheckboxGroup, min 1). */
export function buildPickVendorsFlow(
  lang: Lang,
  p: { flowId: string; flowToken: string; vendors: FlowVendor[]; draft?: boolean },
): OutMessage {
  return {
    kind: 'flow',
    body: pick(lang, { en: 'Select vendors to request quotes from.' }),
    flowId: p.flowId,
    flowToken: p.flowToken,
    cta: pick(lang, { en: 'Get quotes' }),
    screen: 'PICK_VENDORS',
    data: { vendors: p.vendors },
    ...(p.draft ? { draft: true } : {}),
  }
}

/** The vendor LIST (after "Send to a vendor" / "Get quotes"). */
export function buildVendorList(lang: Lang, vendors: { id: string; name: string }[]): OutMessage {
  return {
    kind: 'list',
    body: pick(lang, { en: 'Which vendor?' }),
    button: pick(lang, { en: 'Choose vendor' }),
    rows: vendors.slice(0, 10).map((v) => ({ id: `proc_vendor_${v.id}`, title: trunc(v.name, 24) })),
  }
}

/** Capture confirmation — the request is raised + a calm flag for any gap. */
export function mProcComplete(
  lang: Lang,
  p: { headline: string; site: string | null; vendor: string | null; vendorMatched: boolean; siteMissing: boolean },
): OutMessage {
  const ctx: string[] = [p.headline]
  if (p.site) ctx.push(p.site)
  if (p.vendor) ctx.push(`${pick(lang, { en: 'to' })} ${p.vendor}`)
  const head = '✓ ' + pick(lang, { en: 'Raised your request' }) + '\n' + ctx.filter(Boolean).join(' · ')
  const flags: string[] = []
  if (p.vendor && !p.vendorMatched) flags.push(pick(lang, { en: `${p.vendor} isn't in your vendors yet` }))
  if (p.siteMissing) flags.push(pick(lang, { en: 'Site not set — add it in the app' }))
  const body = [head, flags.join('\n')].filter(Boolean).join('\n\n')
  return { kind: 'text', body }
}

// ── Agent-agnostic pending-question credibility (2026-07-11) ──────────────────
// A question we asked can be interrupted by a new turn. The dispatcher STASHES it, handles the turn, then
// RE-SURFACES it (with a Dismiss button) or DROPS it with a notice. These are the strings for that lifecycle.
// They are AGENT-NEUTRAL on purpose — the same copy serves a SiteOps "which project?" and a Procurement
// "which vendor?" — so the machinery never has to know which agent asked.

/** Pre-promise folded into a NEW_INTENT reply: we'll handle this, then come back to the open question. */
export function pendingReturnAck(lang: Lang): string {
  return pick(lang, { en: "Got it — I'll take care of this, then come back to my earlier question." })
}

/** Soft preamble when a reply was too unclear to act on, before we re-show the open question. */
export function pendingUnclearLead(lang: Lang): string {
  return pick(lang, { en: "I didn't quite catch that." })
}

/** Lead-in above the re-surfaced question. */
export function pendingResurfaceLead(lang: Lang): string {
  return pick(lang, { en: 'Back to my earlier question:' })
}

/** Footer under the re-surfaced question — reply to answer, or tap the Dismiss button to let it go. */
export function pendingResurfaceFooter(lang: Lang): string {
  return pick(lang, { en: 'Reply to answer, or tap *Dismiss* to leave it.' })
}

/** The Dismiss reply-button title (WhatsApp caps titles at 20 chars). */
export function pendingDismissLabel(lang: Lang): string {
  return pick(lang, { en: 'Dismiss' })
}

/** Acknowledgement after the user TAPS Dismiss — set aside, not recorded, resend anytime (Q1: drop + tell). */
export function pendingDismissedAck(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: "No problem — I've set that aside. Send it again whenever you like. 👍" }) }
}

/** Nudge when a held question is DEFERRED behind the new turn's own question — held, NOT dropped. It rides
 *  along and re-surfaces once this is sorted. `subject` is a short echo of what the held question was about. */
export function pendingDeferredNudge(lang: Lang, subject: string | null): OutMessage {
  const about = subject ? ` about "${subject}"` : ''
  return { kind: 'text', body: pick(lang, { en: `(Still holding my earlier question${about} — I'll come back to it once this is sorted. 👍)` }) }
}

/**
 * RETIRED, NOT DROPPED (the 30-minute rule, 2026-07-11). A question that has gone unanswered for half an
 * hour, while the sender kept messaging about other things, is a question he has decided not to answer. We
 * stop asking. What he told us is NOT lost — it is parked, in full, in the review list — and saying that is
 * the difference between letting go and eating it.
 */
export function pendingRetiredNotice(lang: Lang, subject: string | null): OutMessage {
  const about = subject ? ` about "${subject}"` : ''
  return {
    kind: 'text',
    body: pick(lang, {
      en: `My earlier question${about} has been open a while, so I've set it aside — nothing was changed for it. ` +
        `It's saved in your review list, and you can tell me about it again any time. 👍`,
    }),
  }
}
