import { useState, useEffect, useRef, useCallback, createContext, useContext, type CSSProperties, type ReactNode } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { PageSkeleton } from '../components/SkeletonLoader'
import ConstructionConfig from '../components/siteOps/ConstructionConfig'
import { UserPicker, useOrgMembers, MemberAvatar, type OrgMember } from '../components/siteOps/UserPicker'
import { NarrationComposer } from '../components/siteOps/NarrationComposer'
import { useUserProfile } from '../App'
import { useAuth } from '../lib/auth/AuthProvider'

type QcStatus = 'pending' | 'confirmed' | 'failed' | null

// Shared per-page actions/identity for task rows (avoids drilling through Group → List → Row).
interface TaskCtxValue {
  orgId: string
  authorId: string
  authorName: string
  members: OrgMember[]
  ownerName: (id: string | null | undefined) => string
  supervisorId: string | null   // the SITE owner — tasks inherit this by default
  principalId: string | null    // fallback when no supervisor is set
  setQc: (taskId: string, qcId: string, next: QcStatus) => void
  setDuration: (taskId: string, days: number) => void
  setOwner: (taskId: string, ownerId: string | null) => void
}
const TaskCtx = createContext<TaskCtxValue | null>(null)

const DEFAULT_DURATION = 1
const addDays = (d: Date, n: number): Date => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
const fmtDate = (d: Date): string => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })

// ── palette (walnut-ledger) ──────────────────────────────────────────────────
const CREAM = '#FBF9F6'
const INK = '#221A13'
const INK_SOFT = 'rgba(34,26,19,0.55)'
const INK_FAINT = 'rgba(34,26,19,0.34)'
const TERRA = '#C8603A'
const SAGE = '#5E8157'
const LINE = 'rgba(34,26,19,0.10)'
const SERIF = "'Playfair Display', Georgia, serif"

// ── cascade timings (Motion 1) — tune here ───────────────────────────────────
const CAP = 14          // stagger only the first screenful; the rest render settled
const STAGGER = 50      // ms between consecutive task lines (40–70)
const LINE_BASE = 160   // ms before the first line settles (after headers)
const SETTLE = 250      // ms line settle duration → also the gap before its sub-text
const CASCADE_TOTAL = LINE_BASE + CAP * STAGGER + SETTLE + 200  // when the cascade window closes

const isParking = (floor: string) => /^(stilt|cellar|basement)/i.test(floor)

interface QcRow {
  id: string; question: string; is_critical: boolean; seq: number; qc_status: QcStatus
  answer?: string | null; answered_at?: string | null; source_narration_id?: string | null
}
interface StatusEvent { status?: string; at?: string; by?: string; source?: string; narration_id?: string | null }
interface Task {
  task_id: string; task_no: string; phase: string; trade: string
  floor_label: string | null; unit_label: string | null
  name: string; description: string | null; seq_no: number; status: string
  source: 'generated' | 'manual'
  duration_days?: number | null
  owner_id?: string | null; owner_source?: 'auto' | 'manual'
  status_history?: StatusEvent[]
  updated_at?: string | null
  site_task_qc: QcRow[]
}
/** Where a task sits (floor + unit), shown as a tag since the list is sequence-ordered, not grouped. */
function whereLabel(floor: string | null, unit: string | null): string {
  if (!floor) return 'Site-wide'
  const base = isParking(floor) ? floor : `${floor} Floor`
  return unit ? `${base} · ${unit}` : base
}

// Deterministic order: seq_no, then task_no as a stable tie-break. Without the tie-break, rows
// that share a seq_no come back in a nondeterministic order on each refetch, so editing one
// task's duration could reshuffle tied tasks and make EARLIER dates jump. task_no is unique.
const bySeq = (a: Task, b: Task) => a.seq_no - b.seq_no || (a.task_no < b.task_no ? -1 : a.task_no > b.task_no ? 1 : 0)

const KEYFRAMES = `
@keyframes siteSettle { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes siteGroupIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes siteSubIn { from { opacity: 0; } to { opacity: 1; } }`

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
  const [siteOwnerPick, setSiteOwnerPick] = useState(false)  // site-level supervisor picker

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

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['project_tasks_v2', projectId],
    queryFn: async () => {
      // Rich select carries the Block-A-UI layers (owner, history, QC provenance, duration).
      // If those columns aren't migrated yet, fall back to the base shape so the page keeps working.
      const RICH = 'task_id, task_no, phase, trade, floor_label, unit_label, name, description, seq_no, status, source, duration_days, owner_id, owner_source, status_history, updated_at, site_task_qc(id, question, is_critical, seq, qc_status, answer, answered_at, source_narration_id)'
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

  if (isLoading) return <PageSkeleton />

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

  const anim = { doCascade, cascadeDone, lineIndex, pendingMode }
  const toggleTask = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
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
  }

  // level options for the manual add form: existing levels + Site-wide.
  const levelOptions = [
    ...levels.map((l) => ({ value: l, label: isParking(l) ? l : `${l} Floor` })),
    { value: '__sitewide__', label: 'Site-wide' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: CREAM }}>
      <style>{KEYFRAMES}</style>
      <div className="mx-auto w-full max-w-[880px] lg:max-w-[1040px] xl:max-w-[1200px]" style={{ padding: '32px 24px 120px' }}>
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
            <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, color: INK, margin: 0, letterSpacing: '-0.01em' }}>Task Manager</h1>
            {tasks.length > 0 && (
              <p style={{ fontSize: 14, color: INK_SOFT, margin: '6px 0 0' }}>
                {tasks.length} tasks · {levelCount} {levelCount === 1 ? 'level' : 'levels'} ·{' '}
                <span style={{ color: allDetailed ? SAGE : TERRA, fontWeight: 600 }}>
                  {allDetailed ? 'fully detailed' : !detailed ? 'structure ready — details pending' : `${detailed}/${genTasks.length} detailed`}
                </span>
              </p>
            )}
            {tasks.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: INK_SOFT }}>
                  <span style={{ fontWeight: 600 }}>Start date</span>
                  <input
                    type="date"
                    value={startISO ? startISO.slice(0, 10) : ''}
                    onChange={(e) => e.target.value && setStartDate(e.target.value)}
                    style={{ fontSize: 12.5, fontFamily: 'inherit', color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 8, padding: '5px 9px', outline: 'none', cursor: 'pointer' }}
                  />
                </label>
                <span style={{ fontSize: 12.5, color: INK_FAINT }}>
                  {totalDays} working day{totalDays === 1 ? '' : 's'}
                  {projFinish ? <> · finishes <strong style={{ color: TERRA, fontWeight: 600 }}>{fmtDate(projFinish)}</strong></> : ' · set a start date to schedule'}
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
            <button
              onClick={() => setShowAdd(true)}
              style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 13, fontWeight: 600, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '8px 14px', cursor: 'pointer', boxShadow: '0 1px 2px rgba(34,26,19,0.04)' }}
            >
              <span style={{ fontSize: 16, lineHeight: 1, color: TERRA, marginTop: -1 }}>+</span> Add task
            </button>
          )}
        </div>

        {/* ── project-level QC progress ───────────────────────────────────── */}
        {proj.total > 0 && (
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
        {ordered.length > 0 && <NarrationComposer projectId={projectId} onLogged={refetchTasks} />}

        {/* ── the plan — flat, in construction (seq_no) order; drag to reorder ──── */}
        {ordered.length > 0 && (
          <TaskCtx.Provider value={taskCtx}>
            <div style={{ marginTop: 24, background: '#fff', borderRadius: 18, border: `1px solid ${LINE}`, overflow: 'hidden' }}>
              {ordered.map((t) => (
                <TaskRow key={t.task_id} task={t} expanded={expanded.has(t.task_id)} onToggle={() => toggleTask(t.task_id)} anim={anim} drag={drag} sched={schedule.get(t.task_id)} atRisk={atRiskByTask[t.task_id]} onDismissRisk={dismissRisk} />
              ))}
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
        <Modal title="Add a task" onClose={() => setShowAdd(false)}>
          <AddTaskForm
            projectId={projectId}
            orgId={(project.org_id as string) ?? ''}
            levelOptions={levelOptions}
            nextSeq={nextSeq}
            onClose={() => setShowAdd(false)}
            onAdded={() => { setShowAdd(false); refetchTasks() }}
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
  const [picked, setPicked] = useState('')

  const { data: projects = [] } = useQuery({
    queryKey: ['tm_projects', orgId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name').eq('org_id', orgId).eq('status', 'Active').order('name')
      return (data ?? []) as { project_id: string; name: string }[]
    },
    enabled: !!orgId,
  })

  const filter = (
    <div>
      <p style={{ fontSize: 11, fontWeight: 700, color: TERRA, letterSpacing: '0.12em', textTransform: 'uppercase', margin: '0 0 9px' }}>Across every site</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {projects.map((p) => (
          <ProjectChip key={p.project_id} label={p.name} on={picked === p.project_id} onClick={() => setPicked(p.project_id)} />
        ))}
      </div>
    </div>
  )

  if (!picked) {
    return (
      <div style={{ minHeight: '100vh', background: CREAM }}>
        <div className="mx-auto w-full max-w-[880px] lg:max-w-[1040px] xl:max-w-[1200px]" style={{ padding: '32px 24px 120px' }}>
          {filter}
          <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, color: INK, margin: '14px 0 0', letterSpacing: '-0.01em' }}>Task Manager</h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: INK_SOFT, margin: '8px 0 0', maxWidth: 460 }}>
            {projects.length === 0
              ? 'No active projects yet — create one to plan its tasks.'
              : 'Choose a project above to manage its construction task plan.'}
          </p>
        </div>
      </div>
    )
  }

  // Remount per project (key) so per-project state (enrich flags, expanded rows) resets cleanly.
  return <ProjectTasksScoped key={picked} session={session} projectId={picked} filterSlot={filter} />
}

// project filter chip — the GLOBAL-context selector (hidden when scoped inside a project).
// Mirrors Site Desk's site chips so the two cross-project surfaces read identically.
function ProjectChip({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', padding: '6px 13px', borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? CREAM : INK_SOFT,
      fontSize: 13, fontWeight: on ? 600 : 500, maxWidth: 240, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
    </button>
  )
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
function AddTaskForm({ projectId, orgId, levelOptions, nextSeq, onClose, onAdded }: {
  projectId: string; orgId: string
  levelOptions: { value: string; label: string }[]
  nextSeq: number; onClose: () => void; onAdded: () => void
}) {
  const [name, setName] = useState('')
  const [level, setLevel] = useState(levelOptions[0]?.value ?? '__sitewide__')
  const [status, setStatus] = useState<'not_started' | 'active' | 'done'>('not_started')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    if (!name.trim()) return
    setBusy(true); setError('')
    const floor_label = level === '__sitewide__' ? null : level
    const { error: e } = await supabase.from('site_tasks').insert({
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
    })
    if (e) { setError(e.message); setBusy(false); return }
    onAdded()
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

const metaTag: CSSProperties = { fontSize: 11, fontWeight: 500, color: INK_FAINT, background: 'rgba(34,26,19,0.05)', padding: '1px 7px', borderRadius: 6, whiteSpace: 'nowrap' }

// ── one task row — flat sequence list, drag-handle reorder, expand for QC + diary ──
function TaskRow({ task, expanded, onToggle, anim, drag, sched, atRisk, onDismissRisk }: { task: Task; expanded: boolean; onToggle: () => void; anim: Anim; drag: DragApi; sched?: { start: Date; end: Date }; atRisk?: { id: string; title: string }[]; onDismissRisk?: (issueId: string, taskId: string) => void }) {
  const ctx = useContext(TaskCtx)
  const qc = [...(task.site_task_qc ?? [])].sort((a, b) => a.seq - b.seq)
  const p = qcProgress(qc)
  const isManual = task.source === 'manual'
  const pending = !isManual && !task.description && qc.length === 0
  const where = whereLabel(task.floor_label, task.unit_label)
  const dur = Math.max(1, task.duration_days ?? DEFAULT_DURATION)
  const [ownerPick, setOwnerPick] = useState(false)

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

        {/* expanded: description + owner + QC (with provenance) + activity timeline + image shell + diary */}
        {expanded && (
          <div style={{ marginTop: 8 }}>
            {pending ? (
              <PendingSubtext mode={anim.pendingMode} />
            ) : task.description ? (
              <p style={{ fontSize: 13, lineHeight: 1.55, color: INK_SOFT, margin: 0 }}>{task.description}</p>
            ) : null}

            {/* owner — INHERITS the site owner (supervisor) by default; editable per task (override) */}
            {ctx && (() => {
              const isOverride = task.owner_source === 'manual' && !!task.owner_id
              const effId = isOverride ? task.owner_id! : (ctx.supervisorId ?? ctx.principalId)
              const tag = isOverride ? 'chosen' : ctx.supervisorId ? 'site default' : ctx.principalId ? 'default' : ''
              return (
                <div style={{ display: 'flex', alignItems: 'center', gap: 9, marginTop: 12 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Owner</span>
                  <button onClick={() => setOwnerPick(true)} style={{ display: 'inline-flex', alignItems: 'center', gap: 7, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 999, padding: '4px 10px 4px 4px', cursor: 'pointer' }}>
                    {effId ? <MemberAvatar name={ctx.ownerName(effId)} size={20} /> : <span style={{ width: 20, height: 20, borderRadius: '50%', border: `1.5px dashed ${INK_FAINT}` }} />}
                    <span style={{ fontSize: 12.5, fontWeight: 600, color: effId ? INK : INK_SOFT }}>{effId ? ctx.ownerName(effId) : 'Unassigned'}</span>
                    {tag && <span style={{ fontSize: 10, color: INK_FAINT }}>({tag})</span>}
                  </button>
                  {ownerPick && (
                    <UserPicker orgId={ctx.orgId} currentId={effId ?? null} title="Owner for this task"
                      onPick={(id) => { ctx.setOwner(task.task_id, id); setOwnerPick(false) }} onClose={() => setOwnerPick(false)} />
                  )}
                </div>
              )
            })()}

            {qc.length > 0 && ctx && <QcList qc={qc} taskId={task.task_id} setQc={ctx.setQc} />}
            <ActivityTimeline task={task} qc={qc} />
            <ImageShell task={task} />
            {ctx && <TaskComments taskId={task.task_id} orgId={ctx.orgId} authorId={ctx.authorId} authorName={ctx.authorName} />}
          </div>
        )}
      </div>
    </div>
  )
}

// relative time ("2h ago"); used by QC provenance + timeline.
function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms)) return ''
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  return `${d}d ago`
}

// ── activity timeline — system-generated narration events, weighted ──────────
function ActivityTimeline({ task, qc }: { task: Task; qc: QcRow[] }) {
  const events: { weight: 'high' | 'low'; text: string; at: string | null; narrationId: string | null }[] = []
  for (const e of task.status_history ?? []) {
    if (e.source === 'narration' || e.status) {
      events.push({ weight: 'high', text: e.status ? `→ ${e.status.replace('_', ' ')}` : 'updated', at: e.at ?? null, narrationId: e.narration_id ?? null })
    }
  }
  for (const q of qc) {
    if (q.qc_status === 'confirmed' && q.answer) {
      events.push({ weight: 'high', text: `QC confirmed — ${q.answer}`, at: q.answered_at ?? null, narrationId: q.source_narration_id ?? null })
    }
  }
  events.sort((a, b) => (new Date(b.at ?? 0).getTime()) - (new Date(a.at ?? 0).getTime()))
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>Activity</div>
      {events.length === 0 ? (
        <p style={{ fontSize: 12.5, color: INK_FAINT, margin: 0, fontStyle: 'italic' }}>No site updates yet — narration will appear here.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {events.map((ev, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', flexShrink: 0, marginTop: 5, background: ev.weight === 'high' ? TERRA : INK_FAINT }} />
              <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: ev.weight === 'high' ? INK : INK_SOFT, fontWeight: ev.weight === 'high' ? 500 : 400 }}>
                {ev.text}
                {ev.narrationId && <span style={{ fontSize: 11, color: INK_FAINT }}> · from narration</span>}
              </span>
              <span style={{ fontSize: 11, color: INK_FAINT, whiteSpace: 'nowrap' }}>{timeAgo(ev.at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── image artifact area — SHELL ONLY (vision extraction is the next block) ────
function ImageShell({ task }: { task: Task & { image_url?: string | null } }) {
  const url = task.image_url ?? null
  return (
    <div style={{ marginTop: 14 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 6 }}>Site photo</div>
      {url ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
          <img src={url} alt="site" style={{ width: 96, height: 96, objectFit: 'cover', borderRadius: 12, border: `1px solid ${LINE}` }} />
          <div style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: INK_FAINT, fontStyle: 'italic' }}>Extraction &amp; resolution will appear here.</div>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 64, borderRadius: 12, border: `1.5px dashed ${LINE}`, color: INK_FAINT, fontSize: 12.5 }}>
          No photo yet
        </div>
      )}
    </div>
  )
}

// ── per-task duration stepper + computed dates (adjacent schedule cell) ───────
function ScheduleCell({ sched, dur, onChange }: { sched?: { start: Date; end: Date }; dur: number; onChange: (d: number) => void }) {
  const btn: CSSProperties = { width: 20, height: 20, borderRadius: 6, border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT, fontSize: 13, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0 }
  return (
    <div style={{ flexShrink: 0, display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3, minWidth: 92 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        <button onClick={() => onChange(dur - 1)} disabled={dur <= 1} aria-label="Decrease duration" style={{ ...btn, opacity: dur <= 1 ? 0.4 : 1, cursor: dur <= 1 ? 'default' : 'pointer' }}>−</button>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums', minWidth: 28, textAlign: 'center' }}>{dur}d</span>
        <button onClick={() => onChange(dur + 1)} aria-label="Increase duration" style={{ ...btn, cursor: 'pointer' }}>+</button>
      </div>
      {sched && <span style={{ fontSize: 10.5, color: INK_FAINT, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{fmtDate(sched.start)} → {fmtDate(sched.end)}</span>}
    </div>
  )
}

// ── QC progress helpers ──────────────────────────────────────────────────────
const FAIL = '#B2402A'
interface QcProgress { total: number; passed: number; failed: number; pending: number; done: boolean }
function qcProgress(qc: QcRow[]): QcProgress {
  const total = qc.length
  const passed = qc.filter((q) => q.qc_status === 'confirmed').length
  const failed = qc.filter((q) => q.qc_status === 'failed').length
  return { total, passed, failed, pending: total - passed - failed, done: total > 0 && passed === total }
}

/** Small SVG ring: sage arc for passed/total; red accent if any check failed. */
function ProgressRing({ p, size = 18, stroke = 2.5 }: { p: QcProgress; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = p.total ? p.passed / p.total : 0
  const color = p.failed > 0 ? FAIL : p.done ? SAGE : TERRA
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={LINE} strokeWidth={stroke} />
      {frac > 0 && (
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
          strokeDasharray={c} strokeDashoffset={c * (1 - frac)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 240ms ease' }} />
      )}
    </svg>
  )
}

/** Compact "ring + 2/3" chip shown on a task row when it has QC. */
function QcProgressChip({ p }: { p: QcProgress }) {
  const color = p.failed > 0 ? FAIL : p.done ? SAGE : INK_FAINT
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <ProgressRing p={p} />
      <span style={{ fontSize: 11.5, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{p.passed}/{p.total}</span>
    </span>
  )
}

// ── interactive QC checklist (Yes / No per check) ────────────────────────────
function QcList({ qc, taskId, setQc }: { qc: QcRow[]; taskId: string; setQc: TaskCtxValue['setQc'] }) {
  const p = qcProgress(qc)
  return (
    <div style={{ marginTop: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
        <span style={{ fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Quality checks</span>
        <span style={{ fontSize: 11, fontWeight: 600, color: p.failed > 0 ? FAIL : p.done ? SAGE : INK_FAINT }}>
          {p.passed}/{p.total} passed{p.failed > 0 ? ` · ${p.failed} failed` : ''}
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {qc.map((q) => (
          <div key={q.id} style={{ display: 'flex', gap: 12, alignItems: 'flex-start', padding: '8px 0', borderTop: `1px solid ${LINE}` }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 13, lineHeight: 1.45, color: q.qc_status === 'failed' ? FAIL : INK }}>{q.question}</span>
              {q.is_critical && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, color: TERRA, letterSpacing: '0.06em' }}>CRITICAL</span>}
              {/* provenance: an answered QC shows what confirmed it + when (from narration) */}
              {q.qc_status === 'confirmed' && q.answer && (
                <div style={{ marginTop: 3, fontSize: 11.5, color: SAGE }}>
                  ✓ {q.answer}
                  {(q.source_narration_id || q.answered_at) && (
                    <span style={{ color: INK_FAINT }}> — {q.source_narration_id ? 'from narration' : 'logged'}{q.answered_at ? ` · ${timeAgo(q.answered_at)}` : ''}</span>
                  )}
                </div>
              )}
            </div>
            <YesNo
              value={q.qc_status}
              onYes={() => setQc(taskId, q.id, q.qc_status === 'confirmed' ? null : 'confirmed')}
              onNo={() => setQc(taskId, q.id, q.qc_status === 'failed' ? null : 'failed')}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

function YesNo({ value, onYes, onNo }: { value: QcStatus; onYes: () => void; onNo: () => void }) {
  const yes = value === 'confirmed'
  const no = value === 'failed'
  const base: CSSProperties = { fontSize: 12, fontWeight: 600, padding: '5px 15px', borderRadius: 999, cursor: 'pointer', border: '1px solid', transition: 'all 140ms', lineHeight: 1 }
  return (
    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
      <button onClick={onYes} aria-pressed={yes}
        style={{ ...base, background: yes ? SAGE : 'transparent', borderColor: yes ? SAGE : LINE, color: yes ? '#fff' : INK_SOFT }}>Yes</button>
      <button onClick={onNo} aria-pressed={no}
        style={{ ...base, background: no ? FAIL : 'transparent', borderColor: no ? FAIL : LINE, color: no ? '#fff' : INK_SOFT }}>No</button>
    </div>
  )
}

// ── per-task comment diary (append-only, unlimited) ──────────────────────────
interface CommentRow { id: string; body: string; author_name: string | null; created_at: string }
function TaskComments({ taskId, orgId, authorId, authorName }: { taskId: string; orgId: string; authorId: string; authorName: string }) {
  const queryClient = useQueryClient()
  const { data: comments = [] } = useQuery({
    queryKey: ['site_task_comments', taskId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_task_comments')
        .select('id, body, author_name, created_at')
        .eq('task_id', taskId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as CommentRow[]
    },
  })
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)

  async function add() {
    const body = text.trim()
    if (!body || busy) return
    setBusy(true)
    const { error } = await supabase.from('site_task_comments').insert({
      task_id: taskId, org_id: orgId, author_id: authorId || null, author_name: authorName || null, body,
    })
    setBusy(false)
    if (!error) { setText(''); queryClient.invalidateQueries({ queryKey: ['site_task_comments', taskId] }) }
  }

  return (
    <div style={{ marginTop: 14, borderTop: `1px solid ${LINE}`, paddingTop: 12 }}>
      <div style={{ fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase', marginBottom: 10 }}>
        Diary{comments.length > 0 ? ` · ${comments.length}` : ''}
      </div>
      {comments.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 11, marginBottom: 12 }}>
          {comments.map((c) => (
            <div key={c.id} style={{ display: 'flex', gap: 10 }}>
              <span style={{ flexShrink: 0, width: 26, height: 26, borderRadius: '50%', background: `${TERRA}14`, color: TERRA, fontSize: 10.5, fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {(c.author_name ?? '?').trim().slice(0, 1).toUpperCase() || '?'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                  <span style={{ fontSize: 12.5, fontWeight: 700, color: INK }}>{c.author_name ?? 'Someone'}</span>
                  <span style={{ fontSize: 11, color: INK_FAINT }}>{fmtWhen(c.created_at)}</span>
                </div>
                <p style={{ fontSize: 13, lineHeight: 1.5, color: INK_SOFT, margin: '2px 0 0', whiteSpace: 'pre-wrap' }}>{c.body}</p>
              </div>
            </div>
          ))}
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); add() } }}
          placeholder="Add a note to the diary…"
          rows={1}
          style={{ flex: 1, resize: 'vertical', minHeight: 38, fontSize: 13, fontFamily: 'inherit', lineHeight: 1.5, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', outline: 'none', boxSizing: 'border-box' }}
        />
        <button
          onClick={add}
          disabled={busy || !text.trim()}
          style={{ flexShrink: 0, fontSize: 13, fontWeight: 600, color: '#fff', background: TERRA, border: 'none', borderRadius: 10, padding: '9px 16px', cursor: busy || !text.trim() ? 'default' : 'pointer', opacity: busy || !text.trim() ? 0.5 : 1 }}
        >
          {busy ? '…' : 'Post'}
        </button>
      </div>
    </div>
  )
}

function fmtWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function StatusNode({ status }: { status: string }) {
  const base = { width: 11, height: 11, borderRadius: '50%', marginTop: 4, zIndex: 1, background: '#fff', boxShadow: '0 0 0 2px #fff' } as const
  if (status === 'done') return <span style={{ ...base, background: SAGE }} />
  if (status === 'active') return <span style={{ ...base, background: TERRA }} />
  return <span style={{ ...base, border: `1.5px solid ${INK_FAINT}` }} />
}

function StatusBadge({ status }: { status: string }) {
  const cfg = status === 'done' ? { c: SAGE, t: 'Done' } : status === 'active' ? { c: TERRA, t: 'Active' } : { c: INK_FAINT, t: 'Not started' }
  return <span style={{ fontSize: 10.5, fontWeight: 700, color: cfg.c, letterSpacing: '0.03em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{cfg.t}</span>
}

function PendingSubtext({ mode }: { mode: 'shimmer' | 'unavailable' }) {
  // After enrich settles, a still-pending task says so quietly instead of shimmering forever.
  if (mode === 'unavailable') {
    return (
      <p style={{ fontSize: 12.5, color: INK_FAINT, margin: 0, fontStyle: 'italic' }} aria-label="details unavailable">
        Details unavailable
      </p>
    )
  }
  // Shaped like the real description + critical-QC line, so it reads as a fill, not a swap.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-label="details pending">
      <span className="animate-pulse" style={{ height: 9, width: '82%', borderRadius: 4, background: 'rgba(34,26,19,0.06)' }} />
      <span className="animate-pulse" style={{ height: 9, width: '58%', borderRadius: 4, background: 'rgba(34,26,19,0.06)' }} />
    </div>
  )
}

function chip(color: string): CSSProperties {
  return { fontSize: 10, fontWeight: 700, color, background: `${color}14`, padding: '2px 8px', borderRadius: 999, letterSpacing: '0.03em' }
}
