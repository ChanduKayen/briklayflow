/**
 * Ledger atoms — verbatim visuals from docs/reference/BriklayTransactionsPage.jsx,
 * parameterised for real data/handlers (the invisible wiring lives in the page).
 */
import { useState, useRef, type ReactNode, type MouseEvent, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, ArrowDownLeft, Link2, ChevronDown, Hammer, Package } from 'lucide-react';
import { V, font, nums } from './ledgerTokens';
import type { TxnAnchor, TxnDirection } from '../../lib/transactions';

const inr = (n: number) => Math.round(n).toLocaleString('en-IN');

/** What the chip needs to render a title + burn-down (built in Ledger.tsx). */
export type AnchorInfo = { kind: 'WO' | 'PO'; title: string; total: number; paid: number };

export function DirMedallion({ dir }: { dir: TxnDirection }) {
  const out = dir === 'out';
  return (
    <span
      className="w-7 h-7 rounded-full flex items-center justify-center shrink-0 relative"
      style={{
        background: out ? V.terraWash : V.sageWash,
        boxShadow: `0 0 0 3px ${V.surface}`, // ring masks the spine behind it
        zIndex: 1,
      }}
      aria-label={out ? 'Money out' : 'Money in'}
    >
      {out ? <ArrowUpRight size={14} color={V.terraDeep} /> : <ArrowDownLeft size={14} color={V.sage} />}
    </span>
  );
}

export function Amount({ dir, value }: { dir: TxnDirection; value: string }) {
  const out = dir === 'out';
  return (
    <p className="text-[15px] font-medium text-right" style={{ color: out ? V.terraDeep : V.sage, ...font, ...nums }}>
      <span className="mr-0.5" style={{ fontSize: 12 }}>{out ? '−' : '+'}</span>₹{value}
    </p>
  );
}

export function AnchorChip({ anchor, info, siblings = 0, partyName, siteName, onClick }: { anchor: TxnAnchor; info?: AnchorInfo; siblings?: number; partyName?: string | null; siteName?: string | null; onClick?: (e: MouseEvent) => void }) {
  const [hover, setHover] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const [tipPos, setTipPos] = useState<{ top: number; left: number } | null>(null);
  if (!anchor) {
    return (
      <button
        type="button"
        onClick={onClick}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md"
        style={{ background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font }}
      >
        not linked yet · link it
      </button>
    );
  }
  // Linked WO/PO with resolved order info: a human title + a burn-down + balance —
  // the bare code only surfaces on hover (and via the native title tooltip).
  if (info) {
    const total = info.total;
    const paid = info.paid;
    const balance = Math.max(0, total - paid);
    const paidPct = total > 0 ? Math.min(100, Math.max(0, (paid / total) * 100)) : 0;
    const settled = balance <= 0 && total > 0;
    const isWO = info.kind === 'WO';
    const TypeIcon = isWO ? Hammer : Package;
    const fill = isWO ? V.terra : V.sys; // WO terracotta; PO a calmer tone
    // Silent depth cue: when this party has OTHER open obligations of the same kind,
    // grow a faint stacked-card edge peeking out bottom-right (1 sibling = one card,
    // 2+ = two receding/lightening cards). No text — the count lives only in the
    // tooltip + the order peek. Warm low-contrast edges, a hair darker than V.field.
    const stack = siblings > 0;
    const edgeNear = V.line;          // #EAE6E0 — closest card, just visible over V.field
    const edgeFar  = '#EFEBE4';       // a touch lighter (blend toward V.surface) — recedes
    const stackShadow = !stack
      ? undefined
      : siblings === 1
        ? `2.5px 2.5px 0 0 ${edgeNear}`
        : `2px 2px 0 0 ${edgeNear}, 4px 4px 0 0 ${edgeFar}`;
    // The id is already revealed in-place on hover, so the tooltip never repeats it — it
    // carries ONLY the silent-count truth, in a beautiful walnut pill (portal'd so the row's
    // overflow can't clip it). Noun + accent match the obligation kind.
    const tipNoun = info.kind === 'WO' ? (siblings === 1 ? 'contract' : 'contracts') : (siblings === 1 ? 'bill' : 'bills');
    const tipAccent = info.kind === 'WO' ? '#E89A72' : '#9CBB91';
    const showTip = () => { setHover(true); const el = btnRef.current; if (stack && el) { const r = el.getBoundingClientRect(); setTipPos({ top: r.top, left: r.left }); } };
    const hideTip = () => { setHover(false); setTipPos(null); };
    return (
      <>
      <button
        ref={btnRef}
        type="button"
        onClick={onClick}
        onMouseEnter={showTip}
        onMouseLeave={hideTip}
        className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md max-w-full"
        style={{
          background: V.field,
          color: V.inkSoft,
          ...font,
          // reserve room so the stacked edge isn't clipped by the row
          ...(stack ? { boxShadow: stackShadow, marginRight: 4, marginBottom: 4 } : {}),
        }}
      >
        <TypeIcon size={11} style={{ color: V.faint }} className="shrink-0" />
        <span className="truncate" style={{ maxWidth: 140 }}>
          {hover ? <span style={{ fontFamily: 'monospace', fontSize: 10.5, color: V.faint }}>{anchor.ref}</span> : info.title}
        </span>
        {total > 0 && (
          <span
            aria-hidden="true"
            className="shrink-0 overflow-hidden rounded-full"
            style={{ width: 40, height: 4, background: V.line }}
          >
            <span
              className="block h-full rounded-full"
              style={{ width: `${paidPct}%`, background: settled ? V.sage : fill }}
            />
          </span>
        )}
        {settled ? (
          <span className="shrink-0 whitespace-nowrap" style={{ color: V.sage, ...font }}>✓ settled</span>
        ) : (
          <span className="shrink-0 whitespace-nowrap" style={{ color: V.terraDeep, ...font, ...nums }}>₹{inr(balance)} left</span>
        )}
      </button>
      {stack && tipPos && createPortal(
        <div role="tooltip" style={{ position: 'fixed', top: tipPos.top - 9, left: tipPos.left, transform: 'translateY(-100%)', zIndex: 9999, pointerEvents: 'none' }}>
          <div style={{
            position: 'relative', padding: '7px 11px', borderRadius: 10, whiteSpace: 'nowrap',
            background: 'linear-gradient(158deg,#2D2118 0%,#1B140E 100%)', color: '#F3EADB',
            fontSize: 11, fontWeight: 500, letterSpacing: '0.01em', ...font,
            boxShadow: '0 14px 32px -12px rgba(20,15,10,.6), inset 0 0 0 1px rgba(243,234,219,.08)',
            animation: 'anchorTipIn .17s cubic-bezier(.2,.85,.25,1) both',
          }}>
            <span style={{ color: '#F3EADB', fontWeight: 600 }}>{partyName?.trim() || 'This party'}</span> has <span style={{ color: tipAccent, fontWeight: 700, ...nums }}>+{siblings}</span> more open {tipNoun}{siteName?.trim() ? <> on <span style={{ color: '#F3EADB', fontWeight: 600 }}>{siteName.trim()}</span></> : ''}
            <span aria-hidden="true" style={{ position: 'absolute', top: '100%', left: 15, width: 9, height: 9, background: '#1B140E', borderRight: '1px solid rgba(243,234,219,.08)', borderBottom: '1px solid rgba(243,234,219,.08)', transform: 'translateY(-5px) rotate(45deg)' }} />
          </div>
        </div>,
        document.body,
      )}
      </>
    );
  }
  // No resolved info (CLIENT anchors, or an order we couldn't load): the original chip.
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md max-w-full"
      style={{ background: V.field, color: V.inkSoft, ...font }}
    >
      <Link2 size={11} style={{ color: V.faint }} />
      <span className="truncate" style={{ color: V.faint }}>{anchor.ref}</span>
      {anchor.label && <span>·</span>}
      {anchor.label && <span className="truncate">{anchor.label}</span>}
    </button>
  );
}

export function FilterChip({
  children, active, tone, onClick, hasDropdown = true, style,
}: {
  children: ReactNode;
  active?: boolean;
  tone?: 'ask';
  onClick?: (e: MouseEvent) => void;
  hasDropdown?: boolean;
  style?: CSSProperties;
}) {
  const ask = tone === 'ask';
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-sm px-3 py-1.5 rounded-full"
      style={{
        ...(ask
          ? { background: V.askWash, border: `1px solid ${V.askLine}`, color: V.ask, ...font }
          : active
          ? { background: V.terraWash, border: '1px solid #EFD6C9', color: V.terraDeep, ...font }
          : { background: V.surface, border: `1px solid ${V.line}`, color: V.inkSoft, ...font }),
        ...style,
      }}
    >
      {children}{!ask && hasDropdown && <ChevronDown size={13} style={{ color: V.faint }} />}
    </button>
  );
}

/** The month flow bar: in vs out, one glance. */
export function FlowBar({
  inLabel, outLabel, net, outPct,
}: {
  inLabel: string;
  outLabel: string;
  net: string;
  outPct: number;
}) {
  return (
    <div className="mt-5" style={{ maxWidth: 460 }}>
      <div className="flex h-2 rounded-full overflow-hidden" style={{ background: V.field }}>
        <div style={{ width: `${100 - outPct}%`, background: V.sage, opacity: 0.85 }} />
        <div style={{ width: `${outPct}%`, background: V.terra, opacity: 0.8 }} />
      </div>
      <div className="flex items-baseline justify-between mt-2 gap-3">
        <p className="text-xs" style={{ color: V.sys, ...font, ...nums }}>
          <span style={{ color: V.sage }}>+ ₹{inLabel} in</span>
          <span className="mx-1.5" style={{ color: V.line }}>|</span>
          <span style={{ color: V.terraDeep }}>− ₹{outLabel} out</span>
        </p>
        <p className="text-xs shrink-0" style={{ color: V.inkSoft, ...font, ...nums }}>
          net <b style={{ color: net.trim().startsWith('-') || net.trim().startsWith('−') ? V.terraDeep : V.sage }}>{net}</b>
        </p>
      </div>
    </div>
  );
}
