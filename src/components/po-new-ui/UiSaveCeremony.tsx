/**
 * UiSaveCeremony — the page's single dramatic beat (brief §5).
 *
 * Pure presentation around the EXISTING save mutation. It renders only after
 * the mutation's success path flips `uiCeremonyOpen` (a cosmetic, dead-ended
 * flag). "View PO" and the scrim call `onLeave` (the page's existing
 * navigate(...)). "Send to Vendor" swaps the dialog's content in place for the
 * SendToVendorPanel (same box), then Done/"Not now" leaves. There is
 * intentionally NO "New order" button: no form-reset path exists.
 *
 * UI-only. Reads nothing from the resolution pipeline.
 */
import { useState } from 'react';
import { Check, Truck, FileText, Camera, ChevronRight, MessageCircle, Copy } from 'lucide-react';
import { V, nums } from './voiceTokens';
import SendToVendorPanel from './SendToVendorPanel';

interface UiSaveCeremonyProps {
  open: boolean;
  /** Generated PO id from the mutation result (saveMutation.data). */
  poId?: string;
  vendorName?: string;
  /** stakeholder_id of the vendor — needed to send the PO to them. */
  vendorId?: string;
  /** current stakeholders.contact for the vendor (may be empty). */
  vendorContact?: string | null;
  projectName?: string;
  /** Pre-formatted grand total, e.g. "₹32,210". */
  totalLabel: string;
  /** The page's existing navigate(...) — used by View PO, Done, and scrim. */
  onLeave: () => void;
}

export default function UiSaveCeremony({
  open, poId, vendorName, vendorId, vendorContact, projectName, totalLabel, onLeave,
}: UiSaveCeremonyProps) {
  const [mode, setMode] = useState<'saved' | 'send'>('saved');
  const [copied, setCopied] = useState(false);
  const copyPo = () => {
    if (!poId) return;
    navigator.clipboard?.writeText(poId).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1800); }).catch(() => { /* clipboard blocked */ });
  };
  if (!open) return null;

  const subtitleParts = ['Order saved', vendorName, projectName].filter(Boolean);
  const canSend = !!poId && !!vendorId;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div
        className="absolute inset-0"
        style={{ background: 'rgba(30,26,21,0.5)' }}
        onClick={onLeave}
        aria-hidden="true"
      />
      <div
        className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 pb-8 sm:pb-6 text-center motion-safe:animate-scale-in"
        style={{ background: V.surface }}
        role="dialog"
        aria-modal="true"
        aria-label={mode === 'send' ? 'Send PO to vendor' : 'Order saved'}
      >
        {mode === 'send' && poId && vendorId ? (
          <SendToVendorPanel
            poId={poId}
            vendorId={vendorId}
            vendorName={vendorName}
            vendorContact={vendorContact}
            projectName={projectName}
            totalLabel={totalLabel}
            onBack={() => setMode('saved')}
            onClose={onLeave}
          />
        ) : (
          <>
            <div
              className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
              style={{ background: V.confirmWash }}
            >
              <Check size={22} strokeWidth={2.5} color={V.confirm} />
            </div>

            {poId && (
              <button
                type="button"
                onClick={copyPo}
                className="group inline-flex items-center gap-2 mx-auto px-3.5 py-1.5 rounded-xl transition-all active:scale-[0.98]"
                style={{ background: copied ? V.confirmWash : V.field, border: `1px solid ${copied ? V.confirm : V.line}` }}
                title="Copy PO number"
                aria-label={copied ? 'PO number copied' : 'Copy PO number'}
              >
                <span className="text-2xl font-medium tracking-tight" style={{ color: copied ? V.confirm : V.user, ...nums }}>{poId}</span>
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold" style={{ color: copied ? V.confirm : V.systemFaint }}>
                  {copied
                    ? <><Check size={13} /> Copied</>
                    : <span className="inline-flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity"><Copy size={13} /> Copy</span>}
                </span>
              </button>
            )}
            <p className="text-sm mt-1" style={{ color: V.system }}>
              {subtitleParts.join(' · ')}
            </p>
            <p className="text-sm mt-0.5" style={{ color: V.user, ...nums }}>
              {totalLabel} <span style={{ color: V.systemFaint }}>excl. GST</span>
            </p>

            {/* Lifecycle rail — decorative "what's next" (0 of 3 complete) */}
            <div className="flex gap-1 mt-6 mb-2" aria-label="0 of 3 lifecycle steps complete">
              {[0, 1, 2].map((i) => (
                <div key={i} className="flex-1 rounded-full" style={{ height: 4, background: V.line }} />
              ))}
            </div>
            <div className="flex justify-between text-xs mb-5" style={{ color: V.systemFaint }}>
              <span className="inline-flex items-center gap-1" style={{ color: V.askDeep }}>
                <Truck size={12} /> goods receival — next
              </span>
              <span className="inline-flex items-center gap-1"><FileText size={12} /> bill entry</span>
              <span className="inline-flex items-center gap-1"><Camera size={12} /> bill photo</span>
            </div>

            <div className="flex gap-2.5">
              {/* Was "Done" — now the vendor send, the new hero action. Falls back to Done
                  when we don't have what a send needs (poId + vendorId). */}
              <button
                onClick={() => (canSend ? setMode('send') : onLeave())}
                className="flex-1 py-3 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1.5"
                style={{ background: V.user, color: '#fff' }}
              >
                {canSend ? <><MessageCircle size={15} /> Send to Vendor</> : 'Done'}
              </button>
              <button
                onClick={onLeave}
                className="flex-1 py-3 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1"
                style={{ border: `1px solid ${V.line}`, color: V.user }}
              >
                View PO <ChevronRight size={15} />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
