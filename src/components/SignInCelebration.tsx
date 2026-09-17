/**
 * SignInCelebration — the "red dot becomes a door" moment, at the app level.
 *
 * The login screen (loginV1.html) designs a celebration where the wordmark's red dot
 * expands into a full-screen door ("Opening your sites."). But a real login sets the
 * Supabase session, which flips auth state and UNMOUNTS the login iframe instantly —
 * so the iframe's own animation never gets to play.
 *
 * This component lives ABOVE the auth-gated tree (mounted in main.tsx beside BootLoader),
 * so it survives that flip. On a successful sign-in, LoginRegister dispatches a
 * `brik-celebrate` window event; we play the door here for ~2.2s — over the same beat the
 * app would otherwise spend on a plain loading splash — then reveal the app underneath.
 *
 * The animations are pure CSS that auto-play on mount (no JS enter-trigger, so nothing to
 * race with React StrictMode). Reduced-motion gets a short, still version. Fully isolated:
 * it touches no auth logic, only listens for one event.
 */
import { useEffect, useState } from 'react';

type Detail = { mode?: 'login' | 'signup'; name?: string };

const RED = 'radial-gradient(circle at center,#B4462F 0%,#A63C29 38%,#8A3022 70%,#6E2519 100%)';

export default function SignInCelebration() {
  const [detail, setDetail] = useState<Detail | null>(null);

  useEffect(() => {
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let removeTimer = 0;
    const onCelebrate = (e: Event) => {
      clearTimeout(removeTimer);
      setDetail(((e as CustomEvent).detail ?? {}) as Detail);
      removeTimer = window.setTimeout(() => setDetail(null), reduced ? 900 : 2200);
    };
    window.addEventListener('brik-celebrate', onCelebrate as EventListener);
    return () => { window.removeEventListener('brik-celebrate', onCelebrate as EventListener); clearTimeout(removeTimer); };
  }, []);

  if (!detail) return null;
  const signup = detail.mode === 'signup';
  const first = (detail.name ?? '').trim().split(' ')[0];
  const title = signup ? `Welcome${first ? ', ' + first : ''}.` : 'Opening your sites.';
  const sub = signup ? 'Your firm and first site come next.' : 'Attendance, issues and Books, filed while you were away.';

  const ox = typeof window !== 'undefined' ? window.innerWidth / 2 : 0;
  const oy = 44;   // roughly where the login wordmark's dot sits

  return (
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 2147483000, pointerEvents: 'none' }}>
      <style>{`
        @keyframes bsc-bgin{to{opacity:1}}
        @keyframes bsc-open{0%{width:8px;height:8px;opacity:0}6%{opacity:1}100%{width:280vmax;height:280vmax;opacity:1}}
        @keyframes bsc-fade{to{opacity:1}}
        /* opaque paper backdrop, fades in fast — so the app + its mobile nav underneath never
           flicker through the expanding door (the login page is already this colour). */
        .bsc-bg{position:fixed;inset:0;background:#F7F6F1;opacity:0;animation:bsc-bgin .16s ease forwards}
        @media(prefers-reduced-motion:reduce){.bsc-bg{opacity:1;animation:none}}
        @keyframes bsc-up{to{opacity:1;transform:none}}
        @keyframes bsc-draw{to{transform:scaleX(1)}}
        @keyframes bsc-ripple{0%{opacity:0;width:8px;height:8px}10%{opacity:.22}100%{opacity:0;width:240vmax;height:240vmax}}
        .bsc-door{position:fixed;left:${ox}px;top:${oy}px;width:8px;height:8px;transform:translate(-50%,-50%);
          background:${RED};border-radius:50%;opacity:0;animation:bsc-open 1.2s cubic-bezier(.7,0,.25,1) forwards}
        .bsc-in{position:fixed;inset:0;display:grid;place-items:center;text-align:center;color:#F7ECE6;
          font-family:'Bricolage Grotesque',system-ui,-apple-system,'Segoe UI',sans-serif;
          font-weight:700;letter-spacing:-.02em;font-size:clamp(1.4rem,4.4vw,2rem);opacity:0;
          animation:bsc-fade .3s ease .55s forwards}
        .bsc-ripple{position:fixed;left:${ox}px;top:${oy}px;width:8px;height:8px;transform:translate(-50%,-50%);
          border-radius:50%;border:1px solid rgba(247,236,230,.6);opacity:0;animation:bsc-ripple 2.6s cubic-bezier(.2,.6,.3,1) both}
        .bsc-ripple:nth-child(2){animation-delay:.35s}
        .bsc-ripple:nth-child(3){animation-delay:.7s}
        .bsc-txt span{display:block;opacity:0;transform:translateY(10px);animation:bsc-up .55s cubic-bezier(.2,.8,.3,1) .8s both}
        .bsc-txt .rule{display:block;height:1.5px;width:56px;margin:14px auto 12px;background:rgba(247,236,230,.5);transform:scaleX(0);transform-origin:left;animation:bsc-draw .5s cubic-bezier(.2,.8,.3,1) 1.1s both}
        .bsc-txt small{display:block;opacity:0;transform:translateY(8px);font-weight:500;font-size:.95rem;color:rgba(247,236,230,.72);margin-top:8px;animation:bsc-up .55s cubic-bezier(.2,.8,.3,1) 1.25s both}
        @media(prefers-reduced-motion:reduce){
          .bsc-door{opacity:1;width:280vmax;height:280vmax;animation:none}
          .bsc-in{opacity:1;animation:none}
          .bsc-ripple{display:none}
          .bsc-txt span,.bsc-txt .rule,.bsc-txt small{opacity:1;transform:none;animation:none}
        }
      `}</style>
      <div className="bsc-bg" />
      <div className="bsc-door" />
      <div className="bsc-in">
        <i className="bsc-ripple" /><i className="bsc-ripple" /><i className="bsc-ripple" />
        <div className="bsc-txt">
          <span>{title}</span>
          <i className="rule" />
          <small>{sub}</small>
        </div>
      </div>
    </div>
  );
}
