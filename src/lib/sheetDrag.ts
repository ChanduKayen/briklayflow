/**
 * Swipe a bottom sheet down to dismiss it — the gesture every sheet on a phone is expected to
 * have, in one place so every sheet has the same one.
 *
 * A sheet that slides up from the bottom sets an expectation: it goes back the way it came. Ours
 * only closed by tapping the scrim or a button, which on a phone means reaching for a target you
 * cannot see the edge of.
 *
 * The gesture is deliberately conservative about when it takes over:
 *  · it never starts inside a field, so a caret drag still selects text;
 *  · it never starts inside content that is scrolled down — you are reading, not dismissing —
 *    but it does start at the top of that content, which is how a phone list is expected to behave;
 *  · it only commits once the finger has moved down further than it has moved sideways, so a
 *    horizontal swipe inside the sheet is still that sheet's to handle;
 *  · a tap is never swallowed: nothing is prevented until the drag has committed.
 */
import { useEffect, useRef } from 'react';

/** Past this, the release dismisses. Below it, the sheet springs back. */
const DISMISS_PX = 96;
/** A short, fast flick dismisses too — the distance a thumb travels is not the whole story. */
const FLICK_PX = 40;
const FLICK_VELOCITY = 0.5;   // px per ms

const isField = (el: EventTarget | null) =>
  !!(el as HTMLElement | null)?.closest?.('input,textarea,select,[contenteditable="true"]');

/** True when the touch began inside something the user is part-way through scrolling. */
function insideScrolledContent(target: EventTarget | null, root: HTMLElement): boolean {
  let node = target as HTMLElement | null;
  while (node && node !== root.parentElement) {
    if (node.scrollHeight > node.clientHeight + 1 && node.scrollTop > 0) return true;
    node = node.parentElement;
  }
  return false;
}

/**
 * Attach to the sheet element itself. `open` gates the listeners and clears any transform the
 * gesture left behind, so the sheet's own open/close transition is never fighting an inline style.
 */
export function useSheetDrag<T extends HTMLElement>(onDismiss: () => void, open: boolean) {
  const ref = useRef<T | null>(null);
  // The latest callback, without re-binding every listener each time a caller passes a new arrow.
  const closeRef = useRef(onDismiss);
  useEffect(() => { closeRef.current = onDismiss; });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!open) { el.style.transform = ''; el.style.transition = ''; return; }

    let startY = 0, startX = 0, startT = 0, dy = 0, dragging = false, blocked = false;

    const begin = (x: number, y: number, target: EventTarget | null) => {
      startX = x; startY = y; startT = performance.now();
      dy = 0; dragging = false;
      blocked = isField(target) || insideScrolledContent(target, el);
    };

    const move = (x: number, y: number, ev?: Event) => {
      if (blocked) return;
      const ddy = y - startY, ddx = x - startX;
      if (!dragging) {
        if (ddy > 8 && ddy > Math.abs(ddx) * 1.2) dragging = true;
        else if (ddy < -8 || Math.abs(ddx) > 10) { blocked = true; return; }
        else return;
      }
      if (ev?.cancelable) ev.preventDefault();
      dy = Math.max(0, ddy);
      el.style.transition = 'none';
      el.style.transform = `translateY(${dy}px)`;
    };

    const end = () => {
      if (!dragging) return;
      const velocity = dy / Math.max(1, performance.now() - startT);
      el.style.transition = '';
      el.style.transform = '';
      if (dy > DISMISS_PX || (dy > FLICK_PX && velocity > FLICK_VELOCITY)) closeRef.current();
      dragging = false; dy = 0;
    };

    const ts = (e: TouchEvent) => begin(e.touches[0].clientX, e.touches[0].clientY, e.target);
    const tm = (e: TouchEvent) => move(e.touches[0].clientX, e.touches[0].clientY, e);
    const pd = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;               // touch is handled above
      begin(e.clientX, e.clientY, e.target);
      const pm = (ev: PointerEvent) => move(ev.clientX, ev.clientY, ev);
      const pu = () => { end(); window.removeEventListener('pointermove', pm); window.removeEventListener('pointerup', pu); };
      window.addEventListener('pointermove', pm);
      window.addEventListener('pointerup', pu);
    };

    el.addEventListener('touchstart', ts, { passive: true });
    el.addEventListener('touchmove', tm, { passive: false });
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
    el.addEventListener('pointerdown', pd);
    return () => {
      el.removeEventListener('touchstart', ts);
      el.removeEventListener('touchmove', tm);
      el.removeEventListener('touchend', end);
      el.removeEventListener('touchcancel', end);
      el.removeEventListener('pointerdown', pd);
    };
  }, [open]);

  return ref;
}
