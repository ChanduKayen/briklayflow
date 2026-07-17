/**
 * TrackChip — the "not linked" slot on a payment row, framed as a declarative,
 * swappable status: "This payment is — [ Linked to a contract › ] [ One-time ]".
 *
 * WORKER payments (→ ContractHub) get the segmented control:
 *   · Linked to a contract ›  routes through the hub (link to an open contract, start
 *                             a new one, or — inside — daily-wage/labour). Decision A:
 *                             labour lives in the hub. Once linked, the row swaps to the
 *                             contract reference and this chip unmounts, so the control
 *                             only ever shows two states: unanswered + one-time-chosen.
 *   · One-time                sets directly (fileAsLabour). Tap again to clear; tap the
 *                             contract side to swap. Green = the selected tick, never a
 *                             red "reject" — one-time is a valid, neutral outcome.
 *
 * VENDOR payments (→ VendorHub) keep the single-tap nudge — the vendor side has no
 * one-off path, so there's no binary/segment to offer.
 *
 * NOTE on persistence: fileAsLabour writes nothing today (no "untracked" flag in the
 * schema), so the one-time selection is session-local — the 'chosen' state IS the
 * feedback. When that flag lands, init `chosen` from it and call onLinked() in
 * setOneTime() so the swap survives a refresh.
 */
import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Hammer, Package, ChevronRight, Check } from 'lucide-react';
import { V, font } from './ledgerTokens';
import type { TrackTxn } from '../../lib/trackingApi';
import { fileAsLabour, clearOneTime, getTrackingOptions } from '../../lib/trackingApi';
import { getVendorHub } from '../../lib/vendorTrackingApi';
import { ContractHub, CONTRACT_HUB_CSS } from './ContractHub';
import { VendorHub, VENDOR_HUB_CSS } from './VendorHub';

type Kind = 'WO' | 'PO';

export function TrackChip({ txn, onLinked }: { txn: TrackTxn; onLinked: () => void }) {
  const [open, setOpen] = useState(false);
  // WO only: true once the owner marks this a one-time payment (persisted via is_one_time).
  const [chosenOneTime, setChosenOneTime] = useState(!!txn.is_one_time);
  const [busy, setBusy] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [pos, setPos] = useState<{ top?: number; bottom?: number; left?: number; right?: number; maxH: number }>({ top: 0, right: 0, maxH: 480 });

  const kind: Kind = txn.stakeholders?.type === 'Vendor' ? 'PO' : 'WO';

  // Warm the hub's data as soon as this chip scrolls into view, so opening it is instant.
  const qc = useQueryClient();
  const rootRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const el = rootRef.current; if (!el || chosenOneTime) return;
    const io = new IntersectionObserver((es) => {
      if (!es[0]?.isIntersecting) return;
      io.disconnect();
      if (kind === 'WO') void qc.prefetchQuery({ queryKey: ['trackOptions', txn.txn_id], queryFn: () => getTrackingOptions(txn), staleTime: 30_000 });
      else void qc.prefetchQuery({ queryKey: ['vendorHub', txn.txn_id], queryFn: () => getVendorHub(txn), staleTime: 30_000 });
    }, { rootMargin: '150px' });
    io.observe(el);
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Place the panel so it is ALWAYS fully on-screen: below the chip when there's room, otherwise flip
  // above; cap maxHeight to the available space (internal scroll) so it never floats off the viewport.
  const computePos = () => {
    const el = btnRef.current; if (!el) return null;
    const r = el.getBoundingClientRect();
    const mob = window.innerWidth < 640;
    const M = 8;
    const side: { left?: number; right?: number } = mob ? { left: 8, right: 8 } : { right: Math.max(8, window.innerWidth - r.right) };
    const spaceBelow = window.innerHeight - r.bottom - M;
    const spaceAbove = r.top - M;
    if (spaceBelow >= 220 || spaceBelow >= spaceAbove) {
      const top = Math.min(r.bottom + 6, window.innerHeight - 140);
      return { top, ...side, maxH: Math.max(160, window.innerHeight - top - M) };
    }
    const bottom = Math.max(M, window.innerHeight - r.top + 6);
    return { bottom, ...side, maxH: Math.max(160, window.innerHeight - bottom - M) };
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

  const setOneTime = async () => {
    if (busy) return;
    setBusy(true);
    try { await fileAsLabour(txn); setChosenOneTime(true); onLinked(); }
    catch { setChosenOneTime(false); } // e.g. migration not applied yet — leave the choice open
    finally { setBusy(false); }
  };

  const undoOneTime = async () => {
    if (busy) return;
    setBusy(true);
    try { await clearOneTime(txn); setChosenOneTime(false); onLinked(); }
    catch { /* keep the settled state if the clear failed */ }
    finally { setBusy(false); }
  };

  // Worker → contract; Vendor → order. Both share one gate; "one-time payment" (worker)
  // and "direct purchase" (vendor) are the SAME mechanism (fileAsLabour → is_one_time).
  const isWO = kind === 'WO';
  const Icon = isWO ? Hammer : Package;
  const linkLabel = isWO ? 'Link to a contract' : 'Link to a bill';
  const oneLabel = isWO ? 'One-time payment' : 'Direct purchase';

  const gate = chosenOneTime ? (
    // ── RESOLVED — uniform with the linked AnchorChip (calm grey, same size/shape).
    //    Tap to change (clears is_one_time and reopens the choice). ──
    <button
      type="button"
      disabled={busy}
      onClick={(e) => { e.stopPropagation(); void undoOneTime(); }}
      className="db-otp-pop inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md disabled:opacity-60"
      style={{ background: V.field, color: V.inkSoft, ...font }}
      title="Change"
    >
      <Check size={11} className="shrink-0" style={{ color: V.faint }} />
      <span>{oneLabel}</span>
    </button>
  ) : (
    // ── UNRESOLVED — the row carries ONE action: the link nudge. The "one-time" choice moved INTO the hub,
    //    as a beautiful button at its head (ContractHub) — so a worker row is a single clean nudge, not a
    //    two-button fork. Vendor rows keep their inline "direct purchase" (no hub head-button on that side). ──
    <span className="inline-flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => { e.stopPropagation(); toggle(); }}
        className="db-link-btn inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg"
        style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.terraDeep, fontWeight: 600 }}
      >
        <Icon size={12} className="shrink-0" style={{ color: V.terra }} />
        <span>{linkLabel}</span>
        <ChevronRight size={12} className="shrink-0" style={{ opacity: 0.7 }} />
      </button>
      {!isWO && (
        <>
          <span className="text-[11px] select-none" style={{ color: V.faint, ...font }}>or</span>
          <button
            type="button"
            disabled={busy}
            onClick={(e) => { e.stopPropagation(); void setOneTime(); }}
            className="db-onetime-btn inline-flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg disabled:opacity-60"
            style={{ background: V.surface, border: `1px solid ${V.line}`, color: V.sys, fontWeight: 500 }}
          >
            <span>{busy ? 'Saving…' : oneLabel}</span>
          </button>
        </>
      )}
    </span>
  );

  return (
    <span ref={rootRef} className="inline-flex" onClick={(e) => e.stopPropagation()}>

      {gate}

      {open && createPortal(
        <>
          <div className="fixed inset-0" style={{ zIndex: 9998 }} onClick={(e) => { e.stopPropagation(); close(); }} />
          <div
            className="db-track-pop-in rounded-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
            style={{ position: 'fixed', top: pos.top, bottom: pos.bottom, left: pos.left, right: pos.right, zIndex: 9999, width: pos.left === undefined ? 'min(94vw, 480px)' : undefined, maxHeight: pos.maxH, overflowY: 'auto', background: V.surface, border: `1px solid ${V.line}`, boxShadow: '0 24px 60px rgba(30,26,21,0.22)' }}
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
.db-track-pulse:hover { animation: none; }
.db-link-btn, .db-onetime-btn { transition: background .16s ease, border-color .16s ease, color .16s ease, transform .12s ease; }
.db-link-btn:hover { background: ${V.terraWash} !important; border-color: rgba(188,75,39,.45) !important; }
.db-onetime-btn:hover { background: ${V.sageWash} !important; border-color: ${V.sage} !important; color: ${V.sage} !important; }
.db-link-btn:active, .db-onetime-btn:active { transform: scale(.95); }
.db-otp-pop { animation: dbOtpPop .3s cubic-bezier(.2,.85,.3,1.2); }
@keyframes dbOtpPop { 0% { transform: scale(.9); opacity: .45; } 60% { transform: scale(1.04); } 100% { transform: scale(1); opacity: 1; } }
@keyframes dbTrackPopIn { from { opacity: 0; transform: translateY(-8px) scale(.97); } to { opacity: 1; transform: none; } }
.db-track-pop-in { animation: dbTrackPopIn .28s cubic-bezier(.2,.8,.2,1) both; transform-origin: top right; }
` + CONTRACT_HUB_CSS + VENDOR_HUB_CSS;
