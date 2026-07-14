// SITE DESK — the shell: ScopePicker, BigTabs, SettingsGear, UndoToast, RefLink.

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { IconSettings, IconChevronDown } from '@tabler/icons-react'
import type { DeskSite } from '../../lib/desk/types'
import { splitRefs } from '../../lib/desk/derive'
import { PopCount } from './Seg'
import { Check } from './icons'

/* ---------- RefLink: {DSR-19} inside a status line becomes a real, tappable ref ---------- */
export function RefText({ text, onRef }: { text: string; onRef: (ref: string) => void }) {
  return (
    <>
      {splitRefs(text).map((part, i) =>
        part.ref ? (
          <span
            key={i}
            className="reflink"
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onRef(part.ref!) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); onRef(part.ref!) } }}
          >
            {part.ref}
          </span>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </>
  )
}

/* ---------- ScopePicker: one scope, both tabs, at-a-glance rows ---------- */
export function ScopePicker({
  sites, scope, onScope,
}: {
  sites: DeskSite[]
  scope: string                       // 'all' | siteCode
  onScope: (code: string) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('click', away)
    return () => document.removeEventListener('click', away)
  }, [open])

  const current = sites.find((s) => s.code === scope)
  const totalYou = sites.reduce((n, s) => n + s.youCount, 0)

  return (
    <div className={`scope-picker ${open ? 'open' : ''}`} ref={wrap}>
      <button className="scope-btn" onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }} aria-expanded={open}>
        <span className="scope-eyebrow">Project</span>
        <span className="scope-row">
          <span>{current ? current.name : 'All projects'}</span>
          <IconChevronDown size={14} stroke={1.8} />
        </span>
      </button>

      {open && (
        <div className="site-menu" role="menu">
          <button className={`site-menu-item ${scope === 'all' ? 'on' : ''}`} onClick={() => { onScope('all'); setOpen(false) }}>
            <span className={`sm-dot ${totalYou ? 'hot' : 'ok'}`} />
            <div className="sm-body">
              <div className="sm-name">All projects</div>
              <div className={`sm-state ${totalYou ? 'hot' : ''}`}>
                {totalYou ? `${totalYou} need you · plan needs one project` : 'nothing needs you'}
              </div>
            </div>
          </button>
          <div className="menu-sep" />
          {sites.map((s) => (
            <button key={s.code} className={`site-menu-item ${s.code === scope ? 'on' : ''}`} onClick={() => { onScope(s.code); setOpen(false) }}>
              <span className={`sm-dot ${s.youCount ? 'hot' : s.openCount ? 'mid' : 'ok'}`} />
              <div className="sm-body">
                <div className="sm-name">
                  {s.name} <span className="sm-code">{s.code}</span>
                </div>
                <div className={`sm-state ${s.youCount ? 'hot' : ''}`}>
                  {s.youCount ? `${s.youCount} need you` : s.openCount ? `${s.openCount} open, with Briklay` : 'all clear'} · plan {s.pct}%
                </div>
              </div>
              <span className="sm-pct">{s.pct}%</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------- SettingsGear → the existing Follow-up Rules page, mounted unchanged ---------- */
export function SettingsGear({ onClick, variant }: { onClick: () => void; variant: 'desktop' | 'mobile' }) {
  return (
    <button
      className={`gear gear-${variant}`}
      onClick={onClick}
      aria-label="Chasing settings"
      title="Chasing settings"
    >
      <IconSettings size={19} stroke={1.6} />
    </button>
  )
}

/* ---------- The tabs, in the header ----------
 * They were two large cards below the title, each with a subtitle — a whole band of the page spent
 * saying "there are two views". Two views is not news. As a segmented control in the header they
 * cost one line, sit beside the thing they switch, and give the page back to the work. */
export function HeaderTabs({
  tab, onTab, needsYou,
}: {
  tab: 'plan' | 'problems'
  onTab: (t: 'plan' | 'problems') => void
  needsYou: number
}) {
  return (
    <div className="htabs" role="tablist" aria-label="View">
      <button role="tab" aria-selected={tab === 'plan'} className={tab === 'plan' ? 'on' : ''} onClick={() => onTab('plan')}>
        Work Plan
      </button>
      <button role="tab" aria-selected={tab === 'problems'} className={tab === 'problems' ? 'on' : ''} onClick={() => onTab('problems')}>
        Problems
        {/* pops ONCE when the count changes — a badge that animates on every render is noise */}
        {needsYou > 0 && <PopCount n={needsYou} className="htab-badge" />}
      </button>
    </div>
  )
}

const initialsOf = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? '').join('') || '—'

/**
 * The site's supervisor, in the header — the person the whole plan answers to.
 *
 * NOT A NATIVE <select> WEARING OUR SKIN. That trick gives you the OS's grey list of names: no face,
 * no sense of who is already carrying the site, and a popup that looks like nothing else on the page.
 * People are picked by FACE first and name second, so this is a real menu — the same menu the project
 * picker uses, so the two controls in this header behave identically — with an avatar per row, a tick
 * on the person who has it, and a plain way to take it away from them.
 */
export function SupervisorPill({
  members, current, onAssign,
}: {
  members: Array<{ id: string; name: string }>
  current: string | null
  onAssign: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const away = (e: MouseEvent) => { if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('click', away)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('click', away); document.removeEventListener('keydown', esc) }
  }, [open])

  const name = members.find((m) => m.id === current)?.name ?? null

  return (
    <div className={`sup ${open ? 'open' : ''}`} ref={wrap}>
      <button
        className={`sup-pill ${name ? '' : 'empty'}`}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="sup-k">Supervisor</span>
        <span className={`sup-av ${name ? '' : 'none'}`}>{name ? initialsOf(name) : '+'}</span>
        <span className="sup-n">{name ?? 'Assign'}</span>
        <IconChevronDown size={13} stroke={1.8} className="sup-chev" />
      </button>

      {open && (
        <div className="sup-menu" role="menu">
          <div className="sup-menu-head">Who runs this site</div>
          {members.length === 0 && <div className="sup-menu-empty">No team members yet</div>}
          {members.map((m) => (
            <button
              key={m.id}
              className={`sup-item ${m.id === current ? 'on' : ''}`}
              role="menuitem"
              onClick={() => { onAssign(m.id); setOpen(false) }}
            >
              <span className="sup-item-av">{initialsOf(m.name)}</span>
              <span className="sup-item-n">{m.name}</span>
              {m.id === current && <span className="sup-item-tick">{Check}</span>}
            </button>
          ))}
          {current && (
            <>
              <div className="menu-sep" />
              <button className="sup-item clear" role="menuitem" onClick={() => { onAssign(null); setOpen(false) }}>
                <span className="sup-item-n">Nobody — leave it unassigned</span>
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

/* ---------- UndoToast ----------
 * 4.5s with an action, 2.2s without — the prototype's timings. The undo window is the whole
 * safety net behind an irreversible-looking animation, so it does not get shortened. */
export interface ToastState { id: number; msg: string; undo?: () => void }

export function UndoToast({ toast, onDone }: { toast: ToastState | null; onDone: () => void }) {
  if (!toast) return null
  // Keyed by id, so each toast is a FRESH mount — it starts off-screen and slides in. Without
  // the remount the second toast would appear with no motion at all.
  return createPortal(
    <div className="desk-portal">
      <ToastBody key={toast.id} toast={toast} onDone={onDone} />
    </div>,
    document.body,
  )
}

function ToastBody({ toast, onDone }: { toast: ToastState; onDone: () => void }) {
  const [show, setShow] = useState(false)

  useEffect(() => {
    // rAF, not a synchronous setState: the element must paint at translateY(90px) once before
    // the class flips, or the browser coalesces both frames and there is no transition to see.
    const raf = requestAnimationFrame(() => setShow(true))
    const t = setTimeout(() => {
      setShow(false)
      setTimeout(onDone, 250)              // let it slide out before it leaves the tree
    }, toast.undo ? 4500 : 2200)           // 4.5s with an Undo — the safety net is the point
    return () => { cancelAnimationFrame(raf); clearTimeout(t) }
  }, [toast, onDone])

  return (
    <div className={`toast ${show ? 'show' : ''}`} role="status">
      {toast.msg}
      {toast.undo && (
        <button className="undo" onClick={() => { setShow(false); toast.undo!(); onDone() }}>Undo</button>
      )}
    </div>
  )
}

/* ---------- Sheet: the mobile detail surface (portalled; <920px only) ---------- */
export function Sheet({ open, onClose, children }: { open: boolean; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    if (!open) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => { document.body.style.overflow = prev; document.removeEventListener('keydown', esc) }
  }, [open, onClose])

  return createPortal(
    <div className="desk-portal">
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} />
      <div className={`sheet ${open ? 'show' : ''}`} role="dialog" aria-modal="true">
        {open && (
          <>
            <div className="sheet-top"><div className="grab" /></div>
            {children}
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}
