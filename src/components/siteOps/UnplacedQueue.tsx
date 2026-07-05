// UNPLACED QUEUE ("To place") — the visible surface for siteops_unplaced. Every honest park the
// WhatsApp engine writes (held task updates, compound-message remainders, photos awaiting a home,
// couldn't-process safety nets) lands in this table; until this section existed the parks were
// durable but INVISIBLE, so "saved for review" read as a silent drop to the sender (probe finding,
// 2026-07-05). Presentational: the page owns the query + mutations (house pattern — see SiteDesk's
// desk_problems); this renders the cards and mints signed thumbs for the private bucket.

import { useSignedBucketUrl } from '../../lib/storage'

const INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.55)', INK_FAINT = 'rgba(34,26,19,0.34)'
const TERRA = '#C8603A', LINE = 'rgba(34,26,19,0.10)'

export interface UnplacedRow {
  id: string
  project_id: string | null
  reason: string
  observation: unknown
  candidates: unknown
  bucket: string | null
  object_path: string | null
  caption: string | null
  sender_number: string | null
  created_at: string
}

// reason → the human framing. `hold` tones (amber-ish) = understood-and-waiting; `alert` = a safety net fired.
const REASONS: Record<string, { label: string; tone: 'hold' | 'photo' | 'alert' }> = {
  pending_stage2: { label: 'Awaiting next pass', tone: 'hold' },
  non_batch_target: { label: 'Update on hold', tone: 'hold' },
  evidence_await_placement: { label: 'Photo to place', tone: 'photo' },
  floor: { label: 'Photo to place', tone: 'photo' },
  photo_pick: { label: 'Photo to place', tone: 'photo' },
  llm_unreadable: { label: "Couldn't process", tone: 'alert' },
  v2_effect_failed: { label: "Couldn't log", tone: 'alert' },
  v2_unhandled_terminal: { label: 'Held', tone: 'hold' },
  disambig: { label: 'Question interrupted', tone: 'hold' },
  typed_pick: { label: 'Question interrupted', tone: 'hold' },
  project: { label: 'Site unknown', tone: 'hold' },
  batch_collision: { label: 'Question interrupted', tone: 'hold' },
}

/** The row's human summary, derived from the jsonb observation the park carried. */
function unplacedText(row: UnplacedRow): string {
  const obs = row.observation
  // executor parks: "update <uuid>: <model reason>" — show the reason; the replay payload's label leads.
  if (typeof obs === 'string') {
    const label = (row.candidates as { label?: string } | null)?.label
    const reason = obs.replace(/^update [0-9a-f-]{36}:\s*/i, '')
    if (label) return `${label} — ${reason}`
    if (obs === 'photo evidence') return row.caption?.trim() || 'Photo awaiting a home'
    return reason
  }
  // fragment parks: { items: [SiteItem…] } — the texts, joined.
  const items = (obs as { items?: { text?: string }[] } | null)?.items
  if (Array.isArray(items) && items.length) return items.map((i) => i.text ?? '').filter(Boolean).join(' · ')
  return row.caption?.trim() || 'Unplaced item'
}

const fmtAge = (iso: string) => {
  const mins = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60_000))
  if (mins < 60) return `${mins}m ago`
  const h = Math.round(mins / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

function Thumb({ bucket, path }: { bucket: string; path: string }) {
  const url = useSignedBucketUrl(bucket, path)
  if (!url) return <div className="animate-pulse" style={{ width: 64, height: 52, borderRadius: 8, background: LINE, flexShrink: 0 }} />
  return (
    <a href={url} target="_blank" rel="noreferrer" style={{ flexShrink: 0 }}>
      <img src={url} alt="" style={{ width: 64, height: 52, borderRadius: 8, objectFit: 'cover', border: `1px solid ${LINE}` }} />
    </a>
  )
}

export default function UnplacedQueue({ rows, projName, onDismiss }: {
  rows: UnplacedRow[]
  projName: (id: string | null) => string
  onDismiss: (row: UnplacedRow) => void
}) {
  if (!rows.length) return null
  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 10 }}>
        <h2 style={{ fontSize: 15, fontWeight: 700, color: INK, margin: 0 }}>To place</h2>
        <span style={{ fontSize: 12, color: INK_FAINT }}>
          caught from WhatsApp, waiting for a home — dismiss what's handled
        </span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {rows.map((r) => {
          const meta = REASONS[r.reason] ?? { label: r.reason, tone: 'hold' as const }
          const pill = meta.tone === 'alert' ? '#B2402A' : meta.tone === 'photo' ? '#8A6D3B' : TERRA
          return (
            <div key={r.id} style={{
              display: 'flex', alignItems: 'center', gap: 12, background: '#fff',
              border: `1px solid ${LINE}`, borderRadius: 12, padding: '10px 14px',
            }}>
              {r.bucket && r.object_path && <Thumb bucket={r.bucket} path={r.object_path} />}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{
                    fontSize: 10.5, fontWeight: 700, color: pill, background: `${pill}14`,
                    border: `1px solid ${pill}33`, borderRadius: 999, padding: '2px 8px',
                    letterSpacing: '0.04em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                  }}>{meta.label}</span>
                  <span style={{ fontSize: 12, color: INK_FAINT }}>
                    {projName(r.project_id)} · {fmtAge(r.created_at)}{r.sender_number ? ` · from ${r.sender_number}` : ''}
                  </span>
                </div>
                <div style={{ fontSize: 13.5, color: INK, marginTop: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {unplacedText(r)}
                </div>
              </div>
              <button onClick={() => onDismiss(r)} title="Dismiss — handled outside, or no longer needed" style={{
                border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT, borderRadius: 8,
                padding: '5px 11px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
              }}>Dismiss</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
