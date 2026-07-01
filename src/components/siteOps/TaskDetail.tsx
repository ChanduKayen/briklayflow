/* eslint-disable react-refresh/only-export-components -- this is the deliberately shared task
   surface: it co-locates the TaskCtx context + qc helpers with the components both views consume,
   which is the point of the "one task component" cut. The only cost is dev fast-refresh for this
   file; correctness/HMR of the consuming pages is unaffected. */
// TaskDetail — THE single task-detail surface. One component, two entry points:
//   · List view (ProjectTasks) renders it inside an expanded row.
//   · Sequence view (ProjectSequence) renders it inside a right-side slide-in drawer.
// Adding a task feature (a QC type, a field) happens HERE, once, and both views get it. This is
// the "one source of truth" discipline applied to the task UI — the mirror of the one engine.
//
// Layout (designer's IA): OPERATIONAL first (status · owner · dates · QC · work · activity ·
// diary — what a supervisor came to act on), then a visually quieter "WHERE IT SITS" section with
// the engine context (position/why/freedom/depends-on/unlocks), which is rendered purely from the
// ProjectVM and computes nothing.

import { createContext, useContext, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase'
import { useSignedDocUrl, useSignedBucketUrl } from '../../lib/storage'
import { X, MapPin, Wrench, Timer, Minus, Plus, Camera, ArrowUp, ChevronRight, User } from 'lucide-react'
import { UserPicker, type OrgMember } from './UserPicker'
import { INK, INK_SOFT, INK_FAINT, TERRA, SAGE, LINE, FAIL, DEFAULT_DURATION, fmtDate, timeAgo } from './taskTokens'
import { useTaskLinkedObjects, useLinkedFollowStates, TaskFeedChip, type LinkedObject } from './TaskFeedChip'

const isImageUrl = (s: string) => /\.(jpe?g|png|gif|webp|heic|avif)(\?|$)/i.test(s) || /\/storage\/v1\/object\//.test(s)

// ── shared task types (the real site_tasks shape the List view uses) ──────────
export type QcStatus = 'pending' | 'confirmed' | 'failed' | null
export interface QcRow {
  id: string; question: string; is_critical: boolean; seq: number; qc_status: QcStatus
  answer?: string | null; answered_at?: string | null; source_narration_id?: string | null
}
export interface StatusEvent { status?: string; at?: string; by?: string; source?: string; narration_id?: string | null }
export interface Task {
  task_id: string; task_no: string; phase: string; trade: string
  floor_label: string | null; unit_label: string | null
  name: string; description: string | null; seq_no: number; status: string
  source: 'generated' | 'manual'
  duration_days?: number | null
  owner_id?: string | null; owner_source?: 'auto' | 'manual'
  status_history?: StatusEvent[]
  updated_at?: string | null
  image_url?: string | null
  node_key?: string | null        // engine identity (present once the graph is persisted)
  task_type_id?: string | null    // engine task-type — how the Sequence drawer maps a VM task to its row
  site_task_qc: QcRow[]
}

// ── shared per-page actions/identity (provided by whichever view mounts TaskDetail) ──
export interface TaskCtxValue {
  orgId: string
  authorId: string
  authorName: string
  members: OrgMember[]
  ownerName: (id: string | null | undefined) => string
  supervisorId: string | null
  principalId: string | null
  setQc: (taskId: string, qcId: string, next: QcStatus) => void
  setDuration: (taskId: string, days: number) => void
  setOwner: (taskId: string, ownerId: string | null) => void
  setStatus: (taskId: string, status: 'not_started' | 'active' | 'done') => void
}
export const TaskCtx = createContext<TaskCtxValue | null>(null)

// ── engine context (sourced from the ProjectVM task; computed nowhere here) ───
export interface VmEdgeLite { label: string; reason?: string; nature: string }
export interface EngineCtx {
  status: 'done' | 'active' | 'available' | 'blocked'
  seqNo: number
  stage?: { label: string; key: string }
  why?: { afterLabel: string; reason: string }[]
  freedomSet?: string
  hardPreds: VmEdgeLite[]
  hardDeps: VmEdgeLite[]
  placementSource?: 'authored' | 'classified'
  needsReview?: boolean
  where?: string
}

// ── QC progress helpers (used by the List row chip + the QC list) ─────────────
export interface QcProgress { total: number; passed: number; failed: number; pending: number; done: boolean }
export function qcProgress(qc: QcRow[]): QcProgress {
  const total = qc.length
  const passed = qc.filter((q) => q.qc_status === 'confirmed').length
  const failed = qc.filter((q) => q.qc_status === 'failed').length
  return { total, passed, failed, pending: total - passed - failed, done: total > 0 && passed === total }
}
export function ProgressRing({ p, size = 18, stroke = 2.5 }: { p: QcProgress; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const frac = p.total ? p.passed / p.total : 0
  const color = p.failed > 0 ? FAIL : p.done ? SAGE : TERRA
  return (
    <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={LINE} strokeWidth={stroke} />
      {frac > 0 && <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
        strokeDasharray={c} strokeDashoffset={c * (1 - frac)} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 240ms ease' }} />}
    </svg>
  )
}
export function QcProgressChip({ p }: { p: QcProgress }) {
  const color = p.failed > 0 ? FAIL : p.done ? SAGE : INK_FAINT
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
      <ProgressRing p={p} /><span style={{ fontSize: 11.5, fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{p.passed}/{p.total}</span>
    </span>
  )
}

// ── status display + control ──────────────────────────────────────────────────
export function StatusNode({ status }: { status: string }) {
  const base = { width: 11, height: 11, borderRadius: '50%', marginTop: 4, zIndex: 1, background: '#fff', boxShadow: '0 0 0 2px #fff' } as const
  if (status === 'done') return <span style={{ ...base, background: SAGE }} />
  if (status === 'active') return <span style={{ ...base, background: TERRA }} />
  return <span style={{ ...base, border: `1.5px solid ${INK_FAINT}` }} />
}
export function StatusBadge({ status }: { status: string }) {
  const cfg = status === 'done' ? { c: SAGE, t: 'Done' } : status === 'active' ? { c: TERRA, t: 'Active' } : { c: INK_FAINT, t: 'Not started' }
  return <span style={{ fontSize: 10.5, fontWeight: 700, color: cfg.c, letterSpacing: '0.03em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>{cfg.t}</span>
}

export function PendingSubtext({ mode }: { mode: 'shimmer' | 'unavailable' }) {
  if (mode === 'unavailable') return <p style={{ fontSize: 12.5, color: INK_FAINT, margin: 0, fontStyle: 'italic' }}>Details unavailable</p>
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }} aria-label="details pending">
      <span className="animate-pulse" style={{ height: 9, width: '82%', borderRadius: 4, background: 'rgba(34,26,19,0.06)' }} />
      <span className="animate-pulse" style={{ height: 9, width: '58%', borderRadius: 4, background: 'rgba(34,26,19,0.06)' }} />
    </div>
  )
}

export function ScheduleCell({ sched, dur, onChange }: { sched?: { start: Date; end: Date }; dur: number; onChange: (d: number) => void }) {
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

// ── QC checklist (Yes / No per check; bilingual question text as authored) ────
// Notion-style to-do checklist: tick a check to pass it (strikethrough), flag ⚐ to fail it.
function QcList({ qc, taskId, setQc }: { qc: QcRow[]; taskId: string; setQc: TaskCtxValue['setQc'] }) {
  const p = qcProgress(qc)
  return (
    <div style={{ marginTop: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="ntn-h">Quality checks</span>
        <span style={{ fontSize: 12, color: p.failed > 0 ? FAIL : p.done ? SAGE : INK_FAINT }}>{p.passed}/{p.total}{p.failed > 0 ? ` · ${p.failed} failed` : ''}</span>
      </div>
      {qc.map((q) => {
        const on = q.qc_status === 'confirmed', fail = q.qc_status === 'failed'
        return (
          <div key={q.id} style={{ display: 'flex', gap: 11, padding: '5px 0', alignItems: 'flex-start' }}>
            <button className={`ntn-chk ${on ? 'on' : fail ? 'fail' : ''}`} aria-label="Toggle check" style={{ fontSize: 11 }}
              onClick={() => setQc(taskId, q.id, on ? null : 'confirmed')}>{on ? '✓' : fail ? '✕' : ''}</button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: 14, lineHeight: 1.5, color: on ? INK_FAINT : fail ? FAIL : INK, textDecoration: on ? 'line-through' : 'none' }}>{q.question}</span>
              {q.is_critical && <span style={{ marginLeft: 8, fontSize: 9, fontWeight: 800, color: TERRA, letterSpacing: '0.06em' }}>CRITICAL</span>}
              {on && q.answer && (
                <div style={{ marginTop: 2, fontSize: 12, color: SAGE }}>✓ {q.answer}
                  {(q.source_narration_id || q.answered_at) && <span style={{ color: INK_FAINT }}> — {q.source_narration_id ? 'from WhatsApp' : 'logged'}{q.answered_at ? ` · ${timeAgo(q.answered_at)}` : ''}</span>}
                </div>
              )}
            </div>
            <button onClick={() => setQc(taskId, q.id, fail ? null : 'failed')} title="Flag an issue"
              style={{ flexShrink: 0, fontSize: 13, color: fail ? FAIL : INK_FAINT, background: 'transparent', border: 'none', cursor: 'pointer', opacity: 0.55, padding: '2px 4px' }}>⚐</button>
          </div>
        )
      })}
    </div>
  )
}

// WhatsApp inbound, wired to the task: site_narrations don't carry a task_id, but a narration that
// answered a QC or moved the status leaves its id on site_task_qc.source_narration_id /
// status_history[].narration_id. We collect those ids and fetch the raw inbound messages, so each
// task shows the WhatsApp updates that actually touched it.
export function useTaskNarrations(task: Task) {
  const ids = [...new Set(([
    ...(task.status_history ?? []).map((e) => e.narration_id),
    ...(task.site_task_qc ?? []).map((q) => q.source_narration_id),
  ].filter(Boolean)) as string[])]
  return useQuery({
    queryKey: ['task_narrations', task.task_id, ids.slice().sort().join(',')],
    enabled: ids.length > 0,
    queryFn: async () => {
      // sender_name is added by a later migration; fall back gracefully so the feed never breaks if
      // it isn't applied yet (the card then shows "Site team" + the WhatsApp badge).
      type Row = { id: string; raw_text: string; created_at: string; sender_name?: string | null }
      const withName = await supabase.from('site_narrations').select('id, raw_text, created_at, sender_name').in('id', ids)
      const rows = (withName.error
        ? (await supabase.from('site_narrations').select('id, raw_text, created_at').in('id', ids)).data
        : withName.data) as unknown as Row[] | null
      return (rows ?? []).map((d) => ({ id: d.id, raw_text: d.raw_text, created_at: d.created_at, sender_name: d.sender_name ?? null }))
    },
  })
}

export interface CommentRow { id: string; body: string; author_name: string | null; created_at: string }

/** Shared notes/media query — the diary doubles as the media store (an image note's body is the
 *  storage URL). The progress summary and the composer both read this one cache key. */
export function useTaskNotes(taskId: string) {
  return useQuery({
    queryKey: ['site_task_comments', taskId],
    queryFn: async () => {
      const { data, error } = await supabase.from('site_task_comments').select('id, body, author_name, created_at').eq('task_id', taskId).order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as CommentRow[]
    },
  })
}

export interface AttachRow { id: string; bucket: string; object_path: string; caption: string | null; role: string; created_at: string }

/** Task-parented photos from the shared polymorphic `attachments` table (WhatsApp captures land here,
 *  role='creation'; the answer-evidence path writes role='answer'). SCOPED ON BOTH parent columns —
 *  parent_type='site_task' AND this task's id — so a task's feed shows ITS OWN photos, not the org's:
 *  org-scoped RLS alone would leak every task's captures into every task's feed. */
export function useTaskAttachments(taskId: string) {
  return useQuery({
    queryKey: ['task_attachments', taskId],
    queryFn: async () => {
      const { data, error } = await supabase.from('attachments')
        .select('id, bucket, object_path, caption, role, created_at')
        .eq('parent_type', 'site_task').eq('parent_id', taskId)
        .order('created_at', { ascending: true })
      if (error) throw error
      return (data ?? []) as AttachRow[]
    },
  })
}

/** A photo held as bucket+object_path (attachments table, private rough-entry-media) — signs on read. */
function AttachThumb({ bucket, path }: { bucket: string; path: string }) {
  const url = useSignedBucketUrl(bucket, path)
  return (
    <a href={url ?? undefined} target="_blank" rel="noopener noreferrer"
      style={{ display: 'block', width: 132, height: 100, borderRadius: 10, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#0001' }}>
      {url ? <img src={url} alt="site" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ display: 'block', width: '100%', height: '100%' }} className="animate-pulse" />}
    </a>
  )
}

function MediaThumb({ stored }: { stored: string }) {
  const url = useSignedDocUrl(stored)
  return (
    <a href={url ?? undefined} target="_blank" rel="noopener noreferrer"
      style={{ display: 'block', width: 132, height: 100, borderRadius: 10, overflow: 'hidden', border: `1px solid ${LINE}`, background: '#0001' }}>
      {url ? <img src={url} alt="site" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : <span style={{ display: 'block', width: '100%', height: '100%' }} className="animate-pulse" />}
    </a>
  )
}

// ── UPDATES — the task's one living log. WhatsApp site messages, notes, photos, status changes and
//    confirmed QC fold into a single chronological thread (newest first), each tagged by source.
//    Compose a note or attach a photo at the top; everything else flows in from the site.
type NoteUpdate = { id: string; k: 'wa' | 'note' | 'photo' | 'status' | 'qc'; at: string | null; text: string; who?: string | null }
type AttachUpdate = { id: string; k: 'attach'; at: string | null; bucket: string; path: string; caption: string | null; role: string }
type Update = NoteUpdate | AttachUpdate | { id: string; k: 'chip'; at: string | null; obj: LinkedObject }

// What decompose() returns per item (the classify suggestion the user confirms/corrects). Kept
// loose on the client — the edge fn owns the real SiteItem shape; we forward it back verbatim on spawn.
type ClassifiedItem = { type: 'progress' | 'issue' | 'todo'; text: string; cause?: string | null; owner_hint?: string | null; date_hint?: string | null }


const LBL: CSSProperties = { fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase' }

// ── Notion-style page chrome: a property list with hover rows, light dividers, callouts ──
const NOTION_CSS = `
.ntn-prop{display:flex;align-items:flex-start;gap:8px;padding:6px 8px;border-radius:6px;min-height:34px}
.ntn-prop:hover{background:rgba(34,26,19,0.045)}
.ntn-prop-l{width:128px;flex-shrink:0;display:flex;align-items:center;gap:9px;font-size:13.5px;color:rgba(34,26,19,0.5);padding-top:2px}
.ntn-prop-v{flex:1;min-width:0;font-size:14px;color:#221A13;display:flex;align-items:center;flex-wrap:wrap;gap:6px}
.ntn-ico{width:16px;text-align:center;font-size:14px;opacity:.7;flex-shrink:0}
.ntn-hr{height:1px;background:rgba(34,26,19,0.09);margin:20px 0}
.ntn-h{font-size:13px;font-weight:600;color:#221A13;margin:0 0 8px}
.ntn-callout{display:flex;gap:11px;background:rgba(34,26,19,0.035);border-radius:10px;padding:13px 15px}
.ntn-chk{width:18px;height:18px;border-radius:5px;border:1.6px solid rgba(34,26,19,0.28);flex-shrink:0;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:.12s;margin-top:1px;background:#fff}
.ntn-chk.on{background:#5E8157;border-color:#5E8157;color:#fff}
.ntn-chk.fail{background:#B2402A;border-color:#B2402A;color:#fff}`

const REASON_WORD: Record<string, string> = { structural: 'structural', concealment: 'concealment', curing_time: 'curing', logistics: 'logistics / access', quality: 'finish quality', policy: 'policy' }

// ── status control (mark active / done) — shared, persists via ctx.setStatus ──
function StatusControl({ status, onSet }: { status: string; onSet: (s: 'not_started' | 'active' | 'done') => void }) {
  const opts: ['not_started' | 'active' | 'done', string][] = [['not_started', 'Not started'], ['active', 'Active'], ['done', 'Done']]
  return (
    <div style={{ display: 'inline-flex', background: '#fff', border: `1px solid ${LINE}`, borderRadius: 9, padding: 2 }}>
      {opts.map(([v, t]) => (
        <button key={v} onClick={() => onSet(v)}
          style={{ fontSize: 11.5, fontWeight: 600, padding: '5px 10px', borderRadius: 7, border: 'none', cursor: 'pointer',
            background: status === v ? (v === 'done' ? SAGE : v === 'active' ? TERRA : INK_FAINT) : 'transparent',
            color: status === v ? '#fff' : INK_SOFT }}>{t}</button>
      ))}
    </div>
  )
}

// ── the engine context section (secondary; renders ProjectVM fields, computes nothing) ──
export function EngineSection({ engine }: { engine: EngineCtx }) {
  const unmet = new Set((engine.why ?? []).map((w) => w.afterLabel))
  const dot = (c: string) => ({ display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: c, marginRight: 7 }) as CSSProperties
  const statusColor = engine.status === 'done' ? SAGE : engine.status === 'blocked' ? INK_FAINT : TERRA
  return (
    <div>
      <div style={{ fontSize: 13, fontWeight: 600, color: INK, marginBottom: 10 }}>Where it sits</div>

      {/* position & state */}
      <div style={{ fontSize: 13, color: INK_SOFT, marginBottom: 8 }}>
        <span style={dot(statusColor)} />
        Step <b style={{ color: INK, fontVariantNumeric: 'tabular-nums' }}>{engine.seqNo}</b> in the sequence · <b style={{ color: statusColor }}>{engine.status}</b>
        {engine.stage && <> · {engine.stage.label}</>}
      </div>
      {engine.status === 'blocked' && engine.why?.length ? (
        <div style={{ fontSize: 12.5, color: INK_SOFT, marginBottom: 8 }}>
          Waiting on {engine.why.map((w, i) => <span key={i}><b style={{ color: INK }}>{w.afterLabel}</b> <span style={{ color: INK_FAINT }}>— {REASON_WORD[w.reason] ?? w.reason}</span>{i < engine.why!.length - 1 ? ', ' : ''}</span>)}
        </div>
      ) : null}

      {/* freedom */}
      {engine.freedomSet && (
        <div style={{ fontSize: 12.5, color: '#4d77a0', background: 'rgba(107,155,196,0.08)', border: '1px solid rgba(107,155,196,0.18)', borderRadius: 8, padding: '8px 11px', marginBottom: 10 }}>
          Part of <b>{engine.freedomSet}</b> — free to do in any order alongside the rest of the set.
        </div>
      )}

      {/* depends on / unlocks */}
      {engine.hardPreds.length > 0 && (
        <div style={{ marginBottom: 10 }}>
          <div style={{ ...LBL, marginBottom: 6 }}>Depends on</div>
          {engine.hardPreds.map((p, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 9, fontSize: 12.5, color: INK_SOFT, padding: '3px 0' }}>
              <span style={{ width: 13 }}>{unmet.has(p.label) ? '◷' : '✓'}</span>
              <span style={{ flex: 1 }}>{p.label}</span>
              {p.reason && <span style={{ fontSize: 9, color: INK_FAINT, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{REASON_WORD[p.reason] ?? p.reason}</span>}
            </div>
          ))}
        </div>
      )}
      {engine.hardDeps.length > 0 && (
        <div style={{ marginBottom: 6 }}>
          <div style={{ ...LBL, marginBottom: 6 }}>Unlocks</div>
          {engine.hardDeps.map((d, i) => (
            <div key={i} style={{ fontSize: 12.5, color: INK_SOFT, padding: '3px 0' }}>↳ {d.label}</div>
          ))}
        </div>
      )}

      {/* classified user task needing a placement confirmation */}
      {engine.needsReview && (
        <div style={{ fontSize: 12.5, color: TERRA, background: `${TERRA}0e`, border: `1px solid ${TERRA}2e`, borderRadius: 8, padding: '8px 11px', marginTop: 8 }}>
          This was placed automatically — confirm where it fits in the sequence.
        </div>
      )}
    </div>
  )
}

// ── status banner + dependency flow rail (the "outside the box" pieces) ──────
function statusInfo(s: string | undefined, why: EngineCtx['why']): { c: string; word: string; detail: string } {
  if (s === 'done') return { c: SAGE, word: 'Done', detail: 'Complete on site' }
  if (s === 'active') return { c: TERRA, word: 'In progress', detail: 'Happening on site now' }
  if (s === 'blocked') return { c: '#8a8580', word: 'Blocked', detail: why?.length ? `Waiting on ${why.map((w) => w.afterLabel).join(', ')}` : 'Waiting on earlier work' }
  return { c: TERRA, word: 'Ready', detail: 'All prerequisites met — can start' }
}

// ── reference design system (warm paper / walnut / terracotta / sage) ─────────
const C = {
  paper: '#F6F1E8', surface: '#FFFFFF', surface2: '#FCF9F3', ink: '#2B211A', ink2: '#5A4E43',
  muted: '#9A8E81', faint: '#B9AE9F', hair: '#EBE2D4', hair2: '#F1EADC', terra: '#C2592F',
  terraDeep: '#A8451F', terraSoft: '#FBECE3', sage: '#6E8B63', sageDeep: '#52704A', sageSoft: '#ECF1E7',
  stone: '#8C8073', stoneSoft: '#F1ECE2', amber: '#CC8A3C',
}
const REF_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,500;0,600;0,700;1,500&family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&family=DM+Mono:wght@400;500&display=swap');
.bb-root{font-family:'DM Sans',system-ui,sans-serif;-webkit-font-smoothing:antialiased;height:100%;display:flex;flex-direction:column}
.bb-root *{box-sizing:border-box}
.bb-root .bb-mono{font-family:'DM Mono',ui-monospace,monospace}
.bb-root .bb-serif{font-family:'Playfair Display',Georgia,serif}
.bb-root button{font-family:inherit;cursor:pointer}
.bb-root textarea{font-family:inherit;resize:none}
.bb-root .bb-tap{transition:transform .12s ease, background .18s ease, border-color .18s ease, color .18s ease, box-shadow .2s ease}
.bb-root .bb-tap:active{transform:scale(.94)}
.bb-root .bb-rise{animation:bbRise .5s cubic-bezier(.2,.7,.2,1) both}
.bb-root .bb-entry{animation:bbEntry .42s cubic-bezier(.2,.7,.2,1) both}
.bb-scroll::-webkit-scrollbar{width:10px}
.bb-scroll::-webkit-scrollbar-thumb{background:#EBE2D4;border-radius:20px;border:3px solid #F6F1E8}
.bb-scroll::-webkit-scrollbar-track{background:transparent}
@keyframes bbRise{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:none}}
@keyframes bbEntry{from{opacity:0;transform:translateY(-6px) scale(.985)}to{opacity:1;transform:none}}
@keyframes bbPop{0%{transform:scale(.6);opacity:0}60%{transform:scale(1.12)}100%{transform:scale(1);opacity:1}}
@keyframes bbPulse{0%{box-shadow:0 0 0 0 rgba(194,89,47,.40)}70%{box-shadow:0 0 0 9px rgba(194,89,47,0)}100%{box-shadow:0 0 0 0 rgba(194,89,47,0)}}
@keyframes bbReady{0%{box-shadow:0 0 0 0 rgba(204,138,60,.45)}70%{box-shadow:0 0 0 6px rgba(204,138,60,0)}100%{box-shadow:0 0 0 0 rgba(204,138,60,0)}}
@keyframes bbDraw{from{transform:scaleY(0)}to{transform:scaleY(1)}}
`
const ORDER: ('not_started' | 'active' | 'done')[] = ['not_started', 'active', 'done']
const STATUS_LABEL = { not_started: 'Not started', active: 'Active', done: 'Done' }
const STATUS_PILL = { not_started: C.stone, active: C.terra, done: C.sage }
const STATUS_FILL = { not_started: 8, active: 55, done: 100 }

function Eyebrow({ children, color = C.muted }: { children: ReactNode; color?: string }) {
  return <span className="bb-mono" style={{ fontSize: 11, letterSpacing: '.14em', textTransform: 'uppercase', color, fontWeight: 500 }}>{children}</span>
}

function DetailRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 2px' }}>
      <span style={{ width: 16, display: 'grid', placeItems: 'center', color: C.faint, flexShrink: 0 }}>{icon}</span>
      <Eyebrow>{label}</Eyebrow>
      <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>{children}</div>
    </div>
  )
}

// one update card — the PERSON leads (who sent it); WhatsApp is a quiet badge, not the headline.
function UpdateCard({ u }: { u: NoteUpdate }) {
  const sys = u.k === 'status' || u.k === 'qc'
  const who = (u.who ?? '').trim() || (u.k === 'wa' ? 'Site team' : 'Note')
  const head = u.k === 'status' ? 'Status update' : u.k === 'qc' ? 'Quality check' : who
  const initials = sys ? (u.k === 'qc' ? '✓' : '↻') : (who.slice(0, 2).toUpperCase() || '··')
  const avBg = u.k === 'wa' ? C.sageSoft : sys ? C.hair2 : C.terraSoft
  const avFg = u.k === 'wa' ? C.sageDeep : sys ? C.muted : C.terraDeep
  const avBd = u.k === 'wa' ? 'rgba(110,139,99,.25)' : sys ? C.hair : 'rgba(194,89,47,.2)'
  return (
    <article className="bb-entry" style={{ display: 'flex', gap: 12, padding: '13px 15px', background: sys ? C.surface2 : C.surface, border: `1px solid ${sys ? C.hair2 : C.hair}`, borderRadius: 14 }}>
      <div style={{ width: 32, height: 32, borderRadius: 30, flexShrink: 0, display: 'grid', placeItems: 'center', background: avBg, color: avFg, border: `1px solid ${avBd}` }}>
        <span className="bb-mono" style={{ fontSize: 11, fontWeight: 600 }}>{initials}</span>
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: (u.k === 'photo' || u.text) ? 4 : 0, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{head}</span>
          {u.k === 'wa' && <span className="bb-mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: C.sageDeep, background: C.sageSoft, border: '1px solid rgba(110,139,99,.22)', padding: '1px 6px', borderRadius: 20 }}>WhatsApp</span>}
          <span className="bb-mono" style={{ fontSize: 10.5, color: C.faint, marginLeft: 'auto' }}>{u.at ? timeAgo(u.at) : ''}</span>
        </div>
        {u.k === 'photo' ? <MediaThumb stored={u.text} /> : u.text ? <p style={{ margin: 0, fontSize: 13.5, color: C.ink2, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{u.k === 'qc' ? '✓ ' : ''}{u.text}</p> : null}
      </div>
    </article>
  )
}

// a task photo from the attachments table (WhatsApp capture). role='answer' means it replied to a
// chase — tag it so evidence reads as evidence; 'creation' is a plain site photo.
function AttachCard({ u }: { u: AttachUpdate }) {
  const isAnswer = u.role === 'answer'
  return (
    <article className="bb-entry" style={{ display: 'flex', gap: 12, padding: '13px 15px', background: C.surface, border: `1px solid ${C.hair}`, borderRadius: 14 }}>
      <div style={{ width: 32, height: 32, borderRadius: 30, flexShrink: 0, display: 'grid', placeItems: 'center', background: C.sageSoft, color: C.sageDeep, border: '1px solid rgba(110,139,99,.25)' }}>
        <Camera size={15} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 4, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 13, fontWeight: 700, color: C.ink }}>{isAnswer ? 'Reply photo' : 'Site photo'}</span>
          <span className="bb-mono" style={{ fontSize: 9, fontWeight: 600, letterSpacing: '.04em', textTransform: 'uppercase', color: C.sageDeep, background: C.sageSoft, border: '1px solid rgba(110,139,99,.22)', padding: '1px 6px', borderRadius: 20 }}>WhatsApp</span>
          <span className="bb-mono" style={{ fontSize: 10.5, color: C.faint, marginLeft: 'auto' }}>{u.at ? timeAgo(u.at) : ''}</span>
        </div>
        <AttachThumb bucket={u.bucket} path={u.path} />
        {u.caption && <p style={{ margin: '6px 0 0', fontSize: 13.5, color: C.ink2, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{u.caption}</p>}
      </div>
    </article>
  )
}

// ── THE shared task-detail panel (faithful to the reference design; every field wired) ──
export default function TaskDetail({ task, engine, showStatusControl = false, onClose }: {
  task: Task
  engine?: EngineCtx
  sched?: { start: Date; end: Date }
  showStatusControl?: boolean
  onClose?: () => void
}) {
  const ctx = useContext(TaskCtx)
  const queryClient = useQueryClient()
  const qc = [...(task.site_task_qc ?? [])].sort((a, b) => a.seq - b.seq)
  const dur = Math.max(1, task.duration_days ?? DEFAULT_DURATION)
  const [ownerPick, setOwnerPick] = useState(false)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const { data: comments = [] } = useTaskNotes(task.task_id)
  const { data: narrations = [] } = useTaskNarrations(task)
  // Task-parented photos (WhatsApp captures) from the shared attachments table — scoped to THIS task.
  const { data: attachments = [] } = useTaskAttachments(task.task_id)
  // Live Snag/Issue objects linked to this task + their follow-up glances (the chips).
  const { data: linkedObjects = [] } = useTaskLinkedObjects(task.task_id)
  const { data: followStates = {} } = useLinkedFollowStates(task.task_id, linkedObjects)
  // Pending classification suggestion for the just-added note (user confirms/corrects — never implicit).
  const [pending, setPending] = useState<{ noteId: string; item: ClassifiedItem; suggest: 'issue' | 'todo' } | null>(null)
  const [spawning, setSpawning] = useState(false)

  const isOverride = task.owner_source === 'manual' && !!task.owner_id
  const effOwner = ctx ? (isOverride ? task.owner_id! : (ctx.supervisorId ?? ctx.principalId)) : null
  const ownerTag = isOverride ? 'Chosen' : ctx?.supervisorId ? 'Site default' : ctx?.principalId ? 'Default' : ''
  const ownerName = effOwner && ctx ? ctx.ownerName(effOwner) : ''
  const location = [task.floor_label, task.unit_label].filter(Boolean).join(' · ') || 'Site-wide'
  const si = engine ? statusInfo(engine.status, engine.why) : null
  const rowStatus: 'not_started' | 'active' | 'done' = task.status === 'done' ? 'done' : task.status === 'active' ? 'active' : 'not_started'
  const idx = ORDER.indexOf(rowStatus)
  const fill = STATUS_FILL[rowStatus]

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['site_task_comments', task.task_id] })
  const invalidateObjects = () => queryClient.invalidateQueries({ queryKey: ['task_linked_objects', task.task_id] })
  async function post() {
    const body = text.trim(); if (!body || busy || !ctx) return
    setBusy(true)
    // capture-first: the note is saved immediately, so classification is best-effort and never loses it.
    const { data: inserted, error } = await supabase.from('site_task_comments')
      .insert({ task_id: task.task_id, org_id: ctx.orgId, author_id: ctx.authorId || null, author_name: ctx.authorName || null, body })
      .select('id').single()
    setBusy(false)
    if (error || !inserted) return
    setText(''); invalidate()
    // Route the note through the SAME classifier (decompose) as WhatsApp. If it looks like a snag/issue,
    // surface a suggestion the user confirms — so issues never get silently filed as notes.
    try {
      const { data } = await supabase.functions.invoke('siteops-note', { body: { action: 'classify', text: body, task_id: task.task_id } })
      const items = ((data as { items?: ClassifiedItem[] })?.items ?? [])
      const hit = items.find((it) => it.type === 'issue') ?? items.find((it) => it.type === 'todo')
      if (hit && (hit.type === 'issue' || hit.type === 'todo')) setPending({ noteId: inserted.id, item: hit, suggest: hit.type === 'issue' ? 'issue' : 'todo' })
    } catch { /* best-effort — the note is already saved as a plain note */ }
  }
  async function confirmSpawn(type: 'issue' | 'todo') {
    if (!pending) return
    setSpawning(true)
    try {
      await supabase.functions.invoke('siteops-note', { body: {
        action: 'spawn', task_id: task.task_id,
        note_id: pending.noteId, note_kind: 'comment', type, item: pending.item,
      } })
    } finally { setSpawning(false); setPending(null); invalidateObjects(); invalidate() }
  }
  async function quickAction(o: LinkedObject) {
    if (o.kind === 'issue') await supabase.from('problems').update({ status: 'RESOLVED', next_followup_at: null }).eq('id', o.id)
    else await supabase.from('todos').update({ status: 'DONE' }).eq('id', o.id)
    invalidateObjects()
  }
  async function onPickFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]; e.target.value = ''
    if (!file || !ctx) return
    setUploading(true)
    const safe = file.name.replace(/[^a-zA-Z0-9._-]/g, '_')
    const path = `site-task-media/${task.task_id}/${Date.now()}-${safe}`
    const up = await supabase.storage.from('documents').upload(path, file, { upsert: false })
    if (!up.error) {
      const pub = supabase.storage.from('documents').getPublicUrl(path).data.publicUrl
      await supabase.from('site_task_comments').insert({ task_id: task.task_id, org_id: ctx.orgId, author_id: ctx.authorId || null, author_name: ctx.authorName || null, body: pub })
      invalidate()
    }
    setUploading(false)
  }

  // Mark-and-hide: a note (UI comment or WhatsApp narration) that became a Snag/Issue is shown AS the
  // chip, not as a raw feed line — one thing in the feed, not "note" + "created from note".
  const spawnedCommentIds = new Set(linkedObjects.filter((o) => o.source_note_kind === 'comment' && o.source_note_id).map((o) => o.source_note_id as string))
  const spawnedNarrationIds = new Set(linkedObjects.filter((o) => o.source_note_kind === 'narration' && o.source_note_id).map((o) => o.source_note_id as string))

  const updates: Update[] = [
    ...narrations.filter((n) => !spawnedNarrationIds.has(n.id)).map((n): Update => ({ id: 'wa' + n.id, k: 'wa' as const, at: n.created_at, text: n.raw_text, who: n.sender_name })),
    ...comments.filter((c) => !spawnedCommentIds.has(c.id)).map((c): Update => ({ id: c.id, k: isImageUrl(c.body) ? 'photo' : 'note', at: c.created_at, text: c.body, who: c.author_name })),
    ...(task.status_history ?? []).filter((e) => e.status).map((e, i): Update => ({ id: 'st' + i + (e.at ?? ''), k: 'status' as const, at: e.at ?? null, text: `Marked ${String(e.status).replace(/_/g, ' ')}` })),
    ...qc.filter((q) => q.qc_status === 'confirmed' && q.answer).map((q): Update => ({ id: 'qc' + q.id, k: 'qc' as const, at: q.answered_at ?? null, text: q.answer as string })),
    ...attachments.map((a): Update => ({ id: 'att' + a.id, k: 'attach' as const, at: a.created_at, bucket: a.bucket, path: a.object_path, caption: a.caption, role: a.role })),
    ...linkedObjects.map((o): Update => ({ id: 'chip' + o.id, k: 'chip' as const, at: o.created_at, obj: o })),
  ].sort((a, b) => new Date(b.at ?? 0).getTime() - new Date(a.at ?? 0).getTime())

  return (
    <div className="bb-root" style={{ background: C.paper }}>
      <style>{REF_CSS}</style>
      <style>{NOTION_CSS}</style>

      {/* ── header: breadcrumb + close ── */}
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 22px 14px', borderBottom: `1px solid ${C.hair}`, background: 'rgba(246,241,232,.86)', backdropFilter: 'blur(8px)', zIndex: 5 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: C.muted, minWidth: 0 }}>
          <MapPin size={14} color={C.terra} />
          <span className="bb-mono" style={{ fontSize: 12, color: C.ink2, whiteSpace: 'nowrap' }}>{task.floor_label || 'Site'}</span>
          {task.unit_label && <><ChevronRight size={13} color={C.faint} /><span className="bb-mono" style={{ fontSize: 12, color: C.ink2, whiteSpace: 'nowrap' }}>{task.unit_label}</span></>}
        </div>
        <button aria-label="Close" className="bb-tap" onClick={onClose} style={{ width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', color: C.ink2, background: C.surface, border: `1px solid ${C.hair}` }}><X size={17} /></button>
      </header>

      {/* ── scroll body ── */}
      <div className="bb-scroll" style={{ flex: 1, overflowY: 'auto', padding: '26px 26px 30px' }}>
        {/* title */}
        <div className="bb-rise">
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginBottom: 8 }}>
            <Wrench size={13} color={C.terra} /><Eyebrow color={C.terraDeep}>{task.trade || 'Task'}</Eyebrow>
          </div>
          <h1 className="bb-serif" style={{ margin: 0, fontSize: 34, lineHeight: 1.06, fontWeight: 600, color: C.ink, letterSpacing: '-.01em' }}>{task.name}</h1>
        </div>

        {/* status card */}
        {ctx && (
          <section className="bb-rise" style={{ marginTop: 22, padding: '20px 20px 22px', background: C.surface, border: `1px solid ${C.hair}`, borderRadius: 18, boxShadow: '0 1px 0 rgba(43,33,26,.02), 0 18px 40px -34px rgba(43,33,26,.45)' }}>
            {si && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                <span style={{ width: 9, height: 9, borderRadius: 9, background: si.c, ...(engine?.status === 'available' ? { animation: 'bbReady 2.6s ease-out infinite' } : {}) }} />
                <span style={{ fontSize: 15.5, fontWeight: 700, color: C.ink }}>{si.word}</span>
                {engine?.stage && <span style={{ fontSize: 11.5, fontWeight: 600, color: C.ink2, background: C.stoneSoft, border: `1px solid ${C.hair}`, padding: '3px 9px', borderRadius: 20 }}>{engine.stage.label}</span>}
                {engine && <span className="bb-mono" style={{ marginLeft: 'auto', fontSize: 11.5, color: C.faint }}>STEP {engine.seqNo}</span>}
              </div>
            )}
            {si && <p style={{ margin: '11px 0 18px', fontSize: 13.5, color: C.ink2, lineHeight: 1.5 }}>{si.detail}</p>}

            {/* status segmented control */}
            {showStatusControl && (
              <div role="radiogroup" aria-label="Task status" style={{ position: 'relative', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', background: C.surface2, border: `1px solid ${C.hair}`, borderRadius: 13, padding: 4 }}>
                <div aria-hidden style={{ position: 'absolute', top: 4, bottom: 4, left: 4, width: 'calc((100% - 8px) / 3)', transform: `translateX(${idx * 100}%)`, background: STATUS_PILL[rowStatus], borderRadius: 10, boxShadow: '0 6px 14px -8px rgba(43,33,26,.5)', transition: 'transform .42s cubic-bezier(.34,1.4,.4,1), background .35s ease' }} />
                {ORDER.map((k) => {
                  const sel = rowStatus === k
                  return <button key={k} role="radio" aria-checked={sel} onClick={() => ctx.setStatus(task.task_id, k)} className="bb-tap" style={{ position: 'relative', zIndex: 1, padding: '10px 6px', borderRadius: 10, fontSize: 13.5, fontWeight: sel ? 700 : 500, color: sel ? '#fff' : C.muted, transition: 'color .3s ease' }}>{STATUS_LABEL[k]}</button>
                })}
              </div>
            )}

            {/* lifecycle meter */}
            <div style={{ marginTop: 16, display: 'flex', alignItems: 'center', gap: 11 }}>
              <div style={{ flex: 1, height: 6, borderRadius: 20, background: C.hair2, overflow: 'hidden' }}><div style={{ height: '100%', width: `${fill}%`, background: STATUS_PILL[rowStatus], borderRadius: 20, transition: 'width .5s cubic-bezier(.3,.8,.3,1), background .35s ease' }} /></div>
              <span className="bb-mono" style={{ fontSize: 11, color: C.muted, minWidth: 30, textAlign: 'right' }}>{fill}%</span>
            </div>
          </section>
        )}

        <div style={{ height: 1, background: C.hair, margin: '24px 0 6px' }} />

        {/* details */}
        <section>
          {ctx && (
            <DetailRow icon={<User size={16} />} label="Assignee">
              <button onClick={() => setOwnerPick(true)} className="bb-tap" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 14.5, fontWeight: 600, color: ownerName ? C.ink : C.muted }}>{ownerName || 'Unassigned'}</span>
                {ownerTag && <span style={{ fontSize: 10.5, fontWeight: 600, color: C.sageDeep, background: C.sageSoft, padding: '3px 8px', borderRadius: 20 }}>{ownerTag}</span>}
              </button>
              {ownerPick && <UserPicker orgId={ctx.orgId} currentId={effOwner ?? null} title="Assignee for this task" onPick={(id) => { ctx.setOwner(task.task_id, id); setOwnerPick(false) }} onClose={() => setOwnerPick(false)} />}
            </DetailRow>
          )}
          <div style={{ height: 1, background: C.hair2 }} />
          <DetailRow icon={<MapPin size={16} />} label="Location"><span style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{location}</span></DetailRow>
          <div style={{ height: 1, background: C.hair2 }} />
          <DetailRow icon={<Wrench size={16} />} label="Trade"><span style={{ fontSize: 14.5, fontWeight: 600, color: C.ink }}>{task.trade || '—'}</span></DetailRow>
          {ctx && <>
            <div style={{ height: 1, background: C.hair2 }} />
            <DetailRow icon={<Timer size={16} />} label="Duration">
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: C.surface, border: `1px solid ${C.hair}`, borderRadius: 11, padding: 3 }}>
                <button aria-label="Decrease duration" disabled={dur <= 1} onClick={() => ctx.setDuration(task.task_id, Math.max(1, dur - 1))} className="bb-tap" style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', color: dur <= 1 ? C.faint : C.ink2 }}><Minus size={15} /></button>
                <div style={{ minWidth: 42, textAlign: 'center' }}><span key={dur} style={{ display: 'inline-block', fontSize: 14.5, fontWeight: 700, color: C.ink, animation: 'bbPop .32s cubic-bezier(.34,1.4,.4,1) both' }}>{dur}d</span></div>
                <button aria-label="Increase duration" onClick={() => ctx.setDuration(task.task_id, dur + 1)} className="bb-tap" style={{ width: 30, height: 30, borderRadius: 8, display: 'grid', placeItems: 'center', color: C.ink2 }}><Plus size={15} /></button>
              </div>
            </DetailRow>
          </>}
        </section>

        {/* quality checks */}
        {qc.length > 0 && ctx && (
          <section style={{ marginTop: 30 }}>
            <h2 className="bb-serif" style={{ margin: '0 0 14px', fontSize: 21, fontWeight: 600, color: C.ink }}>Quality checks</h2>
            <QcList qc={qc} taskId={task.task_id} setQc={ctx.setQc} />
          </section>
        )}

        {/* updates */}
        <section style={{ marginTop: 30 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 16 }}>
            <h2 className="bb-serif" style={{ margin: 0, fontSize: 21, fontWeight: 600, color: C.ink }}>Updates</h2>
            <Eyebrow>{updates.length} {updates.length === 1 ? 'note' : 'notes'}</Eyebrow>
          </div>
          {updates.length === 0
            ? <p style={{ fontSize: 13.5, color: C.faint, fontStyle: 'italic', margin: 0 }}>No updates yet — WhatsApp messages, notes and photos appear here.</p>
            : <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>{updates.map((u) => u.k === 'chip'
                ? <TaskFeedChip key={u.id} obj={u.obj} ownerName={ctx?.ownerName ?? (() => 'Unassigned')} followState={followStates[u.obj.id]} onQuickAction={quickAction} busy={spawning} />
                : u.k === 'attach' ? <AttachCard key={u.id} u={u} />
                : <UpdateCard key={u.id} u={u} />)}</div>}
        </section>
      </div>

      {/* ── pinned composer ── */}
      {ctx && (
        <div style={{ borderTop: `1px solid ${C.hair}`, background: 'rgba(246,241,232,.92)', backdropFilter: 'blur(8px)', padding: '14px 22px 18px' }}>
          <input ref={fileRef} type="file" accept="image/*" capture="environment" onChange={onPickFile} style={{ display: 'none' }} />
          {/* classify → confirm: the note is already saved; the user files it as a Snag/Issue (AI pre-picks). */}
          {pending && (
            <div style={{ marginBottom: 10, padding: '10px 12px', borderRadius: 12, background: '#FBECE3', border: `1px solid ${C.terra}44`, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12.5, color: C.ink, flex: 1, minWidth: 150 }}>
                This looks like {pending.suggest === 'issue' ? 'an Issue' : 'a Snag'} — file it so it gets followed up?
              </span>
              {(['issue', 'todo'] as const).map((t) => {
                const on = (t === 'issue') === (pending.suggest === 'issue')
                return (
                  <button key={t} disabled={spawning} onClick={() => confirmSpawn(t)}
                    style={{ fontSize: 12, fontWeight: 600, padding: '6px 12px', borderRadius: 8, cursor: 'pointer', opacity: spawning ? 0.6 : 1,
                      background: on ? C.terra : C.surface, color: on ? '#fff' : C.ink2, border: on ? 'none' : `1px solid ${C.hair}` }}>
                    {t === 'issue' ? 'Make Issue' : 'Make Snag'}
                  </button>
                )
              })}
              <button disabled={spawning} onClick={() => setPending(null)} style={{ fontSize: 12, color: C.faint, background: 'transparent', border: 'none', cursor: 'pointer' }}>Keep as note</button>
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: 10 }}>
            <button aria-label="Attach a site photo" onClick={() => fileRef.current?.click()} disabled={uploading} className="bb-tap" style={{ width: 46, height: 46, borderRadius: 13, flexShrink: 0, display: 'grid', placeItems: 'center', color: uploading ? C.faint : C.ink2, background: C.surface, border: `1px solid ${C.hair}` }}><Camera size={19} /></button>
            <div style={{ flex: 1, background: C.surface, border: `1px solid ${C.hair}`, borderRadius: 14, padding: '5px 6px 5px 14px', display: 'flex', alignItems: 'flex-end', gap: 8 }}>
              <textarea rows={1} value={text}
                onChange={(e) => { setText(e.target.value); e.currentTarget.style.height = 'auto'; e.currentTarget.style.height = Math.min(e.currentTarget.scrollHeight, 96) + 'px' }}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); post() } }}
                placeholder="Add a note, or attach a site photo…"
                style={{ flex: 1, border: 'none', background: 'transparent', fontSize: 14, color: C.ink, lineHeight: 1.45, padding: '9px 0', outline: 'none', maxHeight: 96 }} />
              <button aria-label="Post update" onClick={post} disabled={busy || !text.trim()} className="bb-tap" style={{ width: 38, height: 38, borderRadius: 11, flexShrink: 0, display: 'grid', placeItems: 'center', color: '#fff', background: (busy || !text.trim()) ? C.faint : C.terra, boxShadow: (busy || !text.trim()) ? 'none' : '0 8px 16px -8px rgba(194,89,47,.7)', transition: 'background .25s ease' }}><ArrowUp size={18} strokeWidth={2.4} /></button>
            </div>
          </div>
          <div style={{ marginTop: 8, paddingLeft: 56 }}><Eyebrow color={C.faint}>{uploading ? 'Uploading photo…' : '⌘ + Enter to post'}</Eyebrow></div>
        </div>
      )}
    </div>
  )
}

// re-export for the drawer header
export { StatusControl }
