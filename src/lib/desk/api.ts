// SITE DESK — THE SWAP POINT.
//
// Components import `useDeskApi()` and nothing else. Today it returns the mock; when the
// endpoints in docs/SITE_DESK_INTEGRATION_MAP.md land, `liveApi` replaces `mockApi` here and
// NOT ONE COMPONENT CHANGES. Every unimplemented call below carries a TODO naming the exact
// section of the map that will provide it — that list is also reproduced in
// docs/SITE_DESK_UI_PARITY.md as the mock-to-live swap list.
//
// Nothing in this file writes to Supabase yet: this pass is UI-only, zero backend contract
// changes, per the implementation brief.

import { useMemo, useState, useCallback } from 'react'
import type { DeskPending, DeskPlan, DeskProblem, DeskSite, DeskTask, Outcome, QcStatus } from './types'
import { MOCK_MEMBERS, MOCK_PENDING, MOCK_PLANS, MOCK_PROBLEMS, MOCK_SITES } from './mock'
import { closeItem, reopenItem, snapshot, applyUndo, type UndoSnapshot } from './derive'
import { checkMove, planRename, type RenameScope } from './edit'
import { withNewTask, type NewTask } from './add'
import { useLiveDeskApi } from './live'

/** What the edit sheet can change. Everything else about a task is either the engine's (where it
 *  lives, what it depends on) or already editable on the card (its state, its days, its owner). */
export interface TaskEdit {
  /** The new name. Omit to leave it alone. */
  name?: string
  /** 'type' renames every row of this task-type on the project — the default, because the engine
   *  gives every instance of a type the same name and renaming ONE of them splits the type in the
   *  resolver's candidate list. 'row' renames just this one, deliberately. */
  renameScope?: RenameScope
  /** The site's own note on what this task covers (site_tasks.description). Omit to leave alone. */
  desc?: string | null
}

export interface DeskApi {
  sites: DeskSite[]
  problems: DeskProblem[]
  pending: DeskPending[]
  planFor: (siteCode: string) => DeskPlan | null
  /** Non-null when the read failed. A blank desk with no explanation is worse than an error. */
  error: string | null
  loading: boolean

  /** Close an item. Returns the snapshot needed to undo it. THROWS if the write failed — the row
   *  must not animate away over a close the database refused. */
  close: (id: string, outcome: Outcome, note: string) => Promise<UndoSnapshot>
  undo: (snap: UndoSnapshot) => void
  reopen: (id: string) => Promise<void>
  addNote: (id: string, text: string) => Promise<void>

  /** A note on a TASK (site_task_comments) — the task's own trail, not a problem's. */
  addTaskNote: (taskRef: string, text: string) => Promise<void>
  /** Assign the person responsible: a task's owner, or the project's supervisor. */
  assignTask: (taskRef: string, userId: string | null) => Promise<void>
  assignSupervisor: (siteCode: string, userId: string | null) => Promise<void>
  /** Everyone who can be assigned — org members. */
  members: Array<{ id: string; name: string }>

  /** Owner-voice message. TODO(map §6 · POST /siteops-say) — ref-stamped, 24h-window aware. */
  say: (id: string, text: string) => Promise<void>
  /** TODO(map §6 · POST /siteops-nudge) — fire one item's chase now, not the org-wide sweep. */
  nudge: (id: string) => Promise<void>
  /** TODO(map §5 step 10 · X1 links) — approval-kind items notify the owner on approve. */
  approve: (id: string) => Promise<void>
  /** TODO(map §2 · siteops_unplaced) — place / dismiss a pending capture. */
  place: (id: string) => Promise<void>
  dismissPending: (id: string) => Promise<void>

  /** Task edits — the only three states a human sets by hand, plus duration. */
  patchTask: (siteCode: string, ref: string, f: (t: DeskTask) => DeskTask) => Promise<void>

  /** Rename a task, and/or say what it really covers. See edit.ts for what a rename touches — it is
   *  not a cosmetic act: the name IS what the WhatsApp resolver matches an inbound report against. */
  editTask: (siteCode: string, ref: string, patch: TaskEdit) => Promise<void>

  /** Delete a task, for good. The row goes AND its node_key is suppressed on the project — without
   *  the second half, reconcile() re-creates it on the next read. See deleteImpact() for what it
   *  costs; the confirmation is required to say so. */
  deleteTask: (siteCode: string, ref: string) => Promise<void>

  /** Add a task the engine could never have known about — a second coat, a hoarding, the neighbour's
   *  wall. It lands WITH the work it is part of (add.ts), not at the bottom of the site. */
  addTask: (siteCode: string, draft: NewTask) => Promise<void>

  /** Answer a quality check (site_task_qc). `confirmed` = seen and right; `failed` = seen and wrong. */
  answerQc: (qcId: string, status: QcStatus, answer: string | null) => Promise<void>

  /** Move `ref` into `targetRef`'s slot. Refereed by the engine's own ladder before anything is
   *  written (edit.ts · checkMove): an IMPOSSIBLE edge is refused with the reason, a DESTRUCTIVE one
   *  goes through with the damage named. The new order is persisted as seq_no + order_source='manual',
   *  which reconcile() never re-defaults.
   *  TODO(map §6 · POST /siteops-reorder) — the referee should ALSO run server-side, next to the write. */
  reorder: (siteCode: string, ref: string, targetRef: string) => Promise<{ ok: boolean; message: string }>

  /** FALSE when reordering cannot actually be persisted. A drag handle on a row that cannot be
   *  dragged is a lie the interface tells with its own hands — so the grip does not appear at all
   *  until the rules engine can referee the drop for real. */
  canReorder: boolean
}

/**
 * THE SWITCH.
 *
 * Live by default — Site Desk reads the real tables. `VITE_SITE_DESK_MOCK=1` forces the mock,
 * which is what the design review runs against (and what works with no org / no migrations).
 *
 * The mock is kept, not deleted: it is the only way to exercise the UI's full state space
 * (an escalated item, a photo-pending snag, an auto-close proposal) without manufacturing that
 * state in a real database.
 */
export function useDeskApi(ctx?: { orgId: string | null; userId: string | null }): DeskApi {
  const wantMock = import.meta.env.VITE_SITE_DESK_MOCK === '1' || !ctx?.orgId
  const live = useLiveDeskApi({ orgId: ctx?.orgId ?? '', userId: ctx?.userId ?? null })
  const mock = useMockDeskApi()
  return wantMock ? mock : live
}

/**
 * THE MOCK. State is in-memory and resets on reload.
 */
function useMockDeskApi(): DeskApi {
  const [problems, setProblems] = useState<DeskProblem[]>(MOCK_PROBLEMS)
  const [pending, setPending] = useState<DeskPending[]>(MOCK_PENDING)
  const [plans, setPlans] = useState<Record<string, DeskPlan>>(MOCK_PLANS)

  const patch = useCallback((id: string, f: (p: DeskProblem) => DeskProblem) => {
    setProblems((list) => list.map((p) => (p.id === id ? f(p) : p)))
  }, [])

  const close = useCallback(async (id: string, outcome: Outcome, note: string): Promise<UndoSnapshot> => {
    const before = problems.find((p) => p.id === id)!
    const snap = snapshot(before)
    patch(id, (p) => ({
      ...p,
      ...closeItem(outcome, note),
      story: [...p.story, { t: 'resolve', l: `Closed — ${outcome}`, w: 'just now' }],
    }))
    return snap
  }, [problems, patch])

  const undo = useCallback((snap: UndoSnapshot) => {
    patch(snap.id, (p) => applyUndo(p, snap))
  }, [patch])

  const reopen = useCallback(async (id: string) => { patch(id, reopenItem) }, [patch])

  const addNote = useCallback(async (id: string, text: string) => {
    patch(id, (p) => ({ ...p, story: [...p.story, { t: 'note', text, w: 'just now' }] }))
  }, [patch])

  /** One flat task list per plan now — the floor slice is derived, so a patch is a single map. */
  const patchTaskByRef = useCallback((ref: string, f: (t: DeskTask) => DeskTask) => {
    setPlans((all) => Object.fromEntries(Object.entries(all).map(([code, plan]) => [code, {
      ...plan,
      tasks: plan.tasks.map((t) => (t.ref === ref ? f(t) : t)),
    }])))
  }, [])

  const addTaskNote = useCallback(async (ref: string, text: string) => {
    patchTaskByRef(ref, (t) => ({ ...t, story: [...(t.story ?? []), { t: 'msg', from: 'You', text, w: 'just now' }] }))
  }, [patchTaskByRef])

  const assignTask = useCallback(async (ref: string, uid: string | null) => {
    patchTaskByRef(ref, (t) => ({ ...t, ownerId: uid, assignee: MOCK_MEMBERS.find((m) => m.id === uid)?.name ?? 'Unassigned' }))
  }, [patchTaskByRef])

  const assignSupervisor = useCallback(async () => { /* mock: no-op */ }, [])

  const say = useCallback(async (id: string, text: string) => {
    const short = text.length > 60 ? `${text.slice(0, 60)}…` : text
    patch(id, (p) => ({ ...p, story: [...p.story, { t: 'event', l: `You escalated on WhatsApp: “${short}”`, w: 'just now' }] }))
  }, [patch])

  const nudge = useCallback(async (id: string) => {
    patch(id, (p) => ({ ...p, story: [...p.story, { t: 'event', l: 'You asked Babai to follow up now', w: 'just now' }] }))
  }, [patch])

  const approve = useCallback(async (id: string) => {
    patch(id, (p) => ({
      ...p, state: 'moving', status: 'Approved · owner notified',
      story: [...p.story, { t: 'event', l: 'You approved it', w: 'just now' }],
    }))
  }, [patch])

  const place = useCallback(async (id: string) => { setPending((l) => l.filter((x) => x.id !== id)) }, [])
  const dismissPending = useCallback(async (id: string) => { setPending((l) => l.filter((x) => x.id !== id)) }, [])

  const patchTask = useCallback(async (_siteCode: string, ref: string, f: (t: DeskTask) => DeskTask) => {
    patchTaskByRef(ref, f)
  }, [patchTaskByRef])

  /** The mock runs the SAME rename rule as live (edit.ts) — so what the design review sees a rename
   *  do to the plan is what it will do to the database. */
  const editTask = useCallback(async (siteCode: string, ref: string, patch: TaskEdit) => {
    const plan = plans[siteCode]
    const t = plan?.tasks.find((x) => x.ref === ref)
    if (!t) throw new Error('Task not found')

    const rename = patch.name !== undefined ? planRename(t, patch.name, patch.renameScope ?? 'type', plan.tasks) : null
    const renamed = new Set(rename?.refs ?? [])

    setPlans((p) => ({
      ...p,
      [siteCode]: {
        ...plan,
        tasks: plan.tasks.map((x) => ({
          ...x,
          ...(rename && renamed.has(x.ref) ? { title: rename.name } : {}),
          ...(patch.desc !== undefined && x.ref === ref ? { desc: patch.desc } : {}),
        })),
      },
    }))
  }, [plans])

  /**
   * REORDER — refereed by the REAL rule, not a UI guess.
   *
   * The prototype mocked this as "every task must sit after its prerequisite". That rule already
   * exists for real, in the engine (`Evaluator.checkMove`, verdict: forbid | allow_with_consequence
   * | warn | suggest | allow). This mock enforces the same invariant over the mock's `after` edges,
   * and the message it returns is the ENGINE'S message, not a UI string — so when
   * POST /siteops-reorder lands, only the transport changes.
   */
  const reorder = useCallback(async (siteCode: string, ref: string, targetRef: string) => {
    const plan = plans[siteCode]
    if (!plan) return { ok: false, message: 'No plan for this site' }
    const moved = plan.tasks.find((t) => t.ref === ref)
    if (!moved) return { ok: false, message: 'Task not found' }

    // THE SAME REFEREE AS LIVE (edit.ts · checkMove), so what the design review can drag is exactly
    // what the database will accept. The mock does not get its own, kinder rules.
    const r = checkMove(moved, targetRef, plan.tasks)
    if (r.ok) setPlans((p) => ({ ...p, [siteCode]: { ...plan, tasks: r.order } }))
    return { ok: r.ok, message: r.message }
  }, [plans])

  return useMemo(() => ({
    sites: MOCK_SITES,
    problems,
    pending,
    planFor: (code: string) => plans[code] ?? null,
    error: null, loading: false,
    members: MOCK_MEMBERS,
    canReorder: true,                 // the mock's own rules engine referees, so the drag is real
    addTaskNote, assignTask, assignSupervisor,
    answerQc: async (qcId, status) => {
      setPlans((all) => Object.fromEntries(Object.entries(all).map(([code, plan]) => [code, {
        ...plan,
        tasks: plan.tasks.map((t) => (t.qc?.some((c) => c.id === qcId)
          ? { ...t, qc: t.qc.map((c) => (c.id === qcId ? { ...c, status } : c)) }
          : t)),
      }])))
    },
    deleteTask: async (siteCode: string, ref: string) => {
      setPlans((p) => {
        const plan = p[siteCode]
        if (!plan) return p
        return {
          ...p,
          [siteCode]: {
            ...plan,
            // the row goes, AND every edge into it — the engine drops a node and its edges together,
            // so whatever was waiting on it is now free. The mock must not lie about that.
            tasks: plan.tasks
              .filter((t) => t.ref !== ref)
              .map((t) => (t.afters.some((g) => g.ref === ref)
                ? { ...t, afters: t.afters.filter((g) => g.ref !== ref) }
                : t)),
          },
        }
      })
    },
    addTask: async (siteCode: string, draft: NewTask) => {
      setPlans((p) => {
        const plan = p[siteCode]
        if (!plan) return p
        // the SAME placement rule as live (add.ts) — the review sees where it will really land
        const row: DeskTask = {
          ref: `NEW-${plan.tasks.length + 1}`, title: draft.name.trim(), group: draft.group,
          trade: draft.trade ?? draft.group, state: 'todo', afters: [], assignee: 'Unassigned',
          dur: `${draft.durationDays ?? 1}d`, floor: draft.floor, unit: draft.unit, manual: true,
        }
        return { ...p, [siteCode]: { ...plan, tasks: withNewTask(plan.tasks, draft, row) as DeskTask[] } }
      })
    },
    close, undo, reopen, addNote, say, nudge, approve, place, dismissPending, patchTask, editTask, reorder,
  }), [problems, pending, plans, close, undo, reopen, addNote, addTaskNote, assignTask, assignSupervisor, say, nudge, approve, place, dismissPending, patchTask, editTask, reorder])
}
