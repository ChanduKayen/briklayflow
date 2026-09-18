/**
 * The space behind the page — where the quipu ties itself.
 *
 * Pull a page down and what shows through is not more paper: it is the dark under-side of the book,
 * and hanging from the page's own bottom edge, the quipu. Cords drop as far as your finger takes
 * them (this is the rubber band, drawn), knots tie as the pull deepens, and the last knot lands
 * exactly where letting go starts to mean something. While the books are being read the whole thing
 * sways — the motion the app opens with (BootLoader). Then the page closes over it and the cords
 * withdraw.
 *
 * It is the same motif, the same curves and the same green as the boot screen, because it is the
 * same act: a count being written down. Nothing here spins.
 *
 * The strip is painted UNDER the page (fixed, low z-index) rather than inside it, so a page needs no
 * layout of its own to make room — it simply travels, and this is what was always underneath.
 */
import { createPortal } from 'react-dom';
import { PULL_THRESHOLD, type PullPhase } from '../../lib/usePullToRefresh';

const CSS = `
.pq{position:fixed;top:0;left:0;right:0;z-index:4;overflow:hidden;pointer-events:none;
  background:radial-gradient(120% 140% at 50% 0%, #16302700 0%, #0E1F1900 60%),
             linear-gradient(180deg,#12261F 0%,#0D1A15 100%);
  display:flex;align-items:flex-end;justify-content:center;gap:12px;padding-bottom:6px}
/* the pool of light the thumb pulls the cords into */
.pq::before{content:'';position:absolute;inset:0;pointer-events:none;
  background:radial-gradient(150px 90px at var(--px,50%) 100%, rgba(245,240,231,.10), rgba(245,240,231,.03) 55%, transparent 76%)}
.pq .q{position:relative;display:block;flex:none;fill:#F1EDE2;opacity:.92}
.pq.sway .q{animation:pqsway 2.6s ease-in-out infinite;transform-origin:50% 0%}
@keyframes pqsway{0%,100%{transform:rotate(-2deg)}50%{transform:rotate(2deg)}}
.pq .knot{transform-box:fill-box;transform-origin:center;transition:transform .22s cubic-bezier(.2,.9,.3,1.3),opacity .22s ease}
.pq .knot.off{transform:scale(0);opacity:0}
.pq .say{position:relative;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;
  color:rgba(241,237,226,.66);white-space:nowrap;padding-bottom:3px;transition:color .2s ease}
.pq.armed .say,.pq.done .say{color:rgba(241,237,226,.94)}
.pq.failed .say{color:#E5A488}
@media (prefers-reduced-motion:reduce){.pq.sway .q{animation:none}.pq .knot{transition:none}}
`;

/** Nine knots, as the boot loader ties them — each with the pull at which it lands. */
const KNOTS: { cx: number; cy: number; r: number; at: number }[] = [
  { cx: 17, cy: 13, r: 2.1, at: 0.22 },
  { cx: 25, cy: 14, r: 2.7, at: 0.30 },
  { cx: 9, cy: 15, r: 3.0, at: 0.38 },
  { cx: 33, cy: 17, r: 2.5, at: 0.46 },
  { cx: 25, cy: 21, r: 2.0, at: 0.55 },
  { cx: 17, cy: 22, r: 2.9, at: 0.64 },
  { cx: 9, cy: 25, r: 2.2, at: 0.73 },
  { cx: 25, cy: 29, r: 3.1, at: 0.84 },
  { cx: 9, cy: 33, r: 3.2, at: 0.96 },
];
/** The four cords and how long each may grow (the loader's lengths). */
const CORDS = [{ x: 7.9, len: 30 }, { x: 15.9, len: 20 }, { x: 23.9, len: 27 }, { x: 31.9, len: 15 }];

export function PullQuipu({ pull, phase, news, label }: {
  pull: number; phase: PullPhase; news: string | null;
  /** Which register this is — shown while resting: "Day Book", "Payables". */
  label?: string;
}) {
  if (pull <= 0 && phase === 'idle') return null;
  // How far through the gesture we are: 0 at rest, 1 at the point of release.
  const t = Math.max(0, Math.min(1, pull / PULL_THRESHOLD));
  const open = Math.max(pull, phase === 'refreshing' ? PULL_THRESHOLD : 0);
  const settled = phase === 'done' || phase === 'failed';
  const tied = phase === 'refreshing' || phase === 'done' || phase === 'failed' ? 1 : t;

  const say = phase === 'refreshing' ? 'Reading the books…'
    : phase === 'done' || phase === 'failed' ? (news ?? '')
    : phase === 'armed' ? 'Let go — it writes it down'
    : label ? `Pull to read the ${label} again` : 'Pull to read again';

  return createPortal(
    <div className={`pq ${phase}${phase === 'refreshing' ? ' sway' : ''}`}
      style={{ height: Math.round(open) + (phase === 'refreshing' ? 8 : 0), transition: settled || phase === 'refreshing' ? 'height .42s cubic-bezier(.16,1,.3,1)' : 'none' }} aria-hidden="true">
      <style>{CSS}</style>
      <svg className="q" width={Math.round(26 + 12 * t)} height={Math.round(26 + 12 * t)} viewBox="0 0 40 40">
        {/* the bar is the page's own edge, so the cords simply hang from the top of the box */}
        {CORDS.map((c, i) => {
          // Each cord pays out with the pull, the longer ones a touch ahead of the short.
          const grow = Math.max(0, Math.min(1, t * (1.15 - i * 0.06)));
          return <rect key={c.x} className="cord" x={c.x} y={2} width={2.2} rx={1.1} height={Math.max(0.6, c.len * grow)} />;
        })}
        {KNOTS.map((k, i) => (
          <circle key={i} className={`knot${tied >= k.at ? '' : ' off'}`} cx={k.cx} cy={k.cy} r={k.r} />
        ))}
      </svg>
      <span className="say">{say}</span>
    </div>,
    document.body,
  );
}

export default PullQuipu;
