/**
 * Hold a row, and the list becomes a set of things to choose from.
 *
 * A phone has no hover, so the checkbox that a mouse finds by passing over a row has nowhere to
 * appear. The finger's equivalent is the press that lasts: hold one row and a selection starts,
 * after which a plain tap adds or removes rows instead of opening them.
 *
 * Three things make it feel like a gesture rather than a lag:
 *  · a finger that travels is scrolling the list, not holding a row, so any real drift calls it off;
 *  · the click the browser dispatches when the finger finally lifts is the tail of the press, not a
 *    tap of its own, so it is swallowed once — otherwise the held row would also open;
 *  · a mouse never starts the clock. It has the hover checkbox already, and a slow click on a
 *    desktop is just a slow click.
 *
 * The system's own long-press menu (Copy / Share) would land on top of all this, so the caller
 * blocks the context menu and turns off text selection for the element.
 */
import { useRef, type PointerEvent as ReactPointerEvent } from 'react';

/** Long enough that a slow tap isn't mistaken for it; short enough to feel deliberate. */
export const LONG_PRESS_MS = 420;
/** A finger that travels this far is scrolling. */
export const LONG_PRESS_SLOP = 10;

export interface LongPress {
  /** Start the clock. Pass the pointer event straight through from onPointerDown. */
  down: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Call it off if the finger has travelled. From onPointerMove. */
  move: (e: ReactPointerEvent<HTMLElement>) => void;
  /** Call it off — from onPointerUp / onPointerCancel / onPointerLeave, and on unmount. */
  cancel: () => void;
  /** True exactly once after a press fired: the click that follows is its tail, not a tap. */
  swallowsClick: () => boolean;
}

/**
 * @param onLongPress what the press does, handed the element it was held on. Passing `undefined`
 *                    turns the gesture off entirely (the handlers stay safe to call).
 */
export function useLongPress(onLongPress?: (el: HTMLElement) => void, ms = LONG_PRESS_MS): LongPress {
  const timer = useRef<number | null>(null);
  const from = useRef<{ x: number; y: number } | null>(null);
  const fired = useRef(false);

  const cancel = () => { if (timer.current !== null) { window.clearTimeout(timer.current); timer.current = null; } };

  return {
    cancel,
    down: (e) => {
      if (!onLongPress || e.pointerType === 'mouse') return;
      const el = e.currentTarget;
      from.current = { x: e.clientX, y: e.clientY };
      fired.current = false;
      cancel();
      timer.current = window.setTimeout(() => {
        timer.current = null;
        fired.current = true;
        onLongPress(el);
      }, ms);
    },
    move: (e) => {
      if (timer.current === null || !from.current) return;
      if (Math.abs(e.clientX - from.current.x) > LONG_PRESS_SLOP
        || Math.abs(e.clientY - from.current.y) > LONG_PRESS_SLOP) cancel();
    },
    swallowsClick: () => { if (!fired.current) return false; fired.current = false; return true; },
  };
}
