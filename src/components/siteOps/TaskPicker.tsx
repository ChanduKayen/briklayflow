// Task picker — link an issue/to-do to the specific task it blocks (or keep it project-wide).
// Mirrors UserPicker's modal so the two feel like one family. Lists the project's tasks
// (searchable) rather than navigating away to the task plan.

import { useState, type CSSProperties } from 'react'
import { useQuery } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'

const INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.55)', INK_FAINT = 'rgba(34,26,19,0.34)'
const TERRA = '#C8603A', SAGE = '#5E8157', LINE = 'rgba(34,26,19,0.10)', CREAM = '#FBF9F6', SERIF = "'Playfair Display', Georgia, serif"

interface TaskRow { task_id: string; name: string; floor_label: string | null; unit_label: string | null; phase: string | null; status: string }

export function taskLabel(t: { name: string; floor_label?: string | null; unit_label?: string | null }): string {
  return [t.name, t.floor_label, t.unit_label].filter(Boolean).join(' · ')
}

export function TaskPicker({ projectId, currentTaskId, onPick, onClose }: {
  projectId: string; currentTaskId: string | null
  onPick: (taskId: string | null, label: string | null) => void
  onClose: () => void
}) {
  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['siteops_taskpick', projectId],
    queryFn: async () => {
      const { data } = await supabase.from('site_tasks')
        .select('task_id, name, floor_label, unit_label, phase, status')
        .eq('project_id', projectId).order('seq_no')
      return (data ?? []) as TaskRow[]
    },
    enabled: !!projectId,
  })
  const [q, setQ] = useState('')
  const ql = q.toLowerCase().trim()
  const filtered = tasks.filter((t) => taskLabel(t).toLowerCase().includes(ql) || (t.phase ?? '').toLowerCase().includes(ql))

  const row: CSSProperties = { display: 'flex', alignItems: 'center', gap: 11, padding: '9px 12px', borderRadius: 12, cursor: 'pointer', border: '1px solid transparent', textAlign: 'left', background: 'transparent', width: '100%' }
  const statusColor = (s: string) => (s === 'done' ? SAGE : s === 'active' ? TERRA : INK_FAINT)

  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 1100, background: 'rgba(34,26,19,0.32)', backdropFilter: 'blur(2px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: '100%', maxWidth: 460, maxHeight: '80vh', display: 'flex', flexDirection: 'column', background: CREAM, borderRadius: 20, border: `1px solid ${LINE}`, boxShadow: '0 24px 64px rgba(34,26,19,0.28)', padding: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 3 }}>
          <h3 style={{ fontFamily: SERIF, fontSize: 18, fontWeight: 600, color: INK, margin: 0 }}>Link to a task</h3>
          <button onClick={onClose} aria-label="Close" style={{ width: 28, height: 28, border: 'none', background: 'transparent', color: INK_FAINT, fontSize: 19, cursor: 'pointer' }}>×</button>
        </div>
        <p style={{ fontSize: 12, color: INK_SOFT, margin: '0 0 12px' }}>Which task does this hold up? Pick one, or keep it project-wide.</p>
        <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search tasks…"
          style={{ fontSize: 14, color: INK, background: '#fff', border: `1px solid ${LINE}`, borderRadius: 10, padding: '9px 12px', outline: 'none', marginBottom: 8 }} />
        <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button onClick={() => onPick(null, null)} style={{ ...row, borderColor: !currentTaskId ? TERRA : 'transparent', background: !currentTaskId ? `${TERRA}0d` : 'transparent' }}>
            <span style={{ width: 9, height: 9, borderRadius: '50%', border: `1.5px solid ${INK_FAINT}`, flexShrink: 0 }} />
            <span style={{ flex: 1 }}>
              <span style={{ display: 'block', fontSize: 14, fontWeight: 600, color: INK }}>Project-wide</span>
              <span style={{ display: 'block', fontSize: 11.5, color: INK_FAINT }}>Not tied to a specific task</span>
            </span>
            {!currentTaskId && <span style={{ color: TERRA, fontSize: 15 }}>✓</span>}
          </button>
          {isLoading && <p style={{ fontSize: 13, color: INK_FAINT, padding: 12 }}>Loading tasks…</p>}
          {filtered.map((t) => {
            const on = t.task_id === currentTaskId
            return (
              <button key={t.task_id} onClick={() => onPick(t.task_id, taskLabel(t))} style={{ ...row, borderColor: on ? TERRA : 'transparent', background: on ? `${TERRA}0d` : 'transparent' }}>
                <span style={{ width: 9, height: 9, borderRadius: '50%', background: statusColor(t.status), flexShrink: 0 }} />
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 13.5, fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{taskLabel(t)}</span>
                  {t.phase && <span style={{ display: 'block', fontSize: 11, color: INK_FAINT, textTransform: 'capitalize' }}>{t.phase}{t.status ? ` · ${t.status.replace(/_/g, ' ')}` : ''}</span>}
                </span>
                {on && <span style={{ color: TERRA, fontSize: 15 }}>✓</span>}
              </button>
            )
          })}
          {!isLoading && filtered.length === 0 && <p style={{ fontSize: 13, color: INK_FAINT, padding: 12 }}>{tasks.length ? 'No matching tasks.' : 'No tasks yet for this project.'}</p>}
        </div>
      </div>
    </div>
  )
}
