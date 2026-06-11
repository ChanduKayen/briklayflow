/**
 * UiWoRecap — sticky reconciliation recap (brief §4): the live allocated /
 * contract figure, kept visible while scrolling. Pure derived display; no
 * state, no effects. Neutral wording (ruling 3) — never "missing"/"error".
 */
import { V } from '../po-new-ui/voiceTokens';
import { inr } from './woTokens';

interface UiWoRecapProps {
  allocated: number;   // stagesTotal
  contract: number;    // orderValue
  isOver: boolean;     // the page's existing isOver
  stageCount: number;
}

export default function UiWoRecap({ allocated, contract, isOver, stageCount }: UiWoRecapProps) {
  const gap = contract - allocated;
  const exact = contract > 0 && Math.abs(gap) < 0.01 && stageCount > 0;
  const tone = exact ? V.confirm : isOver ? V.askDeep : V.system;

  return (
    <div
      className="sticky top-0 z-20 -mx-5 sm:-mx-6 px-5 sm:px-6 py-2 flex items-center gap-2 text-xs"
      style={{ background: V.page, borderBottom: `1px solid ${V.line}`, color: V.system }}
    >
      <span className="font-medium" style={{ color: V.user, fontVariantNumeric: 'tabular-nums' }}>{inr(allocated)}</span>
      <span style={{ color: V.systemFaint }}>allocated of</span>
      <span className="font-medium" style={{ color: V.user, fontVariantNumeric: 'tabular-nums' }}>{inr(contract)}</span>
      <span className="flex-1" />
      <span style={{ color: tone, fontVariantNumeric: 'tabular-nums' }}>
        {stageCount === 0
          ? 'one full payment'
          : exact
            ? 'reconciled'
            : isOver
              ? `${inr(-gap)} over`
              : `${inr(gap)} not yet staged`}
      </span>
    </div>
  );
}
