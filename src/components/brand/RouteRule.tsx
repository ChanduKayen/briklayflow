/**
 * Between pages — the same rule, thin across the top.
 *
 * The full lockup is the app opening; it should keep that weight. A page whose code is being
 * fetched gets the drawn rule alone, so navigation stays quick and the brand moment stays rare.
 */
import { useEffect, useRef } from 'react';

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const CSS = `
.bkroute{position:fixed; left:0; top:0; right:0; height:2px; z-index:9998; background:transparent; pointer-events:none}
.bkroute .fill{height:2px; width:0%; background:#6E5F4C; transition:width .12s linear}
.bkroute .pen{position:absolute; top:-2px; width:6px; height:6px; border-radius:50%; background:#C0603F}
@media (prefers-reduced-motion:reduce){.bkroute .fill{transition:none}}
`;

export default function RouteRule() {
  const fillRef = useRef<HTMLDivElement>(null);
  const penRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let raf = 0;
    const t0 = performance.now();
    // The same easing as the boot rule. It never completes here: the page arriving unmounts it,
    // which is the completion — a bar that hits 100 and then waits is a lie either way.
    const tick = (t: number) => {
      const x = Math.min((t - t0) / (REDUCED ? 200 : 1800), 1);
      const p = Math.min(80 * (1 - Math.pow(1 - x, 2.1)) + 19 * x, 99);
      if (fillRef.current) fillRef.current.style.width = p + '%';
      if (penRef.current) penRef.current.style.left = `calc(${p}% - 3px)`;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="bkroute" role="status" aria-label="Loading">
      <style>{CSS}</style>
      <div className="fill" ref={fillRef} />
      <div className="pen" ref={penRef} />
    </div>
  );
}
