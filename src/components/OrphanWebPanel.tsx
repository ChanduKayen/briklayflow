import { useState } from 'react';
import { AttributePillSelector } from './AttributePillSelector';
import type { WebVariantGroup } from '../lib/skuTreeResolver';

interface OrphanWebPanelProps {
  originalInput: string;
  webVariants:   WebVariantGroup[];
  onSave:        (selections: Record<string, string>) => void;
  onSkip:        () => void;
}

export function OrphanWebPanel({ originalInput, webVariants, onSave, onSkip }: OrphanWebPanelProps) {
  const [selections, setSelections] = useState<Record<string, string>>({});

  function handleSelect(attribute: string, value: string) {
    setSelections(prev => ({ ...prev, [attribute]: value }));
  }

  const allSelected = webVariants.every(g => selections[g.attribute]);

  return (
    <div className="border-t border-blue-100 bg-blue-50/10 p-4">
      <div className="border-l-4 border-blue-400 pl-4 space-y-3">

        {/* Header */}
        <div>
          <p className="text-[12px] font-bold text-blue-900">
            New to your catalog
            <span className="font-normal text-blue-700/70 ml-1">
              · "{originalInput}"
            </span>
          </p>
          <p className="text-[11px] text-blue-800/80 mt-0.5">
            Web search shows this material comes in several specifications.
            Which one are you ordering?
          </p>
        </div>

        {/* Variant pickers */}
        <div className="space-y-3">
          {webVariants.map((group) => (
            <AttributePillSelector
              key={group.attribute}
              label={group.attribute}
              description={group.description}
              options={group.options}
              selected={selections[group.attribute]}
              onSelect={(val) => handleSelect(group.attribute, val)}
              onCustomValue={(val) => handleSelect(group.attribute, val)}
            />
          ))}
        </div>

        {/* Footer */}
        <p className="text-[10px] text-blue-700/60 italic">
          Web sources suggest these are standard options. Pick what you're ordering, or type a custom value.
        </p>

        {/* Actions */}
        <div className="flex items-center gap-3 pt-1">
          <button
            type="button"
            onClick={() => onSave(selections)}
            disabled={!allSelected}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-[12px] font-semibold rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <span className="material-symbols-outlined text-[14px]">link</span>
            Save &amp; Link
          </button>
          <button
            type="button"
            onClick={onSkip}
            className="text-[11px] text-blue-700/70 hover:text-blue-900 hover:underline transition-colors"
          >
            Skip — add as-is
          </button>
        </div>
      </div>
    </div>
  );
}
