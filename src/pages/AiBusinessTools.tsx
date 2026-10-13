/**
 * /aibusinesstools — the web half of the printed "Build your own business tools with AI"
 * handout. The QR on the card lands here.
 *
 * Same approach as the marketing landing (Landing.tsx): the page is one self-contained
 * HTML file (src/pages/aiBusinessTools.html) rendered VERBATIM inside a full-viewport
 * iframe, so its stylesheet and scripts run as authored with no global-CSS leakage into
 * the app. It needs nothing from the app: no session, no Supabase, no router state.
 * Public: rendered before every auth gate (see App.tsx), like /privacy and /demo.
 *
 * What is on the page: a prompt builder, the customer-estimator prompt from the talk,
 * and five working sample tools, each with the prompt that builds it. All content and
 * rates live in the .html; the demo WhatsApp number is the OWNER_WA constant there.
 */
import { useEffect } from 'react';
import pageHtml from './aiBusinessTools.html?raw';
import { markBooted } from '../components/brand/bootSignal';

const TITLE = 'Build your own business tools with AI · Briklay';
const DESCRIPTION =
  'Fill in the blanks for your business, copy the prompt, and paste it into any AI assistant. A prompt builder and five working sample tools, from Briklay Engineering.';

export default function AiBusinessTools() {
  // This page needs nothing from auth, so don't hold the boot loader over it while the session
  // resolves: a visitor scanning the card on mobile data should see the page, not the splash.
  useEffect(() => { markBooted(); }, []);

  // Page metadata while mounted; restored on unmount.
  useEffect(() => {
    const prevTitle = document.title;
    document.title = TITLE;
    let meta = document.querySelector('meta[name="description"]') as HTMLMetaElement | null;
    const created = !meta;
    const prevDesc = meta?.getAttribute('content') ?? null;
    if (!meta) { meta = document.createElement('meta'); meta.setAttribute('name', 'description'); document.head.appendChild(meta); }
    meta.setAttribute('content', DESCRIPTION);
    return () => {
      document.title = prevTitle;
      if (created) meta!.remove();
      else if (prevDesc !== null) meta!.setAttribute('content', prevDesc);
    };
  }, []);

  return (
    <iframe
      title="Build your own business tools with AI"
      srcDoc={pageHtml}
      // The page's whole job is "copy the prompt": grant clipboard explicitly so it works
      // in browsers that gate the async clipboard API inside frames.
      allow="clipboard-write"
      style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', border: 0, zIndex: 0, display: 'block', background: '#fff' }}
    />
  );
}
