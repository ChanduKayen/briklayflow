// SITE DESK — the Work Plan: TaskGroups, TaskRow.
//
// The floors, the flats and the supervisor used to live here too. They moved: the floors and flats
// into the Building rail (Building.tsx), the supervisor into the header (Chrome.tsx).
//
// THE TOPOLOGICAL ORDER *IS* THE PAGE. One status vocabulary, all of it derived except the
// three states a human sets by hand (Not started / In progress / Done):
//     Done ✓ · In progress · Ready (up next) · After {task} · Blocked by {ref}
// "Blocked" is never hand-set — it exists only while an open problem links here.

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { DeskProblem, DeskTask } from '../../lib/desk/types'
import { taskStatus, groupIsFoldable, upNextRefs } from '../../lib/desk/derive'
import { checkMove, type MoveVerdict } from '../../lib/desk/edit'
import { qcAlarm } from '../../lib/desk/fromDb'
import { Medallion } from './Medallion'
import { taskTone } from '../../lib/desk/medTone'

export interface Group { n: string; note: string }

/**
 * THE ANSWER TRAVELS WITH THE HAND.
 *
 * The verdict used to arrive as a toast at the bottom of the screen, AFTER the drop — which is the
 * wrong place and the wrong time twice over. Wrong place: his eyes are on the row he is holding, four
 * hundred pixels away. Wrong time: he has already committed, and is being told off for it.
 *
 * So the judgment rides on the drag itself. As the row passes over a slot, that slot answers — in
 * green if the work can go there, in amber if it can but it costs something, in red if it cannot,
 * with the reason ON the row. An impossible drop is refused at the browser level (dropEffect='none'),
 * so the gesture cannot even be completed: you feel the "no" in your hand, before you let go.
 */
const DROP_TONE: Record<MoveVerdict, 'ok' | 'cost' | 'no'> = {
  allow: 'ok', suggest: 'ok', warn: 'cost', allow_with_consequence: 'cost', forbid: 'no',
}

interface DropHint { ref: string; tone: 'ok' | 'cost' | 'no'; message: string }

/**
 * THE SHUFFLE — FLIP (First · Last · Invert · Play).
 *
 * A reorder that simply repaints is a reorder nobody can follow: the list blinks and two rows have
 * swapped, and you are left checking whether the thing you meant to move is where you meant to put
 * it. So the rows TRAVEL. We measure every row before the change (First), let React repaint (Last),
 * work out how far each row jumped (Invert), park it back where it started with a transform, and
 * release them all on the next frame (Play). The browser interpolates, so what you see is the
 * sequence rearranging itself — every row that got out of the way, visibly getting out of the way.
 *
 * This is the same technique the good editors use for exactly this, and it is worth the twenty lines:
 * the animation is not decoration, it is the explanation of what just happened.
 */
function useShuffle(order: string): (ref: string) => (el: HTMLDivElement | null) => void {
  const rows = useRef(new Map<string, HTMLDivElement>())
  const prev = useRef(new Map<string, number>())

  useLayoutEffect(() => {
    const moved: Array<[HTMLDivElement, number]> = []
    for (const [ref, el] of rows.current) {
      const top = el.getBoundingClientRect().top
      const was = prev.current.get(ref)
      if (was !== undefined && Math.abs(was - top) > 0.5) moved.push([el, was - top])
      prev.current.set(ref, top)
    }
    if (!moved.length) return

    for (const [el, dy] of moved) {
      el.style.transition = 'none'
      el.style.transform = `translateY(${dy}px)`
      el.classList.add('shuffling')
    }
    // Two frames: one to let the browser accept the parked position as the starting point, one to
    // release it. Skip the first and it optimises the whole thing away and nothing animates at all.
    requestAnimationFrame(() => requestAnimationFrame(() => {
      for (const [el] of moved) {
        el.style.transition = ''
        el.style.transform = ''
      }
      window.setTimeout(() => { for (const [el] of moved) el.classList.remove('shuffling') }, 420)
    }))
  }, [order])

  return (ref: string) => (el: HTMLDivElement | null) => {
    if (el) rows.current.set(ref, el)
    else { rows.current.delete(ref); prev.current.delete(ref) }
  }
}

/* ---------- TaskGroups ---------- */
export function TaskGroups({
  tasks, groups, problems, allTasks, draggable, isTouch, openRef, folded, onFold,
  onOpen, onRef, onDrop, onDelete, onMove, onAdd,
}: {
  tasks: DeskTask[]
  groups: Group[]
  problems: DeskProblem[]
  allTasks: DeskTask[]
  draggable: boolean
  isTouch: boolean
  openRef: string | null
  folded: Record<string, boolean>
  onFold: (g: string) => void
  onOpen: (ref: string) => void
  onRef: (ref: string) => void
  onDrop: (from: string, to: string) => void
  /** Delete this task — the ⋯ menu. Undefined hides the menu entirely (no write path). */
  onDelete?: (ref: string) => void
  /** Move it — the drag, for fingers. */
  onMove?: (ref: string) => void
  /** Add a task to THIS section — the "+" on the section header. */
  onAdd?: (section: string) => void
}) {
  const byRef = (r: string) => allTasks.find((t) => t.ref === r)

  // WHAT TO START, PER GROUP. Decided in derive.ts, over the whole floor at once, and resolved
  // against ALL the site's tasks — a predecessor is very often on the floor below, and a lookup
  // scoped to this floor would not find it and would call the work startable.
  const upNext = upNextRefs(tasks, problems, byRef)

  // The rows travel when the order changes. Keyed on the order itself, so it fires on a reorder and
  // on nothing else — not on a status change, not on a re-render.
  const rowRef = useShuffle(tasks.map((t) => t.ref).join('|'))

  const [dragRef, setDragRef] = useState<string | null>(null)
  const [hint, setHint] = useState<DropHint | null>(null)

  /**
   * The verdict for THIS slot, decided as the row passes over it. Judged against every task on the
   * site (`allTasks`), never the floor's slice: the referee ignores a gate whose task it cannot see,
   * and the slab is very often on the floor below. Judge against the visible rows only and the desk
   * would cheerfully let you drag the wiring above a slab it simply had not been shown.
   */
  const hintFor = (targetRef: string): DropHint | null => {
    if (!dragRef || dragRef === targetRef) return null
    const moved = byRef(dragRef)
    if (!moved) return null
    const r = checkMove(moved, targetRef, allTasks)
    return { ref: targetRef, tone: DROP_TONE[r.verdict], message: r.message }
  }

  /**
   * FOLDING IS FOR HIDING WHAT IS NOT THE POINT — NOT FOR EMPTYING THE SCREEN.
   *
   * A group folds when nothing in it can start yet, so the eye goes to the work that CAN move.
   * But on an upper floor NOTHING can start (it all waits on the floor below), so every group
   * folded and the floor rendered as a row of headers — indistinguishable from a floor whose tasks
   * were never generated. That is what "blockwork isn't generated for some floors" actually was:
   * the tasks are all there, the engine emits them per floor (instantiate.ts), and we hid them.
   *
   * So: fold only when there is something ELSE on this floor worth looking at instead.
   */
  const anythingStartable = tasks.some((t) => {
    if (t.state === 'done') return false
    const c = taskStatus(t, problems, byRef).cls
    return c === 'ready' || c === 'live'
  })

  return (
    <>
      {groups.map((g) => {
        const gtasks = tasks.filter((t) => t.group === g.n)
        if (!gtasks.length) return null
        const done = gtasks.filter((t) => t.state === 'done')
        const pending = gtasks.filter((t) => t.state !== 'done')
        const isFolded = anythingStartable && groupIsFoldable(gtasks, problems, byRef) && !folded[g.n]

        return (
          <div key={g.n}>
            <div className="group-label">
              <span>{g.n}{g.note && <em> · {g.note}</em>}</span>
              {isFolded && (
                <button className="fold-btn" onClick={() => onFold(g.n)}>
                  {/* the prototype said "1 tasks"; a plural bug is a defect, not a design */}
                  Show {pending.length} {pending.length === 1 ? 'task' : 'tasks'} <span className="fold-caret">›</span>
                </button>
              )}
              {/* ADD IT WHERE IT BELONGS. The "+" sits on the section, so the job he is thinking of
                  arrives IN that section, on this floor, in this flat — and he never has to tell the
                  form any of that, because he already told it by where he pressed. */}
              {onAdd && !isFolded && (
                <button
                  className="group-add" onClick={() => onAdd(g.n)}
                  title={`Add a task to ${g.n}`} aria-label={`Add a task to ${g.n}`}
                >
                  +
                </button>
              )}
            </div>

            {/* THE SPINE hangs off this wrapper — a 1px line down the medallion column. In the
                Work Plan it is not a metaphor: these tasks ARE a sequence, so the line is the
                dependency chain, drawn. (Problems get no wrapper, and therefore no spine.) */}
            <div className="task-group">
            {/* Done stays in place, muted — the sequence reads as one story, not two lists. */}
            {done.map((t) => (
              <TaskRow
                key={t.ref} task={t} problems={problems} byRef={byRef}
                draggable={false} isTouch={isTouch} selected={t.ref === openRef} isNext={false}
                onOpen={onOpen} onRef={onRef} onDrop={onDrop} onDelete={onDelete} onMove={onMove}
                rowRef={rowRef(t.ref)} dragging={dragRef === t.ref}
                hint={hint?.ref === t.ref ? hint : null}
                onDragRef={setDragRef} onHint={setHint} hintFor={hintFor}
              />
            ))}

            {!isFolded && pending.map((t) => (
              <TaskRow
                key={t.ref} task={t} problems={problems} byRef={byRef}
                draggable={draggable} isTouch={isTouch} selected={t.ref === openRef} isNext={upNext.has(t.ref)}
                onOpen={onOpen} onRef={onRef} onDrop={onDrop} onDelete={onDelete} onMove={onMove}
                rowRef={rowRef(t.ref)} dragging={dragRef === t.ref}
                hint={hint?.ref === t.ref ? hint : null}
                onDragRef={setDragRef} onHint={setHint} hintFor={hintFor}
              />
            ))}
            </div>
          </div>
        )
      })}
    </>
  )
}

function TaskRow({
  task: t, problems, byRef, draggable, isTouch, selected, isNext, onOpen, onRef, onDrop, onDelete, onMove,
  rowRef, dragging, hint, onDragRef, onHint, hintFor,
}: {
  task: DeskTask
  problems: DeskProblem[]
  byRef: (r: string) => DeskTask | undefined
  draggable: boolean
  isTouch: boolean
  selected: boolean
  isNext: boolean
  onOpen: (ref: string) => void
  onRef: (ref: string) => void
  onDrop: (from: string, to: string) => void
  onDelete?: (ref: string) => void
  /** Move it — the drag, for fingers. */
  onMove?: (ref: string) => void
  rowRef: (el: HTMLDivElement | null) => void
  dragging: boolean
  hint: DropHint | null
  onDragRef: (ref: string | null) => void
  onHint: (h: DropHint | null) => void
  hintFor: (targetRef: string) => DropHint | null
}) {
  const st = taskStatus(t, problems, byRef)
  const canDrag = draggable && !isTouch && t.state !== 'done'
  const alarm = qcAlarm(t)
  const [menu, setMenu] = useState(false)

  /**
   * THE TICK IS DRAWN, AND ONLY WHEN IT IS EARNED.
   *
   * The check used to simply appear — and its draw animation was dead anyway (the path had the
   * animation but no stroke-dasharray, so there was nothing to draw). Now the ring settles and the
   * check strokes itself in, once, at the moment the work is finished.
   *
   * On the TRANSITION, never on mount. Otherwise every finished task on the floor would tick itself
   * again on every page load — forty little celebrations for work that was done last month, which is
   * noise pretending to be delight.
   */
  const [justDone, setJustDone] = useState(false)
  const wasDone = useRef<boolean | null>(null)
  useEffect(() => {
    const isDone = t.state === 'done'
    const became = wasDone.current === false && isDone
    wasDone.current = isDone
    if (!became) return
    setJustDone(true)
    const id = window.setTimeout(() => setJustDone(false), 800)
    return () => window.clearTimeout(id)
  }, [t.state])

  /**
   * THE ROW SAYS ONLY WHAT THE DOT AND THE SUBTEXT CANNOT — AND "AFTER X" IS NOT ONE OF THEM.
   *
   * A row can tell him exactly three useful things: I can start this now · something is broken and
   * stopping it · it is running, and here is where it is at. "After External — façade plaster" is
   * none of those. It is the DEFAULT state of nearly every future task — the sequence quietly doing
   * its job — and printing the default on forty rows is precisely how a list turns into noise. The
   * dependency is the SYSTEM's business; it becomes his business only when he opens the task and
   * asks "why can't I start this?", and the detail sheet answers him there.
   *
   * The empty ring already says "not started". A silent row is the honest one.
   */
  const planned = parseInt(t.dur, 10) || 1
  const over = t.started ? t.started - planned : 0

  const rightText =
    st.cls === 'live'
      // PLANNED vs RUNNING. A task on day 6 of a 4-day job is not "day 6 of 4" — it is two days
      // over, and that is the whole point of saying anything at all.
      ? (t.started ? (over > 0 ? `day ${t.started} · ${over}d over` : `day ${t.started}/${planned}`) : 'running')
      : st.cls === 'done'
        ? (t.doneW ?? 'done')
        : t.dur                                    // not started: how long the work takes

  return (
    <div
      ref={rowRef}
      className={[
        'row',
        canDrag ? 'draggable' : '',
        selected ? 'sel' : '',
        t.state === 'done' ? 'rowdone' : '',
        onDelete || onMove ? 'has-menu' : '',
        dragging ? 'dragging' : '',
        hint ? `drop-${hint.tone}` : '',
      ].filter(Boolean).join(' ')}
      data-ref={t.ref}
      draggable={canDrag}
      onDragStart={(e) => {
        e.dataTransfer.effectAllowed = 'move'
        e.dataTransfer.setData('text/plain', t.ref)
        onDragRef(t.ref)
      }}
      onDragEnd={() => { onDragRef(null); onHint(null) }}
      onDragOver={(e) => {
        const h = hintFor(t.ref)
        if (!h) return
        // THE REFUSAL IS FELT, NOT READ. A drop that cannot happen is denied by the browser itself —
        // the cursor turns to "no entry" and the gesture will not complete. He does not drop it and
        // then get told; he cannot drop it, and can see why.
        e.dataTransfer.dropEffect = h.tone === 'no' ? 'none' : 'move'
        e.preventDefault()
        if (hint?.message !== h.message) onHint(h)
      }}
      onDragLeave={() => { if (hint) onHint(null) }}
      onDrop={(e) => {
        e.preventDefault()
        const from = e.dataTransfer.getData('text/plain')
        const h = hintFor(t.ref)
        onHint(null)
        onDragRef(null)
        if (from && from !== t.ref && h?.tone !== 'no') onDrop(from, t.ref)
      }}
      onClick={() => onOpen(t.ref)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(t.ref) }}
    >
      {/* THE VERDICT, ON THE SLOT HE IS HOLDING THE WORK OVER. Not a toast at the bottom of the
          screen, four hundred pixels from where he is looking, arriving after he has committed. */}
      {hint && (
        <span className={`drop-say ${hint.tone}`} role="status">
          <span className="drop-ico" aria-hidden="true">
            {hint.tone === 'no' ? '✕' : hint.tone === 'cost' ? '!' : '↳'}
          </span>
          {hint.message}
        </span>
      )}

      {/* THE MEDALLION BECOMES THE GRIP. The Ledger's move exactly — there, the direction disc turns
          into a checkbox on hover, so selecting adds no new element and nothing shifts. Here it turns
          into the drag handle: the row grows no extra furniture, and the thing you reach for is the
          thing that was already there. */}
      <span className={`r-med ${canDrag ? 'grippable' : ''} ${justDone ? 'just-done' : ''}`}>
        <Medallion tone={taskTone(t.state, st.cls === 'blocked')} />
        {canDrag && <span className="grip" aria-hidden="true">⠿</span>}
      </span>

      {/* THE TASK IS THE HEADER. Ref, trade and assignee are the subtext, on one line. */}
      <div className="row-body">
        <div className="headline">
          {t.title}
          {isNext && <span className="upnext">Up next</span>}
        </div>
        <div className="meta">
          <span className="ref">{t.ref}</span>
          {' · '}
          {[t.trade, t.assignee].filter(Boolean).join(' · ')}
          {/* The QC alarm rides the subtext — no column of its own, and only when it is actionable. */}
          {alarm === 'failed' && <span className="qc-chip bad">Check failed</span>}
          {alarm === 'last_chance' && <span className="qc-chip warn">Check open</span>}
          {/* We cannot see the work this one waits for. Better a visible question than a confident
              lie — this is the row that used to say "Ready" over a slab nobody had poured. */}
          {st.cls === 'unknown' && <span className="qc-chip warn">Can’t confirm</span>}
        </div>
      </div>

      {/* The status gets the column. The QC alarm rides IN it as a chip — only when it is
          actionable (failed, or a critical check open on live work), never on every finished row. */}
      {/* ONE FACT, right-aligned. Where this task stands, as a number:
       *   running → the day it is on, and whether it has run past its plan
       *   done    → the date it finished
       *   blocked → the blocking ref, because that is the ONE thing you cannot infer from the dot
       *   waiting → how long it takes, so he can see the shape of the work ahead
       * There is no status column any more. The sentence is a reading matter; this is a glance. */}
      <div className="r-right">
        {st.cls === 'blocked'
          ? <button className="blocked-ref" onClick={(e) => { e.stopPropagation(); onRef(st.ref) }}>{st.ref}</button>
          : (
            <span className={`age ${over > 0 ? 'over' : ''} ${st.cls === 'live' ? 'live' : ''}`}>
              {rightText}
            </span>
          )}
      </div>

      {/* THE ⋯ CARRIES ONLY WHAT IS NOT AN EDIT.
          Renaming a task and saying what it covers happen IN the card — open it and they are there,
          in place, with the sequence still visible behind them. What is left for a menu is the two
          acts that are not edits at all: taking the task out of the plan, and moving it. */}
      {(onDelete || onMove) && (
        <div className="r-menu" onClick={(e) => e.stopPropagation()} role="presentation">
          <button
            className={`r-dots ${menu ? 'on' : ''}`}
            aria-label={`More actions for ${t.ref}`} aria-expanded={menu}
            onClick={() => setMenu((m) => !m)}
          >
            ⋯
          </button>
          {menu && (
            <>
              {/* Click anywhere and the menu goes. No document listener, no leak, no stale handler. */}
              <div className="r-menu-out" onClick={() => setMenu(false)} role="presentation" />
              <div className="r-menu-pop" role="menu">
                {/* THE DRAG, FOR FINGERS. The grip needs a pointer (canDrag requires !isTouch), so on a
                    phone — where a site manager actually is — there was no way to reorder at all. */}
                {onMove && (
                  <button role="menuitem" onClick={() => { setMenu(false); onMove(t.ref) }}>
                    Move<span className="r-menu-sub">put it in front of another task</span>
                  </button>
                )}
                {onDelete && (
                  <button role="menuitem" className="danger" onClick={() => { setMenu(false); onDelete(t.ref) }}>
                    Delete<span className="r-menu-sub">the task will be deleted from this project</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
