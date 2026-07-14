// SITE DESK — the item detail: StoryTimeline, PhotoStrip, ResolveForm, Composer.
//
// ONE content tree, two frames: a bottom sheet below 920px, a sticky panel above. The action
// bar is PINNED in both — the primary action and ✓ Close never scroll away, because the close
// must be reachable from anywhere in a long story.

import { useState } from 'react'
import type { DeskProblem, DeskTask, Outcome, StoryStep } from '../../lib/desk/types'
import { OUTCOMES } from '../../lib/desk/types'
import { canClose } from '../../lib/desk/derive'
import { Btn } from './Btn'

/* ---------- StoryPhoto: a picture somebody sent from the site ----------
 *
 * The webhook has always attached these to the object it resolved onto — a photo of a poured slab
 * lands on the task, an image of a crack lands on the problem. The desk fetched only the problem ones,
 * so a task photo reached the database and no screen. Shared by both timelines so it can only ever
 * look like one thing.
 *
 * The url is a SIGNED url, minted at read time and good for an hour (the bucket is private and no
 * durable url is ever stored). If signing failed it is null — and we say so, rather than rendering a
 * broken image and letting the reader think the photo never came. */
export function StoryPhoto({ step }: { step: Extract<StoryStep, { t: 'photo' }> }) {
  return (
    <div className="story-photo">
      <div className="from">Photo from the site <em>· WhatsApp</em></div>
      {step.url
        ? (
          <a href={step.url} target="_blank" rel="noopener noreferrer">
            <img src={step.url} alt={step.caption || 'Site photo'} loading="lazy" />
          </a>
        )
        : <div className="sp-gone">Photo unavailable</div>}

      {/* HIS words, under his photo. */}
      {step.caption && <div className="cap">{step.caption}</div>}

      {/* ══ OURS, AND SAID SO ═══════════════════════════════════════════════════════════════════
          What the vision pass read out of the pixels. It used to be glued onto the supervisor's own
          caption and printed inside a speech bubble with HIS name on it, so a sentence a machine wrote
          — "Ceiling installation framework visible at the construction site on the 4th floor" — was
          shown to his boss as something he had said. He never said it. We did.
          It stays, because it is genuinely useful and it is what the plan was moved on. But it is
          attributed, every time, to the only party that actually claimed it. */}
      {step.seen && (
        <div className="sp-read">
          <span className="k">What Briklay saw in this photo</span>
          {step.seen}
        </div>
      )}
      {step.w && <time>{step.w}</time>}
    </div>
  )
}

/* ---------- StoryTimeline: events, chase steps, WhatsApp bubbles, private notes ---------- */
export function StoryTimeline({ item }: { item: DeskProblem }) {
  return (
    <div className="story">
      {item.story.map((s, i) => {
        if (s.t === 'msg') {
          return (
            <div className="bubble" key={i}>
              <div className="from">{s.from} <em>· WhatsApp</em></div>
              {s.text}
              {s.w && <time>{s.w}</time>}
            </div>
          )
        }
        if (s.t === 'note') {
          return (
            <div className="note-item" key={i}>
              <div className="from">Your note</div>
              {s.text}
            </div>
          )
        }
        if (s.t === 'photo') return <StoryPhoto step={s} key={i} />
        return (
          <div className={`step ${s.t === 'event' ? '' : s.t}`} key={i}>
            {s.l}
            {s.w && <time>{s.w}</time>}
          </div>
        )
      })}
    </div>
  )
}

/* ---------- PhotoStrip, incl. the "photo pending — Babai asking" state ---------- */
export function PhotoStrip({ item }: { item: DeskProblem }) {
  if (item.photos?.length) {
    return (
      <div className="photos">
        {item.photos.map((p, i) => (
          p.url
            // A real photo, signed at read time. The label rides underneath as the alt text too —
            // a site photo with no caption is still evidence, and must never render as a blank tile.
            ? <img className="ph ph-img" key={i} src={p.url} alt={p.l} title={p.l} />
            : <div className="ph" key={i}>{p.e}<span>{p.l}</span></div>
        ))}
      </div>
    )
  }
  if (item.photoPending) {
    return (
      <div className="photos">
        <div className="ph pending">📷<span>No photo yet<br />Babai is asking</span></div>
      </div>
    )
  }
  return null
}

/* ---------- ResolveForm: the closing moment. One question — the reason. ---------- */
export function ResolveForm({
  item, onConfirm, onBack,
}: {
  item: DeskProblem
  onConfirm: (outcome: Outcome, note: string) => void
  onBack: () => void
}) {
  const [outcome, setOutcome] = useState<Outcome>('Fixed')
  const [note, setNote] = useState(item.prefillNote ?? '')
  const gate = canClose(item, outcome)              // THE SNAG PHOTO FLOOR (P8)

  return (
    <>
      <div className="res-form">
        <h3>
          <span className="ref-big">{item.ref}</span>
          Closing this {item.kind === 'snag' ? 'snag' : 'issue'}
        </h3>
        <label>Closing reason</label>
        {/* The reason GAINS ITS MARK: a ✓ unfolds into the label and the chip warms green. */}
        <div className="outcomes">
          {OUTCOMES.map((o) => (
            <button key={o} className={o === outcome ? 'on' : ''} onClick={() => setOutcome(o)}>
              <span className="mk">✓</span>{o}
            </button>
          ))}
        </div>
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="One line on what settled it (kept on record)"
        />
        {gate.ok ? (
          <div className="hint">
            {item.prefillNote
              ? 'Babai pre-filled this from the evidence — edit if needed.'
              : `This stays on the ${item.ref} record and in the site register.`}
          </div>
        ) : (
          <div className="blocked-hint">{gate.why}</div>
        )}
      </div>
      <div className="d-bar-row" style={{ marginTop: 12 }}>
        {/* THE ONE GREEN FILL IN THE PRODUCT. Outline at rest; on success the outline FILLS —
            the record is written, and the colour says settled. */}
        {/* NO BLOOM ON THE BUTTON. The celebration moved to the CARD (Celebrate.tsx) — the button did
            not get finished, the work did — and two celebrations for one act is one too many. The
            button still fills green: that is the receipt, and it is all a button should claim. */}
        <Btn
          variant="closer" className="flex1"
          disabled={!gate.ok}
          loadingLabel="Closing" successLabel="Closed"
          onClick={() => { if (gate.ok) return onConfirm(outcome, note) }}
        >
          ✓&nbsp; Close {item.ref}
        </Btn>
        <button className="btn btn-quiet" style={{ flex: '0 0 auto', padding: '0 16px' }} onClick={onBack}>Back</button>
      </div>
    </>
  )
}

/* ---------- Composer: his voice, our line, ref-stamped ---------- */
export function Composer({
  item, onSend, onBack,
}: {
  item: DeskProblem
  onSend: (text: string) => void
  onBack: () => void
}) {
  const [text, setText] = useState(item.draft ?? '')
  return (
    <>
      <div className="composer" style={{ marginTop: 4 }}>
        <label>Message to {item.person.name} — in your voice</label>
        <textarea autoFocus value={text} onChange={(e) => setText(e.target.value)} />
        <div className="hint">
          Sends from Briklay's WhatsApp line with ref {item.ref} — replies auto-attach here.
        </div>
      </div>
      <div className="d-bar-row" style={{ marginTop: 12 }}>
        <Btn variant="primary" className="flex1" loadingLabel="Sending" successLabel="Sent" onClick={() => onSend(text)}>
          Send on WhatsApp
        </Btn>
        <button className="btn btn-quiet" style={{ flex: '0 0 auto', padding: '0 16px' }} onClick={onBack}>Back</button>
      </div>
    </>
  )
}

/* ---------- The shared detail content ---------- */
type Mode = { k: 'view' } | { k: 'resolve' } | { k: 'compose' }

export function DetailContent({
  item, tasks, isTouch, onNote,
}: {
  item: DeskProblem
  tasks: DeskTask[]
  isTouch: boolean
  onNote: (text: string) => Promise<void>
}) {
  const [note, setNote] = useState('')
  const holding = tasks.filter((t) => t.blockedBy === item.ref)
  // Clear the box only once the note is ACTUALLY saved. Clearing it optimistically is how a
  // failed write silently eats what someone typed.
  const submitNote = async () => {
    const v = note.trim()
    if (!v) return
    await onNote(v)
    setNote('')
  }

  const stateWord =
    item.state === 'resolved' ? <span className="resword">Sorted</span>
      : item.state === 'you' ? <span className="you">Waiting on you</span>
        : item.state === 'chasing' ? 'Babai is on it'
          : 'On track'


  return (
    <>
      {/* Even the item's NAME knows it is settled — the ref pill warms green when sorted. */}
      <div className={`d-eyebrow ${item.state === 'resolved' ? 'is-sorted' : ''}`}>
        <span className="ref-big">{item.ref}</span>
        <span>
          {item.kind === 'snag' ? 'Snag' : 'Issue'} · {stateWord} ·{' '}
          {item.state === 'resolved' ? 'closed' : item.days === 0 ? 'raised today' : `open ${item.days} days`}
        </span>
      </div>

      <h2 className="d-title">{item.title}</h2>
      <div className="d-meta">{item.site}{item.kind === 'snag' ? ` · ${item.loc ?? 'Project-wide'}` : ` · ${item.tag}`}</div>

      {/* Reverse-link: what this problem is holding up, in the Work Plan */}
      {holding.length > 0 && item.state !== 'resolved' && (
        <div className="d-holding">
          Holding up: {holding.map((t) => `${t.ref} ${t.title}`).join(' · ')} in the Work Plan
        </div>
      )}

      <PhotoStrip item={item} />
      <StoryTimeline item={item} />

      {item.resolution && (
        <div className="res-block">
          <b>{item.resolution.outcome}</b> — {item.resolution.note}
          <div className="res-meta">Closed by {item.resolution.by} · {item.resolution.when}</div>
        </div>
      )}

      {item.state !== 'resolved' && (
        <>
          <div className="note-box">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void submitNote() }}
              placeholder="Add a note — only your team sees this"
            />
            {/* The button WAKES only when there is something to add. */}
            <Btn variant="primary" className="addbtn" disabled={!note.trim()} onClick={submitNote}>Add</Btn>
          </div>
          {item.guide && <div className="guide" dangerouslySetInnerHTML={{ __html: item.guide }} />}
          {!isTouch && item.person.phone && (
            <div className="contact-hint">{item.person.name} · {item.person.phone}</div>
          )}
        </>
      )}
    </>
  )
}

/** The pinned bar: contextual primary + the fixed ✓ Close pill. */
export function DetailBar({
  item, isTouch, mode, setMode, onPrimary, onConfirmClose, onSend,
}: {
  item: DeskProblem
  isTouch: boolean
  mode: Mode
  setMode: (m: Mode) => void
  onPrimary: (act: 'call' | 'approve' | 'nudge' | 'reopen') => void | Promise<unknown>
  onConfirmClose: (outcome: Outcome, note: string) => void
  onSend: (text: string) => void
}) {
  if (mode.k === 'resolve') {
    return <ResolveForm item={item} onConfirm={onConfirmClose} onBack={() => setMode({ k: 'view' })} />
  }
  if (mode.k === 'compose') {
    return <Composer item={item} onSend={onSend} onBack={() => setMode({ k: 'view' })} />
  }

  if (item.state === 'resolved') {
    return (
      <Btn variant="quiet" className="flex1" loadingLabel="Reopening" successLabel="Reopened" onClick={() => onPrimary('reopen')}>
        Reopen {item.ref}
      </Btn>
    )
  }

  // The contextual primary — mobile calls, desktop composes.
  const primary =
    item.approve ? { label: item.approve, run: () => onPrimary('approve') }
      : item.verify ? { label: 'Confirm & close', run: () => setMode({ k: 'resolve' }) }
        : item.state === 'chasing' ? { label: 'Ask again now', run: () => onPrimary('nudge') }
          : isTouch && item.person.phone ? { label: `Call ${item.person.name}`, run: () => onPrimary('call') }
            : { label: `WhatsApp ${item.person.name}`, run: () => setMode({ k: 'compose' }) }

  return (
    <div className="d-bar-row">
      <Btn variant="primary" className="flex1" loadingLabel="Working" successLabel="Done" onClick={primary.run}>
        {primary.label}
      </Btn>
      <button className="abtn closer" onClick={() => setMode({ k: 'resolve' })}>
        <span className="layer rest"><span className="tick">✓</span> Close</span>
      </button>
    </div>
  )
}

export type { Mode }
