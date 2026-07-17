// SITE DESK — the typed contract between the UI and its data source.
//
// Every component in src/components/desk reads THESE types and nothing else. The mock
// (mock.ts) and the eventual live adapter (api.ts) both satisfy them, so the swap from
// mock → live is a one-file change with zero component edits. Field names track
// docs/SITE_DESK_INTEGRATION_MAP.md §6 (Contracts) so the shapes line up when the
// endpoints land.

/** issue | snag — ONE table (problems.kind), one ref space, one close flow.
 *  The prototype settles this: a snag carries a location, photos, an owner, a chase
 *  clock and a close-requires-photo floor. `todos` has none of those and never will. */
export type ProblemKind = 'issue' | 'snag'

/** Who the ball is with. Derived from owner + chase state — never hand-set.
 *  you = needs the founder's voice · chasing = Babai is on it · moving = on track · resolved = closed. */
export type ProblemState = 'you' | 'chasing' | 'moving' | 'resolved'

/** The four closing reasons. One word per concept — no "Resolved", no "Duplicate". */
export const OUTCOMES = ['Fixed', 'Client said ok', 'Not a problem', 'Same as another'] as const
export type Outcome = (typeof OUTCOMES)[number]

/** Written when an item closes. NEVER deleted — a reopen keeps it (P6 audit floor). */
export interface Resolution {
  outcome: Outcome
  note: string
  by: string          // "You" | "Briklay — auto-closed"
  when: string
}

/** One entry in the item's story. `msg` = an inbound WhatsApp reply (rendered as a bubble). */
export type StoryStep =
  | { t: 'event'; l: string; w?: string }
  | { t: 'miss'; l: string; w?: string }        // a silence / a thing that didn't happen
  | { t: 'next'; l: string; w?: string }        // what Babai will do next
  | { t: 'resolve'; l: string; w?: string }
  | { t: 'msg'; from: string; text: string; w?: string }
  | { t: 'note'; text: string; w?: string }     // private, team-only
  // A PHOTO FROM THE SITE. The webhook has always attached these to the task
  // (attachments.parent_type='site_task'); the desk simply never read them, so a supervisor could
  // photograph a poured slab and the one screen built to show it showed nothing.
  | {
      t: 'photo'; url: string | null; w?: string;
      /** HIS words — the caption the sender actually typed under the photo. May be empty. */
      caption?: string | null;
      /** OUR read of the pixels — what the vision pass saw. NEVER shown as something he said. */
      seen?: string | null;
      /** The private-bucket ref to sign LAZILY, at render (see useSignedUrl). `url` is the eager path —
       *  set only when something already signed it (the mock). One of the two carries the picture. */
      bucket?: string | null;
      path?: string | null;
    }

export interface Person { name: string; phone: string }
/** `e` is the placeholder glyph; `url` is a SIGNED storage url when one is already in hand; otherwise
 *  `bucket`/`path` are the private-bucket ref that useSignedUrl mints a URL from at render time. */
export interface Photo { e: string; l: string; url?: string | null; bucket?: string | null; path?: string | null }

/**
 * ══ THE CHASE BLOCK — WHY THIS IS SITTING WHERE IT IS ═══════════════════════════════════════════════
 *
 * The card could always tell you WHAT the problem was and WHEN things happened to it. It could never
 * tell you the one thing a founder opens it to find out: why has this ended up on MY desk?
 *
 * Three lines answer that, and each is a different kind of fact:
 *
 *   since   WHERE the ball is, and since when.   "With you since yesterday"
 *   why     WHAT went wrong to put it there.     "Suresh didn't reply to two nudges. The committed
 *                                                 date is 9 days past."
 *   path    WHO it passed through to get here.   Ravi → Suresh · notified 2 times → You
 *
 * The path is the point. A single red line saying "waiting on you" is an accusation with no story; the
 * path shows the chain of people who tried, so the reader arrives already knowing what has been done and
 * what is left. It is drawn ONLY from hops we actually know — an unknown reporter is simply not drawn,
 * never rendered as "Unknown" and never invented.
 */
export interface ChaseHop {
  name: string
  /** What happened at this hop — "notified 2 times". Absent when nothing did. */
  note?: string | null
  /** THE ONE holding it now. Rendered in the block's tone; everyone before it is spent. */
  live?: boolean
}

export interface Chase {
  /** The rail's colour and the block's voice. `resolved` items have no chase block — the resolution
   *  block below already says everything, and two closing statements is one too many. */
  tone: 'you' | 'chasing' | 'moving'
  since: string
  why: string
  path: ChaseHop[]
}

export interface DeskProblem {
  id: string
  ref: string                    // DSR-21 — per-site, shared number space with tasks
  kind: ProblemKind
  state: ProblemState
  title: string
  site: string                   // display name
  siteCode: string               // DSR
  tag?: string | null            // issue category: Material | Labour | Approval | Client
  loc?: string | null            // snag location: "2nd floor · master bath" | "Project-wide"
  days: number                   // age
  last: number                   // hours since last movement (newest-sort key)
  person: Person
  /** The current assignee's user id — the selected value of the reassign dropdown. Null = unassigned. */
  ownerId?: string | null
  /** HOW the assignee was set (problems.owner_source): 'auto' = Briklay defaulted it from the site,
   *  'manual' = a human picked. Drives the "why is it assigned to them" subtext. */
  ownerSource?: 'auto' | 'manual' | null
  /** The plain-language reason the assignee holds this — derived from ownerSource + whether they are the
   *  site's supervisor. e.g. "Auto-assigned to the site supervisor" / "Assigned by hand". */
  assignReason?: string
  status: string                 // the one-line plain-language status (X4 read-model) — the DETAIL
  /** The same sentence with the part the medallion already says removed — for the ROW. */
  statusShort?: string
  photos?: Photo[]
  photoPending?: boolean         // "photo pending — Babai asking"
  story: StoryStep[]
  guide?: string                 // the plain-language guide line (may contain <b>)
  draft?: string                 // owner-voice composer prefill
  approve?: string               // approval-kind items: the approve button's label
  verify?: boolean               // Babai has evidence → primary becomes "Confirm & close"
  prefillNote?: string           // auto-close proposal, pre-filled from the evidence
  secondary?: string
  resolution?: Resolution | null
  /** Why it is where it is (see Chase). Null once resolved. */
  chase?: Chase | null
}

export type TaskState = 'todo' | 'active' | 'done'

/**
 * ONE HARD PREDECESSOR, as the engine recorded it (site_tasks.binding).
 *
 * `nature` and `reason` are the library's own words, kept as plain strings rather than re-importing
 * the engine's enums: this is a wire shape, it arrives as jsonb from the database, and the desk's
 * job is to carry it faithfully — not to re-declare a vocabulary it does not own.
 *
 *   IMPOSSIBLE   physics. You cannot wire a slab that has not been poured.
 *   DESTRUCTIVE  possible, and it wrecks finished work. Chasing a plastered wall.
 *   (a softer nature reaches this list only through reason='curing_time' — see isHardNature)
 */
export interface TaskGate {
  ref: string
  nature: string
  reason: string
  /** The engine's identity for the predecessor. The ref is how the UI links to it; this is what it IS. */
  nodeKey?: string
}

/**
 * A QUALITY CHECK on a task. Authored per task-type by the engine, fanned out at generation —
 * three per task, at most one CRITICAL.
 *
 * These are the whole reason a site photo is worth taking: most of them can only be answered
 * BEFORE the work is covered up (cover blocks before the pour, conduit before the plaster).
 * Once the concrete is down, nobody can ever check it again — so a pending critical check on a
 * task that is about to be buried is the most expensive thing on this screen.
 */
export type QcStatus = 'pending' | 'confirmed' | 'failed'
export interface QcCheck {
  id: string
  question: string
  critical: boolean
  status: QcStatus
  answer: string | null
}

export interface DeskTask {
  ref: string                    // DSR-30 — same per-site sequence as problems
  title: string
  group: string
  trade: string
  state: TaskState               // ONLY these three are hand-set
  /**
   * EVERY hard predecessor — the engine's own `binding`, mapped node_key → ref, WITH the severity
   * the library gave it.
   *
   * It was `after: string | null` and it held binding[0]: ONE of them. Every entry in `binding` is a
   * hard gate (persist.ts filters it through isHardNature), so a task waiting on three things was
   * calling itself startable the moment the first finished — and "Up next" pointed the site at work
   * that could not begin. The engine's rule is ALL of them.
   *
   * The nature and the reason ride along because a DRAG has to be judged, and judged truthfully: you
   * cannot wire a slab that was never poured (IMPOSSIBLE → refuse), but you CAN chase a plastered
   * wall (DESTRUCTIVE → allow, and say what it costs). One list, so the sequence and the referee can
   * never disagree about what this task waits for.
   */
  afters: TaskGate[]             // dependency edges → "After {task}"
  /**
   * Work the plan says must come first, that this project has NO TASK for.
   *
   * Not a corner case — it is what happens whenever the task list drifts from the building (a row
   * persisted before the floor cycle was rebuilt still names `slab@First`, a task type that no longer
   * exists). The old code dropped these and called the task READY, which is how "Wall — blockwork"
   * came to be startable over a slab that was never poured.
   *
   * We cannot see whether that work is done. So we do not say it is. See taskStatus → cls 'unknown'.
   */
  unresolved?: string[]
  blockedBy?: string | null      // an open problem's ref → "Blocked by {ref}"
  assignee: string
  dur: string                    // "3d"
  started?: number               // day N of the duration → "day 3 of 4"
  doneW?: string
  note?: string
  floor?: string | null
  unit?: string | null
  qc?: QcCheck[]                 // the authored quality checks (site_task_qc)
  /** The engine task-type. It is what the 3-point BRIEF is keyed on — the card shows the brief before
   *  the work starts, where a checklist would be useless. Null on a hand-added task: no type, no brief,
   *  and the card honestly shows nothing rather than inventing one. */
  taskTypeId?: string | null
  ownerId?: string | null
  /**
   * TRUE when a human typed this task in, FALSE when the engine authored it (site_tasks.source).
   *
   * The edit sheet needs it, and the reason is not cosmetic: the engine derives the graph from the
   * BUILDING, and site_tasks is a projection of it. Change a generated task's floor and reconcile()
   * simply re-inserts the node it can no longer find (persist.ts) — you get your task back on the
   * old floor, plus a duplicate on the new one. Where a generated task lives is the building's fact,
   * not the row's, and the sheet says so instead of offering a field that quietly undoes itself.
   * A manual task has no such tie, and can be moved freely.
   */
  manual?: boolean
  /** The engine's identity for this task (site_tasks.node_key) — the key reconcile() matches on, and
   *  therefore the key that must be SUPPRESSED for a delete to stay deleted. Null on a hand-typed row. */
  nodeKey?: string | null
  /** The site's own note on what this task covers (site_tasks.description). Distinct from the
   *  engine's authored BRIEF, which is keyed on the task-type and is the same on every site. */
  desc?: string | null
  /** THE TASK'S OWN STORY — status changes and site_task_comments, including every WhatsApp
   *  update the resolver mapped onto this task. Without it a supervisor's message lands in the
   *  database and vanishes from the screen, which is the whole promise of the product broken. */
  story?: StoryStep[]
}

/** A WhatsApp capture with no home yet (siteops_unplaced) — the Pending segment. */
export interface DeskPending {
  id: string
  text: string
  sender: string                 // the person, by name where we know them
  senderNumber: string
  when: string
  interrupted: boolean           // QUESTION INTERRUPTED — we asked, they never answered
  photo?: boolean
  site?: string | null           // where we think it belongs, if we got that far
}

export interface DeskSite {
  name: string
  code: string
  projectId: string
  projectType: string            // Residential | Villa | Apartment — the wizard needs it
  supervisorId: string | null
  pct: number                    // plan % — derived
  focus: string                  // the floor work is on
  state: 'hot' | 'ok' | 'mid'
  note: string
  youCount: number
  openCount: number
}

export interface DeskFloor { n: string; pct: number }
export interface DeskUnit { u: string; tasks: DeskTask[] }

export interface DeskPlan {
  floors: DeskFloor[]
  /** The floor being looked at. Defaults to the lowest unfinished one; the user can pick another. */
  focus: string
  /** EVERY task on the site. The floor slice is derived from this (see sliceFloor) — the plan does
   *  not pre-partition, or picking a different floor could not change what you see. */
  tasks: DeskTask[]
  /** Rendered ONLY when a site has more than one block. */
  blocks?: string[]
}

/** What one floor shows: the flats on it, and everything on it that is not inside a flat. */
export interface FloorSlice {
  common: DeskTask[]
  units: { floor: string; list: DeskUnit[] } | null
}
