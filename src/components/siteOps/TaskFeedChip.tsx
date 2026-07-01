/* eslint-disable react-refresh/only-export-components -- this small lens module deliberately
   co-locates the chip's data hooks (useTaskLinkedObjects/useLinkedFollowStates) with the chip
   component they feed; the only cost is dev fast-refresh for this file. */
// TaskFeedChip — the LIVE lens on a Snag/Issue inside a task's feed.
//
// The object (problems=issue / todos=snag) is the single source of truth; this chip and Site Desk
// are both lenses. The chip shows the object's live state (title, status, assignee, next follow-up)
// + 1–2 quick actions + a deep link to Site Desk. It expands to a SUMMARY (the latest activity
// line), NOT the full issue workspace. When a follow-up chase fires it advances the object's row
// (next_followup_at) and writes a followup_events line — the realtime subscription below invalidates
// this cache, so the chip reflects it automatically. That loop closes with zero extra wiring.

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../../lib/supabase'
import { useTrailStates } from '../../lib/siteOps/followup'

const INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.55)', INK_FAINT = 'rgba(34,26,19,0.34)'
const TERRA = '#C8603A', SAGE = '#5E8157', AMBER = '#B8860B', FAIL = '#B2402A'
const LINE = 'rgba(34,26,19,0.12)'

export interface LinkedObject {
  kind: 'issue' | 'todo'
  id: string
  title: string
  status: string                 // issue: OPEN|ADDRESSING|RESOLVED · snag: OPEN|DONE
  owner_id: string | null
  when: string | null            // issue: next_followup_at · snag: due_date
  source_note_id: string | null
  source_note_kind: string | null
  created_at: string
  project_id: string | null
}

/**
 * Live view of the Snag/Issue objects linked to a task (task_id). Subscribes to problems + todos
 * (row state) so a status/owner/next_followup_at change — including a chase advancing the clock —
 * refreshes the chips immediately. Returns the objects AND the set of note ids they were spawned
 * from, so the feed can HIDE the raw note and show the chip in its place (the mark-and-hide rule).
 */
export function useTaskLinkedObjects(taskId: string) {
  const qc = useQueryClient()
  const query = useQuery({
    queryKey: ['task_linked_objects', taskId],
    enabled: !!taskId,
    queryFn: async (): Promise<LinkedObject[]> => {
      const sel = 'id, status, owner_id, source_note_id, source_note_kind, created_at, project_id'
      const [iss, sn] = await Promise.all([
        supabase.from('problems').select(`${sel}, title, next_followup_at`).eq('task_id', taskId),
        supabase.from('todos').select(`${sel}, text, due_date`).eq('task_id', taskId),
      ])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const issues = (iss.data ?? []).map((p: any): LinkedObject => ({
        kind: 'issue', id: p.id, title: p.title, status: p.status, owner_id: p.owner_id,
        when: p.next_followup_at, source_note_id: p.source_note_id, source_note_kind: p.source_note_kind,
        created_at: p.created_at, project_id: p.project_id,
      }))
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const snags = (sn.data ?? []).map((t: any): LinkedObject => ({
        kind: 'todo', id: t.id, title: t.text, status: t.status, owner_id: t.owner_id,
        when: t.due_date, source_note_id: t.source_note_id, source_note_kind: t.source_note_kind,
        created_at: t.created_at, project_id: t.project_id,
      }))
      return [...issues, ...snags]
    },
  })

  // Realtime — mirrors ProjectIssues/SiteDesk, scoped to this task. A chase's advanceIssue() UPDATEs
  // problems.next_followup_at → this fires → chip re-reads the fresh clock. Loop closed.
  useEffect(() => {
    if (!taskId) return
    const ch = supabase
      .channel(`task-objects-${taskId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'problems', filter: `task_id=eq.${taskId}` },
        () => qc.invalidateQueries({ queryKey: ['task_linked_objects', taskId] }))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'todos', filter: `task_id=eq.${taskId}` },
        () => qc.invalidateQueries({ queryKey: ['task_linked_objects', taskId] }))
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [taskId, qc])

  return query
}

const fmtDay = (iso: string | null) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : null

function statusStyle(kind: 'issue' | 'todo', status: string): { label: string; color: string } {
  if (kind === 'todo') return status === 'DONE' ? { label: 'Done', color: SAGE } : { label: 'Open', color: TERRA }
  if (status === 'RESOLVED') return { label: 'Resolved', color: SAGE }
  if (status === 'ADDRESSING') return { label: 'Addressing', color: AMBER }
  return { label: 'Open', color: TERRA }
}

/**
 * The chip. `followState` (from useTrailStates) supplies the latest-activity glance on expand.
 * `onQuickAction` performs the one-tap Resolve / Mark-done; `ownerName` resolves the assignee id.
 */
export function TaskFeedChip({ obj, ownerName, followState, onQuickAction, busy }: {
  obj: LinkedObject
  ownerName: (id: string | null) => string
  followState?: { last: { type: string; body: string | null; at: string } | null; escalated?: boolean }
  onQuickAction: (obj: LinkedObject) => void
  busy?: boolean
}) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const st = statusStyle(obj.kind, obj.status)
  const done = obj.kind === 'todo' ? obj.status === 'DONE' : obj.status === 'RESOLVED'
  const typeLabel = obj.kind === 'issue' ? 'Issue' : 'Snag'
  const whenLabel = obj.when ? (obj.kind === 'issue' ? `follow-up ${fmtDay(obj.when)}` : `due ${fmtDay(obj.when)}`) : null

  return (
    <div style={{ border: `1px solid ${LINE}`, borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
      {/* collapsed row — the live glance */}
      <div onClick={() => setOpen((o) => !o)} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', cursor: 'pointer' }}>
        <span style={{ width: 3, alignSelf: 'stretch', borderRadius: 2, background: st.color }} />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: st.color, border: `1px solid ${st.color}55`, borderRadius: 6, padding: '2px 6px' }}>{typeLabel}</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13.5, fontWeight: 600, color: INK, textDecoration: done ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{obj.title}</span>
        {followState?.escalated && <span title="Escalated" style={{ fontSize: 11, color: FAIL, fontWeight: 700 }}>↑</span>}
        <span style={{ fontSize: 11, fontWeight: 700, color: st.color }}>{st.label}</span>
      </div>

      {/* meta line */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '0 12px 10px 25px', fontSize: 11.5, color: INK_SOFT }}>
        <span>{obj.owner_id ? ownerName(obj.owner_id) : 'Unassigned'}</span>
        {whenLabel && <span style={{ color: INK_FAINT }}>· {whenLabel}</span>}
      </div>

      {/* expand — SUMMARY only (latest activity), never the full workspace */}
      {open && (
        <div style={{ padding: '0 12px 12px 25px', borderTop: `1px solid ${LINE}`, paddingTop: 10 }}>
          <p style={{ fontSize: 12, color: INK_SOFT, margin: '0 0 10px' }}>
            {followState?.last
              ? <>Latest: <span style={{ color: INK }}>{followState.last.body ?? followState.last.type.replace(/_/g, ' ')}</span> · {fmtDay(followState.last.at)}</>
              : <span style={{ color: INK_FAINT }}>No activity yet.</span>}
          </p>
          <div style={{ display: 'flex', gap: 8 }}>
            <button disabled={busy || done} onClick={(e) => { e.stopPropagation(); onQuickAction(obj) }}
              style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: 'none', cursor: done ? 'default' : 'pointer', background: done ? '#0000000d' : SAGE, color: done ? INK_FAINT : '#fff', opacity: busy ? 0.6 : 1 }}>
              {obj.kind === 'issue' ? (done ? 'Resolved' : 'Resolve') : (done ? 'Done' : 'Mark done')}
            </button>
            <button onClick={(e) => { e.stopPropagation(); navigate('/site-desk') }}
              style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT, cursor: 'pointer' }}>
              Open in Site Desk →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Convenience: fold the useTrailStates map for a set of linked objects (for the chip glances). */
export function useLinkedFollowStates(taskId: string, objects: LinkedObject[]) {
  const issueIds = objects.filter((o) => o.kind === 'issue').map((o) => o.id)
  const todoIds = objects.filter((o) => o.kind === 'todo').map((o) => o.id)
  return useTrailStates(`task:${taskId}`, issueIds, todoIds)
}
