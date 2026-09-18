/**
 * useSoftKeyboard — is the phone's keyboard up, and how tall is it?
 *
 * A bottom bar and a keyboard want the same strip of glass. The bar loses: while you are typing,
 * what you are typing is the only thing that matters, and a row of tabs under the keyboard is
 * either hidden anyway or, worse, pushed up over the field you are filling. So every bar in the
 * app asks this and tucks itself away.
 *
 * Two signals, because one is not enough:
 *   · visualViewport — iOS and most Android browsers overlay the keyboard, so the visual viewport
 *     shrinks under a window that does not. That difference IS the keyboard, and it gives us its
 *     height, which is what a panel needs to ride above it.
 *   · focus — some Android WebViews resize the window itself, so the difference above is zero and
 *     the keyboard would go unnoticed. A focused text field says the same thing without the height.
 *     Only on a touch pointer: a narrow desktop window with a focused input is not a keyboard.
 */
import { useEffect, useState } from 'react';

const NOT_TYPED = ['button', 'submit', 'reset', 'checkbox', 'radio', 'file', 'range', 'color', 'image', 'hidden'];

/** Does focusing this element raise a keyboard? */
function isTypeInto(el: Element | null): boolean {
  if (!el || !(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return !(el as HTMLTextAreaElement).readOnly;
  if (el.tagName !== 'INPUT') return false;
  const input = el as HTMLInputElement;
  return !input.readOnly && !NOT_TYPED.includes(input.type);
}

export type SoftKeyboard = { open: boolean; height: number };
const SHUT: SoftKeyboard = { open: false, height: 0 };

export function useSoftKeyboard(): SoftKeyboard {
  const [kb, setKb] = useState<SoftKeyboard>(SHUT);
  useEffect(() => {
    const coarse = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    let focused = false;
    const measure = () => {
      const vv = window.visualViewport;
      const raw = vv ? Math.max(0, window.innerHeight - vv.height - vv.offsetTop) : 0;
      const height = raw > 80 ? raw : 0;
      const open = height > 0 || (coarse && focused);
      setKb((s) => (s.open === open && Math.abs(s.height - height) < 2 ? s : { open, height }));
    };
    const onIn = (e: FocusEvent) => { focused = isTypeInto(e.target as Element); measure(); };
    // the next field's focusin arrives after this blur, so let it land before believing the keyboard shut
    const onOut = () => { focused = false; setTimeout(measure, 80); };
    const r = requestAnimationFrame(measure);
    document.addEventListener('focusin', onIn);
    document.addEventListener('focusout', onOut);
    const vv = window.visualViewport;
    vv?.addEventListener('resize', measure);
    vv?.addEventListener('scroll', measure);
    window.addEventListener('orientationchange', measure);
    return () => {
      cancelAnimationFrame(r);
      document.removeEventListener('focusin', onIn);
      document.removeEventListener('focusout', onOut);
      vv?.removeEventListener('resize', measure);
      vv?.removeEventListener('scroll', measure);
      window.removeEventListener('orientationchange', measure);
    };
  }, []);
  return kb;
}
