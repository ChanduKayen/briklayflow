// Shared construction-config capture — THE single source used by all four mount points
// (NewProjectWizard, OnboardingWizard, ProjectDetail "set up tasks", and indirectly the task
// view). Presentation + the branched submit logic only; each wrapper supplies its own chrome
// and decides what happens onComplete.
//
// Supported types (Residential/Villa/Apartment) → write the resolved stack + generate the task
// set FROM THE ENGINE (constraint library → geometry → graph → persistGraph). The legacy expander
// is retired here (2026-07-11): it wrote a second, overlapping task vocabulary that made every
// downstream question ambiguous. Unsupported types (Commercial/Industrial/Renovation) → save the
// type, skip generation, return a graceful signal — block 0's scope limit degrading cleanly.

import { useMemo, useState } from 'react'
import { buildStack } from '../../lib/siteOps/expander'
import { setupPlan, CA_SYSTEMS, sitedSystems, levelLabels, SUPPORTED_TYPES } from '../../lib/siteOps/setupPlan'

const SUPPORTED = SUPPORTED_TYPES

export interface ConfigResult {
  generated: boolean
  taskCount?: number
  reason?: 'unsupported_type'
}

interface Props {
  projectId: string
  projectType: string
  onComplete: (result: ConfigResult) => void
  onSkip?: () => void
}

const PARKING: { value: 'none' | 'stilt' | 'cellar'; label: string; hint: string }[] = [
  { value: 'none', label: 'None', hint: 'Porch / open' },
  { value: 'stilt', label: 'Stilt', hint: 'Parking level at grade' },
  { value: 'cellar', label: 'Cellar', hint: 'Parking below ground' },
]

// The amenity systems live in setupPlan (CA_SYSTEMS) — ONE list, next to the generator that consumes
// it. This file used to keep its own copy, and a copy of the whole write path besides: two doors to the
// same door, which is the exact mistake the header warns about. It now only asks the questions.

export default function ConstructionConfig({ projectId, projectType, onComplete, onSkip }: Props) {
  const supported = SUPPORTED.includes(projectType)

  const [parking, setParking] = useState<'none' | 'stilt' | 'cellar'>('none')
  const [floors, setFloors] = useState(1)
  const [units, setUnits] = useState(1)
  const [commonSet, setCommonSet] = useState<Set<string>>(new Set())
  const [levels, setLevels] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // The levels this building will actually have, and the ticked systems whose plant stands on one of
  // them. Derived from the same buildStack() the generator uses, so the labels offered here are exactly
  // the labels the engine will match against.
  const levelOptions = useMemo(
    () => levelLabels(buildStack({
      dedicated_parking: parking, habitable_floors: floors, units_per_floor: units,
      has_common_areas: commonSet.size > 0,
    })),
    [parking, floors, units, commonSet],
  )
  const placeable = sitedSystems([...commonSet])

  async function submit() {
    setBusy(true)
    setError('')
    try {
      // ONE DOOR: setupPlan writes the stack AND generates the tasks (engine → graph → persistGraph).
      // This screen used to re-implement that whole path itself — a second door to the one door.
      const res = await setupPlan({
        projectId, projectType, parking, floors, units,
        systems: [...commonSet],
        // only the ticked, placeable systems, and only where the level still exists after the shape
        // questions changed (a stale "Stilt" from a since-removed parking level would just fall back)
        sitedLevels: Object.fromEntries(
          placeable
            .map((s) => [s.id, levels[s.id]] as const)
            .filter(([, lvl]) => !!lvl && levelOptions.includes(lvl)),
        ),
      })
      onComplete(res)
    } catch (err) {
      setError((err as Error)?.message ?? 'Could not set up tasks. Please try again.')
      setBusy(false)
    }
  }

  // ── unsupported type: no questions, a clean note + continue ──
  if (!supported) {
    return (
      <div className="flex flex-col gap-4">
        <div>
          <h3 className="font-data-mono text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant/60">Task plan</h3>
          <p className="mt-1 text-[15px] text-on-surface">Automatic task planning isn't available for <span className="font-semibold">{projectType}</span> projects yet.</p>
          <p className="mt-1 text-[13px] text-on-surface-variant/70">Your project is saved — you can add tasks manually later. We're building the {projectType.toLowerCase()} sequence from real jobs first.</p>
        </div>
        {error && <p className="text-[13px] text-error">{error}</p>}
        <div className="flex gap-2">
          {onSkip && <button onClick={onSkip} disabled={busy} className="flex-1 rounded-xl border border-outline-variant/40 py-2.5 text-[14px] font-medium text-on-surface-variant">Skip</button>}
          <button onClick={submit} disabled={busy} className="flex-1 rounded-xl py-2.5 text-[14px] font-semibold text-white" style={{ background: '#C8603A' }}>{busy ? 'Saving…' : 'Got it'}</button>
        </div>
      </div>
    )
  }

  // ── supported: the three questions ──
  return (
    <div className="flex flex-col gap-5">
      <div>
        <h3 className="font-data-mono text-[11px] font-semibold uppercase tracking-wide text-on-surface-variant/60">Set up the task plan</h3>
        <p className="mt-1 text-[14px] text-on-surface-variant/80">Three quick questions build the site task skeleton.</p>
      </div>

      {/* parking */}
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-on-surface">Dedicated parking level?</label>
        <div className="grid grid-cols-3 gap-2">
          {PARKING.map((p) => {
            const on = parking === p.value
            return (
              <button key={p.value} onClick={() => setParking(p.value)}
                className={`rounded-xl border px-2 py-2.5 text-left transition ${on ? 'border-transparent text-white' : 'border-outline-variant/40 text-on-surface'}`}
                style={on ? { background: '#C8603A' } : undefined}>
                <div className="text-[14px] font-semibold">{p.label}</div>
                <div className={`text-[11px] ${on ? 'text-white/80' : 'text-on-surface-variant/60'}`}>{p.hint}</div>
              </button>
            )
          })}
        </div>
      </div>

      {/* floors + units */}
      <div className="grid grid-cols-2 gap-3">
        <Stepper label="Habitable floors" hint="Ground + uppers" value={floors} setValue={setFloors} min={1} />
        <Stepper label="Units per floor" hint="1 = single home" value={units} setValue={setUnits} min={1} />
      </div>

      {/* common areas / amenities — tick what this project has */}
      <div>
        <label className="mb-1.5 block text-[13px] font-medium text-on-surface">Common areas & amenities</label>
        <p className="mb-2 text-[11px] text-on-surface-variant/60">Tick what applies. Each becomes a system — the lift, for instance, gets a shaft and a landing door on every floor, plus its mechanism and commissioning.</p>
        <div className="flex flex-wrap gap-2">
          {CA_SYSTEMS.map((s) => {
            const on = commonSet.has(s.id)
            return (
              <button key={s.id} type="button"
                onClick={() => setCommonSet((prev) => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n })}
                className={`rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition ${on ? 'border-transparent text-white' : 'border-outline-variant/40 text-on-surface-variant'}`}
                style={on ? { background: '#C8603A' } : undefined}>
                {on ? '✓ ' : ''}{s.label}
              </button>
            )
          })}
        </div>
      </div>

      {/* WHERE the plant stands. A generator is one task, but it is one task ON A LEVEL — and a
          supervisor reports it that way ("DG foundation done at the stilt"). Left unanswered, the
          engine places it sensibly (plant low, tanks and solar on the roof). */}
      {placeable.length > 0 && (
        <div>
          <label className="mb-1.5 block text-[13px] font-medium text-on-surface">Where does each one sit?</label>
          <p className="mb-2 text-[11px] text-on-surface-variant/60">Leave as-is and we'll place it the usual way.</p>
          <div className="space-y-2">
            {placeable.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-3">
                <span className="text-[13px] text-on-surface-variant">{s.label}</span>
                <select
                  value={levels[s.id] ?? ''}
                  onChange={(e) => setLevels((prev) => ({ ...prev, [s.id]: e.target.value }))}
                  className="rounded-lg border border-outline-variant/40 bg-transparent px-2.5 py-1.5 text-[12.5px] text-on-surface">
                  <option value="">
                    {s.sited === 'top' ? 'Topmost level (default)' : 'Lowest level (default)'}
                  </option>
                  {levelOptions.map((l) => <option key={l} value={l}>{l}</option>)}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-[13px] text-error">{error}</p>}

      <div className="flex gap-2">
        {onSkip && <button onClick={onSkip} disabled={busy} className="rounded-xl border border-outline-variant/40 px-4 py-2.5 text-[14px] font-medium text-on-surface-variant">Skip for now</button>}
        <button onClick={submit} disabled={busy} className="flex-1 rounded-xl py-2.5 text-[14px] font-semibold text-white" style={{ background: '#C8603A' }}>
          {busy ? 'Generating…' : 'Generate task plan'}
        </button>
      </div>
    </div>
  )
}

function Stepper({ label, hint, value, setValue, min }: { label: string; hint: string; value: number; setValue: (n: number) => void; min: number }) {
  return (
    <div>
      <label className="mb-1.5 block text-[13px] font-medium text-on-surface">{label}</label>
      <div className="flex items-center rounded-xl border border-outline-variant/40">
        <button onClick={() => setValue(Math.max(min, value - 1))} className="px-3.5 py-2 text-[18px] text-on-surface-variant">−</button>
        <input type="number" value={value} min={min}
          onChange={(e) => setValue(Math.max(min, parseInt(e.target.value || String(min), 10) || min))}
          className="w-full border-x border-outline-variant/40 bg-transparent py-2 text-center font-data-mono text-[15px] font-semibold text-on-surface outline-none" />
        <button onClick={() => setValue(value + 1)} className="px-3.5 py-2 text-[18px] text-on-surface-variant">+</button>
      </div>
      <p className="mt-1 text-[11px] text-on-surface-variant/55">{hint}</p>
    </div>
  )
}
