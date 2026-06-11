/**
 * UiAllocationBar — the contract drawn as money (brief §4 / reference).
 * INFORMATIONAL ONLY (B1 ruling): it never gates save; the page keeps its
 * existing isOver-only disable. All figures are derived at render and passed
 * in — no state, no effects. Captions are neutral, never "missing"/"error"
 * (ruling 3): zero stages → neutral full-width segment ("saves as one full
 * payment…"); under → "₹X allocated · ₹Y not yet staged"; over → "stages
 * exceed contract by ₹Z" (derived from isOver). Segments are tappable to
 * highlight their stage row.
 */
import { V } from '../po-new-ui/voiceTokens';
import { SEG, inr } from './woTokens';

interface UiAllocationBarProps {
  contract: number;
  total: number;                      // sum of named stage amounts (calcAmount)
  segments: number[];                 // per-named-stage amount, in order
  isOver: boolean;                    // the page's existing isOver
  activeSeg: number | null;
  onSegTap: (i: number) => void;
}

export default function UiAllocationBar({ contract, total, segments, isOver, activeSeg, onSegTap }: UiAllocationBarProps) {
  const gap = contract - total;
  const exact = contract > 0 && Math.abs(gap) < 0.01 && segments.length > 0;

  // Zero stages — a legitimate one-time-job flow, not an error (ruling 3a).
  if (segments.length === 0) {
    return (
      <div className="mt-5">
        <div
          className="h-3 rounded-full"
          style={{ background: V.field, border: `1px solid ${V.line}` }}
          role="img"
          aria-label="No stages — full payment on completion"
        />
        <p className="text-xs mt-2" style={{ color: V.system }}>
          no stages — saves as one full payment of {inr(contract)} on completion
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5">
      <div
        className="flex h-3 rounded-full overflow-hidden"
        style={{ background: V.askWash, border: `1px solid ${exact ? 'transparent' : V.askLine}` }}
        role="img"
        aria-label={exact ? 'Fully allocated' : isOver ? `stages exceed contract by ${inr(-gap)}` : `${inr(gap)} not yet staged`}
      >
        {segments.map((amt, i) => {
          const w = contract > 0 ? (amt / contract) * 100 : 0;
          return (
            <button
              key={i}
              type="button"
              onClick={() => onSegTap(i)}
              aria-label={`Stage ${i + 1}: ${inr(amt)}`}
              className="h-full transition-all"
              style={{
                width: `${Math.min(w, 100)}%`,
                background: SEG[i % SEG.length],
                outline: activeSeg === i ? `2px solid ${V.user}` : 'none',
                outlineOffset: -2,
              }}
            />
          );
        })}
      </div>
      <p className="text-xs mt-2" style={{ color: exact ? V.confirm : V.askDeep, fontVariantNumeric: 'tabular-nums' }}>
        {exact
          ? `the full ${inr(contract)} is allocated — reconciled`
          : isOver
            ? `stages exceed contract by ${inr(-gap)}`
            : `${inr(total)} allocated · ${inr(gap)} not yet staged`}
      </p>
    </div>
  );
}
