/**
 * Briklay marketing landing page. Renders the design reference
 * (docs/reference → src/pages/landingV11.html) VERBATIM inside a full-viewport
 * iframe, so its bespoke stylesheet and the JS-driven WhatsApp/dashboard demo run
 * exactly as authored, with no global-CSS leakage into the app. Rendered at "/"
 * and "/login" for logged-out users only (see App.tsx route gate).
 *
 * Two integrations bridge the static reference to the live app:
 *   • the WhatsApp CTAs open wa.me/917330872705 with a prefilled message (baked
 *     into the .html), and
 *   • the nav "Log in" / "Sign up" links postMessage the parent, which opens the
 *     real AuthPanel (email / phone / Google).
 */
import { useEffect, useState } from 'react';
import AuthPanel from '../components/landing/AuthPanel';
import landingHtml from './landingV11.html?raw';

export default function Landing() {
  const [auth, setAuth] = useState(false);
  const [mode, setMode] = useState<'signin' | 'signup'>('signin');
  const [authMethod, setAuthMethod] = useState<'email' | 'phone'>('email');

  // Deep links open the AuthPanel automatically:
  //   • /login                        → sign in (default)
  //   • /signup                       → sign up
  //   • ?method=phone (team-invite button → /login?method=phone) → straight into PHONE SIGNUP
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const path = window.location.pathname;
    if (params.get('method') === 'phone') { setMode('signup'); setAuthMethod('phone'); setAuth(true); return; }
    if (path === '/signup') { setMode('signup'); setAuth(true); return; }
    if (path === '/login') setAuth(true);
  }, []);

  // The reference's nav auth links postMessage up to here; open the real AuthPanel.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; mode?: string } | null;
      if (!d || d.type !== 'brik-auth') return;
      setMode(d.mode === 'signup' ? 'signup' : 'signin');
      setAuthMethod('email');
      setAuth(true);
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, []);

  // Marketing metadata while mounted; restored on unmount.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = 'Briklay · AI site engineer + accountant. Inside WhatsApp.';
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const created = !meta;
    const prevDesc = meta?.getAttribute('content') ?? null;
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'description'); document.head.appendChild(meta); }
    meta.setAttribute('content', 'Briklay is an AI site engineer and accountant inside WhatsApp. Your supervisors text like they always do. Briklay records, checks, and files it: work, attendance, materials, and every rupee.');
    return () => {
      document.title = prevTitle;
      if (created) meta!.remove();
      else if (prevDesc !== null) meta!.setAttribute('content', prevDesc);
    };
  }, []);

  return (
    <>
      <iframe
        title="Briklay — AI site engineer + accountant, inside WhatsApp"
        srcDoc={landingHtml}
        style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, zIndex: 0, display: 'block' }}
      />
      <AuthPanel open={auth} mode={mode} setMode={setMode} initialMethod={authMethod} onClose={() => setAuth(false)} />
    </>
  );
}
