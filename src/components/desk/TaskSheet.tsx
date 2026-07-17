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
import { Seg } from './Seg'

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
  onOpen, onRef, onState, onDur, onNote, onQc, onAssign, onEdit, note, setNote,
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

  // "Why can't I start this?" — answered with EVERY gate still standing, not just the first.
  // The row stays silent about dependencies (that is the sequence quietly doing its job); the sheet
  // is where he comes to ask, so the sheet owes him the whole answer. It used to show one.
  const deps = (st.cls === 'after' ? st.waiting : [])
    .map((r) => byRef(r))
    .filter((d): d is DeskTask => !!d)
  const qc = t.qc ?? []
  const confirmed = qc.filter((c) => c.status === 'confirmed').length
  const allPassed = qc.length > 0 && confirmed === qc.length
  const days = parseInt(t.dur, 10) || 1
  const over = t.started ? t.started - days : 0

  // Not started → the BRIEF. You cannot grade work that has not happened, so the checks stay away
  // until there is work to grade; what a man needs before he starts is what the job IS.
  const notStarted = t.state === 'todo'
  const [openQc, setOpenQc] = useState(false)
  const qcOpen = t.state === 'active' ? true : (openQc || !allPassed)

  /* THE HEADER FROSTS ONCE YOU SCROLL PAST IT.
   *
   * Who this task is and — the reason it stays — the ONE control that changes its state are welded to
   * the top of the card. At rest the header IS the paper: no glass, nothing to explain. The moment the
   * brief and the story slide up beneath it, it lifts onto frosted glass with a hairline under it,
   * because now it is a layer above the page and has to say so — and the state is reachable from
   * anywhere in a long story, not just the top of it. (rAF-throttled: the card's own scroll must never
   * be the thing that stutters.) */
  const headRef = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  useEffect(() => {
    const box = headRef.current?.closest('.d-scroll') as HTMLElement | null
    if (!box) return
    let queued = false
    const onScroll = () => {
      if (queued) return
      queued = true
      requestAnimationFrame(() => { queued = false; setStuck(box.scrollTop > 4) })
    }
    onScroll()
    box.addEventListener('scroll', onScroll, { passive: true })
    return () => box.removeEventListener('scroll', onScroll)
  }, [t.ref])

  // FOCUS ON START. The moment a task goes in-progress — from Not started, or reopened from Done —
  // the cursor lands in the note box. Starting a job and saying you've started it are one motion.
  //
  // Only on a TRANSITION, never on mount: opening a task that is already active must not steal the
  // cursor, and neither must a WhatsApp update flipping the status while someone is mid-sentence here.
  const noteRef = useRef<HTMLInputElement>(null)
  const prevState = useRef<TaskState | null>(null)
  useEffect(() => {
    const became = prevState.current !== null && prevState.current !== 'active' && t.state === 'active'
    prevState.current = t.state
    if (!became) return
    // the Story section GROWS (0fr → 1fr) — wait for it to have a height before scrolling to it
    const id = window.setTimeout(() => {
      const el = noteRef.current
      if (!el) return

      // SCROLL THE PANEL, NOT THE PAGE.
      //
      // The detail is its own scroll container (.d-scroll, overflow-y:auto) — on desktop inside a STICKY
      // panel, on mobile inside the sheet. Both of the browser's helpful defaults get this wrong:
      //
      //   focus()            scrolls the element into view its own way, walking up EVERY scrollable
      //                      ancestor — including the window.
      //   scrollIntoView()   does the same, so it centres the box in the VIEWPORT rather than in the panel.
      //
      // So the page lurched under a sticky panel that never moved, and the note box — the whole point of
      // the motion — stayed exactly where it was. Take both jobs away from the browser: focus WITHOUT a
      // scroll, then scroll the container by the exact amount that centres the box inside IT. Nothing else
      // on the screen moves, and the thing that moves is the thing he is about to type into.
      el.focus({ preventScroll: true })
      const box = el.closest('.d-scroll') as HTMLElement | null
      if (!box) { el.scrollIntoView({ block: 'center', behavior: 'smooth' }); return }
      const r = el.getBoundingClientRect()
      const c = box.getBoundingClientRect()
      box.scrollBy({ top: (r.top - c.top) - (c.height - r.height) / 2, behavior: 'smooth' })
    }, 260)
    return () => window.clearTimeout(id)
  }, [t.state])

  return (
    <div className={`tsheet s-${t.state}`}>
      {/* ── the sticky head: identity + the state control, pinned and frosted on scroll ── */}
      <div className={`t-head ${stuck ? 'stuck' : ''}`} ref={headRef}>
      {/* ── identity: one block, one voice ── */}
      <div className="t-eyebrow">
        <span className="t-ref">{t.ref}</span>
        Task · {t.group}{t.floor ? ` · ${t.floor}` : ''}

        {/* THE ONE CONTROL FOR THE WHOLE SESSION, and it reports on itself. */}
        {onEdit && (ed.editing
          ? (
            <span className="t-editbar">
              <button className="t-cancel" onClick={ed.cancel} disabled={ed.save === 'saving'}>Cancel</button>
              <button
                className={`t-save ${ed.save}`}
                onClick={() => void ed.commit()}
                disabled={!ed.name.trim() || ed.save === 'saving' || (ed.save === 'idle' && !ed.dirty)}
              >
                {ed.save === 'saving' ? 'Saving…' : ed.save === 'saved' ? 'Saved ✓' : 'Save'}
              </button>
            </span>
          )
          : <button className="t-edit" onClick={() => ed.begin('name')}>Edit</button>
        )}
      </div>

      {/* THE HEADING IS EDITED WHERE IT STANDS. Same size, same weight, same place — click the words
          and the cursor is in them. Nothing is covered, nothing moves, and the sequence behind the
          card stays where it was, which is exactly what a dialog cannot promise. */}
      {ed.editing
        ? (
          <>
            <input
              className="t-title-in" value={ed.name} aria-label="Task name"
              autoFocus={ed.focus === 'name'} onFocus={ed.caretToEnd}
              onChange={(e) => ed.setName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void ed.commit(); if (e.key === 'Escape') ed.cancel() }}
            />
            {ed.canScope && (
              <div className="t-scope-pick">
                {([
                  ['type', `Rename all ${ed.kin.length} of these on the site`],
                  ['row', 'Rename only this one'],
                ] as const).map(([k, label]) => (
                  <label key={k} className={`t-opt ${ed.scope === k ? 'on' : ''}`}>
                    <input type="radio" name="rename-scope" checked={ed.scope === k} onChange={() => ed.setScope(k)} />
                    <span>{label}</span>
                  </label>
                ))}
                <p className="t-hint">WhatsApp keeps understanding “{t.title}” either way — the old word is remembered.</p>
              </div>
            )}
          </>
        )
        : (
          <h1
            className={`t-title ${onEdit ? 'editable' : ''}`}
            onClick={() => ed.begin('name')}
            title={onEdit ? 'Click to rename' : undefined}
          >
            {t.title}
          </h1>
        )}

      {/* ── the status spine ── */}
      <div className="statwrap">
        <Seg<TaskState>
          ariaLabel="Task status"
          value={t.state}
          finished={t.state === 'done'}
          onChange={(s) => { void onState(s) }}
          options={[
            { value: 'todo', label: 'Not started' },
            { value: 'active', label: 'In progress' },
            { value: 'done', label: 'Done' },
          ]}
        />

        {/* THE DEPENDENCY LIVES HERE, ONCE. Not in a "Comes after" row as well — saying it twice
            is how a card starts feeling like a form. */}
        <div className={`statline ${t.state === 'done' ? 'done' : ''}`}>
          {t.state === 'done' && <>Done ✓{t.doneW ? ` · ${t.doneW}` : ''}</>}

          {t.state === 'active' && (
            <>
              <span className="ldot" aria-hidden="true" />
              {t.assignee} on it
              {/* SAID THE WAY A SITE SAYS IT. Not "day 1 of 1" — the first day of work; not "day 3" —
                  running for three days. "Day 6 of 4" is nonsense anyway; two days over is a fact. */}
              {t.started && (over > 0
                ? <> · <span className="over">running for {t.started} days · {over} day{over > 1 ? 's' : ''} over the {days}-day plan</span></>
                : <> · {t.started === 1 ? '1st day of work' : `running for ${t.started} days`}</>)}
            </>
          )}

          {t.state === 'todo' && st.cls === 'blocked' && (
            <>Blocked by <button className="dep" onClick={() => onRef(st.ref)}>{st.ref}</button></>
          )}
          {t.state === 'todo' && st.cls === 'after' && deps.length > 0 && (
            <>
              Waits for{' '}
              {deps.map((d, i) => (
                <span key={d.ref}>
                  {i > 0 && (i === deps.length - 1 ? ' and ' : ', ')}
                  <button className="dep" onClick={() => onOpen(d.ref)}>{d.ref}</button> {d.title}
                </span>
              ))}
            </>
          )}
          {/* THE PLAN HAS DRIFTED FROM THE BUILDING, and we say so instead of guessing. The work this
              task waits for has no task on this project, so we cannot see whether it is finished — and
              the honest answer to "can I start?" is "I can't tell you", not "yes". */}
          {t.state === 'todo' && st.cls === 'unknown' && (
            <span className="stat-unknown">
              Can’t confirm this is ready — {st.missing.join(', ')} {st.missing.length > 1 ? 'are' : 'is'} not
              in this project’s task list. Regenerate the plan to fix it.
            </span>
          )}
          {t.state === 'todo' && st.cls === 'ready' && <>Ready — can start now</>}
        </div>
      </div>
      </div>{/* /.t-head */}

      {/* ── properties: quiet, editable on approach ── */}
      <div className="props">
        <label className="prop">
          <span className="k">With</span>
          <span className="v">
            <span className="avatar">{initials(t.assignee)}</span>
            {t.assignee}
          </span>
          {/* a real <select>, invisible over the row — native picker, custom skin */}
          <select
            className="prop-pick"
            aria-label="Assignee"
            value={t.ownerId ?? ''}
            onChange={(e) => onAssign(e.target.value || null)}
          >
            <option value="">Unassigned</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
          <svg className="chev" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
            <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
          </svg>
        </label>

        {/* TRADE LIVES ON THE GROUP HEADER NOW, not down here. Every task in a phase is the same
            trade's work, so printing it once per task was printing it twenty times to say one thing
            — and it said it in the one place you only reach AFTER you have already chosen the task. */}

        <div className="prop">
          <span className="k">Takes</span>
          <span className="v">{days} {days === 1 ? 'day' : 'days'}</span>
          {/* the stepper only appears when you approach it */}
          <span className="stepper">
            <button onClick={() => onDur(-1)} aria-label="Shorter">−</button>
            <button onClick={() => onDur(1)} aria-label="Longer">+</button>
          </span>
        </div>
      </div>

      {/* ── the description and scope: what this job IS. Not a checklist — an explanation. ──
          It shows before the work starts (a man about to begin needs to know what he is beginning),
          and it keeps showing WHENEVER the site has written its own words about this one, because a
          note that vanishes the moment the task goes in-progress is a note nobody will ever read. */}
      {(notStarted || ed.editing || t.desc) && (
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
      )}

      {/* Where it is and what trade it is are the BUILDING's facts, not this row's: change a generated
          task's floor and the next reconcile puts it straight back and leaves you a duplicate. A task
          somebody ADDED has no such tie — the engine never placed it and never will. */}
      {ed.editing && (
        <p className="t-hint t-fixed">
          {t.manual
            ? `You added this one — it sits on ${[t.floor, t.unit].filter(Boolean).join(' · ') || 'the whole site'}. Drag it wherever the work belongs.`
            : `${[t.floor, t.unit].filter(Boolean).join(' · ') || 'Site-wide'} · ${t.trade} — where this task sits, and what trade it is, come from the site setup.`}
        </p>
      )}

      {/* ── quality: FROM IN-PROGRESS ONWARDS. Never on a task nobody has touched. ── */}
      {qc.length > 0 && !notStarted && (
        <div className={`qsec ${qcOpen ? 'open' : ''}`}>
          <button className="qhead" onClick={() => setOpenQc((o) => !o)}>
            <span className="t">{t.state === 'done' ? 'Quality' : 'Quality checks'}</span>
            {allPassed
              ? <span className="qpill in">QC passed ✓</span>
              : <span className="n">{confirmed} of {qc.length}</span>}
            <svg className="chevron" width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
              <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" />
            </svg>
          </button>

          {/* A TABLE, NOT A PILE.
           *
           * Every check used to be a row of scattered parts — a box on the left, a sentence, and a
           * ghost "Not right?" that only appeared under the cursor. Three shapes per row, none of
           * them in a column, and the one control that MATTERS was invisible until you hovered it.
           *
           * A quality check has exactly two facts: WHAT was asked, and WHAT the verdict is. So: two
           * columns, hairline-ruled, verdicts stacked in one aligned strip on the right. Pass and
           * fail are both always there, side by side, so calling something wrong is one click and not
           * a discovery — and you can read the whole column top to bottom and see where the site
           * stands without reading a word. */}
          <div className="qbody">
            <div>
              <div className="qtable" role="table">
                <div className="qt-head" role="row">
                  <span role="columnheader">Check</span>
                  <span role="columnheader">Verdict</span>
                </div>

                {qc.map((c) => (
                  <div
                    key={c.id}
                    role="row"
                    className={`qr ${c.status === 'confirmed' ? 'ok' : ''} ${c.status === 'failed' ? 'bad' : ''}`}
                  >
                    <span className="qr-q" role="cell">
                      {c.critical && <span className="crit" title="Critical check" />}
                      {c.question}
                      {c.answer && <span className="qr-a">{c.answer}</span>}
                    </span>

                    <span className="qr-v" role="cell">
                      {/* the two verdicts sit together — one is not hidden behind the other */}
                      <button
                        className={`qv ok ${c.status === 'confirmed' ? 'on' : ''}`}
                        aria-pressed={c.status === 'confirmed'}
                        title="Passed"
                        onClick={() => void onQc(c.id, c.status === 'confirmed' ? 'pending' : 'confirmed')}
                      >
                        {Check}
                      </button>
                      <button
                        className={`qv bad ${c.status === 'failed' ? 'on' : ''}`}
                        aria-pressed={c.status === 'failed'}
                        title="Not right"
                        onClick={() => void onQc(c.id, c.status === 'failed' ? 'pending' : 'failed')}
                      >
                        <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                          <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
                        </svg>
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── the story: there is none until the work has started ── */}
      <div className={`story stage-sec ${notStarted ? 'gone' : ''}`}>
        <div>
          <div className="slabel">Story</div>
          <div className="mtl">
            {(t.story ?? []).map((s, i) => {
              // A photo is not a line of text — it gets its own shape. Everything else stays as it was:
              // a message in somebody's words, or an event line saying what moved.
              if (s.t === 'photo') return <StoryPhoto step={s} key={i} />
              return (
                <div className={`mte ${s.t === 'msg' ? 'note' : ''}`} key={i}>
                  {s.t === 'msg'
                    ? <><b>{s.from}</b> — “{s.text}”</>
                    : <>{'l' in s ? s.l : ''}</>}
                  {s.w && <span className="w">{s.w}</span>}
                </div>
              )
            })}
            {(t.story ?? []).length === 0 && <div className="mte">Nothing yet.</div>}
          </div>

          {/* the input looks like a SENTENCE until you commit to it */}
          <div className="notein">
            <input
              ref={noteRef}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void onNote() }}
              placeholder={t.state === 'active' && !(t.story ?? []).length
                ? 'Started — what are you doing first?'
                : "Add an update — it joins this task's story"}
            />
            <button className={`noteadd ${note.trim() ? 'live' : ''}`} onClick={() => void onNote()}>Add</button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** ONE ACTION, ONE WORD. It says what to do now, and on Done it stops being a button at all. */
export function TaskSheetBar({
  task: t, onState, onReopen,
}: {
  task: DeskTask
  onState: (s: TaskState) => Promise<void>
  onReopen: () => void
}) {
  const qc = t.qc ?? []
  const left = qc.filter((c) => c.status !== 'confirmed').length
  const [swap, setSwap] = useState(false)

  const go = (s: TaskState) => {
    setSwap(true)
    void onState(s).finally(() => setTimeout(() => setSwap(false), 180))
  }

  if (t.state === 'todo') {
    return (
      <button className={`cta ${swap ? 'swap' : ''}`} onClick={() => go('active')}>
        <span className="lbl">Start</span>
      </button>
    )
  }

  if (t.state === 'active') {
    return (
      <button className={`cta finish ${swap ? 'swap' : ''}`} onClick={() => go('done')}>
        <span className="lbl">
          Mark done
          {left > 0 && <span className="sub">{left} check{left > 1 ? 's' : ''} left</span>}
        </span>
      </button>
    )
  }

  // Done: the work is in the record. The button stops being one — but the record can be reopened.
  return (
    <div className="cta-row">
      <div className="cta record"><span className="lbl">In the record ✓</span></div>
      <button className="cta-reopen" onClick={onReopen}>Reopen</button>
    </div>
  )
}
