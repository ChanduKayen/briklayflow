/**
 * useSwipeTriage — swipe-to-file / swipe-to-reject for a Day Book card.
 *
 * Hand-rolled on Pointer Events (mouse + touch unified), no dependency. This is
 * core interaction, so we own it rather than import a gesture surface.
 *
 * Honest-gesture rules:
 *  - prefers-reduced-motion → swipe is OFF entirely; the card falls back to its
 *    buttons. No fling, no drift.
 *  - The card must set `touch-action: pan-y` so the browser keeps vertical
 *    scrolling. We detect horizontal INTENT only past a small threshold, then
 *    lock the axis — a thumb scrolling the list never accidentally files.
 *  - Filing-right is gated by `canFileRight`; if the entry isn't ready, a
 *    right-swipe springs back instead of filing. Briklay never files what it
 *    doesn't understand.
 *  - Commit on either distance (THRESHOLD) or a deliberate fling (velocity).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

const INTENT = 8;       // px of travel before we decide the axis
const THRESHOLD = 96;   // px to commit by distance
const FLING_V = 0.55;   // px/ms to commit by velocity
const FLING_MIN = 36;   // ...but only after this much travel

export function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined'
    && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
}

type Axis = null | 'h' | 'v';

export interface SwipeTriage {
  dx: number;
  dragging: boolean;
  reducedMotion: boolean;
  bind: {
    onPointerDown: (e: React.PointerEvent) => void;
    onPointerMove: (e: React.PointerEvent) => void;
    onPointerUp: (e: React.PointerEvent) => void;
    onPointerCancel: (e: React.PointerEvent) => void;
  };
}

export function useSwipeTriage(opts: {
  enabled: boolean;            // false for archived rows etc.
  canFileRight: boolean;       // the "ready to file" gate
  onFileRight: () => void;
  onRejectLeft: () => void;
}): SwipeTriage {
  const { enabled, canFileRight, onFileRight, onRejectLeft } = opts;

  const [reducedMotion, setReducedMotion] = useState(prefersReducedMotion);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setReducedMotion(mq.matches);
    mq.addEventListener?.('change', on);
    return () => mq.removeEventListener?.('change', on);
  }, []);

  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);

  const start = useRef<{ x: number; y: number } | null>(null);
  const axis = useRef<Axis>(null);
  const last = useRef<{ x: number; t: number } | null>(null);
  const vel = useRef(0); // px/ms, signed

  const active = enabled && !reducedMotion;

  const reset = useCallback(() => {
    start.current = null;
    axis.current = null;
    last.current = null;
    vel.current = 0;
    setDragging(false);
    setDx(0);
  }, []);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    if (!active) return;
    // ignore secondary buttons; only the primary pointer drives a swipe
    if (e.button != null && e.button !== 0) return;
    start.current = { x: e.clientX, y: e.clientY };
    axis.current = null;
    last.current = { x: e.clientX, t: e.timeStamp };
    vel.current = 0;
  }, [active]);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!active || !start.current) return;
    const ddx = e.clientX - start.current.x;
    const ddy = e.clientY - start.current.y;

    if (axis.current == null) {
      if (Math.abs(ddx) < INTENT && Math.abs(ddy) < INTENT) return;
      axis.current = Math.abs(ddx) > Math.abs(ddy) ? 'h' : 'v';
      if (axis.current === 'v') { start.current = null; return; } // hand back to scroll
      setDragging(true);
      try { (e.target as HTMLElement).setPointerCapture?.(e.pointerId); } catch { /* noop */ }
    }
    if (axis.current !== 'h') return;

    // velocity from the most recent segment
    if (last.current) {
      const dt = e.timeStamp - last.current.t;
      if (dt > 0) vel.current = (e.clientX - last.current.x) / dt;
    }
    last.current = { x: e.clientX, t: e.timeStamp };
    setDx(ddx);
  }, [active]);

  const onPointerUp = useCallback(() => {
    if (!active || axis.current !== 'h') { reset(); return; }
    const v = vel.current;
    const byDistance = Math.abs(dx) > THRESHOLD;
    const byFling = Math.abs(v) > FLING_V && Math.abs(dx) > FLING_MIN && Math.sign(v) === Math.sign(dx);
    const commit = byDistance || byFling;

    if (commit && dx > 0) {
      if (canFileRight) { reset(); onFileRight(); return; }
      reset(); return; // not ready → spring back
    }
    if (commit && dx < 0) { reset(); onRejectLeft(); return; }
    reset();
  }, [active, dx, canFileRight, onFileRight, onRejectLeft, reset]);

  return {
    dx: active ? dx : 0,
    dragging,
    reducedMotion,
    bind: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: onPointerUp },
  };
}
