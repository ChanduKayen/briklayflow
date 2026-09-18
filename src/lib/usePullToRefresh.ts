/**
 * Pull the page down to read the books again.
 *
 * The Transactions page has rubber-banded at its edges for a while — a damped, capped drag that
 * springs back (Ledger.tsx). This lifts that gesture out so every main phone page has it, and gives
 * the downward one a meaning: past a threshold, releasing refetches what the page is showing.
 *
 * The feel is the one that was already tuned there and is left alone: 0.4 damping, a cap, and a
 * spring back on cubic-bezier(.16,1,.3,1). What is added is a state machine around it, so the space
 * that opens up can say what is happening (see PullQuipu).
 *
 * Rules the gesture keeps to:
 *  · only from the very top of the scroller, and only for a finger (a mouse has no such gesture);
 *  · vertical only — the axis locks on the first movement, so the attendance week-swipe and the
 *    bills row-swipe keep working untouched;
 *  · never while a sheet or dialog is open over the page;
 *  · a refresh is held on screen for a beat, so a fast one reads as an answer rather than a flicker;
 *  · prefers-reduced-motion: no rubber band at all — the release still refreshes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

export type PullPhase = 'idle' | 'pulling' | 'armed' | 'refreshing' | 'done' | 'failed';

/** How far the page must travel before letting go means something. */
export const PULL_THRESHOLD = 64;
/** The furthest it will go, however hard you pull. */
export const PULL_MAX = 96;
/** Each pixel of finger becomes this much page — the Ledger's own damping. */
const DAMPING = 0.4;
/** A refresh that returns instantly still shows its answer for this long. */
const MIN_VISIBLE = 520;
/** The answer is held in a narrow band — enough to read, not enough to be in the way. */
const ANSWER_GAP = 34;
/** How long the answer stays before the page closes over it. */
const HOLD_ANSWER = 1400;

export interface PullToRefresh {
  /** Put this on the element that should travel with the finger (the page's own root). */
  wrapRef: React.RefObject<HTMLDivElement | null>;
  /** 0 … PULL_MAX — how far down the page is right now. */
  pull: number;
  phase: PullPhase;
  /** What the refresh turned up, once it has: "2 new entries", "nothing new", or an error line. */
  news: string | null;
}

export interface PullOptions {
  /** Read the books again. Rejecting is a failure the space reports; it never throws onward. */
  onRefresh: () => Promise<unknown>;
  /** The element that scrolls, when it isn't the document (the Review deck is the one that isn't). */
  scroller?: React.RefObject<HTMLElement | null>;
  /** How many things the page is showing, read before and after — the difference is the news. */
  count?: () => number;
  /** What one of those things is called: "entry", "bill", "order". */
  noun?: string;
  /** Off for a page that shouldn't have it (a desktop layout, a page mid-edit). */
  enabled?: boolean;
  /** A page that already holds a ref on its root passes it here, rather than carrying two. */
  attachTo?: React.RefObject<HTMLDivElement | null>;
}

const reduced = () =>
  typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * Is something actually covering the page?
 *
 * Not "is a dialog in the DOM" — the sheets stay mounted and are parked off-screen with a transform,
 * so asking that way made every page with a sheet in its tree (the review deck, the bills register,
 * the muster) believe it was covered, and the gesture never started. Ask where the thing IS.
 */
const coveredUp = () => {
  const els = document.querySelectorAll<HTMLElement>('[role="dialog"], .bkboot, .scrim.show, .rvm .sheet.show');
  for (const el of els) {
    const r = el.getBoundingClientRect();
    if (r.height > 8 && r.top < window.innerHeight - 8 && r.bottom > 8) return true;
  }
  return false;
};

/**
 * A live count for the news line: how many rows the page is showing right now, readable from inside
 * the gesture without the closure going stale (and without writing a ref during render).
 */
export function useLiveCount(n: number): () => number {
  const r = useRef(n);
  useEffect(() => { r.current = n; });
  return useCallback(() => r.current, []);
}

export function usePullToRefresh(opts: PullOptions): PullToRefresh {
  const { onRefresh, scroller, count, noun = 'entry', enabled = true, attachTo } = opts;
  const ownRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = attachTo ?? ownRef;
  const [pull, setPull] = useState(0);
  const [phase, setPhase] = useState<PullPhase>('idle');
  const [news, setNews] = useState<string | null>(null);

  // The handlers are bound once; everything they need that changes lives in a ref, kept current in an
  // effect (a ref written during render is a ref read at the wrong time).
  const cb = useRef({ onRefresh, count, noun });
  useEffect(() => { cb.current = { onRefresh, count, noun }; }, [onRefresh, count, noun]);
  const busy = useRef(false);

  const run = useCallback(async () => {
    if (busy.current) return;
    busy.current = true;
    setPhase('refreshing');
    setPull(PULL_THRESHOLD);                       // rest at the threshold while it reads
    const before = cb.current.count?.() ?? null;
    const started = Date.now();
    let failed = false;
    try { await cb.current.onRefresh(); }
    catch { failed = true; }
    const wait = Math.max(0, MIN_VISIBLE - (Date.now() - started));
    await new Promise((r) => window.setTimeout(r, wait));
    // The page has re-rendered by now, so the count it hands back is the fresh one.
    const after = cb.current.count?.() ?? null;
    if (failed) {
      setNews('Couldn’t reach — showing your last read');
      setPhase('failed');
    } else {
      const known = before != null && after != null;
      const added = known ? after - before : 0;
      const n = cb.current.noun;
      const many = n.endsWith('y') ? `${n.slice(0, -1)}ies` : `${n}s`;
      // With nothing to count, the honest answer is only that it has been read again.
      setNews(!known ? 'read just now' : added > 0 ? `${added} new ${added === 1 ? n : many}` : 'nothing new');
      setPhase('done');
    }
    // Hold the page open by a band while the answer is read, then let it close.
    setPull(ANSWER_GAP);
    window.setTimeout(() => {
      setPull(0);
      window.setTimeout(() => { setPhase('idle'); setNews(null); busy.current = false; }, 420);
    }, HOLD_ANSWER);
  }, []);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined' || !('ontouchstart' in window)) return;
    const still = reduced();
    const el = () => scroller?.current ?? window;
    const top = () => {
      const s = scroller?.current;
      if (s) return s.scrollTop <= 0;
      const root = (document.scrollingElement || document.documentElement) as HTMLElement;
      return root.scrollTop <= 0;
    };

    let startY = 0, startX = 0, axis: '' | 'v' | 'h' = '', active = false, travelled = 0;

    const onStart = (e: TouchEvent) => {
      if (busy.current || coveredUp() || !top()) { active = false; return; }
      startY = e.touches[0].clientY; startX = e.touches[0].clientX;
      axis = ''; active = true; travelled = 0;
    };
    const onMove = (e: TouchEvent) => {
      if (!active) return;
      const dy = e.touches[0].clientY - startY;
      const dx = e.touches[0].clientX - startX;
      if (!axis) {
        if (Math.abs(dy) < 6 && Math.abs(dx) < 6) return;
        // A sideways gesture belongs to whatever is under the finger — let it go.
        axis = Math.abs(dy) > Math.abs(dx) * 1.5 ? 'v' : 'h';
        if (axis === 'h') { active = false; return; }
      }
      if (dy <= 0) { travelled = 0; setPull(0); setPhase('idle'); return; }
      travelled = Math.min(dy * DAMPING, PULL_MAX);
      if (!still) {
        setPull(travelled);
        setPhase(travelled >= PULL_THRESHOLD ? 'armed' : 'pulling');
      }
      e.preventDefault();                          // hold the native scroll while the page travels
    };
    const onEnd = () => {
      if (!active) return;
      active = false;
      const armed = travelled >= PULL_THRESHOLD * (still ? 0 : 1) && travelled > 0;
      travelled = 0;
      if (armed) { void run(); return; }
      setPull(0); setPhase('idle');
    };

    const target = el() as HTMLElement | Window;
    target.addEventListener('touchstart', onStart as EventListener, { passive: true });
    target.addEventListener('touchmove', onMove as EventListener, { passive: false });
    target.addEventListener('touchend', onEnd as EventListener);
    target.addEventListener('touchcancel', onEnd as EventListener);
    return () => {
      target.removeEventListener('touchstart', onStart as EventListener);
      target.removeEventListener('touchmove', onMove as EventListener);
      target.removeEventListener('touchend', onEnd as EventListener);
      target.removeEventListener('touchcancel', onEnd as EventListener);
    };
  }, [enabled, scroller, run]);

  // The page itself travels; the space it uncovers is painted behind it (PullQuipu).
  useEffect(() => {
    const w = wrapRef.current;
    if (!w) return;
    const settling = phase === 'idle' || phase === 'done' || phase === 'failed' || phase === 'refreshing';
    w.style.transition = settling ? 'transform .42s cubic-bezier(.16,1,.3,1)' : 'none';
    w.style.transform = pull ? `translateY(${pull}px)` : '';
  }, [pull, phase, wrapRef]);

  return { wrapRef, pull, phase, news };
}
