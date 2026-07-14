// SITE DESK — ADD A TASK THE ENGINE COULD NEVER HAVE KNOWN ABOUT.
//
// The library plans a building. It cannot plan YOURS: the client wants a second coat in the master
// bedroom, the neighbour's compound wall needs underpinning, a hoarding goes up before the machines
// arrive. None of that is in any library, and all of it is work a crew has to be sent to do.
//
// The form asks four things, and every one of them is a thing only he knows. It does NOT ask for a
// dependency — the engine authors those from physics, and a made-up "this comes after that" would be
// a rule with nobody's name on it. A hand-added task waits for nothing and nothing waits for it, and
// the desk says so plainly rather than inventing a chain.
//
// It lands with the work it is part of (add.ts) — at the end of its own section, on this floor, in
// this flat. Not appended to the bottom of the site, four storeys above the work it describes.

import { useState } from 'react'
import type { NewTask } from '../../lib/desk/add'

const SECTIONS = ['Structure', 'Services', 'Finishes'] as const

export function TaskAdd({
  floor, unit, section, onAdd, onClose,
}: {
  /** Where he is looking — the new job goes here, because that is what he was looking at. */
  floor: string | null
  unit: string | null
  /** The section he opened it from, if he used a section's own "+". */
  section?: string
  onAdd: (draft: NewTask) => Promise<void>
  onClose: () => void
}) {
  const [name, setName] = useState('')
  const [group, setGroup] = useState<string>(section ?? 'Finishes')
  const [days, setDays] = useState('1')
  const [saving, setSaving] = useState(false)

  const where = [floor, unit].filter(Boolean).join(' · ') || 'the whole site'

  const save = async () => {
    if (!name.trim() || saving) return
    setSaving(true)
    try {
      await onAdd({
        name: name.trim(), group, floor, unit,
        durationDays: Math.max(1, parseInt(days, 10) || 1),
      })
      onClose()
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="ta-scrim" onClick={onClose} role="presentation">
      <div className="ta" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Add a task">
        <h3 className="ta-title">Add a task</h3>
        <p className="ta-sub">It goes on <b>{where}</b>, with the rest of that work.</p>

        <label className="ta-field">
          <span className="ta-k">What is the job?</span>
          <input
            className="ta-in" value={name} autoFocus
            placeholder="Second coat — master bedroom"
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void save(); if (e.key === 'Escape') onClose() }}
          />
        </label>

        <div className="ta-field">
          <span className="ta-k">Which kind of work?</span>
          <div className="ta-seg">
            {SECTIONS.map((s) => (
              <button
                key={s} type="button"
                className={`ta-seg-b ${group === s ? 'on' : ''}`}
                onClick={() => setGroup(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        <label className="ta-field ta-days">
          <span className="ta-k">How many days?</span>
          <input
            className="ta-in" type="number" min={1} value={days}
            onChange={(e) => setDays(e.target.value)}
          />
        </label>

        {/* Said once, plainly, because it is the one thing that is different about a task he added. */}
        <p className="ta-note">
          Nothing waits for this and it waits for nothing — you can drag it wherever it belongs.
        </p>

        <div className="ta-bar">
          <button className="ta-ghost" onClick={onClose}>Cancel</button>
          <button className="ta-go" disabled={!name.trim() || saving} onClick={() => void save()}>
            {saving ? 'Adding…' : 'Add task'}
          </button>
        </div>
      </div>
    </div>
  )
}
