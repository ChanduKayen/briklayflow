// SITE DESK — THE BUILDING.
//
// The floors were a horizontal timeline across the top of the page. A building is not horizontal.
// Drawn as a vertical rail — top floor at the top, the ground at the bottom, the foundation under
// everything — the control stops being a widget and starts being a picture of the thing itself.
// You do not read it; you recognise it.
//
// Each floor carries the one number that matters (how much of it is done) and a hairline bar that
// says the same thing without being read. The floor you are standing on OPENS, and its units unfold
// beneath it on a connector line — Common first (the floor's own work), then each flat. A unit with
// an open problem wears a red count, and tapping it goes straight to the problem.
//
// Everything else about the plan — the task list, the detail — stays where it was. This only moves
// the WHERE, and gives it the shape it always had.

import type { DeskFloor, DeskProblem, DeskTask, DeskUnit } from '../../lib/desk/types'
import { openBlockers, pctDone, hasLiveWork, floorName } from '../../lib/desk/derive'
import { Check } from './icons'

export function Building({
  floors, focus, units, common, problems, currentUnit, onFloor, onUnit, onRef,
}: {
  floors: DeskFloor[]
  focus: string
  /** The units on the FOCUSED floor. null when this floor has none (a villa, the foundation). */
  units: DeskUnit[] | null
  common: DeskTask[]
  problems: DeskProblem[]
  currentUnit: string
  onFloor: (n: string) => void
  onUnit: (u: string) => void
  onRef: (ref: string) => void
}) {
  // TOP FLOOR FIRST. The data is bottom-up (the order it is built); a building is read top-down
  // (the order it is seen). Reversing here, and only here, keeps both truths.
  const top = [...floors].reverse()

  return (
    <aside className="building" aria-label="The building">
      {/* .pin — the column is full-height so that this, the thing inside it, can stay put for the
          WHOLE scroll. A sticky element is released the moment its own box ends, and a column that
          is only as tall as its card ends almost immediately. */}
      <div className="pin">
      {/* .col-cap — the SHARED column caption. All three columns wear the same one, at the same
          height, so the three cards below them start on the same line. That is the whole trick. */}
      <div className="col-cap">The building</div>

      <div className="bd-card">
        {top.map((f) => {
          const on = f.n === focus
          const done = f.pct === 100
          return (
            <div key={f.n} className={`bd-floor ${on ? 'on' : ''} ${done ? 'done' : ''}`}>
              <button className="bd-row" onClick={() => onFloor(f.n)} aria-current={on ? 'true' : undefined}>
                <span className="bd-name">
                  {on && <span className="bd-dot" aria-hidden="true" />}
                  {floorName(f.n)}
                </span>
                <span className="bd-right">
                  <span className="bd-pct">{f.pct}%</span>
                  <Ring pct={f.pct} />
                </span>
              </button>

              {/* THE FLOOR YOU ARE ON OPENS. Its units unfold on a connector line.
                  A floor with no flats SAYS SO. Silence looked identical to a bug — you clicked, the
                  floor highlighted, and nothing appeared. This floor's work simply isn't divided by
                  flat (the engine gave it whole-floor tasks), and that is a fact, not an absence. */}
              {on && (
                <div className="bd-units">
                  <UnitRow
                    label={units && units.length > 0 ? 'Common' : 'Whole floor'}
                    on={currentUnit === 'Common'}
                    pct={pctDone(common)}
                    live={hasLiveWork(common)}
                    blockers={openBlockers(common, problems)}
                    onClick={() => onUnit('Common')}
                    onRef={onRef}
                  />
                  {units?.map((u) => (
                    <UnitRow
                      key={u.u}
                      label={`Flat ${u.u}`}
                      on={currentUnit === u.u}
                      pct={pctDone(u.tasks)}
                      live={hasLiveWork(u.tasks)}
                      blockers={openBlockers(u.tasks, problems)}
                      onClick={() => onUnit(u.u)}
                      onRef={onRef}
                    />
                  ))}
                  {(!units || units.length === 0) && (
                    <div className="bd-nounits">Not split into flats</div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      </div>
    </aside>
  )
}

/**
 * A RING, NOT A BAR.
 *
 * A full-width 2px line under every row is the universal drawing of a DIVIDER — so a progress track
 * shaped like one gets read as page furniture and then, when it is half-filled, as a divider that
 * has gone wrong. (Worse on a rail whose rows are already stacked: eight tracks read as eight rules.)
 *
 * A ring cannot be mistaken for structure. It is closed, it is a gauge, it is the shape every product
 * on earth uses to mean "how far along", and it sits INSIDE the row rather than under it — so the
 * rows stay one visual unit and the eye can sweep the column of rings in one pass. The number stays
 * beside it: the ring is for the glance, the number is for the truth.
 */
function Ring({ pct }: { pct: number }) {
  const R = 7
  const C = 2 * Math.PI * R
  const p = Math.max(0, Math.min(100, pct))
  return (
    <svg className="bd-ring" width="18" height="18" viewBox="0 0 18 18" aria-hidden="true">
      <circle className="bd-ring-t" cx="9" cy="9" r={R} fill="none" strokeWidth="2" />
      <circle
        className="bd-ring-v" cx="9" cy="9" r={R} fill="none" strokeWidth="2" strokeLinecap="round"
        strokeDasharray={C}
        strokeDashoffset={C * (1 - p / 100)}
        transform="rotate(-90 9 9)"
      />
    </svg>
  )
}

/** One place inside a floor. The badge is the only red on this rail, and it is a door. */
function UnitRow({
  label, on, pct, live, blockers, onClick, onRef,
}: {
  label: string
  on: boolean
  pct: number
  live: boolean
  blockers: string[]
  onClick: () => void
  onRef: (ref: string) => void
}) {
  const stuck = blockers.length > 0
  return (
    <button className={`bd-unit ${on ? 'on' : ''}`} onClick={onClick}>
      <span className="bd-uname">{label}</span>

      {stuck ? (
        <span
          className="bd-badge"
          role="button"
          tabIndex={0}
          title="Open problem — tap to see it"
          onClick={(e) => { e.stopPropagation(); onRef(blockers[0]) }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onRef(blockers[0]) } }}
        >
          {blockers.length}
        </span>
      ) : on ? (
        <span className="bd-tick">{Check}</span>
      ) : live ? (
        <span className="bd-live" aria-hidden="true" />
      ) : (
        <span className="bd-upct">{pct}%</span>
      )}
    </button>
  )
}
