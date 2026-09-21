/**
 * AttributeChip — the ONE control a payment row wears for "what does this settle?".
 *
 * Worker and vendor rows used to wear two different-looking controls (a dashed tag vs a raised terra
 * button, with different resolved states). This is the single shape both now use, so the ledger reads
 * consistently: only the WORDS (and the dot's hue) differ.
 *
 *   · nudge  (unlinked) — transparent, dashed border, muted text, a trailing ›. A quiet call to act.
 *   · linked (settled)  — a calm filled tag with a small dot + the target's label.
 */
import { forwardRef, type ReactNode } from 'react';
import { V, font } from './ledgerTokens';

export interface AttributeChipProps {
  linked: boolean;
  /** linked: the target label (e.g. "This week's wages", "Bill #RSG0039"); nudge: the prompt. */
  label: ReactNode;
  /** the dot colour when linked — sage for work/wages, terra for a bill. */
  dot?: string;
  title?: string;
  onClick?: (e: React.MouseEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
}

export const AttributeChip = forwardRef<HTMLButtonElement, AttributeChipProps>(function AttributeChip(
  { linked, label, dot = V.sage, title, onClick, onMouseEnter, onMouseLeave }, ref,
) {
  return (
    <button
      ref={ref}
      type="button"
      title={title}
      onClick={(e) => { e.stopPropagation(); onClick?.(e); }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`attr-chip inline-flex items-center gap-1.5 text-xs px-2 py-0.5 rounded-md${linked ? '' : ' attr-nudge'}`}
      style={{
        background: linked ? V.field : 'transparent',
        color: linked ? V.inkSoft : V.ask,
        border: `1px solid ${linked ? 'transparent' : V.askLine}`,
        cursor: 'pointer',
        ...font,
      }}
    >
      {linked
        ? <><span className="shrink-0 rounded-full" style={{ width: 5, height: 5, background: dot }} />{label}</>
        : <>{label} <span style={{ color: V.faint }}>›</span></>}
    </button>
  );
});

export const ATTR_CHIP_CSS = `
.attr-chip{transition:background .15s ease,border-color .15s ease,color .15s ease}
.attr-chip:hover{background:${V.field};border-color:${V.line}}
/* The unresolved nudge ("Attach a bill" / "Towards a payable") is a warm call to act:
   a soft amber outline that fills with the amber wash on hover. */
.attr-nudge:hover{background:${V.askWash} !important;border-color:${V.ask} !important}
`;
