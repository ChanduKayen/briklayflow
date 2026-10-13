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
 * The page runs in three chapters: 1) find a prompt (a three-question finder by trade,
 * business size and problem, plus the full library by trade), 2) using the prompt (an
 * animated six-step help guide), 3) building a dashboard on existing Excel data. Then four
 * sample tools as cards with their prompts, the Briklay App block and the home-building ad. All content lives in the .html: the library is the
 * GROUPS / COMMON data at the top of its script, and the demo WhatsApp number is OWNER_WA.
 * Its two images (the home-building ad and the Briklay App block background) are served from
 * public/aibusinesstools/.
 */
import { useEffect } from 'react';
import pageHtml from './aiBusinessTools.html?raw';
import { markBooted } from '../components/brand/bootSignal';

const TITLE = 'Build your own business tools with AI · Briklay';
const DESCRIPTION =
  'Pick your trade and the problem that eats your time, and get a prompt to paste into any AI assistant. 159 prompts for 50 kinds of business, from Briklay Engineering.';

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
