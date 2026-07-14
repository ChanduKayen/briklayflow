// SITE DESK — the interaction primitives: breakpoint, swipe, and the close animation.

import { useCallback, useEffect, useRef, useState } from 'react'

/** The master-detail breakpoint. Below it the detail is a bottom sheet; at/above, a panel. */
export function useIsDesktop(): boolean {
  const [d, setD] = useState(() => window.matchMedia('(min-width:920px)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(min-width:920px)')
    const on = () => setD(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return d
}

export const useIsTouch = (): boolean =>
  useState(() => typeof window !== 'undefined' && window.matchMedia('(pointer:coarse)').matches)[0]

/**
 * SWIPE: PARTIAL REVEAL + TAP. Never a full-swipe commit.
 *
 * A swipe reveals the ✓ Close button and stops there — the row is never destroyed by the
 * gesture itself, because closing must always ask its one question (the outcome). A swipe that
 * committed would be a close with no reason on record, which is the one thing the close
 * contract forbids.
 *
 * Pointer events (not touch events) so it works with a stylus/trackpad too; `touch-action: pan-y`
 * lives on the row in CSS, so vertical scrolling is never stolen by a horizontal drag.
 * After any real movement we suppress the click, or a swipe would also open the detail.
 */
export function useSwipe<T extends HTMLElement>(enabled: boolean) {
  const ref = useRef<T>(null)
  const [swiping, setSwiping] = useState(false)
  const st = useRef({ x0: 0, dx: 0, moved: false, held: false, active: false })

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!enabled || e.pointerType === 'mouse') return
    st.current = { x0: e.clientX, dx: 0, moved: false, held: st.current.held, active: true }
    setSwiping(true)
  }, [enabled])

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!st.current.active || !ref.current) return
    const dx = e.clientX - st.current.x0
    st.current.dx = dx
    if (Math.abs(dx) > 8) st.current.moved = true
    // Rightward only, capped at 110px with resistance past the cap.
    const t = Math.max(0, Math.min(dx, 110 + (dx - 110) * 0.15))
    ref.current.style.transform = `translateX(${t}px)`
  }, [])

  const onPointerUp = useCallback(() => {
    if (!st.current.active || !ref.current) return
    setSwiping(false)
    st.current.active = false
    if (st.current.dx > 72) {
      ref.current.style.transform = 'translateX(96px)'   // hold open on the Close button
      st.current.held = true
    } else {
      ref.current.style.transform = ''
      st.current.held = false
    }
  }, [])

  /** True when the pointer moved — the caller must NOT treat this as a tap. */
  const consumedTap = useCallback(() => {
    if (st.current.moved) { st.current.moved = false; return true }
    if (st.current.held) {                       // a tap while held-open just closes the reveal
      if (ref.current) ref.current.style.transform = ''
      st.current.held = false
      return true
    }
    return false
  }, [])

  const reset = useCallback(() => {
    if (ref.current) ref.current.style.transform = ''
    st.current.held = false
  }, [])

  return { ref, swiping, consumedTap, reset, handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp } }
}

/**
 * THE CLOSE ANIMATION, keyed off the real animation — not a guessed timeout.
 *
 * The row fades and collapses its height (260ms), and only when the browser says that finished
 * do we drop it from the list, so the list re-flow is never a frame early or late. On mobile we
 * wait for the sheet to slide away first (280ms), or the collapse happens behind the sheet and
 * he never sees the row leave — which is the whole point of the motion.
 *
 * Under `prefers-reduced-motion` the CSS kills the animation, so `animationend` never fires —
 * hence the fallback timer, which is a SAFETY NET, not the mechanism.
 */
export function useRowClose() {
  const [closingId, setClosingId] = useState<string | null>(null)
  const cb = useRef<(() => void) | null>(null)

  const close = useCallback((id: string, afterSheet: boolean, done: () => void) => {
    cb.current = done
    const start = () => setClosingId(id)
    if (afterSheet) setTimeout(start, 280)      // let the sheet finish leaving
    else start()
  }, [])

  useEffect(() => {
    if (!closingId) return
    const el = document.querySelector<HTMLElement>(`.rowwrap[data-id="${closingId}"]`)
    const finish = () => { cb.current?.(); cb.current = null; setClosingId(null) }
    if (!el) { finish(); return }
    el.addEventListener('animationend', finish, { once: true })
    const safety = setTimeout(finish, 600)      // reduced-motion / detached node
    return () => { el.removeEventListener('animationend', finish); clearTimeout(safety) }
  }, [closingId])

  return { closingId, close }
}
