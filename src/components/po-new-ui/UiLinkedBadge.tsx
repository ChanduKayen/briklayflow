/**
 * UiLinkedBadge — CONFIRM-voice "linked" chip, with an optional "auto" tag when
 * the system linked the row without a human tap (brief: automation admits
 * itself). Presentation only — the unlink/dismiss controls and their handlers
 * stay in the page beside this badge; nothing here is interactive by default.
 */
import { Check } from 'lucide-react';
import { V } from './voiceTokens';

interface UiLinkedBadgeProps {
  /** True when this row was auto-linked (li.auto_applied). Adds the "auto" tag. */
  auto?: boolean;
}

export default function UiLinkedBadge({ auto }: UiLinkedBadgeProps) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span
        className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full"
        style={{ background: V.confirmWash, color: V.confirm }}
      >
        <Check size={11} strokeWidth={3} /> linked
      </span>
      {auto && (
        <span
          className="text-xs px-1.5 py-0.5 rounded-full"
          style={{ border: `1px solid ${V.line}`, color: V.system }}
          title="Matched by the system at high confidence — tap to review or change"
        >
          auto
        </span>
      )}
    </span>
  );
}
