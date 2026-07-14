// SITE DESK — THE EDGE OF THE LIST.
//
// A list that continues below the fold has to SAY so. The desk's lists end at the bottom of the window
// with a clean, confident edge — a card border, a hairline, a finished-looking thing — and a finished
// edge is a full stop. People stop reading at full stops. There were eleven more tasks under it.
//
// Two signals, and they are deliberately NOT the same signal, because they answer different questions:
//
//   THE FADE   — a STATE. "There is more." It lives for exactly as long as that is true, and it dies the
//                instant you reach the end. It is not decoration; it is the answer to "have I seen it
//                all?", available at a glance, forever, without anybody having to remember it.
//
//   THE CUE    — a HINT. "You can scroll." It appears only when you have not yet scrolled at all, and it
//                leaves the moment you do — because the only thing it had to teach, you have just learnt.
//                A hint that stays after it has been taken is a nag, and nagging is what cheap software
//                does to fill silence.
//
// THE MARK IS THE ARROW. Briklay's mark is a descending form — it already points down — so the cue is the
// brand, moving the way the brand is shaped. It does not need a chevron bolted underneath it and it does
// not need the word "scroll": the motion IS the sentence.
//
// AND IT IS DRAWN IN THE DESK'S OWN INK. The mark is violet, and there is not one violet pixel anywhere
// else in this product's warm paper, terracotta and sage. A lone violet object at the foot of the page
// would read as something that had fallen in from another application. The FORM carries the brand; the
// SURFACE owns the colour. So the silhouette is drawn in --ink-3, at the weight of a watermark.

import { useEffect, useRef, useState, type RefObject } from 'react'

/**
 * IS THERE MORE BELOW, AND HAS HE MOVED YET?
 *
 * Measured off the COLUMN, not the window: the desk's page is as tall as its list, but the column is the
 * thing whose end we actually care about — the card beside it is pinned and has nothing to do with this.
 *
 * `more`  the column's bottom edge is still under the fold → the list continues.
 * `fresh` the page has not been scrolled → he has not been told yet, so the hint is still worth showing.
 *
 * Watched on scroll AND on resize AND on the column's own size (a filter change can shorten a list from
 * forty rows to three, and a fade still promising "more" over the last of three rows is a lie the eye
 * catches immediately).
 */
export function useMoreBelow(ref: RefObject<HTMLElement | null>): { more: boolean; fresh: boolean } {
  const [state, setState] = useState({ more: false, fresh: true })

  useEffect(() => {
    const el = ref.current
    if (!el) return

    const measure = () => {
      const bottom = el.getBoundingClientRect().bottom
      // 24px of slack: a list that ends two pixels under the fold is, to a reader, over. Promising more
      // for the sake of two pixels is how a helpful signal turns into a liar.
      setState({ more: bottom > window.innerHeight - 24, fresh: window.scrollY < 24 })
    }

    measure()
    window.addEventListener('scroll', measure, { passive: true })
    window.addEventListener('resize', measure)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => {
      window.removeEventListener('scroll', measure)
      window.removeEventListener('resize', measure)
      ro.disconnect()
    }
  }, [ref])

  return state
}

/** Briklay's mark, as a silhouette. One path — the outline; none of the violet gradient behind it. */
function Mark() {
  return (
    <svg viewBox="0 0 48 46" width="15" height="14" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M25.946 44.938c-.664.845-2.021.375-2.021-.698V33.937a2.26 2.26 0 0 0-2.262-2.262H10.287c-.92 0-1.456-1.04-.92-1.788l7.48-10.471c1.07-1.497 0-3.578-1.842-3.578H1.237c-.92 0-1.456-1.04-.92-1.788L10.013.474c.214-.297.556-.474.92-.474h28.894c.92 0 1.456 1.04.92 1.788l-7.48 10.471c-1.07 1.498 0 3.579 1.842 3.579h11.377c.943 0 1.473 1.088.89 1.83L25.947 44.94z"
      />
    </svg>
  )
}

/**
 * THE EDGE. Mount it as the LAST child of the scrolling column.
 *
 * It has NO HEIGHT — it is a zero-tall sticky anchor whose paint escapes upward — so it cannot lengthen
 * the column it is measuring, which would make the fade the reason the fade is needed. And it takes no
 * pointer events: a reader must be able to click the row underneath it, because from where he is sitting
 * there is nothing on top of the row at all.
 */
export function ScrollEdge({ more, fresh }: { more: boolean; fresh: boolean }) {
  return (
    <div className={`scroll-edge ${more ? 'more' : ''}`} aria-hidden="true">
      <div className={`se-fade ${more ? 'on' : ''}`} />
      <div className={`se-cue ${more && fresh ? 'on' : ''}`}>
        <Mark />
      </div>
    </div>
  )
}

/** The whole thing, wired: give it the column it lives at the foot of. */
export function ScrollCue({ colRef }: { colRef: RefObject<HTMLElement | null> }) {
  const { more, fresh } = useMoreBelow(colRef)
  return <ScrollEdge more={more} fresh={fresh} />
}

/** A ref you can hand to both the column and the cue, without the caller having to think about it. */
export function useScrollCue() {
  const ref = useRef<HTMLDivElement>(null)
  return { ref, cue: <ScrollCue colRef={ref} /> }
}
