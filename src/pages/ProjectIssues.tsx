// Surfacing UI — a project's Issues & Snags on ONE tabular surface. Issues and snags share
// the SAME row structure (the shared ItemsTable, also used by the cross-site Site Desk), with
// priority carried by weight: issues ride high (coloured rail, bold, expandable thread, overdue
// wash), snags recede (checkbox, muted, ghost tag). Each issue links back to its source task +
// narration (one-system). Sorted bleeding-first by the table's priority ladder.
//
// NB: the underlying store is still the `todos` table / `todo_id` column / followup kind 'todo'
// (a hidden impl detail) — only the user-facing/app label is "Snag".

import { useEffect } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { PageSkeleton } from '../components/SkeletonLoader'
import { useOrgMembers } from '../components/siteOps/UserPicker'
import ItemsTable, { type DeskProblem, type DeskSnag, type ThreadEntry } from '../components/siteOps/ItemsTable'
import { appendEvent, legacyToFollowupType, trailKey, useTrailStates } from '../lib/siteOps/followup'

const CREAM = '#FBF9F6', INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.55)'
const TERRA = '#C8603A', LINE = 'rgba(34,26,19,0.10)'
const SERIF = "'Playfair Display', Georgia, serif"

type View = 'all' | 'issues' | 'snags'

export default function ProjectIssues({ session }: { session: Session }) {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const [searchParams, setSearchParams] = useSearchParams()
  // The navbar's two first-class entries (Issues / Snags) deep-link here with ?view=; the
  // segmented control below switches between them. Both ride the SAME surface (ItemsTable),
  // so issues and snags never live on separate pages — only filtered views of one desk.
  // Legacy `?view=todos` deep-links (pre-rename WhatsApp/bookmarks) still resolve to the snags view.
  const rawView = searchParams.get('view')
  const view: View = (rawView === 'snags' || rawView === 'todos') ? 'snags' : rawView === 'issues' ? 'issues' : 'all'
  const setView = (v: View) => setSearchParams(v === 'all' ? {} : { view: v }, { replace: true })
  const qc = useQueryClient()

  const { data: project } = useQuery({
    queryKey: ['project', projectId],
    queryFn: async () => (await supabase.from('projects').select('name, org_id').eq('project_id', projectId).single()).data,
    enabled: !!projectId,
  })
  const orgId = (project?.org_id as string | undefined)
  const { data: members = [] } = useOrgMembers(orgId)
  const ownerName = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? 'Assigned') : 'Unassigned')

  const { data: problems = [], isLoading } = useQuery({
    queryKey: ['project_problems', projectId],
    queryFn: async () => {
      // Rich select carries the ownership + provenance columns; a not-yet-applied migration falls
      // back to the base shape so the page still renders (mirrors ProjectTasks' RICH/BASE resilience).
      const FULL = 'id, title, status, cause, owner_id, owner_source, task_id, source_narration_id, project_id, next_followup_at, deadline, impact, status_history, created_at'
      const RICH = 'id, title, status, cause, owner_id, owner_source, task_id, source_narration_id, project_id, next_followup_at, status_history, created_at'
      const BASE = 'id, title, status, cause, owner_id, task_id, source_narration_id, project_id, next_followup_at, created_at'
      const q = (cols: string) => supabase.from('problems').select(cols).eq('project_id', projectId)
      let res: { data: unknown; error: { message: string } | null } = await q(FULL)   // Phase 2.2/2.3 cols
      if (res.error) res = await q(RICH)
      if (res.error) res = await q(BASE)
      if (res.error) throw res.error
      return (res.data ?? []) as unknown as DeskProblem[]
    },
    enabled: !!projectId,
    refetchInterval: 20000,
  })
  const { data: snags = [] } = useQuery({
    queryKey: ['project_snags', projectId],
    queryFn: async () => {
      const { data, error } = await supabase.from('todos')
        .select('id, text, owner_id, due_date, status, task_id, project_id, created_at').eq('project_id', projectId)
      if (error) throw error
      return (data ?? []) as DeskSnag[]
    },
    enabled: !!projectId,
    refetchInterval: 20000,
  })
  // Per-item follow-up state (from the trail) for the row indicator — batch-loaded.
  const { data: followStates = {} } = useTrailStates(projectId, problems.map((p) => p.id), snags.map((t) => t.id))
  const { data: taskNames = {} } = useQuery({
    queryKey: ['project_task_names', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('site_tasks').select('task_id, name, floor_label').eq('project_id', projectId)
      const m: Record<string, string> = {}
      for (const t of data ?? []) m[t.task_id] = `${t.name}${t.floor_label ? ` · ${t.floor_label}` : ''}`
      return m
    },
    enabled: !!projectId,
  })

  // Live: a WhatsApp narration that creates a problem/snag (INSERT) or an edit elsewhere (UPDATE)
  // lands without a manual reload. Needs problems/todos in the realtime publication (migration
  // 20260626000005); the 20s poll above is the fallback until that's applied.
  useEffect(() => {
    if (!projectId) return
    const ch = supabase
      .channel(`siteops-issues-${projectId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'problems', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ['project_problems', projectId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos', filter: `project_id=eq.${projectId}` },
        () => qc.invalidateQueries({ queryKey: ['project_snags', projectId] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [projectId, qc])

  // Row mutation + (optional) a trail event. The event now writes to the
  // followup_events trail (B1) — the spine chases/replies/comments all share —
  // not the legacy problems.status_history JSONB.
  function patchProblem(id: string, patch: Partial<DeskProblem>, threadEvent?: string, eventType: ThreadEntry['type'] = 'system') {
    if (Object.keys(patch).length) {
      qc.setQueryData(['project_problems', projectId], (old: DeskProblem[] | undefined) => old?.map((p) => (p.id === id ? { ...p, ...patch } : p)))
      supabase.from('problems').update(patch).eq('id', id).then(({ error }) => { if (error) qc.invalidateQueries({ queryKey: ['project_problems', projectId] }) })
    }
    if (threadEvent && orgId) {
      void appendEvent({ kind: 'issue', id, orgId, type: legacyToFollowupType(eventType), body: threadEvent, actorId: session.user.id })
        .then(() => qc.invalidateQueries({ queryKey: trailKey('issue', id) }))
    }
  }
  function patchSnag(id: string, patch: Partial<DeskSnag>) {
    qc.setQueryData(['project_snags', projectId], (old: DeskSnag[] | undefined) => old?.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    supabase.from('todos').update(patch).eq('id', id).then(({ error }) => { if (error) qc.invalidateQueries({ queryKey: ['project_snags', projectId] }) })
  }
  function toggleSnag(t: DeskSnag) {
    const next = t.status === 'DONE' ? 'OPEN' : 'DONE'
    qc.setQueryData(['project_snags', projectId], (old: DeskSnag[] | undefined) => old?.map((x) => (x.id === t.id ? { ...x, status: next } : x)))
    supabase.from('todos').update({ status: next }).eq('id', t.id).then(({ error }) => { if (error) qc.invalidateQueries({ queryKey: ['project_snags', projectId] }) })
    if (orgId) {
      void appendEvent({ kind: 'todo', id: t.id, orgId, type: 'status_changed', body: next === 'DONE' ? 'Marked done' : 'Reopened', actorId: session.user.id })
        .then(() => qc.invalidateQueries({ queryKey: trailKey('todo', t.id) }))
    }
  }

  if (isLoading) return <PageSkeleton />

  const openIssues = problems.filter((p) => p.status !== 'RESOLVED').length
  const openSnags = snags.filter((t) => t.status !== 'DONE').length

  // View scopes the SAME desk: 'issues' hides snags, 'snags' hides issues, 'all' shows both.
  const shownIssues = view === 'snags' ? [] : problems
  const shownSnags = view === 'issues' ? [] : snags
  const emptyLabel = view === 'issues' ? 'No issues — nothing is blocking work.'
    : view === 'snags' ? 'No snags — nothing pending.'
    : 'No issues or snags — site is clear.'

  const heading = view === 'issues' ? 'Issues' : view === 'snags' ? 'Snags' : 'Issues & Snags'

  return (
    <div style={{ minHeight: '100vh', background: CREAM }}>
      <div className="mx-auto w-full max-w-[880px] lg:max-w-[1040px] xl:max-w-[1200px]" style={{ padding: '32px 24px 96px' }}>
        <Link to={`/projects/${projectId}`} style={{ fontSize: 13, color: INK_SOFT, textDecoration: 'none', fontWeight: 500 }}>‹ {project?.name ?? 'Project'}</Link>
        <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, color: INK, margin: '10px 0 0' }}>{heading}</h1>
        <p style={{ fontSize: 14, color: INK_SOFT, margin: '6px 0 18px' }}>
          {openIssues} open issue{openIssues === 1 ? '' : 's'} · {openSnags} snag{openSnags === 1 ? '' : 's'}
        </p>

        {/* segmented control — All / Issues / Snags (mirrors the two navbar entries) */}
        <div style={{ display: 'inline-flex', gap: 2, padding: 3, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 11, marginBottom: 20 }}>
          {(['all', 'issues', 'snags'] as View[]).map((v) => {
            const on = view === v
            const label = v === 'all' ? 'All' : v === 'issues' ? 'Issues' : 'Snags'
            const n = v === 'issues' ? openIssues : v === 'snags' ? openSnags : openIssues + openSnags
            return (
              <button key={v} onClick={() => setView(v)} style={{
                display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, fontWeight: 600, cursor: 'pointer',
                padding: '6px 13px', borderRadius: 8, border: 'none',
                background: on ? INK : 'transparent', color: on ? CREAM : INK_SOFT,
              }}>
                {label}
                {n > 0 && <span style={{ fontSize: 10.5, fontWeight: 700, color: on ? CREAM : TERRA, background: on ? 'rgba(251,249,246,0.18)' : `${TERRA}14`, borderRadius: 999, padding: '1px 6px', minWidth: 16, textAlign: 'center' }}>{n}</span>}
              </button>
            )
          })}
        </div>

        <ItemsTable
          issues={shownIssues} snags={shownSnags} orgId={orgId ?? ''} actorId={session.user.id}
          followStates={followStates}
          ownerName={ownerName} taskNames={taskNames}
          onPatchProblem={patchProblem} onPatchSnag={patchSnag} onToggleSnag={toggleSnag}
          onDismissImpact={(id) => patchProblem(id, { impact: null }, 'Impact suggestion dismissed')}
          emptyLabel={emptyLabel}
        />
      </div>
    </div>
  )
}
