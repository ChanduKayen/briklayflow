// SITE DESK — MOVE A TASK, WITHOUT A MOUSE.
//
// This is the drag, for fingers. It exists because the grip does not: `canDrag` requires a pointer
// (`!isTouch`), and on a phone — which is where a site manager actually is — there was no way to
// reorder anything at all. An affordance that only works at a desk is not an affordance for a man
// standing on the fourth floor.
//
// It is NOT a second, kinder path to the same write. Every target runs through the same referee the
// drag does (edit.ts · checkMove), and the difference is only that a picker can afford to say the
// answer BEFORE you commit: the places this task cannot go are shown, disabled, with the reason on
// them. A drag has to be attempted to be refused; a list can simply be honest up front.

import type { DeskTask } from '../../lib/desk/types'
import { checkMove } from '../../lib/desk/edit'

export function TaskMove({
  task: t, tasks, offer, onMove, onClose,
}: {
  task: DeskTask
  /**
   * THE WHOLE SEQUENCE, and it must be the whole one. The referee ignores a gate whose task is not in
   * the list it was given ("a predecessor that is not in this plan cannot forbid anything") — which is
   * right for a deleted task and catastrophic for a truncated list. Hand it the floor's rows only and
   * every cross-floor gate silently evaporates: the slab is on the floor below, so wiring could be
   * dragged above it and the desk would call it buildable.
   */
  tasks: DeskTask[]
  /** What to OFFER as destinations — the floor he is looking at. Judged against `tasks`, all of them. */
  offer: DeskTask[]
  onMove: (targetRef: string) => Promise<void>
  onClose: () => void
}) {
  const targets = offer
    .filter((x) => x.ref !== t.ref)
    .map((x) => ({ task: x, move: checkMove(t, x.ref, tasks) }))

  return (
    <div className="tm-scrim" onClick={onClose} role="presentation">
      <div className="tm" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Move ${t.ref}`}>
        <h3 className="tm-title">Move “{t.title}”</h3>
        <p className="tm-sub">Put it in front of:</p>

        <div className="tm-list">
          {targets.map(({ task: x, move }) => {
            const blocked = move.verdict === 'forbid'
            const costly = move.verdict === 'allow_with_consequence' || move.verdict === 'warn'
            return (
              <button
                key={x.ref}
                className={`tm-opt ${blocked ? 'no' : ''} ${costly ? 'cost' : ''}`}
                disabled={blocked}
                onClick={() => { void onMove(x.ref); onClose() }}
              >
                <span className="tm-name">{x.title}</span>
                <span className="tm-why">{blocked || costly ? move.message : x.ref}</span>
              </button>
            )
          })}
        </div>

        <div className="tm-bar">
          <button className="tm-ghost" onClick={onClose}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
