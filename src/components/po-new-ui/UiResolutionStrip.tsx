/**
 * UiResolutionStrip — the ASK-voice amber strip (brief §5). A presentational
 * shell that HOSTS the page's existing resolution artifacts (candidate chips,
 * family pickers, spec fields) as children. It owns no resolution state and
 * binds no pipeline handler — children carry their existing handlers in.
 *
 * Amendment B (precedence) is decided by the page at render and passed down:
 * the strip shows ONE question (sku_alternatives / pending_families >
 * did_you_mean); a demoted did_you_mean renders via UiDemotedSuggestion below
 * the strip, bound to the existing startFreshResolution handler. No artifact
 * state is altered by these display choices.
 *
 * Telugu (questionTe) is an OPTIONAL stub slot — English-only ships until a
 * string-table mechanism exists (brief §9 / amendment D).
 */
import type { ReactNode } from 'react';
import { Info } from 'lucide-react';
import { V } from './voiceTokens';

export function UiResolutionStrip({
  questionEn, questionTe, onInfo, children,
}: {
  questionEn: ReactNode;
  questionTe?: string;           // stubbed; render only if provided
  onInfo?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mt-3.5 rounded-xl p-3.5" style={{ background: V.askWash, border: `1px solid ${V.askLine}` }}>
      <p className="text-sm mb-3 flex items-center gap-1.5 flex-wrap" style={{ color: V.askDeep }}>
        {questionEn}
        {questionTe && <span style={{ color: V.ask }}>· {questionTe}</span>}
        <button type="button" aria-label="How this was matched" onClick={onInfo}>
          <Info size={14} style={{ color: V.ask }} />
        </button>
      </p>
      {children}
    </div>
  );
}

/**
 * UiStripEscapes — the "Neither?" escape hatches. Wired to the page's EXISTING
 * handlers (handleSkipWithoutLinking / handleAddToCatalog) — passed in as props.
 */
export function UiStripEscapes({
  term, onUseAsTyped, onAddNew,
}: {
  term: string;
  onUseAsTyped: () => void;
  onAddNew: () => void;
}) {
  return (
    <p className="text-xs mt-2.5" style={{ color: V.systemFaint }}>
      Neither?{' '}
      <button type="button" className="underline" style={{ color: V.system }} onClick={onUseAsTyped}>
        Use “{term}” as typed
      </button>
      {' · '}
      <button type="button" className="underline" style={{ color: V.system }} onClick={onAddNew}>
        Add as new catalog item
      </button>
    </p>
  );
}

/**
 * UiDemotedSuggestion — a demoted "Did you mean?" rendered as a small secondary
 * line below the strip when a higher-precedence artifact is showing (amendment
 * B). Bound to the existing startFreshResolution handler via onPick.
 */
export function UiDemotedSuggestion({
  name, onPick,
}: {
  name: string;
  onPick: () => void;
}) {
  return (
    <p className="mt-1.5 text-xs flex items-center gap-1.5 flex-wrap" style={{ color: V.systemFaint }}>
      Did you mean
      <button
        type="button"
        className="underline underline-offset-2"
        style={{ color: V.system }}
        onMouseDown={(e) => { e.preventDefault(); onPick(); }}
      >
        {name}
      </button>
      ?
    </p>
  );
}
