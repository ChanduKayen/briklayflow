/**
 * Briklay marketing landing page. Implements docs/reference/BriklayLanding.jsx
 * verbatim (copy / colors / spacing / keyframe choreography). Rendered at "/"
 * and "/login" for logged-out users only (see App.tsx route gate).
 */
import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Check, Video, Phone, MoreVertical } from 'lucide-react';
import { V, SEG, CSS, font, serif, nums, terraGrad, inkGrad, bandGrad } from '../components/landing/landingTokens';
import Gate from '../components/landing/Gate';
import { AppWin, Bloom, ChapterTag } from '../components/landing/AppShell';
import { VignetteCapture, VignettePO, VignetteWO, VignetteTxn } from '../components/landing/Vignettes';
import AuthPanel from '../components/landing/AuthPanel';

export default function Landing() {
  const [auth, setAuth] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const open = (m: 'signin' | 'signup') => { setMode(m); setAuth(true); };

  // Brick-grid hero hover: rAF lerp toward the pointer, written to CSS vars.
  const heroRef = useRef<HTMLElement>(null);
  const heroPos = useRef({ x: 440, y: 220, tx: 440, ty: 220 });
  useEffect(() => {
    let raf: number;
    const tick = () => {
      const p = heroPos.current;
      p.x += (p.tx - p.x) * 0.12;
      p.y += (p.ty - p.y) * 0.12;
      if (heroRef.current) {
        heroRef.current.style.setProperty('--mx', `${p.x}px`);
        heroRef.current.style.setProperty('--my', `${p.y}px`);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // /login deep-link opens the AuthPanel in signin mode (panel defaults to signin).
  useEffect(() => {
    if (typeof window !== 'undefined' && window.location?.pathname === '/login') setAuth(true);
  }, []);

  // Marketing metadata while mounted; restored on unmount.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Briklay — Construction software your supervisor will actually use';
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const created = !meta;
    const prevDesc = meta?.getAttribute('content') ?? null;
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'description');
      document.head.appendChild(meta);
    }
    meta.setAttribute(
      'content',
      "Briklay asks the right questions on WhatsApp; your team replies the way they already talk. What your site says becomes what your app shows. Verified."
    );
    return () => {
      document.title = prevTitle;
      if (created) meta!.remove();
      else if (prevDesc !== null) meta!.setAttribute('content', prevDesc);
    };
  }, []);

  return (
    <div className="min-h-screen" style={{ background: V.page, color: V.ink, ...font }}>
      <link
        href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,400;9..40,500;9..40,600;9..40,700&display=swap"
        rel="stylesheet"
      />
      <style>{CSS}</style>

      {/* nav */}
      <nav className="sticky top-0 z-40" style={{ background: 'rgba(251,249,246,0.85)', backdropFilter: 'blur(8px)', borderBottom: `1px solid ${V.line}` }}>
        <div className="mx-auto px-5 sm:px-8 h-16 flex items-center gap-6" style={{ maxWidth: 1280 }}>
          <p className="text-lg font-semibold" style={{ color: V.ink }}>
            Briklay<span style={{ color: V.terra }}>.</span>
          </p>
          <div className="hidden sm:flex gap-5 text-sm" style={{ color: V.sys }}>
            <a href="#magic" className="navlink" style={{ color: 'inherit', textDecoration: 'none' }}>Product</a>
            <a href="#why" className="navlink" style={{ color: 'inherit', textDecoration: 'none' }}>Why Briklay</a>
            <a href="#builder" className="navlink" style={{ color: 'inherit', textDecoration: 'none' }}>Our story</a>
          </div>
          <span className="flex-1" />
          <button onClick={() => open('signin')} className="tlink text-sm font-medium" style={{ color: V.ink }}>
            Sign in
          </button>
          <button
            onClick={() => open('signup')}
            className="btnp text-sm font-medium px-4 py-2.5 rounded-xl hidden sm:inline-flex items-center gap-1.5"
            style={{ background: inkGrad, color: '#fff' }}
          >
            Start free <ArrowRight size={14} className="arr" />
          </button>
        </div>
      </nav>

      {/* hero */}
      <section
        ref={heroRef}
        className="relative mx-auto px-5 sm:px-8 pt-16 sm:pt-24 pb-14 text-center"
        style={{ maxWidth: 880, '--reveal': 0 } as CSSProperties}
        onMouseEnter={(e) => e.currentTarget.style.setProperty('--reveal', '1')}
        onMouseLeave={(e) => e.currentTarget.style.setProperty('--reveal', '0')}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          heroPos.current.tx = e.clientX - r.left;
          heroPos.current.ty = e.clientY - r.top;
        }}
      >
        <div
          className="heroglow absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            background: 'radial-gradient(300px circle at var(--mx, 50%) var(--my, 35%), rgba(188,75,39,0.035), transparent 70%)',
            opacity: 'var(--reveal, 0)',
            transition: 'opacity .6s ease',
          } as CSSProperties}
        />
        <div
          className="herobricks absolute inset-0 pointer-events-none"
          aria-hidden="true"
          style={{
            backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='56' height='32'%3E%3Cpath d='M0 0H56M0 16H56M28 0V16M14 16V32M42 16V32' stroke='%23BC4B27' stroke-opacity='0.16' stroke-width='1'/%3E%3C/svg%3E")`,
            WebkitMaskImage: 'radial-gradient(200px circle at var(--mx, 50%) var(--my, 40%), rgba(0,0,0,0.55), rgba(0,0,0,0.18) 55%, transparent 80%)',
            maskImage: 'radial-gradient(200px circle at var(--mx, 50%) var(--my, 40%), rgba(0,0,0,0.55), rgba(0,0,0,0.18) 55%, transparent 80%)',
            opacity: 'var(--reveal, 0)',
            transition: 'opacity .6s ease',
          } as CSSProperties}
        />
        <p className="rise text-xs font-medium uppercase" style={{ color: V.terraDeep, letterSpacing: '0.14em', animationDelay: '.05s' }}>
          India's human-first construction software
        </p>
        <h1
          className="rise mt-5 leading-tight"
          style={{ color: V.ink, fontSize: 'clamp(2.2rem, 5.5vw, 4rem)', animationDelay: '.15s', ...serif }}
        >
           Construction software your
          <br />
          supervisor will actually use.
        </h1>
        <p className="rise text-base sm:text-lg mt-6 mx-auto leading-relaxed" style={{ color: V.sys, maxWidth: 580, animationDelay: '.3s' }}>
          Briklay asks the right questions on WhatsApp, and your team replies
          the way they already talk. What your site says becomes what your app
          shows. Verified.
        </p>
        <div className="rise mt-8 flex items-center justify-center gap-3 flex-wrap" style={{ animationDelay: '.45s' }}>
          <button
            onClick={() => open('signup')}
            className="btnp text-sm font-medium px-6 py-3.5 rounded-xl inline-flex items-center gap-2"
            style={{ background: terraGrad, color: '#fff' }}
          >
            Start free <ArrowRight size={15} className="arr" />
          </button>
          <a
            href="#magic"
            className="btng text-sm font-medium px-6 py-3.5 rounded-xl inline-flex items-center gap-2"
            style={{ border: `1px solid ${V.line}`, color: V.ink, textDecoration: 'none' }}
          >
            See it work <ChevronDown size={15} />
          </a>
        </div>
        <p className="rise text-xs mt-5" style={{ color: V.faint, animationDelay: '.55s' }}>
          no card needed · works in Telugu and English
        </p>
      </section>

      {/* manifesto — the brick corrects the industry's sentence */}
      <Gate>
        <section className="mx-auto px-5 sm:px-8 py-20 sm:py-28 text-center" style={{ maxWidth: 720 }}>
          {/* Fluid size + nowrap keeps line 1 on ONE line at every width, so the gap
              parting "don't" in never wraps to a 2nd line (that wrap caused the jump). */}
          <p className="bl1 leading-tight whitespace-nowrap" style={{ color: V.ink, fontSize: 'clamp(1rem, 5vw, 2.5rem)', ...serif }}>
            <span className="bshk inline-block">
              You{' '}
              <span className="inline-block align-bottom" style={{ position: 'relative', whiteSpace: 'pre' }}>
                <span className="bgap inline-block align-bottom" style={{ overflow: 'hidden' }}>
                  <span className="bdw inline-block" style={{ color: V.terra }}>don't&nbsp;</span>
                </span>
                <span
                  className="bfall"
                  aria-hidden="true"
                  style={{ position: 'absolute', left: '50%', bottom: '0.16em', width: 17, height: 11, background: V.terra, borderRadius: 2 }}
                />
              </span>
              need great technology.
            </span>
          </p>
          <p className="bl2 text-lg sm:text-2xl leading-snug mt-3" style={{ color: V.terra, ...serif }}>
            You just need the right data from your site.
          </p>
          <p className="bbody text-sm sm:text-base mt-8 mx-auto leading-relaxed" style={{ color: V.sys, maxWidth: 560 }}>
            Briklay doesn't wait for your site to report. It{' '}
            <b style={{ color: V.inkSoft, fontWeight: 600 }}>chases</b> your data
            on WhatsApp, <b style={{ color: V.inkSoft, fontWeight: 600 }}>cleans</b> it,{' '}
            <b style={{ color: V.inkSoft, fontWeight: 600 }}>standardizes</b> it,
            and <b style={{ color: V.inkSoft, fontWeight: 600 }}>files</b> it.
            The books stay true without anyone learning software.
          </p>
          <p className="bbody mt-7 text-base sm:text-lg" style={{ color: V.inkSoft, ...serif, fontStyle: 'italic' }}>
            There's serious AI under Briklay. You'll never have to see
            it. You'll just see the right data, arriving.
          </p>
        </section>
      </Gate>

      {/* the magic — live vignettes */}
      <section id="magic" className="mx-auto px-5 sm:px-8 py-14" style={{ maxWidth: 1280 }}>
        <p className="text-center text-2xl sm:text-3xl" style={{ color: V.ink, ...serif }}>
          Construction <span style={{ color: V.terra, borderBottom: `2px dashed ${V.askLine}` }}>Magic</span>, shown, not told.
        </p>
        <p className="text-center text-sm mt-3" style={{ color: V.sys }}>
          These aren't screenshots. This is the product, running. Watch one
          order travel: created, tracked, paid. Then the same discipline for
          assigned work.
        </p>
        <Gate className="mt-10">
          <VignetteCapture />
        </Gate>
        <div className="grid sm:grid-cols-3 gap-4 mt-4">
          <Gate><VignettePO /></Gate>
          <Gate><VignetteTxn /></Gate>
          <Gate><VignetteWO /></Gate>
        </div>
      </section>

      {/* site management — the star chapter: board and WhatsApp, side by side */}
      <section style={{ background: V.field }}>
        <div className="mx-auto px-5 sm:px-8 py-20" style={{ maxWidth: 1280 }}>
          <div className="text-center">
            <ChapterTag n="05" label="Site management" />
          </div>
          <h2 className="text-center text-3xl sm:text-4xl mt-4 leading-snug" style={{ color: V.ink, ...serif }}>
            Describe your project in one line.
            <br />
            Briklay sets it up, and runs it.
          </h2>
          <p className="text-center text-sm sm:text-base mt-5 mx-auto leading-relaxed" style={{ color: V.sys, maxWidth: 620 }}>
            Type the scope the way you'd say it. Briklay creates the tasks and
            the quality checks itself, then asks your supervisor on WhatsApp
            for whatever is missing, and keeps asking until the data is whole.
          </p>
          <p className="text-center text-base sm:text-lg mt-5" style={{ color: V.inkSoft, ...serif, fontStyle: 'italic' }}>
            We don't rely on what's provided. We ask for what's needed.
          </p>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-8 mt-9">
            {[
              ['1', 'You describe the project, in one line.'],
              ['2', 'Briklay creates the tasks and quality checks.'],
              ['3', 'It asks your site on WhatsApp, and files every answer.'],
            ].map(([n, t]) => (
              <p key={n} className="text-sm" style={{ color: V.sys, ...font }}>
                <b className="mr-1.5" style={{ color: V.terraDeep, ...serif, fontSize: 16 }}>{n}</b>
                {t}
              </p>
            ))}
          </div>

          <Gate className="relative grid sm:grid-cols-2 gap-8 sm:gap-10 mt-12 mx-auto items-start" style={{ maxWidth: 920 }}>

            {/* the cause-and-effect wire between the two worlds */}
            <div className="hidden sm:block absolute" aria-hidden="true" style={{ left: '50%', top: 314, width: 72, transform: 'translateX(-50%)', zIndex: 1 }}>
              <div className="relative overflow-hidden" style={{ height: 14 }}>
                <span className="beamOut absolute" style={{ left: -52, top: 5.5, width: 48, height: 3, borderRadius: 3, background: 'linear-gradient(90deg, transparent, rgba(188,75,39,0.55) 40%, rgba(199,85,48,0.95) 62%, rgba(255,224,205,0.95) 74%, rgba(188,75,39,0.9) 84%, transparent)', boxShadow: '0 0 7px rgba(188,75,39,0.45)' }} />
                <span className="beamBack absolute" style={{ left: 80, top: 5.5, width: 48, height: 3, borderRadius: 3, background: 'linear-gradient(270deg, transparent, rgba(47,93,52,0.55) 40%, rgba(63,115,69,0.95) 62%, rgba(214,238,216,0.95) 74%, rgba(47,93,52,0.9) 84%, transparent)', boxShadow: '0 0 7px rgba(47,93,52,0.45)' }} />
              </div>
            </div>

            {/* demo 1 — the Briklay board */}
            <div>
              <div className="flex justify-center mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.sys, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', ...font }}>
                  <b style={{ color: V.terraDeep }}>You see</b>&nbsp;· the project building itself
                </span>
              </div>
              <div className="vcard rounded-2xl p-5 sm:p-6" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
                <Bloom />
                <AppWin title="Project tasks">
                <p className="text-xs" style={{ color: V.faint, ...font }}>Describe your project</p>
                <p className="text-sm font-medium mt-1.5" style={{ color: V.ink, ...font }}>
                  <span className="typeP">G+2 residence, 1550 sft each floor</span><span className="cursW"><span className="blinkc" style={{ color: V.terra }}>|</span></span>
                </p>
                <div className="relative mt-2 mb-4" style={{ height: 18, overflow: 'hidden' }}>
                  <div className="digA absolute inset-0 flex items-center gap-1.5">
                    <span className="pdot w-1.5 h-1.5 rounded-full" style={{ background: V.terra }} />
                    <span className="pdot w-1.5 h-1.5 rounded-full" style={{ background: V.terra, animationDelay: '.18s' }} />
                    <span className="pdot w-1.5 h-1.5 rounded-full" style={{ background: V.terra, animationDelay: '.36s' }} />
                    <span className="text-xs ml-1" style={{ color: V.faint, fontStyle: 'italic', ...font }}>reading your project&#8230;</span>
                  </div>
                  <div className="digB absolute inset-0">
                    <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>
                      &#10003; understood · 3 floors · 1,550 sft each · structure &amp; finishing
                    </p>
                  </div>
                </div>
                <div className="space-y-3.5">
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk1 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: '58%' }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: 'italic', ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: '72%' }} />
                    </div>
                    <div className="tk1 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[0] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>Footings &amp; plinth</p>
                        <span className="text-xs" style={{ color: V.faint, ...font }}>created</span>
                      </div>
                      <p className="text-xs ml-5 mt-0.5" style={{ color: V.faint, ...font }}>QC: rebar cover · pour photos · level check</p>
                    </div>
                  </div>
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk2 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: '58%' }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: 'italic', ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: '72%' }} />
                    </div>
                    <div className="tk2 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[1] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>GF brickwork</p>
                        <span className="text-xs" style={{ color: V.faint, ...font }}>created</span>
                      </div>
                      <p className="text-xs ml-5 mt-0.5" style={{ color: V.faint, ...font }}>QC: line &amp; level · joint thickness</p>
                    </div>
                  </div>
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk3 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: '58%' }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: 'italic', ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: '72%' }} />
                    </div>
                    <div className="tk3 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[2] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>2nd floor slab · curing</p>
                        <span className="relative shrink-0" style={{ width: 104, height: 16 }}>
                          <span className="st1 absolute inset-0 text-xs text-right" style={{ color: V.faint, ...font }}>created</span>
                          <span className="st2 absolute inset-0 text-xs text-right" style={{ color: '#6B4407', ...font }}>follow-up sent</span>
                          <span className="st3 absolute inset-0 text-xs text-right" style={{ color: V.sage, ...font }}>&#10003; QC passed</span>
                        </span>
                      </div>
                      <div className="relative ml-5 mt-0.5" style={{ height: 16 }}>
                        <p className="st1 absolute inset-0 text-xs" style={{ color: V.faint, ...font }}>QC: day-3 photos · surface check</p>
                        <p className="st2 absolute inset-0 text-xs" style={{ color: '#854F0B', ...font }}>asked the supervisor for photos · just now</p>
                        <p className="st3 absolute inset-0 text-xs" style={{ color: V.sage, ...font }}>2 photos verified · answered in 40 min</p>
                      </div>
                    </div>
                  </div>
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk4 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: '58%' }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: 'italic', ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: '72%' }} />
                    </div>
                    <div className="tk4 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[0] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>1st floor columns</p>
                        <span className="text-xs" style={{ color: V.faint, ...font }}>created</span>
                      </div>
                      <p className="text-xs ml-5 mt-0.5" style={{ color: V.faint, ...font }}>QC: verticality · cover blocks · pour photos</p>
                    </div>
                  </div>
                  <div className="relative" style={{ height: 38 }}>
                    <div className="sk5 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: V.line }} />
                        <span className="shimmer rounded flex-1" style={{ height: 11, maxWidth: '58%' }} />
                        <span className="text-xs" style={{ color: V.faint, fontStyle: 'italic', ...font }}>creating&#8230;</span>
                      </div>
                      <span className="shimmer rounded block ml-5 mt-2" style={{ height: 8, width: '72%' }} />
                    </div>
                    <div className="tk5 absolute inset-x-0 top-0">
                      <div className="flex items-center gap-2.5">
                        <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: SEG[1] }} />
                        <p className="text-sm font-medium flex-1" style={{ color: V.ink, ...font }}>Bathroom waterproofing</p>
                        <span className="text-xs" style={{ color: V.faint, ...font }}>created</span>
                      </div>
                      <p className="text-xs ml-5 mt-0.5" style={{ color: V.faint, ...font }}>QC: slope check · pond test photos</p>
                    </div>
                  </div>
                </div>
                <div className="tkC rounded-xl px-3.5 py-2.5 mt-4" style={{ background: V.field }}>
                  <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>
                    &#10003; 5 tasks · 13 quality checks created from one line
                  </p>
                </div>
                </AppWin>
                <div className="relative mt-3" style={{ height: 18, overflow: 'hidden' }}>
                  <p className="nar1 absolute inset-0 text-xs font-medium leading-snug" style={{ color: V.terraDeep, ...font }}>
                    Tasks and quality checks created automatically.
                  </p>
                  <p className="nar2 absolute inset-0 text-xs font-medium leading-snug" style={{ color: V.terraDeep, ...font }}>
                    It asks your supervisor when information is missing.
                  </p>
                  <p className="nar3 absolute inset-0 text-xs font-medium leading-snug" style={{ color: V.terraDeep, ...font }}>
                    Every reply gets saved against the right task.
                  </p>
                </div>
              </div>
            </div>

            {/* demo 2 — the supervisor's WhatsApp */}
            <div>
              <div className="flex justify-center mb-3">
                <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full" style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.sys, fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase', ...font }}>
                  <b style={{ color: V.terraDeep }}>Your supervisor sees</b>&nbsp;· just a WhatsApp chat
                </span>
              </div>
              <div className="vcard rounded-2xl p-5 sm:p-6" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
                <Bloom />
              <div
                className="relative mx-auto rounded-2xl overflow-hidden"
                style={{
                  zIndex: 1,
                  maxWidth: 300,
                  background: '#ECE5DD',
                  backgroundImage: 'radial-gradient(circle at 8px 8px, rgba(69,57,42,0.05) 1.3px, transparent 1.6px), radial-gradient(circle at 21px 22px, rgba(69,57,42,0.04) 1px, transparent 1.3px)',
                  backgroundSize: '28px 28px',
                  border: `1px solid ${V.line}`,
                  boxShadow: '0 6px 20px rgba(30,26,21,0.08)',
                }}
              >
                {/* WhatsApp header — the supervisor is chatting with verified Briklay */}
                <div className="flex items-center gap-2 px-2.5 py-2" style={{ background: '#008069' }}>
                  <ArrowLeft size={16} color="#FFFFFF" />
                  <span className="w-8 h-8 rounded-full flex items-center justify-center shrink-0" style={{ background: V.terra }}>
                    <span style={{ color: '#FFFFFF', fontSize: 15, fontWeight: 700, ...serif }}>B</span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 text-xs font-medium truncate" style={{ color: '#FFFFFF', ...font }}>
                      Briklay
                      <span className="inline-flex items-center justify-center rounded-full shrink-0" style={{ width: 13, height: 13, background: '#1B9DE2' }}>
                        <Check size={9} color="#FFFFFF" strokeWidth={3.5} />
                      </span>
                    </p>
                    <p style={{ color: '#C7E9E2', fontSize: 10, ...font }}>online</p>
                  </div>
                  <Video size={15} color="#FFFFFF" />
                  <Phone size={13} color="#FFFFFF" />
                  <MoreVertical size={15} color="#FFFFFF" />
                </div>
                <div className="relative px-3 py-3" style={{ minHeight: 332 }}>
                  {/* date chip — mid-chat crop */}
                  <div className="flex justify-center mb-3">
                    <span className="rounded-lg px-2 py-1" style={{ background: 'rgba(255,255,255,0.92)', color: '#54656F', fontSize: 10, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)', ...font }}>TODAY</span>
                  </div>
                  <p className="pE absolute inset-x-0 text-center text-xs" style={{ color: '#8696A0', top: 156, ...font }}>
                    nothing pending today
                  </p>

                  {/* Briklay asks — incoming, left, with reply buttons */}
                  <div className="pMsg1">
                    <div className="mr-auto relative rounded-lg px-2 py-1.5" style={{ background: '#FFFFFF', maxWidth: 228, borderTopLeftRadius: 0, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
                      <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: -7, width: 0, height: 0, borderTop: '0 solid transparent', borderBottom: '10px solid transparent', borderRight: '8px solid #FFFFFF' }} />
                      <p className="text-xs leading-snug" style={{ color: '#111B21', ...font }}>
                        Suresh garu, 2nd floor slab &#183; day-3 curing. Status?
                      </p>
                      <p className="text-right" style={{ color: '#667781', fontSize: 10, marginTop: 2, ...font }}>9:02 am</p>
                    </div>
                    <div className="mr-auto mt-1 space-y-1" style={{ maxWidth: 228 }}>
                      <div className="optSel text-center py-1.5 rounded-lg" style={{ color: '#00A5F4', fontSize: 12, fontWeight: 500, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)', ...font }}>
                        Curing done
                      </div>
                      <div className="text-center py-1.5 rounded-lg" style={{ background: '#FFFFFF', color: '#00A5F4', fontSize: 12, fontWeight: 500, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)', ...font }}>
                        Still in progress
                      </div>
                      <div className="text-center py-1.5 rounded-lg" style={{ background: '#FFFFFF', color: '#00A5F4', fontSize: 12, fontWeight: 500, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)', ...font }}>
                        Issue on site
                      </div>
                    </div>
                  </div>

                  {/* Suresh selects — outgoing, right */}
                  <div className="pSel mt-2.5">
                    <div className="ml-auto relative rounded-lg px-2 py-1.5" style={{ background: '#D9FDD3', maxWidth: 160, borderTopRightRadius: 0, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
                      <span aria-hidden="true" style={{ position: 'absolute', top: 0, right: -7, width: 0, height: 0, borderBottom: '10px solid transparent', borderLeft: '8px solid #D9FDD3' }} />
                      <p className="text-xs leading-snug" style={{ color: '#111B21', ...font }}>
                        Curing done
                        <span style={{ color: '#667781', fontSize: 10, marginLeft: 8 }}>9:38 am <span style={{ color: '#53BDEB' }}>&#10003;&#10003;</span></span>
                      </p>
                    </div>
                  </div>

                  {/* Briklay asks for proof — incoming, left */}
                  <div className="pMsg2 mt-2.5">
                    <div className="mr-auto relative rounded-lg px-2 py-1.5" style={{ background: '#FFFFFF', maxWidth: 228, borderTopLeftRadius: 0, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
                      <span aria-hidden="true" style={{ position: 'absolute', top: 0, left: -7, width: 0, height: 0, borderBottom: '10px solid transparent', borderRight: '8px solid #FFFFFF' }} />
                      <p className="text-xs leading-snug" style={{ color: '#111B21', ...font }}>
                        Super. 2 photos of the slab surface please?
                        <span style={{ color: '#667781', fontSize: 10, marginLeft: 8 }}>9:38 am</span>
                      </p>
                    </div>
                  </div>

                  {/* Suresh sends the site photo — outgoing, right, time on image */}
                  <div className="pPhoto mt-2.5">
                    <div className="ml-auto relative rounded-lg" style={{ background: '#D9FDD3', maxWidth: 178, padding: 3, borderTopRightRadius: 0, boxShadow: '0 1px 0.5px rgba(11,20,26,0.13)' }}>
                      <span aria-hidden="true" style={{ position: 'absolute', top: 0, right: -7, width: 0, height: 0, borderBottom: '10px solid transparent', borderLeft: '8px solid #D9FDD3' }} />
                      <div className="relative rounded-md overflow-hidden">
                        <svg viewBox="0 0 172 96" width="100%" height="92" preserveAspectRatio="none" aria-hidden="true">
                          <rect width="172" height="96" fill="#A8A296" />
                          <rect y="62" width="172" height="34" fill="#98917f" />
                          <ellipse cx="66" cy="47" rx="50" ry="17" fill="#7E7869" opacity="0.85" />
                          <ellipse cx="58" cy="42" rx="24" ry="7" fill="#C9C4B6" opacity="0.5" />
                          <rect y="80" width="172" height="16" fill="#8A6B49" />
                          <rect y="80" width="172" height="2.5" fill="#6E5439" />
                          <line x1="0" y1="62" x2="172" y2="62" stroke="#6F6A5D" strokeWidth="1" opacity="0.6" />
                          <circle cx="126" cy="32" r="2" fill="#6F6A5D" /><circle cx="142" cy="52" r="1.6" fill="#6F6A5D" /><circle cx="26" cy="24" r="1.8" fill="#6F6A5D" /><circle cx="102" cy="68" r="1.5" fill="#7E7869" />
                        </svg>
                        <span className="absolute top-1 left-1 rounded px-1" style={{ background: 'rgba(17,27,33,0.5)', color: '#fff', fontSize: 9, ...font }}>1 of 2</span>
                        <span className="absolute bottom-1 right-1.5" style={{ color: '#fff', fontSize: 10, textShadow: '0 1px 2px rgba(0,0,0,0.6)', ...font }}>
                          9:41 am <span style={{ color: '#53BDEB' }}>&#10003;&#10003;</span>
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
              </div>
            </div>

          </Gate>

          <p className="text-center text-lg sm:text-xl mt-10" style={{ color: V.inkSoft, ...serif }}>
            You set up nothing. You get the honest picture.
          </p>
        </div>
      </section>

      {/* the whole picture — cross-checked into one actionable call */}
      <section className="mx-auto px-5 sm:px-8 py-16" style={{ maxWidth: 760 }}>
        <p className="text-center text-xs font-medium uppercase" style={{ color: V.faint, letterSpacing: '0.14em' }}>
          The whole picture
        </p>
        <h2 className="text-center text-2xl sm:text-3xl mt-4 leading-snug" style={{ color: V.ink, ...serif }}>
          Everything cross-checks everything.
        </h2>
        <p className="text-center text-sm sm:text-base mt-5 mx-auto leading-relaxed" style={{ color: V.sys, maxWidth: 600 }}>
          Purchase orders, work orders, and tasks aren't three separate
          registers. Briklay reads them together, the way an experienced
          auditor and a site engineer would, and tells you what they'd catch.
        </p>

        <Gate className="mt-10">
          <div className="vcard rounded-2xl p-5 sm:p-6" style={{ background: V.surface, border: '1px solid #E3DDD4' }}>
            <Bloom />
            <div className="flex items-center justify-center gap-2 flex-wrap">
              {['Purchase orders', 'Work orders', 'Tasks'].map((t, i) => (
                <span key={t} className={`xch${i} text-xs px-2.5 py-1 rounded-full`} style={{ background: V.field, color: V.inkSoft, ...font }}>{t}</span>
              ))}
            </div>
            <div className="mx-auto my-1" style={{ maxWidth: 320 }}>
              <svg viewBox="0 0 300 58" width="100%" height="58" fill="none" aria-hidden="true" style={{ display: 'block' }}>
                <path className="xp0" d="M45 4 C45 34 150 26 150 52" stroke={V.terra} strokeWidth="1.5" strokeLinecap="round" pathLength="100" strokeDasharray="100" />
                <path className="xp1" d="M150 4 L150 52" stroke={V.terra} strokeWidth="1.5" strokeLinecap="round" pathLength="100" strokeDasharray="100" />
                <path className="xp2" d="M255 4 C255 34 150 26 150 52" stroke={V.terra} strokeWidth="1.5" strokeLinecap="round" pathLength="100" strokeDasharray="100" />
                <circle className="xhl" cx="150" cy="52" r="4" stroke={V.terra} strokeWidth="1.5" />
                <circle className="xnd" cx="150" cy="52" r="3.5" fill={V.terra} style={{ transformBox: 'fill-box', transformOrigin: 'center' }} />
              </svg>
            </div>
            <div className="xcard">
            <AppWin title="Site review · The Pride">
              <p className="text-sm font-medium" style={{ color: V.ink, ...font }}>
                Cement is over-ordered for the work that's left.
              </p>
              <div className="space-y-1.5 mt-3">
                <div className="xr1 flex items-start gap-2">
                  <span className="shrink-0 rounded px-1.5 py-0.5" style={{ background: V.field, color: V.faint, fontSize: 10, letterSpacing: '0.06em', ...font }}>PO</span>
                  <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>240 bags OPC 53 received across PO-0141 and PO-0152</p>
                </div>
                <div className="xr2 flex items-start gap-2">
                  <span className="shrink-0 rounded px-1.5 py-0.5" style={{ background: V.field, color: V.faint, fontSize: 10, letterSpacing: '0.06em', ...font }}>Tasks</span>
                  <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>plastering 60% complete, verified by site photos</p>
                </div>
                <div className="xr3 flex items-start gap-2">
                  <span className="shrink-0 rounded px-1.5 py-0.5" style={{ background: V.field, color: V.faint, fontSize: 10, letterSpacing: '0.06em', ...font }}>WO</span>
                  <p className="text-xs" style={{ color: V.inkSoft, ...font, ...nums }}>remaining stages need about 90 bags</p>
                </div>
              </div>
              <div className="xcl rounded-xl px-3.5 py-3 mt-3.5" style={{ background: V.field }}>
                <p className="text-xs leading-relaxed" style={{ color: V.ink, ...font, ...nums }}>
                  You're carrying roughly 70 bags more than the remaining work
                  needs. Cement older than 3 months loses strength.
                </p>
                <p className="text-xs mt-1.5 font-medium" style={{ color: V.terraDeep, ...font }}>
                  Worth doing: hold the next cement order &#8594;
                </p>
              </div>
            </AppWin>
            </div>
            <p className="xcp text-xs mt-3" style={{ color: V.faint, ...font }}>
              the evidence first, then the call. Never a number without its reason
            </p>
          </div>
        </Gate>
      </section>

      {/* why — questions */}
      <section id="why" className="py-16" style={{ background: V.surface, borderTop: `1px solid ${V.line}`, borderBottom: `1px solid ${V.line}` }}>
        <div className="mx-auto px-5 sm:px-8 grid sm:grid-cols-3 gap-10" style={{ maxWidth: 1280 }}>
          {[
            ['Where did the money go?', "Every payment answers a question before it settles: against which purchase order, which work order, which stage? A rupee with no parent gets flagged, never quietly filed. That's where leaks used to live."],
            ["What's pending on site?", "Every purchase order shows its own next step: goods, bill, photo. Nothing waits in someone's memory."],
            ['Will my site team actually use it?', "They won't be typing. The AI is. Pages read like sentences, questions come in plain Telugu and English, and a bill photo files itself."],
          ].map(([q, a]) => (
            <div key={q}>
              <h3 className="text-lg" style={{ color: V.ink, ...serif }}>{q}</h3>
              <p className="text-sm mt-2.5 leading-relaxed" style={{ color: V.sys }}>{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* the colleague — vision, honestly marked */}
      <section className="mx-auto px-5 sm:px-8 py-20" style={{ maxWidth: 1280 }}>
        <div className="grid sm:grid-cols-2 gap-10 items-center">
          <div>
            <p className="text-xs font-medium uppercase" style={{ color: V.faint, letterSpacing: '0.14em' }}>
              Coming next
            </p>
            <h2 className="text-2xl sm:text-3xl mt-4 leading-snug" style={{ color: V.ink, ...serif }}>
              You don't change where you work.
              <br />
              We come to where you work.
            </h2>
            <p className="text-sm mt-4 leading-relaxed" style={{ color: V.sys }}>
              Say it on WhatsApp. You stay there. Briklay runs the complete
              back office behind it: files it, checks the rate against what
              you last paid, chases the supervisor for photos, flags what
              doesn't add up. Then it brings you the site's honest story, the
              way a good site engineer would.
            </p>
            <p className="text-base mt-5" style={{ color: V.inkSoft, ...serif }}>
              A site engineer + an assistant = <b>Briklay</b>.
            </p>
            <button
              onClick={() => open('signup')}
              className="btnp mt-6 text-sm font-medium px-5 py-3 rounded-xl inline-flex items-center gap-2"
              style={{ border: `1px solid ${V.line}`, color: V.ink, background: V.surface }}
            >
              Join the early list <ArrowRight size={14} className="arr" />
            </button>
          </div>

          {/* chat mock */}
          <div className="vcard rounded-3xl p-4 sm:p-5" style={{ background: V.field, border: `1px solid ${V.line}` }}>
            <div className="space-y-2.5">
              <div className="ml-auto max-w-xs rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ background: V.sageWash }}>
                <p className="text-sm" style={{ color: V.ink }}>paid 20,000 to A Raju for Sunshine Residence</p>
              </div>
              <div className="mr-auto max-w-xs rounded-2xl rounded-bl-md px-3.5 py-2.5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                <p className="text-sm" style={{ color: V.ink }}>
                  Recorded. <b style={nums}>− ₹20,000</b> to A Raju · Sunshine
                  Residence. He has an open work order here: brickwork, stage
                  2 of 4 (<span style={nums}>₹65,000</span> milestone). Link
                  this payment there, or is it separate?
                </p>
              </div>
              <div className="ml-auto max-w-xs rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ background: V.sageWash }}>
                <p className="text-sm" style={{ color: V.ink }}>need kankara 20mm, 2 lorry</p>
              </div>
              <div className="mr-auto max-w-xs rounded-2xl rounded-bl-md px-3.5 py-2.5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                <p className="text-sm" style={{ color: V.ink }}>
                  Drafted PO: coarse aggregate · 20mm · 14 MT. Want me to get
                  quotes from your 3 aggregate vendors first?
                </p>
              </div>
              <div className="ml-auto max-w-xs rounded-2xl rounded-br-md px-3.5 py-2.5" style={{ background: V.sageWash }}>
                <p className="text-sm" style={{ color: V.ink }}>how's quality at The Pride?</p>
              </div>
              <div className="mr-auto max-w-xs rounded-2xl rounded-bl-md px-3.5 py-2.5" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
                <p className="text-sm" style={{ color: V.ink }}>
                  2nd-floor plastering passed QC yesterday (photos on file).
                  One flag: bathroom waterproofing. Supervisor's photos show
                  curing started a day early. I've asked him about it.
                </p>
              </div>
            </div>
            <p className="text-xs mt-4 text-center" style={{ color: V.faint }}>
              in development · shown as designed
            </p>
          </div>
        </div>
      </section>

      {/* the builder */}
      <section id="builder" className="mx-auto px-5 sm:px-8 py-20 text-center" style={{ maxWidth: 760 }}>
        <p className="text-xs font-medium uppercase" style={{ color: V.faint, letterSpacing: '0.14em' }}>
          The Briklay story
        </p>
        <p className="text-2xl sm:text-3xl mt-5" style={{ color: V.ink, ...serif }}>
          Built by builders, for builders.
        </p>
        <p className="text-lg sm:text-xl mt-5 leading-relaxed" style={{ color: V.inkSoft, ...serif }}>
          “Briklay wasn't designed in a boardroom. It comes from 200,000+ sq ft
          of delivered work, turned into software by a passionate group of
          engineers who know exactly where money and time leak on a site.”
        </p>
        <p className="text-sm mt-5" style={{ color: V.sys }}>
          Briklay Engineering
        </p>
      </section>

      {/* final CTA */}
      <section className="mx-auto px-5 sm:px-8 pb-24 text-center" style={{ maxWidth: 760 }}>
        <div className="rounded-3xl px-6 py-12" style={{ background: bandGrad }}>
          <p className="text-2xl sm:text-3xl" style={{ color: '#fff', ...serif }}>
            Run your next project on Briklay.
          </p>
          <p className="text-sm mt-3" style={{ color: 'rgba(255,255,255,0.65)' }}>
            Free to start. Honest pricing when you grow. Your data stays yours.
          </p>
          <button
            onClick={() => open('signup')}
            className="btnp mt-7 text-sm font-medium px-7 py-3.5 rounded-xl inline-flex items-center gap-2"
            style={{ background: terraGrad, color: '#fff' }}
          >
            Start free <ArrowRight size={15} className="arr" />
          </button>
        </div>
      </section>

      {/* footer */}
      <footer style={{ borderTop: `1px solid ${V.line}` }}>
        <div className="mx-auto px-5 sm:px-8 py-8 flex items-center gap-3 flex-wrap text-xs" style={{ maxWidth: 1280, color: V.faint }}>
          <p className="font-semibold text-sm" style={{ color: V.ink }}>
            Briklay<span style={{ color: V.terra }}>.</span>
          </p>
          <span>· built by builders, for builders</span>
          <span className="flex-1" />
          <a href="/privacy" className="tlink" style={{ color: V.faint }}>Privacy</a>
          <a href="/terms" className="tlink" style={{ color: V.faint }}>Terms</a>
          <a href="/data-deletion" className="tlink" style={{ color: V.faint }}>Data deletion</a>
          <span>© 2026 Briklay Engineering</span>
          <button onClick={() => open('signin')} className="tlink" style={{ color: V.sys }}>Sign in</button>
        </div>
      </footer>

      <AuthPanel open={auth} mode={mode} setMode={setMode} onClose={() => setAuth(false)} />
    </div>
  );
}
