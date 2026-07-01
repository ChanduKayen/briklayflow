// Site Desk — the cross-project rollup of Issues & Snags. The per-project page (ProjectIssues)
// answers "what's open on THIS site"; the Desk answers a principal's real morning question —
// "across ALL my sites, what needs me, soonest-bleeding first". It is also the deep-link target
// of a MULTI-project WhatsApp narration (one message that touched several sites).
//
// It renders the SAME tabular surface as ProjectIssues (the shared ItemsTable) so the two can
// never drift — extended with a Site column + a site filter for the cross-project context.
// Issues ride high (rail/bold/expand/overdue wash); snags recede (checkbox/muted/ghost tag).
// NB: the store is still the `todos` table / kind 'todo' (hidden impl detail) — label is "Snag".

import { useState, useMemo, useEffect } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth/AuthProvider'
import { PageSkeleton } from '../components/SkeletonLoader'
import { useOrgMembers } from '../components/siteOps/UserPicker'
import ItemsTable, { type DeskProblem, type DeskSnag, type ThreadEntry } from '../components/siteOps/ItemsTable'
import { appendEvent, legacyToFollowupType, trailKey, useTrailStates } from '../lib/siteOps/followup'

const CREAM = '#FBF9F6', INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.55)', INK_FAINT = 'rgba(34,26,19,0.34)'
const TERRA = '#C8603A', FAIL = '#B2402A', LINE = 'rgba(34,26,19,0.10)'
const SERIF = "'Playfair Display', Georgia, serif"

const isOverdue = (p: DeskProblem) => p.status !== 'RESOLVED' && !!p.next_followup_at && new Date(p.next_followup_at).getTime() < Date.now()

export default function SiteDesk({ session }: { session: Session }) {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const { data: members = [] } = useOrgMembers(orgId)
  const ownerName = (id: string | null) => (id ? (members.find((m) => m.id === id)?.name ?? 'Assigned') : 'Unassigned')

  const [site, setSite] = useState<string>('all')      // 'all' | project_id

  const { data: projects = [] } = useQuery({
    queryKey: ['desk_projects', orgId],
    queryFn: async () => {
      const { data } = await supabase.from('projects').select('project_id, name').eq('org_id', orgId).eq('status', 'Active').order('name')
      return (data ?? []) as { project_id: string; name: string }[]
    },
    enabled: !!orgId,
  })
  const projName = (id: string | null) => projects.find((p) => p.project_id === id)?.name ?? 'Unassigned site'

  // Org-wide problems (problems.org_id exists → one scoped query, no per-project fan-out).
  const { data: problems = [], isLoading } = useQuery({
    queryKey: ['desk_problems', orgId],
    queryFn: async () => {
      const FULL = 'id, title, status, cause, owner_id, owner_source, task_id, source_narration_id, project_id, next_followup_at, deadline, impact, status_history, created_at'
      const RICH = 'id, title, status, cause, owner_id, owner_source, task_id, source_narration_id, project_id, next_followup_at, status_history, created_at'
      const BASE = 'id, title, status, cause, owner_id, task_id, source_narration_id, project_id, next_followup_at, created_at'
      const q = (cols: string) => supabase.from('problems').select(cols).eq('org_id', orgId)
      let res: { data: unknown; error: { message: string } | null } = await q(FULL)   // Phase 2.2/2.3 cols
      if (res.error) res = await q(RICH)
      if (res.error) res = await q(BASE)
      if (res.error) throw res.error
      return (res.data ?? []) as unknown as DeskProblem[]
    },
    enabled: !!orgId,
    refetchInterval: 20000,
  })
  const { data: snags = [] } = useQuery({
    queryKey: ['desk_snags', orgId],
    queryFn: async () => {
      const { data, error } = await supabase.from('todos')
        .select('id, text, owner_id, due_date, status, task_id, project_id, created_at').eq('org_id', orgId)
      if (error) throw error
      return (data ?? []) as DeskSnag[]
    },
    enabled: !!orgId,
    refetchInterval: 20000,
  })
  // Per-item follow-up state (from the trail) for the row indicator — batch-loaded.
  const { data: followStates = {} } = useTrailStates(orgId ?? 'all', problems.map((p) => p.id), snags.map((t) => t.id))
  const { data: taskNames = {} } = useQuery({
    queryKey: ['desk_task_names', orgId],
    queryFn: async () => {
      const { data } = await supabase.from('site_tasks').select('task_id, name, floor_label').eq('org_id', orgId)
      const m: Record<string, string> = {}
      for (const t of data ?? []) m[t.task_id] = `${t.name}${t.floor_label ? ` · ${t.floor_label}` : ''}`
      return m
    },
    enabled: !!orgId,
  })

  // Live across every site (org-scoped channel; the 20s poll is the fallback).
  useEffect(() => {
    if (!orgId) return
    const ch = supabase
      .channel(`desk-${orgId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'problems', filter: `org_id=eq.${orgId}` },
        () => qc.invalidateQueries({ queryKey: ['desk_problems', orgId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos', filter: `org_id=eq.${orgId}` },
        () => qc.invalidateQueries({ queryKey: ['desk_snags', orgId] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [orgId, qc])

  const bySite = <T extends { project_id?: string | null }>(rows: T[]) => site === 'all' ? rows : rows.filter((r) => r.project_id === site)

  const { openCountBySite, overdueCount } = useMemo(() => {
    const counts: Record<string, number> = {}
    for (const p of problems) if (p.status !== 'RESOLVED' && p.project_id) counts[p.project_id] = (counts[p.project_id] ?? 0) + 1
    return { openCountBySite: counts, overdueCount: problems.filter(isOverdue).length }
  }, [problems])

  // Row mutation + (optional) a trail event → followup_events (B1), the shared
  // spine, not the legacy problems.status_history JSONB.
  function patchProblem(id: string, patch: Partial<DeskProblem>, threadEvent?: string, eventType: ThreadEntry['type'] = 'system') {
    if (Object.keys(patch).length) {
      qc.setQueryData(['desk_problems', orgId], (old: DeskProblem[] | undefined) => old?.map((p) => (p.id === id ? { ...p, ...patch } : p)))
      supabase.from('problems').update(patch).eq('id', id).then(({ error }) => { if (error) qc.invalidateQueries({ queryKey: ['desk_problems', orgId] }) })
    }
    if (threadEvent && orgId) {
      void appendEvent({ kind: 'issue', id, orgId, type: legacyToFollowupType(eventType), body: threadEvent, actorId: session.user.id })
        .then(() => qc.invalidateQueries({ queryKey: trailKey('issue', id) }))
    }
  }
  function patchSnag(id: string, patch: Partial<DeskSnag>) {
    qc.setQueryData(['desk_snags', orgId], (old: DeskSnag[] | undefined) => old?.map((x) => (x.id === id ? { ...x, ...patch } : x)))
    supabase.from('todos').update(patch).eq('id', id).then(({ error }) => { if (error) qc.invalidateQueries({ queryKey: ['desk_snags', orgId] }) })
  }
  function toggleSnag(t: DeskSnag) {
    const next = t.status === 'DONE' ? 'OPEN' : 'DONE'
    qc.setQueryData(['desk_snags', orgId], (old: DeskSnag[] | undefined) => old?.map((x) => (x.id === t.id ? { ...x, status: next } : x)))
    supabase.from('todos').update({ status: next }).eq('id', t.id).then(({ error }) => { if (error) qc.invalidateQueries({ queryKey: ['desk_snags', orgId] }) })
    if (orgId) {
      void appendEvent({ kind: 'todo', id: t.id, orgId, type: 'status_changed', body: next === 'DONE' ? 'Marked done' : 'Reopened', actorId: session.user.id })
        .then(() => qc.invalidateQueries({ queryKey: trailKey('todo', t.id) }))
    }
  }

  if (isLoading) return <PageSkeleton />

  const totalOpen = problems.filter((p) => p.status !== 'RESOLVED').length
  const totalSnags = snags.filter((t) => t.status !== 'DONE').length
  const sitesWithOpen = Object.keys(openCountBySite).length

  return (
    <div style={{ minHeight: '100vh', background: CREAM }}>
      {/* hero — warm wash, serif headline, the morning-glance stat line */}
      <div style={{
        background: `linear-gradient(180deg, #fff 0%, ${CREAM} 100%)`,
        borderBottom: `1px solid ${LINE}`,
        backgroundImage: `radial-gradient(ellipse 70% 60% at 85% 0%, ${TERRA}0c 0%, transparent 60%)`,
      }}>
        <div className="mx-auto w-full max-w-[880px] lg:max-w-[1040px] xl:max-w-[1200px]" style={{ padding: '34px 24px 22px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: TERRA, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>Across every site</p>
          <h1 style={{ fontFamily: SERIF, fontSize: 38, fontWeight: 600, color: INK, margin: '6px 0 0', letterSpacing: '-0.01em' }}>Site Desk</h1>
          <div style={{ display: 'flex', gap: 22, marginTop: 16, flexWrap: 'wrap' }}>
            <Stat n={totalOpen} label={`open issue${totalOpen === 1 ? '' : 's'}`} sub={`on ${sitesWithOpen} site${sitesWithOpen === 1 ? '' : 's'}`} />
            <Stat n={overdueCount} label="overdue" tone={overdueCount ? FAIL : undefined} />
            <Stat n={totalSnags} label={`snag${totalSnags === 1 ? '' : 's'}`} />
          </div>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[880px] lg:max-w-[1040px] xl:max-w-[1200px]" style={{ padding: '20px 24px 96px' }}>
        {/* site filter — All + each site that has open work */}
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 18 }}>
          <Chip label="All sites" count={totalOpen} on={site === 'all'} onClick={() => setSite('all')} />
          {projects.map((p) => (
            <Chip key={p.project_id} label={p.name} count={openCountBySite[p.project_id] ?? 0}
              on={site === p.project_id} onClick={() => setSite(p.project_id)} />
          ))}
        </div>

        <ItemsTable
          issues={bySite(problems)} snags={bySite(snags)} orgId={orgId ?? ''} actorId={session.user.id}
          followStates={followStates}
          ownerName={ownerName} taskNames={taskNames}
          showSite={site === 'all'} projName={projName}
          onPatchProblem={patchProblem} onPatchSnag={patchSnag} onToggleSnag={toggleSnag}
          onDismissImpact={(id) => patchProblem(id, { impact: null }, 'Impact suggestion dismissed')}
          emptyLabel={site === 'all' ? 'No open issues or snags — every site is clear.' : 'Nothing open on this site.'}
        />
      </div>
    </div>
  )
}

// ── hero stat ────────────────────────────────────────────────────────────────
function Stat({ n, label, sub, tone }: { n: number; label: string; sub?: string; tone?: string }) {
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: SERIF, fontSize: 28, fontWeight: 600, color: tone ?? INK, lineHeight: 1 }}>{n}</span>
        <span style={{ fontSize: 13, color: tone ?? INK_SOFT, fontWeight: tone ? 600 : 500 }}>{label}</span>
      </div>
      {sub && <span style={{ fontSize: 11.5, color: INK_FAINT }}>{sub}</span>}
    </div>
  )
}

// ── site filter chip ─────────────────────────────────────────────────────────
function Chip({ label, count, on, onClick }: { label: string; count: number; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      display: 'inline-flex', alignItems: 'center', gap: 7, padding: '6px 12px', borderRadius: 999, cursor: 'pointer',
      border: `1px solid ${on ? INK : LINE}`, background: on ? INK : '#fff', color: on ? CREAM : INK_SOFT,
      fontSize: 13, fontWeight: on ? 600 : 500, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
    }}>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
      {count > 0 && <span style={{ fontSize: 11, fontWeight: 700, color: on ? CREAM : TERRA, background: on ? 'rgba(251,249,246,0.18)' : `${TERRA}14`, borderRadius: 999, padding: '1px 6px', minWidth: 17, textAlign: 'center' }}>{count}</span>}
    </button>
  )
}
