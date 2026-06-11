/**
 * UiProjectChips — USER-voice project selector (brief §5): selected-state chip
 * with a check, horizontal scroll on mobile, wrap on desktop. Selection routes
 * through the page's EXISTING setter (onSelect) — no new state here.
 */
import { Check } from 'lucide-react';
import { V } from './voiceTokens';

interface UiProjectChipsProps {
  projects: { id: string; name: string }[];
  selectedId: string;
  onSelect: (id: string) => void;
}

export default function UiProjectChips({ projects, selectedId, onSelect }: UiProjectChipsProps) {
  return (
    <div className="flex gap-2 flex-nowrap overflow-x-auto sm:flex-wrap sm:overflow-visible -mx-4 px-4 sm:mx-0 sm:px-0 pb-1">
      {projects.map((p) => {
        const active = p.id === selectedId;
        return (
          <button
            key={p.id}
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(p.id)}
            className="text-xs px-3.5 py-2 rounded-full transition-transform active:scale-95 inline-flex items-center gap-1.5 shrink-0"
            style={active
              ? { background: V.user, color: '#fff' }
              : { background: V.surface, color: V.system, border: `1px solid ${V.line}` }}
          >
            {active && <Check size={12} strokeWidth={3} />}
            {p.name}
          </button>
        );
      })}
    </div>
  );
}
