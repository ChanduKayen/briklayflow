/**
 * TrackChip — the gentle nudge on a payment row's "not linked" slot. Tapping it opens
 * the right hub in place: a worker payment → the job/contract hub (ContractHub); a
 * material-vendor payment → the purchase hub (VendorHub). This component is just the
 * trigger + the floating container; each hub owns its own data and confirmation.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Hammer, Package, ChevronDown } from 'lucide-react';
import { V, font } from './ledgerTokens';
import type { TrackTxn } from '../../lib/trackingApi';
import { ContractHub, CONTRACT_HUB_CSS } from './ContractHub';
import { VendorHub, VENDOR_HUB_CSS } from './VendorHub';

type Kind = 'WO' | 'PO';

export function TrackChip({ txn, onLinked }: { txn: TrackTxn; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right: number }>({ top: 0, right: 0 });

  const kind: Kind = txn.stakeholders?.type === 'Vendor' ? 'PO' : 'WO';
  const nudge = kind === 'PO' ? 'Are you tracking this purchase?' : 'Are you tracking this job?';
  const NewIcon = kind === 'PO' ? Package : Hammer;

  const computePos = () => {
    const el = btnRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const mob = window.innerWidth < 640;
    const top = Math.max(8, Math.min(r.bottom + 6, window.innerHeight - 180));
    return mob ? { top, left: 8, right: 8 } : { top, right: Math.max(8, window.innerWidth - r.right) };
  };
  const toggle = () => { if (!open) { const p = computePos(); if (p) setPos(p); } setOpen((o) => !o); };
  const close = () => setOpen(false);

  // Keep the panel attached to the chip while the page scrolls; close if it leaves view.
  useEffect(() => {
    if (!open) return;
    const reposition = () => {
      const el = btnRef.current; if (!el) return;
      const r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > window.innerHeight) { setOpen(false); return; }
      const p = computePos(); if (p) setPos(p);
    };
    window.addEventListener('scroll', reposition, true);
    window.addEventListener('resize', reposition);
    return () => { window.removeEventListener('scroll', reposition, true); window.removeEventListener('resize', reposition); };
  }, [open]);

  return (
    <span className="inline-flex" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="db-track-pulse inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md min-w-0"
        style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, maxWidth: 250, ...font }}
      >
        <NewIcon size={11} className="shrink-0" /> <span className="truncate">{nudge}</span> <ChevronDown size={11} className="shrink-0" style={{ opacity: 0.7 }} />
      </button>

      {open && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={(e) => { e.stopPropagation(); close(); }} />
          <div
            className="db-track-pop-in rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos.top, left: pos.left, right: pos.right, zIndex: 9999, width: pos.left === undefined ? 'min(94vw, 480px)' : undefined, maxHeight: '85vh', overflowY: 'auto', background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 24px 60px rgba(30,26,21,0.22)' }}
          >
            {kind === 'WO'
              ? <ContractHub txn={txn} onClose={close} onLinked={onLinked} />
              : <VendorHub txn={txn} onClose={close} onLinked={onLinked} />}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

export const TRACK_CHIP_CSS = `
@keyframes dbTrackPulse { 0%,100% { box-shadow: 0 0 0 0 rgba(188,75,39,0.0); } 50% { box-shadow: 0 0 0 3px rgba(188,75,39,0.10); } }
.db-track-pulse { animation: dbTrackPulse 3.4s ease-in-out infinite; }
.db-track-pulse:hover { animation: none; background: ${V.terraWash} !important; }
@keyframes dbTrackPopIn { from { opacity: 0; transform: translateY(-8px) scale(.97); } to { opacity: 1; transform: none; } }
.db-track-pop-in { animation: dbTrackPopIn .28s cubic-bezier(.2,.8,.2,1) both; transform-origin: top right; }
` + CONTRACT_HUB_CSS + VENDOR_HUB_CSS;
