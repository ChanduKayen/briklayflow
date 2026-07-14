// SITE DESK — THE BUTTON. Ported from site-desk-interaction-states.html.
//
// ONE OBJECT CHANGING STATE, NEVER TWO SWAPPING.
//
// The three labels (rest · loading · success) all live inside the button at once. Only one is
// `static`; the others are absolute ghosts. On a press the rest label SINKS AWAY (up, fading), the
// spinner RISES into its place, and the button's WIDTH MORPHS to fit — so the shape follows the
// meaning instead of snapping between two sizes. On success the check DRAWS ITSELF (a stroke-dash
// animation — it is written, not revealed), the primary turns green, the close button's outline
// FILLS. Then it settles back to rest.
//
// THE BLOOM is the one celebration: an exhale of green — a ring and six motes — then calm. It is
// rationed to finishing real work (a task marked done, a problem closed). A site app that throws a
// party at every tap is a toy, and the founder is usually here because something is going wrong.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { Check, Spinner } from './icons'

type Phase = 'rest' | 'loading' | 'success'

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

/** The bloom: one ring, six motes, gone in 600ms. Appended to the button, removed after. */
function bloom(host: HTMLElement) {
  if (REDUCED()) return
  const b = document.createElement('span')
  b.className = 'bloom'
  b.innerHTML = '<span class="ringx"></span>' +
    [0, 60, 120, 180, 240, 300].map((a) => `<span class="mote" style="--a:${a}deg"></span>`).join('')
  host.appendChild(b)
  setTimeout(() => b.remove(), 700)
}

export function Btn({
  onClick, children, className = '', variant = 'quiet', disabled, title,
  loadingLabel, successLabel, celebrate = false,
}: {
  onClick: () => void | Promise<unknown>
  children: ReactNode
  className?: string
  /** primary = the dark action · closer = the one green fill · quiet = hierarchy without noise */
  variant?: 'primary' | 'closer' | 'quiet' | 'bare'
  disabled?: boolean
  title?: string
  loadingLabel?: string
  successLabel?: string
  celebrate?: boolean
}) {
  const [phase, setPhase] = useState<Phase>('rest')
  const el = useRef<HTMLButtonElement>(null)
  const alive = useRef(true)

  // Re-armed on EVERY mount, not just cleared on unmount. Under StrictMode the effect runs
  // mount → cleanup → mount; without the re-arm this flag went false forever and the button
  // spun "Saving…" for the rest of its life over a write that had already succeeded.
  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  /** Measure a layer by cloning it invisibly — so the width can morph TO a number, not to `auto`. */
  const layerWidth = (sel: string): number | null => {
    const btn = el.current
    const l = btn?.querySelector(sel)
    if (!btn || !l) return null
    const clone = l.cloneNode(true) as HTMLElement
    clone.style.cssText = 'position:absolute;visibility:hidden;opacity:1;transform:none;display:inline-flex;gap:8px;font:inherit'
    btn.appendChild(clone)
    const w = clone.offsetWidth
    clone.remove()
    return w + 44                                   // the button's own side padding
  }

  const run = useCallback(() => {
    const btn = el.current
    if (!btn || phase !== 'rest' || disabled) return

    const r = onClick()
    if (!(r instanceof Promise)) return              // a sync action already happened

    const restWidth = btn.offsetWidth
    btn.style.width = `${restWidth}px`               // pin the start, so the morph has somewhere to leave FROM

    requestAnimationFrame(() => {
      if (!alive.current) return
      setPhase('loading')
      const w = layerWidth('.layer.loading')
      if (w && el.current) el.current.style.width = `${w}px`
    })

    const settle = () => {
      if (!alive.current) return
      setPhase('rest')
      if (el.current) {
        el.current.style.width = `${restWidth}px`
        setTimeout(() => { if (el.current) el.current.style.width = '' }, 350)
      }
    }

    void r.then(
      () => {
        if (!alive.current) return
        setPhase('success')
        const w = layerWidth('.layer.success')
        if (w && el.current) el.current.style.width = `${w}px`
        if (celebrate && el.current) bloom(el.current)
        setTimeout(settle, REDUCED() ? 400 : 1500)   // hold the success long enough to be READ
      },
      () => {
        // A failure has no success state to show — the toast carries the reason. Return to rest at
        // once rather than pretending anything settled.
        settle()
      },
    )
  }, [phase, disabled, onClick, celebrate])

  const cls = [
    'abtn',
    variant !== 'bare' ? variant : '',
    className,
    phase === 'loading' ? 'is-loading' : '',
    phase === 'success' ? 'is-success' : '',
  ].filter(Boolean).join(' ')

  return (
    <button
      ref={el}
      className={cls}
      onClick={run}
      disabled={disabled || phase !== 'rest'}
      title={title}
      aria-busy={phase === 'loading'}
    >
      <span className="layer rest">{children}</span>
      <span className="layer loading ghost">{Spinner}{loadingLabel}</span>
      <span className="layer success ghost">{Check}{successLabel}</span>
    </button>
  )
}
