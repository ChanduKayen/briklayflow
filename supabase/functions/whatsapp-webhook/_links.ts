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
// and a good one: bundles link one level UP, to the day, where everything the message listed is visible
// together. Records get record links; bundles get the day.

const BASE = (() => {
  const b = Deno.env.get('WA_APP_LINK') ?? 'https://briklayflow.vercel.app'
  try { return new URL('/', b).origin } catch { return 'https://briklayflow.vercel.app' }
})()

const url = (path: string) => `${BASE}${path}`

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

/**
 * The day — where a DIGEST points. One button, one level up: everything the message just listed is
 * visible together on the desk's plan for that site (or across all of them).
 */
export const todayLink = (siteCode?: string | null): Link => ({
  text: 'Open today',
  url: url(`/desk/${encodeURIComponent((siteCode || 'all').toLowerCase())}/plan`),
})
