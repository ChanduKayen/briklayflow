// PLAN SETUP — "Describe the building once."
//
// An exact port of the reference (plan-setup-v6.html): the same questions, the same copy, the same
// segmented thumb, the same number pop, the same readback sentence, the same amenities popover with
// its auto tags, the same three-layer generate button with its cycling load words, and the same
// GSAP-drawn building beside it (PlanScene.tsx).
//
// TWO THINGS ARE OURS, AND BOTH ARE ABOUT TELLING THE TRUTH:
//
//   1. The reference ESTIMATES the task count with a formula (40 + floors*units*22 + …) because it
//      has no generator behind it. We do. So the button waits for the real write and reports the
//      real number — a fake count on a screen whose entire job is "here is your plan" would be a lie
//      told at the exact moment trust is being established.
//   2. The reference's generate always succeeds. Ours can fail (RLS, a dropped connection), and when
//      it does the button says so and returns to rest, rather than turning green over nothing.
//
// It mounts in two places — the Site Desk's empty plan and project creation — and both go through
// setupPlan(), the one door to the engine.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  SYSTEMS, autoSet, isOn, chosen, toggle, ruleHints,
  type Parking, type UserSet,
} from '../../lib/desk/planRules'
import { setupPlan, idOf, SUPPORTED_TYPES, type PlanResult } from '../../lib/siteOps/setupPlan'
import { PlanScene, type SceneHandle } from './PlanScene'
// the card carries its own stylesheet — it mounts inside two different hosts, and neither of them
// should have to know it exists
import '../../styles/plan-setup.css'

const LOADWORDS = [
  'Reading the building…',
  'Laying the foundation…',
  'Stacking the floors…',
  'Ordering the trades…',
  'Checking the sequence…',
]

const PARK_HINT: Record<Parking, string> = {
  none: 'Porch / open parking',
  stilt: 'Parking at ground level',
  cellar: 'Parking below ground',
}

const PARKS: { v: Parking; label: string }[] = [
  { v: 'none', label: 'None' },
  { v: 'stilt', label: 'Stilt' },
  { v: 'cellar', label: 'Cellar' },
]

const CHECK = (
  <svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
)

export function PlanSetup({
  projectId, projectType, onComplete, onOpen, onSkip,
}: {
  projectId: string
  projectType: string
  onComplete: (r: PlanResult) => void
  /** the "Open the plan →" step after a successful generate. Omit and it is not offered. */
  onOpen?: () => void
  /** the new-project wizard lets you describe the building later. Omit and it is not offered. */
  onSkip?: () => void
}) {
  const [floors, setFloors] = useState(1)
  const [units, setUnits] = useState(1)
  const [park, setPark] = useState<Parking>('none')
  const [user, setUser] = useState<UserSet>({})

  const [podOpen, setPodOpen] = useState(false)
  const [phase, setPhase] = useState<'rest' | 'loading' | 'done'>('rest')
  const [word, setWord] = useState(LOADWORDS[0])
  const [doneWord, setDoneWord] = useState('Plan ready')
  const [error, setError] = useState('')

  const auto = useMemo(() => autoSet(floors, units, park), [floors, units, park])
  const has = useCallback((n: string) => isOn(n, auto, user), [auto, user])
  const on = useMemo(() => chosen(auto, user), [auto, user])

  const scene = useRef<SceneHandle | null>(null)
  const segRef = useRef<HTMLDivElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)
  const podRef = useRef<HTMLDivElement>(null)

  const supported = SUPPORTED_TYPES.includes(projectType)

  /* the thumb is measured, never guessed — it must land on the button, whatever the text does */
  useEffect(() => {
    const place = () => {
      const seg = segRef.current, th = thumbRef.current
      if (!seg || !th) return
      const btn = seg.querySelector<HTMLButtonElement>('button.on')
      if (!btn) return
      th.style.left = `${btn.offsetLeft}px`
      th.style.width = `${btn.offsetWidth}px`
    }
    place()
    window.addEventListener('resize', place)
    return () => window.removeEventListener('resize', place)
  }, [park])

  /* click away closes the popover — it is a detour, not a destination */
  useEffect(() => {
    if (!podOpen) return
    const away = (e: MouseEvent) => {
      if (podRef.current && !podRef.current.contains(e.target as Node)) setPodOpen(false)
    }
    document.addEventListener('click', away)
    return () => document.removeEventListener('click', away)
  }, [podOpen])

  /* the number POPS when it changes — the count is the thing that just moved, so it is the thing
     that flinches. (Re-armed by key, so it fires on every bump, not only the first.) */
  const [fTick, setFTick] = useState(0)
  const [uTick, setUTick] = useState(0)

  const bump = (which: 'floors' | 'units', d: number) => {
    if (phase !== 'rest') return
    if (which === 'floors') { setFloors((f) => Math.max(1, Math.min(9, f + d))); setFTick((t) => t + 1) }
    else { setUnits((u) => Math.max(1, Math.min(8, u + d))); setUTick((t) => t + 1) }
  }

  /* the readback line pulses when the SYSTEMS change — nothing else earns motion here */
  const amKey = on.join('|')
  const [pulse, setPulse] = useState(false)
  const lastKey = useRef(amKey)
  useEffect(() => {
    if (lastKey.current === amKey) return
    lastKey.current = amKey
    setPulse(true)
    const t = setTimeout(() => setPulse(false), 800)
    return () => clearTimeout(t)
  }, [amKey])

  const total = floors * units
  const kind = total === 1 ? 'A single home' : (units > 1 ? `${total} flats` : `${total} homes`)
  const parkTxt = park === 'none' ? 'open parking' : `${park} parking`
  const amTxt = on.length ? on.slice(0, 3).join(', ') + (on.length > 3 ? ` +${on.length - 3} more` : '') : 'none'
  const hints = ruleHints(floors, units, park, user)

  /* ── GENERATE ─────────────────────────────────────────────────────────────────────────────────
   * The words cycle while the ENGINE actually runs. They are not a fake progress bar over a fixed
   * timeout: the button stays in 'loading' until the write returns, so what you read is what is
   * happening. A minimum beat keeps a fast write from flashing past unread. */
  const generate = async () => {
    if (phase !== 'rest') return
    setPhase('loading')
    setError('')

    const reduced = window.matchMedia('(prefers-reduced-motion:reduce)').matches
    let wi = 0
    setWord(LOADWORDS[0])
    const wt = setInterval(() => {
      wi = Math.min(wi + 1, LOADWORDS.length - 1)
      setWord(LOADWORDS[wi])
    }, reduced ? 100 : 520)

    const started = Date.now()
    try {
      const systems = on.map(idOf).filter((x): x is string => !!x)
      const res = await setupPlan({ projectId, projectType, parking: park, floors, units, systems })

      // hold the load state long enough to be read, then land
      const beat = reduced ? 0 : Math.max(0, 900 - (Date.now() - started))
      await new Promise((r) => setTimeout(r, beat))
      clearInterval(wt)

      setPhase('done')
      setDoneWord(
        res.generated
          ? `${res.taskCount} tasks · in the order it can be built`
          : 'Saved — no sequence for this type yet',
      )
      if (res.generated) scene.current?.celebrate()
      onComplete(res)
    } catch (e) {
      clearInterval(wt)
      setPhase('rest')
      setError((e as Error)?.message ?? 'Could not lay out the plan. Please try again.')
    }
  }

  /* An unsupported type has nothing to describe — say so plainly rather than asking three questions
     whose answers we would then throw away. */
  if (!supported) {
    return (
      <div className="psetup desk-legacy">
        <div className="card">
          <div className="card-head">
            <b>No sequence for {projectType} yet</b> — your project is saved. We build each type from real
            jobs first, so the plan is right rather than merely present.
          </div>
          <button className="gen" onClick={() => void generate()}>
            <span className="layer l-rest">Save and continue</span>
          </button>
          {error && <div className="perr">{error}</div>}
        </div>
      </div>
    )
  }

  return (
    <div className="psetup desk-legacy">
      <div className="card">
        <div className="card-head">
          <b>Describe the building once</b> — Babai lays out every task, in the order it can actually be built.
        </div>

        <div className="split">
          <div>
            <div className="qlabel">Parking level</div>
            <div className="segx" ref={segRef}>
              <span className="thumb" ref={thumbRef} />
              {PARKS.map((p) => (
                <button
                  key={p.v}
                  className={park === p.v ? 'on' : ''}
                  onClick={() => phase === 'rest' && setPark(p.v)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="seghint">{PARK_HINT[park]}</div>

            <div className="row2">
              <div>
                <div className="qlabel">Floors</div>
                <div className="stepbox">
                  <button onClick={() => bump('floors', -1)} disabled={floors <= 1}>−</button>
                  <div key={`f${fTick}`} className={`stepnum ${fTick ? 'tick' : ''}`}>{floors}</div>
                  <button onClick={() => bump('floors', 1)} disabled={floors >= 9}>+</button>
                </div>
                <div className="stephint">
                  {floors === 1 ? 'Ground only' : `Ground + ${floors - 1} upper${floors > 2 ? 's' : ''}`}
                </div>
              </div>
              <div>
                <div className="qlabel">Homes per floor</div>
                <div className="stepbox">
                  <button onClick={() => bump('units', -1)} disabled={units <= 1}>−</button>
                  <div key={`u${uTick}`} className={`stepnum ${uTick ? 'tick' : ''}`}>{units}</div>
                  <button onClick={() => bump('units', 1)} disabled={units >= 8}>+</button>
                </div>
                <div className="stephint">
                  {units === 1
                    ? (floors === 1 ? 'A single home' : 'One home per floor')
                    : `${units} flats on each floor`}
                </div>
              </div>
            </div>
          </div>

          <PlanScene
            floors={floors} units={units} park={park} has={has}
            onReady={(h) => { scene.current = h }}
          />
        </div>

        {/* THE READBACK: the building, said back in one sentence. The systems it will get are named,
            and "Adjust" opens the only place they can be argued with. */}
        <div className="readback">
          <div className={`pod ${podOpen ? 'open' : ''}`} ref={podRef}>
            <div className="podgrid">
              {Object.entries(SYSTEMS).map(([group, items]) => (
                <div key={group}>
                  <div className="glabel">{group}</div>
                  <div className="gcol">
                    {items.map((n) => {
                      const o = has(n)
                      const isAuto = o && auto.has(n) && !(n in user)
                      return (
                        <button
                          key={n}
                          className={`am ${o ? 'on' : ''} ${isAuto ? 'auto' : ''}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            setUser((u) => toggle(n, auto, u))
                            setPodOpen(true)
                          }}
                        >
                          <span className="ambox">{CHECK}</span>
                          {n}
                          <span className="tag">auto</span>
                        </button>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
            <div className="podfoot">
              <span>
                Auto-picked for {total === 1 ? 'a single home' : `${total} homes`}
                {hints.length ? ` · ${hints.join(' · ')}` : ''} — tap to change
              </span>
              {Object.keys(user).length > 0 && (
                <span className="reset" onClick={(e) => { e.stopPropagation(); setUser({}); setPodOpen(true) }}>
                  reset changes
                </span>
              )}
            </div>
          </div>

          <span>
            <b>{kind}</b> — ground{floors > 1 ? ` + ${floors - 1} upper${floors > 2 ? 's' : ''}` : ''}, {parkTxt}.<br />
            <span className={`amline ${pulse ? 'pulse' : ''}`}>Gets: {amTxt}</span>
            {' · '}
            <button className="adjust" onClick={(e) => { e.stopPropagation(); setPodOpen((o) => !o) }}>Adjust</button>
          </span>
        </div>

        <button className={`gen ${phase === 'loading' ? 'loading' : ''} ${phase === 'done' ? 'done' : ''}`} onClick={() => void generate()}>
          <span className="layer l-rest">Lay out the plan</span>
          <span className="layer l-load ghost">
            <svg className="spin" viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" /></svg>
            <span className="loadword">{word}</span>
          </span>
          <span className="layer l-done ghost">
            <svg className="check" viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5" /></svg>
            <span>{doneWord}</span>
          </span>
        </button>

        {/* a refused write NEVER wears a green button — it says what happened, and the plan stays askable */}
        {error && <div className="perr">{error}</div>}

        {onOpen && (
          <div className={`aftergen ${phase === 'done' ? 'show' : ''}`}>
            <button onClick={onOpen}>Open the plan →</button>
          </div>
        )}

        {/* Describing the building can wait; being FORCED to describe it cannot. (Only where the host
            offers it — the Site Desk's empty plan has nowhere else to go.) */}
        {onSkip && phase === 'rest' && (
          <div className="aftergen show">
            <button onClick={onSkip}>Skip for now</button>
          </div>
        )}
      </div>
    </div>
  )
}
