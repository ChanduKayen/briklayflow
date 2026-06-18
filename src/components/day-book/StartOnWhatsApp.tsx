/**
 * Start on WhatsApp — the onboarding surface for a WhatsApp-first product.
 *
 * Shows a QR to scan with a phone, the number to message, and a one-tap "Open
 * WhatsApp" link. The person says hi, and Briklay's auto-responder greets them
 * back (the honest direction; a business cannot message a user unprompted
 * without an approved template).
 *
 * The QR is a hosted image of the wa.me click-to-chat link (a network image, not
 * a bundle dependency, so it respects the no-new-deps rule and is trivial to
 * swap for a vendored generator later). The link is a public click-to-chat URL,
 * nothing sensitive.
 *
 * The number is hardcoded (it doesn't change) — the single source of truth, so a
 * stale VITE_BRIKLAY_WA_NUMBER in the deploy env can't override it.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { X, Copy, ExternalLink, Check } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { V, font, serif, nums, terraGrad, T } from './tokens';
import { WhatsAppGlyph } from './atoms';

const onlyDigits = (s: string) => s.replace(/\D/g, '');

export function StartOnWhatsApp({ onClose, onManageTeam }: { onClose: () => void; onManageTeam?: () => void }) {
  // The Briklay WhatsApp business number — hardcoded (it doesn't change). Single
  // source of truth: no env override, so a stale VITE_BRIKLAY_WA_NUMBER can't win.
  const raw = '+91 7330872705';
  const digits = onlyDigits(raw);
  const [copied, setCopied] = useState(false);

  // Mint a one-time-window claim token so the number that messages from here is
  // auto-registered into this org (no "you're not registered" wall). The whole
  // surface still works without it (plain "Hi Briklay") if the call fails.
  const [token, setToken] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    supabase.rpc('wa_create_link_token').then(({ data, error }) => {
      if (alive && !error && typeof data === 'string') setToken(data);
    });
    return () => { alive = false; };
  }, []);

  const message = token ? `Hi Briklay! Please add me to my team.\n\nJoin code: ${token}` : 'Hi Briklay';
  const waUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : '';
  const qrUrl = digits ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=12&data=${encodeURIComponent(waUrl)}` : '';
  const pretty = digits ? `+${digits}` : '';

  const copy = () => {
    navigator.clipboard?.writeText(pretty).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => { /* noop */ });
  };

  // On a phone, a QR you'd scan with the same device is useless — open WhatsApp
  // directly instead. We still wait a beat for the claim token so the number gets
  // self-registered, then navigate (a navigation, not a popup, so it's never blocked).
  const isMobile = useMemo(() => /android|iphone|ipad|ipod|iemobile|mobile/i.test(navigator.userAgent), []);
  const redirected = useRef(false);
  const openDirect = useCallback(() => {
    if (redirected.current || !waUrl) return;
    redirected.current = true;
    window.location.href = waUrl;
  }, [waUrl]);
  useEffect(() => {
    if (!isMobile || !digits) return;
    if (token) { openDirect(); return; }      // token ready → go now
    const t = setTimeout(openDirect, 1500);     // otherwise go shortly regardless
    return () => clearTimeout(t);
  }, [isMobile, token, digits, openDirect]);

  if (isMobile && digits) {
    return (
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(30,26,21,0.4)' }} onClick={onClose}>
        <div className="db-drop w-full rounded-2xl p-6 text-center" style={{ maxWidth: 320, background: V.surface, border: '1px solid #E3DDD4', boxShadow: '0 20px 50px rgba(30,26,21,0.22)' }} onClick={(e) => e.stopPropagation()}>
          <span className="w-11 h-11 rounded-2xl inline-flex items-center justify-center" style={{ background: 'rgba(37,211,102,0.12)' }}>
            <WhatsAppGlyph size={20} />
          </span>
          <p className="mt-3" style={{ color: V.ink, ...serif, fontSize: '1.15rem' }}>Opening WhatsApp…</p>
          <p className="mt-1.5 leading-relaxed" style={{ color: V.sys, ...font, ...T.sm }}>
            If it doesn't open on its own, tap below. The number you message from is saved as your Briklay number.
          </p>
          <a href={waUrl} className="mt-4 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium" style={{ background: terraGrad, color: '#fff', ...font, ...T.sm }}>
            Open WhatsApp <ExternalLink size={14} />
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4" style={{ background: 'rgba(30,26,21,0.4)' }} onClick={onClose}>
      <div className="db-drop w-full rounded-2xl p-6" style={{ maxWidth: 380, background: V.surface, border: '1px solid #E3DDD4', boxShadow: '0 20px 50px rgba(30,26,21,0.22)' }} onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0" style={{ background: 'rgba(37,211,102,0.12)' }}>
              <WhatsAppGlyph size={18} />
            </span>
            <p style={{ color: V.ink, ...serif, fontSize: '1.2rem' }}>Message Briklay</p>
          </div>
          <button onClick={onClose} aria-label="Close"><X size={18} style={{ color: V.faint }} /></button>
        </div>

        {digits ? (
          <>
            <p className="mt-3 leading-relaxed" style={{ color: V.sys, ...font, ...T.sm }}>
              Scan this with your phone's camera, or tap Open WhatsApp. The number you message from is saved as your Briklay number — so everything you send comes in under your name. Then just send your payments and bills the same way.
            </p>

            <div className="mt-4 flex justify-center">
              <div className="rounded-xl p-3" style={{ background: '#fff', border: `1px solid ${V.line}` }}>
                <img src={qrUrl} alt="Scan to message Briklay on WhatsApp" width={200} height={200} style={{ display: 'block', width: 200, height: 200 }} />
              </div>
            </div>

            <button onClick={copy} className="mt-4 w-full flex items-center justify-center gap-2 py-2 rounded-xl" style={{ background: V.field, color: V.inkSoft, ...font, ...nums, ...T.sm }}>
              {copied ? <><Check size={14} style={{ color: V.sage }} /> Copied</> : <><Copy size={13} style={{ color: V.faint }} /> {pretty}</>}
            </button>

            <a href={waUrl} target="_blank" rel="noopener noreferrer" className="mt-2.5 w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl font-medium" style={{ background: terraGrad, color: '#fff', ...font, ...T.sm }}>
              Open WhatsApp <ExternalLink size={14} />
            </a>
          </>
        ) : (
          <p className="mt-3 leading-relaxed" style={{ color: V.sys, ...font, ...T.sm }}>
            Briklay's WhatsApp number isn't set up yet. Ask your Briklay admin to add it, and this becomes a code your team can scan to start sending.
          </p>
        )}

        {onManageTeam && (
          <button onClick={onManageTeam} className="mt-4 w-full text-center" style={{ color: V.faint, ...font, ...T.xs }}>
            See who's on your team →
          </button>
        )}
      </div>
    </div>
  );
}
