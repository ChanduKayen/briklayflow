// Follow-up Rules (P1.5) — the org-tunable timing layer over the cause taxonomy. NOT "SLA":
// the name says what it does — how soon and how often we follow up when work stalls for a
// given reason. Each cause from the FIXED taxonomy gets an editable "how soon" + "how often";
// edits persist as per-org overrides (follow_up_rules); clearing one reverts to the built-in
// default. There is deliberately NO "add category" — causes are a curated contract the system
// reasons about; a missing one is a request to us, not a free-text field.

import { useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { Session } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { useAuth } from '../lib/auth/AuthProvider'
import { PageSkeleton } from '../components/SkeletonLoader'
import { useUserProfile } from '../App'

const CREAM = '#FBF9F6', INK = '#221A13', INK_SOFT = 'rgba(34,26,19,0.55)', INK_FAINT = 'rgba(34,26,19,0.34)'
const TERRA = '#C8603A', SAGE = '#5E8157', LINE = 'rgba(34,26,19,0.10)'
const SERIF = "'Playfair Display', Georgia, serif"

interface Cause {
  cause_key: string; label: string; definition: string
  default_clock_days: number | null; default_cadence_days: number | null
  is_other: boolean; sort_order: number
}
interface Rule { cause_key: string; clock_days: number | null; cadence_days: number | null }

// One merged, editable row: the cause + its effective timing (override if present, else default).
interface RowState {
  cause: Cause
  hasOverride: boolean
  clock: number | null
  cadence: number | null
}

const SUPPORT_EMAIL = 'kchandubabunaidu@gmail.com'

export default function FollowUpRules({ session }: { session: Session }) {
  const { orgId } = useAuth()
  const qc = useQueryClient()
  const { data: me } = useUserProfile(session.user.id)
  const canEdit = me?.role === 'principal' || me?.role === 'management'

  const { data: causes = [], isLoading } = useQuery({
    queryKey: ['cause_taxonomy'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('cause_taxonomy')
        .select('cause_key, label, definition, default_clock_days, default_cadence_days, is_other, sort_order')
        .order('sort_order')
      if (error) throw error
      return (data ?? []) as Cause[]
    },
  })
  const { data: rules = [] } = useQuery({
    queryKey: ['follow_up_rules', orgId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('follow_up_rules')
        .select('cause_key, clock_days, cadence_days')
        .eq('org_id', orgId)
      if (error) throw error
      return (data ?? []) as Rule[]
    },
    enabled: !!orgId,
  })

  // Merge taxonomy + overrides into editable rows. Derives straight from the two queries — edits
  // optimistically patch the rules cache below, so the rows recompute without local mirror state.
  const rows = useMemo<RowState[]>(() => {
    const byCause = new Map(rules.map((r) => [r.cause_key, r]))
    return causes.map((c) => {
      const o = byCause.get(c.cause_key)
      return {
        cause: c,
        hasOverride: !!o,
        clock: o ? o.clock_days : c.default_clock_days,
        cadence: o ? o.cadence_days : c.default_cadence_days,
      }
    })
  }, [causes, rules])

  // Persist an override (upsert) — keyed (org_id, cause_key). Optimistic via the rules cache.
  async function saveOverride(causeKey: string, clock: number | null, cadence: number | null) {
    qc.setQueryData(['follow_up_rules', orgId], (old: Rule[] = []) =>
      [...old.filter((r) => r.cause_key !== causeKey), { cause_key: causeKey, clock_days: clock, cadence_days: cadence }])
    await supabase
      .from('follow_up_rules')
      .upsert({ org_id: orgId, cause_key: causeKey, clock_days: clock, cadence_days: cadence }, { onConflict: 'org_id,cause_key' })
    qc.invalidateQueries({ queryKey: ['follow_up_rules', orgId] })
  }
  // Clear an override → revert to the built-in default.
  async function resetOverride(causeKey: string) {
    qc.setQueryData(['follow_up_rules', orgId], (old: Rule[] = []) => old.filter((r) => r.cause_key !== causeKey))
    await supabase.from('follow_up_rules').delete().eq('org_id', orgId).eq('cause_key', causeKey)
    qc.invalidateQueries({ queryKey: ['follow_up_rules', orgId] })
  }

  if (isLoading) return <PageSkeleton />

  return (
    <div style={{ minHeight: '100vh', background: CREAM }}>
      {/* hero */}
      <div style={{
        background: `linear-gradient(180deg, #fff 0%, ${CREAM} 100%)`,
        borderBottom: `1px solid ${LINE}`,
        backgroundImage: `radial-gradient(ellipse 70% 60% at 85% 0%, ${TERRA}0c 0%, transparent 60%)`,
      }}>
        <div className="mx-auto w-full max-w-[880px] lg:max-w-[1040px] xl:max-w-[1200px]" style={{ padding: '34px 24px 22px' }}>
          <p style={{ fontSize: 11, fontWeight: 700, color: TERRA, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>Settings</p>
          <h1 style={{ fontFamily: SERIF, fontSize: 36, fontWeight: 600, color: INK, margin: '6px 0 0', letterSpacing: '-0.01em' }}>Follow-up Rules</h1>
          <p style={{ fontSize: 14.5, lineHeight: 1.55, color: INK_SOFT, margin: '10px 0 0', maxWidth: 560 }}>
            When work stalls, we follow up so it doesn’t go quiet. Set <strong style={{ color: INK }}>how soon</strong> the first
            follow-up goes out and <strong style={{ color: INK }}>how often</strong> after — per reason. These are your defaults;
            an individual issue’s own date always takes precedence.
          </p>
        </div>
      </div>

      <div className="mx-auto w-full max-w-[880px] lg:max-w-[1040px] xl:max-w-[1200px]" style={{ padding: '22px 24px 96px' }}>
        {!canEdit && (
          <div style={{ marginBottom: 16, padding: '10px 14px', borderRadius: 10, background: '#fff', border: `1px solid ${LINE}`, fontSize: 13, color: INK_SOFT }}>
            You can view these rules; only management can change them.
          </div>
        )}

        <div style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: 16, overflow: 'hidden', boxShadow: '0 1px 2px rgba(34,26,19,0.03)' }}>
          {/* column headers */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 18px', background: '#F6F1EA', borderBottom: `1px solid ${LINE}` }}>
            <span style={{ flex: 1, fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase' }}>Reason work stalls</span>
            <span style={{ width: 150, fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase', textAlign: 'center' }}>How soon we follow up</span>
            <span style={{ width: 150, fontSize: 10.5, fontWeight: 700, color: INK_FAINT, letterSpacing: '0.07em', textTransform: 'uppercase', textAlign: 'center' }}>How often after</span>
          </div>

          {rows.map((r) => (
            <CauseRow key={r.cause.cause_key} row={r} canEdit={canEdit} onSave={saveOverride} onReset={resetOverride} />
          ))}
        </div>

        {/* no add-category — by design. A missing cause is a request to us, not a free-text field. */}
        <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 12, background: '#fff', border: `1px dashed ${LINE}`, display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: INK, margin: 0 }}>Reasons are built-in on purpose.</p>
            <p style={{ fontSize: 12.5, color: INK_SOFT, margin: '3px 0 0', lineHeight: 1.5 }}>
              The list is a fixed vocabulary the system understands and reasons about. If one’s missing, tell us and we’ll add it
              properly — it isn’t something you add as free text.
            </p>
          </div>
          <a
            href={`mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Request a new follow-up cause')}&body=${encodeURIComponent('The cause I’m missing is:\n\nWhat it means / when it applies:\n')}`}
            style={{ fontSize: 12.5, fontWeight: 600, color: '#fff', background: TERRA, borderRadius: 9, padding: '8px 14px', textDecoration: 'none', whiteSpace: 'nowrap' }}
          >
            Request a reason →
          </a>
        </div>
      </div>
    </div>
  )
}

// ── one cause row — toggle (chased / not chased) + two day steppers ──────────
function CauseRow({ row, canEdit, onSave, onReset }: {
  row: RowState
  canEdit: boolean
  onSave: (causeKey: string, clock: number | null, cadence: number | null) => void
  onReset: (causeKey: string) => void
}) {
  const { cause } = row
  const chased = row.clock != null
  const defaultChased = cause.default_clock_days != null

  // Toggle chased on/off. Off → override with null timing. On → seed from default (or 1/1).
  const toggleChased = () => {
    if (!canEdit) return
    if (chased) onSave(cause.cause_key, null, null)
    else onSave(cause.cause_key, cause.default_clock_days ?? 1, cause.default_cadence_days ?? 1)
  }
  const setClock = (v: number) => onSave(cause.cause_key, Math.max(1, v), row.cadence ?? cause.default_cadence_days ?? 1)
  const setCadence = (v: number) => onSave(cause.cause_key, row.clock ?? cause.default_clock_days ?? 1, Math.max(1, v))

  const defaultHint = defaultChased
    ? `Default: in ${cause.default_clock_days} day${cause.default_clock_days === 1 ? '' : 's'}, then every ${cause.default_cadence_days} day${cause.default_cadence_days === 1 ? '' : 's'}`
    : 'Default: recorded only, not chased'

  return (
    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, padding: '14px 18px', borderBottom: `1px solid ${LINE}` }}>
      {/* reason — label + definition + default/override hint */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 14.5, fontWeight: 600, color: INK }}>{cause.label}</span>
          {cause.is_other && <span style={{ fontSize: 9.5, fontWeight: 700, color: INK_FAINT, border: `1px solid ${LINE}`, borderRadius: 999, padding: '1px 7px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Catch-all</span>}
          {row.hasOverride && <span style={{ fontSize: 9.5, fontWeight: 700, color: TERRA, background: `${TERRA}12`, borderRadius: 999, padding: '1px 7px', letterSpacing: '0.04em', textTransform: 'uppercase' }}>Tuned</span>}
        </div>
        <p style={{ fontSize: 12.5, lineHeight: 1.5, color: INK_SOFT, margin: '4px 0 0' }}>{cause.definition}</p>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11, color: INK_FAINT }}>{defaultHint}</span>
          {row.hasOverride && canEdit && (
            <button onClick={() => onReset(cause.cause_key)} style={{ fontSize: 11, fontWeight: 600, color: TERRA, background: 'transparent', border: 'none', padding: 0, cursor: 'pointer' }}>
              Reset to default
            </button>
          )}
        </div>
        {/* not-chased toggle */}
        <button
          onClick={toggleChased}
          disabled={!canEdit}
          style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12, fontWeight: 600, cursor: canEdit ? 'pointer' : 'default', background: 'transparent', border: 'none', padding: 0, color: chased ? SAGE : INK_FAINT }}
        >
          <span style={{ width: 30, height: 17, borderRadius: 999, background: chased ? SAGE : 'rgba(34,26,19,0.18)', position: 'relative', transition: 'background 160ms', flexShrink: 0 }}>
            <span style={{ position: 'absolute', top: 2, left: chased ? 15 : 2, width: 13, height: 13, borderRadius: '50%', background: '#fff', transition: 'left 160ms' }} />
          </span>
          {chased ? 'We follow up on this' : 'Not chased — recorded only'}
        </button>
      </div>

      {/* how soon */}
      <div style={{ width: 150, display: 'flex', justifyContent: 'center', paddingTop: 2 }}>
        {chased
          ? <DayStepper value={row.clock ?? 1} onChange={setClock} disabled={!canEdit} />
          : <span style={{ fontSize: 12, color: INK_FAINT }}>—</span>}
      </div>
      {/* how often */}
      <div style={{ width: 150, display: 'flex', justifyContent: 'center', paddingTop: 2 }}>
        {chased
          ? <DayStepper value={row.cadence ?? 1} onChange={setCadence} disabled={!canEdit} />
          : <span style={{ fontSize: 12, color: INK_FAINT }}>—</span>}
      </div>
    </div>
  )
}

// ── day stepper — plain-language "N days", no jargon ─────────────────────────
function DayStepper({ value, onChange, disabled }: { value: number; onChange: (v: number) => void; disabled?: boolean }) {
  const btn = { width: 26, height: 26, borderRadius: 7, border: `1px solid ${LINE}`, background: '#fff', color: INK_SOFT, fontSize: 15, lineHeight: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 0, cursor: disabled ? 'default' : 'pointer' } as const
  return (
    <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <button onClick={() => !disabled && onChange(value - 1)} disabled={disabled || value <= 1} aria-label="Fewer days" style={{ ...btn, opacity: value <= 1 || disabled ? 0.4 : 1 }}>−</button>
      <span style={{ fontSize: 13, fontWeight: 700, color: INK, fontVariantNumeric: 'tabular-nums', minWidth: 44, textAlign: 'center' }}>{value} day{value === 1 ? '' : 's'}</span>
      <button onClick={() => !disabled && onChange(value + 1)} disabled={disabled} aria-label="More days" style={{ ...btn, opacity: disabled ? 0.4 : 1 }}>+</button>
    </div>
  )
}
