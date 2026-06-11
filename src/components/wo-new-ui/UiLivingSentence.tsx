/**
 * UiLivingSentence — the plain-language header that fills in as the user works
 * (brief §4 / reference). Pure presentation: every value is derived at render
 * from existing form state and passed in as props — no state, no effects, so it
 * updates synchronously with keystrokes. Empty slots render as soft dotted
 * blanks; the last slot reads "in full" when there are no stages (ruling 3a).
 */
import type { ReactNode } from 'react';
import { V } from '../po-new-ui/voiceTokens';
import { serif, inr } from './woTokens';

function Slot({ filled, children }: { filled: boolean; children: ReactNode }) {
  return (
    <span
      style={
        filled
          ? { color: V.user, fontWeight: 600 }
          : { color: V.systemFaint, borderBottom: `2px dotted ${V.systemFaint}`, fontStyle: 'italic' }
      }
    >
      {children}
    </span>
  );
}

interface UiLivingSentenceProps {
  workerName?: string;
  projectName?: string;
  contract: number;
  stageCount: number;
}

export default function UiLivingSentence({ workerName, projectName, contract, stageCount }: UiLivingSentenceProps) {
  return (
    <p
      className="text-xl sm:text-2xl leading-relaxed"
      style={{ color: V.userSoft, ...serif }}
      aria-live="polite"
    >
      Hiring <Slot filled={!!workerName}>{workerName || 'someone'}</Slot> for work on{' '}
      <Slot filled={!!projectName}>{projectName || 'a project'}</Slot>, worth{' '}
      <Slot filled={contract > 0}><span style={{ fontVariantNumeric: 'tabular-nums' }}>{contract > 0 ? inr(contract) : 'an amount'}</span></Slot>, paid in{' '}
      <Slot filled>{stageCount > 0 ? `${stageCount} stage${stageCount > 1 ? 's' : ''}` : 'full'}</Slot>.
    </p>
  );
}
