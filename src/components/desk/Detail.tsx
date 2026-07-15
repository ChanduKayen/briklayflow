// SITE DESK — the item detail: StoryTimeline, PhotoStrip, ResolveForm, Composer.
//
// ONE content tree, two frames: a bottom sheet below 920px, a sticky panel above. The action
// bar is PINNED in both — the primary action and ✓ Close never scroll away, because the close
// must be reachable from anywhere in a long story.

import { useState } from 'react'
import type { Chase, DeskProblem, DeskTask, Outcome, StoryStep } from '../../lib/desk/types'
import { OUTCOMES } from '../../lib/desk/types'
import { canClose } from '../../lib/desk/derive'
import { Btn } from './Btn'

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '—'

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

/* ══ THE CHASE BLOCK — why this is sitting where it is ═══════════════════════════════════════════════
 *
 * The card could always say WHAT the problem was and WHEN things happened to it. It could never answer the
 * question a founder actually opens it to ask: why has this ended up on MY desk?
 *
 * Three lines answer it — where the ball is, what went wrong, and who it passed through to get here.
 *
 * THE PATH IS THE POINT. A red line saying "waiting on you" is an accusation with no story. The path shows
 * the chain of people who tried, so the reader arrives already knowing what has been done and what is left.
 * Hops we cannot vouch for are not drawn (buildChase) — never an "Unknown", never a guess.
 *
 * The TONE is the rail's colour, and it is honest in all three states: red when it is genuinely stuck on
 * you, amber while Briklay is still chasing, green once somebody has accepted it. Red only ever means the
 * one thing, so it never stops meaning it. */
export function ChaseBlock({ chase }: { chase: Chase }) {
  return (
    <div className={`chase-block is-${chase.tone}`}>
      <div className="cb-since">{chase.since}</div>
      <div className="cb-why">{chase.why}</div>
      {chase.path.length > 0 && (
        <div className="cb-path">
          {chase.path.map((h, i) => (
            <span key={i}>
              {i > 0 && <span className="cb-arrow">→</span>}
              <span className={h.live ? 'cb-live' : ''}>{h.name}</span>
              {h.note && <span className="cb-note">· {h.note}</span>}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- StoryTimeline: ONE rail. Events, replies, photos, notes — in the order they happened ----------
 *
 * It used to be four different visual languages stacked on top of each other: grey step lines, WhatsApp
 * bubbles, a floating photo strip that had escaped time entirely, and notes in a fifth style. Reading it
 * meant re-learning the layout at every entry.
 *
 * Now there is one rail and one rule: every entry is a dot on it, at the moment it happened, with its time
 * on the right. What DIFFERS between them is what the entry contains — a line of text, somebody's words, a
 * photograph — and that is the only thing that should differ, because it is the only thing that IS different.
 *
 * A `miss` (the escalation) is the one entry that earns colour. It is the moment the machine ran out of
 * people to ask, which is precisely the moment the item became yours. */
export function StoryTimeline({ item, children }: { item: DeskProblem; children?: React.ReactNode }) {
  return (
    <div className="rail">
      {item.story.map((s, i) => {
        if (s.t === 'photo') {
          return (
            <div className="entry is-photo" key={i}>
              <StoryPhoto step={s} />
              {s.w && <div className="when">{s.w}</div>}
            </div>
          )
        }
        if (s.t === 'msg') {
          return (
            <div className="entry is-said" key={i}>
              <div className="said-field">
                <div className="lbl">{s.from} · WhatsApp</div>
                <div className="txt">{s.text}</div>
              </div>
              {s.w && <div className="when">{s.w}</div>}
            </div>
          )
        }
        if (s.t === 'note') {
          return (
            <div className="entry is-note" key={i}>
              <div className="said-field">
                <div className="lbl">Your note</div>
                <div className="txt">{s.text}</div>
              </div>
              {s.w && <div className="when">{s.w}</div>}
            </div>
          )
        }
        return (
          <div className={`entry${s.t === 'miss' ? ' is-miss' : ''}${s.t === 'next' ? ' is-next' : ''}`} key={i}>
            <div className="txt">{s.l}</div>
            {s.w && <div className="when">{s.w}</div>}
          </div>
        )
      })}
      {/* THE COMPOSER IS THE LAST ENTRY, not a box bolted under the card. Adding a note is the next thing
          that happens in the story, so it sits where the next thing goes — with an open, dashed dot waiting
          to be filled in. */}
      {children}
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
        <div className="ph pending">📷<span>No photo yet<br />Briklay is asking</span></div>
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
              ? 'Briklay pre-filled this from the evidence — edit if needed.'
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
        {/* celebrate: sending a message to the site IS finishing real work — it earns the one bloom
            (a rationed green exhale), not just a label flip. Sending → Sent → a soft celebration. */}
        <Btn variant="primary" className="flex1" loadingLabel="Sending" successLabel="Sent" celebrate onClick={() => onSend(text)}>
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
  item, tasks, isTouch, onNote, members, onAssign,
}: {
  item: DeskProblem
  tasks: DeskTask[]
  isTouch: boolean
  onNote: (text: string) => Promise<void>
  /** Everyone this item can be handed to (org members). */
  members: Array<{ id: string; name: string }>
  /** Reassign the item's owner. The live path re-notifies the new assignee on WhatsApp. */
  onAssign: (userId: string | null) => void
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

  // The state, in the words the eyebrow uses. Only ONE of them is coloured — the one that means "nobody
  // else is going to do this".
  const stateWord =
    item.state === 'resolved' ? 'Sorted'
      : item.state === 'you' ? 'Waiting on you'
        : item.state === 'chasing' ? 'Briklay is on it'
          : 'On track'

  const age = item.state === 'resolved' ? 'closed'
    : item.days === 0 ? 'raised today'
      : `${item.days} ${item.days === 1 ? 'day' : 'days'}`

  return (
    <>
      {/* ══ THE HEADER ═════════════════════════════════════════════════════════════════════════════
          Four facts, all mono, all small, on one line — the ref, what it is, where it stands, how old.
          They are META, and meta is set in mono at the top of the card so the eye can skip it in one
          movement and land on the title, which is the only thing here written by a human. */}
      <div className={`pc-meta ${item.state === 'resolved' ? 'is-sorted' : ''}`}>
        <span className="ref-big">{item.ref}</span>
        <span className="m">{item.kind === 'snag' ? 'Snag' : 'Issue'}</span>
        <span className={`m ${item.state === 'you' ? 'is-you' : ''}`}>{stateWord}</span>
        <span className="m">{age}</span>
      </div>

      {/* The title is the one line somebody actually wrote. It gets the serif, and it gets room. */}
      <h2 className="pc-title">{item.title}</h2>
      <div className="pc-context">
        {item.site}{item.kind === 'snag' ? ` · ${item.loc ?? 'Project-wide'}` : ` · ${item.tag}`}
      </div>

      {item.chase && <ChaseBlock chase={item.chase} />}

      {/* ══ ASSIGNED TO — who holds it, WHY, and the one control that changes both ═══════════════════
          The chase block above says who the ball is with; this says who OWNS it and lets you hand it
          to someone else. Reassigning re-notifies the new person on WhatsApp (siteops-notify-assignment),
          so the hand-off is real, not just a label change. The subtext is the honest provenance — the
          "no supervisor on this site" case is exactly why an item can sit silent, so we name it. */}
      {item.state !== 'resolved' && (
        <div className="props assign-block">
          <label className="prop">
            <span className="k">Assigned to</span>
            <span className="v">
              <span className="avatar">{initials(item.person.name || '—')}</span>
              {item.person.name || 'Unassigned'}
            </span>
            <select
              className="prop-pick"
              aria-label="Reassign this item"
              value={item.ownerId ?? ''}
              onChange={(e) => onAssign(e.target.value || null)}
            >
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </label>
          {item.assignReason && <div className="assign-why">{item.assignReason}</div>}
        </div>
      )}

      {/* What this problem is holding up, over in the Work Plan. */}
      {holding.length > 0 && item.state !== 'resolved' && (
        <div className="d-holding">
          Holding up: {holding.map((t) => `${t.ref} ${t.title}`).join(' · ')} in the Work Plan
        </div>
      )}

      {/* Only the photos with no timestamp are left here — everything datable is on the rail, in its
          place in the sequence. Plus the honest "no photo yet" state. */}
      <PhotoStrip item={item} />

      <div className="rail-head">Activity</div>
      <StoryTimeline item={item}>
        {item.state !== 'resolved' && (
          <div className="entry is-compose">
            <div className="compose-row">
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void submitNote() }}
                placeholder="Add a note — only your team sees this"
              />
              {/* The button WAKES only when there is something to add. */}
              <Btn variant="primary" className="addbtn" disabled={!note.trim()} onClick={submitNote}>Add</Btn>
            </div>
          </div>
        )}
      </StoryTimeline>

      {item.resolution && (
        <div className="res-block">
          <b>{item.resolution.outcome}</b> — {item.resolution.note}
          <div className="res-meta">Closed by {item.resolution.by} · {item.resolution.when}</div>
        </div>
      )}

      {item.state !== 'resolved' && (
        <>
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
