// Shared construction-config capture — THE single source used by all four mount points
// (NewProjectWizard, OnboardingWizard, ProjectDetail "set up tasks", and indirectly the task
// view). Presentation + the branched submit logic only; each wrapper supplies its own chrome
// and decides what happens onComplete.
//
// Supported types (Residential/Villa/Apartment) → write the resolved stack + run the
// client-side expander (generateSiteTasks). Unsupported types (Commercial/Industrial/
// Renovation) → save the type, skip generation, return a graceful signal — block 0's scope
// limit degrading cleanly, never erroring or blocking project creation.

import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { buildStack, type Sequence } from '../../lib/siteOps/expander'
import { generateSiteTasks } from '../../lib/siteOps/generateTasks'
import sequenceJson from '../../../docs/site-ops/sequence.json'

const sequence = sequenceJson as Sequence

const SUPPORTED = ['Residential', 'Villa', 'Apartment']

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

export default function ConstructionConfig({ projectId, projectType, onComplete, onSkip }: Props) {
  const supported = SUPPORTED.includes(projectType)

  const [parking, setParking] = useState<'none' | 'stilt' | 'cellar'>('none')
  const [floors, setFloors] = useState(1)
  const [units, setUnits] = useState(1)
  const [common, setCommon] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function submit() {
    setBusy(true)
    setError('')
    try {
      if (!supported) {
        // graceful degrade — persist the type, no generation
        const { error: e } = await supabase.from('projects').update({ project_type: projectType }).eq('project_id', projectId)
        if (e) throw e
        onComplete({ generated: false, reason: 'unsupported_type' })
        return
      }
      const stack = buildStack({ dedicated_parking: parking, habitable_floors: floors, units_per_floor: units, has_common_areas: common })
      const { error: e } = await supabase.from('projects').update({
        construction_stack: stack,
        dedicated_parking: parking,
        habitable_floors: floors,
        units_per_floor: units,
        has_common_areas: common,
        project_type: projectType,
        sequence_model: 'rcc_residential',
      }).eq('project_id', projectId)
      if (e) throw e
      const res = await generateSiteTasks(supabase, projectId, sequence)
      onComplete({ generated: true, taskCount: res.inserted })
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

      {/* common areas */}
      <button onClick={() => setCommon((c) => !c)} className="flex items-center justify-between rounded-xl border border-outline-variant/40 px-3.5 py-3 text-left">
        <span>
          <span className="block text-[14px] font-medium text-on-surface">Common areas</span>
          <span className="block text-[11px] text-on-surface-variant/60">Lobby, staircase, lift</span>
        </span>
        <span className={`relative h-6 w-10 rounded-full transition ${common ? '' : 'bg-outline-variant/40'}`} style={common ? { background: '#C8603A' } : undefined}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${common ? 'left-[18px]' : 'left-0.5'}`} />
        </span>
      </button>

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
