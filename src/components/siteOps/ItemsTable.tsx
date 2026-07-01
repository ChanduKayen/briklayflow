// ItemsTable — the ONE surface for Issues & Snags (a project's /issues page and the cross-site
// Site Desk both render this exact component). An elegant CARD FEED:
//   • COLLAPSED card carries the glance: serif title, assignee, due, the live follow-up SUMMARY,
//     and the LATEST log line (the most recent reply / status / chase).
//   • EXPAND is three clear zones — INFORMATION (assignee · status · cause · dates · live state),
//     ACTIVITY (the full story), and ADD A NOTE (the composer).
// Aesthetic mirrors the transaction-detail hero: serif titles, soft pill+dot chips, a tone rail,
// hover-lift, staggered reveal.

import { useState, useRef, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import confetti from 'canvas-confetti'
import { UserPicker, MemberAvatar } from './UserPicker'
import { TaskPicker } from './TaskPicker'
import { CAUSES } from '../../lib/siteOps/causes'
import { useItemTrail, appendEvent, notifyAssignment, trailKey, type FollowupKind, type FollowupEventType, type FollowupEvent, type FollowState } from '../../lib/siteOps/followup'

const INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.58)', INK_FAINT = 'rgba(34,26,19,0.36)', INK_GHOST = 'rgba(34,26,19,0.24)'
const TERRA = '#C8603A', SAGE = '#5E8157', FAIL = '#B2402A', AMBER = '#B07D2B'
const LINE = 'rgba(34,26,19,0.10)', CARD_LINE = 'rgba(34,26,19,0.08)'
const SERIF = "'Playfair Display', Georgia, serif"
// dark "detail hero" tokens — mirrors the transaction-detail walnut hero
const CREAM = '#F3EADB', CREAM_SOFT = 'rgba(243,234,219,0.64)', CREAM_FAINT = 'rgba(243,234,219,0.42)', CREAM_GHOST = 'rgba(243,234,219,0.26)'
const D_LINE = 'rgba(243,234,219,0.13)', D_FIELD = 'rgba(243,234,219,0.06)', ACCENT = '#E89A72', SAGE_SOFT = '#9CBB91'

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
export interface DeskSnag {
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
  problem?: DeskProblem; snag?: DeskSnag
}

export interface ItemsTableProps {
  issues: DeskProblem[]
  snags: DeskSnag[]
  orgId: string
  actorId: string | null
  followStates?: Record<string, FollowState>
  ownerName: (id: string | null) => string
  taskNames: Record<string, string>
  showSite?: boolean
  projName?: (id: string | null) => string
  onPatchProblem: (id: string, patch: Partial<DeskProblem>, threadEvent?: string, eventType?: ThreadEntry['type']) => void
  onPatchSnag: (id: string, patch: Partial<DeskSnag>) => void
  onToggleSnag: (t: DeskSnag) => void
  onDismissImpact?: (id: string) => void
  emptyLabel?: string
}

function earliestThreat(p?: DeskProblem | null): number | null {
  const ds = (p?.impact?.threatened ?? []).map((t) => t.due).filter(Boolean) as string[]
  if (!ds.length) return null
  return Math.min(...ds.map((d) => new Date(d).getTime()))
}

export default function ItemsTable(props: ItemsTableProps) {
  const { issues, snags, emptyLabel } = props
  const [showArchive, setShowArchive] = useState(false)

  const norm: NRow[] = [
    ...issues.map((p): NRow => ({ kind: 'issue', id: p.id, title: p.title, projectId: p.project_id ?? null, ownerId: p.owner_id, whenIso: p.next_followup_at, done: p.status === 'RESOLVED', createdAt: p.created_at, problem: p })),
    ...snags.map((t): NRow => ({ kind: 'todo', id: t.id, title: t.text, projectId: t.project_id ?? null, ownerId: t.owner_id, whenIso: t.due_date, done: t.status === 'DONE', createdAt: t.created_at, snag: t })),
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
function Row({ r, index, orgId, actorId, followStates, ownerName, taskNames, showSite, projName, onPatchProblem, onPatchSnag, onToggleSnag, onDismissImpact }:
  ItemsTableProps & { r: NRow; index: number }) {
  const [open, setOpen] = useState(false)
  const [pick, setPick] = useState(false)
  const [assignNote, setAssignNote] = useState<{ text: string; ok: boolean } | null>(null)
  const isIssue = r.kind === 'issue'
  const p = r.problem
  const fs = followStates?.[r.id]
  const { overdue } = whenInfo(r.whenIso, r.done)

  const tone = isIssue ? (overdue ? FAIL : p ? STATUS_COLOR[p.status] : TERRA) : (r.done ? SAGE : INK_GHOST)
  const blocking = r.snag?.task_id ?? p?.task_id
  const blockingName = blocking ? taskNames[blocking] : undefined
  const fu = deriveFollowup(r, fs)

  const assign = (id: string | null) => {
    const prev = r.ownerId
    if (isIssue && p) onPatchProblem(p.id, { owner_id: id, owner_source: id ? 'manual' : 'auto' }, id ? `Assignee → ${ownerName(id)}` : 'Assignee cleared')
    else if (r.snag) onPatchSnag(r.snag.id, { owner_id: id })
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

  // ── resolution / done animations (mirrors the Day Book's filing motion) ──
  const cardRef = useRef<HTMLDivElement>(null)
  const [phase, setPhase] = useState<null | 'resolving' | 'striking'>(null)
  // ISSUE → swipe-left into a sage "Issue resolved!" celebration + a subtle confetti burst.
  const resolveIssue = (note: string) => {
    if (!p) return
    setPhase('resolving')
    const el = cardRef.current
    if (el) {
      const rc = el.getBoundingClientRect()
      confetti({ particleCount: 36, spread: 58, startVelocity: 26, scalar: 0.8, ticks: 130, disableForReducedMotion: true,
        origin: { x: (rc.left + rc.width / 2) / window.innerWidth, y: (rc.top + Math.min(rc.height, 120) / 2) / window.innerHeight },
        colors: ['#5E8157', '#9CBB91', '#C8603A', '#E89A72', '#F3EADB'] })
    }
    setTimeout(() => onPatchProblem(p.id, { status: 'RESOLVED', next_followup_at: null }, `Resolved — “${note}”`, 'system'), 1250)
  }
  // SNAG → strike-through, then "snag closed", then file it.
  const markSnagDone = () => { setPhase('striking'); setTimeout(() => onToggleSnag(r.snag!), 850) }
  const onSnagToggle = () => { if (r.done) onToggleSnag(r.snag!); else markSnagDone() }

  return (
    <div ref={cardRef} className={`it-card${overdue ? ' it-overdue' : ''}${open ? ' it-open' : ''}${phase ? ' it-leaving' : ''}`} style={{ animationDelay: `${Math.min(index, 12) * 28}ms` }}>
      {/* celebration revealed underneath as the foreground swipes away (issue resolve) */}
      {phase === 'resolving' && (
        <div className="it-cel">
          <span className="it-cel-check"><span className="material-symbols-outlined" style={{ fontSize: 19 }}>check</span></span>
          <span className="it-cel-text">Issue resolved!</span>
        </div>
      )}

      <div className="it-fg" style={{ transform: phase === 'resolving' ? 'translateX(-101%)' : undefined }}>
        <span className="it-rail" style={{ background: phase === 'striking' ? SAGE : tone }} />

        {/* ── COLLAPSED ── */}
        <div className="it-main" onClick={() => setOpen((o) => !o)}>
          <div className="it-mark" onClick={(e) => e.stopPropagation()}>
            {isIssue ? (
              <span className="it-glyph" style={{ background: softBg(tone), color: tone, border: `1px solid ${softBorder(tone)}` }}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>{overdue ? 'priority_high' : 'warning'}</span>
              </span>
            ) : (
              <button onClick={onSnagToggle} aria-label="Toggle done" className="it-check"
                style={{ borderColor: (r.done || phase === 'striking') ? SAGE : INK_GHOST, background: (r.done || phase === 'striking') ? SAGE : '#fff' }}>
                {(r.done || phase === 'striking') && <span className="material-symbols-outlined" style={{ fontSize: 14, color: '#fff' }}>check</span>}
              </button>
            )}
          </div>

          <div className="it-body">
            <div className="it-titlerow">
              <h3 className="it-title" style={{ fontFamily: SERIF, color: (r.done || phase === 'striking') ? INK_FAINT : INK, textDecoration: r.done && !isIssue ? 'line-through' : 'none', fontWeight: isIssue ? 600 : 500 }}>
                {r.title}
                {phase === 'striking' && <span className="it-strikeline" />}
              </h3>
            <div className="it-right">
              {/* assignee — glance only (edit lives in the expand) */}
              <span className="it-ava" title={ownerName(r.ownerId)}>
                {r.ownerId ? <MemberAvatar name={ownerName(r.ownerId)} size={22} />
                  : <span className="it-avatar-empty" style={{ width: 22, height: 22 }}><span className="material-symbols-outlined" style={{ fontSize: 14, color: INK_GHOST }}>person</span></span>}
              </span>
              {isIssue && p
                ? <StatusPill status={p.status} />
                : <span className="it-typetag" style={{ color: INK_FAINT, borderColor: LINE }}>Snag</span>}
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
            <span className="it-blocking">{blockingName ? `task · ${blockingName}` : 'project-wide'}</span>
          </div>

          {phase === 'striking' && (
            <div className="it-closed"><span className="material-symbols-outlined" style={{ fontSize: 14 }}>task_alt</span> Snag closed</div>
          )}

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
            ? <IssueDetail p={p} assignee={assigneeBlock} blockingName={blockingName} projectId={r.projectId} orgId={orgId} actorId={actorId} ownerName={ownerName} onPatchProblem={onPatchProblem} onResolve={resolveIssue} />
            : <SnagDetail t={r.snag!} assignee={assigneeBlock} blockingName={blockingName} projectId={r.projectId} orgId={orgId} actorId={actorId} ownerName={ownerName} onToggleSnag={onSnagToggle} onPatchSnag={onPatchSnag} />
        )}
      </div>

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
  // Loud (tinted pill) only when it wants attention — awaiting / escalated / overdue.
  // Calm states (scheduled / tracked / replied) read as quiet inline text, so the single
  // remaining mention informs without distracting.
  const loud = !!fu.intensify || fu.tone === FAIL || fu.tone === AMBER
  if (!loud) {
    return (
      <div className="it-summary-quiet" title={fu.hint} onClick={(e) => e.stopPropagation()} style={{ color: fu.tone === INK_FAINT ? INK_SOFT : fu.tone }}>
        <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{fu.icon}</span>
        <span>{fu.label}</span>
        {fu.waitingSince && <span style={{ color: INK_FAINT }}>· {timeAgo(fu.waitingSince)} waiting</span>}
      </div>
    )
  }
  return (
    <div className="it-summary" title={fu.hint} style={{ color: fu.tone, background: softBg(fu.tone), borderColor: softBorder(fu.tone) }} onClick={(e) => e.stopPropagation()}>
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
            : <span className="it-avatar-empty" style={{ width: 24, height: 24 }}><span className="material-symbols-outlined" style={{ fontSize: 15, color: CREAM_GHOST }}>person_add</span></span>}
          <span style={{ fontSize: 13, fontWeight: 600, color: ownerId ? CREAM : CREAM_SOFT }}>{ownerName(ownerId)}</span>
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
function IssueDetail({ p, assignee, blockingName, projectId, orgId, actorId, ownerName, onPatchProblem, onResolve }: {
  p: DeskProblem; assignee: ReactNode; blockingName?: string; projectId: string | null
  orgId: string; actorId: string | null; ownerName: (id: string | null) => string
  onPatchProblem: ItemsTableProps['onPatchProblem']
  onResolve: (note: string) => void
}) {
  const qc = useQueryClient()
  const { data: events = [], isLoading } = useItemTrail('issue', p.id, true)
  const setStatus = (s: IStatus) => onPatchProblem(p.id, { status: s }, `Status → ${s.toLowerCase()}`)
  const setCause = (c: string) => onPatchProblem(p.id, { cause: c }, `Cause set to ${causeLabel(c)}`)
  const retime = (iso: string) => onPatchProblem(p.id, { next_followup_at: iso }, `Next check moved to ${fmtDay(iso)}`, 'system')
  const [taskPick, setTaskPick] = useState(false)
  const [resolving, setResolving] = useState(false)
  const [resNote, setResNote] = useState('')
  // Resolving an issue is a deliberate act — capture HOW it was sorted (a resolution note).
  const onSeg = (s: IStatus) => {
    if (s === 'RESOLVED' && p.status !== 'RESOLVED') { setResolving(true); return }
    setResolving(false); setStatus(s)
  }
  const confirmResolve = () => {
    const note = resNote.trim()
    if (!note) return
    setResolving(false); setResNote('')
    onResolve(note)   // Row plays the resolve celebration, then commits
  }

  return (
    <>
      <div className="it-detail">
        <Section title="Information">
          {assignee}
          <KeyVal label="Status">
            <div className="it-seg">
              {STATUSES.map((s) => {
                const on = p.status === s
                return <button key={s} onClick={() => onSeg(s)} style={{ color: on ? '#fff' : CREAM_SOFT, background: on ? STATUS_COLOR[s] : 'transparent', boxShadow: on ? `0 1px 6px ${STATUS_COLOR[s]}77` : 'none' }}>{STATUS_LABEL[s]}</button>
              })}
            </div>
          </KeyVal>
          {resolving && (
            <div className="it-resolve">
              <div className="it-eyebrow" style={{ color: SAGE_SOFT, marginBottom: 7 }}>Resolution — how was it sorted?</div>
              <textarea value={resNote} onChange={(e) => setResNote(e.target.value)} rows={2} autoFocus className="it-textarea"
                placeholder="e.g. supplier delivered Fri; masons back on site" />
              <div style={{ display: 'flex', gap: 8, marginTop: 9 }}>
                <button onClick={confirmResolve} disabled={!resNote.trim()} className="it-post"
                  style={{ background: SAGE, boxShadow: `0 2px 10px -2px ${SAGE}99`, opacity: resNote.trim() ? 1 : 0.45, cursor: resNote.trim() ? 'pointer' : 'default' }}>
                  <span className="material-symbols-outlined" style={{ fontSize: 15, verticalAlign: '-3px', marginRight: 4 }}>check_circle</span>Mark resolved
                </button>
                <button onClick={() => { setResolving(false); setResNote('') }} className="it-ghostbtn" style={{ color: CREAM_SOFT, borderColor: D_LINE }}>Cancel</button>
              </div>
            </div>
          )}
          <KeyVal label="Cause">
            <select value={p.cause ?? 'other'} onChange={(e) => setCause(e.target.value)} className="it-causesel">
              {CAUSES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </select>
          </KeyVal>
          <KeyVal label="Task">
            {projectId
              ? <button onClick={() => setTaskPick(true)} className="it-pickbtn">
                  <span className="material-symbols-outlined" style={{ fontSize: 15, color: blockingName ? ACCENT : CREAM_GHOST }}>{blockingName ? 'link' : 'add_link'}</span>
                  {blockingName ?? 'Link to a task…'}
                  <span className="material-symbols-outlined" style={{ fontSize: 15, color: CREAM_GHOST }}>unfold_more</span>
                </button>
              : <span>{blockingName ?? 'project-wide'}</span>}
            {projectId && blockingName && <Link to={`/projects/${projectId}/tasks`} className="it-link">open in plan</Link>}
          </KeyVal>
          <KeyVal label="Auto follow-up">
            {p.next_followup_at
              ? <span>{fmtDay(p.next_followup_at)} <span className="it-kv-sub">· we’ll WhatsApp the assignee to check progress</span></span>
              : <span className="it-kv-sub">not chased — recorded only</span>}
          </KeyVal>
          {p.deadline && <KeyVal label="Deadline">{fmtDay(p.deadline)} <span className="it-kv-sub">· target to close by</span></KeyVal>}
        </Section>

        <Section title="Activity">
          <Story events={events} isLoading={isLoading} genesisLabel="Issue opened" createdAt={p.created_at} ownerName={ownerName} />
        </Section>

        <Section title="Add a note">
          <Compose kind="issue" id={p.id} orgId={orgId} actorId={actorId} onRetime={retime}
            onEngaged={() => { if (p.status === 'OPEN') onPatchProblem(p.id, { status: 'ADDRESSING' }, 'Now addressing — note added', 'system') }}
            onPosted={() => qc.invalidateQueries({ queryKey: trailKey('issue', p.id) })} />
        </Section>
      </div>

      {taskPick && projectId && (
        <TaskPicker projectId={projectId} currentTaskId={p.task_id}
          onPick={(tid, label) => { onPatchProblem(p.id, { task_id: tid }, tid ? `Linked to ${label}` : 'Set to project-wide'); setTaskPick(false) }}
          onClose={() => setTaskPick(false)} />
      )}
    </>
  )
}

// ── SNAG detail — lighter, same 3-zone frame ─────────────────────────────────
function SnagDetail({ t, assignee, blockingName, projectId, orgId, actorId, ownerName, onToggleSnag, onPatchSnag }: {
  t: DeskSnag; assignee: ReactNode; blockingName?: string; projectId: string | null
  orgId: string; actorId: string | null; ownerName: (id: string | null) => string
  onToggleSnag: (t: DeskSnag) => void
  onPatchSnag: ItemsTableProps['onPatchSnag']
}) {
  const qc = useQueryClient()
  const { data: events = [], isLoading } = useItemTrail('todo', t.id, true)
  const [taskPick, setTaskPick] = useState(false)
  return (
    <>
      <div className="it-detail">
        <Section title="Information">
          {assignee}
          <KeyVal label="Status">
            <button onClick={() => onToggleSnag(t)} className="it-snag-toggle" style={{ color: t.status === 'DONE' ? SAGE_SOFT : CREAM_SOFT, borderColor: t.status === 'DONE' ? softBorder(SAGE) : D_LINE, background: t.status === 'DONE' ? softBg(SAGE) : D_FIELD }}>
              <span className="material-symbols-outlined" style={{ fontSize: 15 }}>{t.status === 'DONE' ? 'task_alt' : 'radio_button_unchecked'}</span>{t.status === 'DONE' ? 'Done' : 'Mark done'}
            </button>
          </KeyVal>
          <KeyVal label="Task">
            {projectId
              ? <button onClick={() => setTaskPick(true)} className="it-pickbtn">
                  <span className="material-symbols-outlined" style={{ fontSize: 15, color: blockingName ? ACCENT : CREAM_GHOST }}>{blockingName ? 'link' : 'add_link'}</span>
                  {blockingName ?? 'Link to a task…'}
                  <span className="material-symbols-outlined" style={{ fontSize: 15, color: CREAM_GHOST }}>unfold_more</span>
                </button>
              : <span>{blockingName ?? 'project-wide'}</span>}
            {projectId && blockingName && <Link to={`/projects/${projectId}/tasks`} className="it-link">open in plan</Link>}
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

      {taskPick && projectId && (
        <TaskPicker projectId={projectId} currentTaskId={t.task_id}
          onPick={(tid) => { onPatchSnag(t.id, { task_id: tid }); setTaskPick(false) }}
          onClose={() => setTaskPick(false)} />
      )}
    </>
  )
}

// ── the story (logs) ──────────────────────────────────────────────────────────
function Story({ events, isLoading, genesisLabel, createdAt, ownerName }: {
  events: FollowupEvent[]; isLoading: boolean; genesisLabel: string; createdAt: string; ownerName: (id: string | null) => string
}) {
  return (
    <div className="it-story">
      <TrailRow color={CREAM_FAINT} body={genesisLabel} at={createdAt} first />
      {events.map((e) => {
        const quoted = e.type === 'reply_received' || e.type === 'comment'
        const raw = e.body ?? e.type.replace(/_/g, ' ')
        return <TrailRow key={e.id} color={trailColorDark(e.type)} tag={eventTag(e.type)} body={quoted ? `“${raw}”` : raw} at={e.created_at} by={e.actor_kind === 'user' ? ownerName(e.actor_id) : null} />
      })}
      {!isLoading && events.length === 0 && (
        <p style={{ fontSize: 12, color: CREAM_FAINT, fontStyle: 'italic', margin: '0 0 0 16px' }}>Nothing else yet — the first check-in will show here once it goes out.</p>
      )}
    </div>
  )
}

// ── the composer (input) ──────────────────────────────────────────────────────
function Compose({ kind, id, orgId, actorId, onRetime, onPosted, onEngaged }: {
  kind: FollowupKind; id: string; orgId: string; actorId: string | null
  onRetime?: (iso: string) => void; onPosted: () => void; onEngaged?: () => void
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
    if (note) onEngaged?.()   // a note/blocker is activity → move OPEN → ADDRESSING (issues)
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
    <button onClick={onClick} className="it-toggle" style={{ color: on ? tone : CREAM_SOFT, background: on ? softBg(tone) : 'transparent', borderColor: on ? softBorder(tone) : D_LINE }}>
      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>{icon}</span>{children}
    </button>
  )
}

// ── follow-up summary derivation ──────────────────────────────────────────────
// The follow-up summary — plain language about WHO does WHAT and WHY (the chase engine
// auto-messages the assignee on WhatsApp; `hint` is the hover tooltip that spells it out).
interface Followup { label: string; tone: string; icon: string; hint: string; waitingSince?: string; intensify?: boolean }
function deriveFollowup(r: NRow, fs?: FollowState): Followup | null {
  if (r.done) return null
  const now = Date.now()
  const overdue = !!r.whenIso && new Date(r.whenIso).getTime() < now
  const day = r.whenIso ? whenInfo(r.whenIso, false).label : ''

  if (fs?.escalated) return { label: 'Escalated', tone: FAIL, icon: 'arrow_upward', waitingSince: fs.lastChaseAt ?? undefined, intensify: true, hint: 'No resolution — pushed up to the supervisor / principal.' }
  const chased = fs?.lastChaseAt, replied = fs?.lastReplyAt
  if (chased && (!replied || replied < chased)) {
    const waitDays = (now - new Date(chased).getTime()) / 86_400_000
    return { label: 'Awaiting reply', tone: AMBER, icon: 'hourglass_top', waitingSince: chased, intensify: overdue || waitDays > 2, hint: 'We WhatsApp’d the assignee to check progress — waiting for their reply.' }
  }
  if (replied) return { label: r.problem?.status === 'ADDRESSING' ? 'Replied · in progress' : 'Replied', tone: SAGE, icon: 'mark_chat_read', hint: 'The assignee replied on WhatsApp.' }
  if (r.kind === 'issue' && !r.whenIso) return { label: 'Tracked — not chased', tone: INK_FAINT, icon: 'visibility', hint: 'Recorded for the record — no automatic follow-up (e.g. weather / auspicious timing).' }
  if (r.whenIso && !overdue) {
    return r.kind === 'issue'
      ? { label: `We'll follow up ${day}`, tone: INK_FAINT, icon: 'schedule_send', hint: `If it's still open, we'll WhatsApp the assignee on ${day} to check progress.` }
      : { label: `Due ${day}`, tone: INK_FAINT, icon: 'event', hint: `Due ${day}.` }
  }
  if (overdue) return { label: 'Follow-up due now', tone: AMBER, icon: 'notifications_active', intensify: true, hint: 'The next follow-up is due — the assignee will be messaged on the next run.' }
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
// On the dark expand, the two ink-toned events (comment / status) would vanish — lift them to cream.
function trailColorDark(type: FollowupEventType): string {
  const c = trailColor(type)
  return c === INK ? CREAM : c === INK_FAINT ? CREAM_FAINT : c
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
        {body}{by && by !== 'Unassigned' ? <span style={{ color: CREAM_FAINT }}> · {by}</span> : null}
      </span>
      {at && <span className="it-trail-at">{timeAgo(at)}</span>}
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

.it-rail { position:absolute; left:0; top:0; bottom:0; width:3px; transition:width .2s, background .3s; }
.it-card:hover .it-rail, .it-card.it-open .it-rail { width:5px; }

/* resolve / done motion (mirrors the Day Book filing reveal) */
.it-fg { position:relative; z-index:1; background:#fff; transition:transform .6s cubic-bezier(.5,0,.12,1); }
.it-card.it-leaving { box-shadow:0 16px 36px -14px rgba(34,26,19,.22); }
.it-cel { position:absolute; inset:0; z-index:0; display:flex; align-items:center; justify-content:center; gap:11px;
  background:radial-gradient(120% 140% at 12% 50%, rgba(255,255,255,.14) 0%, transparent 45%), linear-gradient(120deg,#5E8157 0%,#6E9566 52%,#54704A 100%); }
.it-cel-check { display:flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:50%; background:rgba(255,255,255,.24); color:#fff; animation:itPop .5s cubic-bezier(.2,1.35,.4,1) both; }
.it-cel-text { font-family:${SERIF}; font-size:18px; font-weight:600; color:#fff; letter-spacing:-.01em; animation:itRise .45s .08s backwards; }
@keyframes itPop { from { transform:scale(0); opacity:0; } to { transform:scale(1); opacity:1; } }
.it-strikeline { position:absolute; left:0; top:54%; height:2px; border-radius:2px; background:${SAGE}; width:0; animation:itStrike .42s cubic-bezier(.5,0,.2,1) forwards; }
@keyframes itStrike { to { width:100%; } }

.it-main { display:flex; gap:13px; padding:15px 17px 15px 18px; cursor:pointer; }
.it-mark { flex-shrink:0; padding-top:1px; }
.it-glyph { display:flex; align-items:center; justify-content:center; width:30px; height:30px; border-radius:9px; }
.it-check { display:flex; align-items:center; justify-content:center; width:24px; height:24px; margin-top:2px; border-radius:7px; border:1.5px solid; cursor:pointer; transition:transform .12s, background .15s; }
.it-check:hover { transform:scale(1.08); }

.it-body { flex:1; min-width:0; }
.it-titlerow { display:flex; align-items:flex-start; gap:12px; }
.it-title { position:relative; flex:1; min-width:0; margin:0; font-size:16px; line-height:1.3; letter-spacing:-0.01em; }
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
.it-summary-quiet { display:inline-flex; align-items:center; gap:6px; margin-top:10px; font-size:12px; }
.it-closed { display:inline-flex; align-items:center; gap:5px; margin-top:9px; font-size:12px; font-weight:600; color:${SAGE}; animation:itRise .35s .22s backwards; }
.it-latest { display:flex; align-items:center; gap:7px; margin-top:9px; padding-left:2px; font-size:12px; color:${INK}; }
.it-latest-body { flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* expand — the dark "detail hero" (mirrors the transaction-detail walnut hero) */
.it-detail { border-top:1px solid rgba(0,0,0,.3);
  background:
    radial-gradient(120% 120% at 88% -8%, rgba(224,138,92,.16) 0%, rgba(224,138,92,0) 46%),
    linear-gradient(158deg,#2D2118 0%,#221A13 58%,#19130D 100%);
  animation:itReveal .3s ease backwards; }
@keyframes itReveal { from { opacity:0; transform:translateY(-5px); } }

.it-section { padding:15px 18px; border-bottom:1px solid ${D_LINE}; }
.it-section:last-child { border-bottom:none; }
.it-section-title { font-size:9.5px; font-weight:700; color:${ACCENT}; letter-spacing:.13em; text-transform:uppercase; margin-bottom:12px; }

.it-kv { display:flex; gap:12px; padding:6px 0; align-items:flex-start; }
.it-kv-label { flex-shrink:0; width:88px; font-size:11.5px; color:${CREAM_FAINT}; padding-top:3px; }
.it-kv-val { flex:1; min-width:0; font-size:13px; color:${CREAM}; display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.it-kv-sub { color:${CREAM_FAINT}; font-size:11.5px; }

.it-assignee-btn { display:inline-flex; align-items:center; gap:9px; padding:4px 12px 4px 5px; border:1px solid ${D_LINE}; border-radius:999px; background:${D_FIELD}; cursor:pointer; transition:border-color .15s, box-shadow .15s; }
.it-assignee-btn:hover { border-color:rgba(243,234,219,.3); box-shadow:0 3px 12px -4px rgba(0,0,0,.5); }
.it-assignee-btn:hover .it-assignee-edit { color:${ACCENT}; }
.it-assignee-edit { color:${CREAM_GHOST}; transition:color .15s; }
.it-avatar-empty { display:flex; align-items:center; justify-content:center; border-radius:50%; border:1.5px dashed ${CREAM_GHOST}; }
.it-assignnote { display:inline-flex; align-items:center; gap:5px; padding:3px 10px; border:1px solid; border-radius:999px; font-size:11px; font-weight:600; animation:itRise .3s backwards; }

.it-seg { display:inline-flex; gap:3px; padding:3px; background:rgba(0,0,0,.26); border:1px solid ${D_LINE}; border-radius:10px; }
.it-seg button { font-size:11px; font-weight:600; padding:5px 12px; border-radius:7px; border:none; cursor:pointer; transition:all .16s; }
.it-causesel { font-size:12.5px; color:${CREAM}; border:1px solid ${D_LINE}; border-radius:8px; padding:4px 9px; background:${D_FIELD}; cursor:pointer; font-family:inherit; }
.it-causesel option { color:#221A13; }
.it-pickbtn { display:inline-flex; align-items:center; gap:6px; font-size:13px; font-weight:500; color:${CREAM}; padding:4px 10px; border:1px solid ${D_LINE}; border-radius:9px; background:${D_FIELD}; cursor:pointer; transition:border-color .15s, box-shadow .15s; }
.it-pickbtn:hover { border-color:rgba(243,234,219,.3); box-shadow:0 3px 12px -4px rgba(0,0,0,.5); }
.it-snag-toggle { display:inline-flex; align-items:center; gap:5px; font-size:12px; font-weight:600; padding:5px 12px; border:1px solid; border-radius:999px; cursor:pointer; }
.it-link { color:${ACCENT}; font-weight:600; text-decoration:none; }
.it-link:hover { text-decoration:underline; text-underline-offset:2px; }

.it-resolve { background:rgba(94,129,87,.16); border:1px solid rgba(156,187,145,.3); border-radius:12px; padding:11px 13px; margin:4px 0 6px; animation:itReveal .25s ease backwards; }
.it-resolve .it-textarea { font-size:13px; }
.it-ghostbtn { font-size:11px; font-weight:600; padding:4px 11px; border:1px solid; border-radius:999px; background:transparent; cursor:pointer; transition:transform .12s; }
.it-ghostbtn:hover { transform:translateY(-1px); }

.it-story { display:flex; flex-direction:column; gap:11px; padding-left:2px; }
.it-trailrow { display:flex; gap:10px; align-items:baseline; }
.it-trail-node { width:7px; height:7px; border-radius:50%; flex-shrink:0; margin-top:5px; }
.it-trail-body { flex:1; min-width:0; font-size:12.5px; color:${CREAM}; line-height:1.45; }
.it-trail-tag { font-size:9px; font-weight:800; letter-spacing:.06em; text-transform:uppercase; margin-right:7px; }
.it-trail-at { font-size:11px; color:${CREAM_FAINT}; white-space:nowrap; }

.it-compose { background:${D_FIELD}; border:1px solid ${D_LINE}; border-radius:12px; padding:11px 12px; transition:border-color .15s, box-shadow .15s; }
.it-compose:focus-within { border-color:${ACCENT}88; box-shadow:0 0 0 3px rgba(224,138,92,.2); }
.it-textarea { width:100%; box-sizing:border-box; resize:vertical; border:none; outline:none; font-size:13.5px; color:${CREAM}; background:transparent; font-family:inherit; line-height:1.5; }
.it-textarea::placeholder { color:${CREAM_GHOST}; }
.it-compose-bar { display:flex; align-items:center; gap:8px; margin-top:9px; flex-wrap:wrap; }
.it-toggle { display:inline-flex; align-items:center; gap:5px; font-size:11.5px; font-weight:600; padding:4px 10px; border:1px solid; border-radius:999px; background:transparent; cursor:pointer; transition:all .15s; }
.it-date { font-size:12px; border:1px solid ${D_LINE}; border-radius:8px; padding:4px 8px; color:${CREAM}; background:${D_FIELD}; font-family:inherit; color-scheme:dark; }
.it-post { font-size:12px; font-weight:700; padding:6px 18px; border-radius:999px; border:none; background:${TERRA}; color:#fff; box-shadow:0 2px 10px -2px ${TERRA}aa; transition:transform .12s, box-shadow .15s; }
.it-post:not(:disabled):hover { transform:translateY(-1px); box-shadow:0 6px 16px -3px ${TERRA}; }

.it-arch-toggle:hover { background:rgba(34,26,19,.04); }

@media (max-width:560px) {
  .it-main { padding:13px 14px; gap:11px; }
  .it-title { font-size:15px; }
  .it-section { padding:13px 14px; }
  .it-kv { flex-direction:column; gap:3px; }
  .it-kv-label { width:auto; padding-top:0; }
}
`
