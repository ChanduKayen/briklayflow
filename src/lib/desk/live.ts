// SITE DESK — THE LIVE ADAPTER. Same DeskApi the mock satisfies; real rows underneath.
//
// Reads follow the portal's existing convention exactly: supabase-js called directly, wrapped in
// react-query, org-scoped by hand with `.eq('org_id', orgId)` on every call (there is no helper
// that injects it, and inventing one here would be a second convention).
//
// WHAT IS HONEST AND WHAT IS NOT. Three actions in the design need edge functions that do not
// exist yet (docs/SITE_DESK_INTEGRATION_MAP.md §6): the owner-voice composer, the per-item
// "ask again now", and approve-notifies-the-owner. Rather than fake them — a toast saying "Sent
// on WhatsApp" when nothing was sent is the worst thing this product could do — they report
// `unsupported`, and the UI says so plainly. `nudge` is the one we CAN do truthfully today:
// bringing the chase clock forward is a real thing the daily cron will act on.

import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../supabase'
import type { DeskApi, TaskEdit } from './api'
import { checkMove, planRename } from './edit'
import { withNewTask, type NewTask } from './add'
import { gatesByTask } from './gates'
import { notifyAssignment } from '../siteOps/followup'
import { withTaskNoRetry } from '../siteOps/taskInsert'
import { GEOMETRY_COLUMNS, type ProjectRow as EngineProjectRow } from '../siteOps/engine'
import type { DeskPending, DeskPlan, DeskProblem, DeskSite, DeskTask, Outcome, QcStatus } from './types'
import {
  toDeskProblem, toDeskTask, blockersByTask, toQcChecks, outcomeKey, daysBetween, narrationIdsOf,
  type AttachmentRow, type EventRow, type NarrationRow, type ProblemRow, type QcRow, type ResolutionRow,
  type TaskCommentRow, type TaskRow,
} from './fromDb'

/** The project, plus the geometry the engine needs to know what waits for what (GEOMETRY_COLUMNS). */
interface ProjectRow extends EngineProjectRow {
  project_id: string
  name: string
  project_code: string | null
  project_type: string | null
  supervisor_id: string | null
  // NOTE: task_synonyms is deliberately NOT selected here — see editTask(). It is read just in time,
  // so an org that has not run 20260714000000 can still open the desk.
}

type SignedAttachment = AttachmentRow & { bucket: string; object_path: string; url: string | null }

/**
 * THE DESK IS TWO LOADS, NOT ONE — so the Problems tab paints without waiting for the Work Plan.
 *
 * The old single query fetched EVERYTHING before anything rendered: every problem AND every one of a
 * real org's ~1,530 tasks + ~4,584 QC rows + their comments/narrations/photos. But the default view is
 * the Problems tab, which shows NONE of that task payload — it waited on 6,000+ rows it never displays.
 * That is the whole reason it felt slow next to the Transactions page, which pages in only what it shows.
 *
 *   CORE  — what the Problems list + Pending + site cards need: projects, problems, members, phones, and
 *           each problem's events/photos/resolutions. Small, and it paints first.
 *   PLAN  — the Work Plan's heavy payload: tasks, QC, comments, task narrations, task photos. Loaded
 *           AFTER core (gated on core success), so it never stands between you and the Problems list.
 *
 * Each is its own react-query key, so an optimistic edit patches the right one and neither refetch drags
 * the other. Every field is still exactly what an optimistic edit patches.
 */
interface DeskCoreData {
  projects: ProjectRow[]
  problems: ProblemRow[]
  unplaced: Array<Record<string, unknown>>
  members: Array<{ id: string; name: string | null }>
  events: EventRow[]
  atts: SignedAttachment[]
  resolutions: ResolutionRow[]
  phones: Array<{ user_id: string | null; phone_number: string }>
}
interface DeskPlanData {
  tasks: Array<TaskRow & { project_id?: string }>
  qc: QcRow[]
  comments: TaskCommentRow[]
  /** The raw WhatsApp messages a task's status_history points at — his actual words. */
  narrations: NarrationRow[]
  /** Photos the webhook attached to a TASK (attachments.parent_type='site_task'). */
  taskAtts: SignedAttachment[]
}
import { planFloors, snapshot, closeItem, type UndoSnapshot } from './derive'

const PROBLEM_COLS =
  'id, ref, kind, title, status, cause, confidence, project_id, task_id, owner_id, owner_source, floor_label, unit_label, area_label, next_followup_at, deadline, created_at, updated_at'
// owner_source landed in 20260626000004; on an org that hasn't applied it, naming it 42703s the whole
// problems read and blanks the desk. So degrade to the columns that predate it — the assignee-reason
// subtext just falls back to a safe default. (RICH/BASE, the portal's own hand-applied-migration idiom.)
const PROBLEM_COLS_BASE =
  'id, ref, kind, title, status, cause, confidence, project_id, task_id, owner_id, floor_label, unit_label, area_label, next_followup_at, deadline, created_at, updated_at'
const TASK_COLS =
  'task_id, ref, project_id, name, description, source, phase, trade, status, floor_label, unit_label, seq_no, duration_days, started_at, owner_id, node_key, task_type_id, binding, status_history, updated_at'

interface Ctx { orgId: string; userId: string | null }

/**
 * PAGE EVERYTHING. PostgREST caps a response at 1,000 rows.
 *
 * This bit us exactly as designed to: a real org has 1,530 site_tasks and 4,584 site_task_qc rows,
 * so a plain `.select()` silently returned the first 1,000 of each — a third of the tasks, and QC
 * for a fraction of those. Nothing errored. The task you opened just had no checks, because its
 * checks were in the 3,584 rows the server never sent.
 *
 * A truncated read is worse than a failed one: it looks like an answer. So no query in this file
 * is allowed to be a bare select — they all come through here, and a short page is the ONLY way
 * this loop ends.
 */
const PAGE = 1000

async function fetchAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await build(from, from + PAGE - 1)
    if (error) return { data: out, error }
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return { data: out, error: null }   // a short page = the end
  }
}

/**
 * A `.in(col, ids)` WITH A LIST THAT WILL NOT FIT IN A URL.
 *
 * PostgREST takes its filters in the query string, so `.in('parent_id', everyTaskInTheOrg)` becomes a
 * GET with ~1,500 uuids in it — roughly 55 KB of URL — and the proxy in front of the database rejects
 * it with a bare **400 Bad Request**, before Postgres ever sees it. The desk then says "Could not load
 * the desk: Bad Request" and shows nothing at all, which is how a read that is merely too long looks
 * exactly like a read that is broken.
 *
 * The engine already paid for this once (persist.fanOutQc: "several hundred uuids in a GET query
 * string, a URL long enough to be rejected in front of the database"). So: chunk the list, page each
 * chunk through fetchAll, concatenate. 80 uuids ≈ 3 KB of query — comfortably inside every limit.
 *
 * Prefer NOT needing this: if the rows are org-scoped, filter by org and let RLS do the work. Reach for
 * it only when the id list is genuinely the filter.
 */
const IN_CHUNK = 80

async function fetchIn<T>(
  ids: string[],
  build: (chunk: string[], from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>,
): Promise<{ data: T[]; error: { message: string } | null }> {
  if (!ids.length) return { data: [], error: null }
  const chunks: string[][] = []
  for (let i = 0; i < ids.length; i += IN_CHUNK) chunks.push(ids.slice(i, i + IN_CHUNK))
  const results = await Promise.all(
    chunks.map((c) => fetchAll<T>((f, t) => build(c, f, t))),
  )
  const bad = results.find((r) => r.error)
  if (bad?.error) return { data: [], error: bad.error }
  return { data: results.flatMap((r) => r.data), error: null }
}

/**
 * The one query that must tolerate a drifted production schema.
 *
 * `siteops_unplaced.question_wamid` is declared in that table's own CREATE TABLE, and is missing
 * from the live table — the table in production was created from an earlier cut of that migration.
 * A 42703 on ONE optional column was taking the entire desk down with it.
 *
 * Rich first, then base. This is the portal's existing idiom, not a new one.
 */
const UNPLACED_RICH = 'id, observation, caption, sender_number, object_path, project_id, status, reason, question_wamid, created_at'
const UNPLACED_BASE = 'id, observation, caption, sender_number, object_path, project_id, status, created_at'

async function unplacedSelect(orgId: string) {
  const q = (cols: string) => fetchAll<Record<string, unknown>>((from, to) =>
    supabase.from('siteops_unplaced').select(cols).eq('org_id', orgId).eq('status', 'unplaced').range(from, to))
  const rich = await q(UNPLACED_RICH)
  if (!rich.error) return rich
  if (!/42703|does not exist/i.test(rich.error.message)) return rich   // a real failure still fails, loudly
  console.warn('[desk] siteops_unplaced is missing a column (schema drift) — falling back:', rich.error.message)
  return q(UNPLACED_BASE)
}

export function useLiveDeskApi({ orgId, userId }: Ctx): DeskApi {
  const qc = useQueryClient()

  /**
   * OPTIMISTIC. THE UI MOVES NOW; THE NETWORK CATCHES UP.
   *
   * Every action used to write, then `invalidate()`, then wait for the ENTIRE desk to refetch —
   * every problem, every one of 1,500 tasks, 4,584 QC rows, every comment, all of it paged — before
   * a checkbox would tick. So a tap took a second or more and the whole page felt like it was
   * thinking about whether to obey you. That is the single worst thing an interface can do.
   *
   * Now the cached rows are patched in place the instant you act, so the tick, the toggle and the
   * status all land on the same frame as the press. The write still goes to Postgres, and the
   * refetch still reconciles afterwards — but it is no longer standing between you and the screen.
   *
   * A FAILED write is not hidden by this: `must()` throws, the toast says so, and the refetch that
   * follows pulls the true row back — the optimistic edit is corrected, out loud.
   */
  const patchCore = useCallback((f: (d: DeskCoreData) => DeskCoreData) => {
    qc.setQueryData<DeskCoreData>(['desk', orgId], (d) => (d ? f(d) : d))
  }, [qc, orgId])
  const patchPlan = useCallback((f: (d: DeskPlanData) => DeskPlanData) => {
    qc.setQueryData<DeskPlanData>(['deskPlan', orgId], (d) => (d ? f(d) : d))
  }, [qc, orgId])
  const invalidateCore = useCallback(() => { void qc.invalidateQueries({ queryKey: ['desk', orgId] }) }, [qc, orgId])
  const invalidatePlan = useCallback(() => { void qc.invalidateQueries({ queryKey: ['deskPlan', orgId] }) }, [qc, orgId])

  /* ── LIVE — A WHATSAPP WRITE LANDS ON THE OPEN DESK, WITH NO REFRESH ────────────────────────────
   * CORE polls every 30s and PLAN reconciles on window focus — but a task a supervisor updates over
   * WhatsApp while the founder is LOOKING at the plan would otherwise sit stale until he refocused the
   * tab, which reads as "the desk is wrong". (The old SiteDesk had a realtime sub; the rewrite dropped it
   * for the heavy plan payload, and that is the regression.) So we subscribe to the exact tables the
   * webhook writes and invalidate the MATCHING load the instant a row changes — the task's status/comment/
   * check/narration invalidate PLAN, the problem/its trail/the pending queue invalidate CORE. No timer over
   * the 1,500-task payload, and zero requests when nothing moves. Same idiom as useBadgeRealtime, and
   * org-scoped so the channel only wakes for THIS org's rows.
   *
   * NOTE: the site_* tables must be in the `supabase_realtime` publication for this to fire (RLS still
   * applies to what the row payload can carry). If they are not, this is inert — never wrong, just as
   * stale as before — so shipping it ahead of the publication change cannot break the desk. */
  useEffect(() => {
    if (!orgId) return
    const flt = `org_id=eq.${orgId}`
    const channel = supabase
      .channel(`desk-live-${orgId}`)
      // PLAN — the Work Plan payload: the task itself, its spoken updates, its checks, its words.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_tasks', filter: flt }, invalidatePlan)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_task_comments', filter: flt }, invalidatePlan)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_task_qc', filter: flt }, invalidatePlan)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_narrations', filter: flt }, invalidatePlan)
      // CORE — the Problems list, its trail, and the Pending (unplaced) queue.
      .on('postgres_changes', { event: '*', schema: 'public', table: 'problems', filter: flt }, invalidateCore)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'followup_events', filter: flt }, invalidateCore)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'problem_resolutions', filter: flt }, invalidateCore)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'siteops_unplaced', filter: flt }, invalidateCore)
      .subscribe()
    return () => { void supabase.removeChannel(channel) }
  }, [orgId, invalidateCore, invalidatePlan])

  /* ── two loads (see DeskCoreData / DeskPlanData) ──────────────────────────────────────────────
   * CORE paints the Problems list; PLAN carries the Work Plan's heavy task/QC payload. The problems
   * fold reads CORE alone, so the Problems tab renders the instant CORE lands — it never waits on the
   * ~1,530 tasks / ~4,584 QC rows it does not show. */
  // CORE: lean, and it polls — a 30s tick over a few hundred rows, not the old 20s over the whole world.
  const core = useQuery({ ...deskCoreQuery(orgId), enabled: !!orgId, refetchInterval: 30_000 })
  // PLAN: gated on CORE success so it never delays the Problems list, and it does NOT poll — it
  // reconciles on a task write (invalidatePlan) or a window focus, never on a full-world timer.
  const plan = useQuery({ ...deskPlanQuery(orgId), enabled: !!orgId && core.isSuccess, refetchOnWindowFocus: true })

  const coreData = core.data
  const planData = plan.data
  // `dataUpdatedAt` (CORE's) IS the clock. Reading Date.now() during render is impure and would make
  // every age and every status sentence drift between two renders of the same data; this one moves only
  // when CORE polls, so the fold is a pure function of what we fetched.
  const now = core.dataUpdatedAt || 0

  /* ── fold ──────────────────────────────────────────────────────────────────────────────────
   * problems + pending come from CORE and render immediately; plans fill in when PLAN arrives (until
   * then a site card shows its problem counts with pct 0). One memo over both, so it re-derives when
   * either load lands. */
  const model = useMemo(() => {
    const empty = { sites: [] as DeskSite[], problems: [] as DeskProblem[], pending: [] as DeskPending[], plans: {} as Record<string, DeskPlan> }
    if (!coreData) return empty

    const nameById = new Map(coreData.members.map((m) => [m.id, m.name ?? '']))
    const phoneById = new Map(coreData.phones.filter((p) => p.user_id).map((p) => [p.user_id as string, p.phone_number]))
    const nameOf = (id: string | null) => (id ? nameById.get(id) ?? '' : '')
    const phoneOf = (id: string | null) => (id ? phoneById.get(id) ?? '' : '')

    const projById = new Map(coreData.projects.map((p) => [p.project_id, p]))
    const codeOf = (pid: string | null) => (pid ? projById.get(pid)?.project_code ?? '' : '')

    // ── problems (CORE) ──
    const eventsBy = new Map<string, EventRow[]>()
    for (const e of coreData.events) {
      if (!e.problem_id) continue
      const l = eventsBy.get(e.problem_id) ?? []
      l.push(e); eventsBy.set(e.problem_id, l)
    }
    const attsBy = new Map<string, AttachmentRow[]>()
    for (const a of coreData.atts) {
      const l = attsBy.get(a.parent_id) ?? []
      l.push(a); attsBy.set(a.parent_id, l)
    }
    // The CURRENT resolution is the newest one that has not been reopened.
    const resBy = new Map<string, ResolutionRow>()
    for (const r of coreData.resolutions) {
      if (r.reopened_at) continue
      if (!resBy.has(r.problem_id)) resBy.set(r.problem_id, r)
    }

    const problems: DeskProblem[] = coreData.problems
      .filter((p) => p.project_id && codeOf(p.project_id))
      .map((p) => toDeskProblem(p, {
        events: eventsBy.get(p.id) ?? [],
        photos: attsBy.get(p.id) ?? [],
        resolution: resBy.get(p.id) ?? null,
        siteName: projById.get(p.project_id!)?.name ?? '',
        siteCode: codeOf(p.project_id),
        supervisorId: projById.get(p.project_id!)?.supervisor_id ?? null,
        nameOf, phoneOf, now,
      }))

    // ── pending (CORE — siteops_unplaced) ──
    const pending: DeskPending[] = coreData.unplaced.map((u) => {
      const obs = u.observation as { text?: string } | null
      return {
        id: String(u.id),
        text: obs?.text ?? (u.caption as string) ?? 'Photo with no caption',
        sender: 'WhatsApp',
        senderNumber: (u.sender_number as string) ?? '',
        when: `${daysBetween(u.created_at as string, now)}d ago`,
        // A question we asked that was never answered — the item is stuck waiting on HIM.
        interrupted: !!u.question_wamid,
        photo: !!u.object_path,
        site: u.project_id ? projById.get(u.project_id as string)?.name ?? null : null,
      }
    })

    // ── plans (PLAN — needs CORE's projects + problems) ──
    // A task is blocked by exactly the OPEN issues whose task_id points at it. Derived — see
    // blockersByTask(). Nothing writes a blocked flag, so nothing can leave one behind.
    const blockerByTaskId = blockersByTask(coreData.problems)
    const plans: Record<string, DeskPlan> = {}
    if (planData) {
      const qcRowsByTask = new Map<string, QcRow[]>()
      for (const r of planData.qc) {
        const l = qcRowsByTask.get(r.task_id) ?? []
        l.push(r); qcRowsByTask.set(r.task_id, l)
      }
      const qcByTaskId = new Map([...qcRowsByTask].map(([tid, rows]) => [tid, toQcChecks(rows)]))

      const commentsByTaskId = new Map<string, TaskCommentRow[]>()
      for (const c of planData.comments) {
        const l = commentsByTaskId.get(c.task_id) ?? []
        l.push(c); commentsByTaskId.set(c.task_id, l)
      }
      const narrationById = new Map(planData.narrations.map((n) => [n.id, n]))
      const photosByTaskId = new Map<string, AttachmentRow[]>()
      for (const a of planData.taskAtts) {
        const l = photosByTaskId.get(a.parent_id) ?? []
        l.push(a); photosByTaskId.set(a.parent_id, l)
      }

      const tasksByProject = new Map<string, TaskRow[]>()
      for (const t of planData.tasks) {
        const pid = t.project_id
        if (!pid) continue
        const l = tasksByProject.get(pid) ?? []
        l.push(t); tasksByProject.set(pid, l)
      }

      for (const proj of coreData.projects) {
        const code = proj.project_code
        if (!code) continue
        const rows = tasksByProject.get(proj.project_id) ?? []

        // A PROJECT WITH NO TASKS STILL HAS A PLAN — an EMPTY one. Skipping it here is what made the
        // setup wizard unreachable: planFor() returned null, and the page could not tell "no plan yet"
        // apart from "no project chosen", so it showed the project picker instead of the wizard.
        if (!rows.length) {
          plans[code] = { floors: [], focus: '', tasks: [] }
          continue
        }

        const refByNodeKey = new Map(rows.filter((t) => t.node_key && t.ref).map((t) => [t.node_key as string, t.ref as string]))

        // WHAT EACH TASK WAITS FOR — from the LIVE graph (the building + the current library), not from
        // the `binding` snapshot each row happens to carry. One instantiate per project, not per row.
        // See gates.ts: this is what stopped "Wall — blockwork" reading Ready over an unpoured slab.
        const gates = gatesByTask(proj as EngineProjectRow, rows)

        const all: DeskTask[] = rows.map((t) => toDeskTask(t, {
          refByNodeKey, gates, blockerByTaskId, qcByTaskId, commentsByTaskId, narrationById, photosByTaskId,
          supervisorId: proj.supervisor_id,      // a task with no owner inherits the site's supervisor
          nameOf, now,
        }))

        // Floors bottom-up, in the engine's own seq order, with the building-level work on a floor of
        // its own at the bottom (see planFloors / SITE_FLOOR).
        const floors = planFloors(all)
        // Focus = the lowest floor that is not finished. That is where the building actually is —
        // but it is only a DEFAULT: the page can look at any floor it likes (sliceFloor).
        const focus = floors.find((f) => f.pct < 100)?.n ?? floors.at(-1)?.n ?? ''

        plans[code] = { floors, focus, tasks: all }
      }
    }

    // ── sites (CORE projects + problems; pct/focus from PLAN once it lands) ──
    const sites: DeskSite[] = coreData.projects
      .filter((p) => p.project_code)
      .map((p) => {
        const code = p.project_code as string
        const mine = problems.filter((x) => x.siteCode === code)
        const you = mine.filter((x) => x.state === 'you').length
        const open = mine.filter((x) => x.state !== 'resolved').length
        const plan = plans[code]
        const pct = plan ? Math.round(plan.floors.reduce((s, f) => s + f.pct, 0) / Math.max(1, plan.floors.length)) : 0
        return {
          name: p.name, code, pct,
          projectId: p.project_id,
          projectType: p.project_type ?? '',
          supervisorId: p.supervisor_id ?? null,
          focus: plan?.focus ? `${plan.focus} floor` : '—',
          state: you ? 'hot' : open ? 'mid' : 'ok',
          note: you ? `${you} need you` : open ? `${open} with Briklay` : 'all clear',
          youCount: you, openCount: open,
        } as DeskSite
      })

    return { sites, problems, pending, plans }
  }, [coreData, planData, now])

  /* ── writes ──────────────────────────────────────────────────────────────────────────────── */

  /** Every write goes through here. A swallowed error is how the note and the Close both failed
   *  in silence for a day — the row said "closed", the database said nothing of the kind. */
  const must = async (label: string, run: () => PromiseLike<{ error: { message: string } | null }>) => {
    const { error } = await run()
    if (error) throw new Error(`${label} failed: ${error.message}`)
  }

  /* WHAT THE CLOSE TURNED OFF, so an Undo can put it back exactly as it was.
   * Undo is not a reopen — it says the close NEVER HAPPENED — so restoring the item with a made-up
   * chase date would be a small lie about a thing the founder just told us was a mistake. The real
   * values are read before they are cleared and held here until the undo window passes. */
  const clockBeforeClose = useRef(new Map<string, { next: string | null; ev: string | null }>())

  const close = useCallback(async (id: string, outcome: Outcome, note: string): Promise<UndoSnapshot> => {
    const before = model.problems.find((p) => p.id === id)!
    const snap = snapshot(before)
    const patch = closeItem(outcome, note)

    const { data: live } = await supabase.from('problems')
      .select('next_followup_at, active_resolve_event').eq('id', id).eq('org_id', orgId).maybeSingle()
    clockBeforeClose.current.set(id, {
      next: (live?.next_followup_at as string | null) ?? null,
      ev: (live?.active_resolve_event as string | null) ?? null,
    })

    // The RESOLUTION first: it is the record. If it cannot be written, the item must NOT close —
    // a closed row with no reason on file is exactly the audit hole this table exists to prevent.
    await must('Recording the resolution', () => supabase.from('problem_resolutions').insert({
      org_id: orgId, problem_id: id, outcome: outcomeKey(outcome),
      note: patch.resolution.note, closed_by: userId, auto_closed: false,
    }))
    /**
     * CLOSING IS THREE FACTS, NOT ONE — and writing only the first is why WhatsApp kept chasing
     * things the portal showed as closed.
     *
     *  1. status='RESOLVED'      — what every reader tests. This alone was here.
     *  2. next_followup_at=null  — the CHASE CLOCK. Every other closer in the codebase nulls it
     *                              (ItemsTable, the WhatsApp resolver); the Desk was the only one
     *                              that did not. Harmless while the row stays closed — and a trap the
     *                              moment it is reopened, because the clock is now a date in the
     *                              PAST, so the very next cron run chases it with no cadence at all.
     *  3. active_resolve_event=null — the readback button. A resolve stamps the followup_event it is
     *                              waiting on; leaving it set means a stale "Not resolved" tap in an
     *                              old WhatsApp thread can still match, silently flipping this row
     *                              back to ADDRESSING and re-arming the chase behind your back.
     *
     * A close that leaves live wiring behind it is not a close.
     */
    await must('Closing the item', () => supabase.from('problems')
      .update({ status: 'RESOLVED', next_followup_at: null, active_resolve_event: null })
      .eq('id', id).eq('org_id', orgId))
    // Only NOW is it safe to show it closed — the resolution is on file.
    patchCore((d) => ({ ...d, problems: d.problems.map((p) => (p.id === id ? { ...p, status: 'RESOLVED' } : p)) }))
    await supabase.from('followup_events').insert({
      org_id: orgId, problem_id: id, type: 'status_changed', actor_kind: 'user', actor_id: userId,
      body: `Closed — ${outcome}`,
    })
    invalidateCore()
    return snap
  }, [model.problems, orgId, userId, invalidateCore, patchCore])

  const undo = useCallback((snap: UndoSnapshot) => {
    void (async () => {
      // Undo is NOT a reopen: it erases a close that should never have happened. So the chase clock
      // and the readback button go back to EXACTLY what they were — not to sensible defaults. The
      // resolution row goes too, but only the one WE just wrote (matched by problem + not-reopened).
      const was = clockBeforeClose.current.get(snap.id)
      clockBeforeClose.current.delete(snap.id)
      await supabase.from('problems').update({
        status: snap.state === 'moving' ? 'ADDRESSING' : 'OPEN',
        next_followup_at: was?.next ?? null,
        active_resolve_event: was?.ev ?? null,
      }).eq('id', snap.id).eq('org_id', orgId)
      const { data: r } = await supabase.from('problem_resolutions')
        .select('id').eq('problem_id', snap.id).eq('org_id', orgId).is('reopened_at', null)
        .order('closed_at', { ascending: false }).limit(1)
      if (r?.[0]) await supabase.from('problem_resolutions').delete().eq('id', r[0].id)
      invalidateCore()
    })()
  }, [orgId, invalidateCore])

  const reopen = useCallback(async (id: string) => {
    {
      /* A REOPENED ITEM IS A LIVE ITEM, SO IT GETS CHASED AGAIN — but from tomorrow, not from a date
       * in the past. The close nulled the clock (correctly); leaving it null here would make "reopen"
       * mean "reopen, and quietly never ask anyone about it again", which is the same silence this
       * whole fix set exists to end. The stale readback button is cleared with it. */
      const tomorrow = new Date(Date.now() + 24 * 3600 * 1000).toISOString()
      patchCore((d) => ({ ...d, problems: d.problems.map((p) => (p.id === id ? { ...p, status: 'OPEN' } : p)) }))
      await must('Reopening', () => supabase.from('problems')
        .update({ status: 'OPEN', next_followup_at: tomorrow, active_resolve_event: null })
        .eq('id', id).eq('org_id', orgId))
      // The resolution row STAYS — it is only stamped as reopened. Closing is a fact.
      const { data: r } = await supabase.from('problem_resolutions')
        .select('id').eq('problem_id', id).eq('org_id', orgId).is('reopened_at', null)
        .order('closed_at', { ascending: false }).limit(1)
      if (r?.[0]) {
        await supabase.from('problem_resolutions')
          .update({ reopened_at: new Date().toISOString(), reopened_by: userId }).eq('id', r[0].id)
      }
      await supabase.from('followup_events').insert({
        org_id: orgId, problem_id: id, type: 'reopened', actor_kind: 'user', actor_id: userId, body: 'Reopened',
      })
      invalidateCore()
    }
  }, [orgId, userId, invalidateCore, patchCore])

  const addNote = useCallback(async (id: string, text: string) => {
    patchCore((d) => ({
      ...d,
      events: [...d.events, {
        id: `tmp-${Date.now()}`, problem_id: id, type: 'comment',
        body: text, actor_kind: 'user', actor_id: userId, created_at: new Date().toISOString(),
      }],
    }))
    await must('Adding the note', () => supabase.from('followup_events').insert({
      org_id: orgId, problem_id: id, type: 'comment', actor_kind: 'user', actor_id: userId, body: text,
    }))
    invalidateCore()
  }, [orgId, userId, invalidateCore, patchCore])

  /** TRUTHFUL nudge: bring the chase clock to now. The daily cron acts on it — so we say that,
   *  and we do not claim a message went out this second, because none did. */
  const nudge = useCallback(async (id: string) => {
    await supabase.from('problems').update({ next_followup_at: new Date().toISOString() }).eq('id', id).eq('org_id', orgId)
    await supabase.from('followup_events').insert({
      org_id: orgId, problem_id: id, type: 'status_changed', actor_kind: 'user', actor_id: userId,
      body: 'You moved the follow-up to the next run',
    })
    invalidateCore()
  }, [orgId, userId, invalidateCore])

  // NOT WIRED — no endpoint exists (map §6). These throw rather than lie.
  const unsupported = (what: string) => async () => { throw new DeskUnsupported(what) }

  /**
   * THE AD-HOC MESSAGE — the founder's own words, out on Briklay's line to the assignee (siteops-say).
   *
   * This is what the Composer always promised and never had. It THROWS on a non-delivery rather than
   * resolve quietly, so the toast tells the truth: WhatsApp only allows free-text inside the 24h window,
   * so out of it the note is saved on the trail but NOT sent — and the founder must know that, not be
   * told "Sent" over a message that never left.
   */
  const say = useCallback(async (id: string, text: string) => {
    const { data, error } = await supabase.functions.invoke('siteops-say', { body: { id, text } })
    if (error) throw new Error(error.message || 'Could not send the message')
    const r = (data ?? {}) as { ok?: boolean; sent?: boolean; reason?: string; message?: string; error?: string }
    if (!r.ok) throw new Error(r.error ?? 'The message could not be sent')
    if (!r.sent) throw new Error(r.message ?? `Not delivered — ${r.reason ?? 'unknown reason'}`)
    invalidateCore()
  }, [invalidateCore])

  /**
   * REASSIGN A PROBLEM — and re-notify the new owner, exactly as a fresh assignment would.
   *
   * Two writes: owner_id + owner_source='manual' on the row (a human's choice, which the generator never
   * re-defaults), then the shared hand-off notifier (siteops-notify-assignment) records the hand-off on the
   * trail and messages the new owner (free-text in-window / template out). The notify is best-effort — a
   * missing WhatsApp number or an undeployed notifier must not fail the reassignment itself.
   */
  const assignProblem = useCallback(async (id: string, userId: string | null) => {
    patchCore((d) => ({
      ...d,
      problems: d.problems.map((p) => (p.id === id ? { ...p, owner_id: userId, owner_source: 'manual' } : p)),
    }))
    await must('Reassigning', () => supabase.from('problems')
      .update({ owner_id: userId, owner_source: 'manual' }).eq('id', id).eq('org_id', orgId))
    if (userId) {
      try { await notifyAssignment('issue', id, userId) }
      catch (e) { console.warn('[desk] reassign notify failed (item still reassigned):', (e as Error).message) }
    }
    invalidateCore()
  }, [orgId, invalidateCore, patchCore])

  const patchTask = useCallback(async (_site: string, ref: string, f: (t: DeskTask) => DeskTask) => {
    const current = Object.values(model.plans).flatMap((p) => p.tasks).find((t) => t.ref === ref)
    if (!current) throw new Error('Task not found')
    const next = f(current)
    const patch: Record<string, unknown> = {
      status: next.state === 'todo' ? 'not_started' : next.state,
      duration_days: parseInt(next.dur, 10) || 1,
    }
    if (next.state === 'active' && current.state !== 'active') patch.started_at = new Date().toISOString()
    if (next.state === 'todo') patch.started_at = null

    // The segmented thumb glides NOW — not after 1,500 tasks come back over the wire.
    patchPlan((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.ref === ref
        ? { ...t, ...patch as Partial<TaskRow>, updated_at: new Date().toISOString() }
        : t)),
    }))

    await must('Saving the task', () => supabase.from('site_tasks').update(patch).eq('ref', ref).eq('org_id', orgId))
    invalidatePlan()
  }, [model.plans, orgId, invalidatePlan, patchPlan])

  /** A note on a TASK. Goes to site_task_comments — the same table the WhatsApp resolver writes
   *  to, so a typed note and a spoken one land in the same trail and read as one story. */
  const addTaskNote = useCallback(async (taskRef: string, text: string) => {
    const t = planData?.tasks.find((x) => x.ref === taskRef)
    if (!t) throw new Error('Task not found')
    const author = coreData?.members.find((m) => m.id === userId)?.name ?? 'You'

    // The note lands on the story immediately — that is the whole point of writing it.
    patchPlan((d) => ({
      ...d,
      comments: [...d.comments, {
        id: `tmp-${Date.now()}`, task_id: t.task_id, author_name: author,
        body: text, created_at: new Date().toISOString(),
      }],
    }))

    await must('Adding the note', () => supabase.from('site_task_comments').insert({
      org_id: orgId, task_id: t.task_id, author_id: userId, author_name: author, body: text,
    }))
    invalidatePlan()
  }, [planData, coreData, orgId, userId, invalidatePlan, patchPlan])

  /**
   * EDIT A TASK BY HAND — the name, and what it covers.
   *
   * Three writes, and each one is here for a reason the engine forces:
   *
   *   name         + name_source='manual'. reconcile() refreshes an engine row's name from the
   *                library on EVERY read (persist.ts), so without the flag the rename is reverted
   *                by the next page load and the user is left thinking the app forgot.
   *
   *   scope        site_tasks.description — the site's own words about this particular task. The
   *                engine's authored brief stays where it is; it belongs to the task-TYPE and is
   *                the same on every project.
   *
   *   synonym      the word we would otherwise have taken away. See edit.ts — the resolver matches
   *                inbound WhatsApp on the task NAME, so a rename with nothing kept would silently
   *                stop understanding the word the site has always used.
   */
  const editTask = useCallback(async (siteCode: string, ref: string, patch: TaskEdit) => {
    const plan = model.plans[siteCode]
    const current = plan?.tasks.find((t) => t.ref === ref)
    const row = planData?.tasks.find((t) => t.ref === ref)
    if (!planData || !current || !row) throw new Error('Task not found')

    const rename = patch.name !== undefined
      ? planRename(current, patch.name, patch.renameScope ?? 'type', plan.tasks)
      : null

    // the scope note is this row's alone — it is about this piece of work, not the type
    const descChanged = patch.desc !== undefined && (patch.desc ?? '') !== (current.desc ?? '')

    if (!rename && !descChanged) return

    const renamedRefs = new Set(rename?.refs ?? [])
    patchPlan((d) => ({
      ...d,
      tasks: d.tasks.map((t) => ({
        ...t,
        ...(rename && t.ref && renamedRefs.has(t.ref) ? { name: rename.name, name_source: 'manual' } : {}),
        ...(descChanged && t.ref === ref ? { description: patch.desc ?? null } : {}),
      })),
    }))

    if (rename) {
      const ids = planData.tasks.filter((t) => t.ref && renamedRefs.has(t.ref)).map((t) => t.task_id)
      await must('Renaming the task', () => supabase.from('site_tasks')
        .update({ name: rename.name, name_source: 'manual' }).in('task_id', ids).eq('org_id', orgId))

      // KEEP THE OLD WORD. Read-modify-write on a jsonb map that only a human rename ever touches; a
      // lost update here costs a synonym, not data, and the alternative is an RPC for something that
      // happens a handful of times in a project's life.
      //
      // Read JUST IN TIME, not in the desk's main projects query. That query loads on every visit,
      // and naming a column there would take the WHOLE DESK down with a 42703 on any org that hasn't
      // run 20260714000000 yet. A rename is rare; the desk is not. So the migration is a dependency
      // of RENAMING, not of LOOKING.
      if (rename.synonym) {
        const { data: proj } = await supabase.from('projects')
          .select('task_synonyms').eq('project_id', row.project_id).eq('org_id', orgId).maybeSingle()
        const syn = ((proj as { task_synonyms?: Record<string, string[]> } | null)?.task_synonyms ?? {})
        const had = syn[rename.synonym.taskTypeId] ?? []
        if (!had.includes(rename.synonym.oldName)) {
          await must('Keeping the old name understandable', () => supabase.from('projects')
            .update({ task_synonyms: { ...syn, [rename.synonym!.taskTypeId]: [...had, rename.synonym!.oldName] } })
            .eq('project_id', row.project_id).eq('org_id', orgId))
        }
      }
    }

    if (descChanged) {
      await must('Saving the scope', () => supabase.from('site_tasks')
        .update({ description: patch.desc ?? null }).eq('task_id', row.task_id).eq('org_id', orgId))
    }
    invalidatePlan()
  }, [model.plans, planData, orgId, invalidatePlan, patchPlan])

  /**
   * DELETE A TASK — and make it STAY deleted.
   *
   * Two writes, and the second is the one that matters. Deleting the row is not enough for an engine
   * task: reconcile() runs at read and re-inserts any node_key that is in the graph but missing from
   * the table (persist.ts), so the task would be back on the next page load. The node_key goes on the
   * project's suppressed_nodes list, the engine stops instantiating it, and only then is it gone.
   *
   * SUPPRESS FIRST, then delete. If the suppression write fails we have deleted nothing and the user
   * sees an error; the other order would leave a deleted row that quietly resurrects itself, which is
   * the worst of both.
   *
   * The suppression is per NODE, and it is scoped to this ONE project — deleting the slab on the
   * First floor of this site does not touch the slab on the Second, on another project, or in the
   * library. (projects.suppressed_tasks, the older list, suppresses a task TYPE project-wide; it is
   * deliberately not what this uses.)
   */
  const deleteTask = useCallback(async (siteCode: string, ref: string) => {
    const current = model.plans[siteCode]?.tasks.find((t) => t.ref === ref)
    const row = planData?.tasks.find((t) => t.ref === ref)
    if (!planData || !current || !row) throw new Error('Task not found')

    if (current.nodeKey) {
      const { data: proj } = await supabase.from('projects')
        .select('suppressed_nodes').eq('project_id', row.project_id).eq('org_id', orgId).maybeSingle()
      const had = ((proj as { suppressed_nodes?: string[] } | null)?.suppressed_nodes ?? [])
      if (!had.includes(current.nodeKey)) {
        await must('Removing it from the plan', () => supabase.from('projects')
          .update({ suppressed_nodes: [...had, current.nodeKey as string] })
          .eq('project_id', row.project_id).eq('org_id', orgId))
      }
    }

    await must('Deleting the task', () => supabase.from('site_tasks')
      .delete().eq('task_id', row.task_id).eq('org_id', orgId))

    patchPlan((d) => ({ ...d, tasks: d.tasks.filter((t) => t.task_id !== row.task_id) }))
    invalidatePlan()
  }, [model.plans, planData, orgId, invalidatePlan, patchPlan])

  const assignTask = useCallback(async (taskRef: string, uid: string | null) => {
    const t = planData?.tasks.find((x) => x.ref === taskRef)
    if (!t) throw new Error('Task not found')
    patchPlan((d) => ({ ...d, tasks: d.tasks.map((x) => (x.ref === taskRef ? { ...x, owner_id: uid } : x)) }))
    // owner_source='manual' — a human's choice is never re-defaulted by the generator (persist.ts).
    await must('Assigning', () => supabase.from('site_tasks')
      .update({ owner_id: uid, owner_source: 'manual' }).eq('task_id', t.task_id).eq('org_id', orgId))
    invalidatePlan()
  }, [planData, orgId, invalidatePlan, patchPlan])

  const assignSupervisor = useCallback(async (siteCode: string, uid: string | null) => {
    const p = coreData?.projects.find((x) => x.project_code === siteCode)
    if (!p) throw new Error('Site not found')
    // supervisor_id lives on CORE's projects (the plan fold reads them for task inheritance, so patching
    // core also updates the plan's inherited owners without a plan refetch).
    patchCore((d) => ({
      ...d,
      projects: d.projects.map((x) => (x.project_id === p.project_id ? { ...x, supervisor_id: uid } : x)),
    }))
    await must('Assigning the supervisor', () => supabase.from('projects')
      .update({ supervisor_id: uid }).eq('project_id', p.project_id).eq('org_id', orgId))
    invalidateCore()
  }, [coreData, orgId, invalidateCore, patchCore])

  const answerQc = useCallback(async (qcId: string, status: QcStatus, answer: string | null) => {
    // The tick lands on the same frame as the press.
    patchPlan((d) => ({ ...d, qc: d.qc.map((r) => (r.id === qcId ? { ...r, qc_status: status, answer } : r)) }))
    await must('Saving the check', () => supabase.from('site_task_qc')
      .update({ qc_status: status, answer, answered_at: new Date().toISOString() })
      .eq('id', qcId).eq('org_id', orgId))
    invalidatePlan()
  }, [orgId, invalidatePlan, patchPlan])

  const place = useCallback(async (id: string) => {
    // Placement itself is the WhatsApp pipeline's job; from here we can only take it off the queue.
    throw new DeskUnsupported(`Placing ${id} from the portal`)
  }, [])

  const dismissPending = useCallback(async (id: string) => {
    await supabase.from('siteops_unplaced')
      .update({ status: 'dismissed', resolved_at: new Date().toISOString() })
      .eq('id', id).eq('org_id', orgId)
    invalidateCore()   // siteops_unplaced rides on CORE (the Pending segment)
  }, [orgId, invalidateCore])

  /**
   * WRITE A WHOLE ORDER, IN ONE STATEMENT.
   *
   * This was a loop: one UPDATE per changed row, awaited in turn. Drag a task to the top of a
   * 1,500-task plan and that is 1,500 sequential round-trips — slow enough to watch, and not atomic:
   * a blip halfway leaves the plan half-renumbered, two tasks holding one slot and the order quietly
   * wrong. The RPC takes the task_ids in the order we want them and uses the array's ordinality as
   * the seq_no (migration 20260714000001). It also stamps order_source='manual', which is what stops
   * reconcile() re-defaulting a human's sequence back to the engine's on the next page load.
   */
  const resequence = useCallback(async (projectId: string, refsInOrder: string[]) => {
    const rows = planData?.tasks ?? []
    const idByRef = new Map(rows.filter((t) => t.ref).map((t) => [t.ref as string, t.task_id]))
    const ids = refsInOrder.map((r) => idByRef.get(r)).filter((id): id is string => !!id)
    if (!ids.length) return

    const res = await supabase.rpc('siteops_resequence', { p_project_id: projectId, p_task_ids: ids })
    if (!res.error) return

    /**
     * THE MIGRATION HAS NOT BEEN RUN YET — and a drag must not be broken by that.
     *
     * PGRST202 / 42883 = "no such function". This codebase applies migrations by hand, so there is
     * always a window where the code is ahead of the database, and in that window the RPC simply is
     * not there. Falling over with "Could not find the function siteops_resequence in the schema
     * cache" tells the user nothing they can act on and takes the feature away.
     *
     * So we do it the slow way instead: one UPDATE per row that actually moved. It is exactly what
     * the RPC replaced — several round-trips, and not atomic — but it WORKS, and the only cost of
     * running without the migration is that a big drag is slow. Run it and this branch goes quiet.
     */
    const code = (res.error as { code?: string }).code
    if (code !== 'PGRST202' && code !== '42883') {
      throw new Error(`Saving the new order failed: ${res.error.message}`)
    }
    console.warn('[desk] siteops_resequence is missing — run migration 20260714000001. Falling back to row-by-row.')

    const seqById = new Map(ids.map((id, i) => [id, i + 1]))
    const moved = rows.filter((t) => seqById.has(t.task_id) && seqById.get(t.task_id) !== t.seq_no)
    for (const t of moved) {
      await must('Saving the new order', () => supabase.from('site_tasks')
        .update({ seq_no: seqById.get(t.task_id), order_source: 'manual' })
        .eq('task_id', t.task_id).eq('org_id', orgId))
    }
  }, [planData, orgId])

  /**
   * ADD A TASK BY HAND.
   *
   * source='manual' and NO node_key — that pair is the whole contract. It tells reconcile() to leave
   * the row completely alone (persist.ts: "a MANUAL row is never touched" — never renamed, never
   * re-sequenced, never deleted when the geometry changes), and it tells gates.ts that this task has
   * no authored dependencies, so it does not pretend to have any.
   *
   * The ref is minted by the database trigger, not by us (20260712000000).
   */
  const addTask = useCallback(async (siteCode: string, draft: NewTask) => {
    const plan = model.plans[siteCode]
    const proj = coreData?.projects.find((p) => p.project_code === siteCode)
    if (!coreData || !plan || !proj) throw new Error('Site not found')

    const insert = {
      org_id: orgId,
      project_id: proj.project_id,
      name: draft.name.trim(),
      phase: draft.group.toLowerCase(),          // the desk's section IS the engine's phase/layer
      trade: (draft.trade ?? draft.group).toLowerCase(),
      floor_label: draft.floor,
      unit_label: draft.unit,
      duration_days: draft.durationDays ?? 1,
      owner_id: draft.ownerId ?? null,
      source: 'manual',
      order_source: 'manual',
      // seq_no is NOT NULL: park it at the end, then the resequence below puts it where it belongs.
      seq_no: ((planData?.tasks ?? []).filter((t) => t.project_id === proj.project_id)
        .reduce((m, t) => Math.max(m, t.seq_no ?? 0), 0)) + 1,
    }

    const { data: created, error } = await withTaskNoRetry(() => supabase.from('site_tasks')
      .insert(insert).select('task_id, ref').single())
    if (error) throw new Error(`Could not add the task: ${(error as { message?: string })?.message ?? error}`)

    // WHERE THE JOB HAPPENS — with the work it is part of, not at the bottom of the site (add.ts).
    const newRef = (created as { ref: string | null }).ref
    if (newRef) {
      const order = withNewTask(plan.tasks, draft, { ref: newRef } as DeskTask).map((t) => (t as DeskTask).ref)
      await resequence(proj.project_id, order)
    }
    invalidatePlan()
  }, [model.plans, coreData, planData, orgId, invalidatePlan, resequence])

  /**
   * REORDER — refereed first, written second, and ONLY what moved is written.
   *
   * The referee is the engine's ladder (edit.ts · checkMove), run over the rows' own `binding` — the
   * hard predecessors the engine recorded when it instantiated the graph, WITH their nature and
   * reason. An IMPOSSIBLE edge is refused and nothing is written at all.
   *
   * order_source='manual' on every row that MOVED is what makes it stick: reconcile() re-defaults an
   * 'auto' row's seq_no from the graph on every read (persist.ts), so without the flag the drag would
   * be undone by the next page load. Rows that did not move keep order_source='auto' and stay the
   * engine's to order — a human who dragged one task has not adopted the whole plan.
   *
   * The renumber is over the PROJECT's tasks (seq_no is project-wide), but only the rows whose seq_no
   * actually changed are written — the span between where it left and where it landed, not 1,500 rows.
   */
  const reorder = useCallback(async (siteCode: string, ref: string, targetRef: string) => {
    const plan = model.plans[siteCode]
    const moved = plan?.tasks.find((t) => t.ref === ref)
    const row = planData?.tasks.find((t) => t.ref === ref)
    if (!planData || !plan || !moved || !row) return { ok: false, message: 'Task not found' }

    const verdict = checkMove(moved, targetRef, plan.tasks)
    if (!verdict.ok) return { ok: verdict.ok, message: verdict.message }

    const seqByRef = new Map(verdict.order.map((t, i) => [t.ref, i + 1]))
    patchPlan((d) => ({
      ...d,
      tasks: d.tasks.map((t) => (t.ref && seqByRef.has(t.ref)
        ? { ...t, seq_no: seqByRef.get(t.ref) as number }
        : t)),
    }))

    if (row.project_id) await resequence(row.project_id, verdict.order.map((t) => t.ref))
    invalidatePlan()
    return { ok: true, message: verdict.message }
  }, [model.plans, planData, invalidatePlan, patchPlan, resequence])

  // SAY WHAT ACTUALLY WENT WRONG. The first version of this guessed ("your migrations aren't
  // applied") and was confidently wrong the moment the failure was something else — which is
  // exactly the class of lie this codebase keeps getting bitten by. The real Postgres message
  // (code, table, column) goes on the screen and in the console, and only THEN a hint.
  // CORE's failure is the desk's failure (it carries the Problems list). PLAN's failure is surfaced too,
  // but the Problems tab still stands on CORE.
  const error = core.error ?? plan.error
  const message = (() => {
    if (!error) return null
    const e = error as { message?: string; code?: string; details?: string; hint?: string }
    const raw = [e.code, e.message, e.details].filter(Boolean).join(' · ') || String(error)
    console.error('[desk] load failed:', e)
    let hint = ''
    // PGRST20x = PostgREST is serving a STALE SCHEMA CACHE. The migration ran; the API layer just
    // hasn't noticed. This is the most likely failure right after applying SQL by hand.
    if (e.code?.startsWith('PGRST2') || /schema cache/i.test(e.message ?? '')) {
      hint = " — the migration ran, but the API is still serving its old schema. Reload it: run  NOTIFY pgrst, 'reload schema';  in the SQL editor (or Dashboard → Settings → API → Reload schema)."
    } else if (e.code === '42P01') hint = ' — that table does not exist. Run 20260712000001_site_desk_fields.sql.'
    else if (e.code === '42703') hint = ' — that column does not exist. Run both Site Desk migrations, then reload the schema cache (Supabase → API → "Reload schema").'
    else if (e.code === '42501' || /permission|policy/i.test(e.message ?? '')) hint = ' — RLS refused the read. Check the "org member access" policy on the new tables.'
    return `Could not load the desk: ${raw}${hint}`
  })()

  return useMemo(() => ({
    sites: model.sites,
    problems: model.problems,
    pending: model.pending,
    planFor: (code: string) => model.plans[code] ?? null,
    error: message,
    // CORE gates the whole desk skeleton; the Problems tab paints the instant it lands.
    loading: core.isLoading,
    // PLAN is a SEPARATE, later load — the Work Plan tab shows its own loader on this instead of
    // mistaking a still-loading plan for "no plan yet".
    plansLoading: !!orgId && (plan.isLoading || (core.isSuccess && plan.fetchStatus === 'idle' && !planData)),
    // THE GRIP APPEARS NOW, because the drop can finally be refused for a real reason and persisted
    // for a real one: the referee is the engine's ladder run over the rows' own `binding` (edit.ts ·
    // checkMove), and the write is seq_no + order_source='manual', which reconcile() never undoes.
    //
    // The rule this flag encodes has not changed — a drag handle on a row that cannot be dragged is a
    // lie the interface tells with its hands. It simply is not a lie any more.
    canReorder: true,
    members: (coreData?.members ?? []).filter((m) => m.name).map((m) => ({ id: m.id, name: m.name as string })),
    addTaskNote, assignTask, assignSupervisor, assignProblem,
    close, undo, reopen, addNote,
    say,
    nudge,
    approve: unsupported('Approving from the portal'),
    place, dismissPending, patchTask, editTask, deleteTask, addTask, answerQc, reorder,
  }), [model, message, core.isLoading, plan.isLoading, plan.fetchStatus, core.isSuccess, planData, orgId, coreData, close, undo, reopen, addNote, addTaskNote, assignTask, assignSupervisor, assignProblem, say, nudge, place, dismissPending, patchTask, editTask, deleteTask, addTask, answerQc, reorder])
}

/** Thrown by an action the backend cannot honour yet. The UI catches it and says so. */
export class DeskUnsupported extends Error {
  constructor(what: string) {
    super(`${what} isn't wired to WhatsApp yet — it needs the send endpoint. Nothing was sent.`)
    this.name = 'DeskUnsupported'
  }
}

/**
 * Attachments are NOT signed here anymore — they carry only their private-bucket ref (bucket + object_path)
 * and are signed LAZILY, at render, by useSignedUrl. Signing every photo in the org up front (a storage
 * round-trip each) was work spent before the list could paint; now a photo is signed only when it is about
 * to be shown, and the result is cached. `url` is left null: the render path signs on demand.
 */
function unsignedAtts(rows: Array<AttachmentRow & { bucket: string; object_path: string }>): SignedAttachment[] {
  return rows.map((a) => ({ ...a, url: null }))
}

/**
 * CORE — what the Problems tab needs, and nothing the Work Plan needs.
 *
 * projects (WITH geometry — the plan fold reads them for gates.ts), problems, the org's people and their
 * numbers, and each problem's events/photos/resolutions. This is the query that must be FAST: it carries
 * the default view, and it is deliberately free of the ~1,530 tasks / ~4,584 QC rows that used to sit in
 * front of it. A plain query-options object so it can be PREFETCHED (useDeskPreload) before the click.
 */
export function deskCoreQuery(orgId: string) {
  return {
    queryKey: ['desk', orgId] as const,
    queryFn: async (): Promise<DeskCoreData> => {
      const [projects, problems, unplaced, members] = await Promise.all([
        // THE GEOMETRY COMES WITH THE PROJECT — the plan fold instantiates the real graph from it
        // (gates.ts). DEGRADED SELECT (engine/project.ts idiom): a geometry column that a hand-applied
        // migration hasn't landed must never blank the desk; fall back to the always-present columns.
        fetchAll<ProjectRow>(async (f, t) => {
          const cols = `project_id, name, project_code, project_type, supervisor_id, ${GEOMETRY_COLUMNS}`
          const res = await supabase.from('projects').select(cols).eq('org_id', orgId).range(f, t)
          if (!res.error) return res
          return supabase.from('projects')
            .select('project_id, name, project_code, project_type, construction_stack, supervisor_id')
            .eq('org_id', orgId).range(f, t)
        }),
        // problems — RICH (owner_source) → BASE (without). See PROBLEM_COLS_BASE.
        fetchAll<ProblemRow>(async (f, t) => {
          const res = await supabase.from('problems').select(PROBLEM_COLS).eq('org_id', orgId).order('created_at', { ascending: false }).range(f, t)
          if (!res.error || !/owner_source|42703|does not exist/i.test(res.error.message ?? '')) return res
          console.warn('[desk] problems.owner_source missing (schema drift) — falling back:', res.error.message)
          return supabase.from('problems').select(PROBLEM_COLS_BASE).eq('org_id', orgId).order('created_at', { ascending: false }).range(f, t)
        }),
        // RICH/BASE — the portal's own idiom. `question_wamid` is in the CREATE TABLE yet the live table
        // predates it; one optional column must never cost us the whole desk.
        unplacedSelect(orgId),
        // WHO CAN BE ASSIGNED = who is in this ORG (org_memberships is the list; user_profiles the names).
        fetchAll<{ user_id: string }>((f, t) =>
          supabase.from('org_memberships').select('user_id').eq('org_id', orgId).eq('status', 'active').range(f, t)),
      ])
      for (const r of [projects, problems, unplaced, members]) {
        if (r.error) throw r.error
      }

      const pIds = problems.data.map((p) => p.id)
      const memberIds = [...new Set(members.data.map((m) => m.user_id).filter(Boolean))]
      const [events, atts, resolutions, phones, profiles] = await Promise.all([
        fetchIn<EventRow>(pIds, (c, f, t) => supabase.from('followup_events').select('id, problem_id, type, body, actor_kind, actor_id, created_at').eq('org_id', orgId).in('problem_id', c).order('created_at').range(f, t)),
        fetchIn<AttachmentRow & { bucket: string; object_path: string }>(pIds, (c, f, t) => supabase.from('attachments').select('parent_id, role, caption, created_at, bucket, object_path').eq('org_id', orgId).eq('parent_type', 'problem').in('parent_id', c).order('created_at').range(f, t)),
        fetchIn<ResolutionRow>(pIds, (c, f, t) => supabase.from('problem_resolutions').select('problem_id, outcome, note, duplicate_of, closed_by, auto_closed, closed_at, reopened_at').eq('org_id', orgId).in('problem_id', c).order('closed_at', { ascending: false }).range(f, t)),
        fetchAll<{ user_id: string | null; phone_number: string }>((f, t) =>
          supabase.from('wa_registered_numbers').select('user_id, phone_number').eq('org_id', orgId).range(f, t)),
        fetchIn<{ id: string; name: string | null }>(memberIds, (c, f, t) =>
          supabase.from('user_profiles').select('id, name').in('id', c).range(f, t)),
      ])
      for (const r of [events, atts, resolutions, phones, profiles]) {
        if (r.error) throw r.error
      }

      const atts_ = unsignedAtts(atts.data)
      console.log(`[desk:core] projects=${projects.data.length} problems=${problems.data.length} events=${events.data.length} photos=${atts_.length}`)
      return {
        projects: projects.data,
        problems: problems.data,
        unplaced: unplaced.data,
        members: profiles.data.filter((p) => p.name),
        events: events.data,
        atts: atts_,
        resolutions: resolutions.data,
        phones: phones.data,
      }
    },
  }
}

/**
 * PLAN — the Work Plan's heavy payload, kept OFF the Problems path.
 *
 * The ~1,530 tasks, their ~4,584 QC rows, comments, the narrations their status_history points at, and
 * the task photos. Loaded after CORE (the hook gates it on core success) so it never delays the Problems
 * list. It reads CORE's projects in the fold for geometry — it does not re-fetch them here.
 */
export function deskPlanQuery(orgId: string) {
  return {
    queryKey: ['deskPlan', orgId] as const,
    queryFn: async (): Promise<DeskPlanData> => {
      const [tasks, qc, comments] = await Promise.all([
        fetchAll<TaskRow & { project_id?: string }>((f, t) =>
          supabase.from('site_tasks').select(TASK_COLS).eq('org_id', orgId).order('seq_no').order('task_id').range(f, t)),
        fetchAll<QcRow>((f, t) =>
          supabase.from('site_task_qc').select('id, task_id, question, is_critical, seq, answer, qc_status').eq('org_id', orgId).order('id').range(f, t)),
        // The task's own trail — where a resolved WhatsApp update lands.
        fetchAll<TaskCommentRow>((f, t) =>
          supabase.from('site_task_comments').select('id, task_id, author_name, body, created_at').eq('org_id', orgId).order('created_at').range(f, t)),
      ])
      for (const r of [tasks, qc, comments]) {
        if (r.error) throw r.error
      }

      // THE WORDS — the narrations a task's status_history points at, fetched BY ID (chunked; hundreds of
      // uuids in a URL is a 400). sender_name is a later migration — degrade to base if it isn't applied.
      const nIds = [...new Set(tasks.data.flatMap((t) => narrationIdsOf(t.status_history)))]
      const [narrations, taskAtts] = await Promise.all([
        (async () => {
          const withName = await fetchIn<NarrationRow>(nIds, (c, f, t) => supabase.from('site_narrations').select('id, raw_text, created_at, sender_name').eq('org_id', orgId).in('id', c).order('created_at').range(f, t))
          if (!withName.error) return withName
          return await fetchIn<NarrationRow>(nIds, (c, f, t) => supabase.from('site_narrations').select('id, raw_text, created_at').eq('org_id', orgId).in('id', c).order('created_at').range(f, t))
        })(),
        // Task photos (attachments.parent_type='site_task'). Org-scoped, not an `.in(task_id,…)` list —
        // ~1,500 uuids in a GET is a 400 before Postgres is reached (see fetchIn).
        fetchAll<AttachmentRow & { bucket: string; object_path: string }>((f, t) => supabase.from('attachments').select('parent_id, role, caption, created_at, bucket, object_path').eq('org_id', orgId).eq('parent_type', 'site_task').order('created_at').range(f, t)),
      ])
      for (const r of [narrations, taskAtts]) {
        if (r.error) throw r.error
      }

      const taskAtts_ = unsignedAtts(taskAtts.data)
      console.log(`[desk:plan] tasks=${tasks.data.length} qc=${qc.data.length} narrations=${narrations.data.length} taskPhotos=${taskAtts_.length}`)
      return {
        tasks: tasks.data,
        qc: qc.data,
        comments: comments.data,
        narrations: narrations.data,
        taskAtts: taskAtts_,
      }
    },
  }
}

/**
 * PRELOAD THE DESK — the data AND the code — while he is doing something else.
 *
 * Two things stand between a click on "Site Desk" and a usable screen: a lazy JS chunk that has to be
 * downloaded, and a large query that has to come back. Both are perfectly well known in advance, and
 * neither has any reason to wait for the click.
 *
 * Fired on IDLE, so it never competes with the page he is actually looking at, and only once he is
 * authenticated (there is no desk without an org). `prefetchQuery` is a no-op if the data is already
 * cached, so this cannot cause a double fetch.
 */
export function useDeskPreload(orgId: string | null): void {
  const qc = useQueryClient()
  const done = useRef(false)

  useEffect(() => {
    if (!orgId || done.current) return
    done.current = true

    const run = () => {
      // the CODE: pull the route's chunk down now, so the click costs no network at all
      void import('../../pages/SiteDeskV2')
      // the DATA: CORE first (it paints the Problems tab), then the heavier PLAN — the same two queries
      // the desk itself asks for, asked early. prefetchQuery is a no-op if already cached.
      void qc.prefetchQuery({ ...deskCoreQuery(orgId), staleTime: 15_000 })
      void qc.prefetchQuery({ ...deskPlanQuery(orgId), staleTime: 15_000 })
    }

    const w = window as Window & {
      requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number
      cancelIdleCallback?: (h: number) => void
    }
    if (w.requestIdleCallback) {
      const h = w.requestIdleCallback(run, { timeout: 3000 })
      return () => w.cancelIdleCallback?.(h)
    }
    const t = window.setTimeout(run, 1200)
    return () => window.clearTimeout(t)
  }, [orgId, qc])
}
