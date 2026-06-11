/**
 * Money atoms (brief trust rules): right-aligned tabular-nums column, and a
 * total that always carries an "excl. GST" qualifier. Pure presentation —
 * callers pass pre-formatted rupee strings (formatting/derivation stays in the
 * page from existing computed totals).
 */
import { V, nums } from './voiceTokens';

/** Right-aligned tabular money cell with a stable min-width (zero layout shift). */
export function UiMoney({ children, size = 16 }: { children: React.ReactNode; size?: number }) {
  return (
    <span
      className="font-medium text-right"
      style={{ color: V.user, fontSize: size, minWidth: 88, ...nums }}
    >
      {children}
    </span>
  );
}

/** A labeled grand-total line: "₹X  excl. GST". */
export function UiTotalExclGst({
  amountLabel, size = 16,
}: {
  amountLabel: string;
  size?: number;
}) {
  return (
    <span className="font-medium" style={{ color: V.user, fontSize: size, ...nums }}>
      {amountLabel} <span className="text-xs font-normal" style={{ color: V.systemFaint }}>excl. GST</span>
    </span>
  );
}
