/**
 * Briklay marketing landing page. Implements docs/reference/BriklayLanding.jsx
 * verbatim (copy / colors / spacing / keyframe choreography). Rendered at "/"
 * and "/login" for logged-out users only (see App.tsx route gate).
 */
import { useState, useEffect, useRef } from 'react';
import { V, CSS, font } from '../components/landing/landingTokens';

export default function Landing() {
  const [auth, setAuth] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const open = (m: 'signin' | 'signup') => { setMode(m); setAuth(true); };
  void auth; void mode; void open; // wired to nav/CTAs and AuthPanel in later commits

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
      {/* nav / hero / manifesto / vignettes / site-management / remaining sections / AuthPanel added in subsequent commits */}
    </div>
  );
}
