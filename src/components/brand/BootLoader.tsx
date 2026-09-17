/**
 * The app opening — the quipu ties itself.
 *
 * Cords drop from the bar, nine knots tie in top to bottom like counts being written down, hold,
 * then untie for the next round; a slow sway keeps it alive while it waits. (From the loader
 * reference, briklay-loader-v1.) The animation loops on its own; the boot logic is unchanged — the
 * overlay holds until the app signals `booted`, then fades out. A 7s cap guarantees it never
 * covers the app if readiness never arrives.
 */
import { useEffect, useRef, useState } from 'react';
import { isBooted, onBooted } from './bootSignal';

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const CSS = `
.bkboot{
  position:fixed; inset:0; z-index:9999; display:grid; place-items:center;
  background:#F7F6F1;
  opacity:0; transition:opacity .5s ease;
}
.bkboot.on{opacity:1}
.bkboot.exit{opacity:0; transform:scale(.99); pointer-events:none; transition:opacity .6s ease, transform .6s cubic-bezier(.5,0,.2,1)}
/* ---------- the quipu loader ---------- */
.bkboot .qload{--m:#12261F; width:84px; height:84px; display:block; fill:var(--m);
  transform-origin:50% 8%; animation:qsway 2.8s ease-in-out infinite}
.bkboot .qload .cord{transform-box:fill-box; transform-origin:top; animation:qcord 2.8s cubic-bezier(.2,.8,.3,1) infinite}
.bkboot .qload .knot{transform-box:fill-box; transform-origin:center; animation:qknot 2.8s cubic-bezier(.2,.9,.3,1.3) infinite}
.bkboot .qload .c1{animation-delay:0s}.bkboot .qload .c2{animation-delay:.08s}.bkboot .qload .c3{animation-delay:.16s}.bkboot .qload .c4{animation-delay:.24s}
.bkboot .qload .k1{animation-delay:.42s}.bkboot .qload .k2{animation-delay:.52s}.bkboot .qload .k3{animation-delay:.62s}.bkboot .qload .k4{animation-delay:.72s}.bkboot .qload .k5{animation-delay:.82s}.bkboot .qload .k6{animation-delay:.92s}.bkboot .qload .k7{animation-delay:1.02s}.bkboot .qload .k8{animation-delay:1.12s}.bkboot .qload .k9{animation-delay:1.22s}
@keyframes qcord{0%{transform:scaleY(0)}14%{transform:scaleY(1)}78%{transform:scaleY(1)}88%,100%{transform:scaleY(0)}}
@keyframes qknot{0%{transform:scale(0)}10%{transform:scale(1)}70%{transform:scale(1)}78%,100%{transform:scale(0)}}
@keyframes qsway{0%,100%{transform:rotate(-1.5deg)}50%{transform:rotate(1.5deg)}}
@media (prefers-reduced-motion:reduce){
  .bkboot,.bkboot.on{transition:none}
  .bkboot .qload,.bkboot .qload .cord,.bkboot .qload .knot{animation:none; transform:none}
}
`;

export default function BootLoader() {
  const [phase, setPhase] = useState<'' | 'on' | 'exit'>('');
  const [gone, setGone] = useState(false);
  const ready = useRef(isBooted());

  useEffect(() => {
    const off = onBooted(() => { ready.current = true; });
    // Never hold the screen hostage — if readiness never arrives, reveal the app anyway.
    const cap = window.setTimeout(() => { ready.current = true; }, 7000);

    // Fade in on the next painted frame (so it's a transition, not a jump).
    let start = requestAnimationFrame(() => { start = requestAnimationFrame(() => setPhase('on')); });

    // Hold until the app is ready, with a small floor so it doesn't flash on a fast boot.
    const t0 = performance.now();
    const MIN = REDUCED ? 0 : 650;
    let raf = 0;
    const check = () => {
      if (ready.current) {
        const wait = Math.max(0, MIN - (performance.now() - t0));
        window.setTimeout(() => {
          setPhase('exit');
          window.setTimeout(() => setGone(true), REDUCED ? 30 : 640);
        }, wait);
        return;
      }
      raf = requestAnimationFrame(check);
    };
    raf = requestAnimationFrame(check);

    return () => { off(); window.clearTimeout(cap); cancelAnimationFrame(start); cancelAnimationFrame(raf); };
  }, []);

  if (gone) return null;
  const cls = ['bkboot'];
  if (phase === 'on') cls.push('on');
  if (phase === 'exit') cls.push('exit');
  return (
    <div className={cls.join(' ')} role="status" aria-label="Loading Briklay">
      <style>{CSS}</style>
      <svg className="qload" viewBox="0 0 40 40" aria-hidden="true">
        <rect className="bar" x="3" y="4" width="34" height="3.6" rx="1.8" />
        <rect className="cord c1" x="7.9" y="7" width="2.2" height="30" rx="1.1" />
        <rect className="cord c2" x="15.9" y="7" width="2.2" height="20" rx="1.1" />
        <rect className="cord c3" x="23.9" y="7" width="2.2" height="27" rx="1.1" />
        <rect className="cord c4" x="31.9" y="7" width="2.2" height="15" rx="1.1" />
        <circle className="knot k1" cx="17" cy="13" r="2.1" />
        <circle className="knot k2" cx="25" cy="14" r="2.7" />
        <circle className="knot k3" cx="9" cy="15" r="3.0" />
        <circle className="knot k4" cx="33" cy="17" r="2.5" />
        <circle className="knot k5" cx="25" cy="21" r="2.0" />
        <circle className="knot k6" cx="17" cy="22" r="2.9" />
        <circle className="knot k7" cx="9" cy="25" r="2.2" />
        <circle className="knot k8" cx="25" cy="29" r="3.1" />
        <circle className="knot k9" cx="9" cy="33" r="3.2" />
      </svg>
    </div>
  );
}
