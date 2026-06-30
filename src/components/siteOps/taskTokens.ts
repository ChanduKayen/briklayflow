// Shared design tokens + small formatters for the site-ops task surface. Lives in its own module
// so BOTH the List view (ProjectTasks) and the Sequence view (ProjectSequence → TaskDetail drawer)
// import the same values without a circular page↔page import.
import type { CSSProperties } from 'react'

// ── walnut-ledger palette ─────────────────────────────────────────────────────
export const CREAM = '#FBF9F6'
export const INK = '#221A13'
export const INK_SOFT = 'rgba(34,26,19,0.55)'
export const INK_FAINT = 'rgba(34,26,19,0.34)'
export const TERRA = '#C8603A'
export const SAGE = '#5E8157'
export const LINE = 'rgba(34,26,19,0.10)'
export const FAIL = '#B2402A'
export const SERIF = "'Playfair Display', Georgia, serif"
// The dark "desk" canvas shared by both views (the Sequence timeline's backdrop, now the whole
// screen). Light content floats on it as a cream sheet; the timeline reads as a screen inset.
export const DARK_CANVAS = 'radial-gradient(120% 70% at 50% 0%, #16161a 0%, #0e0e10 55%)'

export const DEFAULT_DURATION = 1

export const addDays = (d: Date, n: number): Date => { const r = new Date(d); r.setDate(r.getDate() + n); return r }
export const fmtDate = (d: Date): string => d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })
export const fmtWhen = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })

/** relative time ("2h ago"); used by QC provenance + activity timeline. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  if (isNaN(ms)) return ''
  const m = Math.round(ms / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export const isParking = (floor: string) => /^(stilt|cellar|basement)/i.test(floor)
export const titleCase = (s: string) => (s || '').replace(/[_-]+/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

/** Where a task sits (floor + unit), shown as a tag. */
export function whereLabel(floor: string | null, unit: string | null): string {
  if (!floor) return 'Site-wide'
  const base = isParking(floor) ? floor : `${floor} Floor`
  return unit ? `${base} · ${unit}` : base
}

export function chip(color: string): CSSProperties {
  return { fontSize: 10, fontWeight: 700, color, background: `${color}14`, padding: '2px 8px', borderRadius: 999, letterSpacing: '0.03em' }
}
export const metaTag: CSSProperties = { fontSize: 11, fontWeight: 500, color: INK_FAINT, background: 'rgba(34,26,19,0.05)', padding: '1px 7px', borderRadius: 6, whiteSpace: 'nowrap' }
