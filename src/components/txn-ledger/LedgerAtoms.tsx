/**
 * Ledger atoms — verbatim visuals from docs/reference/BriklayTransactionsPage.jsx,
 * parameterised for real data/handlers (the invisible wiring lives in the page).
 */
import type { ReactNode, MouseEvent, CSSProperties } from 'react';
import { ArrowUpRight, ArrowDownLeft, Link2, ChevronDown } from 'lucide-react';
import { V, font, nums } from './ledgerTokens';
import type { TxnAnchor, TxnDirection } from '../../lib/transactions';

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

export function AnchorChip({ anchor, onClick }: { anchor: TxnAnchor; onClick?: (e: MouseEvent) => void }) {
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
