/**
 * Briklay marketing landing page. Renders the design reference
 * (docs/reference → src/pages/landingV11.html) VERBATIM inside a full-viewport
 * iframe, so its bespoke stylesheet and the JS-driven WhatsApp/dashboard demo run
 * exactly as authored, with no global-CSS leakage into the app. Rendered at "/"
 * for logged-out users only (see App.tsx route gate).
 *
 * Two integrations bridge the static reference to the live app:
 *   • the WhatsApp CTAs open wa.me/917330872705 with a prefilled message (baked
 *     into the .html), and
 *   • the nav "Log in" / "Sign up" links postMessage the parent, which navigates
 *     to the register-book auth screen (LoginRegister, at /login and /signup).
 */
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import landingHtml from './landingV11.html?raw';

export default function Landing() {
  const navigate = useNavigate();

  // The reference's nav auth links postMessage up to here; take the user to the real auth screen.
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      const d = e.data as { type?: string; mode?: string } | null;
      if (!d || d.type !== 'brik-auth') return;
      navigate(d.mode === 'signup' ? '/signup' : '/login');
    };
    window.addEventListener('message', onMsg);
    return () => window.removeEventListener('message', onMsg);
  }, [navigate]);

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
    <iframe
      title="Briklay — AI site engineer + accountant, inside WhatsApp"
      srcDoc={landingHtml}
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, zIndex: 0, display: 'block' }}
    />
  );
}
