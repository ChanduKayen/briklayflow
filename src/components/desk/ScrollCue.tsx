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
// THE CUE IS A CHEVRON, NOT THE LOGO. Two passes went into putting Briklay's mark here, on the theory
// that the mark is itself a descending form. It was clever and it was wrong: a mark is a BRAND, not a
// DIRECTION. Nobody decodes a logo into an instruction — instructions are read in the shapes people
// already know, and the shape the world knows for "there is more below" is a chevron. Anything else asks
// the reader to learn a private language in order to be told a public fact.

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

/**
 * THE CUE — a hairline rail, and a chevron that travels down it.
 *
 * The first two passes used Briklay's own mark. It was a nice idea and it was wrong: the mark is a
 * BRAND, not a DIRECTION, and at 22px on warm paper it is a blob. A reader does not decode a logo into
 * an instruction — he reads instructions in the shapes he already knows, and the shape the whole world
 * knows for "there is more below" is a chevron. Using anything else is asking him to learn a private
 * language in order to be told a public fact.
 *
 * So: the conventional form, made well.
 *
 *   THE RAIL is a one-pixel hairline that materialises out of the paper — transparent at the top,
 *   ink at the foot. It is the track, and it gives the chevron somewhere to have come FROM. Without it
 *   a lone chevron floats; with it, the gesture has a beginning, and a beginning is what makes a
 *   movement read as a journey rather than a twitch.
 *
 *   THE CHEVRON is 1.4px, round-capped, 15px across — the weight of the hairlines this desk is drawn
 *   with, so it belongs to the page rather than sitting on top of it. It slides down the rail, reaches
 *   the foot, and dissolves into the paper.
 *
 * Two strokes and a line. There is nothing to remove, which is the only test of this that matters.
 */
function Chevron() {
  return (
    <svg className="se-chev" viewBox="0 0 16 8" width="15" height="8" aria-hidden="true" focusable="false">
      <path
        d="M1.4 1.4 L8 6.4 L14.6 1.4"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
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
        <span className="se-rail" />
        <Chevron />
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
