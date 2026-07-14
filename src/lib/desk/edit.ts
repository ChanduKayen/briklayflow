// SITE DESK — EDITING A TASK BY HAND. Pure; no I/O.
//
// The desk could change a task's STATE and nothing else. This is the rest: rename it, say what it
// really covers, and (in the steps that follow) delete it and move it. Every rule that decides what
// an edit TOUCHES lives here, in code that can be tested — the modal only collects the words.
//
// THE ONE THING TO UNDERSTAND ABOUT A RENAME
//
// The name is not a label. It is the candidate line the WhatsApp resolver matches against
// (_siteops_resolution_llm.ts builds the line straight from site_tasks.name), and the task-TYPE
// identity the model echoes back is derived from it. So a rename changes what the model SEES, and
// two consequences follow, which planRename() below is entirely about:
//
//   1. Renaming ONE row of a type splits that type in the candidate list — the model is shown
//      "Conduiting" and "Pipe pulling" as if they were different kinds of work. Legitimate when the
//      site really does mean something different by that one; noise otherwise. So the user chooses:
//      this row, or every row of this type on the project.
//
//   2. If no row keeps the old name, the site's WORD for that work is gone from the candidate list,
//      and the supervisor who has said it for twenty years stops being understood. So we keep it: a
//      synonym on the task TYPE (projects.task_synonyms), which the resolver appends to that
//      candidate's `saidAs`. Renaming may add a word. It may never take one away.

import type { DeskProblem, DeskTask, TaskGate } from './types'

/** Which rows a rename touches. */
export type RenameScope = 'row' | 'type'

export interface RenamePlan {
  /** The trimmed name to write. */
  name: string
  /** The rows that get it. */
  refs: string[]
  /** The word about to disappear from the candidate list, and the type that must keep answering to
   *  it. Null when a row of that type still carries the old name — nothing has been lost. */
  synonym: { taskTypeId: string; oldName: string } | null
}

/**
 * What renaming `t` to `name` actually does. Null when it does nothing (an empty name, or the name
 * it already has) — the caller writes nothing rather than touching a row for no reason.
 */
export function planRename(
  t: DeskTask,
  name: string,
  scope: RenameScope,
  all: readonly DeskTask[],
): RenamePlan | null {
  const next = name.trim()
  if (!next || next === t.title.trim()) return null

  // A hand-typed row has no engine task-type. There is no type to rename across and no type to hang
  // a synonym on, so it can only ever rename itself — whatever scope was asked for.
  const typeId = t.taskTypeId ?? null
  const siblings = typeId ? all.filter((x) => x.taskTypeId === typeId) : [t]
  const targets = scope === 'type' && typeId ? siblings : [t]

  // Does the old word survive anywhere? It does if a row of this type keeps it — i.e. a sibling that
  // still carries the old name and is NOT one of the rows being renamed.
  const oldName = t.title.trim()
  const keeps = siblings.some((x) => !targets.includes(x) && x.title.trim() === oldName)
  const synonym = !keeps && typeId ? { taskTypeId: typeId, oldName } : null

  return { name: next, refs: targets.map((x) => x.ref), synonym }
}

/* ────────────────────────────── delete ──────────────────────────────
 * A DELETE IS NOT A ROW DISAPPEARING, and the confirmation is not allowed to pretend otherwise.
 *
 * Deleting a task on this desk does four things, and every one of them is a fact we can compute
 * BEFORE he presses the button — so we compute them, and the dialog states them. A warning that says
 * "are you sure? this cannot be undone" is a warning that has told him nothing he didn't know.
 */
export interface DeleteImpact {
  /** Tasks that were waiting on this one and become startable the moment it is gone. The engine drops
   *  the node AND its edges, so this is not a bug — but it is the consequence nobody predicts. */
  unblocks: DeskTask[]
  /** Quality checks destroyed with it (site_task_qc CASCADEs), and how many of those were CRITICAL —
   *  the ones that can only ever be answered before the work is covered up. */
  qcCount: number
  qcCritical: number
  /** Open problems raised about this task. They SURVIVE the delete (problems.task_id is ON DELETE SET
   *  NULL) — but they lose the thing they were about, which is its own kind of loss. */
  orphans: DeskProblem[]
  /** The node_key to add to projects.suppressed_nodes. Without it reconcile() re-inserts the row on
   *  the next read (persist.ts) and the delete silently un-happens. Null for a hand-typed row: there
   *  is no graph node, so there is nothing to regenerate it. */
  suppressNode: string | null
  /** Rows of the same task-type that are NOT being deleted — proof the suppression is per-node and
   *  the other floors keep their work. */
  siblingsKept: number
}

/* ────────────────────────────── move ──────────────────────────────
 * A DRAG IS A CLAIM ABOUT THE BUILDING, SO THE BUILDING GETS TO ANSWER.
 *
 * The plan is a dependency graph. Dropping the wiring above the slab is not a preference the user is
 * entitled to — it is a sequence that cannot be built, and an interface that accepts it has lied with
 * its own hands. But the opposite mistake is just as bad: refusing EVERY reordering because some of
 * them are impossible would make the drag ornamental, and a supervisor who has decided to chase a
 * plastered wall and eat the rework is making a legitimate call about his own site.
 *
 * So the engine's ladder, exactly (Evaluator.checkMove / verdictFor):
 *
 *   IMPOSSIBLE   → forbid                   physics. Refused, and told why.
 *   DESTRUCTIVE  → allow_with_consequence   allowed, and the damage is named.
 *   STRONG_PREF  → warn                     reaches a row only via curing_time.
 *   WEAK_PREF    → suggest
 *   otherwise    → allow
 *
 * The check runs over the WHOLE proposed order, not just the dragged row, because a break is
 * symmetric: pushing the pour DOWN past the blockwork breaks the same edge as dragging the blockwork
 * UP past the pour, and only one of those is the row under the cursor.
 */
export type MoveVerdict = 'allow' | 'suggest' | 'warn' | 'allow_with_consequence' | 'forbid'

const SEVERITY: Record<string, number> = {
  IMPOSSIBLE: 4, DESTRUCTIVE: 3, STRONG_PREF: 2, WEAK_PREF: 1, INDIFFERENT: 0,
}
const VERDICT: Record<string, MoveVerdict> = {
  IMPOSSIBLE: 'forbid', DESTRUCTIVE: 'allow_with_consequence',
  STRONG_PREF: 'warn', WEAK_PREF: 'suggest', INDIFFERENT: 'allow',
}

export interface MoveResult {
  /** Did the move happen? False for a forbidden drop AND for a no-op (dropped on itself). */
  ok: boolean
  verdict: MoveVerdict
  /** What to say. Built from the edge that actually broke — never a generic string. */
  message: string
  /** The order that was judged. The caller persists THIS, so what was checked is what is written. */
  order: DeskTask[]
}

/**
 * Move `moved` into `targetRef`'s slot, and rule on the result.
 * `tasks` is the full sequence, in the order it is currently in.
 */
export function checkMove(moved: DeskTask, targetRef: string, tasks: readonly DeskTask[]): MoveResult {
  const from = tasks.findIndex((t) => t.ref === moved.ref)
  const to = tasks.findIndex((t) => t.ref === targetRef)
  if (from < 0 || to < 0 || from === to) {
    return { ok: false, verdict: 'allow', message: '', order: [...tasks] }
  }

  const order = [...tasks]
  const [m] = order.splice(from, 1)
  order.splice(to, 0, m)

  /**
   * ONLY WHAT THIS MOVE ACTUALLY BREAKS — nothing it merely fails to fix.
   *
   * Two mistakes were made here, and each one produced the same symptom: a warning that had nothing
   * to do with the row in the user's hand, and that said the same thing on every single drag.
   *
   * FIRST, it scanned the WHOLE order for the worst backwards edge anywhere in it. But a move is a
   * splice, and a splice preserves the relative order of every OTHER pair — so no edge between two
   * tasks he did not touch can possibly change. Only edges TOUCHING the moved task can.
   *
   * SECOND — and this is the one that survived the first fix — even among those, some are ALREADY
   * backwards before he picks anything up. The stored seq_no is not a valid build order on a real
   * project (a past hand-drag, an older generation, the rebuilt library), so a task can sit in front
   * of its own predecessor while nobody is dragging anything. Report that, and EVERY drag of that task
   * is refused for a fault that was there before he touched it — and that he cannot fix BY dragging,
   * because we refuse the drag.
   *
   * So the question is not "is this order perfect?" nor even "is this order broken near him?". It is:
   * WHAT DID THIS MOVE MAKE WORSE? We take the breaks that exist now, the breaks that would exist
   * after, and report only what is NEW.
   */
  interface Break { follower: DeskTask; pred: DeskTask; gate: TaskGate }
  const keyOf = (b: Break) => `${b.follower.ref}>${b.pred.ref}`

  /** The backwards edges touching `moved`, in a given order. */
  const breaksIn = (list: DeskTask[]): Break[] => {
    const at = new Map(list.map((t, i) => [t.ref, i]))
    const mi = at.get(moved.ref)
    if (mi === undefined) return []
    const out: Break[] = []

    // what the moved task waits FOR — a predecessor that ended up behind it
    for (const g of moved.afters) {
      const pi = at.get(g.ref)
      if (pi !== undefined && pi > mi) out.push({ follower: moved, pred: list[pi], gate: g })
    }
    // what waits FOR the moved task — did it end up behind something that needs it first?
    for (const t of list) {
      if (t.ref === moved.ref) continue
      const g = t.afters.find((x) => x.ref === moved.ref)
      if (g && at.get(t.ref)! < mi) out.push({ follower: t, pred: moved, gate: g })
    }
    return out
  }

  const already = new Set(breaksIn([...tasks]).map(keyOf))
  const fresh = breaksIn(order).filter((b) => !already.has(keyOf(b)))

  // the worst NEW break wins the line: one forbidden edge is not softened by an allowed one
  const worst = fresh.reduce<Break | null>(
    (w, b) => (!w || (SEVERITY[b.gate.nature] ?? 0) > (SEVERITY[w.gate.nature] ?? 0) ? b : w),
    null,
  )

  /**
   * WE CANNOT REFEREE WHAT WE CANNOT SEE. If the plan says this task waits on work that has no row on
   * this project, the drag has no basis to be judged on — and a green "Move it here" would be the same
   * lie in a different coat. It goes through (it is his site), but it is amber and it says why.
   */
  if (!worst && moved.unresolved?.length) {
    return {
      ok: true,
      verdict: 'warn',
      message: `Can’t check the order — ${moved.unresolved[0]} isn’t in this project’s task list`,
      order,
    }
  }

  if (!worst) {
    return { ok: true, verdict: 'allow', message: 'Move it here', order }
  }

  const verdict = VERDICT[worst.gate.nature] ?? 'warn'
  const { follower, pred, gate } = worst

  if (verdict === 'forbid') {
    return {
      ok: false,
      verdict,
      message: `${pred.title} has to be finished before ${follower.title} can start`,
      order: [...tasks],                                            // nothing moved
    }
  }
  if (verdict === 'allow_with_consequence') {
    return {
      ok: true,
      verdict,
      message: `${follower.title} here will damage the ${pred.title.toLowerCase()} — it will have to be redone`,
      order,
    }
  }
  // The only softer gate that reaches a row is curing time — concrete that has not set yet.
  return {
    ok: true,
    verdict,
    message: gate.reason === 'curing_time'
      ? `${pred.title} needs time to set before ${follower.title}`
      : `${pred.title} should really come before ${follower.title}`,
    order,
  }
}

export function deleteImpact(
  t: DeskTask,
  all: readonly DeskTask[],
  problems: readonly DeskProblem[],
): DeleteImpact {
  const qc = t.qc ?? []
  return {
    unblocks: all.filter((x) => x.ref !== t.ref && x.afters.some((g) => g.ref === t.ref)),
    qcCount: qc.length,
    qcCritical: qc.filter((c) => c.critical).length,
    orphans: problems.filter((p) => p.ref === t.blockedBy && p.state !== 'resolved'),
    suppressNode: t.nodeKey ?? null,
    siblingsKept: t.taskTypeId
      ? all.filter((x) => x.ref !== t.ref && x.taskTypeId === t.taskTypeId).length
      : 0,
  }
}
