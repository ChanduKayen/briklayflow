// THE LINK LAYER — code-owned, always. The model classifies; CODE emits the URL.
//
// A hallucinated link is a broken promise with a button on it. It is worse than no button at all,
// because a button is a claim: "the thing I just told you about is one tap away, and it is HERE". Tap
// it and land on a 404, or a list you now have to hunt through, and the message that carried it becomes
// a thing you no longer believe. So no model ever writes a URL in this system, and no URL is ever built
// from a string the model produced — only from ids code already holds.
//
// ══ THE FOUR HOMES, AND WHERE THEY ACTUALLY ARE ═══════════════════════════════════════════════════
//
//   money in/out            → Day Book    /logbook?entry={id}
//   work / status update    → Tasks       /projects/{project}/desk/plan?task={ref}
//   issue, blocker          → Problems    /desk/{code}/problems/{ref}
//   unplaced or failed      → Review      /desk/{code}/problems?seg=pending
//
// "View …" lands on THE RECORD. "Open …" lands on a PLACE. That distinction is the whole contract: a
// message about one payment gives you that payment, not the Day Book to go looking in.
//
// A digest touches several homes at once and WhatsApp allows exactly one button, which is a constraint
// and a good one: bundles link one level UP. A bundle of ONLY task updates goes to the Tasks section
// (the plan); a bundle that spans homes goes to Problems — the half of the desk that needs a human.
// Records get record links; bundles get the section, or the day.

const BASE = (() => {
  const b = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app'
  try { return new URL('/', b).origin } catch { return 'https://briklayflow.vercel.app' }
})()

const url = (path: string) => `${BASE}${path}`

/** The app's own origin — for the rare message that points at the APP rather than at a record inside it.
 *  Exported so the base stays in exactly one place; a second `WA_APP_LINK` reader is a second thing to get
 *  wrong (and this file already owns the scheme-less-env and bad-URL fallbacks). */
export const APP_ORIGIN = BASE

export type Link = { text: string; url: string }

/** A filed transaction — the entry itself, with the POSTED stamp still fresh. */
export const entryLink = (entryId: string): Link => ({
  text: 'View entry',
  url: url(`/logbook?entry=${encodeURIComponent(entryId)}`),
})

/** A task that moved. Lands on the plan with that task open — not a list to hunt through. */
export const taskLink = (projectId: string, ref: string): Link => ({
  text: 'View task',
  url: url(`/projects/${encodeURIComponent(projectId)}/desk/plan?task=${encodeURIComponent(ref)}`),
})

/** A raised issue or snag. The desk addresses these by ref, so the link is the ref. */
export const problemLink = (siteCode: string, ref: string): Link => ({
  text: 'View problem',
  url: url(`/desk/${encodeURIComponent(siteCode.toLowerCase())}/problems/${encodeURIComponent(ref)}`),
})

/** ⏸ Review — the named home for everything parked, failed or unplaced. A PLACE, so "Open". */
export const reviewLink = (siteCode?: string | null): Link => ({
  text: 'Open Review',
  url: url(`/desk/${encodeURIComponent((siteCode || 'all').toLowerCase())}/problems?seg=pending`),
})

/** The Day Book itself — a place, for when we wrote money but hold no entry id. */
export const dayBookLink = (): Link => ({ text: 'Open Day Book', url: url('/logbook') })

/** ONE PARTY'S LEDGER — every payment to them, opened on the stakeholder drawer. The answer on WhatsApp is
 *  a number; this is the working behind it, which is what he reaches for the moment the number surprises
 *  him. `?stakeholder=` is read by Ledger.tsx and opens StakeholderLedgerDrawer directly. */
export const partyLedgerLink = (stakeholderId: string): Link => ({
  text: 'View ledger',
  url: url(`/ledger?stakeholder=${encodeURIComponent(stakeholderId)}`),
})

/**
 * The day — where a MIXED digest points. One button can't point at every home a bundle touched, so it
 * lands on Problems: the desk's landing tab and "the half of the desk that needs a human" (SiteDeskV2).
 * A digest of only task updates has a real section to go to instead — see tasksLink.
 */
export const todayLink = (siteCode?: string | null): Link => ({
  text: 'Open today',
  url: url(`/desk/${encodeURIComponent((siteCode || 'all').toLowerCase())}/problems`),
})

/**
 * The Tasks section — where a digest of ONLY task updates points when it touched several at once. One
 * task update gets its own record link (taskLink); a bundle of them has no single record to open, so it
 * lands on the plan, the section they all live in.
 */
export const tasksLink = (siteCode?: string | null): Link => ({
  text: 'Open Tasks',
  url: url(`/desk/${encodeURIComponent((siteCode || 'all').toLowerCase())}/plan`),
})
