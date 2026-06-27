// ItemsTable — the ONE surface for Issues & To-dos (a project's /issues page and the cross-site
// Site Desk both render this exact component). An elegant CARD FEED:
//   • COLLAPSED card carries the glance: serif title, assignee, due, the live follow-up SUMMARY,
//     and the LATEST log line (the most recent reply / status / chase).
//   • EXPAND is three clear zones — INFORMATION (assignee · status · cause · dates · live state),
//     ACTIVITY (the full story), and ADD A NOTE (the composer).
// Aesthetic mirrors the transaction-detail hero: serif titles, soft pill+dot chips, a tone rail,
// hover-lift, staggered reveal.

import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { UserPicker, MemberAvatar } from './UserPicker'
import { CAUSES } from '../../lib/siteOps/causes'
import { useItemTrail, appendEvent, notifyAssignment, trailKey, type FollowupKind, type FollowupEventType, type FollowupEvent, type FollowState } from '../../lib/siteOps/followup'

const INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.58)', INK_FAINT = 'rgba(34,26,19,0.36)', INK_GHOST = 'rgba(34,26,19,0.24)'
const TERRA = '#C8603A', SAGE = '#5E8157', FAIL = '#B2402A', AMBER = '#B07D2B'
const LINE = 'rgba(34,26,19,0.10)', CARD_LINE = 'rgba(34,26,19,0.08)'
const SERIF = "'Playfair Display', Georgia, serif"

const isHex = (c: string) => c.startsWith('#')
const softBg = (c: string) => (isHex(c) ? `${c}14` : 'rgba(34,26,19,0.045)')
const softBorder = (c: string) => (isHex(c) ? `${c}33` : LINE)

export type IStatus = 'OPEN' | 'ADDRESSING' | 'RESOLVED'
export interface ThreadEntry { type?: 'system' | 'chase' | 'reply' | 'escalation'; event?: string; at?: string; by?: string; detail?: string }
export interface ImpactThreat { task_id: string | null; name: string; due: string | null; reason?: string }
export interface ImpactSuggestion { threatened: ImpactThreat[]; implication: string | null }
export interface DeskProblem {
  id: string; title: string; status: IStatus; cause: string | null
  owner_id: string | null; owner_source: 'auto' | 'manual'
  task_id: string | null; source_narration_id: string | null; project_id?: string | null
  next_followup_at: string | null; status_history: ThreadEntry[]; created_at: string
  deadline?: string | null
  impact?: ImpactSuggestion | null
}
export interface DeskTodo {
  id: string; text: string; owner_id: string | null; due_date: string | null
  status: 'OPEN' | 'DONE'; task_id: string | null; project_id?: string | null; created_at: string
}

const STATUSES: IStatus[] = ['OPEN', 'ADDRESSING', 'RESOLVED']
const STATUS_COLOR: Record<IStatus, string> = { OPEN: TERRA, ADDRESSING: AMBER, RESOLVED: SAGE }
const STATUS_LABEL: Record<IStatus, string> = { OPEN: 'Open', ADDRESSING: 'Addressing', RESOLVED: 'Resolved' }

function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime(); if (isNaN(ms)) return ''
  const m = Math.round(ms / 60000); if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
const fmtDay = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '—'
function whenInfo(iso: string | null, done: boolean): { label: string; overdue: boolean } {
  if (!iso) return { label: '—', overdue: false }
  const d = new Date(iso); if (isNaN(+d)) return { label: '—', overdue: false }
  const now = new Date()
  const days = Math.round((d.getTime() - new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()) / 86400000)
  const overdue = !done && days < 0
  const label = days >= 0 && days <= 6
    ? d.toLocaleDateString('en-IN', { weekday: 'short' })
    : d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
  return { label, overdue }
}
const causeLabel = (key: string | null) => CAUSES.find((c) => c.key === (key ?? 'other'))?.label ?? 'Other'

interface NRow {
  kind: 'issue' | 'todo'
  id: string; title: string; projectId: string | null; ownerId: string | null
  whenIso: string | null; done: boolean; createdAt: string
  problem?: DeskProblem; todo?: DeskTodo
}

export interface ItemsTableProps {
  issues: DeskProblem[]
  todos: DeskTodo[]
  orgId: string
  actorId: string | null
  followStates?: Record<string, FollowState>
  ownerName: (id: string | null) => string
  taskNames: Record<string, string>
  showSite?: boolean
  projName?: (id: string | null) => string
  onPatchProblem: (id: string, patch: Partial<DeskProblem>, threadEvent?: string, eventType?: ThreadEntry['type']) => void
  onPatchTodo: (id: string, patch: Partial<DeskTodo>) => void
  onToggleTodo: (t: DeskTodo) => void
  onDismissImpact?: (id: string) => void
  emptyLabel?: string
}

function earliestThreat(p?: DeskProblem | null): number | null {
  const ds = (p?.impact?.threatened ?? []).map((t) => t.due).filter(Boolean) as string[]
  if (!ds.length) return null
  return Math.min(...ds.map((d) => new Date(d).getTime()))
}

export default function ItemsTable(props: ItemsTableProps) {
  const { issues, todos, emptyLabel } = props
  const [showArchive, setShowArchive] = useState(false)

  const norm: NRow[] = [
    ...issues.map((p): NRow => ({ kind: 'issue', id: p.id, title: p.title, projectId: p.project_id ?? null, ownerId: p.owner_id, whenIso: p.next_followup_at, done: p.status === 'RESOLVED', createdAt: p.created_at, problem: p })),
    ...todos.map((t): NRow => ({ kind: 'todo', id: t.id, title: t.text, projectId: t.project_id ?? null, ownerId: t.owner_id, whenIso: t.due_date, done: t.status === 'DONE', createdAt: t.created_at, todo: t })),
  ]
  const byNewest = (a: NRow, b: NRow) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  const esc = (r: NRow) => (props.followStates?.[r.id]?.escalated ? 1 : 0)
  const bySeverity = (a: NRow, b: NRow) => {
    const ea = esc(a), eb = esc(b)
    if (ea !== eb) return eb - ea
    const ta = earliestThreat(a.problem), tb = earliestThreat(b.problem)
    if (ta != null && tb != null) return ta - tb
    if (ta != null) return -1
    if (tb != null) return 1
    return byNewest(a, b)
  }
  const active = norm.filter((r) => !r.done).sort(bySeverity)
  const archived = norm.filter((r) => r.done).sort(byNewest)

  return (
    <div>
      <style>{CSS}</style>
      {active.length === 0 ? (
        <div style={{ padding: '46px 18px', textAlign: 'center', color: INK_SOFT, fontSize: 14, background: '#fff', border: `1px solid ${CARD_LINE}`, borderRadius: 16 }}>
          {emptyLabel ?? 'Nothing open — all clear.'}
        </div>
      ) : (
        <div className="it-list">
          {active.map((r, i) => <Row key={`${r.kind}:${r.id}`} r={r} index={i} {...props} />)}
        </div>
      )}

      {archived.length > 0 && (
        <div style={{ marginTop: 14 }}>
          <button onClick={() => setShowArchive((s) => !s)} className="it-arch-toggle"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '7px 12px', fontSize: 11, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.06em', textTransform: 'uppercase', background: 'transparent', border: 'none', cursor: 'pointer', borderRadius: 10 }}>
            <span style={{ display: 'inline-block', transition: 'transform .2s', transform: showArchive ? 'rotate(90deg)' : 'none' }}>›</span>
            Resolved &amp; done · {archived.length}
          </button>
          {showArchive && (
            <div className="it-list" style={{ marginTop: 8, opacity: 0.62 }}>
              {archived.map((r, i) => <Row key={`${r.kind}:${r.id}`} r={r} index={i} {...props} />)}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ── one card ──────────────────────────────────────────────────────────────────
function Row({ r, index, orgId, actorId, followStates, ownerName, taskNames, showSite, projName, onPatchProblem, onPatchTodo, onToggleTodo, onDismissImpact }:
  ItemsTableProps & { r: NRow; index: number }) {
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(false)
  const [assignNote, setAssignNote] = useState<{ text: string; ok: boolean } | null>(null)
  const isIssue = r.kind === 'issue'
  const p = r.problem
  const fs = followStates?.[r.id]
  const { label: whenLabel, overdue } = whenInfo(r.whenIso, r.done)

  const tone = isIssue ? (overdue ? FAIL : p ? STATUS_COLOR[p.status] : TERRA) : (r.done ? SAGE : INK_GHOST)
  const blocking = r.todo?.task_id ?? p?.task_id
  const blockingName = blocking ? taskNames[blocking] : undefined
  const fu = deriveFollowup(r, fs)

  const assign = (id: string | null) => {
    const prev = r.ownerId
    if (isIssue && p) onPatchProblem(p.id, { owner_id: id, owner_source: id ? 'manual' : 'auto' }, id ? `Assignee → ${ownerName(id)}` : 'Assignee cleared')
    else if (r.todo) onPatchTodo(r.todo.id, { owner_id: id })
    if (id && id !== prev) {
      const who = ownerName(id)
      setAssignNote({ text: `Notifying ${who}…`, ok: true })
      notifyAssignment(r.kind, r.id, id).then((res) => {
        setAssignNote(
          !res ? { text: `Assigned — notifier unreachable (deploy the function)`, ok: false }
          : res.notified ? { text: `${who} notified on WhatsApp${res.channel === 'template' ? '' : ' (in chat)'}`, ok: true }
          : { text: `Assigned — ${res.reason ?? 'no WhatsApp notice sent'}`, ok: false },
        )
        setTimeout(() => setAssignNote(null), 8000)
      })
    }
    setPick(false)
  }

  const assigneeBlock = <AssigneeRow ownerId={r.ownerId} ownerName={ownerName} onPick={() => setPick(true)} note={assignNote} />

  return (
    <div className={`it-card${overdue ? ' it-overdue' : ''}${open ? ' it-open' : ''}`} style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}>
      <span className="it-rail" style={{ background: tone }} />

      {/* ── COLLAPSED ── */}
      <div className="it-main" onClick={() => setOpen((o) => !o)}>
        <div className="it-mark" onClick={(e) => e.stopPropagation()}>
          {isIssue ? (
            <span className="it-glyph" style={{ background: softBg(tone), color: tone, border: `1px solid ${softBorder(tone)}` }}>
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{overdue ? 'priority_high' : 'warning'}</span>
            </span>
          ) : (
            <button onClick={() => onToggleTodo(r.todo!)} aria-label="Toggle done" className="it-check"
              style={{ borderColor: r.done ? SAGE : INK_GHOST, background: r.done ? SAGE : '#fff' }}>
              {r.done && <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#fff' }}>check</span>}
            </button>
          )}
        </div>

        <div className="it-body">
          <div className="it-titlerow">
            <h3 className="it-title" style={{ fontFamily: SERIF, color: r.done ? INK_FAINT : INK, textDecoration: r.done && !isIssue ? 'line-through' : 'none', fontWeight: isIssue ? 600 : 500 }}>
              {r.title}
            </h3>
            <div className="it-right">
              {/* assignee — glance only (edit lives in the expand) */}
              <span className="it-ava" title={ownerName(r.ownerId)}>
                {r.ownerId ? <MemberAvatar name={ownerName(r.ownerId)} size={22} />
                  : <span className="it-avatar-empty" style={{ width: 22, height: 22 }}><span className="material-symbols-outlined" style={{ fontSize: 14, color: INK_GHOST }}>person</span></span>}
              </span>
              {whenLabel !== '—' && (
                <span className="it-when" style={{ color: overdue ? FAIL : INK_SOFT, fontWeight: overdue ? 700 : 500 }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{overdue ? 'event_busy' : 'event'}</span>{whenLabel}
                </span>
              )}
              {isIssue && p
                ? <StatusPill status={p.status} />
                : <span className="it-typetag" style={{ color: INK_FAINT, borderColor: LINE }}>To-do</span>}
              <span className="it-chev" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} style={{ transform: open ? 'rotate(180deg)' : 'none' }}>
                <span className="material-symbols-outlined" style={{ fontSize: 20 }}>expand_more</span>
              </span>
            </div>
          </div>

          <div className="it-meta">
            {isIssue && <Chip tone={TERRA}>{causeLabel(p?.cause ?? null)}</Chip>}
            {showSite && projName && r.projectId && (
              <Link to={`/projects/${r.projectId}/issues`} onClick={(e) => e.stopPropagation()} className="it-sitechip">
                <span className="it-dot" style={{ background: TERRA }} />{projName(r.projectId)}
              </Link>
            )}
            <span className="it-blocking">{blockingName ? `blocking ${blockingName}` : 'project-level'}</span>
          </div>

          {isIssue && p?.impact?.implication && (
            <div className="it-impact" onClick={(e) => e.stopPropagation()}>
              <span className="material-symbols-outlined" style={{ fontSize: 14 }}>error</span>
              <span style={{ fontStyle: 'italic' }}>{p.impact.implication}</span>
              {onDismissImpact && <button onClick={() => onDismissImpact(p.id)} className="it-impact-x" aria-label="Dismiss">×</button>}
            </div>
          )}

          {/* the glance: live summary + the latest log line */}
          {fu && <SummaryBand fu={fu} />}
          {fs?.last && <LatestLine last={fs.last} ownerName={ownerName} />}
        </div>
      </div>

      {/* ── EXPAND — three zones ── */}
      {open && (
        isIssue && p
          ? <IssueDetail p={p} assignee={assigneeBlock} blockingName={blockingName} projectId={r.projectId} orgId={orgId} actorId={actorId} ownerName={ownerName} onPatchProblem={onPatchProblem} />
          : <TodoDetail t={r.todo!} assignee={assigneeBlock} blockingName={blockingName} projectId={r.projectId} orgId={orgId} actorId={actorId} ownerName={ownerName} onToggleTodo={onToggleTodo} />
      )}

      {pick && <UserPicker orgId={orgId} currentId={r.ownerId} title="Assign to" onPick={assign} onClose={() => setPick(false)} />}
    </div>
  )
}

// ── collapsed bits ────────────────────────────────────────────────────────────
function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return <span className="it-chip" style={{ color: tone, background: softBg(tone), borderColor: softBorder(tone) }}>{children}</span>
}
function StatusPill({ status }: { status: IStatus }) {
  const c = STATUS_COLOR[status]
  return <span className="it-status-pill" style={{ color: c, background: softBg(c), borderColor: softBorder(c) }}><span className="it-dot" style={{ background: c }} />{STATUS_LABEL[status]}</span>
}
function SummaryBand({ fu }: { fu: Followup }) {
  return (
    <div className="it-summary" style={{ color: fu.tone, background: softBg(fu.tone), borderColor: softBorder(fu.tone) }} onClick={(e) => e.stopPropagation()}>
      <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{fu.icon}</span>
      <span style={{ fontWeight: 600 }}>{fu.label}</span>
      {fu.waitingSince && <span style={{ fontSize: 11.5, color: fu.intensify ? FAIL : INK_FAINT, fontWeight: fu.intensify ? 700 : 500 }}>· {timeAgo(fu.waitingSince)} waiting</span>}
    </div>
  )
}
/** The most recent log line, shown on the collapsed card. */
function LatestLine({ last, ownerName }: { last: NonNullable<FollowState['last']>; ownerName: (id: string | null) => string }) {
  const tone = trailColor(last.type)
  const tag = eventTag(last.type)
  const quoted = last.type === 'reply_received' || last.type === 'comment'
  const body = last.body ?? last.type.replace(/_/g, ' ')
  const by = last.actorId ? ownerName(last.actorId) : null
  return (
    <div className="it-latest" onClick={(e) => e.stopPropagation()}>
      <span className="it-dot" style={{ background: tone, width: 6, height: 6 }} />
      {tag && <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase', color: tone }}>{tag}</span>}
      <span className="it-latest-body">{quoted ? `“${body}”` : body}{by && by !== 'Unassigned' ? <span style={{ color: INK_FAINT }}> · {by}</span> : null}</span>
      <span style={{ fontSize: 11, color: INK_FAINT, whiteSpace: 'nowrap' }}>{timeAgo(last.at)}</span>
    </div>
  )
}

// ── expand: shared section + key/value scaffolding ────────────────────────────
function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="it-section">
      <div className="it-section-title">{title}</div>
      {children}
    </div>
  )
}
function KeyVal({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="it-kv">
      <span className="it-kv-label">{label}</span>
      <span className="it-kv-val">{children}</span>
    </div>
  )
}
function AssigneeRow({ ownerId, ownerName, onPick, note }: { ownerId: string | null; ownerName: (id: string | null) => string; onPick: () => void; note: { text: string; ok: boolean } | null }) {
  return (
    <div className="it-kv">
      <span className="it-kv-label">Assignee</span>
      <span className="it-kv-val" style={{ display: 'flex', alignItems: 'center', gap: 9, flexWrap: 'wrap' }}>
        <button onClick={onPick} className="it-assignee-btn">
          {ownerId ? <MemberAvatar name={ownerName(ownerId)} size={24} />
            : <span className="it-avatar-empty" style={{ width: 24, height: 24 }}><span className="material-symbols-outlined" style={{ fontSize: 15, color: INK_GHOST }}>person_add</span></span>}
          <span style={{ fontSize: 13, fontWeight: 600, color: ownerId ? INK : INK_SOFT }}>{ownerName(ownerId)}</span>
          <span className="material-symbols-outlined it-assignee-edit" style={{ fontSize: 14 }}>edit</span>
        </button>
        {note && (
          <span className="it-assignnote" style={{ color: note.ok ? SAGE : AMBER, background: softBg(note.ok ? SAGE : AMBER), borderColor: softBorder(note.ok ? SAGE : AMBER) }}>
            <span className="material-symbols-outlined" style={{ fontSize: 13 }}>{note.ok ? 'check_circle' : 'info'}</span>{note.text}
          </span>
        )}
      </span>
    </div>
  )
}

// ── ISSUE detail — 3 zones ────────────────────────────────────────────────────
function IssueDetail({ p, assignee, blockingName, projectId, orgId, actorId, ownerName, onPatchProblem }: {
  p: DeskProblem; assignee: ReactNode; blockingName?: string; projectId: string | null
  orgId: string; actorId: string | null; ownerName: (id: string | null) => string
  onPatchProblem: ItemsTableProps['onPatchProblem']
}) {
  const qc = useQueryClient()
  const { data: events = [], isLoading } = useItemTrail('issue', p.id, true)
  const setStatus = (s: IStatus) => onPatchProblem(p.id, { status: s }, `Status → ${s.toLowerCase()}`)
  const setCause = (c: string) => onPatchProblem(p.id, { cause: c }, `Cause set to ${causeLabel(c)}`)
  const logFollowup = () => onPatchProblem(p.id, {}, 'Follow-up sent', 'chase')
  const logResponse = () => {
    const movesUp = p.status === 'OPEN'
    onPatchProblem(p.id, movesUp ? { status: 'ADDRESSING' } : {}, movesUp ? 'Response received — now addressing' : 'Response received', 'reply')
  }
  const retime = (iso: string) => onPatchProblem(p.id, { next_followup_at: iso }, `Next check moved to ${fmtDay(iso)}`, 'system')

  return (
    <div className="it-detail">
      <Section title="Information">
        {assignee}
        <KeyVal label="Status">
          <div className="it-seg">
            {STATUSES.map((s) => {
              const on = p.status === s
              return <button key={s} onClick={() => setStatus(s)} style={{ color: on ? '#fff' : INK_SOFT, background: on ? STATUS_COLOR[s] : 'transparent', boxShadow: on ? `0 1px 4px ${STATUS_COLOR[s]}55` : 'none' }}>{STATUS_LABEL[s]}</button>
            })}
          </div>
        </KeyVal>
        <KeyVal label="Cause">
          <select value={p.cause ?? 'other'} onChange={(e) => setCause(e.target.value)} className="it-causesel">
            {CAUSES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </KeyVal>
        <KeyVal label="Blocking">
          <span>{blockingName ?? 'project-level'}</span>
          {projectId && <Link to={`/projects/${projectId}/tasks`} className="it-link" style={{ marginLeft: 8 }}>→ task plan</Link>}
        </KeyVal>
        <KeyVal label="Next check">{fmtDay(p.next_followup_at)}</KeyVal>
        {p.deadline && <KeyVal label="Deadline">{fmtDay(p.deadline)}</KeyVal>}
        <StatusBanner issue={{ nextFollowupAt: p.next_followup_at, status: p.status, onLogFollowup: logFollowup, onLogResponse: logResponse, onRetime: retime }} events={events} />
      </Section>

      <Section title="Activity">
        <Story events={events} isLoading={isLoading} genesisLabel="Issue opened" createdAt={p.created_at} ownerName={ownerName} />
      </Section>

      <Section title="Add a note">
        <Compose kind="issue" id={p.id} orgId={orgId} actorId={actorId} onRetime={retime} onPosted={() => qc.invalidateQueries({ queryKey: trailKey('issue', p.id) })} />
      </Section>
    </div>
  )
}

// ── TO-DO detail — lighter, same 3-zone frame ─────────────────────────────────
function TodoDetail({ t, assignee, blockingName, projectId, orgId, actorId, ownerName, onToggleTodo }: {
  t: DeskTodo; assignee: ReactNode; blockingName?: string; projectId: string | null
  orgId: string; actorId: string | null; ownerName: (id: string | null) => string
  onToggleTodo: (t: DeskTodo) => void
}) {
  const qc = useQueryClient()
  const { data: events = [], isLoading } = useItemTrail('todo', t.id, true)
  return (
    <div className="it-detail">
      <Section title="Information">
        {assignee}
        <KeyVal label="Status">
          <button onClick={() => onToggleTodo(t)} className="it-todo-toggle" style={{ color: t.status === 'DONE' ? SAGE : INK_SOFT, borderColor: t.status === 'DONE' ? softBorder(SAGE) : LINE, background: t.status === 'DONE' ? softBg(SAGE) : '#fff' }}>
            <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{t.status === 'DONE' ? 'task_alt' : 'radio_button_unchecked'}</span>{t.status === 'DONE' ? 'Done' : 'Mark done'}
          </button>
        </KeyVal>
        <KeyVal label="For">
          <span>{blockingName ?? 'project-level'}</span>
          {projectId && <Link to={`/projects/${projectId}/tasks`} className="it-link" style={{ marginLeft: 8 }}>→ task plan</Link>}
        </KeyVal>
        {t.due_date && <KeyVal label="Due">{fmtDay(t.due_date)}</KeyVal>}
      </Section>

      <Section title="Activity">
        <Story events={events} isLoading={isLoading} genesisLabel="Added" createdAt={t.created_at} ownerName={ownerName} />
      </Section>

      <Section title="Add a note">
        <Compose kind="todo" id={t.id} orgId={orgId} actorId={actorId} onPosted={() => qc.invalidateQueries({ queryKey: trailKey('todo', t.id) })} />
      </Section>
    </div>
  )
}

// ── the story (logs) ──────────────────────────────────────────────────────────
function Story({ events, isLoading, genesisLabel, createdAt, ownerName }: {
  events: FollowupEvent[]; isLoading: boolean; genesisLabel: string; createdAt: string; ownerName: (id: string | null) => string
}) {
  return (
    <div className="it-story">
      <TrailRow color={INK_FAINT} body={genesisLabel} at={createdAt} first />
      {events.map((e) => {
        const quoted = e.type === 'reply_received' || e.type === 'comment'
        const raw = e.body ?? e.type.replace(/_/g, ' ')
        return <TrailRow key={e.id} color={trailColor(e.type)} tag={eventTag(e.type)} body={quoted ? `“${raw}”` : raw} at={e.created_at} by={e.actor_kind === 'user' ? ownerName(e.actor_id) : null} />
      })}
      {!isLoading && events.length === 0 && (
        <p style={{ fontSize: 12, color: INK_FAINT, fontStyle: 'italic', margin: '0 0 0 16px' }}>Nothing else yet — the first check-in will show here once it goes out.</p>
      )}
    </div>
  )
}

// ── the composer (input) ──────────────────────────────────────────────────────
function Compose({ kind, id, orgId, actorId, onRetime, onPosted }: {
  kind: FollowupKind; id: string; orgId: string; actorId: string | null
  onRetime?: (iso: string) => void; onPosted: () => void
}) {
  const [draft, setDraft] = useState('')
  const [blocker, setBlocker] = useState(false)
  const [retimeOn, setRetimeOn] = useState(false)
  const [retimeDate, setRetimeDate] = useState('')
  const [busy, setBusy] = useState(false)
  const note = draft.trim()
  const canPost = !busy && (!!note || (!!onRetime && retimeOn && !!retimeDate))

  async function post() {
    if (!canPost) return
    setBusy(true)
    if (note) await appendEvent({ kind, id, orgId, type: blocker ? 'blocker_noted' : 'comment', body: note, actorId })
    if (onRetime && retimeOn && retimeDate) onRetime(new Date(`${retimeDate}T09:00:00`).toISOString())
    setDraft(''); setBlocker(false); setRetimeOn(false); setRetimeDate('')
    setBusy(false)
    onPosted()
  }

  return (
    <div className="it-compose">
      <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} placeholder={onRetime ? 'Add a note, blocker, or progress…' : 'Add a note…'} className="it-textarea" />
      <div className="it-compose-bar">
        <ToggleChip on={blocker} onClick={() => setBlocker((b) => !b)} tone={AMBER} icon="block">Blocker</ToggleChip>
        {onRetime && (
          <>
            <ToggleChip on={retimeOn} onClick={() => setRetimeOn((v) => !v)} tone={TERRA} icon="schedule">Re-time</ToggleChip>
            {retimeOn && <input type="date" value={retimeDate} onChange={(e) => setRetimeDate(e.target.value)} className="it-date" />}
          </>
        )}
        <span style={{ flex: 1 }} />
        <button onClick={post} disabled={!canPost} className="it-post" style={{ opacity: canPost ? 1 : 0.4, cursor: canPost ? 'pointer' : 'default' }}>{busy ? 'Posting…' : 'Post'}</button>
      </div>
    </div>
  )
}

function ToggleChip({ on, onClick, tone, icon, children }: { on: boolean; onClick: () => void; tone: string; icon: string; children: ReactNode }) {
  return (
    <button onClick={onClick} className="it-toggle" style={{ color: on ? tone : INK_SOFT, background: on ? softBg(tone) : 'transparent', borderColor: on ? softBorder(tone) : LINE }}>
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icon}</span>{children}
    </button>
  )
}

// ── follow-up summary derivation ──────────────────────────────────────────────
interface Followup { label: string; tone: string; icon: string; waitingSince?: string; intensify?: boolean }
function deriveFollowup(r: NRow, fs?: FollowState): Followup | null {
  if (r.done) return null
  const now = Date.now()
  const overdue = !!r.whenIso && new Date(r.whenIso).getTime() < now
  if (fs?.escalated) return { label: 'Escalated', tone: FAIL, icon: 'arrow_upward', waitingSince: fs.lastChaseAt ?? undefined, intensify: true }
  const chased = fs?.lastChaseAt, replied = fs?.lastReplyAt
  if (chased && (!replied || replied < chased)) {
    const waitDays = (now - new Date(chased).getTime()) / 86_400_000
    return { label: 'Awaiting reply', tone: AMBER, icon: 'hourglass_top', waitingSince: chased, intensify: overdue || waitDays > 2 }
  }
  if (replied) return { label: r.problem?.status === 'ADDRESSING' ? 'Replied · addressing' : 'Replied', tone: SAGE, icon: 'mark_chat_read' }
  if (r.kind === 'issue' && !r.whenIso) return { label: 'Tracked, not chased', tone: INK_FAINT, icon: 'visibility' }
  if (r.whenIso && !overdue) return { label: `${r.kind === 'issue' ? 'Next check' : 'Due'} ${whenInfo(r.whenIso, false).label}`, tone: INK_FAINT, icon: 'event' }
  if (overdue) return { label: 'Due now', tone: AMBER, icon: 'notifications_active', intensify: true }
  return null
}

function trailColor(type: FollowupEventType): string {
  switch (type) {
    case 'reply_received': return SAGE
    case 'escalated':      return FAIL
    case 'chase_sent':     return TERRA
    case 'blocker_noted':  return AMBER
    case 'comment':        return INK
    default:               return INK_FAINT
  }
}
function eventTag(type: FollowupEventType): string {
  switch (type) {
    case 'chase_sent':     return 'Chase'
    case 'reply_received': return 'Reply'
    case 'blocker_noted':  return 'Blocker'
    case 'escalated':      return 'Escalated'
    case 'status_changed': return 'Update'
    case 'comment':        return 'Note'
    default:               return ''
  }
}
function TrailRow({ color, body, at, by, tag, first }: { color: string; body: string; at?: string; by?: string | null; tag?: string; first?: boolean }) {
  return (
    <div className="it-trailrow">
      <span className="it-trail-node" style={{ background: color, boxShadow: first ? 'none' : `0 0 0 3px ${isHex(color) ? `${color}1f` : 'transparent'}` }} />
      <span className="it-trail-body">
        {tag && <span className="it-trail-tag" style={{ color }}>{tag}</span>}
        {body}{by && by !== 'Unassigned' ? <span style={{ color: INK_FAINT }}> · {by}</span> : null}
      </span>
      {at && <span className="it-trail-at">{timeAgo(at)}</span>}
    </div>
  )
}

interface IssueTrailActions { nextFollowupAt: string | null; status: IStatus; onLogFollowup: () => void; onLogResponse: () => void; onRetime: (iso: string) => void }
function liveStatus(issue: IssueTrailActions, events: FollowupEvent[]): { line: string; sub?: string; tone: string } {
  if (issue.status === 'RESOLVED') return { line: 'Resolved', sub: 'Closed out — no more chasing.', tone: SAGE }
  const last = (t: FollowupEventType) => { const m = events.filter((e) => e.type === t); return m[m.length - 1] }
  const lastChase = last('chase_sent'), lastReply = last('reply_received'), lastBlocker = last('blocker_noted'), lastEsc = last('escalated')
  const next = issue.nextFollowupAt ? fmtDay(issue.nextFollowupAt) : null
  if (lastEsc) return { line: 'Escalated', sub: lastEsc.body ?? 'Chased up — the owner hasn’t resolved it.', tone: FAIL }
  const awaiting = lastChase && (!lastReply || new Date(lastChase.created_at) > new Date(lastReply.created_at))
  if (awaiting) return { line: `Awaiting a reply — we checked in ${timeAgo(lastChase!.created_at)}`, sub: next ? `No word yet; we’ll nudge again around ${next}.` : 'Waiting on the owner.', tone: AMBER }
  if (lastReply) {
    const why = lastBlocker && new Date(lastBlocker.created_at) >= new Date(lastReply.created_at) ? lastBlocker.body : 'Owner replied, but it isn’t marked resolved'
    return { line: `Replied ${timeAgo(lastReply.created_at)} — still open`, sub: `${why}${next ? ` · checking again ${next}` : ''}.`, tone: AMBER }
  }
  if (next) return { line: `Scheduled — first check ${next}`, sub: 'Not chased yet.', tone: INK_SOFT }
  return { line: 'Tracked, not chased', sub: 'Recorded only (e.g. weather / auspicious) — no chase planned.', tone: INK_SOFT }
}
function StatusBanner({ issue, events }: { issue: IssueTrailActions; events: FollowupEvent[] }) {
  const s = liveStatus(issue, events)
  return (
    <div className="it-banner" style={{ borderLeft: `3px solid ${s.tone}` }}>
      <div className="it-banner-top">
        <span className="it-dot" style={{ background: s.tone, width: 8, height: 8 }} />
        <strong style={{ fontSize: 13, color: INK }}>{s.line}</strong>
        <span style={{ flex: 1 }} />
        <button onClick={issue.onLogFollowup} className="it-ghostbtn" style={{ color: TERRA, borderColor: softBorder(TERRA) }}>Log chase</button>
        <button onClick={issue.onLogResponse} className="it-ghostbtn" style={{ color: SAGE, borderColor: softBorder(SAGE) }}>Log reply</button>
      </div>
      {s.sub && <div style={{ fontSize: 12, color: INK_SOFT, marginTop: 5, lineHeight: 1.4 }}>{s.sub}</div>}
    </div>
  )
}

const CSS = `
.it-list { display:flex; flex-direction:column; gap:11px; }

.it-card { position:relative; background:#fff; border:1px solid ${CARD_LINE}; border-radius:15px; overflow:hidden;
  box-shadow:0 1px 2px rgba(34,26,19,.04); animation:itRise .42s cubic-bezier(.2,.7,.3,1) backwards;
  transition:transform .2s cubic-bezier(.2,.7,.3,1), box-shadow .2s, border-color .2s; }
.it-card:hover { transform:translateY(-2px); box-shadow:0 12px 30px -12px rgba(34,26,19,.20); border-color:rgba(34,26,19,.14); }
.it-card.it-open { box-shadow:0 14px 34px -14px rgba(34,26,19,.18); border-color:rgba(34,26,19,.13); }
.it-card.it-overdue { background:linear-gradient(180deg,#FFFCFB 0%,#fff 30%); }
@keyframes itRise { from { opacity:0; transform:translateY(9px); } }

.it-rail { position:absolute; left:0; top:0; bottom:0; width:3px; transition:width .2s; }
.it-card:hover .it-rail, .it-card.it-open .it-rail { width:5px; }

.it-main { display:flex; gap:13px; padding:15px 17px 15px 18px; cursor:pointer; }
.it-mark { flex-shrink:0; padding-top:1px; }
.it-glyph { display:flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:9px; }
.it-check { display:flex; align-items:center; justify-content:center; width:24px; height:24px; margin-top:2px; border-radius:7px; border:1.5px solid; cursor:pointer; transition:transform .12s, background .15s; }
.it-check:hover { transform:scale(1.08); }

.it-body { flex:1; min-width:0; }
.it-titlerow { display:flex; align-items:flex-start; gap:12px; }
.it-title { flex:1; min-width:0; margin:0; font-size:16px; line-height:1.3; letter-spacing:-0.01em; }
.it-right { display:flex; align-items:center; gap:9px; flex-shrink:0; }
.it-ava { display:flex; }
.it-when { display:inline-flex; align-items:center; gap:3px; font-size:12.5px; white-space:nowrap; }
.it-typetag { font-size:10px; font-weight:600; letter-spacing:.04em; text-transform:uppercase; border:1px solid; border-radius:6px; padding:2px 7px; }
.it-chev { display:flex; align-items:center; color:${INK_GHOST}; cursor:pointer; transition:transform .22s cubic-bezier(.2,.7,.3,1), color .15s; }
.it-chev:hover { color:${INK_SOFT}; }

.it-meta { display:flex; align-items:center; gap:8px; margin-top:7px; flex-wrap:wrap; }
.it-chip { font-size:11px; font-weight:600; border:1px solid; border-radius:999px; padding:2px 9px; }
.it-sitechip { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; color:${INK_SOFT}; text-decoration:none; max-width:170px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.it-sitechip:hover { color:${TERRA}; }
.it-dot { width:5px; height:5px; border-radius:50%; flex-shrink:0; }
.it-blocking { font-size:11.5px; color:${INK_FAINT}; }

.it-status-pill { display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:700; border:1px solid; border-radius:999px; padding:3px 9px; }

.it-impact { display:inline-flex; align-items:center; gap:6px; margin-top:9px; padding:4px 10px; border-radius:9px; background:${AMBER}12; border:1px solid ${AMBER}2e; color:${AMBER}; font-size:11.5px; font-weight:600; }
.it-impact-x { font-size:15px; line-height:1; color:${INK_FAINT}; background:none; border:none; padding:0 0 0 2px; cursor:pointer; }
.it-impact-x:hover { color:${FAIL}; }

.it-summary { display:inline-flex; align-items:center; gap:7px; margin-top:11px; padding:6px 12px; border:1px solid; border-radius:11px; font-size:12.5px; }
.it-latest { display:flex; align-items:center; gap:7px; margin-top:9px; padding-left:2px; font-size:12px; color:${INK}; }
.it-latest-body { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* expand */
.it-detail { border-top:1px solid ${CARD_LINE}; background:linear-gradient(180deg,#FCFAF7 0%,#FBF9F6 100%); animation:itReveal .3s ease backwards; }
@keyframes itReveal { from { opacity:0; transform:translateY(-5px); } }

.it-section { padding:14px 18px; border-bottom:1px solid ${CARD_LINE}; }
.it-section:last-child { border-bottom:none; }
.it-section-title { font-size:9.5px; font-weight:700; color:${INK_FAINT}; letter-spacing:.12em; text-transform:uppercase; margin-bottom:11px; }

.it-kv { display:flex; gap:12px; padding:6px 0; align-items:flex-start; }
.it-kv-label { flex-shrink:0; width:84px; font-size:11.5px; color:${INK_FAINT}; padding-top:3px; }
.it-kv-val { flex:1; min-width:0; font-size:13px; color:${INK}; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }

.it-assignee-btn { display:inline-flex; align-items:center; gap:9px; padding:4px 12px 4px 5px; border:1px solid ${LINE}; border-radius:999px; background:#fff; cursor:pointer; transition:border-color .15s, box-shadow .15s; }
.it-assignee-btn:hover { border-color:${INK_GHOST}; box-shadow:0 2px 8px -3px rgba(34,26,19,.14); }
.it-assignee-btn:hover .it-assignee-edit { color:${TERRA}; }
.it-assignee-edit { color:${INK_GHOST}; transition:color .15s; }
.it-avatar-empty { display:flex; align-items:center; justify-content:center; border-radius:50%; border:1.5px dashed ${INK_GHOST}; }
.it-assignnote { display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border:1px solid; border-radius:999px; font-size:11px; font-weight:600; animation:itRise .3s backwards; }

.it-seg { display:inline-flex; gap:3px; padding:3px; background:rgba(34,26,19,.04); border:1px solid ${LINE}; border-radius:10px; }
.it-seg button { font-size:11px; font-weight:600; padding:5px 12px; border-radius:7px; border:none; cursor:pointer; transition:all .16s; }
.it-causesel { font-size:12.5px; color:${INK}; border:1px solid ${LINE}; border-radius:8px; padding:4px 9px; background:#fff; cursor:pointer; font-family:inherit; }
.it-todo-toggle { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; padding:5px 12px; border:1px solid; border-radius:999px; cursor:pointer; }
.it-link { color:${TERRA}; font-weight:600; text-decoration:none; }
.it-link:hover { text-decoration:underline; text-underline-offset:2px; }

.it-banner { background:#fff; border:1px solid ${LINE}; border-radius:12px; padding:11px 13px; margin-top:12px; }
.it-banner-top { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.it-ghostbtn { font-size:11px; font-weight:600; padding:4px 11px; border:1px solid; border-radius:999px; background:#fff; cursor:pointer; transition:transform .12s; }
.it-ghostbtn:hover { transform:translateY(-1px); }

.it-story { display:flex; flex-direction:column; gap:11px; padding-left:2px; }
.it-trailrow { display:flex; gap:10px; align-items:baseline; }
.it-trail-node { width:7px; height:7px; border-radius:50%; flex-shrink:0; margin-top:5px; }
.it-trail-body { flex:1; min-width:0; font-size:12.5px; color:${INK}; line-height:1.45; }
.it-trail-tag { font-size:9px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; margin-right:7px; }
.it-trail-at { font-size:11px; color:${INK_FAINT}; white-space:nowrap; }

.it-compose { background:#fff; border:1px solid ${LINE}; border-radius:12px; padding:11px 12px; transition:border-color .15s, box-shadow .15s; }
.it-compose:focus-within { border-color:${TERRA}66; box-shadow:0 0 0 3px ${TERRA}14; }
.it-textarea { width:100%; box-sizing:border-box; resize:vertical; border:none; outline:none; font-size:13.5px; color:${INK}; background:transparent; font-family:inherit; line-height:1.5; }
.it-textarea::placeholder { color:${INK_GHOST}; }
.it-compose-bar { display:flex; align-items:center; gap:8px; margin-top:9px; flex-wrap:wrap; }
.it-toggle { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; padding:4px 10px; border:1px solid; border-radius:999px; background:#fff; cursor:pointer; transition:all .15s; }
.it-date { font-size:12px; border:1px solid ${LINE}; border-radius:8px; padding:4px 8px; color:${INK}; font-family:inherit; }
.it-post { font-size:12px; font-weight:700; padding:6px 18px; border-radius:999px; border:none; background:${TERRA}; color:#fff; box-shadow:0 2px 8px -2px ${TERRA}77; transition:transform .12s, box-shadow .15s; }
.it-post:not(:disabled):hover { transform:translateY(-1px); box-shadow:0 5px 14px -3px ${TERRA}88; }

.it-arch-toggle:hover { background:rgba(34,26,19,.04); }

@media (max-width:560px) {
  .it-main { padding:13px 14px; gap:11px; }
  .it-title { font-size:15px; }
  .it-section { padding:13px 14px; }
  .it-kv { flex-direction:column; gap:3px; }
  .it-kv-label { width:auto; padding-top:0; }
}
`
