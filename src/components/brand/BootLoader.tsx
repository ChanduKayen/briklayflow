/**
 * The app opening — a port of the reference loader.
 *
 * The wordmark settles, the period drops, the ledger rule is drawn with the pen travelling on it.
 * The reference times that to a fixed 2.4s and its own comment says "wire to real milestones", so
 * it does: the rule eases toward 80% and crawls while the app is still coming up, and completes
 * the moment it is actually ready — never sitting full while still loading, never stalling at 99%
 * after it has arrived.
 */
import { useEffect, useRef, useState } from 'react';
import { isBooted, onBooted } from './bootSignal';

const REDUCED = typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const CSS = `
.bkboot{
  --cream:#FAF7F0; --ink:#2A241C; --walnut:#6E5F4C; --rule:#E6DECD; --terra:#C0603F;
  --serif:'Playfair Display', Georgia, serif;
  position:fixed; inset:0; z-index:9999; display:grid; place-items:center;
  background:var(--cream); font-family:var(--serif);
  transition:opacity .6s ease, transform .6s cubic-bezier(.5,0,.2,1);
}
.bkboot.exit{opacity:0; transform:scale(.99); pointer-events:none}
.bkboot .lockup{position:relative; text-align:center}
.bkboot .word{font-size:clamp(34px,5vw,44px); font-weight:600; color:var(--ink); letter-spacing:.01em;
  opacity:0; transform:translateY(6px); filter:blur(2px);
  transition:opacity .9s ease, transform 1s cubic-bezier(.2,.7,.2,1), filter .9s ease}
.bkboot.on .word{opacity:1; transform:none; filter:none}
.bkboot .dot{display:inline-block; color:var(--terra); font-style:normal; opacity:0; transform:translateY(-26px)}
.bkboot.on .dot{animation:bk-drop .65s cubic-bezier(.3,.9,.35,1.35) .55s forwards}
@keyframes bk-drop{
  0%{opacity:0; transform:translateY(-26px)}
  55%{opacity:1; transform:translateY(2px)}
  75%{transform:translateY(-2px)}
  100%{opacity:1; transform:translateY(0)}
}
.bkboot.loading .dot{animation:bk-breathe 2.2s ease-in-out 1.3s infinite}
@keyframes bk-breathe{0%,100%{opacity:1}50%{opacity:.45}}
.bkboot.done .dot{animation:bk-blink .5s ease; opacity:1}
@keyframes bk-blink{0%{opacity:1}30%{opacity:.2}100%{opacity:1}}
.bkboot .ruleline{position:relative; width:min(240px,56vw); height:1px; margin:26px auto 0; background:var(--rule)}
.bkboot .ruleline .fill{position:absolute; left:0; top:0; height:1px; width:0%; background:var(--walnut)}
.bkboot .ruleline .pen{position:absolute; top:-2.5px; width:6px; height:6px; border-radius:50%;
  background:var(--terra); opacity:0; transform:translateX(-3px); transition:opacity .4s}
.bkboot.loading .pen{opacity:1}
.bkboot.done .pen{opacity:0}
@media (prefers-reduced-motion:reduce){
  .bkboot *{transition-duration:.01ms !important; animation:none !important}
  .bkboot .word{opacity:1; transform:none; filter:none}
  .bkboot .dot{opacity:1; transform:none}
}
`;

export default function BootLoader() {
  const [phase, setPhase] = useState<'' | 'on' | 'loading' | 'done' | 'exit'>('');
  const [gone, setGone] = useState(false);
  const fillRef = useRef<HTMLDivElement>(null);
  const penRef = useRef<HTMLDivElement>(null);
  const readyRef = useRef(isBooted());

  useEffect(() => {
    const off = onBooted(() => { readyRef.current = true; });
    // Never hold the screen hostage. If readiness never arrives — a caught render error, a gate that
    // never resolves — an overlay stuck at 99% would be covering whatever the app is trying to show.
    const cap = window.setTimeout(() => { readyRef.current = true; }, 7000);
    return () => { off(); window.clearTimeout(cap); };
  }, []);

  useEffect(() => {
    let raf = 0;
    // Two frames, as the reference does it: the element has to be painted in its initial state for
    // the settle to be a transition rather than a jump.
    let start = requestAnimationFrame(() => { start = requestAnimationFrame(() => setPhase('on')); });
    const t2 = window.setTimeout(() => {
      setPhase('loading');
      const t0 = performance.now();
      // The curve the reference draws — quick to ~80, then a crawl — but the finish line is the
      // app, not a clock. EXPECT is only how fast the crawl looks while readiness is unknown.
      const EXPECT = REDUCED ? 200 : 2400;
      const tick = (t: number) => {
        const el = t - t0;
        let p: number;
        if (readyRef.current) p = 100;
        else { const x = Math.min(el / EXPECT, 1); p = Math.min(80 * (1 - Math.pow(1 - x, 2.1)) + 19 * x, 99); }
        if (fillRef.current) fillRef.current.style.width = p + '%';
        if (penRef.current) penRef.current.style.left = `calc(${p}% - 3px)`;
        if (p < 100) raf = requestAnimationFrame(tick);
        else {
          setPhase('done');
          window.setTimeout(() => {
            setPhase('exit');
            window.setTimeout(() => setGone(true), 650);
          }, REDUCED ? 80 : 520);
        }
      };
      raf = requestAnimationFrame(tick);
    }, REDUCED ? 0 : 1150);
    return () => { cancelAnimationFrame(start); window.clearTimeout(t2); cancelAnimationFrame(raf); };
  }, []);

  if (gone) return null;
  // Cumulative, the way the reference builds it up: `on` keeps the wordmark settled and the period
  // down for the whole run. Swapping the class instead of adding it would let the wordmark fade back
  // out the moment the rule starts being drawn.
  const cls = ['bkboot'];
  if (phase) cls.push('on');
  if (phase === 'loading') cls.push('loading');
  if (phase === 'done' || phase === 'exit') cls.push('done');
  if (phase === 'exit') cls.push('exit');
  return (
    <div className={cls.join(' ')} role="status" aria-label="Loading Briklay">
      <style>{CSS}</style>
      <div className="lockup">
        <div className="word">Briklay<span className="dot">.</span></div>
        <div className="ruleline">
          <div className="fill" ref={fillRef} />
          <div className="pen" ref={penRef} />
        </div>
      </div>
    </div>
  );
}
