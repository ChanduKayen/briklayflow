import { formatTxn } from '../lib/formatTxn';

interface TxnRowProps {
  txn: any;
  onClick?: () => void;
  compact?: boolean;
}

export function TxnRow({ txn, onClick, compact = false }: TxnRowProps) {
  const { line1, line2, line3, id, amount } = formatTxn(txn);

  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between border-b border-black/[0.06] last:border-0 group transition-colors ${onClick ? 'cursor-pointer hover:bg-black/[0.02]' : ''} ${compact ? 'py-2' : 'py-3'}`}
    >
      <div className="min-w-0 flex-1 pr-4">
        <p className="text-[13px] font-[500] text-on-surface truncate">{line1}</p>
        {line2 && <p className="text-[11px] text-on-surface-variant/70 mt-0.5 truncate">{line2}</p>}
        {line3 && <p className="text-[11px] text-on-surface-variant/40 mt-0.5 truncate">{line3}</p>}
        <p className="text-[10px] font-mono text-on-surface-variant/25 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">{id}</p>
      </div>
      <p className="text-[14px] font-semibold font-mono tabular-nums flex-shrink-0 text-right text-on-surface">
        ₹{amount.toLocaleString('en-IN')}
      </p>
    </div>
  );
}
