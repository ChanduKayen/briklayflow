/**
 * Briklay marketing landing page. Implements docs/reference/BriklayLanding.jsx
 * verbatim (copy / colors / spacing / keyframe choreography). Rendered at "/"
 * and "/login" for logged-out users only (see App.tsx route gate).
 */
import { useState, useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';
import { ArrowRight, ChevronDown } from 'lucide-react';
import { V, CSS, font, serif, terraGrad, inkGrad } from '../components/landing/landingTokens';
import Gate from '../components/landing/Gate';
import { VignetteCapture, VignettePO, VignetteWO, VignetteTxn } from '../components/landing/Vignettes';

export default function Landing() {
  const [auth, setAuth] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const open = (m: 'signin' | 'signup') => { setMode(m); setAuth(true); };
  void auth; void mode; // consumed by AuthPanel in a later commit

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
      "No forms to learn, no evening data entry. Your team says it the way they'd say it on site, and Briklay files it as clean, verifiable records."
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
        <div className="mx-auto px-5 sm:px-8 h-16 flex items-center gap-6" style={{ maxWidth: 1080 }}>
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
          Built on real sites
        </p>
        <h1
          className="rise mt-5 leading-tight"
          style={{ color: V.ink, fontSize: 'clamp(2.2rem, 5.5vw, 4rem)', animationDelay: '.15s', ...serif }}
        >
          Construction software your
          <br />
          supervisor will actually use.
        </h1>
        <p className="rise text-base sm:text-lg mt-6 mx-auto leading-relaxed" style={{ color: V.sys, maxWidth: 560, animationDelay: '.3s' }}>
          No forms to learn. No evening data entry. Your team says it the way
          they'd say it on site. A payment, a material need, a work order.
          Briklay files it as clean, verifiable records.
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

      {/* manifesto */}
      <section className="mx-auto px-5 sm:px-8 py-16 text-center" style={{ maxWidth: 680 }}>
        <p className="text-2xl sm:text-3xl leading-snug" style={{ color: V.ink, ...serif }}>
          You don't need great technology.
        </p>
        <p className="text-2xl sm:text-3xl leading-snug mt-1" style={{ color: V.terra, ...serif }}>
          You need the right data.
        </p>
        <p className="text-sm sm:text-base mt-6 leading-relaxed" style={{ color: V.sys }}>
          Briklay doesn't wait for your site to report. It chases your
          supervisor on WhatsApp until the information actually arrives. Then
          it cleans it, standardizes it, and files it so anything can be found
          in one search. That's how the books stay true without anyone
          learning software.
        </p>
      </section>

      {/* the magic — live vignettes */}
      <section id="magic" className="mx-auto px-5 sm:px-8 py-14" style={{ maxWidth: 1080 }}>
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
    </div>
  );
}
