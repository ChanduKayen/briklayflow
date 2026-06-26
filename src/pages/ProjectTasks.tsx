import { useState, useEffect, type CSSProperties } from 'react'
import { useParams, useLocation, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { PageSkeleton } from '../components/SkeletonLoader'

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
const GROUP_STAGGER = 55
const GROUP_CAP = 6
const CASCADE_TOTAL = LINE_BASE + CAP * STAGGER + SETTLE + 200  // when the cascade window closes

const PHASE_LABELS: Record<string, string> = {
  site_foundation: 'Site & Foundation', frame: 'Structural Frame', build_out: 'Floor Build-out',
  services: 'Building Services', finishes: 'Finishes', common_areas: 'Common Areas',
  envelope: 'Envelope & Terrace', final: 'Final & Handover',
}
const phaseLabel = (k: string) => PHASE_LABELS[k] ?? k.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

const isParking = (floor: string) => /^(stilt|cellar|basement)/i.test(floor)
function levelLabel(floor: string | null, phase: string): string {
  if (!floor) return phaseLabel(phase)
  if (isParking(floor)) return floor
  return `${floor} Floor`
}

interface QcRow { question: string; is_critical: boolean; seq: number }
interface Task {
  task_id: string; task_no: string; phase: string; trade: string
  floor_label: string | null; unit_label: string | null
  name: string; description: string | null; seq_no: number; status: string
  site_task_qc: QcRow[]
}
interface Group { key: string; label: string; kind: 'parking' | 'habitable' | 'sitewide'; minSeq: number; tasks: Task[] }

function groupTasks(tasks: Task[]): Group[] {
  const map = new Map<string, Group>()
  for (const t of tasks) {
    const key = t.floor_label ?? `__site__:${t.phase}`
    if (!map.has(key)) {
      const kind: Group['kind'] = !t.floor_label ? 'sitewide' : isParking(t.floor_label) ? 'parking' : 'habitable'
      map.set(key, { key, label: levelLabel(t.floor_label, t.phase), kind, minSeq: t.seq_no, tasks: [] })
    }
    const g = map.get(key)!
    g.tasks.push(t)
    g.minSeq = Math.min(g.minSeq, t.seq_no)
  }
  return [...map.values()].sort((a, b) => a.minSeq - b.minSeq)
}

/** Within a level group: unit-less tasks (the frame) first, then per-unit sub-groups. */
function splitUnits(tasks: Task[]): { direct: Task[]; units: { unit: string; tasks: Task[] }[] } {
  const direct = tasks.filter((t) => !t.unit_label)
  const um = new Map<string, Task[]>()
  for (const t of tasks) if (t.unit_label) { if (!um.has(t.unit_label)) um.set(t.unit_label, []); um.get(t.unit_label)!.push(t) }
  return { direct, units: [...um.entries()].map(([unit, ts]) => ({ unit, tasks: ts })) }
}

const KEYFRAMES = `
@keyframes siteSettle { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: none; } }
@keyframes siteGroupIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
@keyframes siteSubIn { from { opacity: 0; } to { opacity: 1; } }`

export default function ProjectTasks({ session: _session }: { session: Session }) {
  const { projectId = '' } = useParams<{ projectId: string }>()
  const location = useLocation()
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

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
      const { data, error } = await supabase.from('projects').select('name, construction_stack').eq('project_id', projectId).single()
      if (error) throw error
      return data
    },
    enabled: !!projectId,
  })

  const { data: tasks = [], isLoading } = useQuery({
    queryKey: ['project_tasks_v2', projectId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('site_tasks')
        .select('task_id, task_no, phase, trade, floor_label, unit_label, name, description, seq_no, status, source, site_task_qc(question, is_critical, seq)')
        .eq('project_id', projectId)
        .order('seq_no')
      if (error) throw error
      return (data ?? []) as Task[]
    },
    enabled: !!projectId,
  })

  if (isLoading) return <PageSkeleton />

  const groups = groupTasks(tasks)
  const levelCount = groups.filter((g) => g.kind !== 'sitewide').length
  const detailed = tasks.filter((t) => t.description).length
  const allDetailed = tasks.length > 0 && detailed === tasks.length

  // flat line index in render order (groups → direct, then units) = construction order
  const lineIndex = new Map<string, number>()
  let li = 0
  for (const g of groups) {
    const { direct, units } = splitUnits(g.tasks)
    for (const t of direct) lineIndex.set(t.task_id, li++)
    for (const u of units) for (const t of u.tasks) lineIndex.set(t.task_id, li++)
  }

  const anim = { doCascade, cascadeDone, lineIndex }
  const toggleGroup = (k: string) => setCollapsed((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const toggleTask = (id: string) => setExpanded((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })

  return (
    <div style={{ minHeight: '100vh', background: CREAM }}>
      <style>{KEYFRAMES}</style>
      <div style={{ maxWidth: 880, margin: '0 auto', padding: '32px 24px 96px' }}>
        <Link to={`/projects/${projectId}`} style={{ fontSize: 13, color: INK_SOFT, textDecoration: 'none', fontWeight: 500 }}>
          ‹ {project?.name ?? 'Project'}
        </Link>
        <h1 style={{ fontFamily: SERIF, fontSize: 34, fontWeight: 600, color: INK, margin: '10px 0 0', letterSpacing: '-0.01em' }}>Task plan</h1>
        {tasks.length > 0 && (
          <p style={{ fontSize: 14, color: INK_SOFT, margin: '6px 0 0' }}>
            {tasks.length} tasks · {levelCount} {levelCount === 1 ? 'level' : 'levels'} ·{' '}
            <span style={{ color: allDetailed ? SAGE : TERRA, fontWeight: 600 }}>
              {allDetailed ? 'fully detailed' : !detailed ? 'structure ready — details pending' : `${detailed}/${tasks.length} detailed`}
            </span>
          </p>
        )}

        {tasks.length === 0 && (
          <div style={{ marginTop: 40, padding: '48px 24px', textAlign: 'center', background: '#fff', borderRadius: 18, border: `1px solid ${LINE}` }}>
            <p style={{ fontFamily: SERIF, fontSize: 20, color: INK, margin: 0 }}>No tasks yet</p>
            <p style={{ fontSize: 14, color: INK_SOFT, margin: '8px 0 0' }}>
              {project && !project.construction_stack
                ? 'Set up the build type on the project to generate the task plan.'
                : 'This project has no generated tasks.'}
            </p>
          </div>
        )}

        <div style={{ marginTop: 28, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {groups.map((g, gi) => (
            <GroupSection key={g.key} group={g} groupIndex={gi} open={!collapsed.has(g.key)} onToggle={() => toggleGroup(g.key)}
              expanded={expanded} onToggleTask={toggleTask} anim={anim} />
          ))}
        </div>
      </div>
    </div>
  )
}

interface Anim { doCascade: boolean; cascadeDone: boolean; lineIndex: Map<string, number> }

// ── group section (collapsible level / site-wide) ────────────────────────────
function GroupSection({ group, groupIndex, open, onToggle, expanded, onToggleTask, anim }: {
  group: Group; groupIndex: number; open: boolean; onToggle: () => void
  expanded: Set<string>; onToggleTask: (id: string) => void; anim: Anim
}) {
  const tint = group.kind === 'parking' ? '#6b7e8c' : group.kind === 'sitewide' ? INK_SOFT : TERRA
  const { direct, units } = splitUnits(group.tasks)
  const headerAnim = anim.doCascade && !anim.cascadeDone && groupIndex < GROUP_CAP
    ? { animation: `siteGroupIn 220ms ease ${groupIndex * GROUP_STAGGER}ms backwards` } : undefined

  return (
    <section style={{ background: '#fff', borderRadius: 18, border: `1px solid ${LINE}`, overflow: 'hidden', ...headerAnim }}>
      <button onClick={onToggle} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 12, padding: '16px 20px', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: tint, flexShrink: 0 }} />
        <span style={{ fontFamily: SERIF, fontSize: 19, fontWeight: 600, color: INK, flex: 1 }}>{group.label}</span>
        {group.kind === 'parking' && <span style={chip('#6b7e8c')}>Parking</span>}
        <span style={{ fontSize: 12, color: INK_FAINT, fontVariantNumeric: 'tabular-nums' }}>{group.tasks.length}</span>
        <span style={{ fontSize: 16, color: INK_FAINT, transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 180ms' }}>›</span>
      </button>

      {open && (
        <div style={{ padding: '0 20px 8px' }}>
          {direct.length > 0 && <TaskList tasks={direct} expanded={expanded} onToggleTask={onToggleTask} anim={anim} />}
          {units.map((u) => (
            <div key={u.unit} style={{ marginTop: 6 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 0 4px' }}>
                <span style={{ fontSize: 12, fontWeight: 700, color: tint, letterSpacing: '0.04em' }}>{u.unit.toUpperCase()}</span>
                <span style={{ flex: 1, height: 1, background: LINE }} />
              </div>
              <TaskList tasks={u.tasks} expanded={expanded} onToggleTask={onToggleTask} anim={anim} />
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

// ── task list with construction-timeline spine + phase sub-labels ────────────
function TaskList({ tasks, expanded, onToggleTask, anim }: {
  tasks: Task[]; expanded: Set<string>; onToggleTask: (id: string) => void; anim: Anim
}) {
  let lastPhase = ''
  return (
    <div style={{ position: 'relative' }}>
      {tasks.map((t) => {
        const showPhase = t.phase !== lastPhase
        lastPhase = t.phase
        return (
          <div key={t.task_id}>
            {showPhase && (
              <div style={{ fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase', padding: '12px 0 4px 28px' }}>
                {phaseLabel(t.phase)}
              </div>
            )}
            <TaskRow task={t} expanded={expanded.has(t.task_id)} onToggle={() => onToggleTask(t.task_id)} anim={anim} />
          </div>
        )
      })}
    </div>
  )
}

function TaskRow({ task, expanded, onToggle, anim }: { task: Task; expanded: boolean; onToggle: () => void; anim: Anim }) {
  const qc = [...(task.site_task_qc ?? [])].sort((a, b) => a.seq - b.seq)
  const critical = qc.find((q) => q.is_critical)
  const others = qc.filter((q) => !q.is_critical)
  const pending = !task.description && qc.length === 0
  const hasMore = !!task.description || qc.length > 0

  // Motion 1 (line settle) + Motion 2 (sub-text appears after the line, content resolves).
  const idx = anim.lineIndex.get(task.task_id) ?? 0
  const cascading = anim.doCascade && !anim.cascadeDone && idx < CAP
  const lineDelay = cascading ? LINE_BASE + idx * STAGGER : 0
  const rowAnim: CSSProperties = cascading ? { animation: `siteSettle ${SETTLE}ms cubic-bezier(.16,1,.3,1) ${lineDelay}ms backwards` } : {}
  // sub-text never shimmers while the line is still settling: it enters at line-settle-end on
  // first arrival; on later resolves (content arriving via enrich) it fades immediately.
  const subDelay = cascading ? lineDelay + SETTLE : 0
  const subAnim: CSSProperties = { animation: `siteSubIn 220ms ease ${subDelay}ms backwards` }

  return (
    <div style={{ position: 'relative', display: 'flex', gap: 14, padding: '10px 0', ...rowAnim }}>
      <div style={{ position: 'relative', width: 14, flexShrink: 0, display: 'flex', justifyContent: 'center' }}>
        <span style={{ position: 'absolute', top: -10, bottom: -10, width: 1.5, background: LINE }} />
        <StatusNode status={task.status} />
      </div>

      <div style={{ flex: 1, minWidth: 0 }}>
        <button onClick={hasMore ? onToggle : undefined} disabled={!hasMore} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, background: 'none', border: 'none', padding: 0, cursor: hasMore ? 'pointer' : 'default', textAlign: 'left' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: INK, flex: 1 }}>{task.name}</span>
          <StatusBadge status={task.status} />
          {hasMore && <span style={{ fontSize: 14, color: INK_FAINT, transform: expanded ? 'rotate(90deg)' : 'none', transition: 'transform 160ms' }}>›</span>}
        </button>

        <div style={{ marginTop: 5 }}>
          {/* keyed by resolved/pending so the skeleton→content swap remounts → fades (beat 3) */}
          {pending ? (
            <div key="pending" style={subAnim}><PendingSubtext /></div>
          ) : (
            <div key="content" style={subAnim}>
              {task.description && <p style={{ fontSize: 13, lineHeight: 1.5, color: INK_SOFT, margin: 0 }}>{task.description}</p>}
              {critical && (
                <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <span style={{ fontSize: 9.5, fontWeight: 800, color: TERRA, letterSpacing: '0.06em', marginTop: 2, flexShrink: 0 }}>CRITICAL</span>
                  <span style={{ fontSize: 13, lineHeight: 1.45, color: INK, fontWeight: 500 }}>{critical.question}</span>
                </div>
              )}
              {expanded && others.length > 0 && (
                <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {others.map((q, i) => (
                    <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 13, color: INK_FAINT, marginTop: 1, flexShrink: 0 }}>·</span>
                      <span style={{ fontSize: 12.5, lineHeight: 1.45, color: INK_SOFT }}>{q.question}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
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

function PendingSubtext() {
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
