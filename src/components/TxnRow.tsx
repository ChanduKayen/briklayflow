import { formatTxn } from '../lib/formatTxn';

interface TxnRowProps {
  txn: any;
  onClick?: () => void;
  compact?: boolean;
}

export function TxnRow({ txn, onClick, compact = false }: TxnRowProps) {
  const { primary, sub, id, amount } = formatTxn(txn);

  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between border-b border-black/6 last:border-0 group transition-colors ${onClick ? 'cursor-pointer hover:bg-black/[0.02]' : ''} ${compact ? 'py-2' : 'py-3'}`}
    >
      <div className="min-w-0 flex-1 pr-4">
        <p className="text-[13px] font-medium text-on-surface truncate">{primary}</p>
        {sub && <p className="text-[11px] text-on-surface-variant/60 mt-0.5 truncate">{sub}</p>}
        <p className="text-[10px] font-mono text-on-surface-variant/30 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">{id}</p>
      </div>
      <p className="text-[14px] font-semibold font-mono tabular-nums flex-shrink-0 text-right">
        ₹{amount.toLocaleString('en-IN')}
      </p>
    </div>
  );
}
