/**
 * Land on the list — without throwing the search bar off the top.
 *
 * The transactions ledger and the Day Book both open on a page whose first screen is a header: a
 * title, a band of figures, filters. The entries are what you came for, so both pages scrolled the
 * first row to the top of the viewport the instant the data arrived. Two things were wrong with
 * that. It fired the moment the query resolved — before the page had visibly settled — so it read
 * as a jump rather than a move. And it carried the toolbar the search and filters live in off the
 * screen along with the header, leaving you scrolled into a list with no way to search it without
 * scrolling back up.
 *
 * So: let the page sit for a beat, then scroll only as far as the toolbar — the header above it
 * goes, the search bar stays, sitting at the top where the eye already is.
 *
 * It gives way to the reader at every step. It never moves a page the reader has already scrolled,
 * it never scrolls DOWN (that would hide entries, not reveal them), and it never runs twice.
 */
import { useEffect, useRef } from 'react';

/** A few pixels above the bar, so it doesn't read as clipped against the top edge. */
const BREATH = 10;

/**
 * @param anchor  `data-settle-anchor` value on the element to bring to the top. A page may mark
 *                more than one (a desktop toolbar and a phone one) — the visible one wins.
 * @param ready   false while the page is still loading; the settle starts when this turns true.
 * @param settleMs how long the landed page sits before it moves. ~0.7s: long enough to register
 *                where you are, short enough that the move still feels like part of arriving.
 */
export function useSettleScroll(anchor: string, ready: boolean, settleMs = 700) {
  const done = useRef(false);
  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;
    const t = window.setTimeout(() => {
      // A page the reader has already taken hold of is theirs — leave it alone.
      if (window.scrollY > 4) return;
      const bars = [...document.querySelectorAll<HTMLElement>(`[data-settle-anchor="${anchor}"]`)];
      const bar = bars.find(el => el.getBoundingClientRect().height > 0);
      if (!bar) return;
      const top = Math.round(bar.getBoundingClientRect().top + window.scrollY - BREATH);
      if (top <= BREATH) return;                      // nothing above it to scroll away
      const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
      window.scrollTo({ top, behavior: still ? 'auto' : 'smooth' });
    }, settleMs);
    return () => window.clearTimeout(t);
  }, [anchor, ready, settleMs]);
}
