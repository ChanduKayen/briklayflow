/**
 * Gate — scroll-gated playback wrapper (verbatim from the reference). Pauses all
 * descendant animations (.animgate *) until the element is sufficiently in view,
 * then adds .inview to run them. One IntersectionObserver, no deps.
 */
import { useEffect, useRef } from 'react';
import type { HTMLAttributes } from 'react';

export default function Gate({ children, className = '', ...rest }: HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          const vh = window.innerHeight || 800;
          const h = e.boundingClientRect.height || 1;
          const needed = Math.min(0.6, (vh * 0.65) / h);
          if (e.intersectionRatio >= needed) el.classList.add('inview');
          else if (e.intersectionRatio <= needed * 0.25) el.classList.remove('inview');
        });
      },
      { threshold: [0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6, 0.65, 0.7, 0.8, 0.9, 1] }
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <div ref={ref} className={`animgate ${className}`} {...rest}>
      {children}
    </div>
  );
}
