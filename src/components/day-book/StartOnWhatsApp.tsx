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
 * Needs VITE_BRIKLAY_WA_NUMBER. If it is not set, the surface says so plainly
 * rather than showing a broken code.
 */
import { useState } from 'react';
import { X, Copy, ExternalLink, Check } from 'lucide-react';
import { V, font, serif, nums, terraGrad, T } from './tokens';
import { WhatsAppGlyph } from './atoms';

const onlyDigits = (s: string) => s.replace(/\D/g, '');

export function StartOnWhatsApp({ onClose, onManageTeam }: { onClose: () => void; onManageTeam?: () => void }) {
  const raw = import.meta.env.VITE_BRIKLAY_WA_NUMBER as string | undefined;
  const digits = raw ? onlyDigits(raw) : '';
  const waUrl = digits ? `https://wa.me/${digits}?text=${encodeURIComponent('Hi Briklay')}` : '';
  const qrUrl = digits ? `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=12&data=${encodeURIComponent(waUrl)}` : '';
  const pretty = digits ? `+${digits}` : '';
  const [copied, setCopied] = useState(false);

  const copy = () => {
    navigator.clipboard?.writeText(pretty).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }).catch(() => { /* noop */ });
  };

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
              Scan this with your phone's camera, or tap Open WhatsApp. Say hi, and Briklay says hi back. Then send your payments and bills the same way.
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
            Only people you have added can send. Manage who can send →
          </button>
        )}
      </div>
    </div>
  );
}
