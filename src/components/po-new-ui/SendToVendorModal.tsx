/**
 * SendToVendorModal — the PO detail page's entry into the same "send PO to vendor" flow the
 * save ceremony uses. Scrim + dialog box (matching UiSaveCeremony's shell) wrapping the shared
 * SendToVendorPanel, so there is ONE flow with two entry points (post-create + detail page).
 */
import { V } from './voiceTokens';
import SendToVendorPanel from './SendToVendorPanel';

interface Props {
  open: boolean;
  poId: string;
  vendorId: string;
  vendorName?: string | null;
  vendorContact?: string | null;
  projectName?: string | null;
  totalLabel?: string | null;
  onClose: () => void;
}

export default function SendToVendorModal({ open, onClose, ...panel }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0" style={{ background: 'rgba(30,26,21,0.5)' }} onClick={onClose} aria-hidden="true" />
      <div
        className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 pb-8 sm:pb-6 motion-safe:animate-scale-in"
        style={{ background: V.surface }}
        role="dialog"
        aria-modal="true"
        aria-label="Send PO to vendor"
      >
        <SendToVendorPanel {...panel} onClose={onClose} />
      </div>
    </div>
  );
}
