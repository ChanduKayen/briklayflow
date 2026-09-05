// useCursorLamp — the navbar's warm cursor-following "lamp" effect, extracted so any dark surface can
// wear it (the rail, and now the For-review header band). Attach the returned ref to a container that
// has the fx layers + `--mx/--my`-driven glow CSS; the hook eases those vars toward the pointer over a
// rAF loop and toggles `.lit` while hovering. Fine-pointer devices only; respects the element's own
// reduced-motion handling. Recaches geometry on scroll so a page-scrolled band stays aligned.
import { useEffect, useRef } from 'react';

export function useCursorLamp<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el || !window.matchMedia('(pointer:fine)').matches) return;
    let rect: DOMRect | null = null, tx = 0, ty = 0, cx = 0, cy = 0, running = false, raf = 0;
    const loop = () => {
      cx += (tx - cx) * 0.14; cy += (ty - cy) * 0.14;
      el.style.setProperty('--mx', cx.toFixed(1) + 'px');
      el.style.setProperty('--my', cy.toFixed(1) + 'px');
      if (el.classList.contains('lit') || Math.hypot(tx - cx, ty - cy) > 0.5) raf = requestAnimationFrame(loop);
      else running = false;
    };
    const start = () => { if (!running) { running = true; raf = requestAnimationFrame(loop); } };
    const onEnter = (e: PointerEvent) => { rect = el.getBoundingClientRect(); tx = cx = e.clientX - rect.left; ty = cy = e.clientY - rect.top; el.classList.add('lit'); start(); };
    const onLeave = () => { el.classList.remove('lit'); rect = null; };
    const onMove = (e: PointerEvent) => { if (!rect) rect = el.getBoundingClientRect(); tx = e.clientX - rect.left; ty = e.clientY - rect.top; };
    const onScroll = () => { if (rect) rect = el.getBoundingClientRect(); };
    el.addEventListener('pointerenter', onEnter);
    el.addEventListener('pointerleave', onLeave);
    el.addEventListener('pointermove', onMove);
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      el.removeEventListener('pointerenter', onEnter);
      el.removeEventListener('pointerleave', onLeave);
      el.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
  return ref;
}
