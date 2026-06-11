/**
 * UiWoCeremony — the work-order save ceremony (brief §4 / B5). Presentation
 * around the EXISTING create_work_order mutation. Opens on a cosmetic flag the
 * page sets in the existing onSuccess (invalidation stays immediate); every
 * exit — scrim, Done, View work order — calls the same onLeave, which is the
 * page's EXISTING navigate with identical args (B5). Sentence mirrors the living
 * sentence: zero stages → "paid in full"; no "first stage due" line (ruling 3d).
 */
import { ListChecks } from 'lucide-react';
import { V } from '../po-new-ui/voiceTokens';
import { SEG, serif, inr } from './woTokens';

interface UiWoCeremonyProps {
  open: boolean;
  woId?: string;
  workerName?: string;
  projectName?: string;
  total: number;
  contract: number;
  segments: number[];   // per-named-stage amount
  stageCount: number;
  onLeave: () => void;
}

export default function UiWoCeremony({
  open, woId, workerName, projectName, total, contract, segments, stageCount, onLeave,
}: UiWoCeremonyProps) {
  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center sm:justify-center">
      <div className="absolute inset-0" style={{ background: 'rgba(30,26,21,0.5)' }} onClick={onLeave} aria-hidden="true" />
      <div
        className="relative w-full sm:max-w-md rounded-t-3xl sm:rounded-3xl p-6 pb-8 sm:pb-6 text-center motion-safe:animate-scale-in"
        style={{ background: V.surface }}
        role="dialog"
        aria-modal="true"
        aria-label="Work order created"
      >
        <div className="w-12 h-12 rounded-full mx-auto mb-4 flex items-center justify-center" style={{ background: V.confirmWash }}>
          <ListChecks size={22} color={V.confirm} />
        </div>

        {woId && <p className="text-2xl font-medium" style={{ color: V.user, fontVariantNumeric: 'tabular-nums' }}>{woId}</p>}

        <p className="text-sm mt-2 leading-relaxed" style={{ color: V.userSoft, ...serif }}>
          Hiring <span style={{ fontWeight: 600 }}>{workerName || 'someone'}</span> for work on{' '}
          <span style={{ fontWeight: 600 }}>{projectName || 'a project'}</span>, worth{' '}
          <span style={{ fontWeight: 600, fontVariantNumeric: 'tabular-nums' }}>{inr(total || contract)}</span>, paid in{' '}
          <span style={{ fontWeight: 600 }}>{stageCount > 0 ? `${stageCount} stage${stageCount > 1 ? 's' : ''}` : 'full'}</span>.
        </p>

        {segments.length > 0 && (
          <div className="flex h-2 rounded-full overflow-hidden mt-5" style={{ background: V.field }}>
            {segments.map((amt, i) => (
              <div key={i} style={{ width: `${contract > 0 ? (amt / contract) * 100 : 0}%`, background: SEG[i % SEG.length] }} />
            ))}
          </div>
        )}

        <p className="text-xs mt-2" style={{ color: V.systemFaint, fontVariantNumeric: 'tabular-nums' }}>
          {inr(total || contract)} excl. GST
        </p>

        <div className="flex gap-2.5 mt-5">
          <button onClick={onLeave} className="flex-1 py-3 rounded-xl text-sm font-medium" style={{ border: `1px solid ${V.line}`, color: V.user }}>
            Done
          </button>
          <button onClick={onLeave} className="flex-1 py-3 rounded-xl text-sm font-medium" style={{ background: V.user, color: '#fff' }}>
            View work order
          </button>
        </div>
      </div>
    </div>
  );
}
