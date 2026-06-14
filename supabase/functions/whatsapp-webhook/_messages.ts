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

/** Complete confirmation: text + Edit CTA. */
export function mComplete(lang: Lang, p: { payee: string | null; amount: number; project: string | null }): OutMessage {
  const saved = pick(lang, { en: 'Saved ✓' })
  return { kind: 'cta', body: `${saved}\n${entryLine(p.payee, p.amount, p.project)}`,
           cta: { text: pick(lang, { en: '✏️ Edit' }), url: EDIT_LINK } }
}

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

/** Amount missing: plain text, acknowledge-before-ask. */
export function mAmountMissing(lang: Lang, p: { payee: string | null }): OutMessage {
  return { kind: 'text', body: p.payee
    ? pick(lang, { en: `How much did you pay ${p.payee}?` })
    : pick(lang, { en: 'How much did you pay?' }) }
}

/** Ask for the payee name (after "No, someone else"). */
export function mAskPayee(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: 'Who did you pay?' }) }
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

/** Plain acknowledgment string (for consolidated interrupt prefixes). */
export function ackLine(lang: Lang, p: { payee: string | null; amount: number | null }): string {
  return `${pick(lang, { en: 'Saved' })} ${entryLine(p.payee, p.amount, null)} ${pick(lang, { en: '(draft)' })}`.trim()
}

export function mUnsupported(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: 'I can handle text, photos, and (soon) voice notes — send me a payment like "Ramu 5000 cash".' }) }
}

export function mVoiceComingSoon(lang: Lang): OutMessage {
  return { kind: 'text', body: pick(lang, { en: 'Voice notes are coming soon — for now, please type your message.' }) }
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
