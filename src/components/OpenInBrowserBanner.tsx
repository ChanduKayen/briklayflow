// WHY THIS EXISTS — the WhatsApp in-app browser is a dead end for a logged-in app.
//
// A deep link tapped inside WhatsApp opens in WhatsApp's own WebView, not Chrome/Safari. That WebView
// is a SEPARATE, often-wiped cookie/localStorage jar, so the Supabase session isn't there — the user
// lands on the login screen every time, and Google sign-in is frequently blocked outright
// (disallowed_useragent). The only reliable cure is to leave that WebView for the real browser, where
// the session persists. On Android we can force Chrome with an intent:// URL; on iOS there is no
// programmatic escape, so we tell the user the one gesture that works (Share → Open in Safari).
import { useEffect, useMemo, useState } from 'react';

function detect() {
  const ua = typeof navigator !== 'undefined' ? (navigator.userAgent || '') : '';
  const android = /Android/i.test(ua);
  // WhatsApp's Android WebView carries "WhatsApp" in the UA; also catch the other common in-app webviews.
  const inApp = /WhatsApp/i.test(ua) || /FBAN|FBAV|Instagram|Line\//i.test(ua) || (android && /\bwv\b/.test(ua));
  return { android, inApp };
}

export function OpenInBrowserBanner() {
  const { android, inApp } = useMemo(detect, []);
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    try { if (sessionStorage.getItem('oib:dismissed') === '1') setDismissed(true); } catch { /* private mode */ }
  }, []);
  if (!inApp || dismissed) return null;

  const openExternal = () => {
    const href = window.location.href;
    if (android) {
      // intent:// hands the URL to Chrome directly. If Chrome isn't installed the browser_fallback_url
      // keeps them on the same page rather than erroring.
      const noScheme = href.replace(/^https?:\/\//, '');
      const fallback = encodeURIComponent(href);
      window.location.href =
        `intent://${noScheme}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${fallback};end`;
      return;
    }
    // iOS / everything else: no force. Copy the link so they can paste it into Safari.
    try {
      navigator.clipboard?.writeText(href);
    } catch { /* clipboard blocked */ }
  };

  const dismiss = () => { setDismissed(true); try { sessionStorage.setItem('oib:dismissed', '1'); } catch { /* ignore */ } };

  return (
    <div style={S.bar} role="status">
      <span style={S.icon} aria-hidden="true">🔒</span>
      <span style={S.txt}>
        {android
          ? "You're in WhatsApp's browser — sign-in won't stick here."
          : "You're in WhatsApp's browser — open in Safari so you stay signed in."}
      </span>
      <button type="button" style={S.cta} onClick={openExternal}>
        {android ? 'Open in Chrome' : 'Copy link'}
      </button>
      <button type="button" style={S.x} onClick={dismiss} aria-label="Dismiss">✕</button>
    </div>
  );
}

const S: Record<string, React.CSSProperties> = {
  bar: {
    position: 'sticky', top: 0, zIndex: 9999,
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '9px 12px', background: '#2F2622', color: '#F6F2EA',
    font: '500 13px/1.35 "DM Sans", system-ui, sans-serif',
    boxShadow: '0 2px 8px rgba(0,0,0,.18)',
  },
  icon: { flex: 'none', fontSize: 15 },
  txt: { flex: 1, minWidth: 0 },
  cta: {
    flex: 'none', background: '#C4502B', color: '#fff', border: 0,
    borderRadius: 8, padding: '7px 12px', font: '600 13px/1 "DM Sans", sans-serif', cursor: 'pointer',
  },
  x: { flex: 'none', background: 'none', border: 0, color: '#C7BCAC', fontSize: 13, cursor: 'pointer', padding: '4px 2px' },
};
