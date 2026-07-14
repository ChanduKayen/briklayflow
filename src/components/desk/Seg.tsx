// SITE DESK — the segmented control. Ported from site-desk-interaction-states.html.
//
// THE THUMB GLIDES. One white pill travels between the segments rather than a background flicking
// on and off — so the eye tracks a physical object and never loses the selection. It also changes
// MATERIAL when the meaning changes: on "Done", the thumb turns green.
//
// The count badge pops ONCE when its number changes, then holds still. A badge that animates on
// every render is noise; a badge that animates when something ARRIVED is information.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'

export interface SegOption<T extends string> {
  value: T
  label: ReactNode
  /** Rendered as the red pill inside the segment. Pops when it changes. */
  count?: number
}

export function Seg<T extends string>({
  options, value, onChange, finished = false, ariaLabel,
}: {
  options: SegOption<T>[]
  value: T
  onChange: (v: T) => void
  /** Turns the thumb green — the control has reached its terminal state. */
  finished?: boolean
  ariaLabel?: string
}) {
  const wrap = useRef<HTMLDivElement>(null)
  const [thumb, setThumb] = useState<{ left: number; width: number } | null>(null)

  // Measure BEFORE paint, or the thumb visibly jumps from 0 on the first frame.
  useLayoutEffect(() => {
    const place = () => {
      const el = wrap.current?.querySelector<HTMLButtonElement>('button.on')
      if (el) setThumb({ left: el.offsetLeft, width: el.offsetWidth })
    }
    place()
    const ro = new ResizeObserver(place)
    if (wrap.current) ro.observe(wrap.current)
    window.addEventListener('resize', place)
    return () => { ro.disconnect(); window.removeEventListener('resize', place) }
  }, [value, options])

  return (
    <div className={`segx ${finished ? 'finished' : ''}`} ref={wrap} role="tablist" aria-label={ariaLabel}>
      <span
        className="thumb"
        style={thumb ? { left: thumb.left, width: thumb.width } : { opacity: 0 }}
        aria-hidden="true"
      />
      {options.map((o) => (
        <button
          key={o.value}
          role="tab"
          aria-selected={o.value === value}
          className={o.value === value ? 'on' : ''}
          onClick={() => onChange(o.value)}
        >
          {o.label}
          {o.count !== undefined && o.count > 0 && <PopCount n={o.count} />}
        </button>
      ))}
    </div>
  )
}

/** A number that pops exactly when it CHANGES — and never on a re-render. */
export function PopCount({ n, className = 'cnt' }: { n: number; className?: string }) {
  const [pop, setPop] = useState(false)
  const prev = useRef(n)

  useEffect(() => {
    if (prev.current === n) return
    prev.current = n
    setPop(true)
    const t = setTimeout(() => setPop(false), 440)
    return () => clearTimeout(t)
  }, [n])

  return <span className={`${className} ${pop ? 'pop' : ''}`}>{n}</span>
}
