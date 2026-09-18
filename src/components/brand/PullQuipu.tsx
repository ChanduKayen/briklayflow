/**
 * The space behind the page — the strings, and the knots that run home along them.
 *
 * Pull a page down and what shows through is the dark underside of the book, strung across its full
 * width like a quipu laid open: four cords, pinned at both edges, with the knots bunched at the left
 * where nothing has been counted yet.
 *
 * Pull further and the strings STRETCH — each one sags deeper under the weight of the pull, and the
 * cords draw apart as the space grows. That sag is the rubber band, drawn: the resistance you feel is
 * the resistance you see.
 *
 * Let go past the threshold and they are set loose. The strings snap back toward true, the knots run
 * out along them — each a beat behind the last — and settle into their places. Then the cords take up
 * a slow rhythm, each on its own phase, the way plucked strings keep sounding: that is the read
 * happening. When it lands the strings still, and what was found is written quietly underneath.
 *
 * Nothing spins. The motif, the green and the knot curve are the app's own (BootLoader).
 */
import { createPortal } from 'react-dom';
import { PULL_THRESHOLD, type PullPhase } from '../../lib/usePullToRefresh';

const CSS = `
.pq{position:fixed;top:0;left:0;right:0;z-index:4;overflow:hidden;pointer-events:none;
  background:linear-gradient(180deg,#12261F 0%,#0C1A15 100%)}
/* the pool of light the strings hang in */
.pq::before{content:'';position:absolute;inset:0;
  background:radial-gradient(130% 120% at 50% 0%, rgba(241,237,226,.09), rgba(241,237,226,.02) 52%, transparent 78%)}
.pq .strings{position:absolute;inset:0 16px}
/* one cord: an svg curve stretched across the width, its stroke kept hairline */
.pq .str{position:absolute;left:0;right:0;height:1px;transform-origin:left top}
.pq .str svg{position:absolute;left:0;top:0;width:100%;overflow:visible}
.pq .str path{fill:none;stroke:rgba(241,237,226,.5);stroke-width:1.15;stroke-linecap:round}
.pq .str.lit path{stroke:rgba(241,237,226,.82)}
.pq .knot{position:absolute;top:0;width:5.2px;height:5.2px;margin:-2.6px 0 0 -2.6px;border-radius:50%;
  background:#F1EDE2;box-shadow:0 0 0 2.5px rgba(18,38,31,.55);
  transition:left .58s cubic-bezier(.2,.9,.3,1.25), transform .58s cubic-bezier(.2,.9,.3,1.25), opacity .3s ease}
/* the rhythm while the books are read — each cord on its own phase, none quite the same */
.pq.refreshing .str{animation:pqstring var(--dur,1s) cubic-bezier(.45,0,.55,1) var(--del,0s) infinite}
@keyframes pqstring{0%,100%{transform:scaleY(1)}50%{transform:scaleY(.34)}}
.pq .say{position:absolute;left:0;right:0;bottom:7px;text-align:center;font-size:11px;letter-spacing:.09em;
  text-transform:uppercase;color:rgba(241,237,226,.55);white-space:nowrap;transition:color .25s ease,opacity .35s ease}
.pq.armed .say{color:rgba(241,237,226,.88)}
.pq.done .say,.pq.failed .say{color:rgba(241,237,226,.95);font-size:11.5px}
.pq.failed .say{color:#E8AD92}
@media (prefers-reduced-motion:reduce){
  .pq.refreshing .str{animation:none}
  .pq .knot{transition:none}
}
`;

/** Four cords, and where each one's knots come to rest along it (0 → 1 across the width). */
const STRINGS: { at: number; knots: number[]; dur: string; delay: string }[] = [
  { at: 0.30, knots: [0.22, 0.46, 0.63], dur: '0.92s', delay: '0s' },
  { at: 0.50, knots: [0.34, 0.71], dur: '1.06s', delay: '0.11s' },
  { at: 0.70, knots: [0.19, 0.52, 0.78], dur: '0.98s', delay: '0.22s' },
  { at: 0.88, knots: [0.41], dur: '1.14s', delay: '0.33s' },
];
/** Where a knot waits before it is set loose — bunched at the near end, barely apart. */
const WAITING = 0.035;
/** How deep a cord sags at a full pull, before the release takes it back toward true. */
const SAG_MAX = 26;

/** A quadratic pinned at both ends dips 2·t·(1−t)·sag at t — the same curve the path draws. */
const dipAt = (t: number, sag: number) => 2 * t * (1 - t) * sag;

export function PullQuipu({ pull, phase, news, label }: {
  pull: number; phase: PullPhase; news: string | null;
  /** Which register this is — named while it rests: "Day Book", "bills". */
  label?: string;
}) {
  if (pull <= 0 && phase === 'idle') return null;

  const loose = phase === 'refreshing' || phase === 'done' || phase === 'failed';
  const t = Math.max(0, Math.min(1, pull / PULL_THRESHOLD));
  const band = Math.max(pull, phase === 'refreshing' ? PULL_THRESHOLD + 10 : 0);
  // Stretched under the pull; let go and the cords come back toward true, holding a shallow curve.
  const sag = loose ? 5 : SAG_MAX * t;
  // The line at the foot keeps its own air — a cord never crosses a word.
  const foot = 23;
  const topPad = 7;
  const room = Math.max(0, band - foot - topPad);
  // A shallow band has no room for four cords — one carries the moment, and the words keep their line.
  const shown = room < 6 ? [] : room < 20 ? STRINGS.slice(3) : room < 34 ? STRINGS.slice(2) : STRINGS;

  const say = phase === 'refreshing' ? 'Reading the books…'
    : phase === 'done' || phase === 'failed' ? (news ?? '')
    : phase === 'armed' ? 'Let go — the knots run home'
    : label ? `Pull to read the ${label} again` : 'Pull to read again';

  return createPortal(
    <div className={`pq ${phase}`} aria-hidden="true"
      style={{ height: Math.round(band), transition: loose ? 'height .46s cubic-bezier(.16,1,.3,1)' : 'none' }}>
      <style>{CSS}</style>
      <div className="strings">
        {shown.map((s, i) => {
          // The cords draw apart as the space opens; the lowest hangs nearest the page's own edge.
          const y = Math.min(Math.round(topPad + room * s.at), Math.max(4, band - foot - 3));
          // A cord hanging lower has less room beneath it, so it carries a shallower curve — and no
          // curve ever reaches the line at the foot.
          const head = Math.max(2, (band - foot) - y);
          const mySag = Math.min(sag * (1 - 0.16 * i), head * 1.6);
          return (
            <div key={i} className={`str${phase === 'armed' || loose ? ' lit' : ''}`}
              style={{ top: y, ['--dur' as string]: s.dur, ['--del' as string]: s.delay }}>
              <svg viewBox={`0 0 100 ${Math.max(1, mySag)}`} height={Math.max(1, mySag)} preserveAspectRatio="none">
                <path d={`M0 0 Q50 ${mySag * 2} 100 0`} vectorEffect="non-scaling-stroke" />
              </svg>
              {s.knots.map((k, j) => {
                const at = loose ? k : WAITING + j * 0.012;
                return (
                  <i key={j} className="knot"
                    style={{
                      left: `${at * 100}%`,
                      transform: `translateY(${dipAt(at, mySag)}px)`,
                      transitionDelay: loose ? `${i * 70 + j * 90}ms` : '0ms',
                      opacity: t > 0.12 || loose ? 1 : 0,
                    }} />
                );
              })}
            </div>
          );
        })}
      </div>
      <span className="say">{say}</span>
    </div>,
    document.body,
  );
}

export default PullQuipu;
