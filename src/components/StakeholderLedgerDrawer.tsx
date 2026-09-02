import { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { PartyLedgerView } from '../pages/StakeholderDetail';

// One ledger across the app: this side drawer is just a slide-over shell around the SAME
// PartyLedgerView the /stakeholders/:id page renders — in its `compact`, mobile-first form. All
// the balance logic (and the voided-transaction exclusion) lives in one place, loadPartyLedger.

interface StakeholderLedgerDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  stakeholderId: string;
  /** Kept for call-site compatibility (the WhatsApp deep-link passes a site). The unified ledger has
   *  its own By-site view; an initial site filter can hang off this later if needed. */
  projectId?: string | null;
}

export default function StakeholderLedgerDrawer({ isOpen, onClose, stakeholderId }: StakeholderLedgerDrawerProps) {
  const [mounted, setMounted] = useState(false);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setClosing(false);
      // Double rAF so the DOM is painted off-screen before the transform transitions in.
      requestAnimationFrame(() => requestAnimationFrame(() => setMounted(true)));
    }
  }, [isOpen]);

  const handleClose = () => {
    setClosing(true);
    setTimeout(() => { setMounted(false); setClosing(false); onClose(); }, 320);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen) handleClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen && !closing) return null;
  const visible = mounted && !closing;

  // Portal to <body> so no host page's scoped CSS (e.g. the Parties page's `.pt .ledger` grid)
  // can reach into the ledger's own `.plx table.ledger` and break its layout.
  return createPortal(
    <>
      {/* Width: ~75% of the screen on desktop so the ledger breathes; full-screen on a phone. */}
      <style>{`
        .stk-ledger-drawer{width:75vw;max-width:1240px}
        @media (max-width:900px){.stk-ledger-drawer{width:100vw;max-width:none;border-left:0}}
      `}</style>
      {/* Backdrop */}
      <div
        onClick={handleClose}
        style={{
          position: 'fixed', inset: 0, zIndex: 49,
          background: 'rgba(24,24,27,0.25)', backdropFilter: 'blur(4px)',
          opacity: visible ? 1 : 0, transition: 'opacity .35s cubic-bezier(.16,1,.3,1)',
        }}
      />
      {/* Slide-over — the compact ledger scrolls inside it */}
      <div
        className="stk-ledger-drawer"
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0, zIndex: 50,
          height: '100vh',
          background: '#FBF9F6', borderLeft: '1px solid #EAE6DE',
          transform: visible ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform .42s cubic-bezier(.16,1,.3,1)',
          boxShadow: '-12px 0 40px rgba(28,25,23,0.06)',
          overflowY: 'auto', overflowX: 'hidden',
        }}
      >
        <PartyLedgerView stakeholderId={stakeholderId} compact onClose={handleClose} />
      </div>
    </>,
    document.body,
  );
}
