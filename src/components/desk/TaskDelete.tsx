// SITE DESK — DELETING A TASK, WITH THE CONSEQUENCES ON THE SCREEN.
//
// "Are you sure? This cannot be undone." tells him nothing he did not already know, and so it trains
// him to click through it. This dialog says what will ACTUALLY happen — computed, per task, by
// deleteImpact() — and every line of it is a fact about this row, not boilerplate:
//
//   · the work that was waiting on it becomes startable (removing a node removes its edges, so the
//     wiring stops waiting for a slab that is not being poured). This is the one nobody predicts.
//   · its quality checks die with it — and the CRITICAL one is the whole reason a photo gets taken
//     before the work is covered up.
//   · an issue somebody raised over WhatsApp about it survives, but loses the task it was about.
//   · it will not come back: the node_key is suppressed on THIS project, so reconcile() stops
//     re-creating it — and the same work on every other floor is untouched.
//
// If none of that applies (a hand-typed task nobody has touched), the dialog is two lines long. The
// warning is as heavy as the act, and no heavier.

import type { DeskProblem, DeskTask } from '../../lib/desk/types'
import { deleteImpact } from '../../lib/desk/edit'

export function TaskDelete({
  task: t, allTasks, problems, onDelete, onClose,
}: {
  task: DeskTask
  allTasks: DeskTask[]
  problems: DeskProblem[]
  onDelete: () => Promise<void>
  onClose: () => void
}) {
  const i = deleteImpact(t, allTasks, problems)

  return (
    <div className="td-scrim" onClick={onClose} role="presentation">
      <div className="td" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={`Delete ${t.ref}`}>
        <h3 className="td-title">Delete “{t.title}”?</h3>
        <p className="td-sub">
          {t.ref}{[t.floor, t.unit].filter(Boolean).length ? ` · ${[t.floor, t.unit].filter(Boolean).join(' · ')}` : ''}
          {' — the task will be deleted from this project.'}
        </p>

        <ul className="td-list">
          {i.unblocks.length > 0 && (
            <li className="warn">
              <b>{i.unblocks.length} task{i.unblocks.length > 1 ? 's' : ''} will no longer wait for it</b> and can be
              started right away — {i.unblocks.slice(0, 3).map((x) => x.title).join(', ')}
              {i.unblocks.length > 3 ? ` and ${i.unblocks.length - 3} more` : ''}.
            </li>
          )}
          {i.qcCount > 0 && (
            <li className={i.qcCritical > 0 ? 'warn' : ''}>
              <b>Its {i.qcCount} quality check{i.qcCount > 1 ? 's' : ''} are deleted too</b>
              {i.qcCritical > 0
                ? <> — including {i.qcCritical > 1 ? `${i.qcCritical} important ones` : 'an important one'} that can only be checked before the work is covered up.</>
                : '.'}
            </li>
          )}
          {i.orphans.length > 0 && (
            <li className="warn">
              <b>{i.orphans.length} open issue{i.orphans.length > 1 ? 's' : ''}</b> ({i.orphans.map((p) => p.ref).join(', ')})
              {i.orphans.length > 1 ? ' were' : ' was'} raised about this task. {i.orphans.length > 1 ? 'They' : 'It'} will
              stay open, but will no longer point at any task.
            </li>
          )}
          {i.suppressNode
            ? (
              <li>
                It will not come back — <b>this project will stop creating it</b>
                {i.siblingsKept > 0 && <>. The same work in {i.siblingsKept} other place{i.siblingsKept > 1 ? 's' : ''} is not touched</>}.
              </li>
            )
            : <li>This task was added by hand, so nothing will bring it back.</li>}
        </ul>

        <div className="td-bar">
          <button className="td-ghost" onClick={onClose}>Keep it</button>
          <button className="td-go" onClick={() => { void onDelete(); onClose() }}>Delete task</button>
        </div>
      </div>
    </div>
  )
}
