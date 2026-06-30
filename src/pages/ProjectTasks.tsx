import { useState, useEffect, useRef, useCallback, useContext, type CSSProperties, type ReactNode } from 'react'
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { PageSkeleton } from '../components/SkeletonLoader'
import { useQueryGate } from '../components/QueryGate'
import ConstructionConfig from '../components/siteOps/ConstructionConfig'
import ProjectSequence, { prefetchProjectQueries } from '../components/siteOps/ProjectSequence'
import { UserPicker, useOrgMembers, MemberAvatar } from '../components/siteOps/UserPicker'
import { NarrationComposer } from '../components/siteOps/NarrationComposer'
import { useUserProfile } from '../App'
import { useAuth } from '../lib/auth/AuthProvider'
import {
  CREAM, INK, INK_SOFT, INK_FAINT, TERRA, SAGE, LINE, FAIL, SERIF, DARK_CANVAS,
  DEFAULT_DURATION, addDays, fmtDate, isParking, titleCase, whereLabel, chip, metaTag,
} from '../components/siteOps/taskTokens'
import TaskDetail, {
  TaskCtx, qcProgress, QcProgressChip, ScheduleCell, StatusBadge, StatusNode, PendingSubtext,
  type TaskCtxValue, type Task, type QcStatus,
} from '../components/siteOps/TaskDetail'

// ── cascade timings (Motion 1) — tune here ───────────────────────────────────
const CAP = 14          // stagger only the first screenful; the rest render settled
const STAGGER = 50      // ms between consecutive task lines (40–70)
const LINE_BASE = 160   // ms before the first line settles (after headers)
const SETTLE = 250      // ms line settle duration → also the gap before its sub-text
const CASCADE_TOTAL = LINE_BASE + CAP * STAGGER + SETTLE + 200  // when the cascade window closes

// Deterministic order: seq_no, then task_no as a stable tie-break. Without the tie-break, rows
// that share a seq_no come back in a nondeterministic order on each refetch, so editing one
// task's duration could reshuffle tied tasks and make EARLIER dates jump. task_no is unique.
const bySeq = (a: Task, b: Task) => a.seq_no - b.seq_no || (a.task_no < b.task_no ? -1 : a.task_no > b.task_no ? 1 : 0)

const KEYFRAMES = `
@keyframes siteSettle { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes siteGroupIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes siteSubIn { from { opacity: 0; } to { opacity: 1; } }
/* hover-to-insert affordance: a task responds to the mouse and reveals a quiet "add task here"
   between rows. On touch (no hover) it stays faintly visible so it's tappable. */
.task-wrap { position: relative; }
.ins-aff { height: 0; opacity: 0; overflow: hidden; transition: height .16s ease, opacity .16s ease; }
.task-wrap:hover .ins-aff { height: 28px; opacity: 1; }
@media (hover: none) { .ins-aff { height: 22px; opacity: .55; } }
/* add-project affordance floating over the sequence — quiet until you reach for it */
.addproj-hot { opacity: .32; transition: opacity .2s ease, transform .2s ease; }
.addproj-hot:hover { opacity: 1; transform: translateY(-1px); }
@media (hover: none) { .addproj-hot { opacity: .6; } }
.proj-name { transition: color .2s ease, transform .2s ease; }
/* project selector positioning — clears the fixed left nav on desktop (offset by --shell-ml),
   and collapses on mobile where a left column has no room (it would overlap the sequence). */
.proj-centre { position: fixed; top: 0; right: 0; bottom: 0; left: 0; }
@media (min-width: 768px) { .proj-centre { left: var(--shell-ml, 0px); } }
.proj-side { position: fixed; top: 14px; left: calc(var(--shell-ml, 0px) + 14px); z-index: 80; }
.proj-add { position: fixed; top: 16px; right: 20px; z-index: 80; }
@media (max-width: 767px) { .proj-side { display: none !important; } .proj-add { display: none !important; } }`

// The Task Manager BODY — always scoped to one project. Mounted two ways (see the default
// export below): INSIDE a project (projectId from the URL, no filter) or at the GLOBAL level
// (projectId chosen via the project filter passed in as `filterSlot`). The body itself is
// identical either way — only the filter chrome differs, which is exactly the context-aware
// rule: global = choose a project, scoped = the project is inherited.
function ProjectTasksScoped({ session, projectId, filterSlot }: { session: Session; projectId: string; filterSlot?: ReactNode }) {
  const location = useLocation()
  const queryClient = useQueryClient()
  const { data: me } = useUserProfile(session.user.id)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [dragId, setDragId] = useState<string | null>(null)  // task being dragged
  const [overId, setOverId] = useState<string | null>(null)  // current drop-target row
  // Live enrichment (2c): idle → running (auto-fired once on first arrival, or manual retry) →
  // done | error. Drives the in-flight pill, the polling fallback, and the shimmer↔unavailable
  // sub-text state. The real fill arrives via realtime (description UPDATEs) + poll safety-net.
  const [enrichState, setEnrichState] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const firedRef = useRef(false)
  const [showSetup, setShowSetup] = useState(false)  // construction-config modal (set up & generate)
  const [showAdd, setShowAdd] = useState(false)      // manual add-task modal
  const [addAfter, setAddAfter] = useState<{ afterId: string; floor: string | null } | null>(null)  // hover-insert target
  const [siteOwnerPick, setSiteOwnerPick] = useState(false)  // site-level supervisor picker
  const [phaseOpen, setPhaseOpen] = useState<Record<string, boolean>>({})  // per-phase expand override (absent → smart default)
  const [view, setView] = useState<'list' | 'sequence'>('list')  // List (operational) vs Sequence (engine timeline)

  // ── first-arrival cascade flag (Motion 1) ──
  // From the wizard's navigation state {justCreated:true}, a one-shot sessionStorage marker,
  // or ?cascade=1 (manual testing). Reduced-motion disables it. Plays ONCE, consumed on mount.
  const [doCascade] = useState(() => {
    if (typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return false
    const nav = (location.state as { justCreated?: boolean } | null)?.justCreated === true
    const param = new URLSearchParams(location.search).get('cascade') === '1'
    const sess = typeof sessionStorage !== 'undefined' && sessionStorage.getItem(`siteops_cascade_${projectId}`) === '1'
    return nav || param || sess
  })
  const [cascadeDone, setCascadeDone] = useState(!doCascade)
  useEffect(() => {
    if (!doCascade) return
    try { sessionStorage.removeItem(`siteops_cascade_${projectId}`) } catch { /* noop */ }
    const t = setTimeout(() => setCascadeDone(true), CASCADE_TOTAL)
    return () => clearTimeout(t)
  }, [doCascade, projectId])

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => {
      const pq = (cols: string) => supabase.from('projects').select(cols).eq('project_id', projectId).single()
      let res: { data: unknown; error: { message: string } | null } = await pq('name, construction_stack, project_type, org_id, start_date, supervisor_id')
      if (res.error) res = await pq('name, construction_stack, project_type, org_id, start_date')
      if (res.error) throw res.error
      return res.data as { name?: string; construction_stack?: unknown; project_type?: string; org_id?: string; start_date?: string; supervisor_id?: string | null } | null
    },
    enabled: !!projectId,
  })

  const { data: members = [] } = useOrgMembers(project?.org_id as string | undefined)

  const { data: tasks = [], isLoading, isError, refetch } = useQuery({
    queryKey: ['project_tasks_v2', projectId],
    queryFn: async () => {
      // Rich select carries the Block-A-UI layers (owner, history, QC provenance, duration).
      // If those columns aren't migrated yet, fall back to the base shape so the page keeps working.
      const RICH = 'task_id, task_no, phase, trade, floor_label, unit_label, name, description, seq_no, status, source, duration_days, owner_id, owner_source, status_history, updated_at, node_key, task_type_id, site_task_qc(id, question, is_critical, seq, qc_status, answer, answered_at, source_narration_id)'
      const BASE = 'task_id, task_no, phase, trade, floor_label, unit_label, name, description, seq_no, status, source, site_task_qc(id, question, is_critical, seq, qc_status)'
      const q = (cols: string) => supabase.from('site_tasks').select(cols).eq('project_id', projectId).order('seq_no').order('task_no')
      let res: { data: unknown; error: { message: string } | null } = await q(RICH)
      if (res.error) res = await q(BASE)
      if (res.error) throw res.error
      return (res.data ?? []) as unknown as Task[]
    },
    enabled: !!projectId,
    // Safety net: while enrich is in flight, poll every 2s so phase-waves land even if the
    // realtime publication isn't applied. Realtime is the fast path; this is the backstop.
    refetchInterval: enrichState === 'running' ? 2000 : false,
  })

  // ── Phase 2.3 TASK VIEW (inverse of "may affect"): which OPEN issues threaten which task.
  //    Reads problems.impact (no recompute); silently empty if the column isn't migrated yet. ──
  // NB: a plain object, NOT a Map — this query's cache is PERSISTED (react-query-persist-client),
  // and a Map JSON-rehydrates to {} (so `.get` would throw "is not a function" after a reload).
  const { data: atRiskByTask = {} as Record<string, { id: string; title: string }[]> } = useQuery({
    queryKey: ['project_task_risk', projectId],
    queryFn: async () => {
      const res = await supabase.from('problems').select('id, title, impact').eq('project_id', projectId).neq('status', 'RESOLVED')
      const m: Record<string, { id: string; title: string }[]> = {}
      if (res.error) return m
      for (const p of (res.data ?? []) as { id: string; title: string; impact: { threatened?: { task_id: string | null }[] } | null }[]) {
        for (const th of p.impact?.threatened ?? []) {
          if (!th.task_id) continue
          const arr = m[th.task_id] ?? (m[th.task_id] = [])
          if (!arr.some((x) => x.id === p.id)) arr.push({ id: p.id, title: p.title })
        }
      }
      return m
    },
    enabled: !!projectId,
    refetchInterval: 20000,
  })

  // Dismiss ONE issue→task risk link (per-link, correctable): drop this task from the issue's
  // impact.threatened; if that empties it, clear impact entirely.
  const dismissRisk = useCallback(async (issueId: string, taskId: string) => {
    const { data } = await supabase.from('problems').select('impact').eq('id', issueId).maybeSingle()
    const impact = (data?.impact ?? null) as { threatened?: { task_id: string | null }[] } | null
    if (!impact) return
    const threatened = (impact.threatened ?? []).filter((t) => t.task_id !== taskId)
    const next = threatened.length ? { ...impact, threatened } : null
    await supabase.from('problems').update({ impact: next }).eq('id', issueId)
    queryClient.invalidateQueries({ queryKey: ['project_task_risk', projectId] })
  }, [queryClient, projectId])

  // ── Auto-fire enrich on first arrival (2c) ──
  // Fire ONCE for a freshly-created project whose tasks are entirely un-enriched (no
  // descriptions). A partially-enriched project is NOT auto-re-fired — re-enrich is the
  // deliberate manual "retry" action below. firedRef guards against double-fire across renders.
  const runEnrich = useCallback(() => {
    setEnrichState('running')
    supabase.functions.invoke('siteops-enrich', { body: { project_id: projectId } })
      .then(({ error }) => {
        setEnrichState(error ? 'error' : 'done')
        queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] })
      })
      .catch(() => setEnrichState('error'))
  }, [projectId, queryClient])

  useEffect(() => {
    if (firedRef.current) return
    const gen = tasks.filter((t) => t.source !== 'manual')  // manual tasks are never enriched
    if (!gen.length || !gen.every((t) => !t.description)) return  // empty or already (partly) enriched
    firedRef.current = true
    queueMicrotask(runEnrich)  // defer the state flip out of the effect body (no cascading render)
  }, [tasks, runEnrich])

  // ── Realtime: description UPDATEs land in phase-waves → refetch resolves the sub-text ──
  useEffect(() => {
    if (!projectId) return
    const channel = supabase
      .channel(`siteops-tasks-${projectId}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'site_tasks', filter: `project_id=eq.${projectId}` },
        () => queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] }),
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [projectId, queryClient])

  // QC check-off — optimistic (snappy), with a resync if the write fails.
  const setQc = useCallback((taskId: string, qcId: string, next: QcStatus) => {
    queryClient.setQueryData(['project_tasks_v2', projectId], (old: Task[] | undefined) =>
      old?.map((t) => t.task_id !== taskId ? t : {
        ...t, site_task_qc: t.site_task_qc.map((q) => q.id === qcId ? { ...q, qc_status: next } : q),
      }))
    supabase.from('site_task_qc').update({ qc_status: next }).eq('id', qcId).then(({ error }) => {
      if (error) queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] })
    })
  }, [queryClient, projectId])

  // Per-task duration edit — optimistic; downstream dates recompute from this + start_date.
  const setDuration = useCallback((taskId: string, days: number) => {
    const d = Math.max(1, Math.round(days) || 1)
    queryClient.setQueryData(['project_tasks_v2', projectId], (old: Task[] | undefined) =>
      old?.map((t) => (t.task_id === taskId ? { ...t, duration_days: d } : t)))
    supabase.from('site_tasks').update({ duration_days: d }).eq('task_id', taskId).then(({ error }) => {
      if (error) queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] })
    })
  }, [queryClient, projectId])

  // Per-task owner OVERRIDE — picking a person sticks (owner_source='manual'); "unassign"
  // reverts to inheriting the SITE owner (owner_source='auto'). The engine never touches a manual one.
  const setOwner = useCallback((taskId: string, ownerId: string | null) => {
    const src = ownerId ? 'manual' : 'auto'
    queryClient.setQueryData(['project_tasks_v2', projectId], (old: Task[] | undefined) =>
      old?.map((t) => (t.task_id === taskId ? { ...t, owner_id: ownerId, owner_source: src } : t)))
    supabase.from('site_tasks').update({ owner_id: ownerId, owner_source: src }).eq('task_id', taskId).then(({ error }) => {
      if (error) queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] })
    })
  }, [queryClient, projectId])

  // Per-task status (mark active / done) — optimistic, appends to status_history. Shared by the
  // List row and the Sequence drawer (both render TaskDetail, both call this through TaskCtx).
  const setStatus = useCallback((taskId: string, status: 'not_started' | 'active' | 'done') => {
    const ev = { status, at: new Date().toISOString(), by: session.user.id }
    queryClient.setQueryData(['project_tasks_v2', projectId], (old: Task[] | undefined) =>
      old?.map((t) => (t.task_id === taskId ? { ...t, status, status_history: [...(t.status_history ?? []), ev] } : t)))
    supabase.from('site_tasks').update({ status }).eq('task_id', taskId).then(({ error }) => {
      if (error) queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] })
      // refresh the Sequence's completion state so the timeline / blocks reflect the new status
      queryClient.invalidateQueries({ queryKey: ['seq_task_status', projectId] })
    })
  }, [queryClient, projectId, session.user.id])

  // SITE owner (the project supervisor) — the primary, site-level assignment. Optimistic.
  const setSupervisor = useCallback((id: string | null) => {
    queryClient.setQueryData(['project', projectId], (old: Record<string, unknown> | undefined) => (old ? { ...old, supervisor_id: id } : old))
    supabase.from('projects').update({ supervisor_id: id }).eq('project_id', projectId).then(({ error }) => {
      if (error) queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    })
  }, [queryClient, projectId])

  // Project start date — the anchor the whole schedule rolls off.
  const setStartDate = useCallback((iso: string) => {
    queryClient.setQueryData(['project', projectId], (old: Record<string, unknown> | undefined) => (old ? { ...old, start_date: iso } : old))
    supabase.from('projects').update({ start_date: iso }).eq('project_id', projectId).then(({ error }) => {
      if (error) queryClient.invalidateQueries({ queryKey: ['project', projectId] })
    })
  }, [queryClient, projectId])

  // Drag-to-reorder — move `fromId` to `toId`'s slot, renumber seq_no 1..N, persist the rows
  // that changed (optimistic; resync on error). seq_no IS the construction sequence.
  const reorder = useCallback((fromId: string, toId: string) => {
    const old = queryClient.getQueryData<Task[]>(['project_tasks_v2', projectId])
    if (!old) return
    const arr = [...old].sort(bySeq)
    const from = arr.findIndex((t) => t.task_id === fromId)
    const to = arr.findIndex((t) => t.task_id === toId)
    if (from < 0 || to < 0 || from === to) return
    const [moved] = arr.splice(from, 1)
    arr.splice(to, 0, moved)
    const renum = arr.map((t, i) => (t.seq_no === i + 1 ? t : { ...t, seq_no: i + 1 }))
    queryClient.setQueryData(['project_tasks_v2', projectId], renum)
    const changed = renum.filter((t) => old.find((x) => x.task_id === t.task_id)?.seq_no !== t.seq_no)
    Promise.all(changed.map((t) => supabase.from('site_tasks').update({ seq_no: t.seq_no }).eq('task_id', t.task_id)))
      .then((rs) => { if (rs.some((r) => r.error)) queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] }) })
  }, [queryClient, projectId])

  // Place a freshly-created task immediately AFTER `afterId` (renumber + persist), so a hover-inserted
  // task lands exactly where it was asked for instead of at the end.
  const placeAfter = useCallback((newId: string, afterId: string) => {
    const old = queryClient.getQueryData<Task[]>(['project_tasks_v2', projectId])
    if (!old) return
    const arr = [...old].sort(bySeq)
    const fromIdx = arr.findIndex((t) => t.task_id === newId)
    if (fromIdx < 0) return
    const [moved] = arr.splice(fromIdx, 1)
    const afterIdx = arr.findIndex((t) => t.task_id === afterId)
    arr.splice(afterIdx < 0 ? arr.length : afterIdx + 1, 0, moved)
    const renum = arr.map((t, i) => (t.seq_no === i + 1 ? t : { ...t, seq_no: i + 1 }))
    queryClient.setQueryData(['project_tasks_v2', projectId], renum)
    const changed = renum.filter((t) => old.find((x) => x.task_id === t.task_id)?.seq_no !== t.seq_no)
    Promise.all(changed.map((t) => supabase.from('site_tasks').update({ seq_no: t.seq_no }).eq('task_id', t.task_id)))
      .then((rs) => { if (rs.some((r) => r.error)) queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] }) })
  }, [queryClient, projectId])

  // S1-1: loading/error gate — skeleton while loading, retry card on error or a >12s hang (never an
  // infinite spinner). Success render below is unchanged.
  const tasksGate = useQueryGate({ isLoading, isError, hasData: tasks.length > 0, refetch, skeleton: <PageSkeleton />, label: 'your tasks' })
  if (tasksGate) return tasksGate

  // Flat construction order — by seq_no, NOT grouped by floor/module. seq_no is the sequence.
  const ordered = [...tasks].sort(bySeq)
  const levels = [...new Set(tasks.map((t) => t.floor_label).filter(Boolean))] as string[]
  const levelCount = levels.length
  // Enrichment stats are over GENERATED tasks only — manual tasks carry no description/QC by
  // design, so they must not count as "pending" or trip the retry banner.
  const genTasks = tasks.filter((t) => t.source !== 'manual')
  const detailed = genTasks.filter((t) => t.description).length
  const allDetailed = genTasks.length > 0 && detailed === genTasks.length
  const anyPending = genTasks.some((t) => !t.description)
  const hasStack = !!project?.construction_stack

  // Project-level QC progress — aggregate every generated task's checks.
  const proj = genTasks.reduce(
    (a, t) => { const pp = qcProgress(t.site_task_qc ?? []); a.total += pp.total; a.passed += pp.passed; a.failed += pp.failed; return a },
    { total: 0, passed: 0, failed: 0 },
  )
  const projPct = proj.total ? Math.round((proj.passed / proj.total) * 100) : 0

  // A pending task's sub-text shimmers while enrich is running (or about to fire on a fresh,
  // wholly-unenriched project); once enrich has settled it switches to a quiet "unavailable"
  // rather than shimmering forever. enriched tasks ignore this entirely.
  const allUnenriched = genTasks.length > 0 && detailed === 0
  const pendingMode: 'shimmer' | 'unavailable' =
    enrichState === 'running' || (enrichState === 'idle' && allUnenriched) ? 'shimmer' : 'unavailable'
  // Offer a manual re-enrich whenever tasks are still pending and nothing is running — covers a
  // failed/partial run AND a remount mid-enrich (idle with some already filled). Never on a
  // fresh, wholly-unenriched project (that auto-fires above).
  const showRetry = anyPending && enrichState !== 'running' && !(enrichState === 'idle' && allUnenriched)
  const nextSeq = tasks.reduce((m, t) => Math.max(m, t.seq_no), 0) + 1

  // cascade index = position in the flat sequence
  const lineIndex = new Map<string, number>()
  ordered.forEach((t, i) => lineIndex.set(t.task_id, i))

  // ── schedule roll-up ── start_date + cumulative durations down the sequence.
  const startISO = project?.start_date as string | undefined
  const schedule = new Map<string, { start: Date; end: Date }>()
  let projFinish: Date | null = null
  if (startISO) {
    let cursor = new Date(startISO)
    for (const t of ordered) {
      const dur = Math.max(1, t.duration_days ?? DEFAULT_DURATION)
      const start = new Date(cursor)
      const end = addDays(start, dur - 1)
      schedule.set(t.task_id, { start, end })
      projFinish = end
      cursor = addDays(end, 1)
    }
  }
  const totalDays = ordered.reduce((s, t) => s + Math.max(1, t.duration_days ?? DEFAULT_DURATION), 0)

  // ── PHASE grouping (the construction work-breakdown) — phases in sequence order, tasks by
  //    seq within each. The flat dump becomes a structured, focused plan. ──
  type PhaseGroup = { phase: string; items: Task[]; done: number; active: number; total: number; allDone: boolean; start: Date | null; end: Date | null }
  const phaseGroups: PhaseGroup[] = (() => {
    const order: string[] = []
    const map = new Map<string, Task[]>()
    for (const t of ordered) {
      if (!map.has(t.phase)) { map.set(t.phase, []); order.push(t.phase) }
      map.get(t.phase)!.push(t)
    }
    return order.map((phase) => {
      const items = map.get(phase)!
      const done = items.filter((t) => t.status === 'done').length
      const active = items.filter((t) => t.status === 'active').length
      const sc = items.map((t) => schedule.get(t.task_id)).filter(Boolean) as { start: Date; end: Date }[]
      return { phase, items, done, active, total: items.length, allDone: items.length > 0 && done === items.length, start: sc[0]?.start ?? null, end: sc.length ? sc[sc.length - 1].end : null }
    })
  })()
  // The "current" phase = the first not-fully-done one — the natural focus.
  const currentPhaseIdx = phaseGroups.findIndex((g) => !g.allDone)
  const phaseIsOpen = (g: PhaseGroup, idx: number): boolean => {
    if (g.phase in phaseOpen) return phaseOpen[g.phase]          // user override wins
    if (g.allDone) return false                                  // done → collapsed
    if (g.active > 0) return true                                // anything active → open
    return currentPhaseIdx !== -1 && idx === currentPhaseIdx     // the current phase → open; future → collapsed
  }
  const togglePhase = (g: PhaseGroup, idx: number) => setPhaseOpen((o) => ({ ...o, [g.phase]: !phaseIsOpen(g, idx) }))
  const tasksDone = tasks.filter((t) => t.status === 'done').length
  const taskPct = tasks.length ? Math.round((tasksDone / tasks.length) * 100) : 0

  const anim = { doCascade, cascadeDone, lineIndex, pendingMode }
  const toggleTask = (id: string) => setExpanded((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const refetchTasks = () => queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] })

  // drag handlers shared by every row
  const drag = {
    draggingId: dragId,
    overId,
    start: (id: string) => setDragId(id),
    over: (id: string) => setOverId((cur) => (cur === id ? cur : id)),
    drop: (toId: string) => { if (dragId && dragId !== toId) reorder(dragId, toId); setDragId(null); setOverId(null) },
    end: () => { setDragId(null); setOverId(null) },
  }

  const memberName = (id: string | null | undefined) => (id ? (members.find((m) => m.id === id)?.name ?? 'Assigned') : 'Unassigned')
  const supervisorId = (project?.supervisor_id as string | null) ?? null
  const principalId = members.find((m) => m.role === 'principal')?.id ?? null
  const taskCtx: TaskCtxValue = {
    orgId: (project?.org_id as string) ?? '',
    authorId: session.user.id,
    authorName: me?.name ?? '',
    members,
    ownerName: memberName,
    supervisorId,
    principalId,
    setQc,
    setDuration,
    setOwner,
    setStatus,
  }

  // level options for the manual add form: existing levels + Site-wide.
  const levelOptions = [
    ...levels.map((l) => ({ value: l, label: isParking(l) ? l : `${l} Floor` })),
    { value: '__sitewide__', label: 'Site-wide' },
  ]

  // the List view is retired (the Sequence + its drawer carry everything); its JSX is retained
  // dormant behind this flag so "views later" is a one-line flip, not a re-build.
  const showLegacyList = false as boolean

  return (
    <div style={{ minHeight: '100vh', background: DARK_CANVAS }}>
      <style>{KEYFRAMES}</style>

      {/* THE VIEW — the engine Sequence, full-bleed on one dark canvas. The retired List's full task
          surface now lives entirely in the Sequence drawer (the one shared TaskDetail). */}
      {tasks.length > 0 ? (
        <TaskCtx.Provider value={taskCtx}>
          <div style={{ paddingTop: filterSlot ? 8 : 0 }}>
            <ProjectSequence projectId={projectId} headerSlot={
              // project assignee (site supervisor) — subtle, in the sequence header next to the name
              <button onClick={() => setSiteOwnerPick(true)} title="Project assignee"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 999, padding: '4px 12px 4px 4px', cursor: 'pointer' }}>
                {supervisorId ? <MemberAvatar name={memberName(supervisorId)} size={20} /> : <span style={{ width: 20, height: 20, borderRadius: '50%', border: '1.5px dashed rgba(255,255,255,0.3)' }} />}
                <span style={{ fontSize: 12, fontWeight: 600, color: supervisorId ? '#f4f3f1' : '#a8a6a3' }}>{supervisorId ? memberName(supervisorId) : 'Assign lead'}</span>
              </button>
            } />
          </div>
        </TaskCtx.Provider>
      ) : (
        <div className="mx-auto w-full" style={{ maxWidth: 600, padding: '70px 18px 90px' }}>
          <EmptyState hasStack={hasStack} onSetUp={() => setShowSetup(true)} />
        </div>
      )}

      {/* ── LEGACY List view — kept DORMANT (never rendered) so views can return later. ── */}
      {showLegacyList && (
      <div className="mx-auto w-full max-w-[880px]" style={{ padding: '30px 26px 110px', background: CREAM, borderRadius: 22 }}>
        {/* ── header ───────────────────────────────────────────────────── */}
        {filterSlot
          ? <div style={{ marginBottom: 4 }}>{filterSlot}</div>
          : (
            <Link to={`/projects/${projectId}`} style={{ fontSize: 13, color: INK_SOFT, textDecoration: 'none', fontWeight: 500 }}>
              ‹ {project?.name ?? 'Project'}
            </Link>
          )}
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginTop: 10, flexWrap: 'wrap' }}>
          <div>
            <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, color: INK, margin: 0, letterSpacing: '-0.01em' }}>Project Management</h1>
            {tasks.length > 0 && (
              <p style={{ fontSize: 14, color: INK_SOFT, margin: '6px 0 0' }}>
                {tasks.length} tasks · {levelCount} {levelCount === 1 ? 'level' : 'levels'} ·{' '}
                <strong style={{ color: taskPct === 100 ? SAGE : TERRA, fontWeight: 700 }}>{taskPct}% done</strong>
                {currentPhaseIdx >= 0 && <> · now on <strong style={{ color: INK, fontWeight: 600 }}>{titleCase(phaseGroups[currentPhaseIdx].phase)}</strong></>}
                {!allDetailed && <span style={{ color: INK_FAINT }}> · {!detailed ? 'details pending' : `${detailed}/${genTasks.length} detailed`}</span>}
              </p>
            )}
            {tasks.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: INK_SOFT }}>
                  <span style={{ fontWeight: 600 }}>Start date</span>
                  <input
                    type="date"
                    value={(startISO ?? '').slice(0, 10)}
                    onChange={(e) => e.target.value && setStartDate(e.target.value)}
                    style={{ fontSize: 12.5, fontFamily: 'inherit', color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '5px 9px', outline: 'none', cursor: 'pointer' }}
                  />
                </label>
                <span style={{ fontSize: 12.5, color: INK_FAINT }}>
                  {totalDays} working day{totalDays === 1 ? '' : 's'}
                  {projFinish ? <> · finishes <strong style={{ color: TERRA, fontWeight: 600 }}>{fmtDate(projFinish as Date)}</strong></> : ' · set a start date to schedule'}
                </span>
              </div>
            )}
            {/* SITE OWNER — the project-level assignment every task inherits by default */}
            {tasks.length > 0 && (
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, marginTop: 10 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: INK_SOFT }}>Site owner</span>
                <button onClick={() => setSiteOwnerPick(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '4px 11px 4px 4px', cursor: 'pointer' }}>
                  {supervisorId ? <MemberAvatar name={memberName(supervisorId)} size={20} /> : <span style={{ width: 20, height: 20, borderRadius: '50%', border: `1.5px dashed ${INK_FAINT}` }} />}
                  <span style={{ fontSize: 12.5, fontWeight: 600, color: supervisorId ? INK : INK_SOFT }}>{supervisorId ? memberName(supervisorId) : 'Assign supervisor'}</span>
                </button>
              </div>
            )}
          </div>
          {tasks.length > 0 && (
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              {/* View toggle — List (operational: QC, owners, dates) vs Sequence (engine timeline) */}
              <div style={{ display: 'inline-flex', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: 2 }}>
                {(['list', 'sequence'] as const).map((v) => (
                  <button key={v} onClick={() => setView(v)}
                    style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: 'pointer',
                      background: view === v ? TERRA : 'transparent', color: view === v ? '#fff' : INK_SOFT, textTransform: 'capitalize' }}>
                    {v}
                  </button>
                ))}
              </div>
              <button
                onClick={() => setShowAdd(true)}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', boxShadow: '0 1px 2px rgba(34,26,19,0.04)' }}
              >
                <span style={{ fontSize: 16, lineHeight: 1, color: TERRA, marginTop: -1 }}>+</span> Add task
              </button>
            </div>
          )}
        </div>

        {/* ── SEQUENCE VIEW — the engine timeline (dry-run; renders the ProjectVM, computes nothing).
            Wrapped in the SAME TaskCtx so the drawer's shared TaskDetail uses the page's mutations. ── */}
        {view === 'sequence' && tasks.length > 0 && (
          <TaskCtx.Provider value={taskCtx}>
            <div style={{ marginTop: 20 }}><ProjectSequence projectId={projectId} /></div>
          </TaskCtx.Provider>
        )}

        {/* ── project-level QC progress ───────────────────────────────────── */}
        {view === 'list' && proj.total > 0 && (
          <div style={{ marginTop: 18, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 14, padding: '14px 16px' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, marginBottom: 9 }}>
              <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, letterSpacing: '0.02em' }}>Site progress</span>
              <span style={{ fontSize: 12, color: INK_SOFT }}>
                <strong style={{ color: projPct === 100 ? SAGE : TERRA, fontSize: 13 }}>{projPct}%</strong>
                {' · '}{proj.passed}/{proj.total} checks passed{proj.failed > 0 ? ` · ${proj.failed} failed` : ''}
              </span>
            </div>
            <div style={{ height: 7, borderRadius: 99, background: 'rgba(34,26,19,0.07)', overflow: 'hidden', display: 'flex' }}>
              <div style={{ width: `${projPct}%`, background: SAGE, transition: 'width 300ms ease' }} />
              {proj.failed > 0 && <div style={{ width: `${(proj.failed / proj.total) * 100}%`, background: FAIL, opacity: 0.55, transition: 'width 300ms ease' }} />}
            </div>
          </div>
        )}

        {/* Enrich in flight — explains the shimmer (2c). Quiet, pulsing. */}
        {enrichState === 'running' && (
          <div style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999, background: `${TERRA}10`, border: `1px solid ${TERRA}22` }}>
            <span className="animate-pulse" style={{ width: 7, height: 7, borderRadius: '50%', background: TERRA }} />
            <span style={{ fontSize: 12.5, fontWeight: 500, color: TERRA }}>Preparing task details…</span>
          </div>
        )}

        {/* Enrich failed / partial — honest, with a manual retry (never shimmer forever). */}
        {showRetry && (
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 12, background: '#fff', border: `1px solid ${LINE}` }}>
            <span style={{ fontSize: 13, color: INK_SOFT, flex: 1 }}>Some task details couldn’t be prepared.</span>
            <button onClick={runEnrich} style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: TERRA, border: 'none', borderRadius: 8, padding: '7px 14px', cursor: 'pointer' }}>Retry</button>
          </div>
        )}

        {/* ── empty state — set up & generate ──────────────────────────── */}
        {tasks.length === 0 && (
          <EmptyState hasStack={hasStack} onSetUp={() => setShowSetup(true)} />
        )}

        {/* Platform-UI narration entry — confirmation-back shows right here (Part 1, UI channel) */}
        {view === 'list' && ordered.length > 0 && <NarrationComposer projectId={projectId} onLogged={refetchTasks} />}

        {/* ── the plan — grouped into PHASES (construction order); done/future collapse, current opens ──── */}
        {view === 'list' && ordered.length > 0 && (
          <TaskCtx.Provider value={taskCtx}>
            <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {phaseGroups.map((g, idx) => {
                const open = phaseIsOpen(g, idx)
                const pct = Math.round((g.done / g.total) * 100)
                const isCurrent = idx === currentPhaseIdx
                const chip = g.allDone ? { label: 'Done', c: SAGE }
                  : g.active > 0 ? { label: `${g.active} active`, c: TERRA }
                  : isCurrent ? { label: 'Up next', c: TERRA }
                  : { label: 'Upcoming', c: INK_FAINT }
                return (
                  <div key={g.phase} style={{ background: '#fff', border: `1px solid ${isCurrent && !g.allDone ? `${TERRA}40` : LINE}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(34,26,19,0.03)' }}>
                    <button onClick={() => togglePhase(g, idx)}
                      style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 16px', background: isCurrent && !g.allDone ? `${TERRA}08` : 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                      <span style={{ fontSize: 14, color: INK_FAINT, transition: 'transform .2s', transform: open ? 'rotate(90deg)' : 'none', flexShrink: 0 }}>›</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
                          <span style={{ fontFamily: SERIF, fontSize: 17, fontWeight: 600, color: g.allDone ? INK_SOFT : INK, letterSpacing: '-0.01em' }}>{titleCase(g.phase)}</span>
                          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 10, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase', color: chip.c, background: 'rgba(34,26,19,0.045)', border: `1px solid ${LINE}`, borderRadius: 999, padding: '2px 8px' }}>
                            <span style={{ width: 5, height: 5, borderRadius: '50%', background: chip.c }} />{chip.label}
                          </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 6, flexWrap: 'wrap' }}>
                          <div style={{ width: 120, height: 5, borderRadius: 99, background: 'rgba(34,26,19,0.08)', overflow: 'hidden', flexShrink: 0 }}>
                            <div style={{ width: `${pct}%`, height: '100%', background: g.allDone ? SAGE : TERRA, transition: 'width .35s ease' }} />
                          </div>
                          <span style={{ fontSize: 11.5, color: INK_FAINT }}>{g.done}/{g.total} done{g.start ? ` · ${fmtDate(g.start)}–${fmtDate(g.end!)}` : ''}</span>
                        </div>
                      </div>
                    </button>
                    {open && (
                      <div style={{ borderTop: `1px solid ${LINE}` }}>
                        {g.items.map((t) => (
                          <TaskRow key={t.task_id} task={t} expanded={expanded.has(t.task_id)} onToggle={() => toggleTask(t.task_id)} anim={anim} drag={drag} sched={schedule.get(t.task_id)} atRisk={atRiskByTask[t.task_id]} onDismissRisk={dismissRisk} onInsertAfter={(tk) => { setAddAfter({ afterId: tk.task_id, floor: tk.floor_label }); setShowAdd(true) }} />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          </TaskCtx.Provider>
        )}

        {/* subtle add-task affordance after the plan */}
        {tasks.length > 0 && (
          <button
            onClick={() => setShowAdd(true)}
            style={{ marginTop: 16, width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, fontSize: 13.5, fontWeight: 600, color: INK_SOFT, background: 'transparent', border: `1.5px dashed ${LINE}`, borderRadius: 14, padding: '14px', cursor: 'pointer', transition: 'border-color 160ms, color 160ms' }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = TERRA; e.currentTarget.style.color = TERRA }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = LINE; e.currentTarget.style.color = INK_SOFT }}
          >
            <span style={{ fontSize: 17, lineHeight: 1, marginTop: -2 }}>+</span> Add a task manually
          </button>
        )}
      </div>
      )}

      {/* site-owner (supervisor) picker — the site-level assignment tasks inherit */}
      {siteOwnerPick && (
        <UserPicker orgId={(project?.org_id as string) ?? ''} currentId={supervisorId} title="Assign site owner (supervisor)"
          onPick={(id) => { setSupervisor(id); setSiteOwnerPick(false) }} onClose={() => setSiteOwnerPick(false)} />
      )}

      {/* ── modals ───────────────────────────────────────────────────── */}
      {showSetup && project && (
        <Modal title="Set up the task plan" onClose={() => setShowSetup(false)}>
          <ConstructionConfig
            projectId={projectId}
            projectType={(project.project_type as string) ?? 'Residential'}
            onComplete={() => { setShowSetup(false); firedRef.current = false; refetchTasks() }}
            onSkip={() => setShowSetup(false)}
          />
        </Modal>
      )}

      {showAdd && project && (
        <Modal title={addAfter ? 'Insert a task here' : 'Add a task'} onClose={() => { setShowAdd(false); setAddAfter(null) }}>
          <AddTaskForm
            projectId={projectId}
            orgId={(project.org_id as string) ?? ''}
            levelOptions={levelOptions}
            nextSeq={nextSeq}
            prefillFloor={addAfter?.floor ?? null}
            onClose={() => { setShowAdd(false); setAddAfter(null) }}
            onAdded={async (newId) => {
              setShowAdd(false)
              const target = addAfter
              setAddAfter(null)
              await queryClient.invalidateQueries({ queryKey: ['project_tasks_v2', projectId] })
              if (target && newId) placeAfter(newId, target.afterId)
            }}
          />
        </Modal>
      )}
    </div>
  )
}

// ── context-aware mount (P1.4) ───────────────────────────────────────────────
// One Task Manager, two contexts. The filter chrome ADAPTS:
//   • INSIDE a project (/projects/:id/tasks) → projectId is inherited from the URL, NO filter.
//   • GLOBAL (/tasks) → managing across projects, so show a PROJECT FILTER; the chosen project
//     scopes the same body. Mirrors the global=choose / scoped=inherited model used elsewhere
//     (Site Desk vs a project's Issues page).
export default function ProjectTasks({ session }: { session: Session }) {
  const { projectId: routeProjectId } = useParams<{ projectId: string }>()
  // Scoped mount: the URL carries the project → render the body directly, no filter.
  if (routeProjectId) return <ProjectTasksScoped session={session} projectId={routeProjectId} />
  // Global mount: no project in the URL → choose one via the filter.
  return <GlobalTaskManager session={session} />
}

function GlobalTaskManager({ session }: { session: Session }) {
  const { orgId } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [pickedState, setPicked] = useState('')
  const prefetch = useCallback((id: string) => prefetchProjectQueries(queryClient, id), [queryClient])

  const { data: projects = [], isLoading } = useQuery({
    // RLS already scopes projects to the user's org(s); match the rest of the app (BriklayRail,
    // Logbook) and DON'T gate on a possibly-undefined orgId — that was hiding real projects.
    queryKey: ['tm_projects', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('projects').select('project_id, name').eq('status', 'Active').order('name')
      if (error) { console.error('tm_projects:', error.message); return [] as { project_id: string; name: string }[] }
      return (data ?? []) as { project_id: string; name: string }[]
    },
  })

  // Open straight into a project — auto-select the first one (no chooser wizard). The side rail
  // stays available to switch. A manual pick (pickedState) overrides.
  const picked = pickedState || projects[0]?.project_id || ''

  return (
    <div style={{ minHeight: '100vh', background: DARK_CANVAS, position: 'relative' }}>
      <style>{KEYFRAMES}</style>
      {/* the chosen project's sequence renders behind the floating side switcher */}
      {picked && <ProjectTasksScoped key={picked} session={session} projectId={picked} filterSlot={<span />} />}
      {/* the side switcher (compact name scroller) + add-project; the full chooser only appears if
          there are no projects yet. */}
      <ProjectSelector projects={projects} picked={picked} loading={isLoading} onPick={setPicked} onPrefetch={prefetch} onAdd={() => navigate('/projects/new')} />
    </div>
  )
}

// ── PROJECT SELECTOR — names only, no cards. Two states sharing one element, with a subtle morph:
//    CENTRE (nothing chosen): a vertical, scroll-reactive column of project names (the centred one
//    lifts + brightens, neighbours recede — the floor-timeline's depth language, vertical). Picking
//    one fades this away as the COMPACT selector glides into the top-left corner. Reopen to switch.
function ProjectSelector({ projects, picked, loading = false, onPick, onPrefetch, onAdd }: {
  projects: { project_id: string; name: string }[]; picked: string; loading?: boolean
  onPick: (id: string) => void; onPrefetch?: (id: string) => void; onAdd: () => void
}) {
  const EASE = 'cubic-bezier(.22,.61,.36,1)'
  // the full chooser only shows when there's genuinely nothing selected and nothing loading (i.e. an
  // empty org). With projects present we open straight into one, so this stays hidden.
  const showChooser = !picked && !loading

  return (
    <>
      {/* CENTRE chooser — only for the no-projects-yet state */}
      <div className="proj-centre" style={{
        zIndex: showChooser ? 60 : 5, display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center', padding: '0 16px',
        opacity: showChooser ? 1 : 0, transform: showChooser ? 'none' : 'scale(.96) translateY(-18px)',
        pointerEvents: showChooser ? 'auto' : 'none', transition: `opacity .5s ease, transform .55s ${EASE}`,
      }}>
        <p style={{ fontSize: 11, fontWeight: 700, color: TERRA, letterSpacing: '0.16em', textTransform: 'uppercase', margin: 0 }}>Across every site</p>
        {projects.length > 0
          ? <NameScroller projects={projects} picked={picked} onPick={onPick} onPrefetch={onPrefetch} />
          : <p style={{ color: '#a8a6a3', fontSize: 14, margin: '24px 0' }}>No active projects yet.</p>}
        <button onClick={onAdd} style={{ marginTop: 4, fontSize: 13, fontWeight: 600, color: '#a8a6a3', background: 'transparent', border: '1px solid #34343c', borderRadius: 999, padding: '9px 18px', cursor: 'pointer' }}>+ New project</button>
      </div>

      {/* SIDE scroller — the SAME scrolling name column, smaller, parked top-left. Keep scrolling /
          tapping to switch projects without leaving the sequence. Glides in after a pick. */}
      {picked && projects.length > 0 && (
        <div className="proj-side" style={{
          opacity: picked ? 1 : 0, transform: picked ? 'none' : 'translateX(-16px)',
          transition: `opacity .55s .12s ease, transform .6s .12s ${EASE}`,
        }}>
          <p style={{ fontSize: 9, fontWeight: 700, color: TERRA, letterSpacing: '0.16em', textTransform: 'uppercase', margin: '0 0 2px 12px' }}>Project</p>
          <NameScroller projects={projects} picked={picked} onPick={onPick} onPrefetch={onPrefetch} compact />
        </div>
      )}

      {/* add-project, floating quietly over the sequence (top-right); brightens on hover */}
      {picked && (
        <button className="addproj-hot proj-add" onClick={onAdd} title="New project"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, fontWeight: 600, color: '#f4f3f1', background: 'rgba(25,25,29,.7)', border: '1px solid #34343c', borderRadius: 999, padding: '8px 14px', cursor: 'pointer', backdropFilter: 'blur(8px)' }}>
          <span style={{ fontSize: 15, color: TERRA, marginTop: -1 }}>+</span> New project
        </button>
      )}
    </>
  )
}

// The scrollable column of project NAMES — depth-painted by distance from centre. Used full-size as
// the centre chooser, and `compact` as the small top-left side rail (auto-centres the selected one).
function NameScroller({ projects, picked, onPick, onPrefetch, compact = false }: {
  projects: { project_id: string; name: string }[]; picked: string
  onPick: (id: string) => void; onPrefetch?: (id: string) => void; compact?: boolean
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLDivElement | null)[]>([])
  const [centerIdx, setCenterIdx] = useState(() => { const i = projects.findIndex((p) => p.project_id === picked); return i < 0 ? 0 : i })

  // depth paint (visual only — never setState here)
  const paint = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    const mid = c.scrollTop + c.clientHeight / 2
    itemRefs.current.forEach((el) => {
      if (!el) return
      const d = Math.min(1, Math.abs((el.offsetTop + el.offsetHeight / 2) - mid) / (c.clientHeight * 0.42))
      const k = 1 - d
      el.style.opacity = (0.16 + 0.84 * k).toFixed(3)
      el.style.transform = `scale(${(0.8 + 0.2 * k).toFixed(3)})`   // same depth as the master slider
      el.style.color = k > 0.62 ? '#f4f3f1' : '#6c6a68'
    })
  }, [])
  const trackCenter = useCallback(() => {
    const c = scrollRef.current
    if (!c) return
    const mid = c.scrollTop + c.clientHeight / 2
    let best = 0, bd = 1e9
    itemRefs.current.forEach((el, i) => { if (!el) return; const dd = Math.abs((el.offsetTop + el.offsetHeight / 2) - mid); if (dd < bd) { bd = dd; best = i } })
    setCenterIdx((prev) => (prev === best ? prev : best))
  }, [])
  const scrollToIdx = (i: number) => {
    const c = scrollRef.current, el = itemRefs.current[i]
    if (c && el) c.scrollTo({ top: el.offsetTop + el.offsetHeight / 2 - c.clientHeight / 2, behavior: 'smooth' })
  }

  // bring the selected project to centre (compact rail); paint once. No setState here.
  useEffect(() => {
    const c = scrollRef.current
    if (compact && c && picked) {
      const i = projects.findIndex((p) => p.project_id === picked)
      const el = itemRefs.current[i]
      if (el) c.scrollTop = el.offsetTop + el.offsetHeight / 2 - c.clientHeight / 2
    }
    paint()
  }, [paint, picked, projects, compact])
  // warm the cache for the centred project so picking it (scroll or click) shows tasks instantly
  useEffect(() => { const p = projects[centerIdx]; if (p) onPrefetch?.(p.project_id) }, [centerIdx, projects, onPrefetch])

  const ARROW = `${compact ? 0.5 : 1}`
  return (
    <div style={{ position: 'relative', width: compact ? 'clamp(150px, 24vw, 210px)' : '100%', maxWidth: compact ? undefined : 520 }}>
      {centerIdx > 0 && (
        <button onClick={() => scrollToIdx(centerIdx - 1)} aria-label="Previous project" style={{ ...arrowChip, top: -2, opacity: ARROW }}>▲</button>
      )}
      <div ref={scrollRef} onScroll={() => { paint(); trackCenter() }} style={{
        width: '100%', height: compact ? 'min(52vh, 400px)' : 'min(56vh, 440px)', overflowY: 'auto', scrollSnapType: 'y mandatory',
        // height-based padding (NOT % — that resolves against WIDTH) so the first/last names can scroll
        // to centre, exactly like the main chooser. This is what makes the side rail scroll properly.
        padding: compact ? 'min(26vh, 190px) 0' : '24vh 0', textAlign: compact ? 'left' : 'center', scrollbarWidth: 'none',
        WebkitMaskImage: 'linear-gradient(180deg,transparent,#000 26%,#000 74%,transparent)', maskImage: 'linear-gradient(180deg,transparent,#000 26%,#000 74%,transparent)',
      }}>
        {projects.map((p, i) => (
          <div key={p.project_id} ref={(el) => { itemRefs.current[i] = el }} className="proj-name" onClick={() => onPick(p.project_id)} onMouseEnter={() => onPrefetch?.(p.project_id)}
            style={{ scrollSnapAlign: 'center', cursor: 'pointer', padding: compact ? '8px 12px' : '12px 14px', fontFamily: SERIF, fontSize: compact ? 'clamp(15px, 3vw, 19px)' : 'clamp(22px, 5vw, 30px)', fontWeight: compact && p.project_id === picked ? 600 : 500, letterSpacing: '-0.01em', willChange: 'transform, opacity', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {p.name}
          </div>
        ))}
      </div>
      {centerIdx < projects.length - 1 && (
        <button onClick={() => scrollToIdx(centerIdx + 1)} aria-label="Next project" style={{ ...arrowChip, bottom: -2, opacity: ARROW }}>▼</button>
      )}
    </div>
  )
}
const arrowChip: CSSProperties = {
  position: 'absolute', left: '50%', transform: 'translateX(-50%)', zIndex: 2, width: 26, height: 26, borderRadius: '50%',
  border: '1px solid #34343c', background: 'rgba(20,20,24,0.66)', backdropFilter: 'blur(6px)', color: '#a8a6a3',
  fontSize: 9, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0,
}

// ── empty state — beautiful set-up card ──────────────────────────────────────
function EmptyState({ hasStack, onSetUp }: { hasStack: boolean; onSetUp: () => void }) {
  return (
    <div style={{ marginTop: 36, padding: '52px 32px', textAlign: 'center', background: '#fff', borderRadius: 22, border: `1px solid ${LINE}`, boxShadow: '0 1px 3px rgba(34,26,19,0.04)' }}>
      <div style={{ width: 52, height: 52, margin: '0 auto', borderRadius: 16, background: `${TERRA}12`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
          <path d="M12 2L2 7L12 12L22 7L12 2Z" stroke={TERRA} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M2 17L12 22L22 17" stroke={TERRA} strokeWidth="1.5" strokeLinejoin="round" />
          <path d="M2 12L12 17L22 12" stroke={TERRA} strokeWidth="1.5" strokeLinejoin="round" />
        </svg>
      </div>
      <p style={{ fontFamily: SERIF, fontSize: 23, color: INK, margin: '18px 0 0' }}>Build the task plan</p>
      <p style={{ fontSize: 14.5, lineHeight: 1.55, color: INK_SOFT, margin: '8px auto 0', maxWidth: 420 }}>
        {hasStack
          ? 'The build type is set. Generate the full construction task plan — every level, trade and stage in site order.'
          : 'Answer three quick questions about the build — parking, floors, units — and we’ll generate the whole construction task plan automatically.'}
      </p>
      <button
        onClick={onSetUp}
        style={{ marginTop: 24, display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 14.5, fontWeight: 600, color: '#fff', background: TERRA, border: 'none', borderRadius: 12, padding: '12px 22px', cursor: 'pointer', boxShadow: `0 6px 18px ${TERRA}33` }}
      >
        {hasStack ? 'Generate task plan' : 'Set up & generate'}
      </button>
    </div>
  )
}

// ── lightweight centered modal (matches the page's self-styled aesthetic) ─────
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div
      onClick={onClose}
      style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(34,26,19,0.32)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, animation: 'siteSubIn 160ms ease' }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ width: '100%', maxWidth: 460, maxHeight: '90vh', overflowY: 'auto', background: CREAM, borderRadius: 22, border: `1px solid ${LINE}`, boxShadow: '0 24px 64px rgba(34,26,19,0.28)', padding: 24, animation: 'siteSettle 220ms cubic-bezier(.16,1,.3,1)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <h2 style={{ fontFamily: SERIF, fontSize: 21, fontWeight: 600, color: INK, margin: 0 }}>{title}</h2>
          <button onClick={onClose} aria-label="Close" style={{ width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: INK_FAINT, fontSize: 20, cursor: 'pointer', lineHeight: 1 }}>×</button>
        </div>
        {children}
      </div>
    </div>
  )
}

// ── manual add-task form (name + level + status, appended as source='manual') ─
function AddTaskForm({ projectId, orgId, levelOptions, nextSeq, prefillFloor, onClose, onAdded }: {
  projectId: string; orgId: string
  levelOptions: { value: string; label: string }[]
  nextSeq: number; prefillFloor?: string | null; onClose: () => void; onAdded: (newId?: string) => void
}) {
  const [name, setName] = useState('')
  // when inserting after a hovered task, default to that task's floor so it lands in the right place
  const [level, setLevel] = useState(
    (prefillFloor && levelOptions.some((l) => l.value === prefillFloor) ? prefillFloor : levelOptions[0]?.value) ?? '__sitewide__',
  )
  const [status, setStatus] = useState<'not_started' | 'active' | 'done'>('not_started')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!name.trim()) return
    setBusy(true); setError('')
    const floor_label = level === '__sitewide__' ? null : level
    const { data, error: e } = await supabase.from('site_tasks').insert({
      org_id: orgId,
      project_id: projectId,
      phase: 'custom',
      trade: 'manual',
      floor_label,
      unit_label: null,
      name: name.trim(),
      seq_no: nextSeq,
      status,
      source: 'manual',
    }).select('task_id').single()
    if (e) { setError(e.message); setBusy(false); return }
    onAdded(data?.task_id)
  }

  const fieldStyle: CSSProperties = { width: '100%', fontSize: 14.5, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '11px 13px', outline: 'none' }
  const labelStyle: CSSProperties = { display: 'block', fontSize: 12, fontWeight: 600, color: INK_SOFT, letterSpacing: '0.02em', marginBottom: 6 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <label style={labelStyle}>Task name</label>
        <input
          autoFocus value={name} onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') submit() }}
          placeholder="e.g. Site survey, Temporary fencing"
          style={fieldStyle}
        />
      </div>
      <div>
        <label style={labelStyle}>Level</label>
        <select value={level} onChange={(e) => setLevel(e.target.value)} style={{ ...fieldStyle, cursor: 'pointer' }}>
          {levelOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </div>
      <div>
        <label style={labelStyle}>Status</label>
        <div style={{ display: 'flex', gap: 8 }}>
          {(['not_started', 'active', 'done'] as const).map((s) => {
            const on = status === s
            const txt = s === 'not_started' ? 'Not started' : s === 'active' ? 'Active' : 'Done'
            return (
              <button key={s} onClick={() => setStatus(s)}
                style={{ flex: 1, fontSize: 12.5, fontWeight: 600, padding: '9px 0', borderRadius: 9, cursor: 'pointer', border: `1px solid ${on ? TERRA : LINE}`, background: on ? `${TERRA}10` : '#fff', color: on ? TERRA : INK_SOFT }}>
                {txt}
              </button>
            )
          })}
        </div>
      </div>
      {error && <p style={{ fontSize: 12.5, color: '#B2402A', margin: 0 }}>{error}</p>}
      <div style={{ display: 'flex', gap: 10, marginTop: 4 }}>
        <button onClick={onClose} disabled={busy} style={{ flex: 1, fontSize: 14, fontWeight: 500, color: INK_SOFT, background: 'transparent', border: `1px solid ${LINE}`, borderRadius: 11, padding: '11px', cursor: 'pointer' }}>Cancel</button>
        <button onClick={submit} disabled={busy || !name.trim()} style={{ flex: 1, fontSize: 14, fontWeight: 600, color: '#fff', background: TERRA, border: 'none', borderRadius: 11, padding: '11px', cursor: busy || !name.trim() ? 'default' : 'pointer', opacity: busy || !name.trim() ? 0.55 : 1 }}>{busy ? 'Adding…' : 'Add task'}</button>
      </div>
    </div>
  )
}

interface Anim { doCascade: boolean; cascadeDone: boolean; lineIndex: Map<string, number>; pendingMode: 'shimmer' | 'unavailable' }
interface DragApi {
  draggingId: string | null; overId: string | null
  start: (id: string) => void; over: (id: string) => void; drop: (id: string) => void; end: () => void
}

// ── one task row — flat sequence list, drag-handle reorder, expand for QC + diary ──
function TaskRow({ task, expanded, onToggle, anim, drag, sched, atRisk, onDismissRisk, onInsertAfter }: { task: Task; expanded: boolean; onToggle: () => void; anim: Anim; drag: DragApi; sched?: { start: Date; end: Date }; atRisk?: { id: string; title: string }[]; onDismissRisk?: (issueId: string, taskId: string) => void; onInsertAfter?: (task: Task) => void }) {
  const ctx = useContext(TaskCtx)
  const qc = [...(task.site_task_qc ?? [])].sort((a, b) => a.seq - b.seq)
  const p = qcProgress(qc)
  const isManual = task.source === 'manual'
  const pending = !isManual && !task.description && qc.length === 0
  const where = whereLabel(task.floor_label, task.unit_label)
  const dur = Math.max(1, task.duration_days ?? DEFAULT_DURATION)

  const isDragging = drag.draggingId === task.task_id
  const isOver = drag.overId === task.task_id && drag.draggingId !== task.task_id

  // first-arrival cascade (Motion 1/2)
  const idx = anim.lineIndex.get(task.task_id) ?? 0
  const cascading = anim.doCascade && !anim.cascadeDone && idx < CAP
  const lineDelay = cascading ? LINE_BASE + idx * STAGGER : 0
  const rowAnim: CSSProperties = cascading ? { animation: `siteSettle ${SETTLE}ms cubic-bezier(.16,1,.3,1) ${lineDelay}ms backwards` } : {}
  const subDelay = cascading ? lineDelay + SETTLE : 0
  const subAnim: CSSProperties = { animation: `siteSubIn 220ms ease ${subDelay}ms backwards` }

  return (
    <div className="task-wrap">
    <div
      onDragOver={(e) => { e.preventDefault(); drag.over(task.task_id) }}
      onDrop={(e) => { e.preventDefault(); drag.drop(task.task_id) }}
      style={{
        position: 'relative', display: 'flex', gap: 10, padding: '12px 16px',
        borderTop: `1px solid ${LINE}`,
        background: isOver ? `${TERRA}08` : 'transparent',
        boxShadow: isOver ? `inset 0 2px 0 ${TERRA}` : 'none',
        opacity: isDragging ? 0.4 : 1,
        transition: 'background 120ms',
        ...rowAnim,
      }}
    >
      {/* drag handle — only this initiates a drag, so taps/clicks elsewhere still work */}
      <span
        draggable
        onDragStart={(e) => { drag.start(task.task_id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', task.task_id) } catch { /* noop */ } }}
        onDragEnd={() => drag.end()}
        title="Drag to reorder"
        aria-label="Drag to reorder"
        style={{ cursor: 'grab', flexShrink: 0, marginTop: 3, color: INK_FAINT, fontSize: 13, lineHeight: 1, userSelect: 'none', letterSpacing: '-1px' }}
      >⠿</span>

      {/* construction-timeline spine */}
      <div style={{ position: 'relative', width: 14, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        <span style={{ position: 'absolute', top: -13, bottom: -13, width: 1.5, background: LINE }} />
        <StatusNode status={task.status} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        {/* top line — name toggles; the schedule cell is a sibling (its steppers can't nest in a button) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button onClick={onToggle} style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left' }}>
            <span style={{ fontSize: 14.5, fontWeight: 600, color: INK, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{task.name}</span>
            {isManual && <span style={chip(INK_FAINT)}>Added</span>}
          </button>
          {p.total > 0 && <QcProgressChip p={p} />}
          <ScheduleCell sched={sched} dur={dur} onChange={(d) => ctx?.setDuration(task.task_id, d)} />
          <StatusBadge status={task.status} />
          <button onClick={onToggle} aria-label={expanded ? 'Collapse' : 'Expand'} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14, color: INK_FAINT, flexShrink: 0, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 160ms' }}>›</button>
        </div>

        {/* ID + location meta */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 10.5, fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', color: INK_FAINT, letterSpacing: '0.02em' }}>{task.task_no}</span>
          <span style={metaTag}>{where}</span>
        </div>

        {/* Phase 2.3 — TASK VIEW inverse: which open issues threaten THIS task (a heads-up, dismissable). */}
        {atRisk && atRisk.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
            {atRisk.map((iss) => (
              <span key={iss.id} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: FAIL, background: `${FAIL}10`, border: `1px solid ${FAIL}2e`, borderRadius: 7, padding: '2px 8px' }}>
                ⚠ at risk: {iss.title}
                {onDismissRisk && (
                  <button onClick={(e) => { e.stopPropagation(); onDismissRisk(iss.id, task.task_id) }} title="Dismiss — not actually at risk" aria-label="Dismiss risk"
                    style={{ fontSize: 13, lineHeight: 1, color: INK_FAINT, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>×</button>
                )}
              </span>
            ))}
          </div>
        )}

        {/* collapsed: one-line description (or the enrichment shimmer) */}
        {!expanded && (
          pending ? (
            <div style={{ marginTop: 5, ...subAnim }}><PendingSubtext mode={anim.pendingMode} /></div>
          ) : task.description ? (
            <p style={{ fontSize: 13, lineHeight: 1.5, color: INK_SOFT, margin: '4px 0 0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{task.description}</p>
          ) : null
        )}

        {/* expanded: the SHARED task detail (description + owner + QC + activity + image + diary).
            Same component the Sequence view opens as a right drawer — one task surface, two entries. */}
        {expanded && (
          <div style={{ marginTop: 8 }}>
            <TaskDetail task={task} sched={sched} />
          </div>
        )}
      </div>
    </div>
    {/* hover-to-insert: a quiet "add task here" that reveals between rows; a created task lands here */}
    {onInsertAfter && (
      <div className="ins-aff">
        <button onClick={() => onInsertAfter(task)}
          style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '0 16px', background: 'transparent', border: 'none', cursor: 'pointer', height: '100%' }}>
          <span style={{ flex: 1, height: 1, background: `${TERRA}40` }} />
          <span style={{ fontSize: 11, fontWeight: 600, color: TERRA, whiteSpace: 'nowrap' }}>+ Add task here</span>
          <span style={{ flex: 1, height: 1, background: `${TERRA}40` }} />
        </button>
      </div>
    )}
    </div>
  )
}

