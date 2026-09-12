// SITE DESK — THE TASK CARD. Ported from task-detail-redesign.html, exactly.
//
// THE SHEET ANSWERS ONE QUESTION PER STATE. That is the whole idea, and everything else follows:
//
//   Not started  "what IS this, and what is it waiting for?"
//                → the dependency lives in the status sentence, ONCE.
//                → THE BRIEF: three plain lines — what the job is, what goes wrong, when it's really
//                  done. This used to be the QC list shown read-only, headed "What good looks like",
//                  which answered a question nobody had yet: a checklist is for grading work, and no
//                  work has happened. A man about to start needs to know what he is starting.
//                → there is no story yet, so there is no Story section.
//                → the action is one word: Start.
//
//   In progress  "is it being done RIGHT?"
//                → THIS is QC's moment: the checks appear and are tickable. The brief steps aside —
//                  it has done its job. The story appears, because now there is something to say.
//                → the cursor lands in the note box the moment you hit Start (see focus-on-start
//                  below): the first thing you do after starting a job is say you've started it.
//                → the action names what is left: "Mark done · 2 checks left".
//
//   Done         "what is on the record?"
//                → the checks become the record. The ref pill and the segmented thumb turn green.
//                → there is nothing left to do, so the button stops being a button: "In the record ✓".
//
// Sections do not appear and disappear — they GROW (grid-template-rows 0fr → 1fr), so the card
// changes shape instead of flickering.

import { useEffect, useRef, useState } from 'react'
import type { DeskProblem, DeskTask, QcStatus, TaskState } from '../../lib/desk/types'
import type { TaskEdit } from '../../lib/desk/api'
import type { RenameScope } from '../../lib/desk/edit'
import { taskStatus } from '../../lib/desk/derive'
import { briefOf } from '../../lib/siteOps/engine'
import { StoryPhoto } from './Detail'
import { Check } from './icons'

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '—'

// THE LANGUAGE THE BRIEF IS READ IN. Telugu by default — this is written for the man on the site, and
// that is the language he thinks in. English is the fallback, one tap away.
//
// Scoped to the brief ON PURPOSE. This is not app localisation and must not pretend to be: everything
// else on this card is still English, and a global-looking language switch would promise otherwise.
type BriefLang = 'te' | 'en'
const LANG_KEY = 'briklay.briefLang'
const LANG_NAME: Record<BriefLang, string> = { te: 'తెలుగు', en: 'English' }

function useBriefLang(): [BriefLang, () => void] {
  const [lang, setLang] = useState<BriefLang>(() => {
    try { return localStorage.getItem(LANG_KEY) === 'en' ? 'en' : 'te' } catch { return 'te' }
  })
  const toggle = () => setLang((l) => {
    const next: BriefLang = l === 'te' ? 'en' : 'te'
    try { localStorage.setItem(LANG_KEY, next) } catch { /* private mode — the choice just won't stick */ }
    return next
  })
  return [lang, toggle]
}

/**
 * THE BRIEF — what this task IS, why it matters, and when it is done.
 *
 * Authored per task-type in the engine (engine/briefs.ts), never generated at read time: text that is
 * conjured when a screen happens to open is text that exists only sometimes and reads differently
 * every time. A task with no engine type (someone typed it in by hand) has no brief, and this renders
 * nothing — an honest gap beats an invented one.
 */
function Brief({
  taskTypeId, desc, editing, autoFocus, onCaret, value, onChange, onEdit, onCommit, onCancel,
}: {
  taskTypeId?: string | null
  /** The site's own words about THIS task. When it exists, it is what the section shows. */
  desc?: string | null
  editing: boolean
  autoFocus: boolean
  onCaret: (e: { currentTarget: HTMLTextAreaElement }) => void
  value: string
  onChange: (s: string) => void
  /** Click the words → the cursor lands in them. Undefined when there is no write path. */
  onEdit?: () => void
  onCommit: () => void
  onCancel: () => void
}) {
  const [lang, toggle] = useBriefLang()
  const points = briefOf(taskTypeId, lang)

  // A hand-typed task has no authored brief and no note yet: there is nothing to show and nothing to
  // click. It gets the section only once it is being written, or once it has been.
  if (!points && !desc && !editing) return null

  return (
    <div className={`brief ${editing ? 'editing' : ''}`}>
      <div className="bhead">
        <span className="t">Task description and scope</span>
        {points && !editing && (
          <button
            className="blang"
            onClick={toggle}
            title={`Read in ${LANG_NAME[lang === 'te' ? 'en' : 'te']}`}
            aria-label={`Read in ${LANG_NAME[lang === 'te' ? 'en' : 'te']}`}
          >
            {lang === 'te' ? 'అ' : 'A'}
          </button>
        )}
      </div>

      {/* THE STANDARD DESCRIPTION STAYS. It is authored per task-TYPE and is the same on every site,
          which is exactly what makes it worth having — so a site's own words are added BESIDE it, not
          on top of it. Nobody's twenty years of authored guidance gets deleted by a typo. */}
      {points && (
        <ol className={`bpoints ${lang}`}>
          {points.map((p, i) => <li key={i}>{p}</li>)}
        </ol>
      )}

      {editing
        ? (
          <textarea
            className="t-desc-in" rows={3} value={value}
            autoFocus={autoFocus} onFocus={onCaret}
            aria-label="What this task covers on this site"
            placeholder="Anything specific about THIS one — what the standard description doesn’t say."
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onCancel()
              // Enter makes a new line here — this is prose. Cmd/Ctrl+Enter saves.
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onCommit()
            }}
          />
        )
        : desc
          ? (
            <p
              className={`b-own ${onEdit ? 'editable' : ''}`}
              onClick={onEdit}
              title={onEdit ? 'Click to edit' : undefined}
            >
              {desc}
            </p>
          )
          : onEdit && (
            <button className="b-add" onClick={onEdit}>+ Add what this one covers on this site</button>
          )}
    </div>
  )
}

/**
 * EDITING HAPPENS IN THE CARD, NOT OVER IT.
 *
 * This was a modal, opened from the row's ⋯. It was wrong twice: the card is already the place you
 * come to when you want to know about a task, so it is the place you should be able to CHANGE it —
 * and a dialog stacked over the list hides the very sequence you are editing inside of. The name
 * becomes a field in place; nothing is covered; you can still see what the task waits for while you
 * rename it. The ⋯ keeps only the two acts that are not edits at all: delete, and move.
 *
 * The rename SCOPE is the one thing that needs explaining, and it appears only when it is a live
 * question — i.e. only once the name has actually changed and the type has more than one row. The
 * name is what the WhatsApp resolver matches an inbound report against, so renaming one instance of
 * a type splits that type in two as far as the model is concerned (see lib/desk/edit.ts).
 */
/** Idle · saving · saved. The button is the only place this is ever said, and it says it about itself. */
type SaveState = 'idle' | 'saving' | 'saved'

/**
 * ONE EDIT SESSION FOR THE WHOLE CARD.
 *
 * There is no separate edit form any more, and no second Save at the bottom of one. The fields ARE
 * the card: the heading becomes a heading you can type in, the description becomes a description you
 * can type in, and they sit exactly where they sat a moment ago, at the same size, in the same place.
 * You click the words you want to change and the cursor is in them — which is the whole of what an
 * edit should be, and is what a form standing in front of the thing it edits can never do.
 *
 * The Save button lives at the TOP, next to Edit, because that is where the session began and it is
 * the one control that governs all of it. It reports on itself — Save · Saving… · Saved ✓ — so the
 * write is never a thing you have to guess about.
 */
function useTaskEdit(t: DeskTask, allTasks: DeskTask[], onEdit?: (p: TaskEdit) => Promise<void>) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(t.title)
  const [desc, setDesc] = useState(t.desc ?? '')
  const [scope, setScope] = useState<RenameScope>('type')
  const [save, setSave] = useState<SaveState>('idle')
  /** Which field he clicked — the one the cursor belongs in. Both fields MOUNT when the session opens,
   *  so autoFocus is all it takes, and no refs have to be reached into during a render. */
  const [focus, setFocus] = useState<'name' | 'desc'>('name')

  const kin = t.taskTypeId ? allTasks.filter((x) => x.taskTypeId === t.taskTypeId) : [t]
  const renamed = !!name.trim() && name.trim() !== t.title.trim()
  const canScope = renamed && kin.length > 1 && !!t.taskTypeId
  const dirty = renamed || desc.trim() !== (t.desc ?? '').trim()

  /** Enter the session with the cursor IN the thing he clicked. */
  const begin = (field: 'name' | 'desc') => {
    if (!onEdit) return
    setFocus(field)
    setSave('idle')
    setEditing(true)
  }

  /** The caret lands at the END of what is already there, never on top of it. */
  const caretToEnd = (e: { currentTarget: HTMLInputElement | HTMLTextAreaElement }) => {
    const el = e.currentTarget
    el.setSelectionRange(el.value.length, el.value.length)
  }

  const cancel = () => {
    setName(t.title)
    setDesc(t.desc ?? '')
    setSave('idle')
    setEditing(false)
  }

  const commit = async () => {
    if (!onEdit || !name.trim() || save === 'saving') return
    if (!dirty) { setEditing(false); return }
    setSave('saving')
    try {
      await onEdit({
        ...(renamed ? { name: name.trim(), renameScope: canScope ? scope : 'row' } : {}),
        ...(desc.trim() !== (t.desc ?? '').trim() ? { desc: desc.trim() || null } : {}),
      })
      // SAY IT LANDED. Then step out of the way — the card is for reading, and it goes back to being
      // one the moment there is nothing left to save.
      setSave('saved')
      window.setTimeout(() => { setSave('idle'); setEditing(false) }, 900)
    } catch {
      setSave('idle')   // the toast carries the failure; the button must not claim a write that failed
    }
  }

  return {
    editing, name, setName, desc, setDesc, scope, setScope, save, dirty, canScope, kin,
    focus, caretToEnd, begin, cancel, commit,
  }
}

export function TaskSheetBody({
  task: t, problems, allTasks, members,
  onOpen, onRef, onDur, onNote, onQc, onAssign, onEdit, note, setNote,
}: {
  task: DeskTask
  problems: DeskProblem[]
  allTasks: DeskTask[]
  members: Array<{ id: string; name: string }>
  onOpen: (ref: string) => void
  onRef: (ref: string) => void
  onState: (s: TaskState) => Promise<void>
  onDur: (d: number) => void
  onNote: () => Promise<void>
  onQc: (qcId: string, status: QcStatus) => Promise<void>
  onAssign: (userId: string | null) => void
  /** Rename it / say what it covers. Undefined = no write path (the mock with no plan), no Edit button. */
  onEdit?: (patch: TaskEdit) => Promise<void>
  note: string
  setNote: (s: string) => void
}) {
  const ed = useTaskEdit(t, allTasks, onEdit)
  const byRef = (r: string) => allTasks.find((x) => x.ref === r)
  const st = taskStatus(t, problems, byRef)

  // Every unmet gate, not just the first — the sheet is where he comes to ask "why can't I start?".
  const deps = (st.cls === 'after' ? st.waiting : [])
    .map((r) => byRef(r))
    .filter((d): d is DeskTask => !!d)

  const qc = t.qc ?? []
  const confirmed = qc.filter((c) => c.status === 'confirmed').length
  const left = qc.length - confirmed
  const days = parseInt(t.dur, 10) || 1
  const over = t.started ? t.started - days : 0
  const notStarted = t.state === 'todo'
  const hasBrief = !!briefOf(t.taskTypeId, 'te')
  const story = t.story ?? []

  // FOCUS ON START — the moment a task goes in-progress, the cursor lands in the note box. Only on a
  // TRANSITION, never on mount (opening an already-active task must not steal the cursor).
  const noteRef = useRef<HTMLInputElement>(null)
  const prevState = useRef<TaskState | null>(null)
  useEffect(() => {
    const became = prevState.current !== null && prevState.current !== 'active' && t.state === 'active'
    prevState.current = t.state
    if (!became) return
    const id = window.setTimeout(() => {
      const el = noteRef.current
      if (!el) return
      el.focus({ preventScroll: true })
      const box = el.closest('.d-scroll') as HTMLElement | null
      if (!box) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
      const r = el.getBoundingClientRect(); const c = box.getBoundingClientRect()
      box.scrollBy({ top: (r.top - c.top) - (c.height - r.height) / 2, behavior: 'smooth' })
    }, 260)
    return () => window.clearTimeout(id)
  }, [t.state])

  // ── the status SENTENCE (no segmented control) ──
  let dotCls = 'wait'
  let statusNode: React.ReactNode
  if (t.state === 'done') {
    dotCls = 'live'
    statusNode = <><em>Done</em>{t.doneW ? ` · ${t.doneW}` : ''}</>
  } else if (t.state === 'active') {
    dotCls = 'live'
    const dayPhrase = t.started
      ? (over > 0
          ? `running for ${t.started} days · ${over} day${over > 1 ? 's' : ''} over the ${days}-day plan`
          : (t.started === 1 ? '1st day of work' : `running for ${t.started} days`))
      : null
    statusNode = <><em>In progress</em>{dayPhrase ? ` · ${dayPhrase}` : ''} · {t.assignee && t.assignee !== 'Unassigned' ? t.assignee : 'nobody assigned'}</>
  } else if (st.cls === 'blocked') {
    statusNode = <>Waits on <a onClick={() => onRef(st.ref)}>{st.ref}</a> — can’t start until it’s done</>
  } else if (st.cls === 'after' && deps.length > 0) {
    statusNode = <>Waits on {deps.map((d, i) => (
      <span key={d.ref}>{i > 0 && (i === deps.length - 1 ? ' and ' : ', ')}<a onClick={() => onOpen(d.ref)}>{d.title}</a></span>
    ))}, in progress now</>
  } else if (st.cls === 'unknown') {
    statusNode = <>Can’t confirm this is ready — {st.missing.join(', ')} {st.missing.length > 1 ? 'are' : 'is'} not in this project’s task list</>
  } else {
    statusNode = <>Ready to start</>
  }

  // one feed row, styled by who spoke
  const feedRow = (s: NonNullable<DeskTask['story']>[number], i: number): React.ReactNode => {
    if (s.t === 'photo') {
      return (
        <div className="tpk-ev" key={i}>
          <div className="tpk-who ai" aria-hidden>📷</div>
          <div className="tpk-evbody">
            <div className="tpk-l1"><b>From the site</b>{s.w ? <span className="tpk-t">{s.w}</span> : null}</div>
            <div className="tpk-photos"><StoryPhoto step={s} /></div>
            {s.caption ? <div className="tpk-msg wa" style={{ marginTop: 7 }}>{s.caption}</div> : null}
          </div>
        </div>
      )
    }
    if (s.t === 'msg') {
      return (
        <div className="tpk-ev" key={i}>
          <div className="tpk-who person">{initials(s.from)}</div>
          <div className="tpk-evbody">
            <div className="tpk-l1"><b>{s.from}</b> <span>on WhatsApp</span>{s.w ? <span className="tpk-t">{s.w}</span> : null}</div>
            <div className="tpk-msg wa">{s.text}</div>
          </div>
        </div>
      )
    }
    if (s.t === 'note') {
      return (
        <div className="tpk-ev" key={i}>
          <div className="tpk-who you">C</div>
          <div className="tpk-evbody">
            <div className="tpk-l1"><b>You</b> <span>note</span>{s.w ? <span className="tpk-t">{s.w}</span> : null}</div>
            <div className="tpk-sys">{s.text}</div>
          </div>
        </div>
      )
    }
    // event | miss | next | resolve → Babai / the system
    return (
      <div className="tpk-ev" key={i}>
        <div className="tpk-who ai">B</div>
        <div className="tpk-evbody">
          <div className="tpk-l1"><b>Babai</b>{s.w ? <span className="tpk-t">{s.w}</span> : null}</div>
          <div className="tpk-sys">{s.l}</div>
        </div>
      </div>
    )
  }

  return (
    <div className={`tpk s-${t.state}`}>
      {/* ── top: identity, title, the status sentence, meta, folded scope ── */}
      <div className="tpk-top">
        <div className="tpk-idrow">
          <span className="tpk-chip">{t.ref}</span>
          <span className="tpk-kind">{t.group}{t.trade ? ` · ${t.trade}` : ''}</span>
          {onEdit && (ed.editing
            ? (
              <span className="tpk-editbar">
                <button className="tpk-cancel" onClick={ed.cancel} disabled={ed.save === 'saving'}>Cancel</button>
                <button
                  className={`tpk-save ${ed.save}`}
                  onClick={() => void ed.commit()}
                  disabled={!ed.name.trim() || ed.save === 'saving' || (ed.save === 'idle' && !ed.dirty)}
                >{ed.save === 'saving' ? 'Saving…' : ed.save === 'saved' ? 'Saved ✓' : 'Save'}</button>
              </span>
            )
            : <button className="tpk-edit" onClick={() => ed.begin('name')}>Edit</button>)}
        </div>

        {ed.editing
          ? (
            <>
              <input
                className="tpk-title-in" value={ed.name} aria-label="Task name"
                autoFocus={ed.focus === 'name'} onFocus={ed.caretToEnd}
                onChange={(e) => ed.setName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') void ed.commit(); if (e.key === 'Escape') ed.cancel() }}
              />
              {ed.canScope && (
                <div className="tpk-scope-pick">
                  {([['type', `Rename all ${ed.kin.length} of these on the site`], ['row', 'Rename only this one']] as const).map(([k, label]) => (
                    <label key={k} className={`tpk-opt ${ed.scope === k ? 'on' : ''}`}>
                      <input type="radio" name="rename-scope" checked={ed.scope === k} onChange={() => ed.setScope(k)} />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
              )}
            </>
          )
          : <h2 className={`tpk-title ${onEdit ? 'editable' : ''}`} onClick={() => onEdit && ed.begin('name')}>{t.title}</h2>}

        <div className="tpk-status">
          <span className={`tpk-dot ${dotCls}`} aria-hidden />
          <span>{statusNode}</span>
        </div>

        <div className="tpk-meta">
          <label className="tpk-with">
            <span>With <b>{t.assignee && t.assignee !== 'Unassigned' ? t.assignee : 'nobody yet'}</b></span>
            <select className="tpk-pick" aria-label="Assignee" value={t.ownerId ?? ''} onChange={(e) => onAssign(e.target.value || null)}>
              <option value="">Unassigned</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </label>
          <span className="tpk-takes">
            Takes <b>{days} {days === 1 ? 'day' : 'days'}</b>
            <span className="tpk-stepper"><button onClick={() => onDur(-1)} aria-label="Shorter">−</button><button onClick={() => onDur(1)} aria-label="Longer">+</button></span>
          </span>
        </div>

        {(hasBrief || t.desc || ed.editing) && (
          <details className="tpk-scope">
            <summary><span className="tri">▶</span> What this task covers</summary>
            <div className="tpk-scope-body">
              <Brief
                taskTypeId={t.taskTypeId}
                desc={t.desc}
                editing={ed.editing}
                autoFocus={ed.focus === 'desc'}
                onCaret={ed.caretToEnd}
                value={ed.desc}
                onChange={ed.setDesc}
                onEdit={onEdit ? () => ed.begin('desc') : undefined}
                onCommit={() => void ed.commit()}
                onCancel={ed.cancel}
              />
            </div>
          </details>
        )}
      </div>

      {/* ── the feed: the spine ── */}
      <div className="tpk-feed">
        <div className="tpk-feedhead">FROM THE SITE</div>
        {story.length === 0
          ? (
            <div className="tpk-empty">
              <p>Nothing yet.</p>
              <p>When the site reports on this task over WhatsApp, it lands here.</p>
            </div>
          )
          : story.map((s, i) => feedRow(s, i))}
      </div>

      {/* ── note compose ── */}
      <div className="tpk-compose">
        <input
          ref={noteRef}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void onNote() }}
          placeholder={t.state === 'active' && story.length === 0 ? 'Started — what are you doing first?' : 'Add a note…'}
        />
        <button onClick={() => void onNote()}>Save</button>
      </div>

      {/* ── checks: from in-progress onwards, they gate the button ── */}
      {qc.length > 0 && !notStarted && (
        <div className="tpk-checks">
          <div className="tpk-checks-head">
            <b>Before it’s done</b>
            <span>{left === 0 ? 'All confirmed' : `${left} to confirm`}</span>
          </div>
          {qc.map((c) => (
            <div key={c.id} className={`tpk-check ${c.status === 'confirmed' ? 'pass' : ''} ${c.status === 'failed' ? 'fail' : ''}`}>
              <div
                className="tpk-box"
                role="button"
                tabIndex={0}
                title="Passed"
                onClick={() => void onQc(c.id, c.status === 'confirmed' ? 'pending' : 'confirmed')}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); void onQc(c.id, c.status === 'confirmed' ? 'pending' : 'confirmed') } }}
              >{Check}</div>
              <div className="tpk-txt">{c.critical && <span className="tpk-crit" title="Critical check" />}{c.question}{c.answer && <span className="tpk-a">{c.answer}</span>}</div>
              <div className="tpk-flag" onClick={() => void onQc(c.id, c.status === 'failed' ? 'pending' : 'failed')}>{c.status === 'failed' ? 'Failed' : 'Flag'}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** ONE ACTION — driven by state + the checks, which gate Done. On Done it stops being a button. */
export function TaskSheetBar({
  task: t, onState, onReopen,
}: {
  task: DeskTask
  onState: (s: TaskState) => Promise<void>
  onReopen: () => void
}) {
  const qc = t.qc ?? []
  const left = qc.filter((c) => c.status !== 'confirmed').length
  const failed = qc.some((c) => c.status === 'failed')
  const [swap, setSwap] = useState(false)
  const go = (s: TaskState) => { setSwap(true); void onState(s).finally(() => setTimeout(() => setSwap(false), 180)) }

  // Start is NEVER blocked — any task can be started regardless of its predecessors (the site decides
  // the order; the plan just records what actually happened). Starting shifts the bar to today.
  if (t.state === 'todo') {
    return <button className={`tpk-cta primary ${swap ? 'swap' : ''}`} onClick={() => go('active')}>Start</button>
  }

  if (t.state === 'active') {
    if (failed) {
      return <button className="tpk-cta blocked" disabled>Mark done<span className="sub">· a check failed — sort it on site first</span></button>
    }
    if (left > 0) {
      return <button className="tpk-cta" disabled>Mark done<span className="sub">· {left} check{left > 1 ? 's' : ''} left</span></button>
    }
    return <button className={`tpk-cta primary ${swap ? 'swap' : ''}`} onClick={() => go('done')}>Mark done</button>
  }

  return (
    <div className="tpk-cta-row">
      <div className="tpk-cta record">Done{t.doneW ? <span className="sub">· {t.doneW}</span> : null}</div>
      <button className="tpk-reopen" onClick={onReopen}>Reopen</button>
    </div>
  )
}
