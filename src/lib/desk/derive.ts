// SITE DESK — THE DERIVATION FLOOR.
//
// Everything the UI *states* is computed here, by code, from data. Nothing in this file
// reads a model, a clock it wasn't given, or the network. That is the constitutional rule
// from docs/SITE_DESK_INTEGRATION_MAP.md: statuses, severity and floor % are deterministic
// code — the model may only ever generate display sentences, never state.
//
// Pure + total, so it is unit-testable without a DOM, a DB or a key (see __tests__/).

import type {
  DeskProblem, DeskTask, DeskUnit, FloorSlice, ProblemState, TaskState, Outcome, Resolution,
} from './types'
// ONE classifier for where a task belongs - the same one the elevation (buildProjectVM) uses.
import { placeOf, STAGE_LABEL } from '../siteOps/engine'

/* ────────────────────────────── severity ────────────────────────────── */

/**
 * THE SORT THAT DECIDES WHAT HE SEES FIRST.
 *
 * Waiting-on-owner outranks everything — no age of a Babai-managed item ever beats a thing
 * that needs his voice. Then the category bump (seepage/electrical/safety cost real money
 * if they sit). Then age, as the tiebreak.
 *
 * Deliberately NOT a "score the model gives us": the ordering of a founder's attention is
 * not a thing we let an LLM guess at.
 */
export function sevScore(i: Pick<DeskProblem, 'state' | 'title' | 'days'>): number {
  const stateW: Record<ProblemState, number> = { you: 200, chasing: 100, moving: 0, resolved: 0 }
  const bump = /seepage|electrical|safety/i.test(i.title) ? 50 : 0
  return stateW[i.state] + bump + i.days
}

/** Red at the threshold: something that has needed HIM for 3+ days has been ignored. */
export const isOldAge = (i: Pick<DeskProblem, 'state' | 'days'>): boolean =>
  i.state === 'you' && i.days >= 3

/** Words beat initials for lay users — "Jaggu", not "J". Strips role prefixes, caps at 9ch. */
export function firstName(name: string | undefined | null): string {
  if (!name || name === '—') return ''
  const w = name.replace(/^(Client|Supervisor|Vendor)\s*[—-]?\s*/i, '').trim().split(/\s+/)[0] ?? ''
  return w.length > 9 ? `${w.slice(0, 8)}…` : w
}

/* ────────────────────────────── task status ──────────────────────────────
 * ONE status vocabulary, derived. Only Done / In progress / Not started are ever hand-set;
 * everything below is computed from the graph:
 *   Done ✓ · In progress · Ready (up next) · After {task} · Blocked by {ref}
 * "Blocked" in particular is NEVER hand-set — it exists only because an open problem links here.
 */

export type TaskStatusVM =
  | { cls: 'done'; text: string }
  | { cls: 'blocked'; ref: string; text: string }   // text is what follows the ref link
  | { cls: 'live'; text: string }
  | { cls: 'after'; text: string; waiting: string[] }  // EVERY predecessor still open, in engine order
  /** The plan says work must come first, and that work is not in this project's task list. We cannot
   *  see whether it is finished, so we will not say it is. UNKNOWN IS NOT PERMISSION. */
  | { cls: 'unknown'; text: string; missing: string[] }
  | { cls: 'ready'; text: string }

export function taskStatus(
  t: DeskTask,
  problems: readonly DeskProblem[],
  taskByRef: (ref: string) => DeskTask | undefined,
): TaskStatusVM {
  if (t.state === 'done') return { cls: 'done', text: `Done ✓${t.doneW ? ` · ${t.doneW}` : ''}` }

  // A block is a LINK to a live problem — if that problem closed, the block is gone. No stale flags.
  if (t.blockedBy) {
    const p = problems.find((x) => x.ref === t.blockedBy && x.state !== 'resolved')
    if (p) return { cls: 'blocked', ref: t.blockedBy, text: `— ${p.title.toLowerCase()}` }
  }

  if (t.state === 'active') {
    const total = parseInt(t.dur, 10) || 0
    const day = t.started ? ` · day ${t.started} of ${total}` : ''
    return { cls: 'live', text: `In progress — ${t.assignee} on it${day}` }
  }

  /**
   * READY MEANS EVERY GATE IS OPEN — the engine's availability rule, not a UI approximation.
   *
   * `afters` is the set of HARD predecessors (IMPOSSIBLE + DESTRUCTIVE + curing_time), read from the
   * LIVE graph — see gates.ts. So the test is ALL of them, and the sentence names the first one still
   * standing: the thing he would actually have to go and finish.
   */
  const waiting = t.afters
    .map((g) => taskByRef(g.ref))
    .filter((d): d is DeskTask => !!d && d.state !== 'done')

  if (waiting.length) {
    return { cls: 'after', text: `After ${waiting[0].title}`, waiting: waiting.map((d) => d.ref) }
  }

  /**
   * UNKNOWN IS NOT PERMISSION — AND THIS IS THE LINE THAT PUT A WALL ON AN UNPOURED SLAB.
   *
   * This used to be the whole rule: "a ref that resolves to nothing is not an open gate." It was
   * written for the deletion case (delete a task and the work that waited for it is genuinely free)
   * and it is right about that — but deletion is handled honestly now, upstream: a deleted task is
   * suppressed, the engine never instantiates it, and no edge to it is ever produced. Nothing gets
   * here by being deleted.
   *
   * What DOES get here is a predecessor the plan insists on and that this project has no row for — a
   * task list that has drifted from the building. And there we know exactly one thing: WE DO NOT KNOW
   * whether the slab is poured. The old code answered that by saying "Ready — can start now".
   *
   * We say we don't know. He can still start it — the three states are his — but the app will not
   * put its name to it, and this task will never be offered as "Up next".
   */
  if (t.unresolved?.length) {
    const [first] = t.unresolved
    return {
      cls: 'unknown',
      text: t.unresolved.length === 1
        ? `Can’t confirm — ${first} isn’t in this project’s task list`
        : `Can’t confirm — ${first} and ${t.unresolved.length - 1} other job${t.unresolved.length > 2 ? 's' : ''} aren’t in this project’s task list`,
      missing: t.unresolved,
    }
  }

  return { cls: 'ready', text: 'Ready — can start now' }
}

/**
 * UP NEXT — WHAT THE CREW PICKS UP WHEN THEY PUT THIS DOWN.
 *
 * ══ WHAT IT USED TO MEAN, AND WHY THAT WAS USELESS ═════════════════════════════════════════════
 *
 * It meant STARTABLE: the first task in the group with every hard gate open. Which sounds right, and
 * on a real floor means whole sections carry no chip at all — in Finishes, every job waits on the one
 * before it, so nothing is "startable" and the section says nothing about what happens next. The
 * question a man asks the plan is not "what may I legally begin this instant". It is "what is running,
 * and what comes after it".
 *
 * ══ WHAT IT MEANS NOW ══════════════════════════════════════════════════════════════════════════
 *
 * It is POSITIONAL, and it is over the WHOLE FLOOR — not one per section. The sections (Structure,
 * Services, Finishes) are bands within a single run, not three parallel queues, so a chip on each of
 * them was three answers to a question that has one:
 *
 *   · nothing running on this floor    →  ONE next job: the first one not yet done. That is where
 *                                         the floor picks up, and it is the only honest answer.
 *   · something running                →  the job that FOLLOWS it. That is the handover: when this
 *                                         one comes off, that one goes on.
 *   · several things running           →  the job after EACH of them. Two crews working means two
 *                                         real handovers coming, and telling him about only one is
 *                                         telling him about the wrong one half the time.
 *
 * The chip does NOT claim the work can start — the row says that for itself ("After the pour",
 * "Blocked by DSR-19"). It says where you are in the sequence, which is a different fact and the one
 * the section header cannot give him.
 *
 * THE ONE THING IT WILL NOT DO is name a job an open problem has stopped. "Next up: the thing that is
 * broken" is not a plan, it is a taunt — so a blocked row is stepped over and the job behind it takes
 * the chip. Everything else (waiting on the job before it, waiting on work we cannot see) is fair:
 * that IS what happens next.
 */
export function upNextRefs(
  tasks: readonly DeskTask[],
  problems: readonly DeskProblem[],
  taskByRef: (ref: string) => DeskTask | undefined = (r) => tasks.find((t) => t.ref === r),
): Set<string> {
  const next = new Set<string>()

  const isBlocked = (t: DeskTask) => taskStatus(t, problems, taskByRef).cls === 'blocked'
  /** The next job that can be handed to somebody, from `i` onwards: not done, not already running,
   *  and not the one thing that is broken. */
  const pickFrom = (i: number): DeskTask | undefined =>
    tasks.slice(i).find((t) => t.state === 'todo' && !isBlocked(t))

  // ONE LIST, NOT ONE PER SECTION. The floor is what he is looking at, and the floor has ONE next
  // job — the sections are bands within a single run, not three parallel queues. A chip on each
  // section head was three answers to a question with one answer.
  const running = tasks
    .map((t, i) => [t, i] as const)
    .filter(([t]) => t.state === 'active')

  if (running.length) {
    // ...unless work is actually on. THEN there are as many next jobs as there are crews: each thing
    // running has a thing that follows it, and that handover is a real, separate fact.
    for (const [, i] of running) {
      const pick = pickFrom(i + 1)
      if (pick) next.add(pick.ref)
    }
    return next
  }

  // nothing running anywhere on this floor: its next job is simply its first unfinished one
  const pick = pickFrom(0)
  if (pick) next.add(pick.ref)
  return next
}

/** A group folds when nothing in it can start yet — no point showing ten things that can't move. */
export function groupIsFoldable(
  tasks: readonly DeskTask[],
  problems: readonly DeskProblem[],
  taskByRef: (ref: string) => DeskTask | undefined,
): boolean {
  const pending = tasks.filter((t) => t.state !== 'done')
  if (!pending.length) return false
  return !pending.some((t) => {
    const c = taskStatus(t, problems, taskByRef).cls
    return c === 'ready' || c === 'live'
  })
}

/* ────────────────────────────── the floor slice ──────────────────────────────
 * What one floor shows. Pure, so picking a floor is just a different argument — and a floor at 0%
 * opens exactly like any other, because "not started" is the state you most want to look at.
 */

/**
 * THE GROUND THE BUILDING STANDS ON.
 *
 * The engine's building-level tasks — site clearance, excavation, footings, the façade, the
 * compound wall — belong to no floor, and the first version of this let them "ride along" with
 * whatever floor you were looking at. That was wrong twice over: they appeared under EVERY floor
 * (ground clearance listed under Stilt, and again under First, and again under Second), and they
 * counted toward NO floor's percentage — so a site with all its groundwork done showed every floor
 * at 0% while listing finished tasks. Both symptoms, one cause.
 *
 * They get a floor of their own, first in the sequence, exactly where they happen.
 */
// THE BIN IS GONE (2026-07-13). These three ARE the engine's stages (siteOps/engine/stages.ts) - the same
// function the elevation uses - so the rail and the plan cannot disagree about where a task belongs. It was
// one bucket, `!t.floor`, and it put the facade, the terrace, external paint, site development, snagging AND
// THE LIFT under "Site & foundation" on a project whose footings had not been dug.
export const SITE_FLOOR = STAGE_LABEL.foundation
export const BUILDING_FLOOR = STAGE_LABEL.exterior
export const AMENITY_FLOOR = STAGE_LABEL.amenities
/** Where the engine says this task lives: a floor label, or one of the three stages. */
const placeOfTask = (t: DeskTask): string => placeOf({ taskTypeId: t.taskTypeId, floorLabel: t.floor })
const STAGE_NAMES = new Set<string>(Object.values(STAGE_LABEL))

/**
 * NAME THE FLOOR THE WAY A PERSON WOULD SAY IT.
 *
 * The engine stores the label ("Stilt", "Ground", "Fourth") because that is the KEY — matching,
 * ordering and the whole WhatsApp side pivot on it, and it must never change. But nobody on a site
 * says "go up to Fourth". They say the fourth floor, the stilt floor, the ground floor. So the view
 * SPEAKS the label rather than printing it: "floor" is added here, and only where it is missing — a
 * label that already carries its own noun ("Site & foundation", "Terrace", "Basement 1") is left
 * exactly as the engine wrote it.
 */
const HAS_ITS_OWN_NOUN = /\b(floor|foundation|terrace|roof|basement|cellar|parking|deck|podium|site|level|block|tower)\b/i

export function floorName(label: string): string {
  const l = label.trim()
  // A STAGE IS NOT A FLOOR (2026-07-13). This appends "floor" to any label that does not already carry its
  // own noun — which is right for "Ground" and "Fourth", and nonsense for a stage: the rail was reading
  // "Amenities floor" and "Exterior & handover floor". Amenities are not a storey of the building. They are
  // just the amenities. The stages name themselves; nothing is added to them.
  if (STAGE_NAMES.has(l)) return l
  if (!l || HAS_ITS_OWN_NOUN.test(l)) return l
  return `${l} floor`
}

export function sliceFloor(tasks: readonly DeskTask[], floor: string): FloorSlice {
  // A STAGE is not a floor: it is where the floorless work of that kind belongs. No units in it, by
  // construction - the ground, the building and its amenities have no flats.
  if (floor === SITE_FLOOR || floor === BUILDING_FLOOR || floor === AMENITY_FLOOR) {
    return { common: tasks.filter((t) => !t.floor && placeOfTask(t) === floor), units: null }
  }

  const onFloor = tasks.filter((t) => t.floor === floor)
  const unitNames = [...new Set(onFloor.map((t) => t.unit).filter((u): u is string => !!u))]

  return {
    common: onFloor.filter((t) => !t.unit),
    units: unitNames.length
      ? { floor, list: unitNames.map((u) => ({ u, tasks: onFloor.filter((t) => t.unit === u) })) }
      : null,
  }
}

/** The floors of a plan, bottom-up: the ground it stands on, then every real floor. */
export function planFloors(tasks: readonly DeskTask[]): { n: string; pct: number }[] {
  const names: string[] = []
  for (const t of tasks) if (t.floor && !names.includes(t.floor)) names.push(t.floor)
  const floors = names.map((n) => ({ n, pct: pctDone(tasks.filter((t) => t.floor === n)) }))

  // Build order, and it is physical: the ground it stands on, then every floor bottom-up, then the building
  // itself (facade, terrace, site works, handover), then its amenities. A STAGE WITH NO WORK IN IT DOES NOT
  // APPEAR - a project with no lift and no compound wall grows no empty Amenities section.
  const stage = (n: string) => {
    const ts = tasks.filter((t) => !t.floor && placeOfTask(t) === n)
    return ts.length ? [{ n, pct: pctDone(ts) }] : []
  }
  return [...stage(SITE_FLOOR), ...floors, ...stage(BUILDING_FLOOR), ...stage(AMENITY_FLOOR)]
}

/* ────────────────────────────── plan rollups ────────────────────────────── */

export const pctDone = (tasks: readonly DeskTask[]): number =>
  tasks.length ? Math.round((100 * tasks.filter((t) => t.state === 'done').length) / tasks.length) : 0

/** Open problems blocking work in this place — the red corner badge on a unit chip. */
export function openBlockers(tasks: readonly DeskTask[], problems: readonly DeskProblem[]): string[] {
  return [...new Set(
    tasks
      .filter((t) => t.blockedBy && problems.some((p) => p.ref === t.blockedBy && p.state !== 'resolved'))
      .map((t) => t.blockedBy as string),
  )]
}

export const hasLiveWork = (tasks: readonly DeskTask[]): boolean => tasks.some((t) => t.state === 'active')

/**
 * The unit matrix, as one sentence: "Tiling 1/4 · Doors 1/4".
 * Counts only the flats that actually HAVE that activity — a 2BHK without a second bath
 * must not drag the denominator of a task it was never given.
 */
export function acrossFlats(units: readonly DeskUnit[]): string {
  const activities = [...new Set(units.flatMap((u) => u.tasks.map((t) => t.title)))]
  return activities
    .map((a) => {
      const have = units.filter((u) => u.tasks.some((t) => t.title === a))
      const done = have.filter((u) => u.tasks.find((t) => t.title === a)?.state === 'done')
      return `${a} ${done.length}/${have.length}`
    })
    .join(' · ')
}

/* ────────────────────────────── refs ──────────────────────────────
 * ONE per-site number space shared by problems and tasks (DSR-21 is a problem, DSR-30 a task),
 * so a ref alone resolves to exactly one row and every cross-link is unambiguous.
 */

const REF_RE = /\{([A-Z]{2,6}-\d+)\}/g

/** Split a status string on {REF} markers so React can render real links (no innerHTML). */
export function splitRefs(text: string): Array<{ ref?: string; text?: string }> {
  const out: Array<{ ref?: string; text?: string }> = []
  let last = 0
  for (const m of text.matchAll(REF_RE)) {
    if (m.index! > last) out.push({ text: text.slice(last, m.index) })
    out.push({ ref: m[1] })
    last = m.index! + m[0].length
  }
  if (last < text.length) out.push({ text: text.slice(last) })
  return out
}

export const siteCodeOf = (ref: string): string => ref.split('-')[0] ?? ''

/* ────────────────────────────── close / reopen ──────────────────────────────
 * The close contract, as pure state. The UI calls these and renders the result; the same
 * functions are what the tests pin. Reopen NEVER deletes the resolution (P6 audit floor).
 */

/** SNAG FLOOR (P8): a snag cannot be VERIFIED-closed without a fix photo.
 *  Logging without a photo is fine — Babai chases for it. Closing without one is not. */
export function canClose(
  i: Pick<DeskProblem, 'kind' | 'photos'>,
  outcome: Outcome,
): { ok: true } | { ok: false; why: string } {
  const needsPhoto = i.kind === 'snag' && outcome === 'Fixed'
  const hasPhoto = !!i.photos?.length
  if (needsPhoto && !hasPhoto) {
    return { ok: false, why: 'A snag can only be closed as fixed once the fix photo is in. Briklay is asking for it.' }
  }
  return { ok: true }
}

export interface ClosePatch {
  state: ProblemState
  status: string
  resolution: Resolution
}

export function closeItem(outcome: Outcome, note: string, by = 'You'): ClosePatch {
  return {
    state: 'resolved',
    status: `${outcome} · closed by ${by === 'You' ? 'you' : by} just now`,
    resolution: { outcome, note: note.trim() || outcome, by, when: 'just now' },
  }
}

/** Everything needed to put an item back EXACTLY as it was — the Undo contract. */
export interface UndoSnapshot {
  id: string
  state: ProblemState
  status: string
  storyLen: number
  resolution: Resolution | null
}

export const snapshot = (i: DeskProblem): UndoSnapshot => ({
  id: i.id,
  state: i.state,
  status: i.status,
  storyLen: i.story.length,
  resolution: i.resolution ?? null,
})

export function applyUndo(i: DeskProblem, s: UndoSnapshot): DeskProblem {
  return { ...i, state: s.state, status: s.status, story: i.story.slice(0, s.storyLen), resolution: s.resolution }
}

/** Reopen: the item comes back needing him — and the resolution record STAYS on file. */
export function reopenItem(i: DeskProblem): DeskProblem {
  return {
    ...i,
    state: 'you',
    status: 'Reopened — waiting on you',
    story: [...i.story, { t: 'event', l: 'Reopened', w: 'just now' }],
    // resolution is deliberately NOT cleared — the audit trail outlives the close.
  }
}

/* ────────────────────────────── task state ────────────────────────────── */

export function setTaskState(t: DeskTask, s: TaskState): DeskTask {
  if (s === 'active') return { ...t, state: s, started: t.started ?? 1 }
  if (s === 'todo') return { ...t, state: s, started: undefined }
  return { ...t, state: s }
}

export function bumpDuration(t: DeskTask, d: number): DeskTask {
  const n = Math.max(1, (parseInt(t.dur, 10) || 1) + d)
  return { ...t, dur: `${n}d` }
}
