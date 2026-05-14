import { formatTxn, type TxnContext } from '../lib/formatTxn';

interface TxnRowProps {
  txn: any;
  context?: TxnContext;
  variant?: 'full' | 'compact' | 'minimal';
  onClick?: () => void;
  className?: string;
}

export function TxnRow({
  txn,
  context = 'global',
  variant = 'compact',
  onClick,
  className = '',
}: TxnRowProps) {
  const { primary, secondary, tertiary, id, amount } = formatTxn(txn, context);

  const py = variant === 'full' ? 'py-3' : variant === 'minimal' ? 'py-2' : 'py-2.5';
  const px = variant === 'compact' ? 'px-3' : '';

  return (
    <div
      onClick={onClick}
      className={`flex items-center justify-between border-b border-black/[0.06] last:border-0 group transition-colors ${onClick ? 'cursor-pointer hover:bg-black/[0.02]' : ''} ${py} ${px} ${className}`}
    >
      <div className="min-w-0 flex-1 pr-4">
        <p className="text-[13px] font-[500] text-on-surface truncate">{primary}</p>
        {secondary && <p className="text-[11px] text-on-surface-variant/70 mt-0.5 truncate">{secondary}</p>}
        {tertiary  && <p className="text-[11px] text-on-surface-variant/40 mt-0.5 truncate">{tertiary}</p>}
        <p className="text-[10px] font-mono text-on-surface-variant/25 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity duration-150">{id}</p>
      </div>
      <p className="text-[14px] font-semibold font-mono tabular-nums flex-shrink-0 text-right text-on-surface">
        ₹{amount.toLocaleString('en-IN')}
      </p>
    </div>
  );
}
