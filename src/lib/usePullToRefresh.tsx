/**
 * BRIKLAY · PULL TO REFRESH
 * The reload is the cause. This is only what the reload looks like.
 *
 * Ported from the reference prototype (claude.ai artifact 5rrzcY39gdnyvotw6TiznK) — its numbers, its
 * springs and its words, unchanged.
 *
 * WHAT YOU SEE
 *   ground   one tone deeper than the page, so the page reads as a sheet being pulled
 *   edge     the page's top edge is elastic: it dips toward the finger while the sides lag; on release
 *            it snaps flat, bows up once (~2px) and is still
 *   the dot  the period from "Briklay." grows with the pull, riding the middle of the gap. Over-pull
 *            stretches it a hair
 *   armed    54px: one light haptic; the dot closes its last 10%
 *   working  rests 46px down. The dot breathes and lets go of one faint ring per breath. No words
 *   to speak the dot opens into a capsule just wide enough for the words, says it, closes back to a
 *            dot, and leaves:
 *              slow (4s)  clay   "Still working"          new      sage + tick  "2 new entries"
 *              nothing    sage   "Up to date"             failed   one shake, hollow  "Couldn't refresh · pull again"
 *              offline    hollow at once, never pretends to try   "Offline · showing saved entries"
 *
 * GRAMMAR   filled = alive · hollow = not connected · clay = working · sage = done · breath = working ·
 *           one shake = no
 *
 * HOW IT MOVES  one spring, tuned per job. Held: the iOS rubber-band curve. Released: the page inherits
 *           the finger's speed, then one soft settle (z = .8). Home: critically damped. Edge snap:
 *           z = .38. Never waits for itself: a 450ms floor so it cannot flicker, otherwise exactly as
 *           long as the reload.
 *
 * RULES     fires on release · only a vertical, single-finger pull from the very top counts · reduced
 *           motion: no breath, no bend, no stretch, states still read
 */
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Arm: how far the page must travel before letting go means something. */
const TH = 54;
/** Where the page rests while the books are read, and while the dot is speaking. */
const HOLD = 46, HOLD_SAY = 58;
/** Band stiffness — the iOS rubber-band constant. */
const DIM = 150;
/** A reload that returns instantly still shows for this long, so it cannot flicker. */
const FLOOR = 450;

const clamp01 = (k: number) => Math.max(0, Math.min(1, k));
const easeOut = (k: number) => 1 - Math.pow(1 - k, 3);
const band = (d: number) => (1 - 1 / ((Math.max(0, d) * 0.8) / DIM + 1)) * DIM;
const buzz = (p: number | number[]) => { try { navigator.vibrate?.(p); } catch { /* not every phone has it */ } };

interface Spring { x: number; v: number; to: number }
const spring = (x: number): Spring => ({ x, v: 0, to: x });
function stepSpring(sp: Spring, k: number, c: number, dt: number) {
  const a = -k * (sp.x - sp.to) - c * sp.v;
  sp.v += a * dt; sp.x += sp.v * dt;
}

type Mode = 'idle' | 'pull' | 'loading' | 'inform' | 'return';

export interface PullOptions {
  /** Read the books again. Rejecting is a failure the dot reports; it never throws onward. */
  onRefresh: () => Promise<unknown>;
  /** The element that scrolls, when it isn't the document (the review deck is the one that isn't). */
  scroller?: React.RefObject<HTMLElement | null>;
  /** How many rows the page shows, read before and after — the difference is what it says. */
  count?: () => number;
  /** What one row is called: "entry", "bill", "order". */
  noun?: string;
  enabled?: boolean;
  /** A page that already holds a ref on its root passes it here, rather than carrying two. */
  attachTo?: React.RefObject<HTMLDivElement | null>;
}

export interface PullToRefresh {
  /** Put this on the element that travels with the finger (the page's own root). */
  wrapRef: React.RefObject<HTMLDivElement | null>;
  /** Render this anywhere in the page — it paints itself over the top of the screen. */
  view: ReactNode;
}

/** A live count for the words, readable from inside the gesture without the closure going stale. */
export function useLiveCount(n: number): () => number {
  const r = useRef(n);
  useEffect(() => { r.current = n; });
  return useCallback(() => r.current, []);
}

const CSS = `
.prf{position:fixed;left:0;right:0;top:0;z-index:4;pointer-events:none;
  --well:#F1ECE1;--ground:#FAF8F3;--ink-2:#5C4F45;--clay:#B5472A;--sage:#2F5D3A;
  --mono:'DM Mono',ui-monospace,Menlo,Consolas,monospace}
.prf .well{position:absolute;left:0;right:0;top:0;height:0;background:var(--well);
  box-shadow:inset 0 1px 0 rgba(43,33,26,.05)}
.prf .edge{position:absolute;left:0;right:0;top:0;height:30px;overflow:visible;will-change:transform}
.prf .edge .line{fill:none;stroke:rgba(43,33,26,.13);stroke-width:1}
.prf .pipwrap,.prf .halo{position:absolute;left:50%;top:0;width:10px;height:10px;margin:-5px 0 0 -5px;
  will-change:transform,opacity;opacity:0}
.prf .pip{--w:10px;position:absolute;left:50%;top:50%;width:10px;height:10px;transform:translate(-50%,-50%);
  border-radius:13px;background:var(--clay);display:flex;align-items:center;justify-content:center;gap:6px;
  overflow:hidden;white-space:nowrap;
  transition:width .55s cubic-bezier(.22,.8,.24,1),height .55s cubic-bezier(.22,.8,.24,1),background-color .4s ease,box-shadow .4s ease}
.prf .pip .txt{font-family:var(--mono);font-size:11px;letter-spacing:.04em;color:#fff;opacity:0;transition:opacity .2s ease}
.prf .pip svg{flex:none;display:none;width:12px;height:12px;fill:none;stroke:#fff;stroke-width:3;
  stroke-linecap:round;stroke-linejoin:round;stroke-dasharray:22;stroke-dashoffset:22}
.prf .pip .live{flex:none;display:none;width:5px;height:5px;border-radius:50%;background:#fff;animation:prf-live 1.8s ease-in-out infinite}
.prf .pip.open{width:var(--w);height:26px}
.prf .pip.open .txt{opacity:1;transition:opacity .35s ease .28s}
.prf .pip.sage{background:var(--sage)}
.prf .pip.sage.open svg{display:block;animation:prf-tick .4s .34s ease-out forwards}
.prf .pip.slow.open .live{display:block}
.prf .pip.hollow{background:transparent;box-shadow:inset 0 0 0 1.5px var(--ink-2)}
.prf .pip.hollow .txt{color:var(--ink-2)}
.prf .pip.no{animation:prf-no .42s ease-in-out 1}
.prf .measure{position:absolute;visibility:hidden;white-space:nowrap;font-family:var(--mono);font-size:11px;letter-spacing:.04em}
.prf .halo{border-radius:50%;border:1px solid var(--clay)}
@keyframes prf-tick{to{stroke-dashoffset:0}}
@keyframes prf-no{0%,100%{transform:translate(-50%,-50%)}25%{transform:translate(calc(-50% - 4px),-50%)}75%{transform:translate(calc(-50% + 4px),-50%)}}
@keyframes prf-live{0%,100%{opacity:1}50%{opacity:.35}}
@media (prefers-reduced-motion:reduce){
  .prf .pip,.prf .pip .txt{transition:none}
  .prf .pip.no,.prf .pip .live{animation:none}
  .prf .pip svg{stroke-dashoffset:0}
}
`;

export function usePullToRefresh(opts: PullOptions): PullToRefresh {
  const { onRefresh, scroller, count, noun = 'entry', enabled = true, attachTo } = opts;
  const ownRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = attachTo ?? ownRef;

  const wellRef = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<SVGSVGElement>(null);
  const fillRef = useRef<SVGPathElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const pipWrapRef = useRef<HTMLDivElement>(null);
  const pipRef = useRef<HTMLSpanElement>(null);
  const txtRef = useRef<HTMLSpanElement>(null);
  const haloRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const liveRef = useRef<HTMLDivElement>(null);

  const cb = useRef({ onRefresh, count, noun });
  useEffect(() => { cb.current = { onRefresh, count, noun }; }, [onRefresh, count, noun]);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') return;
    if (!wrapRef.current || !pipRef.current || !txtRef.current || !pipWrapRef.current || !haloRef.current
      || !measureRef.current || !wellRef.current || !edgeRef.current || !fillRef.current || !lineRef.current) return;
    // Pinned once the elements exist — the closures below are hoisted, so they need them non-null here.
    const sheet = wrapRef.current!;
    const pip = pipRef.current!, pipTxt = txtRef.current!, wrap = pipWrapRef.current!;
    const halo = haloRef.current!, measure = measureRef.current!, well = wellRef.current!;
    const edge = edgeRef.current!, edgeFill = fillRef.current!, edgeLine = lineRef.current!;

    const calm = matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scrollTop = () => (scroller?.current ? scroller.current.scrollTop
      : ((document.scrollingElement || document.documentElement) as HTMLElement).scrollTop);
    /** Something is actually covering the page — a sheet parked off-screen is not. */
    const coveredUp = () => {
      for (const el of document.querySelectorAll<HTMLElement>('[role="dialog"], .bkboot, .scrim.show')) {
        const r = el.getBoundingClientRect();
        if (r.height > 8 && r.top < window.innerHeight - 8 && r.bottom > 8) return true;
      }
      return false;
    };

    let mode: Mode = 'idle', dragging = false, tracking = false, dy = 0, startY = 0, startX = 0;
    let armed = false, raf = 0, last = 0, tLoad = 0, slow = false;
    let timers: number[] = [];
    let aimX = 0.5, fingerX = 0.5, trail: [number, number][] = [];
    const page = spring(0), size = spring(0), bow = spring(0), stretch = spring(1);
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, calm ? Math.min(ms, 900) : ms));
    const say = (t: string) => { if (liveRef.current) liveRef.current.textContent = t; };

    /* the dot opens into a capsule just wide enough for what it has to say */
    function openPill(text: string, kind: string) {
      measure.textContent = text; pipTxt.textContent = text;
      const extra = kind === 'sage' ? 18 : kind === 'slow' ? 11 : 0;
      pip.style.setProperty('--w', Math.ceil(measure.getBoundingClientRect().width + extra + 26) + 'px');
      pip.className = 'pip open ' + kind;
      if (mode !== 'return') page.to = HOLD_SAY;
    }

    function draw(now: number) {
      const y = Math.max(0, page.x), dip = Math.max(0, bow.x), W = sheet.clientWidth || window.innerWidth;
      sheet.style.transform = y > 0.01 ? `translate3d(0,${(y - dip).toFixed(2)}px,0)` : '';
      well.style.height = `${Math.max(0, y).toFixed(2)}px`;
      edge.style.transform = `translate3d(0,${(y - dip).toFixed(2)}px,0)`;
      const curve = `M0 0 Q ${(W * aimX).toFixed(1)} ${(2 * bow.x).toFixed(2)} ${W} 0`;   /* the lowest point leans toward the finger */
      edgeFill.setAttribute('d', curve + ' Z');
      edgeFill.setAttribute('fill', bow.x >= 0 ? 'var(--well)' : 'transparent');
      edgeLine.setAttribute('d', curve);
      edge.style.opacity = clamp01(y / 8).toFixed(3);
      sheet.style.boxShadow = y > 0.5 ? `0 -6px 16px -12px rgba(43,33,26,${(0.14 * clamp01(y / 40)).toFixed(3)})` : '';
      let sc = Math.max(0, size.x); const o = clamp01(size.x * 2.2); let hs = 1, ho = 0;
      if (mode === 'loading' && !calm) {
        const beat = slow ? 2800 : 1500, t = ((now - tLoad) % beat) / beat;             /* one breath */
        if (!slow) sc *= 1 - 0.14 * (0.5 - 0.5 * Math.cos(2 * Math.PI * t));            /* a capsule with words does not pulse */
        if (!slow) { const ramp = clamp01((now - tLoad - 250) / 500); hs = 1 + 1.9 * easeOut(t); ho = 0.3 * (1 - t) * (1 - t) * ramp; }
      }
      const mid = y * 0.5 + 5 * clamp01(y / 30);                                        /* optically centred in the gap */
      wrap.style.transform = `translate3d(0,${mid.toFixed(2)}px,0) scale(${(sc * (1 - 0.4 * (stretch.x - 1))).toFixed(3)},${(sc * stretch.x).toFixed(3)})`;
      wrap.style.opacity = o.toFixed(3);
      halo.style.transform = `translate3d(0,${mid.toFixed(2)}px,0) scale(${hs.toFixed(3)})`;
      halo.style.opacity = ho.toFixed(3);
    }

    function frame(now: number) {
      const dt = Math.min(0.032, (now - last) / 1000 || 0.016); last = now;
      if (dragging) { page.x = band(dy); page.v = 0; trail.push([now, page.x]); if (trail.length > 5) trail.shift(); }
      else if (page.to === 0) stepSpring(page, 210, 29, dt);                              /* home: critically damped */
      else stepSpring(page, 220, 23.7, dt);                                               /* onto its rest: z = .8 */
      if (page.x < 0) { page.x = 0; page.v = 0; }
      aimX += ((dragging ? 0.5 + (fingerX - 0.5) * 0.55 : 0.5) - aimX) * Math.min(1, dt * 9);
      stretch.to = dragging && !calm ? 1 + Math.min(0.2, Math.max(0, page.x - TH) * 0.0055) : 1;
      stepSpring(stretch, 320, 15, dt);
      if (calm) bow.x = 0;
      else if (dragging) { bow.x = 11 * Math.pow(clamp01(page.x / 105), 1.15); bow.v = 0; }
      else { bow.to = 0; stepSpring(bow, 300, 13, dt); }                                  /* snaps flat, bows up once, still */

      if (mode === 'pull') {
        const on = page.x >= TH;
        if (on !== armed) { armed = on; if (on) buzz(10); }
        size.to = armed ? 1 : 0.9 * easeOut(clamp01((page.x - 6) / (TH - 6)));            /* the last 10% answers "far enough?" */
      } else if (mode === 'loading' || mode === 'inform') size.to = 1;
      else size.to = 0;
      if (calm) size.x = size.to;
      else if (mode === 'pull' && !armed) stepSpring(size, 500, 45, dt);
      else stepSpring(size, 300, 21, dt);                                                 /* armed: z = .6 */

      draw(now);
      const still = !dragging && page.to === 0 && Math.abs(page.x) < 0.2 && Math.abs(page.v) < 2
        && size.x < 0.02 && Math.abs(bow.x) < 0.1;
      if (still && (mode === 'pull' || mode === 'return')) { finish(); return; }
      raf = requestAnimationFrame(frame);
    }
    const start = () => { if (!raf) { last = performance.now(); raf = requestAnimationFrame(frame); } };

    function refresh() {
      const now = performance.now();
      timers.forEach(clearTimeout); timers = [];
      page.to = HOLD; tLoad = now; armed = false; slow = false; start();
      if (navigator.onLine === false) {                                                   /* never pretend to try */
        mode = 'inform'; pip.className = 'pip hollow';
        later(() => openPill('Offline · showing saved entries', 'hollow'), 380);
        say('Offline. Showing saved entries.');
        later(goHome, 2400); return;
      }
      mode = 'loading';
      later(() => { if (mode === 'loading') { slow = true; openPill('Still working', 'slow'); } }, 4000);
      const before = cb.current.count?.() ?? null;
      cb.current.onRefresh()
        .then(() => ({ ok: true }), () => ({ ok: false }))
        .then((r) => window.setTimeout(() => landed(r.ok, before), Math.max(0, FLOOR - (performance.now() - now))));
    }

    function landed(ok: boolean, before: number | null) {
      if (mode !== 'loading') return;
      timers.forEach(clearTimeout); timers = [];
      mode = 'inform'; slow = false;
      if (!ok) {
        pip.className = 'pip hollow no'; buzz([10, 40, 10]);
        later(() => openPill('Couldn’t refresh · pull again', 'hollow'), 420);
        say('Could not refresh. Pull again to retry.');
        later(goHome, 2800); return;
      }
      const after = cb.current.count?.() ?? null;
      const n = before != null && after != null ? Math.max(0, after - before) : 0;
      const one = cb.current.noun, many = one.endsWith('y') ? `${one.slice(0, -1)}ies` : `${one}s`;
      const words = n ? `${n} new ${n === 1 ? one : many}` : 'Up to date';
      const was = pip.classList.contains('open');
      pip.className = 'pip sage' + (was ? ' open' : '');
      buzz(n ? 8 : 0);
      later(() => openPill(words, 'sage'), was ? 0 : 240);
      say(n ? `Updated. ${words}` : 'Up to date');
      later(goHome, n ? 1700 : 1300);
    }

    /* it closes back to a dot, then the dot leaves */
    function goHome() { mode = 'return'; page.to = 0; pip.classList.remove('open'); }

    function finish() {
      cancelAnimationFrame(raf); raf = 0; mode = 'idle'; dy = 0; armed = false; slow = false;
      page.x = page.v = page.to = 0; size.x = size.v = size.to = 0; bow.x = bow.v = bow.to = 0;
      stretch.x = 1; stretch.v = 0; aimX = fingerX = 0.5;
      sheet.style.boxShadow = ''; sheet.style.transform = '';
      pip.className = 'pip'; pipTxt.textContent = '';
      draw(performance.now());
    }

    /* ---------- the pull ---------- */
    const canPull = () => mode === 'idle' && scrollTop() <= 0 && !coveredUp();
    function begin(y: number, x: number) { if (!canPull()) return; tracking = true; startY = y; startX = x; trail = []; }
    function move(y: number, ev: Event | null, x: number) {
      if (!tracking && !dragging) return;
      const d = y - startY;
      fingerX = clamp01((x - sheet.getBoundingClientRect().left) / (sheet.clientWidth || window.innerWidth));
      if (!dragging) {
        if (d <= 4 || scrollTop() > 0) return;
        if (Math.abs(x - startX) > d * 1.1) { tracking = false; return; }                 /* sideways: not ours */
        dragging = true; mode = 'pull'; page.to = 0; start();
      }
      if (ev && ev.cancelable) ev.preventDefault();
      dy = Math.max(0, d);
    }
    function end() {
      tracking = false; if (!dragging) return;
      dragging = false; dy = 0;
      if (trail.length > 1 && !calm) {                                                    /* a flick carries through */
        const a = trail[0], b = trail[trail.length - 1], dtm = (b[0] - a[0]) / 1000;
        if (dtm > 0) page.v = Math.max(-900, Math.min(900, (b[1] - a[1]) / dtm));
      }
      trail = [];
      if (mode === 'pull') { if (armed) refresh(); else page.to = 0; }
    }

    const onTouchStart = (e: TouchEvent) => { if (e.touches.length === 1) begin(e.touches[0].clientY, e.touches[0].clientX); };
    const onTouchMove = (e: TouchEvent) => move(e.touches[0].clientY, e, e.touches[0].clientX);
    const target: HTMLElement | Window = scroller?.current ?? window;
    target.addEventListener('touchstart', onTouchStart as EventListener, { passive: true });
    target.addEventListener('touchmove', onTouchMove as EventListener, { passive: false });
    target.addEventListener('touchend', end as EventListener);
    target.addEventListener('touchcancel', end as EventListener);
    return () => {
      target.removeEventListener('touchstart', onTouchStart as EventListener);
      target.removeEventListener('touchmove', onTouchMove as EventListener);
      target.removeEventListener('touchend', end as EventListener);
      target.removeEventListener('touchcancel', end as EventListener);
      timers.forEach(clearTimeout);
      if (raf) cancelAnimationFrame(raf);
      sheet.style.transform = ''; sheet.style.boxShadow = '';
    };
  }, [enabled, scroller, wrapRef]);

  const view = useMemo(() => (!enabled || typeof document === 'undefined') ? null : createPortal(
    <div className="prf" aria-hidden="true">
      <style>{CSS}</style>
      <div className="well" ref={wellRef} />
      <svg className="edge" ref={edgeRef}><path ref={fillRef} /><path className="line" ref={lineRef} /></svg>
      <div className="halo" ref={haloRef} />
      <div className="pipwrap" ref={pipWrapRef}>
        <span className="pip" ref={pipRef}>
          <svg viewBox="0 0 24 24"><path d="m6 12.5 4 4 8-9" /></svg>
          <i className="live" />
          <span className="txt" ref={txtRef} />
        </span>
      </div>
      <span className="measure" ref={measureRef} />
      <div ref={liveRef} role="status" aria-live="polite"
        style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clipPath: 'inset(50%)' }} />
    </div>,
    document.body,
  ), [enabled]);

  return { wrapRef, view };
}
