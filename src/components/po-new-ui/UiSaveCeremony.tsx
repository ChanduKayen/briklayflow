/**
 * UiSaveCeremony — the page's single dramatic beat (brief §5).
 *
 * Pure presentation around the EXISTING save mutation. It renders only after
 * the mutation's success path flips `uiCeremonyOpen` (a cosmetic, dead-ended
 * flag). Every exit — scrim, "Done", "View PO" — calls the SAME `onLeave`,
 * which is the page's existing `navigate(...)` with identical arguments
 * (decision 1). There is intentionally NO "New order" button: no form-reset
 * path exists and one must not be built.
 *
 * UI-only. Reads nothing from the resolution pipeline.
 */
import { Check, Truck, FileText, Camera, ChevronRight } from 'lucide-react';
import { V, nums } from './voiceTokens';

interface UiSaveCeremonyProps {
  open: boolean;
  /** Generated PO id from the mutation result (saveMutation.data). */
  poId?: string;
  vendorName?: string;
  projectName?: string;
  /** Pre-formatted grand total, e.g. "₹32,210". */
  totalLabel: string;
  /** The page's existing navigate(...) — used by Done, View PO, and scrim. */
  onLeave: () => void;
}

export default function UiSaveCeremony({
  open, poId, vendorName, projectName, totalLabel, onLeave,
}: UiSaveCeremonyProps) {
  if (!open) return null;

  const subtitleParts = ['Order saved', vendorName, projectName].filter(Boolean);

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
        aria-label="Order saved"
      >
        <div
          className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center"
          style={{ background: V.confirmWash }}
        >
          <Check size={22} strokeWidth={2.5} color={V.confirm} />
        </div>

        {poId && (
          <p className="text-2xl font-medium" style={{ color: V.user, ...nums }}>{poId}</p>
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
          <button
            onClick={onLeave}
            className="flex-1 py-3 rounded-xl text-sm font-medium"
            style={{ border: `1px solid ${V.line}`, color: V.user }}
          >
            Done
          </button>
          <button
            onClick={onLeave}
            className="flex-1 py-3 rounded-xl text-sm font-medium inline-flex items-center justify-center gap-1"
            style={{ background: V.user, color: '#fff' }}
          >
            View PO <ChevronRight size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
