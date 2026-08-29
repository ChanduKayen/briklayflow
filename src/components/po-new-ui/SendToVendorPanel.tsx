/**
 * SendToVendorPanel — the "send this PO to the vendor" summary, shown in a dialog.
 *
 * INNER CONTENT ONLY (no scrim / no box) so it can live inside the save ceremony's dialog
 * (content swap) OR inside SendToVendorModal on the PO detail page — one flow, two entry
 * points. All send/number logic flows through ../../lib/poVendorSend (the swappable seam).
 *
 * Number capture (product decision): the vendor's WhatsApp number lives in
 * stakeholders.contact. If it's already there we show it and go straight to Send; if it's
 * missing we ask once, save it to the vendor, and never ask again.
 *
 * The action is WhatsApp-styled (green, brand glyph) with real states — hover, active,
 * loading (spinner), disabled — and a subtle pop/ring + check-draw once the send lands.
 */
import { useState } from 'react';
import { Package, ChevronLeft } from 'lucide-react';
import { V, nums } from './voiceTokens';
import {
  normalizeWhatsApp, vendorWhatsAppFrom, saveVendorWhatsApp, sendPoToVendor,
} from '../../lib/poVendorSend';

const WA_GREEN    = '#25D366';
const WA_GREEN_DK = '#1EBE57';
const WA_WASH     = '#E7F8EE';

// The WhatsApp brand glyph (lucide has no WhatsApp logo).
const WhatsAppIcon = ({ size = 16 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51l-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893A11.821 11.821 0 0020.465 3.488" />
  </svg>
);

const STV_CSS = `
.stv-send{transition:background .16s ease,transform .12s ease,box-shadow .16s ease}
.stv-send:not(:disabled):hover{background:${WA_GREEN_DK} !important;box-shadow:0 8px 20px -8px rgba(37,211,102,.55)}
.stv-send:not(:disabled):active{transform:scale(.975)}
.stv-send:disabled{cursor:default}
.stv-spin{width:15px;height:15px;border-radius:50%;border:2px solid rgba(255,255,255,.4);border-top-color:#fff;animation:stvSpin .7s linear infinite;display:inline-block}
@keyframes stvSpin{to{transform:rotate(360deg)}}
.stv-seal{position:relative;animation:stvPop .44s cubic-bezier(.22,1,.36,1) both}
.stv-seal::after{content:'';position:absolute;inset:-7px;border-radius:50%;border:2px solid ${WA_GREEN};opacity:0;animation:stvRing .85s .05s ease-out forwards}
@keyframes stvPop{0%{transform:scale(.6);opacity:0}55%{transform:scale(1.08)}100%{transform:scale(1);opacity:1}}
@keyframes stvRing{0%{transform:scale(.55);opacity:.5}100%{transform:scale(1.35);opacity:0}}
.stv-check{stroke-dasharray:26;stroke-dashoffset:26;animation:stvDraw .5s .12s cubic-bezier(.65,0,.35,1) forwards}
@keyframes stvDraw{to{stroke-dashoffset:0}}
.stv-fade{animation:stvFade .34s ease both}
@keyframes stvFade{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:none}}
@media(prefers-reduced-motion:reduce){.stv-seal,.stv-seal::after,.stv-check,.stv-spin,.stv-fade{animation:none;opacity:1;stroke-dashoffset:0}}
`;

interface Props {
  poId: string;
  vendorId: string;
  vendorName?: string | null;
  /** current stakeholders.contact value (may be empty / hold several numbers) */
  vendorContact?: string | null;
  projectName?: string | null;
  /** pre-formatted grand total, e.g. "₹32,210" */
  totalLabel?: string | null;
  /** back to the previous view (ceremony's "order saved" screen). Omit to hide the back arrow. */
  onBack?: () => void;
  /** close the whole dialog (Done, or after a send). */
  onClose: () => void;
}

export default function SendToVendorPanel({
  poId, vendorId, vendorName, vendorContact, projectName, totalLabel, onBack, onClose,
}: Props) {
  const saved = vendorWhatsAppFrom(vendorContact);
  // No saved number → we're capturing it; a saved number → show it, offer "change".
  const [editing, setEditing] = useState(!saved);
  const [input, setInput] = useState(saved ? saved.replace(/^\+/, '') : '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  // The number we'll actually send to: the saved one (not editing) or the typed one.
  const target = editing ? normalizeWhatsApp(input) : saved;
  const canSend = !!target && !busy;

  const send = async () => {
    if (busy) return;
    const to = editing ? normalizeWhatsApp(input) : saved;
    if (!to) { setErr('Enter a valid WhatsApp number (with country code).'); return; }
    setBusy(true); setErr(null);
    try {
      // Persist a newly captured / changed number to the vendor so we never ask again.
      if (to !== saved) await saveVendorWhatsApp(vendorId, to);
      const res = await sendPoToVendor({ poId, to, vendorName, totalLabel, projectName });
      if (!res.ok) throw new Error(res.error || 'Could not send. Try again.');
      setSent(true);
    } catch (e) {
      setErr((e as { message?: string })?.message || 'Could not send. Try again.');
    } finally {
      setBusy(false);
    }
  };

  // ── SENT ──────────────────────────────────────────────────────────────────
  if (sent) {
    return (
      <div className="text-center stv-fade">
        <style>{STV_CSS}</style>
        <div className="stv-seal w-14 h-14 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: WA_WASH }}>
          <svg viewBox="0 0 24 24" width={26} height={26} fill="none" stroke={WA_GREEN} strokeWidth={2.8} strokeLinecap="round" strokeLinejoin="round">
            <path className="stv-check" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <p className="text-lg font-medium" style={{ color: V.user }}>Sent to {vendorName || 'vendor'}</p>
        <p className="text-sm mt-1" style={{ color: V.system }}>
          {poId} · <span style={nums}>{target}</span>
        </p>
        <button
          onClick={onClose}
          className="mt-6 w-full py-3 rounded-xl text-sm font-medium"
          style={{ background: V.user, color: '#fff' }}
        >
          Done
        </button>
      </div>
    );
  }

  // ── COMPOSE ───────────────────────────────────────────────────────────────
  return (
    <div className="text-left">
      <style>{STV_CSS}</style>
      <div className="flex items-center gap-2 mb-4">
        {onBack && (
          <button onClick={onBack} aria-label="Back" className="p-1 -ml-1 rounded-lg" style={{ color: V.system }}>
            <ChevronLeft size={18} />
          </button>
        )}
        <div className="w-9 h-9 rounded-full flex items-center justify-center" style={{ background: WA_WASH, color: WA_GREEN }}>
          <WhatsAppIcon size={18} />
        </div>
        <div>
          <p className="text-base font-medium leading-tight" style={{ color: V.user }}>Send this PO to the vendor</p>
          <p className="text-xs" style={{ color: V.systemFaint }}>They get it on WhatsApp, with the PO PDF</p>
        </div>
      </div>

      {/* Summary of what's being sent */}
      <div className="rounded-xl p-3.5 mb-4" style={{ background: V.field, border: `1px solid ${V.line}` }}>
        <div className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium" style={{ color: V.user }}>
            <Package size={14} color={V.system} /> {poId}
          </span>
          {totalLabel && <span className="text-sm font-medium" style={{ color: V.user, ...nums }}>{totalLabel}</span>}
        </div>
        <p className="text-xs mt-1.5" style={{ color: V.system }}>
          {[vendorName, projectName].filter(Boolean).join(' · ') || '—'}
        </p>
      </div>

      {/* Number: saved (use it) OR capture once */}
      {editing ? (
        <div className="mb-4">
          <label className="block text-xs font-medium mb-1.5" style={{ color: V.userSoft }}>
            Vendor's WhatsApp number
          </label>
          <div className="flex items-center rounded-xl overflow-hidden" style={{ border: `1px solid ${V.lineStrong}`, background: V.surface }}>
            <span className="px-3 py-2.5 text-sm" style={{ background: V.field, color: V.system, borderRight: `1px solid ${V.line}` }}>+</span>
            <input
              autoFocus
              inputMode="tel"
              value={input}
              onChange={(e) => { setInput(e.target.value.replace(/[^\d+\s]/g, '')); setErr(null); }}
              placeholder="91 98765 43210"
              className="flex-1 px-3 py-2.5 text-sm outline-none"
              style={{ color: V.user, background: 'transparent', ...nums }}
            />
          </div>
          <p className="text-xs mt-1.5" style={{ color: V.systemFaint }}>
            Saved to this vendor — we won't ask again.
          </p>
          {saved && (
            <button onClick={() => { setEditing(false); setInput(saved.replace(/^\+/, '')); setErr(null); }} className="text-xs mt-1.5" style={{ color: V.accent }}>
              Cancel
            </button>
          )}
        </div>
      ) : (
        <div className="flex items-center justify-between rounded-xl p-3 mb-4" style={{ background: V.surface, border: `1px solid ${V.line}` }}>
          <div>
            <p className="text-xs" style={{ color: V.systemFaint }}>Sending to</p>
            <p className="text-sm font-medium" style={{ color: V.user, ...nums }}>{saved}</p>
          </div>
          <button onClick={() => setEditing(true)} className="text-xs font-medium" style={{ color: V.accent }}>Change</button>
        </div>
      )}

      {err && <p className="text-xs mb-3" style={{ color: V.accentDeep }}>{err}</p>}

      <div className="flex gap-2.5">
        <button
          onClick={onClose}
          className="flex-1 py-3 rounded-xl text-sm font-medium"
          style={{ border: `1px solid ${V.line}`, color: V.user }}
        >
          Not now
        </button>
        <button
          onClick={send}
          disabled={!canSend}
          className="stv-send flex-1 py-3 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2"
          style={{ background: canSend ? WA_GREEN : V.line, color: '#fff' }}
        >
          {busy ? <><span className="stv-spin" /> Sending…</> : <><WhatsAppIcon size={16} /> Send message</>}
        </button>
      </div>
    </div>
  );
}
