// WhatsApp Sprint 5 -- message catalog. Every outbound transaction string is built
// here, keyed by language (router's reply_language). EN is filled; TE/HI are STUBS
// that fall back to EN -- a foreman writes Tenglish, not formal Telugu, so Chandu
// fills te/hi by hand (do not auto-generate). Returns Sprint-2 OutMessage objects
// so the formatter renders the right interactive type.

import type { OutMessage } from './_format.ts'

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
 * Capture-first confirmation (presentation redesign). Same states, gating and CTA
 * target as before -- only the WORDING and LAYOUT changed:
 *   ✓ outcome / amount-first *bold* hero ("*₹3,500* to ramu") / unlabeled
 *   "project · mode" context / RAW note shown italic + unlabeled / a calm flag line
 *   that explains the CTA. Blank lines group the parts; absent parts drop out.
 *     payee matched     -> clean;  CTA "Review in Day Book"
 *     payee unmatched   -> flag "<payee> isn't in your contacts yet"; CTA "Review & add contact"
 *     project unmatched -> flag 'I noted the site as "<raw>" ...';     CTA "Review & set site"
 * Italic is the only de-emphasis WhatsApp offers (no secondary-text colour). mode and
 * direction render only when supplied -- not plumbed today, so mode is omitted and the
 * preposition defaults to "to".
 */
export function mComplete(
  lang: Lang,
  p: {
    payee: string | null; payeeMatched: boolean;
    amount: number | null;
    projectName: string | null; projectRaw: string | null;
    note: string | null;
    mode?: string | null;              // appended to the context line ONLY when present
    direction?: 'out' | 'in' | null;   // 'in' -> "from", otherwise "to" (default)
  },
): OutMessage {
  // 1. Outcome -- existing copy, now check-marked.
  const outcome = '✓ ' + pick(lang, { en: 'Added to your Day Book' })

  // 2. Hero -- amount FIRST and bold (WhatsApp *...*), then to/from payee. Indian
  //    grouping unchanged; only bolded and moved ahead of the payee.
  const amt = p.amount != null ? '*₹' + p.amount.toLocaleString('en-IN') + '*' : ''
  const prep = p.direction === 'in' ? pick(lang, { en: 'from' }) : pick(lang, { en: 'to' })
  const who = p.payee ?? pick(lang, { en: 'payee not set' })
  const hero = [amt, `${prep} ${who}`].filter(Boolean).join(' ')

  // 3. Context -- matched project, NO "Project:" label; append " · mode" only if a mode
  //    is present. No project -> omit the whole line (never an empty one).
  const modeBit = p.mode?.trim() ? ' · ' + p.mode.trim() : ''
  const contextLine = p.projectName ? p.projectName + modeBit : ''
  const heroBlock = contextLine ? `${hero}\n${contextLine}` : hero

  // 4. Note -- shown RAW (never summarized), italic (_..._), unlabeled, only if present.
  const noteBlock = p.note?.trim() ? `_${p.note.trim()}_` : ''

  // 5. Flags -- calm, off the hero line, one per condition that fires (logic unchanged).
  const flags: string[] = []
  if (p.payee && !p.payeeMatched) flags.push(pick(lang, { en: `${p.payee} isn't in your contacts yet` }))
  if (p.projectRaw) flags.push(pick(lang, { en: `I noted the site as "${p.projectRaw}" — not one of your projects yet` }))
  const flagBlock = flags.join('\n')

  // 7. CTA -- target unchanged (EDIT_LINK); label per state. The payee flag keeps the
  //    existing priority, then unknown-site, else clean.
  const ctaText =
    (p.payee && !p.payeeMatched) ? pick(lang, { en: 'Review & add contact' })
    : p.projectRaw ? pick(lang, { en: 'Review & set site' })
    : pick(lang, { en: 'Review in Day Book' })

  // 6. Blank-line grouping: outcome / hero+context / note / flag.
  const body = [outcome, heroBlock, noteBlock, flagBlock].filter(Boolean).join('\n\n')

  return { kind: 'cta', body, cta: { text: ctaText, url: EDIT_LINK } }
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

/** Abandoned: text + Edit CTA (this is the A1 fix path; also enqueued by the SQL sweep). */
export function mAbandoned(lang: Lang, p: { payee: string | null; amount: number; missing: string }): OutMessage {
  return {
    kind: 'cta',
    body: `${pick(lang, { en: 'Saved' })} ${entryLine(p.payee, p.amount, null)} — ${p.missing} ${pick(lang, { en: 'not set. Add anytime.' })}`,
    cta: { text: pick(lang, { en: '✏️ Add details' }), url: EDIT_LINK },
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

/** "⚠️ I couldn't save this — Kumar · ₹12,000 · ASM Elite / Nothing was recorded…". */
export function mWriteFailed(
  lang: Lang,
  p: { payee: string | null; amount: number | null; project: string | null; replayId: string },
): OutMessage {
  const line = entryLine(p.payee, p.amount, p.project)
  const head = pick(lang, { en: "⚠️ I couldn't save this" })
  const body = `${head}${line ? ' — ' + line : ''}\n${pick(lang, { en: 'Nothing was recorded. Try again, or add it in the app.' })}`
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
 * nothing failed. appLink is a REAL https Day Book url (this card is sent OUTSIDE the
 * staging RPC, so the __ENTRY_LINK__ placeholder wouldn't be substituted).
 */
type BatchEntry = { payee: string | null; amount: number | null; project: string | null; committed: boolean }

export function mBatch(
  lang: Lang,
  p: { entries: BatchEntry[]; appLink: string; retryButtonId: string | null },
): OutMessage {
  // "Rajeev Sharma → ₹3,25,000 · The Pride" — payee · amount · project (project omitted when absent).
  const line = (e: BatchEntry) => {
    const amt = e.amount != null ? '₹' + e.amount.toLocaleString('en-IN') : pick(lang, { en: 'amount not set' })
    const who = e.payee ?? pick(lang, { en: 'payee not set' })
    const proj = e.project ? ` · ${e.project}` : ''
    return `${who} → ${amt}${proj}`
  }
  const committed = p.entries.filter((e) => e.committed).length
  const failed = p.entries.length - committed
  // Sum of what actually saved (free — already in memory; NOT a day-total query).
  const savedSum = p.entries.filter((e) => e.committed).reduce((s, e) => s + (e.amount ?? 0), 0)
  const sumStr = '₹' + savedSum.toLocaleString('en-IN')

  if (failed === 0) {
    const head = '✓ ' + pick(lang, { en: `Added ${committed} to your Day Book` })
    const lines = p.entries.map((e) => line(e)).join('\n')
    const total = pick(lang, { en: `That's ${sumStr} across these ${committed}.` })
    const body = [head, lines, total].join('\n\n')
    return { kind: 'cta', body, cta: { text: pick(lang, { en: 'Review in Day Book' }), url: p.appLink } }
  }

  const head = pick(lang, { en: `Added ${committed} · couldn't save ${failed}` })
  const lines = p.entries.map((e) =>
    e.committed
      ? `${line(e)}  (${pick(lang, { en: 'saved' })})`
      : `${line(e)} — ${pick(lang, { en: 'not saved, nothing recorded' })}`,
  ).join('\n')
  const total = pick(lang, { en: `${sumStr} saved in all — the rest above wasn't recorded.` })
  const body = [head, lines, total].join('\n\n')
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
  return { kind: 'text', body: pick(lang, { en: 'I can handle text, photos, and voice notes — send me a payment like "Ramu 5000 cash".' }) }
}

/** Voice IS supported now -- this is a transcription miss, not "coming soon". */
export function mVoiceUnclear(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: "I couldn't quite catch that voice note — please try again, or type it." }) }
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

export function mNoOrg(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: "Your account isn't fully set up yet. Please contact your manager." }) }
}
