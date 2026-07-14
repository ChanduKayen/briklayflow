// SITE DESK — DB rows → the UI model. PURE. No network, no clock it wasn't given, no model.
//
// This is where the mock's hand-written fields stop being given to us and start being DERIVED:
//   · `state` (you | chasing | moving | resolved) — the mock just declared it. Here it is computed
//     from status + the chase trail, and it is THE thing the whole Problems tab sorts and colours by.
//   · `status`  — the one-line plain-language sentence. Composed from facts, in code. The read-model
//     (map §X4) may one day write prettier sentences, but it may NEVER invent the state underneath.
//
// Everything here is a total function of its inputs, so `now` is passed in rather than read: the
// tests pin exact sentences against a fixed clock, and a status line can never drift under us.

import type {
  Chase, ChaseHop, DeskProblem, DeskTask, Outcome, Photo, ProblemKind, ProblemState, QcCheck, QcStatus, StoryStep, TaskState,
} from './types'
import { gatesFromBinding, type GateRow, type Gates } from './gates'

/* ── the row shapes we actually select (names verified against supabase/migrations) ── */

export interface ProblemRow {
  id: string
  ref: string | null
  kind: ProblemKind
  title: string
  status: string                    // OPEN | ADDRESSING | RESOLVED | DISMISSED
  cause: string | null
  confidence: string
  project_id: string | null
  task_id: string | null
  owner_id: string | null
  floor_label: string | null
  unit_label: string | null
  area_label: string | null
  next_followup_at: string | null
  deadline: string | null
  created_at: string
  updated_at: string
}

export interface EventRow {
  id: string
  problem_id: string | null
  type: string
  body: string | null
  actor_kind: string
  /** WHO did it. The webhook has always written this; the desk never read it — so the one thing the
   *  escalation path needs (who reported this from site) reached the database and no screen. */
  actor_id: string | null
  created_at: string
}

export interface AttachmentRow {
  parent_id: string
  role: string                      // creation | answer
  caption: string | null
  created_at?: string               // needed to interleave a photo into a task's story
  url?: string | null               // signed at read time — never stored
}

/** A raw inbound WhatsApp message. The status_history entry a resolver writes carries only its ID —
 *  the WORDS live here, and until now nothing on the desk went and fetched them. */
export interface NarrationRow {
  id: string
  raw_text: string | null
  created_at: string
  sender_name?: string | null
}

export interface ResolutionRow {
  problem_id: string
  outcome: string                   // fixed | client_ok | not_a_problem | duplicate
  note: string | null
  duplicate_of: string | null
  closed_by: string | null
  auto_closed: boolean
  closed_at: string
  reopened_at: string | null
}

export interface TaskRow {
  task_id: string
  ref: string | null
  name: string
  phase: string
  trade: string
  status: 'not_started' | 'active' | 'done'
  floor_label: string | null
  unit_label: string | null
  seq_no: number
  duration_days: number | null
  started_at: string | null
  owner_id: string | null
  node_key: string | null
  task_type_id: string | null
  binding: unknown
  status_history: unknown
  updated_at: string
  /** 'generated' (the engine authored it) | 'manual' (a human typed it in). Decides what the edit
   *  sheet is allowed to offer — see DeskTask.manual. */
  source?: 'generated' | 'manual'
  /** The site's own note on what this task covers. */
  description?: string | null
}

export interface QcRow {
  id: string
  task_id: string
  question: string
  is_critical: boolean
  seq: number
  answer: string | null
  qc_status: string             // pending | confirmed | failed
}

export interface TaskCommentRow {
  id: string
  task_id: string
  author_name: string | null
  body: string
  created_at: string
}

export type NameOf = (userId: string | null) => string
export type PhoneOf = (userId: string | null) => string

/**
 * THE TASK'S OWN STORY — item 2 of the live-probe list, and the one that mattered.
 *
 * A WhatsApp update ("slab poured, curing started") is resolved onto a task and written to
 * `status_history` — with the sender, the new status, and a `narration_id`. The WORDS THEMSELVES are
 * NOT in that row: they live in `site_narrations`, and the id is the only way back to them.
 *
 * THE FIRST FIX (comments) WAS INCOMPLETE, and the comment that used to sit here said so wrongly: it
 * claimed the resolver writes a `site_task_comments` row "plus" a status_history entry. It does not.
 * `site_task_comments` is written on ONE path (the blocked-task note); every ordinary progress update
 * writes status_history alone. So the sheet rendered "Marked in progress by +9183…" — an event with
 * the words stripped out of it — and the supervisor's actual message still never reached the screen.
 * Same for photos: the webhook attaches them to the task (attachments.parent_type='site_task') and
 * the desk fetched attachments for problems only.
 *
 * So four producers land here, and each keeps its own voice:
 *   · status_history  → an EVENT ("Marked in progress by …")
 *   · site_narrations → a BUBBLE — his actual words, resolved via status_history[].narration_id
 *   · site_task_comments → a BUBBLE (somebody typed it here)
 *   · attachments     → a PHOTO
 *
 * A narration that moved the status produces BOTH an event and a bubble. That is deliberate: "the
 * status moved" and "here is what he said" are two different facts, and folding them into one line
 * loses whichever the reader needed.
 */

/**
 * THE NARRATION IDS A TASK'S HISTORY POINTS AT.
 *
 * `status_history[].narration_id` is the ONLY link from a task back to the words that moved it. It is
 * jsonb written by several producers over two years, so this reads defensively: anything that isn't a
 * string id is skipped, never thrown on.
 */
export function narrationIdsOf(statusHistory: unknown): string[] {
  const hist = Array.isArray(statusHistory) ? statusHistory as Array<Record<string, unknown>> : []
  const ids: string[] = []
  for (const h of hist) {
    if (!h || typeof h !== 'object') continue
    const id = h.narration_id
    if (typeof id === 'string' && id) ids.push(id)
  }
  return [...new Set(ids)]
}

/** The loaded narrations a task's history points at, in the order they arrived. */
function narrationsOf(statusHistory: unknown, byId?: Map<string, NarrationRow>): NarrationRow[] {
  if (!byId?.size) return []
  return narrationIdsOf(statusHistory)
    .map((id) => byId.get(id))
    .filter((n): n is NarrationRow => !!n)
}

export function buildTaskStory(
  statusHistory: unknown,
  comments: TaskCommentRow[],
  narrations: NarrationRow[],
  photos: AttachmentRow[],
  now: number,
): StoryStep[] {
  const hist = Array.isArray(statusHistory) ? statusHistory as Array<Record<string, unknown>> : []

  const events: Array<{ at: string; step: StoryStep }> = []

  for (const h of hist) {
    // status_history is jsonb written by several producers over two years. A null or a bare string
    // in there must skip, not crash the whole task sheet.
    if (!h || typeof h !== 'object') continue
    const at = typeof h.at === 'string' ? h.at : null
    if (!at) continue
    const by = typeof h.by === 'string' ? h.by : null
    const status = typeof h.status === 'string' ? h.status : null
    // A narration that moved nothing still TOUCHED the task — it is a real event, and hiding it
    // is how "I told Babai and nothing happened" starts.
    const label = status
      ? `Marked ${status === 'not_started' ? 'not started' : status === 'active' ? 'in progress' : 'done'}${by ? ` by ${by}` : ''}`
      : `Update from ${by ?? 'the site'}`
    events.push({ at, step: { t: 'event', l: label, w: ago(at, now) } })
  }

  /**
   * HIS WORDS — AND ONLY HIS.
   *
   * A photo message is stored as ONE composite string, and it holds two voices:
   *
   *     <caption>Ceiling work in pride site 4th floor</caption>
   *     <photo>Ceiling installation framework visible at the construction site on the 4th floor</photo>
   *
   * The first is what the supervisor typed. The second is OUR read of the pixels. The desk printed the
   * whole thing, markers and all, in a speech bubble with his name on it — so a description a machine
   * wrote was shown to his boss as a sentence HE had said. The webhook had already been bitten by this
   * and fixed it (humanizeInbound); the desk was never told.
   *
   * So it is split at the source. The bubble carries the caption ONLY. Our read of the photo goes on
   * the PHOTO, where it is ours, and is labelled as ours.
   *
   * Deduped by narration id — one message can touch a task more than once (it moved the status AND
   * answered a QC check) and must still be said once.
   */
  const seenIds = new Set<string>()
  const ourRead = new Map<string, string>()      // narration id → what we saw in its photo
  for (const n of narrations) {
    if (seenIds.has(n.id)) continue
    seenIds.add(n.id)
    const { said, seen } = splitComposite((n.raw_text ?? '').trim())
    if (seen) ourRead.set(n.id, seen)
    if (!said) continue                       // a bare photo has no words of his — the photo carries it
    events.push({
      at: n.created_at,
      step: { t: 'msg', from: n.sender_name?.trim() || 'Site', text: said, w: ago(n.created_at, now) },
    })
  }
  // one photo, one read — if the narration that carried it described anything, that is what we saw
  const theRead = [...ourRead.values()][0] ?? null

  for (const c of comments) {
    events.push({
      at: c.created_at,
      step: { t: 'msg', from: c.author_name ?? 'Site', text: c.body, w: ago(c.created_at, now) },
    })
  }

  for (const a of photos) {
    const at = a.created_at
    if (!at) continue
    events.push({ at, step: { t: 'photo', url: a.url ?? null, caption: a.caption, seen: theRead, w: ago(at, now) } })
  }

  return events.sort((a, b) => a.at.localeCompare(b.at)).map((e) => e.step)
}

/** Checks in their authored order; the critical one leads, because it is the one that costs money. */
export function toQcChecks(rows: QcRow[]): QcCheck[] {
  return [...rows]
    .sort((a, b) => (Number(b.is_critical) - Number(a.is_critical)) || a.seq - b.seq)
    .map((r) => ({
      id: r.id,
      question: r.question,
      critical: !!r.is_critical,
      status: (['pending', 'confirmed', 'failed'].includes(r.qc_status) ? r.qc_status : 'pending') as QcStatus,
      answer: r.answer,
    }))
}

export type QcAlarm = 'failed' | 'last_chance' | 'unverified' | null

/**
 * WHAT THE CHECKS ARE SAYING — and how loudly.
 *
 *   failed      the work is WRONG and will be redone. The loudest thing on the screen.
 *   last_chance a critical check is open on work happening RIGHT NOW. Look before it is buried:
 *               cover blocks before the pour, conduit before the plaster.
 *   unverified  a critical check was never answered on work already finished. The moment has
 *               passed — this is a hole in the record, not an emergency, and it must not be
 *               dressed as one.
 *
 * THE FIRST VERSION CALLED BOTH OF THE LAST TWO "last chance", AND SHOUTED THEM IN RED ON EVERY
 * ROW. On a real site where nobody has ever answered a check, that lit up every finished task at
 * once. An alarm that fires on everything is not an alarm — it is wallpaper, and the one genuinely
 * failed check drowns in it. `unverified` is therefore quiet, and lives in the task sheet only.
 */
export function qcAlarm(t: { state: TaskState; qc?: QcCheck[] }): QcAlarm {
  const qc = t.qc ?? []
  if (qc.some((c) => c.status === 'failed')) return 'failed'
  if (!qc.some((c) => c.critical && c.status === 'pending')) return null
  if (t.state === 'active') return 'last_chance'
  if (t.state === 'done') return 'unverified'
  return null                                  // not started: nothing to look at yet
}

/** Only these two earn a place on the ROW. `unverified` does not — see above. */
export const qcAlarmIsLoud = (a: QcAlarm): a is 'failed' | 'last_chance' =>
  a === 'failed' || a === 'last_chance'

/* ── time, said the way a person says it ── */

const DAY = 86_400_000
export const daysBetween = (a: string, now: number): number =>
  Math.max(0, Math.floor((now - Date.parse(a)) / DAY))
export const hoursBetween = (a: string, now: number): number =>
  Math.max(0, Math.floor((now - Date.parse(a)) / 3_600_000))

/** The chase cron is DAILY at 09:00 IST. So a next-chase is only ever "today" or "tomorrow
 *  morning" or a date — never "at 6 pm", which the backend cannot do and must not claim. */
export function chaseWhen(next: string | null, now: number): string | null {
  if (!next) return null
  const d = Math.floor((Date.parse(next) - now) / DAY)
  if (d <= 0) return 'today'
  if (d === 1) return 'tomorrow morning'
  return `on ${new Date(next).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}`
}

/* ── THE STATE. The single most consequential derivation in the product. ── */

export interface TrailFacts {
  chases: number
  lastChaseAt: string | null
  lastReplyAt: string | null
  escalated: boolean
}

export function trailFacts(events: EventRow[]): TrailFacts {
  let chases = 0, lastChaseAt: string | null = null, lastReplyAt: string | null = null, escalated = false
  for (const e of events) {
    if (e.type === 'chase_sent') { chases++; if (!lastChaseAt || e.created_at > lastChaseAt) lastChaseAt = e.created_at }
    if (e.type === 'reply_received' && (!lastReplyAt || e.created_at > lastReplyAt)) lastReplyAt = e.created_at
    if (e.type === 'escalated') escalated = true
  }
  return { chases, lastChaseAt, lastReplyAt, escalated }
}

/**
 * WHO HAS THE BALL.
 *
 *   resolved — it is closed (or was retracted).
 *   you      — it has run out of people to chase (escalated), or nobody is chasing it at all.
 *              This is the ONLY red state, and it is the point of the whole product: the founder
 *              should see exactly the things that will not move without him.
 *   moving   — someone accepted it and is acting (ADDRESSING).
 *   chasing  — Babai has it, and has a clock set.
 *
 * The default is `you`, deliberately. An OPEN item with no chase clock and no owner is not
 * "fine" — it is a thing nobody is doing anything about, and hiding it in grey would be a lie.
 */
export function deriveState(p: ProblemRow, t: TrailFacts): ProblemState {
  if (p.status === 'RESOLVED' || p.status === 'DISMISSED') return 'resolved'
  if (t.escalated) return 'you'
  if (p.status === 'ADDRESSING') return 'moving'
  if (p.next_followup_at) return 'chasing'
  return 'you'
}

const OUTCOME_WORD: Record<string, Outcome> = {
  fixed: 'Fixed',
  client_ok: 'Client said ok',
  not_a_problem: 'Not a problem',
  duplicate: 'Same as another',
}
export const outcomeWord = (key: string): Outcome => OUTCOME_WORD[key] ?? 'Fixed'
export const outcomeKey = (word: Outcome): string =>
  (Object.entries(OUTCOME_WORD).find(([, w]) => w === word)?.[0]) ?? 'fixed'

/**
 * THE STATUS SENTENCE — one line, plain language, and TRUE.
 * Composed from facts only. If we cannot say something truthfully we say less, never more.
 */
export function statusLine(
  p: ProblemRow, state: ProblemState, t: TrailFacts, res: ResolutionRow | null,
  owner: string, hasAnswerPhoto: boolean, now: number,
): string {
  if (state === 'resolved') {
    if (p.status === 'DISMISSED') return 'Not a problem · dismissed'
    if (!res) return 'Closed'
    const by = res.auto_closed ? 'Briklay' : 'you'
    return `${outcomeWord(res.outcome)} · closed by ${by}`
  }

  if (state === 'you') {
    if (t.escalated) return 'Waiting on you — escalated, no one above to chase'
    if (!p.owner_id) return 'Waiting on you — nobody assigned yet'
    if (t.lastChaseAt && !t.lastReplyAt) {
      const silent = daysBetween(t.lastChaseAt, now)
      const chased = t.chases === 1 ? 'one chase' : `${t.chases} chases`
      return `Waiting on you — ${owner} silent ${silent} ${silent === 1 ? 'day' : 'days'}, ${chased} done`
    }
    return `Waiting on you — ${daysBetween(p.created_at, now)} days open, not being chased`
  }

  if (state === 'moving') {
    if (hasAnswerPhoto) return 'Fixed · photo received — confirm to close'
    return `${owner} is on it`
  }

  // chasing
  const when = chaseWhen(p.next_followup_at, now)
  return when ? `Briklay chases again ${when}` : `Briklay is following up with ${owner}`
}

/**
 * ══ THE CHASE BLOCK ═══════════════════════════════════════════════════════════════════════════════
 *
 * Composed from facts, in code, exactly like statusLine — so it can be pinned by tests against a fixed
 * clock and can never drift under us.
 *
 * THE PATH IS DRAWN FROM WHAT WE KNOW AND NOTHING ELSE. The reporter comes from the FIRST event's
 * actor_id — a real person who really did raise it. When that is a system actor (a WhatsApp narration
 * Briklay filed on its own) there is no name, so the hop is simply not drawn. It is never "Unknown", and
 * it is never guessed: a fabricated name on an escalation path is worse than a missing one, because the
 * whole point of the line is that you can trust who has been asked.
 */
export function buildChase(
  p: ProblemRow, state: ProblemState, t: TrailFacts, owner: string,
  events: EventRow[], nameOf: NameOf, hasAnswerPhoto: boolean, now: number,
): Chase | null {
  // A CLOSED ITEM HAS NO CHASE. The resolution block below already says who closed it and why; a second
  // closing statement above it would just be the card telling you the same thing twice.
  if (state === 'resolved') return null

  const sorted = [...events].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const reporter = sorted.length ? nameOf(sorted[0].actor_id) : ''
  const escalatedAt = sorted.find((e) => e.type === 'escalated')?.created_at ?? null

  // THE OVERDUE CLAUSE — the committed date, if there was one and it has passed. It is the single most
  // damning fact on the card, so it rides the reason line rather than hiding in the timeline.
  const late = p.deadline ? daysBetween(p.deadline, now) : 0
  const overdue = p.deadline && late > 0
    ? ` The committed date is ${late} ${late === 1 ? 'day' : 'days'} past.`
    : ''

  const path: ChaseHop[] = []
  if (reporter && reporter !== owner) path.push({ name: reporter })

  if (state === 'you') {
    // The owner is a spent hop — he was asked, and he is not the one holding it any more. You are.
    if (p.owner_id && owner) {
      path.push({
        name: owner,
        note: t.chases ? `notified ${t.chases} ${t.chases === 1 ? 'time' : 'times'}` : 'not reachable',
      })
    }
    path.push({ name: 'You', live: true })

    const silent = t.lastChaseAt ? daysBetween(t.lastChaseAt, now) : 0
    const since = escalatedAt ? `With you since ${ago(escalatedAt, now)}` : 'With you'

    const why =
      !p.owner_id
        ? `Nobody is assigned to this, so nobody is being chased.${overdue}`
        : t.chases && !t.lastReplyAt
          ? `${owner} didn't reply to ${numWord(t.chases)} ${t.chases === 1 ? 'nudge' : 'nudges'}.${overdue}`
          : t.escalated
            ? `There is no one above ${owner} left to chase.${overdue}`
            : `Nobody has chased this in ${silent || daysBetween(p.created_at, now)} days.${overdue}`

    return { tone: 'you', since, why, path }
  }

  if (state === 'moving') {
    if (p.owner_id && owner) path.push({ name: owner, live: true })
    return {
      tone: 'moving',
      since: `${owner} is on it`,
      why: hasAnswerPhoto
        ? `The fix photo is in — confirm it and this closes.${overdue}`
        : `Accepted and being worked on. Briklay is not chasing while it moves.${overdue}`,
      path,
    }
  }

  // chasing — Briklay has it, and has a clock set.
  if (p.owner_id && owner) {
    path.push({
      name: owner,
      note: t.chases ? `notified ${t.chases} ${t.chases === 1 ? 'time' : 'times'}` : null,
      live: true,
    })
  }
  const when = chaseWhen(p.next_followup_at, now)
  return {
    tone: 'chasing',
    since: `Briklay is chasing ${owner}`,
    why: when
      ? `No reply yet. Next nudge ${when}.${overdue}`
      : `Waiting on a reply.${overdue}`,
    path,
  }
}

/** Two nudges reads better than 2 nudges — small counts are words, past that they are numerals. */
function numWord(n: number): string {
  return ['no', 'one', 'two', 'three', 'four', 'five', 'six'][n] ?? String(n)
}

/**
 * THE ROW'S STATUS — the same sentence, with the part the MEDALLION already says taken out.
 *
 * The detail panel says "Waiting on you — Jaggu silent 4 days, two chases done", and it should:
 * there is room, and the whole sentence is worth reading. But in a ROW, a terracotta medallion has
 * already said "waiting on you" — so repeating it spends half the column restating a dot, and the
 * part you actually need ("Jaggu silent 4 days") gets truncated to make room for it.
 *
 * The row keeps only what the dot cannot tell you.
 */
export function statusShort(full: string, state: ProblemState): string {
  const cap = (s: string) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

  if (state === 'you') {
    const cut = full.replace(/^waiting on you\s*[—–-]?\s*/i, '').trim()
    return cut ? cap(cut) : full
  }
  if (state === 'chasing') {
    // "Briklay chases again tomorrow morning" → "Chases again tomorrow morning" — the breathing medallion
    // already SAYS it is with Briklay, and a row that repeats the medallion beside it wastes the only
    // horizontal space a row has. (It is Briklay, never "Babai": that name is ours, internally, and the
    // product only ever speaks in its own.)
    const cut = full.replace(/^briklay\s+/i, '').trim()
    return cut ? cap(cut) : full
  }
  return full
}

/* ── the story ── */

const STEP_KIND: Record<string, StoryStep['t']> = {
  chase_sent: 'event',
  status_changed: 'event',
  blocker_noted: 'event',
  description_added: 'event',
  reanalyzed: 'event',
  bare_ack: 'event',
  reply_received: 'msg',
  comment: 'note',
  escalated: 'miss',
  reopened: 'event',
}

/**
 * THE PROBLEM'S STORY — events AND the photos, on ONE rail, in the order they actually happened.
 *
 * The photos used to hang in a strip ABOVE the story, detached from time: a fix photo that arrived
 * yesterday and the crack photo from three weeks ago sat side by side as if they were the same kind of
 * fact. But a photo IS an event — usually the most important one on the card, because it is the only
 * thing on it that cannot be argued with — and its place in the sequence is half of what it means.
 * (The task story has interleaved them like this all along; the problem story simply never did.)
 */
export function buildStory(events: EventRow[], owner: string, now: number, photos: AttachmentRow[] = []): StoryStep[] {
  const rail: { at: string; step: StoryStep }[] = []

  for (const e of events) {
    const w = ago(e.created_at, now)
    const kind = STEP_KIND[e.type] ?? 'event'
    const step: StoryStep =
      kind === 'msg' ? { t: 'msg', from: owner, text: e.body ?? '', w }
        : kind === 'note' ? { t: 'note', text: e.body ?? '', w }
          : kind === 'miss' ? { t: 'miss', l: e.body ?? 'Escalated — no one left to chase', w }
            : { t: 'event', l: e.body ?? e.type.replace(/_/g, ' '), w }
    rail.push({ at: e.created_at, step })
  }

  for (const a of photos) {
    // No timestamp → no place on a timeline. It still reaches the reader (PhotoStrip), but it is not
    // given a position in a sequence we cannot actually vouch for.
    if (!a.created_at) continue
    rail.push({
      at: a.created_at,
      step: { t: 'photo', url: a.url ?? null, caption: a.caption, w: ago(a.created_at, now) },
    })
  }

  return rail.sort((a, b) => a.at.localeCompare(b.at)).map((e) => e.step)
}

export function ago(iso: string, now: number): string {
  const h = hoursBetween(iso, now)
  if (h < 1) return 'just now'
  if (h < 24) return `${h} ${h === 1 ? 'hour' : 'hours'} ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'yesterday'
  return `${d} days ago`
}

/* ── the whole item ── */

export function toDeskProblem(
  p: ProblemRow,
  ctx: {
    events: EventRow[]
    photos: AttachmentRow[]
    resolution: ResolutionRow | null
    siteName: string
    siteCode: string
    nameOf: NameOf
    phoneOf: PhoneOf
    now: number
  },
): DeskProblem {
  const t = trailFacts(ctx.events)
  const state = deriveState(p, t)
  const owner = ctx.nameOf(p.owner_id)
  const hasAnswerPhoto = ctx.photos.some((a) => a.role === 'answer')

  // The rail carries every photo that HAS a timestamp (buildStory interleaves them). The strip is left
  // holding only the ones that do not — they are still evidence, they simply have no place in a sequence.
  const photos: Photo[] = ctx.photos.filter((a) => !a.created_at).map((a) => ({
    e: a.role === 'answer' ? '✅' : '📷',
    l: a.caption ?? (a.role === 'answer' ? 'Fix photo' : 'Photo'),
    url: a.url ?? null,
  }))

  const loc = [p.floor_label, p.unit_label, p.area_label].filter(Boolean).join(' · ')
  const lastMove = t.lastReplyAt ?? t.lastChaseAt ?? p.updated_at

  return {
    id: p.id,
    ref: p.ref ?? '—',
    kind: p.kind,
    state,
    title: p.title,
    site: ctx.siteName,
    siteCode: ctx.siteCode,
    tag: p.kind === 'issue' ? capitalise(p.cause ?? 'other') : null,
    loc: p.kind === 'snag' ? (loc || 'Project-wide') : null,
    days: daysBetween(p.created_at, ctx.now),
    last: hoursBetween(lastMove, ctx.now),
    person: { name: owner, phone: ctx.phoneOf(p.owner_id) },
    status: statusLine(p, state, t, ctx.resolution, owner, hasAnswerPhoto, ctx.now),
    statusShort: statusShort(statusLine(p, state, t, ctx.resolution, owner, hasAnswerPhoto, ctx.now), state),
    photos: photos.length ? photos : undefined,
    // "photo pending — Babai asking": a snag with no evidence that we are actively chasing for.
    photoPending: p.kind === 'snag' && ctx.photos.length === 0 && !!p.next_followup_at,
    story: buildStory(ctx.events, owner, ctx.now, ctx.photos),
    chase: buildChase(p, state, t, owner, ctx.events, ctx.nameOf, hasAnswerPhoto, ctx.now),
    guide: undefined,                    // TODO(map §X4) — the read-model's guide line
    draft: undefined,                    // TODO(map §6 /siteops-say) — the owner-voice prefill
    // Babai has evidence and the item is moving → offer the pre-filled close.
    verify: state === 'moving' && hasAnswerPhoto,
    prefillNote: hasAnswerPhoto ? 'Verified from the fix photo' : undefined,
    secondary: 'Close',
    resolution: ctx.resolution
      ? {
        outcome: outcomeWord(ctx.resolution.outcome),
        note: ctx.resolution.note ?? '',
        by: ctx.resolution.auto_closed ? 'Briklay — auto-closed' : (ctx.nameOf(ctx.resolution.closed_by) || 'You'),
        when: ago(ctx.resolution.closed_at, ctx.now),
      }
      : null,
  }
}

const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * TWO VOICES IN ONE STRING, PULLED APART.
 *
 * The webhook composes a photo message as `<caption>his words</caption>
<photo>our read</photo>`
 * (_siteops_media.ts · mediaComposite) precisely so that nobody downstream has to guess which half is
 * whose. Plain text — every non-image message — has no markers and passes through untouched as `said`.
 */
const CAPTION_RE = /<caption>([\s\S]*?)<\/caption>/i
const PHOTO_RE = /<photo>([\s\S]*?)<\/photo>/i

export function splitComposite(raw: string): { said: string; seen: string | null } {
  const cap = CAPTION_RE.exec(raw)?.[1]?.trim()
  const desc = PHOTO_RE.exec(raw)?.[1]?.trim()
  if (cap === undefined && desc === undefined) return { said: raw, seen: null }   // plain text
  return { said: cap ?? '', seen: desc || null }
}

/* ── tasks ──
 * `after` comes from the engine's own `binding` (the immediate hard predecessors it recorded when
 * it instantiated the graph), mapped node_key → ref. The UI never re-derives dependencies: the
 * engine is the only thing allowed to know what must precede what.
 */

/**
 * BLOCKED-BY IS DERIVED, NOT STORED.
 *
 * `problems.task_id` already IS the blocked task — the timing engine tempers the chase clock
 * against "the blocked task's schedule" (computeBlockedTaskEnd). So a task is blocked by exactly
 * the OPEN issues pointing at it, and `blockerByTaskId` is that reverse index.
 *
 * Storing a second edge would mean a write path that can be forgotten, and a flag that can go
 * stale. This way the block simply CEASES to exist the moment the problem closes — there was
 * never anything to clean up.
 */
export function blockersByTask(problems: ProblemRow[]): Map<string, string> {
  const m = new Map<string, string>()
  const open = problems
    .filter((p) => p.task_id && p.ref && p.kind === 'issue' && p.status !== 'RESOLVED' && p.status !== 'DISMISSED')
    // oldest first: the thing that has been holding the work up longest is the one to name
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
  for (const p of open) if (!m.has(p.task_id!)) m.set(p.task_id!, p.ref!)
  return m
}

export function toDeskTask(
  t: TaskRow,
  ctx: {
    refByNodeKey: Map<string, string>
    /** Every task's real gates, computed once per project from the live graph (gates.ts). */
    gates?: Map<string, Gates>
    blockerByTaskId: Map<string, string>
    qcByTaskId?: Map<string, QcCheck[]>
    commentsByTaskId?: Map<string, TaskCommentRow[]>
    /** The raw WhatsApp messages that touched this task, by narration id. */
    narrationById?: Map<string, NarrationRow>
    /** Photos attached to this task (attachments.parent_type='site_task'), signed. */
    photosByTaskId?: Map<string, AttachmentRow[]>
    /** The project's supervisor. A task with no owner of its own INHERITS him. */
    supervisorId?: string | null
    nameOf: NameOf
    now: number
  },
): DeskTask {
  /**
   * EVERY hard predecessor, not the first one.
   *
   * This was `binding.find(...)` — it took binding[0] and dropped the rest. `binding` is written by
   * persist.ts ALREADY filtered through isHardNature(), so every entry in it is a hard gate, and the
   * engine's availability rule is that ALL of them must be done. Keeping one meant a task waiting on
   * three things called itself startable when the first finished. A node_key with no row in this
   * project resolves to nothing and is dropped — a suppressed or deleted predecessor takes its edge
   * with it, exactly as the engine does when the node leaves the graph.
   */
  /**
   * WHAT THIS TASK WAITS FOR comes from gates.ts — the LIVE graph, instantiated from the building,
   * not from the `binding` snapshot this row happens to carry. A snapshot goes stale (the floor cycle
   * was rebuilt; rows persisted before it still name `slab@First`, which is no longer a task), and a
   * stale gate used to resolve to nothing and be silently dropped — which read as "Ready".
   *
   * ctx.gates is passed in because it is computed ONCE per project (one instantiate, not one per row).
   * With no resolver supplied, we fall back to this row's own binding — same rules, same floor: a gate
   * we cannot resolve is UNRESOLVED, never absent.
   */
  const { afters, unresolved } = ctx.gates?.get(t.task_id)
    ?? gatesFromBinding(t as GateRow, ctx.refByNodeKey)

  /**
   * OWNERSHIP IS SITE-LEVEL, AND THE TASK INHERITS IT.
   *
   * This is not a new rule — it is the pipeline's own (_siteops_route.ts: "a task INHERITS the
   * project's supervisor by default, so narration never stamps a per-task owner; owner_id is set
   * ONLY when a human overrides it"). The desk was ignoring it and printing "Unassigned" against
   * 1,500 tasks that have a supervisor perfectly well.
   *
   * The INHERITED owner is display only — owner_id stays null in the row, so re-assigning the
   * site still re-assigns every task that never had an owner of its own. Only an explicit pick
   * writes owner_id (owner_source='manual'), and that choice is never overwritten.
   */
  const ownerId = t.owner_id ?? ctx.supervisorId ?? null

  return {
    ref: t.ref ?? t.task_id.slice(0, 6),
    title: t.name,
    group: capitalise(t.phase),
    trade: capitalise(t.trade),
    state: t.status === 'not_started' ? 'todo' : t.status,
    afters,
    unresolved: unresolved.length ? unresolved : undefined,
    blockedBy: ctx.blockerByTaskId.get(t.task_id) ?? null,
    assignee: ctx.nameOf(ownerId) || 'Unassigned',
    dur: `${t.duration_days ?? 1}d`,
    // NOT CAPPED AT THE DURATION. It used to be — Math.min(elapsed, duration) — which meant a task
    // on day 6 of a 4-day job reported itself as "day 4 of 4": the app quietly rounded an overrun
    // down to "on schedule". The overrun is the single most useful thing a running task can tell
    // you, and we were the ones hiding it.
    started: t.started_at ? daysBetween(t.started_at, ctx.now) + 1 : undefined,
    doneW: t.status === 'done' ? new Date(t.updated_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) : undefined,
    floor: t.floor_label,
    unit: t.unit_label,
    qc: ctx.qcByTaskId?.get(t.task_id) ?? undefined,
    taskTypeId: t.task_type_id,
    ownerId,
    manual: t.source === 'manual',
    nodeKey: t.node_key,
    desc: t.description ?? null,
    story: buildTaskStory(
      t.status_history,
      ctx.commentsByTaskId?.get(t.task_id) ?? [],
      narrationsOf(t.status_history, ctx.narrationById),
      ctx.photosByTaskId?.get(t.task_id) ?? [],
      ctx.now,
    ),
  }
}
